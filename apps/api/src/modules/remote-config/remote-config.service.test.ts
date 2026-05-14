/**
 * Phase 45.0 — RemoteConfigService unit tests.
 *
 * Cover:
 *   - cache 2-tier read flow L1 → L2 → DB → default catalog
 *   - DB row missing → fallback default (fail-open)
 *   - Redis read failure → fallback DB
 *   - DB read failure → fallback default
 *   - setConfig validate type/cap → throws RemoteConfigValidationError
 *   - setConfig success invalidates cache + writes DB upsert
 *   - listConfigs merges catalog + DB
 *   - getPublicConfigs returns whitelist subset only (admin-only filtered)
 *   - ensureDefaultConfigs idempotent (no overwrite existing)
 *   - parseRemoteConfigValue fallback default on corrupt raw
 */
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_CATALOG,
  REMOTE_CONFIG_KEYS,
  getRemoteConfigDef,
  type RemoteConfigKey,
} from '@xuantoi/shared';
import {
  RemoteConfigInvalidKeyError,
  RemoteConfigService,
  RemoteConfigValidationError,
  serializeRemoteConfigValue,
} from './remote-config.service';
import type { PrismaService } from '../../common/prisma.service';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StubRow {
  key: string;
  valueType: string;
  valueString: string;
}

function makePrismaStub(rows: StubRow[] = []) {
  const map = new Map(rows.map((r) => [r.key, r]));
  return {
    remoteConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const r = map.get(where.key);
        if (!r) return null;
        return {
          valueString: r.valueString,
          updatedByAdminId: null,
          updatedAt: new Date('2026-06-22T00:00:00Z'),
        };
      }),
      findMany: vi.fn(async () =>
        Array.from(map.values()).map((r) => ({
          key: r.key,
          valueString: r.valueString,
          updatedByAdminId: null,
          updatedAt: new Date('2026-06-22T00:00:00Z'),
        })),
      ),
      upsert: vi.fn(
        async (args: {
          where: { key: string };
          update: { valueString: string; valueType: string; updatedByAdminId: string };
        }) => {
          map.set(args.where.key, {
            key: args.where.key,
            valueString: args.update.valueString,
            valueType: args.update.valueType,
          });
          return {
            valueString: args.update.valueString,
            updatedByAdminId: args.update.updatedByAdminId,
            updatedAt: new Date('2026-06-22T00:00:01Z'),
          };
        },
      ),
      create: vi.fn(
        async (args: {
          data: { key: string; valueString: string; valueType: string };
        }) => {
          map.set(args.data.key, {
            key: args.data.key,
            valueString: args.data.valueString,
            valueType: args.data.valueType,
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
} = {}) {
  const store = new Map(Object.entries(opts.initial ?? {}));
  return {
    get: vi.fn(async (k: string) => {
      if (opts.failGet) throw new Error('redis down');
      return store.get(k) ?? null;
    }),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n += 1;
      return n;
    }),
  } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RemoteConfigService.getConfig — read flow', () => {
  it('DB missing → returns default catalog value (fail-open)', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    // max_daily_claims default = 50
    const v = await svc.getConfig('max_daily_claims');
    expect(v.type).toBe('number');
    expect(v.value).toBe(getRemoteConfigDef('max_daily_claims').defaultValue);
  });

  it('DB row → parses typed value', async () => {
    const def = getRemoteConfigDef('market_enabled');
    const prisma = makePrismaStub([
      {
        key: 'market_enabled',
        valueType: def.valueType,
        valueString: serializeRemoteConfigValue(def, false),
      },
    ]);
    const svc = new RemoteConfigService(prisma, null);
    const v = await svc.getConfig('market_enabled');
    expect(v).toEqual({ type: 'boolean', value: false });
  });

  it('Redis cache hit → returns parsed without DB read', async () => {
    const def = getRemoteConfigDef('max_daily_claims');
    const prisma = makePrismaStub([
      {
        key: 'max_daily_claims',
        valueType: def.valueType,
        valueString: '50',
      },
    ]);
    const redis = makeRedisStub({
      initial: { 'remote-config:max_daily_claims': '77' },
    });
    const svc = new RemoteConfigService(prisma, redis);
    const v = await svc.getConfig('max_daily_claims');
    expect(v.value).toBe(77);
    expect(prisma.remoteConfig.findUnique).not.toHaveBeenCalled();
  });

  it('L1 cache hit on 2nd call (skip Redis)', async () => {
    const prisma = makePrismaStub([]);
    const redis = makeRedisStub();
    const svc = new RemoteConfigService(prisma, redis);
    await svc.getConfig('maintenance_message');
    await svc.getConfig('maintenance_message');
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('Redis read failure → fallback DB, no throw', async () => {
    const def = getRemoteConfigDef('reward_safety_mode');
    const prisma = makePrismaStub([
      {
        key: 'reward_safety_mode',
        valueType: def.valueType,
        valueString: 'strict',
      },
    ]);
    const redis = makeRedisStub({ failGet: true });
    const svc = new RemoteConfigService(prisma, redis);
    const v = await svc.getConfig('reward_safety_mode');
    expect(v.value).toBe('strict');
  });

  it('DB read failure → fallback default (fail-safe)', async () => {
    const prisma = {
      remoteConfig: {
        findUnique: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    } as unknown as PrismaService;
    const svc = new RemoteConfigService(prisma, null);
    const v = await svc.getConfig('max_daily_claims');
    expect(v.value).toBe(getRemoteConfigDef('max_daily_claims').defaultValue);
  });

  it('Corrupt raw value in DB → parser fallback to default', async () => {
    const def = getRemoteConfigDef('max_daily_claims');
    const prisma = makePrismaStub([
      {
        key: 'max_daily_claims',
        valueType: def.valueType,
        valueString: 'not-a-number',
      },
    ]);
    const svc = new RemoteConfigService(prisma, null);
    const v = await svc.getConfig('max_daily_claims');
    expect(v.value).toBe(def.defaultValue);
  });
});

describe('RemoteConfigService.setConfig', () => {
  it('writes DB upsert + invalidates cache', async () => {
    const def = getRemoteConfigDef('max_daily_claims');
    const prisma = makePrismaStub([
      {
        key: 'max_daily_claims',
        valueType: def.valueType,
        valueString: '50',
      },
    ]);
    const redis = makeRedisStub({
      initial: { 'remote-config:max_daily_claims': '50' },
    });
    const svc = new RemoteConfigService(prisma, redis);
    await svc.getConfig('max_daily_claims');
    await svc.setConfig('admin-1', 'max_daily_claims', 100);
    expect(prisma.remoteConfig.upsert).toHaveBeenCalledOnce();
    expect(redis.del).toHaveBeenCalled();
  });

  it('rejects value above cap → RemoteConfigValidationError', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    await expect(
      svc.setConfig('admin-1', 'max_daily_claims', 9999),
    ).rejects.toBeInstanceOf(RemoteConfigValidationError);
  });

  it('rejects type mismatch → RemoteConfigValidationError', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    await expect(
      svc.setConfig('admin-1', 'max_daily_claims', 'fifty'),
    ).rejects.toBeInstanceOf(RemoteConfigValidationError);
    await expect(
      svc.setConfig('admin-1', 'market_enabled', 'true'),
    ).rejects.toBeInstanceOf(RemoteConfigValidationError);
  });

  it('rejects enum value not in allow-list', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    await expect(
      svc.setConfig('admin-1', 'reward_safety_mode', 'crazy'),
    ).rejects.toBeInstanceOf(RemoteConfigValidationError);
  });

  it('rejects unknown key → RemoteConfigInvalidKeyError', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    await expect(
      svc.setConfig(
        'admin-1',
        'BOGUS_KEY' as RemoteConfigKey,
        'whatever',
      ),
    ).rejects.toBeInstanceOf(RemoteConfigInvalidKeyError);
  });

  it('accepts valid string within length cap (maintenance_message)', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    const view = await svc.setConfig(
      'admin-1',
      'maintenance_message',
      'Bảo trì 30p',
    );
    expect(view.value).toBe('Bảo trì 30p');
    expect(view.updatedByAdminId).toBe('admin-1');
  });

  it('rejects string exceeding maxLength', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    const tooLong = 'a'.repeat(501);
    await expect(
      svc.setConfig('admin-1', 'maintenance_message', tooLong),
    ).rejects.toBeInstanceOf(RemoteConfigValidationError);
  });
});

describe('RemoteConfigService.listConfigs / getPublicConfigs', () => {
  it('listConfigs returns full catalog (admin view)', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    const list = await svc.listConfigs();
    expect(list).toHaveLength(REMOTE_CONFIG_CATALOG.length);
    // sorted by key
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1].key.localeCompare(list[i].key)).toBeLessThanOrEqual(0);
    }
  });

  it('getPublicConfigs returns only whitelist (admin-only filtered)', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    const list = await svc.getPublicConfigs();
    const returnedKeys = list.map((c) => c.key).sort();
    const expected = [...PUBLIC_REMOTE_CONFIG_KEYS].sort();
    expect(returnedKeys).toEqual(expected);
    // verify admin-only keys NOT leaked
    for (const c of list) {
      const def = getRemoteConfigDef(c.key);
      expect(def.public).toBe(true);
    }
  });
});

describe('RemoteConfigService.ensureDefaultConfigs', () => {
  it('seeds missing rows; idempotent on rerun', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    const r1 = await svc.ensureDefaultConfigs();
    expect(r1.created).toBe(REMOTE_CONFIG_KEYS.length);
    expect(r1.existing).toBe(0);
    const r2 = await svc.ensureDefaultConfigs();
    expect(r2.created).toBe(0);
    expect(r2.existing).toBe(REMOTE_CONFIG_KEYS.length);
  });
});

describe('RemoteConfigService.getConfig — invalid key', () => {
  it('throws RemoteConfigInvalidKeyError for unknown key', async () => {
    const prisma = makePrismaStub([]);
    const svc = new RemoteConfigService(prisma, null);
    await expect(
      svc.getConfig('NO_SUCH_KEY' as RemoteConfigKey),
    ).rejects.toBeInstanceOf(RemoteConfigInvalidKeyError);
  });
});
