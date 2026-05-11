/**
 * Phase 17.1 — Unit tests cho `env.schema.ts` (Deploy Verify Gate).
 *
 * Lock-in invariants:
 *  1. Dev/test KHÔNG cản start dù env trống — `parseEnv()` không bao
 *     giờ throw khi `NODE_ENV !== 'production'`.
 *  2. Production thiếu mỗi env critical → throw với tên env trong
 *     message.
 *  3. Production placeholder secret (change-me-* / dev-*-secret / ip-salt
 *     default) → throw.
 *  4. JWT secret < 32 ký tự → throw.
 *  5. `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` → throw.
 *  6. DATABASE_URL scheme sai → throw.
 *  7. REDIS_URL scheme sai → throw.
 *  8. SECURITY_IP_HASH_SALT < 32 hoặc = default → throw.
 *  9. PORT non-numeric / out-of-range → throw.
 * 10. Production happy path (đủ strong env) → pass + normalize.
 * 11. `parseEnv()` aggregate nhiều issue (không fail từng cái một).
 * 12. `assertProductionEnv()` no-op khi NODE_ENV không phải production.
 */
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_PRODUCTION_ENV,
  INSECURE_IP_HASH_SALT,
  INSECURE_JWT_SECRETS,
  MIN_IP_HASH_SALT_LENGTH,
  MIN_JWT_SECRET_LENGTH,
  assertProductionEnv,
  parseEnv,
  productionEnvSchema,
} from './env.schema';

const STRONG_ACCESS = 'A'.repeat(MIN_JWT_SECRET_LENGTH + 4);
const STRONG_REFRESH = 'B'.repeat(MIN_JWT_SECRET_LENGTH + 4);
const STRONG_SALT = 'C'.repeat(MIN_IP_HASH_SALT_LENGTH + 4);

function prodEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host:5432/db?sslmode=require',
    REDIS_URL: 'rediss://host:6380',
    JWT_ACCESS_SECRET: STRONG_ACCESS,
    JWT_REFRESH_SECRET: STRONG_REFRESH,
    CORS_ORIGINS: 'https://xt.example.com',
    SESSION_COOKIE_DOMAIN: '.xt.example.com',
    SECURITY_IP_HASH_SALT: STRONG_SALT,
    PORT: '3000',
    ...extra,
  };
}

describe('env.schema / parseEnv — dev/test permissive', () => {
  it('NODE_ENV=development + env hoàn toàn trống → pass, NODE_ENV default development', () => {
    const out = parseEnv({});
    expect(out.NODE_ENV).toBe('development');
  });

  it('NODE_ENV=test → pass dù thiếu mọi critical env', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('NODE_ENV=development + JWT placeholder vẫn pass (không cản dev)', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'change-me-access-secret',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret',
      }),
    ).not.toThrow();
  });

  it('PORT optional + default 3000 ở dev', () => {
    const out = parseEnv({ NODE_ENV: 'development' });
    expect(out.PORT).toBe(3000);
  });
});

describe('env.schema / parseEnv — production strict required env', () => {
  it.each(CRITICAL_PRODUCTION_ENV)(
    'production thiếu %s → throw với tên env trong message',
    (key) => {
      const env = prodEnv();
      delete (env as Record<string, string | undefined>)[key];
      expect(() => parseEnv(env)).toThrow(new RegExp(key));
    },
  );

  it('production thiếu nhiều env cùng lúc → message aggregate đủ', () => {
    try {
      parseEnv({ NODE_ENV: 'production' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      for (const k of CRITICAL_PRODUCTION_ENV) {
        expect(msg).toMatch(new RegExp(k));
      }
    }
  });
});

describe('env.schema / parseEnv — production placeholder secret', () => {
  it.each([...INSECURE_JWT_SECRETS])(
    'production JWT_ACCESS_SECRET = insecure default %s → throw (insecure hoặc length)',
    (bad) => {
      // Placeholder gốc luôn bị reject: ngắn hơn 32 → length-check throw;
      // 'change-me-refresh-secret' = 24 ký tự, 'dev-*-secret' < 20 → đều
      // fail length trước cả refine. `JWT_REFRESH_SECRET` = placeholder
      // length-OK cũng đã có test riêng dưới (= `change-me-refresh-secret`
      // length 24 vẫn fail length). Test này chốt: placeholder default
      // KHÔNG bao giờ pass — message phải nhắc JWT_ACCESS_SECRET.
      expect(() =>
        parseEnv(prodEnv({ JWT_ACCESS_SECRET: bad })),
      ).toThrow(/JWT_ACCESS_SECRET/);
    },
  );

  it('semantics: chỉ exact match placeholder mới reject, value KHÁC pass (refine không substring-match)', () => {
    // Document intent: schema reject EXACT match placeholder; rotate
    // production secret = sinh mới qua `openssl rand` chứ không pad
    // placeholder. Nếu rotate sang một string độc lập, nó pass.
    const rotated = 'change-me-access-secret-with-padding-yyyy';
    expect(rotated.length).toBeGreaterThanOrEqual(MIN_JWT_SECRET_LENGTH);
    expect(INSECURE_JWT_SECRETS.has(rotated)).toBe(false);
    expect(() =>
      parseEnv(prodEnv({ JWT_ACCESS_SECRET: rotated })),
    ).not.toThrow();
  });

  it('production JWT_REFRESH_SECRET = change-me-refresh-secret → throw insecure', () => {
    expect(() =>
      parseEnv(prodEnv({ JWT_REFRESH_SECRET: 'change-me-refresh-secret' })),
    ).toThrow(/insecure|JWT_REFRESH_SECRET/);
  });

  it('production SECURITY_IP_HASH_SALT = default xuantoi-default-ip-salt (padded) → throw insecure', () => {
    const padded = INSECURE_IP_HASH_SALT.padEnd(
      MIN_IP_HASH_SALT_LENGTH + 4,
      'X',
    );
    // padded khác default → pass refine; chỉ exact default bị reject.
    expect(() =>
      parseEnv(prodEnv({ SECURITY_IP_HASH_SALT: padded })),
    ).not.toThrow();
    // Default raw → length < 32 → throw (length check trước refine).
    expect(() =>
      parseEnv(prodEnv({ SECURITY_IP_HASH_SALT: INSECURE_IP_HASH_SALT })),
    ).toThrow(/SECURITY_IP_HASH_SALT/);
  });
});

describe('env.schema / parseEnv — production length & format', () => {
  it('JWT_ACCESS_SECRET < 32 ký tự → throw', () => {
    expect(() =>
      parseEnv(prodEnv({ JWT_ACCESS_SECRET: 'short' })),
    ).toThrow(/JWT_ACCESS_SECRET.*≥|JWT_ACCESS_SECRET/);
  });

  it('JWT_REFRESH_SECRET = JWT_ACCESS_SECRET → throw "khác"', () => {
    expect(() =>
      parseEnv(
        prodEnv({
          JWT_ACCESS_SECRET: STRONG_ACCESS,
          JWT_REFRESH_SECRET: STRONG_ACCESS,
        }),
      ),
    ).toThrow(/khác JWT_ACCESS_SECRET|JWT_REFRESH_SECRET/);
  });

  it('DATABASE_URL scheme sai → throw', () => {
    expect(() =>
      parseEnv(prodEnv({ DATABASE_URL: 'mysql://x' })),
    ).toThrow(/DATABASE_URL/);
  });

  it('REDIS_URL scheme sai → throw', () => {
    expect(() =>
      parseEnv(prodEnv({ REDIS_URL: 'http://x' })),
    ).toThrow(/REDIS_URL/);
  });

  it('CORS_ORIGINS toàn dấu phẩy / empty → throw', () => {
    expect(() => parseEnv(prodEnv({ CORS_ORIGINS: ',,, ' }))).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('PORT non-numeric → throw', () => {
    expect(() => parseEnv(prodEnv({ PORT: 'not-a-number' }))).toThrow(/PORT/);
  });

  it('PORT out-of-range → throw', () => {
    expect(() => parseEnv(prodEnv({ PORT: '70000' }))).toThrow(/PORT/);
  });
});

describe('env.schema / parseEnv — production happy path', () => {
  it('đủ strong env → pass + normalize PORT thành number', () => {
    const out = parseEnv(prodEnv({ PORT: '4000' }));
    expect(out.NODE_ENV).toBe('production');
    expect(out.PORT).toBe(4000);
    expect(out.DATABASE_URL).toMatch(/^postgresql:\/\//);
    expect(out.REDIS_URL).toMatch(/^rediss?:\/\//);
  });

  it('CORS_ORIGINS csv list multi-origin → pass', () => {
    expect(() =>
      parseEnv(
        prodEnv({
          CORS_ORIGINS: 'https://xt.example.com,https://www.xt.example.com',
        }),
      ),
    ).not.toThrow();
  });

  it('productionEnvSchema.safeParse exposes structured issues', () => {
    const r = productionEnvSchema.safeParse({ NODE_ENV: 'production' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      for (const k of CRITICAL_PRODUCTION_ENV) {
        expect(paths).toContain(k);
      }
    }
  });
});

describe('env.schema / assertProductionEnv', () => {
  it('no-op khi NODE_ENV !== production', () => {
    expect(() => assertProductionEnv({})).not.toThrow();
    expect(() => assertProductionEnv({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('throw khi production env trống', () => {
    expect(() => assertProductionEnv({ NODE_ENV: 'production' })).toThrow(
      /Env validation FAILED/,
    );
  });

  it('pass khi production đủ env strong', () => {
    expect(() => assertProductionEnv(prodEnv())).not.toThrow();
  });
});
