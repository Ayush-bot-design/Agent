import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const phase3 = await readFile(
  new URL('20261116000005_reservation_and_directory_efficiency.sql', migrations),
  'utf8',
);
const pauseMigration = await readFile(
  new URL('20261116000006_site_pause_resume.sql', migrations),
  'utf8',
);
const timestampMigration = await readFile(
  new URL('20261107000002_auto_expire_reservations_24h.sql', migrations),
  'utf8',
);

for (const idType of ['text', 'uuid', 'legacy'])
  test(`site pause SQL (${idType}): ownership, preserved evidence, free next site, original-agent resume, fresh SLA, durable atomic audit and stale-write protection`, async () => {
    const db = new PGlite();
    const id = (n: number) =>
      idType === 'text' ? `site-${n}` : `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE profiles(user_key text PRIMARY KEY,role text,full_name text,serial_no text,user_id uuid DEFAULT gen_random_uuid());
      INSERT INTO profiles(user_key,role,full_name,serial_no) VALUES('agent','agent','Same Name','SN-UP-1001'),('other','agent','Same Name','SN-UP-1002'),('admin','admin','Admin','SN-UP-1003'),('sub','sub_admin','Sub','SN-UP-1004');
      CREATE TABLE sites(id ${idType === 'legacy' ? 'text' : idType} PRIMARY KEY,site_code text,status text,assigned_user_id text,assigned_auth_user_id uuid,
        reserved_at timestamptz,updated_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),
        site_data jsonb DEFAULT '{}',client_name text,location text,district text);
      CREATE UNIQUE INDEX idx_sites_one_active_per_user ON sites(assigned_user_id) WHERE status IN ('reserved','in_progress') AND assigned_user_id IS NOT NULL;
      CREATE TABLE face_templates(user_key text PRIMARY KEY,embedding jsonb,photo_thumbnail text);
      CREATE TABLE activity_logs(id uuid DEFAULT gen_random_uuid(),event_type text,actor_username text,actor_role text,site_id text,
        site_code text,site_name text,district text,previous_status text,new_status text,description text,metadata jsonb,created_at timestamptz DEFAULT now());`);
      // Install the production reservation timestamp trigger too, not just a minimal substitute.
      const start = timestampMigration.indexOf(
        'CREATE OR REPLACE FUNCTION public.handle_sites_reservation_timestamps()',
      );
      const end = timestampMigration.indexOf('-- 4. RPC');
      await db.exec(timestampMigration.slice(start, end));
      await db.exec(phase3);
      if (idType === 'legacy')
        await db.exec(`
        ALTER TABLE sites ADD CONSTRAINT sites_status_check CHECK(status IN ('available','in_progress','completed'));
        ALTER TABLE sites ADD COLUMN reserved_by_user text, ADD COLUMN reserved_by_name text,
          ADD COLUMN assigned_to_user text, ADD COLUMN assigned_agent text, ADD COLUMN started_at timestamptz,
          ADD COLUMN biometric_arrival_verification jsonb;
        CREATE UNIQUE INDEX legacy_active_owner ON sites(reserved_by_user) WHERE status='in_progress';
        -- Model Glassauth's existing hook: legacy owner precedence, old-start coalescing,
        -- and JSON evidence removal on Available. The migration must preserve its body.
        CREATE OR REPLACE FUNCTION handle_sites_reservation_timestamps() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE v_old_start timestamptz; BEGIN
          IF TG_OP='UPDATE' THEN v_old_start:=OLD.started_at; END IF;
          IF NEW.status='in_progress' THEN
            NEW.reserved_by_user:=coalesce(NEW.reserved_by_user,NEW.assigned_user_id,NEW.assigned_to_user);
            NEW.assigned_user_id:=NEW.reserved_by_user;
            NEW.started_at:=coalesce(NEW.started_at,v_old_start,NEW.reserved_at,now()); NEW.reserved_at:=NEW.started_at;
            NEW.site_data:=NEW.site_data || jsonb_build_object('startedAt',NEW.started_at,'reservedByUser',NEW.reserved_by_user);
          ELSIF NEW.status='available' THEN
            NEW.reserved_by_user:=NULL; NEW.assigned_user_id:=NULL; NEW.started_at:=NULL; NEW.reserved_at:=NULL;
            NEW.biometric_arrival_verification:=NULL;
            NEW.site_data:=NEW.site_data - 'biometricArrivalVerification' - 'startedAt' - 'reservedByUser';
          END IF;
          NEW.updated_at:=now(); RETURN NEW;
        END $$;
      `);
      await db.exec(pauseMigration);
      await db.exec(pauseMigration);
      const work = {
        status: 'in_progress',
        reservedByUser: 'agent',
        reservedByName: 'Same Name',
        startedAt: '2026-01-01',
        computerCount: 2,
        milestones: [{ id: 'install', completed: true }],
        hostnameVerifications: [{ verified: true, verifiedByUser: 'agent', hostname: 'KEEP' }],
        documents: [{ id: 'certificate', storagePath: 'private/path' }],
        additionalComputers: [{ remark: 'Do not lose' }],
        biometricArrivalVerification: { verified: true, verificationId: 'BIO-KEEP' },
      };
      await db.query(
        `INSERT INTO sites(id,status,assigned_user_id,reserved_at,site_data) VALUES($1,'in_progress','agent',now()-interval '1 hour',$2)`,
        [id(1), JSON.stringify(work)],
      );
      await db.query(`INSERT INTO sites(id,status,site_data) VALUES($1,'available','{}')`, [id(2)]);
      const transition = async (
        siteId: string,
        actor: string,
        action: string,
        version: number,
        reason = 'office_closed',
        remark = 'Office unexpectedly closed today',
      ) =>
        (
          await db.query<any>('SELECT transition_site_pause($1,$2,$3,$4,$5,$6) AS result', [
            siteId,
            actor,
            action,
            version,
            reason,
            remark,
          ])
        ).rows[0].result;
      await assert.rejects(transition(id(1), 'other', 'pause', 0), /currently assigned/);
      await assert.rejects(transition(id(1), 'agent', 'pause', 0, 'invalid'), /valid pause reason/);
      await assert.rejects(
        transition(id(1), 'agent', 'pause', 0, 'office_closed', 'short'),
        /10–500/,
      );
      const paused = await transition(id(1), 'agent', 'pause', 0);
      assert.equal(paused.status, 'pending');
      assert.equal(paused.workflow_version, 1);
      assert.equal(paused.assigned_user_id, null);
      assert.equal(paused.reserved_at, null);
      if (idType === 'legacy') {
        assert.equal(paused.reserved_by_user, null);
        assert.equal(paused.started_at, null);
      }
      assert.equal(paused.pending_issue.agentUserKey, 'agent');
      assert.equal(paused.pending_issue.serialNo, 'SN-UP-1001');
      for (const key of [
        'milestones',
        'hostnameVerifications',
        'documents',
        'additionalComputers',
        'biometricArrivalVerification',
      ])
        assert.deepEqual(paused.site_data[key], (work as any)[key]);
      assert.equal(
        (await db.query<any>('SELECT count(*)::int AS count FROM activity_logs')).rows[0].count,
        1,
        'no duplicate status-trigger event',
      );
      // No 24-hour or retry-time reopening, even when legacy timestamps are very old.
      await db.exec(
        `BEGIN; UPDATE sites SET updated_at=now()-interval '60 days' WHERE status='pending';`,
      );
      assert.equal(
        (await db.query<any>('SELECT release_expired_site_reservations(24) AS count')).rows[0]
          .count,
        0,
      );
      await db.exec('COMMIT');
      assert.equal(
        (await db.query<any>('SELECT status FROM sites WHERE id=$1', [id(1)])).rows[0].status,
        'pending',
      );
      // A new claim is free to use the slot immediately; resuming is blocked until it is finished/paused.
      await db.query(
        `UPDATE sites SET status='in_progress',assigned_user_id='agent',reserved_at=now() WHERE id=$1`,
        [id(2)],
      );
      await assert.rejects(transition(id(1), 'agent', 'resume', 1), /other active site/);
      await assert.rejects(transition(id(1), 'other', 'resume', 1), /original agent/);
      await db.exec(
        `UPDATE profiles SET user_id='00000000-0000-4000-a000-000000000099' WHERE user_key='agent'`,
      );
      await assert.rejects(transition(id(1), 'agent', 'resume', 1), /original agent/);
      await db.query(`UPDATE profiles SET user_id=$1 WHERE user_key='agent'`, [
        paused.pending_issue.agentUserId,
      ]);

      await assert.rejects(transition(id(1), 'admin', 'resume', 1), /original agent/);
      await assert.rejects(transition(id(1), 'sub', 'recover', 1), /not authorized/);
      await assert.rejects(
        db.query(`UPDATE sites SET status='available',assigned_user_id='other' WHERE id=$1`, [
          id(1),
        ]),
        /protected/,
      );
      await assert.rejects(db.query(`DELETE FROM sites WHERE id=$1`, [id(1)]), /Recover/);
      await db.query(
        `UPDATE sites SET site_data=site_data || '{"biometricArrivalVerification":{"verificationId":"BIO-RECOVER"}}'::jsonb WHERE id=$1`,
        [id(2)],
      );
      await transition(
        id(2),
        'agent',
        'pause',
        0,
        'power_network',
        'Network is down at second office',
      );
      const resumed = await transition(id(1), 'agent', 'resume', 1);
      assert.equal(resumed.status, 'in_progress');
      assert.equal(resumed.workflow_version, 2);
      assert.equal(resumed.pending_issue, null);
      assert.equal(resumed.assigned_user_id, 'agent');
      assert.ok(Date.parse(resumed.reserved_at) > Date.now() - 5000);
      assert.ok(Date.parse(resumed.site_data.startedAt) > Date.now() - 5000);
      assert.deepEqual(resumed.site_data.hostnameVerifications, work.hostnameVerifications);
      await assert.rejects(transition(id(1), 'agent', 'resume', 1), /changed/);
      await assert.rejects(
        db.query(`UPDATE sites SET workflow_version=0,site_data='{}' WHERE id=$1`, [id(1)]),
        /pause state changed/,
      );
      // Server-owned metadata in JSON cannot be forged through a normal update.
      await db.query(
        `UPDATE sites SET site_data=site_data || '{"pendingIssue":{"agentUserKey":"other"},"workflowVersion":99}'::jsonb WHERE id=$1`,
        [id(1)],
      );
      const canonical = (await db.query<any>('SELECT site_data FROM sites WHERE id=$1', [id(1)]))
        .rows[0].site_data;
      assert.equal(canonical.pendingIssue, undefined);
      assert.equal(canonical.workflowVersion, 2);
      const recovered = await transition(
        id(2),
        'admin',
        'recover',
        1,
        '',
        'Original technician cannot return',
      );
      assert.equal(recovered.status, 'available');
      assert.equal(recovered.site_data.biometricArrivalVerification.verificationId, 'BIO-RECOVER');
      assert.equal(recovered.workflow_version, 2);
      assert.deepEqual(recovered.site_data.additionalComputers, undefined);
      const events = (
        await db.query<any>('SELECT * FROM site_pause_events ORDER BY occurred_at,id')
      ).rows;
      assert.equal(events.length, 4);
      assert.equal(events[0].actor_serial, 'SN-UP-1001');
      assert.deepEqual(
        events[0].work_snapshot.site_data.hostnameVerifications,
        work.hostnameVerifications,
      );
      // A failing audit must roll back release of the active slot and all status/data changes.
      await db.exec(`CREATE FUNCTION reject_pause_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit failed'; END $$;
      CREATE TRIGGER reject_pause_audit BEFORE INSERT ON site_pause_events FOR EACH ROW EXECUTE FUNCTION reject_pause_audit();`);
      await assert.rejects(transition(id(1), 'agent', 'pause', 2), /Audit failed/);
      const unchanged = (
        await db.query<any>('SELECT status,workflow_version FROM sites WHERE id=$1', [id(1)])
      ).rows[0];
      assert.deepEqual(unchanged, { status: 'in_progress', workflow_version: 2 });
      assert.equal(
        (await db.query<any>('SELECT count(*)::int AS count FROM site_pause_events')).rows[0].count,
        4,
      );
      for (const role of ['anon', 'authenticated']) {
        assert.equal(
          (
            await db.query<any>(
              `SELECT has_function_privilege($1,'transition_site_pause(text,text,text,bigint,text,text)','EXECUTE') AS allowed`,
              [role],
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await db.query<any>(
              `SELECT has_table_privilege($1,'site_pause_events','SELECT') AS allowed`,
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      }
      assert.equal(
        (
          await db.query<any>(
            `SELECT has_table_privilege('service_role','site_pause_events','DELETE') AS allowed`,
          )
        ).rows[0].allowed,
        false,
      );
    } finally {
      await db.close();
    }
  });
