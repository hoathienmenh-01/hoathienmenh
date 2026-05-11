/**
 * Phase 17.1 — Strict env validation schema (Deploy Verify Gate).
 *
 * Một nguồn sự thật duy nhất cho **production-required env**. Khi
 * `NODE_ENV=production`, server BẮT BUỘC pass schema này hoặc refuse boot.
 * Khi `NODE_ENV` không phải production → permissive (dev / test không bị
 * cản, dùng default an toàn).
 *
 * Nguyên tắc:
 *  - Strict ở production: thiếu env → fail-fast với message liệt kê đầy
 *    đủ tất cả env thiếu (KHÔNG fail từng env một → debug chậm).
 *  - Reject placeholder secret (`change-me-*` / `dev-*-secret` / default
 *    `xuantoi-default-ip-salt`) ở production → tránh deploy nhầm `.env.example`.
 *  - Reject `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` → 2 secret phải khác
 *    nhau để rotate độc lập (Compliance: SECURITY.md §2).
 *  - Tách rõ schema `productionEnvSchema` (strict) vs `devEnvSchema` (lax)
 *    để tests assert được behavior cả 2 môi trường.
 *
 * Sử dụng:
 *  - `parseEnv(process.env)` → trả về `ParsedEnv` (đã normalize) hoặc throw.
 *  - `assertProductionEnv(process.env)` → throw nếu production thiếu/bad,
 *    no-op khác.
 *
 * KHÔNG re-export `process.env` global — caller chịu trách nhiệm pass env.
 * Tránh side-effect import.
 */
import { z } from 'zod';

/**
 * JWT secret value mặc định "không-được-dùng-prod". Server sẽ throw khi
 * `NODE_ENV=production` và một trong các secret bằng giá trị này. Đồng bộ
 * với `apps/api/.env.example` placeholder + `apps/api/src/bootstrap-config.ts`.
 */
export const INSECURE_JWT_SECRETS: ReadonlySet<string> = new Set<string>([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'dev-access-secret',
  'dev-refresh-secret',
]);

/**
 * IP hash salt mặc định "không-được-dùng-prod". Xem
 * `apps/api/src/modules/security/ip-hash.service.ts` — production phải
 * override để hash IP unique theo cluster.
 */
export const INSECURE_IP_HASH_SALT = 'xuantoi-default-ip-salt';

/**
 * Min length cho mọi JWT secret production. ≥ 32 ký tự đủ entropy ngay
 * khi đó là alphanumeric (~190 bit). Recommend `openssl rand -base64 48`.
 */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Min length cho IP hash salt production. Cùng lý do entropy như JWT.
 */
export const MIN_IP_HASH_SALT_LENGTH = 32;

/** Tên các env critical cần present trong production. Dùng cho error message. */
export const CRITICAL_PRODUCTION_ENV = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CORS_ORIGINS',
  'SESSION_COOKIE_DOMAIN',
  'SECURITY_IP_HASH_SALT',
] as const;

const databaseUrlSchema = z
  .string()
  .min(1, 'DATABASE_URL trống')
  .refine(
    (v) =>
      v.startsWith('postgres://') ||
      v.startsWith('postgresql://'),
    'DATABASE_URL phải dùng scheme postgres:// hoặc postgresql://',
  );

const redisUrlSchema = z
  .string()
  .min(1, 'REDIS_URL trống')
  .refine(
    (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
    'REDIS_URL phải dùng scheme redis:// hoặc rediss:// (TLS)',
  );

const jwtSecretSchema = (name: string) =>
  z
    .string({ required_error: `${name} chưa được set` })
    .min(MIN_JWT_SECRET_LENGTH, `${name} phải ≥ ${MIN_JWT_SECRET_LENGTH} ký tự`)
    .refine(
      (v) => !INSECURE_JWT_SECRETS.has(v),
      `${name} đang dùng giá trị mặc định insecure (change-me-* / dev-*-secret) — sinh secret mới qua "openssl rand -base64 48"`,
    );

const corsOriginsSchema = z
  .string({ required_error: 'CORS_ORIGINS chưa được set (csv list)' })
  .min(1, 'CORS_ORIGINS trống')
  .refine(
    (v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean).length > 0,
    'CORS_ORIGINS phải có ≥ 1 origin sau khi parse csv',
  );

const ipHashSaltSchema = z
  .string({ required_error: 'SECURITY_IP_HASH_SALT chưa được set' })
  .min(
    MIN_IP_HASH_SALT_LENGTH,
    `SECURITY_IP_HASH_SALT phải ≥ ${MIN_IP_HASH_SALT_LENGTH} ký tự (sinh qua "openssl rand -base64 48")`,
  )
  .refine(
    (v) => v !== INSECURE_IP_HASH_SALT,
    'SECURITY_IP_HASH_SALT đang dùng giá trị mặc định insecure (xuantoi-default-ip-salt)',
  );

const sessionCookieDomainSchema = z
  .string({ required_error: 'SESSION_COOKIE_DOMAIN chưa được set' })
  .min(1, 'SESSION_COOKIE_DOMAIN trống');

const portSchema = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? Number(v) : 3000))
  .refine(
    (v) => Number.isFinite(v) && v > 0 && v < 65536,
    'PORT phải là số 1..65535',
  );

/**
 * Strict schema cho production. Mọi critical env phải present + đúng
 * format. Throw ZodError với issue list nếu fail.
 */
export const productionEnvSchema = z
  .object({
    NODE_ENV: z.literal('production'),
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    JWT_ACCESS_SECRET: jwtSecretSchema('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: jwtSecretSchema('JWT_REFRESH_SECRET'),
    CORS_ORIGINS: corsOriginsSchema,
    SESSION_COOKIE_DOMAIN: sessionCookieDomainSchema,
    SECURITY_IP_HASH_SALT: ipHashSaltSchema,
    PORT: portSchema,
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_REFRESH_SECRET phải khác JWT_ACCESS_SECRET — rotate độc lập',
      });
    }
  });

/**
 * Lax schema cho dev/test. KHÔNG cản start dù env trống — chỉ parse các
 * field optional để consumer ép kiểu an toàn (vd. PORT). Không reject
 * placeholder secret ở dev (dùng `.env.example` thẳng để chạy local).
 */
export const devEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .optional()
      .default('development'),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    CORS_ORIGINS: z.string().optional(),
    SESSION_COOKIE_DOMAIN: z.string().optional(),
    SECURITY_IP_HASH_SALT: z.string().optional(),
    PORT: portSchema,
  })
  .passthrough();

export type ParsedProductionEnv = z.infer<typeof productionEnvSchema>;
export type ParsedDevEnv = z.infer<typeof devEnvSchema>;
export type ParsedEnv = ParsedProductionEnv | ParsedDevEnv;

/**
 * Format ZodError thành 1 message multi-line dễ đọc, list mọi issue.
 * Tránh throw từng issue rời rạc → ops phải redeploy nhiều lần để fix
 * từng env một.
 */
export function formatEnvIssues(err: z.ZodError): string {
  const lines = err.issues.map((iss) => {
    const path = iss.path.length > 0 ? iss.path.join('.') : '(root)';
    return `  - ${path}: ${iss.message}`;
  });
  return `[xuantoi/api] Env validation FAILED (${err.issues.length} issue):\n${lines.join('\n')}`;
}

/**
 * Parse env dựa trên `NODE_ENV`. Production → strict; còn lại → lax.
 * Throw `Error` với message tổng hợp nếu fail.
 *
 * Nguyên tắc: KHÔNG fail dev/test → contributor chạy `pnpm test` không
 * cần set đủ env.
 */
export function parseEnv(
  env: NodeJS.ProcessEnv = process.env,
): ParsedEnv {
  const isProd = env.NODE_ENV === 'production';
  const schema = isProd ? productionEnvSchema : devEnvSchema;
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(formatEnvIssues(result.error));
  }
  return result.data;
}

/**
 * Hard guard cho bootstrap (`main.ts`). No-op khi không phải production
 * — giữ behavior dev/test cũ. Production thiếu/bad env → throw để LB
 * phát hiện ngay (instance không qua được readiness gate).
 *
 * Goi sau khi `assertProductionSecrets()` legacy guard để có 2 lớp
 * defense in-depth: legacy guard fail-fast trên JWT_*, schema này check
 * thêm DATABASE_URL/REDIS_URL/CORS_ORIGINS/SESSION_COOKIE_DOMAIN/
 * SECURITY_IP_HASH_SALT.
 */
export function assertProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;
  const result = productionEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(formatEnvIssues(result.error));
  }
}
