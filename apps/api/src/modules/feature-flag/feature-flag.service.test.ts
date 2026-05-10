/**
 * Phase 15.4 — FeatureFlagService unit tests.
 *
 * Cover:
 *   - cache 2-tier read flow L1 → L2 → DB → default catalog
 *   - DB row missing → fallback default (fail-open)
 *   - Redis read failure → fallback DB (no crash)
 *   - DB read failure → fallback default (no crash)
 *   - setFlag invalidates cache + writes DB upsert
 *   - ensureDefaultFlags idempotent (no overwrite existing)
 *   - listFlags merges catalog + DB
 *   - getPublicFlags returns whitelist subset only
 *   - requireEnabled throws HttpException 503 + FEATURE_DISABLED
 *   - Invalid key throws FeatureFlagInvalidKeyError
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_KEYS,
  PUBLIC_FEATURE_FLAG_KEYS,
} from '@xuantoi/shared';
import {
  FeatureFlagInvalidKeyError,
  FeatureFlagService,
} from './feature-flag.service';
import type { PrismaService } from '../../common/prisma.service';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makePrismaStub(rows: Array<{ key: string; enabled: boolean }> = []) {
  const map = new Map(rows.map((r) => [r.key, r]));
  return {
    featureFlag: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const r = map.get(where.key);
        if (!r) return null;
        return {
          enabled: r.enabled,
          updatedByAdminId: null,
          updatedAt: new Date('2026-06-22T00:00:00Z'),
        };
      }),
      findMany: vi.fn(async () =>
        Array.from(map.values()).map((r) => ({
          key: r.key,
          enabled: r.enabled,
          updatedByAdminId: null,
          updatedAt: new Date('2026-06-22T00:00:00Z'),
        })),
      ),
      upsert: vi.fn(
        async (args: {
          where: { key: string };
          update: { enabled: boolean; updatedByAdminId: string };
          create: { key: string; enabled: boolean };
        }) => {
          map.set(args.where.key, {
            key: args.where.key,
            enabled: args.update.enabled,
          });
          return {
            enabled: args.update.enabled,
            updatedByAdminId: args.update.updatedByAdminId,
            updatedAt: new Date('2026-06-22T00:00:01Z'),
          };
        },
      ),
      create: vi.fn(
        async (args: { data: { key: string; enabled: boolean } }) => {
          map.set(args.data.key, {
            key: args.data.key,
            enabled: args.data.enabled,
          });
          return args.data;
        },
      ),
    },
  } as unknown as PrismaService;
}

function makeRedisStub(opts: {
  initial?: Record<string, string>;
  failGet?: boolean;
  failSet?: boolean;
} = {}) {
  const store = new Map(Object.entries(opts.initial ?? {}));
  return {
    get: vi.fn(async (k: string) => {
      if (opts.failGet) throw new Error('redis down');
      return store.get(k) ?? null;
    }),
    set: vi.fn(async (k: string, v: string) => {
      if (opts.failSet) throw new Error('redis write down');
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const k of keys) if (store.delete(k)) deleted += 1;
      return deleted;
    }),
  } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagService.isEnabled', () => {
  it('DB missing → returns default catalog value (fail-open)', async () => {
    const prisma = makePrismaStub([]);
    const service = new FeatureFlagService(prisma, null);
    // ARENA_ENABLED defaultEnabled=true
    expect(await service.isEnabled('ARENA_ENABLED')).toBe(true);
  });

  it('DB row enabled=false → returns false', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: false }]);
    const service = new FeatureFlagService(prisma, null);
    expect(await service.isEnabled('ARENA_ENABLED')).toBe(false);
  });

  it('Redis cache hit (1) → returns true without DB read', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: false }]);
    const redis = makeRedisStub({ initial: { 'feature-flag:ARENA_ENABLED': '1' } });
    const service = new FeatureFlagService(prisma, redis);
    expect(await service.isEnabled('ARENA_ENABLED')).toBe(true);
    // DB findUnique không được gọi vì cache hit
    expect(prisma.featureFlag.findUnique).not.toHaveBeenCalled();
  });

  it('L1 cache hit on 2nd call (no Redis call)', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: true }]);
    const redis = makeRedisStub();
    const service = new FeatureFlagService(prisma, redis);
    await service.isEnabled('ARENA_ENABLED');
    await service.isEnabled('ARENA_ENABLED');
    // Redis.get gọi 1 lần (L2 miss → DB), lần 2 hit L1
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('Redis read failure → fallback DB, log warn but no throw', async () => {
    const prisma = makePrismaStub([{ key: 'MARKET_ENABLED', enabled: false }]);
    const redis = makeRedisStub({ failGet: true });
    const service = new FeatureFlagService(prisma, redis);
    expect(await service.isEnabled('MARKET_ENABLED')).toBe(false);
    expect(prisma.featureFlag.findUnique).toHaveBeenCalled();
  });

  it('DB read failure → fallback default (fail-safe)', async () => {
    const prisma = {
      featureFlag: {
        findUnique: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    } as unknown as PrismaService;
    const service = new FeatureFlagService(prisma, null);
    // ARENA_ENABLED default=true
    expect(await service.isEnabled('ARENA_ENABLED')).toBe(true);
  });
});

describe('FeatureFlagService.requireEnabled', () => {
  it('flag on → resolves without throw', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: true }]);
    const service = new FeatureFlagService(prisma, null);
    await expect(service.requireEnabled('ARENA_ENABLED')).resolves.toBeUndefined();
  });

  it('flag off → throws HttpException 503 with FEATURE_DISABLED envelope', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: false }]);
    const service = new FeatureFlagService(prisma, null);
    await expect(service.requireEnabled('ARENA_ENABLED')).rejects.toThrow(
      HttpException,
    );
    try {
      await service.requireEnabled('ARENA_ENABLED');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const err = e as HttpException;
      expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(err.getResponse()).toMatchObject({
        ok: false,
        error: { code: 'FEATURE_DISABLED' },
      });
    }
  });
});

describe('FeatureFlagService.setFlag', () => {
  it('writes DB upsert + invalidates cache', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: true }]);
    const redis = makeRedisStub({
      initial: { 'feature-flag:ARENA_ENABLED': '1' },
    });
    const service = new FeatureFlagService(prisma, redis);
    // warm up L1 cache first
    await service.isEnabled('ARENA_ENABLED');
    // admin disable
    await service.setFlag('admin-1', 'ARENA_ENABLED', false);
    // Cache invalidated → next read should hit DB and return false
    redis.get = vi.fn(async () => null) as unknown as Redis['get'];
    expect(await service.isEnabled('ARENA_ENABLED')).toBe(false);
    expect(prisma.featureFlag.upsert).toHaveBeenCalledOnce();
    expect(redis.del).toHaveBeenCalled();
  });

  it('rejects unknown key with FeatureFlagInvalidKeyError', async () => {
    const prisma = makePrismaStub([]);
    const service = new FeatureFlagService(prisma, null);
    await expect(
      service.setFlag(
        'admin-1',
        'BOGUS_KEY' as unknown as Parameters<typeof service.setFlag>[1],
        true,
      ),
    ).rejects.toBeInstanceOf(FeatureFlagInvalidKeyError);
  });
});

describe('FeatureFlagService.ensureDefaultFlags', () => {
  it('seeds missing rows; returns counts; idempotent on rerun', async () => {
    const prisma = makePrismaStub([]);
    const service = new FeatureFlagService(prisma, null);
    const r1 = await service.ensureDefaultFlags();
    expect(r1.created).toBe(FEATURE_FLAG_KEYS.length);
    expect(r1.existing).toBe(0);
    // Rerun → all existing, 0 created
    const r2 = await service.ensureDefaultFlags();
    expect(r2.created).toBe(0);
    expect(r2.existing).toBe(FEATURE_FLAG_KEYS.length);
  });
});

describe('FeatureFlagService.listFlags', () => {
  it('returns full catalog merged with DB rows; sorted by category then key', async () => {
    const prisma = makePrismaStub([
      { key: 'ARENA_ENABLED', enabled: false },
      { key: 'MARKET_ENABLED', enabled: false },
    ]);
    const service = new FeatureFlagService(prisma, null);
    const list = await service.listFlags();
    expect(list).toHaveLength(FEATURE_FLAG_KEYS.length);
    // ARENA_ENABLED override → enabled=false
    const arena = list.find((f) => f.key === 'ARENA_ENABLED')!;
    expect(arena.enabled).toBe(false);
    expect(arena.updatedAt).toBe('2026-06-22T00:00:00.000Z');
    // Catalog flag without DB row → enabled = catalog default
    const lpa = list.find((f) => f.key === 'LIVEOPS_ANNOUNCEMENTS_ENABLED')!;
    const def = FEATURE_FLAG_CATALOG.find(
      (d) => d.key === 'LIVEOPS_ANNOUNCEMENTS_ENABLED',
    )!;
    expect(lpa.enabled).toBe(def.defaultEnabled);
    expect(lpa.updatedAt).toBeNull();
    // Sorted: category alphabet rồi key
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      expect(
        a.category < b.category ||
          (a.category === b.category && a.key < b.key),
      ).toBe(true);
    }
  });
});

describe('FeatureFlagService.getPublicFlags', () => {
  it('returns whitelist only (no admin/safety flags)', async () => {
    const prisma = makePrismaStub([]);
    const service = new FeatureFlagService(prisma, null);
    const pub = await service.getPublicFlags();
    expect(pub).toHaveLength(PUBLIC_FEATURE_FLAG_KEYS.length);
    for (const view of pub) {
      expect(PUBLIC_FEATURE_FLAG_KEYS.includes(view.key)).toBe(true);
      // Public view không có admin metadata
      expect(Object.keys(view).sort()).toEqual(['enabled', 'key']);
    }
    // SAFETY/ADMIN flags KHÔNG có trong public response
    const keys = pub.map((p) => p.key);
    expect(keys.includes('SHOP_DISCOUNT_EVENTS_ENABLED')).toBe(false);
    expect(keys.includes('SECT_SHOP_DISCOUNT_EVENTS_ENABLED')).toBe(false);
    expect(keys.includes('TERRITORY_WAR_ENABLED')).toBe(false);
  });
});

describe('FeatureFlagService.clearCache', () => {
  it('drops L1 + Redis DEL all catalog keys', async () => {
    const prisma = makePrismaStub([{ key: 'ARENA_ENABLED', enabled: true }]);
    const redis = makeRedisStub();
    const service = new FeatureFlagService(prisma, redis);
    await service.isEnabled('ARENA_ENABLED'); // populate caches
    await service.clearCache();
    expect(redis.del).toHaveBeenCalled();
    // Subsequent read goes back to L2/DB
    await service.isEnabled('ARENA_ENABLED');
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('Redis DEL failure → log warn but no throw', async () => {
    const prisma = makePrismaStub([]);
    const redis = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => {
        throw new Error('redis down');
      }),
    } as unknown as Redis;
    const service = new FeatureFlagService(prisma, redis);
    await expect(service.clearCache()).resolves.toBeUndefined();
  });
});
