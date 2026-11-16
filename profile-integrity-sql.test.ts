import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateIdentityInput } from './identity-validation';
import { identityTestInput } from './identity-test-fixtures';

const migration = await readFile(
  new URL(
    '../../supabase/migrations/20261116000003_profile_identity_and_serial_integrity.sql',
    import.meta.url,
  ),
  'utf8',
);
async function database() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    -- Match installations whose default privileges grant the service role broad table access.
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;
    CREATE TABLE public.profiles(id text primary key, user_key text unique not null, serial_no text,
      role text, address text, legal_proof_type text, legal_proof_number text, profile_data jsonb default '{}'::jsonb,
      updated_at timestamptz not null default clock_timestamp());`);
  return db;
}

test('profile integrity SQL: duplicate preflight fails without changing legacy records', async () => {
  const db = await database();
  try {
    await db.exec(
      `INSERT INTO profiles(id,user_key,serial_no) VALUES ('a','a','SN-UP-1010'),('b','b',' SN-UP-1010 ');`,
    );
    await assert.rejects(db.exec(migration), /Duplicate profile serials require manual review/);
    await db.exec('ROLLBACK');
    const { rows } = await db.query('SELECT serial_no FROM profiles ORDER BY id');
    assert.deepEqual(
      rows.map((r: any) => r.serial_no),
      ['SN-UP-1010', ' SN-UP-1010 '],
    );
  } finally {
    await db.close();
  }
});

test('profile integrity SQL: database serials, concurrent inserts, immutable identity, explicit review and durable audit', async () => {
  const db = await database();
  const identity = validateIdentityInput(identityTestInput()).identity!;
  try {
    await db.exec(`INSERT INTO profiles(id,user_key,serial_no,role,profile_data) VALUES
      ('admin','admin','SN-UP-1010','admin','{}'),
      ('legacy','legacy','SN-UP-1001','agent','{"legalProofDoc":{"verified":true,"name":"legacy.pdf"}}');`);
    const before = (await db.query('SELECT * FROM profiles ORDER BY id')).rows;
    await db.exec(migration);
    assert.deepEqual(
      (await db.query('SELECT * FROM profiles ORDER BY id')).rows,
      before,
      'migration must not rewrite legacy data',
    );
    const inserted = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        db.query<any>(
          `INSERT INTO profiles(id,user_key,serial_no,role,profile_data) VALUES ($1,$1,'SN-UP-999999','agent',$2) RETURNING *`,
          [
            `new_${index}`,
            JSON.stringify({
              ...identity,
              legalProofDoc: {
                ...identity.legalProofDoc,
                verified: true,
                verifiedBy: 'forged',
                verificationVersion: 1,
              },
            }),
          ],
        ),
      ),
    );
    const serials = inserted.map((r) => r.rows[0].serial_no);
    assert.equal(new Set(serials).size, 20);
    assert.equal(serials[0], 'SN-UP-1011');
    assert.equal(serials.at(-1), 'SN-UP-1030');
    assert.equal(inserted[0].rows[0].profile_data.legalProofDoc.verified, false);
    assert.equal(inserted[0].rows[0].profile_data.legalProofDoc.verifiedBy, undefined);
    assert.equal(inserted[0].rows[0].profile_data.serialNo, serials[0]);
    await assert.rejects(
      db.exec(`UPDATE profiles SET serial_no='SN-UP-9000' WHERE user_key='new_0'`),
      /cannot be changed/,
    );
    await db.exec(
      `UPDATE profiles SET profile_data = profile_data || '{"serialNo":"SN-UP-FORGED"}' WHERE user_key='new_0'`,
    );
    assert.equal(
      (
        await db.query<any>(
          `SELECT profile_data->>'serialNo' AS serial FROM profiles WHERE user_key='new_0'`,
        )
      ).rows[0].serial,
      serials[0],
    );
    await db.exec(`DELETE FROM profiles WHERE user_key='new_19';`);
    await db.exec(migration); // Rerun must not reuse the deleted highest allocated serial.
    assert.equal(
      (
        await db.query<any>(
          `INSERT INTO profiles(id,user_key) VALUES ('after','after') RETURNING serial_no`,
        )
      ).rows[0].serial_no,
      'SN-UP-1031',
    );
    // Upserts for operational/biometric state keep serials and cannot forge compliance metadata.
    await db.query(
      `INSERT INTO profiles(id,user_key,serial_no,profile_data) VALUES ('new_0','new_0','SN-UP-7777',$1)
      ON CONFLICT(user_key) DO UPDATE SET serial_no=EXCLUDED.serial_no, profile_data=EXCLUDED.profile_data`,
      [JSON.stringify({ legalProofDoc: { verified: true } })],
    );
    assert.equal(
      (await db.query<any>(`SELECT serial_no FROM profiles WHERE user_key='new_0'`)).rows[0]
        .serial_no,
      serials[0],
    );

    const row = async (key = 'legacy') =>
      (await db.query<any>('SELECT * FROM profiles WHERE user_key=$1', [key])).rows[0];
    const review = async (
      action: string,
      actor = 'admin',
      expected?: string,
      input?: any,
      key = 'legacy',
    ) => {
      const version = expected || (await row(key)).updated_at;
      return (
        await db.query<any>('SELECT public.review_profile_identity($1,$2,$3,$4,$5) AS result', [
          key,
          actor,
          version,
          action,
          input || null,
        ])
      ).rows[0].result;
    };
    await assert.rejects(review('verify'), /Legacy or incomplete evidence/);
    await assert.rejects(
      review('replace', 'legacy', undefined, identity),
      /Only a super administrator/,
    );
    await assert.rejects(
      review('replace', 'admin', '2000-01-01T00:00:00Z', identity),
      /Profile changed/,
    );
    const updated = await review('replace', 'admin', undefined, identity);
    assert.equal(updated.profile_data.legalProofDoc.verified, false);
    const verified = await review('verify');
    assert.equal(verified.profile_data.legalProofDoc.verified, true);
    assert.equal(verified.profile_data.legalProofDoc.verifiedBy, 'admin');
    assert.ok(Date.parse(verified.profile_data.legalProofDoc.verifiedAt));
    assert.equal(verified.serial_no, 'SN-UP-1001');
    await assert.rejects(
      review('verify', 'admin', undefined, null, 'admin'),
      /cannot verify your own/,
    );
    // Operational writes cannot overwrite the authorized verification or identity details.
    await db.query(
      `UPDATE profiles SET address='Forged address', legal_proof_number='FAKE', profile_data=$1 WHERE user_key='legacy'`,
      [JSON.stringify({ ...identity, legalProofDoc: { verified: false }, onDuty: true })],
    );
    const protectedRow = await row();
    assert.equal(protectedRow.address, identity.address);
    assert.equal(protectedRow.legal_proof_number, identity.legalProofNumber);
    assert.equal(protectedRow.profile_data.legalProofDoc.verifiedBy, 'admin');
    assert.equal(protectedRow.profile_data.onDuty, true);
    const replaced = await review('replace', 'admin', undefined, identity);
    assert.equal(replaced.profile_data.legalProofDoc.verified, false);
    assert.equal(replaced.profile_data.legalProofDoc.verifiedBy, undefined);
    const audits = (
      await db.query<any>('SELECT * FROM profile_identity_audits ORDER BY created_at')
    ).rows;
    assert.equal(audits.length, 3);
    assert.equal(audits[0].previous_identity.legalProofDoc.name, 'legacy.pdf');
    assert.equal(audits[2].previous_identity.legalProofDoc.verifiedBy, 'admin');
    assert.ok(audits.every((entry) => entry.actor_user_key === 'admin'));
    const permissions = (
      await db.query<any>(`SELECT
      has_function_privilege('authenticated', 'public.review_profile_identity(text,text,timestamptz,text,jsonb)', 'EXECUTE') AS browser,
      has_table_privilege('authenticated', 'public.profile_identity_audits', 'SELECT') AS audit_read,
      has_table_privilege('service_role', 'public.profile_identity_audits', 'DELETE') AS audit_delete,
      has_function_privilege('service_role', 'public.review_profile_identity(text,text,timestamptz,text,jsonb)', 'EXECUTE') AS server`)
    ).rows[0];
    assert.deepEqual(permissions, {
      browser: false,
      audit_read: false,
      audit_delete: false,
      server: true,
    });
  } finally {
    await db.close();
  }
});
