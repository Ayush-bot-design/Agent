import crypto from 'node:crypto';

export const SOFTWARE_LINK_TTL_MS = 5 * 60 * 1000;
export const MAX_SOFTWARE_FILE_BYTES = 1024 * 1024 * 1024;
const GOOGLE_DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const TOKEN_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/;
const HUMAN_TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SOFTWARE_PAIR_QR_PREFIX = 'AETHER-SOFTWARE-PAIR:';
const SOFTWARE_PAIR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3/files/';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class SoftwareDeliveryError extends Error {
  constructor(
    message: string,
    public statusCode = 503,
  ) {
    super(message);
    this.name = 'SoftwareDeliveryError';
  }
}

export interface GoogleDriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
  type?: string;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** Accept only a Google Drive file URL and return its opaque file ID. */
export function parseGoogleDriveFileId(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;
  try {
    const url = new URL(rawUrl.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'drive.google.com' ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const filePathMatch = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
    const fileId = filePathMatch?.[1] || url.searchParams.get('id') || '';
    return GOOGLE_DRIVE_ID_PATTERN.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
}

export function createSoftwareDownloadToken(): string {
  const bytes = crypto.randomBytes(10);
  let accumulator = 0;
  let bits = 0;
  let token = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      token += HUMAN_TOKEN_ALPHABET[(accumulator >> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  return token;
}

export function isSoftwareDownloadToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

export function hashSoftwareDownloadToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Strong, opaque challenge scanned only from a signed-in agent app. */
export function createSoftwarePairingToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function isSoftwarePairingToken(token: unknown): token is string {
  return typeof token === 'string' && SOFTWARE_PAIR_TOKEN_PATTERN.test(token);
}

export function safeAttachmentName(name: string): { ascii: string; encoded: string } {
  const clean =
    name
      .replace(/[\r\n\0]/g, '')
      .replace(/[\\/]/g, '_')
      .trim()
      .slice(0, 180) || 'software-installer';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/[";]/g, '_');
  return {
    ascii,
    encoded: encodeURIComponent(clean).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  };
}

/** Server-only Drive REST client using a read-only service-account scope. */
export class GoogleDriveSoftwareClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.env = options.env || process.env;
  }

  isConfigured(): boolean {
    return Boolean(this.credentials());
  }

  serviceAccountEmail(): string | null {
    return this.credentials()?.client_email || null;
  }

  private credentials(): ServiceAccountCredentials | null {
    const raw = (this.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ServiceAccountCredentials;
      if (
        parsed.type !== 'service_account' ||
        typeof parsed.client_email !== 'string' ||
        !parsed.client_email.includes('@') ||
        typeof parsed.private_key !== 'string' ||
        !parsed.private_key.includes('PRIVATE KEY')
      ) {
        return null;
      }
      const privateKey = parsed.private_key.replace(/\\n/g, '\n');
      crypto.createPrivateKey(privateKey);
      return { ...parsed, private_key: privateKey };
    } catch {
      return null;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const credentials = this.credentials();
    if (!credentials) {
      throw new SoftwareDeliveryError(
        'Google Drive service-account credentials are not configured on the server.',
        503,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signingInput = `${header}.${claims}`;
    let signature: string;
    try {
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signingInput);
      signer.end();
      signature = signer.sign(credentials.private_key, 'base64url');
    } catch {
      throw new SoftwareDeliveryError('Google Drive service-account key is invalid.', 503);
    }

    const assertion = `${signingInput}.${signature}`;
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SoftwareDeliveryError('Google Drive authentication failed on the server.', 503);
    }
    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new SoftwareDeliveryError('Google Drive did not issue a server access token.', 503);
    }
    this.accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    this.tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return this.accessToken;
  }

  async getFileMetadata(fileId: string): Promise<GoogleDriveFileMetadata> {
    if (!GOOGLE_DRIVE_ID_PATTERN.test(fileId)) {
      throw new SoftwareDeliveryError('The Google Drive file ID is invalid.', 400);
    }
    const accessToken = await this.getAccessToken();
    const url = new URL(`${DRIVE_API_ROOT}${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', 'id,name,mimeType,size');
    url.searchParams.set('supportsAllDrives', 'true');
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SoftwareDeliveryError(
        response.status === 404 || response.status === 403
          ? 'The Drive file is unavailable to the configured service account. Share it with that account and try again.'
          : 'Could not verify the Google Drive file.',
        response.status === 404 || response.status === 403 ? 400 : 503,
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    const sizeBytes = Number(data.size);
    if (
      data.id !== fileId ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      typeof data.mimeType !== 'string' ||
      data.mimeType.startsWith('application/vnd.google-apps.') ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > MAX_SOFTWARE_FILE_BYTES
    ) {
      throw new SoftwareDeliveryError(
        'The Drive item must be a downloadable file no larger than 1 GB.',
        400,
      );
    }
    return { id: fileId, name: data.name.trim().slice(0, 180), mimeType: data.mimeType, sizeBytes };
  }

  async downloadFile(fileId: string): Promise<Response> {
    if (!GOOGLE_DRIVE_ID_PATTERN.test(fileId)) {
      throw new SoftwareDeliveryError('The Google Drive file ID is invalid.', 400);
    }
    const accessToken = await this.getAccessToken();
    const url = new URL(`${DRIVE_API_ROOT}${encodeURIComponent(fileId)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('supportsAllDrives', 'true');
    const controller = new AbortController();
    const responseHeaderTimeout = setTimeout(() => controller.abort(), 60_000);
    responseHeaderTimeout.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(responseHeaderTimeout);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new SoftwareDeliveryError('The software file could not be downloaded from Drive.', 502);
    }
    return response;
  }
}
