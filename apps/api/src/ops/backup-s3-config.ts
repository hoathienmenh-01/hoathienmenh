/**
 * Phase 17.2 — Offsite S3 backup config parser/validator.
 *
 * Pure-function helper, KHÔNG import Nest/Prisma/DB. Dùng cho:
 *   - `scripts/backup-to-s3.sh` (eval qua `node -e` hoặc shell-source riêng).
 *   - `scripts/restore-verify-weekly.sh` (cùng config + verify temp DB name).
 *   - Unit test pure-logic không cần boot app.
 *
 * Env vars (xem `apps/api/.env.example` Phase 17.2):
 *   - BACKUP_S3_ENDPOINT
 *   - BACKUP_S3_REGION                  default us-east-1
 *   - BACKUP_S3_BUCKET
 *   - BACKUP_S3_PREFIX                  default xuantoi/backups/
 *   - BACKUP_S3_ACCESS_KEY_ID
 *   - BACKUP_S3_SECRET_ACCESS_KEY
 *   - BACKUP_S3_FORCE_PATH_STYLE        default 1
 *   - BACKUP_S3_SSE                     optional AES256 / aws:kms
 *   - BACKUP_VERIFY_TMP_DB              default xuantoi_verify
 *   - BACKUP_VERIFY_TMP_RETAIN          default 0
 *   - BACKUP_RETENTION_DAYS             default 0 (shared với backup-db.sh)
 *
 * Lock-in invariants (xem test):
 *   1. Bucket+credential thiếu → `parseBackupS3Config` trả `{ ok: false }` kèm
 *      `missing: string[]` để script log từng env tên thiếu.
 *   2. `forcePathStyle` parse `1/0/true/false/yes/no` case-insensitive, default `true`.
 *   3. `prefix` luôn kết thúc bằng `/` (script đoán đường dẫn không cần concat thủ công).
 *   4. `prefix` empty string trong env → default `xuantoi/backups/`, KHÔNG dùng empty.
 *   5. `region` default `us-east-1` khi không set (aws CLI yêu cầu region).
 *   6. `sse` chỉ nhận `AES256` hoặc `aws:kms` (case-insensitive); giá trị khác →
 *      `parseBackupS3Config` trả invalid kèm tên field.
 *   7. `verifyTmpDb` reject ký tự ngoài [A-Za-z0-9_] để tránh SQL injection
 *      khi script chạy `CREATE DATABASE`. Default `xuantoi_verify`.
 *   8. `retentionDays` parse số nguyên ≥ 0, NaN/string → invalid.
 */

export interface BackupS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  sse: 'AES256' | 'aws:kms' | null;
  verifyTmpDb: string;
  verifyTmpRetain: boolean;
  retentionDays: number;
}

export interface BackupS3ParseResult {
  ok: boolean;
  config?: BackupS3Config;
  /** Tên các env vars bắt buộc nhưng trống. */
  missing: string[];
  /** Lỗi semantic (vd SSE value sai, verifyTmpDb có ký tự xấu, retentionDays NaN). */
  invalid: string[];
}

export const REQUIRED_S3_KEYS = [
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
] as const;

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.toLowerCase().trim();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return fallback;
}

function normalizePrefix(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  const p = trimmed === '' ? 'xuantoi/backups/' : trimmed;
  return p.endsWith('/') ? p : `${p}/`;
}

function parseSse(
  raw: string | undefined,
): { ok: true; value: BackupS3Config['sse'] } | { ok: false } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: null };
  const lower = trimmed.toLowerCase();
  if (lower === 'aes256') return { ok: true, value: 'AES256' };
  if (lower === 'aws:kms') return { ok: true, value: 'aws:kms' };
  return { ok: false };
}

/** Tên DB an toàn cho `CREATE DATABASE` raw SQL. */
const DB_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function parseInteger(
  raw: string | undefined,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (raw === undefined || raw === '') return { ok: true, value: fallback };
  if (!/^-?\d+$/.test(raw.trim())) return { ok: false };
  return { ok: true, value: Number.parseInt(raw, 10) };
}

/**
 * Parse + validate env vars. Trả `{ ok, config?, missing, invalid }` thuần
 * data — caller (script) tự log + exit code.
 */
export function parseBackupS3Config(
  env: NodeJS.ProcessEnv = process.env,
): BackupS3ParseResult {
  const missing: string[] = [];
  for (const key of REQUIRED_S3_KEYS) {
    const v = (env[key] ?? '').trim();
    if (v === '') missing.push(key);
  }

  const invalid: string[] = [];
  const sseRes = parseSse(env.BACKUP_S3_SSE);
  if (!sseRes.ok) invalid.push('BACKUP_S3_SSE');

  const verifyTmpDb = (env.BACKUP_VERIFY_TMP_DB ?? '').trim() || 'xuantoi_verify';
  if (!DB_NAME_PATTERN.test(verifyTmpDb)) {
    invalid.push('BACKUP_VERIFY_TMP_DB');
  }

  const retentionRes = parseInteger(env.BACKUP_RETENTION_DAYS, 0);
  if (!retentionRes.ok) invalid.push('BACKUP_RETENTION_DAYS');
  else if (retentionRes.ok && retentionRes.value < 0) invalid.push('BACKUP_RETENTION_DAYS');

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, missing, invalid };
  }

  return {
    ok: true,
    config: {
      endpoint: (env.BACKUP_S3_ENDPOINT as string).trim(),
      region: (env.BACKUP_S3_REGION ?? '').trim() || 'us-east-1',
      bucket: (env.BACKUP_S3_BUCKET as string).trim(),
      prefix: normalizePrefix(env.BACKUP_S3_PREFIX),
      accessKeyId: (env.BACKUP_S3_ACCESS_KEY_ID as string).trim(),
      secretAccessKey: (env.BACKUP_S3_SECRET_ACCESS_KEY as string).trim(),
      forcePathStyle: parseBool(env.BACKUP_S3_FORCE_PATH_STYLE, true),
      sse: sseRes.ok ? sseRes.value : null,
      verifyTmpDb,
      verifyTmpRetain: parseBool(env.BACKUP_VERIFY_TMP_RETAIN, false),
      retentionDays: retentionRes.ok ? retentionRes.value : 0,
    },
    missing,
    invalid,
  };
}

/**
 * Build `s3://bucket/prefix/key` URI từ config + key (filename). Không escape
 * key — caller phải đảm bảo key là filename hợp lệ (script chỉ truyền timestamp
 * filename do `backup-db.sh` sinh ra).
 */
export function s3Uri(config: BackupS3Config, key: string): string {
  const cleanKey = key.replace(/^\/+/, '');
  return `s3://${config.bucket}/${config.prefix}${cleanKey}`;
}

/**
 * Build aws CLI args common cho upload + download + ls. Không chứa command
 * (`s3 cp` / `s3 ls`) — caller append.
 *
 * Output ví dụ:
 *   ['--region', 'us-east-1', '--endpoint-url', 'https://s3.example.com',
 *    '--no-verify-ssl=false']
 */
export function awsCliCommonArgs(config: BackupS3Config): string[] {
  return [
    '--region',
    config.region,
    '--endpoint-url',
    config.endpoint,
  ];
}

/**
 * Build extra args cho `aws s3 cp upload` để bật server-side encryption.
 * Empty array nếu `sse` null.
 */
export function awsCliSseArgs(config: BackupS3Config): string[] {
  if (config.sse === null) return [];
  return ['--sse', config.sse];
}

/**
 * Mask `BACKUP_S3_SECRET_ACCESS_KEY` cho log. Giữ 4 ký tự đầu + cuối nếu length
 * ≥ 10; ngắn hơn → all-stars.
 */
export function maskSecret(secret: string): string {
  if (secret.length < 10) return '*'.repeat(secret.length);
  const head = secret.slice(0, 4);
  const tail = secret.slice(-2);
  return `${head}${'*'.repeat(Math.max(4, secret.length - 6))}${tail}`;
}
