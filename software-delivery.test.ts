import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  GoogleDriveSoftwareClient,
  SoftwareDeliveryError,
  createSoftwareDownloadToken,
  createSoftwarePairingToken,
  hashSoftwareDownloadToken,
  isSoftwareDownloadToken,
  isSoftwarePairingToken,
  parseGoogleDriveFileId,
  safeAttachmentName,
} from './software-delivery.ts';

const validFileId = '1AaBbCcDdEeFfGgHhIiJjKk';

test('accepts only secure Google Drive file links and extracts file IDs', () => {
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com/file/d/${validFileId}/view?usp=sharing`),
    validFileId,
  );
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com/open?id=${validFileId}`),
    validFileId,
  );
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com/uc?export=download&id=${validFileId}`),
    validFileId,
  );
  assert.equal(
    parseGoogleDriveFileId('https://drive.google.com/drive/folders/1AaBbCcDdEeFfGgHhIiJjKk'),
    null,
  );
  assert.equal(
    parseGoogleDriveFileId('https://docs.google.com/document/d/1AaBbCcDdEeFfGgHhIiJjKk/edit'),
    null,
  );
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com.attacker.example/file/d/${validFileId}/view`),
    null,
  );
  assert.equal(parseGoogleDriveFileId(`http://drive.google.com/file/d/${validFileId}/view`), null);
  assert.equal(
    parseGoogleDriveFileId(`https://drive.google.com:444/file/d/${validFileId}/view`),
    null,
  );
  assert.equal(parseGoogleDriveFileId('not a URL'), null);
});

test('software download codes are random opaque values and only their SHA-256 hashes are stored', () => {
  const codes = new Set(Array.from({ length: 100 }, () => createSoftwareDownloadToken()));
  assert.equal(codes.size, 100);
  for (const code of codes) {
    assert.equal(isSoftwareDownloadToken(code), true);
    assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/);
    assert.match(hashSoftwareDownloadToken(code), /^[0-9a-f]{64}$/);
    assert.notEqual(hashSoftwareDownloadToken(code), code);
  }
  assert.equal(isSoftwareDownloadToken('short'), false);
  assert.equal(isSoftwareDownloadToken('0123456789ABCDEF'), true);
});

test('QR handoff tokens have high entropy and validate only the opaque QR payload token', () => {
  const token = createSoftwarePairingToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isSoftwarePairingToken(token), true);
  assert.equal(isSoftwarePairingToken(`${token}x`), false);
  assert.equal(isSoftwarePairingToken('AETHER-SOFTWARE-PAIR:abcd'), false);
});

test('attachment filenames are safe for Content-Disposition headers', () => {
  const filename = safeAttachmentName('../Installer\r\n.exe');
  assert.equal(filename.ascii, '.._Installer.exe');
  assert.equal(filename.encoded.includes('%0D'), false);
  assert.equal(filename.encoded.includes('%0A'), false);
});

test('Google Drive client fails closed when service-account credentials are missing or malformed', async () => {
  const missing = new GoogleDriveSoftwareClient({ env: {} });
  assert.equal(missing.isConfigured(), false);
  await assert.rejects(missing.getFileMetadata(validFileId), (error: any) => {
    assert.ok(error instanceof SoftwareDeliveryError);
    assert.equal(error.statusCode, 503);
    return /credentials are not configured/.test(error.message);
  });

  const malformed = new GoogleDriveSoftwareClient({
    env: { GOOGLE_SERVICE_ACCOUNT_JSON: '{bad json' },
  });
  assert.equal(malformed.isConfigured(), false);
});

test('Google Drive client exchanges a read-only service-account assertion and fetches private file metadata', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceEmail = 'drive-reader@example.iam.gserviceaccount.com';
  const serviceJson = JSON.stringify({
    type: 'service_account',
    client_email: serviceEmail,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const calls: { url: string; headers?: HeadersInit; body?: BodyInit | null }[] = [];
  const fakeFetch: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, headers: init.headers, body: init.body });
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion = form.get('assertion') || '';
      const [header, claims, signature] = assertion.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
        alg: 'RS256',
        typ: 'JWT',
      });
      const parsedClaims = JSON.parse(Buffer.from(claims, 'base64url').toString());
      assert.equal(parsedClaims.iss, serviceEmail);
      assert.equal(parsedClaims.scope, 'https://www.googleapis.com/auth/drive.readonly');
      assert.equal(
        crypto.verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${claims}`),
          crypto.createPublicKey(privateKey),
          Buffer.from(signature, 'base64url'),
        ),
        true,
      );
      return Response.json({ access_token: 'server-only-access-token', expires_in: 3600 });
    }
    assert.match(url, new RegExp(`/drive/v3/files/${validFileId}\\?`));
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer server-only-access-token');
    return Response.json({
      id: validFileId,
      name: 'TenderSetup.exe',
      mimeType: 'application/octet-stream',
      size: '1234',
    });
  };

  const client = new GoogleDriveSoftwareClient({
    fetch: fakeFetch,
    env: { GOOGLE_SERVICE_ACCOUNT_JSON: serviceJson },
  });
  assert.equal(client.isConfigured(), true);
  assert.equal(client.serviceAccountEmail(), serviceEmail);
  assert.deepEqual(await client.getFileMetadata(validFileId), {
    id: validFileId,
    name: 'TenderSetup.exe',
    mimeType: 'application/octet-stream',
    sizeBytes: 1234,
  });
  assert.equal(calls.length, 2);
});

test('Google Drive client rejects native Google documents and oversized files', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceJson = JSON.stringify({
    type: 'service_account',
    client_email: 'drive-reader@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  let metadata: Record<string, unknown> = {
    id: validFileId,
    name: 'Google Doc',
    mimeType: 'application/vnd.google-apps.document',
    size: '10',
  };
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'token', expires_in: 3600 });
    }
    return Response.json(metadata);
  };
  const client = new GoogleDriveSoftwareClient({
    fetch: fakeFetch,
    env: { GOOGLE_SERVICE_ACCOUNT_JSON: serviceJson },
  });
  await assert.rejects(client.getFileMetadata(validFileId), /downloadable file/);
  metadata = {
    id: validFileId,
    name: 'Huge installer',
    mimeType: 'application/octet-stream',
    size: String(1024 * 1024 * 1024 + 1),
  };
  await assert.rejects(client.getFileMetadata(validFileId), /no larger than 1 GB/);
});
