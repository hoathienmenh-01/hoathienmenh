/**
 * Phase 43 — Pure-unit tests cho /health alias endpoints + probe
 * functions. KHÔNG cần infra:up.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import {
  HealthController,
  probeDb,
  probeRedis,
  type HealthStatus,
} from './health.controller';
import { PrismaService } from '../../common/prisma.service';

interface FakeRes {
  status: (s: number) => FakeRes;
  _statusCode: number;
}

function makeFakeRes(): FakeRes {
  const res: FakeRes = {
    _statusCode: 200,
    status(s: number) {
      this._statusCode = s;
      return this;
    },
  };
  return res;
}

function fakePrismaOk(): PrismaService {
  return {
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
  } as unknown as PrismaService;
}

function fakePrismaFail(err = new Error('connect ECONNREFUSED')): PrismaService {
  return {
    $queryRaw: vi.fn(async () => {
      throw err;
    }),
  } as unknown as PrismaService;
}

function fakeRedisOk(): Redis {
  return {
    ping: vi.fn(async () => 'PONG'),
  } as unknown as Redis;
}

function fakeRedisFail(err = new Error('redis offline')): Redis {
  return {
    ping: vi.fn(async () => {
      throw err;
    }),
  } as unknown as Redis;
}

describe('Phase 43 — /health alias (light)', () => {
  it('returns status=ok with serviceName + uptime + timestamp', () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const out = ctrl.healthLight();
    expect(out.status).toBe('ok');
    expect(out.serviceName).toBe('xuantoi-api');
    expect(typeof out.uptimeSeconds).toBe('number');
    expect(out.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(out.timestamp).toMatch(/T/);
  });

  it('env label clamps to allow-list (no leak)', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'something-custom';
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const out = ctrl.healthLight();
    expect(out.environment).toBe('development');
    process.env.NODE_ENV = original;
  });
});

describe('Phase 43 — /health/version', () => {
  it('returns name/version/commit/node without leaking env values', () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const out = ctrl.healthVersion();
    expect(out.name).toBe('@xuantoi/api');
    expect(out).toHaveProperty('version');
    expect(out).toHaveProperty('commit');
    expect(out).toHaveProperty('node');
    // No env value leak via JSON shape
    const json = JSON.stringify(out);
    expect(json).not.toContain('JWT_ACCESS_SECRET');
    expect(json).not.toContain('DATABASE_URL');
  });
});

describe('Phase 43 — /health/db probe', () => {
  it('healthy DB → status=ok', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const res = makeFakeRes();
    const out = await ctrl.healthDb(res as unknown as Response);
    expect(out.status).toBe('ok');
    expect(out.error).toBeUndefined();
    expect(res._statusCode).toBe(200);
  });

  it('DB throw → status=down + 503 + error scrubbed', async () => {
    const ctrl = new HealthController(
      fakePrismaFail(new Error('connect ECONNREFUSED postgresql://user:pass@x.y.z:5432')),
      fakeRedisOk(),
    );
    const res = makeFakeRes();
    const out = await ctrl.healthDb(res as unknown as Response);
    expect(out.status).toBe('down');
    expect(res._statusCode).toBe(503);
    expect(out.error).toBeDefined();
    expect(out.error).toContain('[REDACTED]');
    expect(out.error).not.toContain('user:pass');
  });
});

describe('Phase 43 — /health/redis probe', () => {
  it('healthy Redis → status=ok', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const res = makeFakeRes();
    const out = await ctrl.healthRedis(res as unknown as Response);
    expect(out.status).toBe('ok');
    expect(res._statusCode).toBe(200);
  });

  it('non-PONG response → status=down + 503', async () => {
    const redisWrong = {
      ping: vi.fn(async () => 'WRONG'),
    } as unknown as Redis;
    const ctrl = new HealthController(fakePrismaOk(), redisWrong);
    const res = makeFakeRes();
    const out = await ctrl.healthRedis(res as unknown as Response);
    expect(out.status).toBe('down');
    expect(res._statusCode).toBe(503);
  });

  it('Redis throw → status=down + 503', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisFail());
    const res = makeFakeRes();
    const out = await ctrl.healthRedis(res as unknown as Response);
    expect(out.status).toBe('down');
    expect(res._statusCode).toBe(503);
  });
});

describe('Phase 43 — /health/full rollup', () => {
  it('all healthy → status=ok 200', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const res = makeFakeRes();
    const out = await ctrl.healthFull(res as unknown as Response);
    expect(out.status).toBe('ok');
    expect(out.checks.db.status).toBe('ok');
    expect(out.checks.redis.status).toBe('ok');
    expect(res._statusCode).toBe(200);
  });

  it('Redis down but DB ok → status=degraded 503', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisFail());
    const res = makeFakeRes();
    const out = await ctrl.healthFull(res as unknown as Response);
    expect(out.status).toBe('degraded');
    expect(res._statusCode).toBe(503);
  });

  it('DB down → status=down 503 regardless of Redis', async () => {
    const ctrl = new HealthController(fakePrismaFail(), fakeRedisOk());
    const res = makeFakeRes();
    const out = await ctrl.healthFull(res as unknown as Response);
    expect(out.status).toBe('down');
    expect(res._statusCode).toBe(503);
  });

  it('payload includes serviceName/uptime/version/buildCommit/node', async () => {
    const ctrl = new HealthController(fakePrismaOk(), fakeRedisOk());
    const res = makeFakeRes();
    const out = await ctrl.healthFull(res as unknown as Response);
    expect(out.serviceName).toBe('xuantoi-api');
    expect(typeof out.uptimeSeconds).toBe('number');
    expect(typeof out.version).toBe('string');
    expect(typeof out.buildCommit).toBe('string');
    expect(out.node).toBe(process.version);
  });
});

describe('Phase 43 — probeDb / probeRedis pure', () => {
  it('probeDb timeout safe (rejects after 2s budget)', async () => {
    // simulate hang — Prisma never resolves
    const hangingPrisma = {
      $queryRaw: () => new Promise(() => undefined),
    } as unknown as PrismaService;
    const out = await probeDb(hangingPrisma);
    expect(out.status).toBe('down');
    expect(out.error).toMatch(/timeout/i);
  }, 5_000);

  it('probeRedis non-PONG distinguishes from throw', async () => {
    const r1 = await probeRedis({ ping: async () => 'WRONG' } as unknown as Redis);
    expect(r1.status).toBe('down');
    expect(r1.error).toMatch(/non-PONG/i);
  });

  it('probeDb scrubs URL-style password from error', async () => {
    const out = await probeDb(
      fakePrismaFail(new Error('postgresql://u:supersecret@host/db connection refused')),
    );
    expect(out.error).toContain('[REDACTED]');
    expect(out.error).not.toContain('supersecret');
  });
});

// type guard test
const _enumCheck: HealthStatus[] = ['ok', 'degraded', 'down'];
void _enumCheck;
