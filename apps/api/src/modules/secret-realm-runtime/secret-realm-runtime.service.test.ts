import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SECRET_REALM_REWARD_CAPS,
  SECRET_REALMS,
} from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  SecretRealmError,
  SecretRealmRuntimeService,
} from './secret-realm-runtime.service';
import {
  TEST_DATABASE_URL,
  makeSecretRealmRuntimeService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let secretRealm: SecretRealmRuntimeService;

const FIRST_REALM = SECRET_REALMS[0]!.key; // sr_pham_cavern (requiredRealmOrder=1)

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  ({ secretRealm } = makeSecretRealmRuntimeService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SecretRealmRuntimeService.list', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(secretRealm.list('no-such-user')).rejects.toThrow(
      new SecretRealmError('NO_CHARACTER'),
    );
  });

  it('list trả entries cho mọi realm trong catalog', async () => {
    const { userId } = await makeUserChar(prisma);
    const list = await secretRealm.list(userId);
    expect(list).toHaveLength(SECRET_REALMS.length);
    expect(list[0]?.key).toBe(SECRET_REALMS[0]!.key);
  });

  it('realm cao hơn cảnh giới → LOCKED', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const list = await secretRealm.list(userId);
    // sr_pham_cavern requires realmOrder=1 → AVAILABLE.
    // Higher realms (sr_linh_grotto requires 3) → LOCKED.
    const high = list.find((r) => r.key === 'sr_linh_grotto');
    expect(high?.status).toBe('LOCKED');
  });
});

describe('SecretRealmRuntimeService.enter', () => {
  it('throw SECRET_REALM_NOT_FOUND nếu realmKey invalid', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(
      secretRealm.enter(userId, 'nonexistent_realm'),
    ).rejects.toThrow(new SecretRealmError('SECRET_REALM_NOT_FOUND'));
  });

  it('enter tạo run mới ENTERED + objectives = 0', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    expect(run.status).toBe('ENTERED');
    expect(run.secretRealmKey).toBe(FIRST_REALM);
    expect(Object.values(run.objectiveProgress).every((v) => v === 0)).toBe(true);
  });

  it('enter throw SECRET_REALM_REALM_LOCKED nếu chưa đủ realm', async () => {
    const { userId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    // sr_linh_grotto requires realmOrder 3.
    await expect(
      secretRealm.enter(userId, 'sr_linh_grotto'),
    ).rejects.toThrow(new SecretRealmError('SECRET_REALM_REALM_LOCKED'));
  });

  it('enter throw SECRET_REALM_RUN_ACTIVE nếu đã có run đang chạy', async () => {
    const { userId } = await makeUserChar(prisma);
    await secretRealm.enter(userId, FIRST_REALM);
    await expect(
      secretRealm.enter(userId, FIRST_REALM),
    ).rejects.toThrow(new SecretRealmError('SECRET_REALM_RUN_ACTIVE'));
  });
});

describe('SecretRealmRuntimeService.progress + complete', () => {
  it('progress increment objective, clamp to target', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    const objKey = SECRET_REALMS[0]!.objectives[0]!.key;
    const target = SECRET_REALMS[0]!.objectives[0]!.target;
    const r1 = await secretRealm.progress(userId, run.id, objKey, 1);
    expect(r1.objectiveProgress[objKey]).toBe(1);
    const r2 = await secretRealm.progress(userId, run.id, objKey, target + 99);
    expect(r2.objectiveProgress[objKey]).toBe(target);
  });

  it('progress throw SECRET_REALM_OBJECTIVE_INVALID nếu key sai', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    await expect(
      secretRealm.progress(userId, run.id, 'fake_obj', 1),
    ).rejects.toThrow(new SecretRealmError('SECRET_REALM_OBJECTIVE_INVALID'));
  });

  it('complete throw SECRET_REALM_OBJECTIVES_INCOMPLETE nếu chưa đủ', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    await expect(secretRealm.complete(userId, run.id)).rejects.toThrow(
      new SecretRealmError('SECRET_REALM_OBJECTIVES_INCOMPLETE'),
    );
  });

  it('complete success → CLEARED khi tất cả objectives đạt target', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    for (const obj of SECRET_REALMS[0]!.objectives) {
      await secretRealm.progress(userId, run.id, obj.key, obj.target);
    }
    const cleared = await secretRealm.complete(userId, run.id);
    expect(cleared.status).toBe('CLEARED');
    expect(cleared.clearedAt).toBeTruthy();
  });
});

describe('SecretRealmRuntimeService.claim', () => {
  async function setupCleared(): Promise<{
    userId: string;
    characterId: string;
    runId: string;
  }> {
    const { userId, characterId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    for (const obj of SECRET_REALMS[0]!.objectives) {
      await secretRealm.progress(userId, run.id, obj.key, obj.target);
    }
    await secretRealm.complete(userId, run.id);
    return { userId, characterId, runId: run.id };
  }

  it('claim grants linhThach + exp, run CLAIMED', async () => {
    const { userId, characterId, runId } = await setupCleared();
    const r = await secretRealm.claim(userId, runId);
    expect(r.claimed).toBe(true);
    expect(r.linhThachGranted).toBeGreaterThan(0);
    expect(r.expGranted).toBeGreaterThan(0);
    expect(r.run.status).toBe('CLAIMED');
    const c = await prisma.character.findUnique({ where: { id: characterId } });
    expect(c!.linhThach).toBe(BigInt(1000) + BigInt(r.linhThachGranted));
    expect(c!.exp).toBe(BigInt(r.expGranted));
  });

  it('claim twice — second is no-op, no double grant', async () => {
    const { userId, characterId, runId } = await setupCleared();
    const r1 = await secretRealm.claim(userId, runId);
    const c1 = await prisma.character.findUnique({ where: { id: characterId } });
    const r2 = await secretRealm.claim(userId, runId);
    expect(r2.claimed).toBe(false);
    const c2 = await prisma.character.findUnique({ where: { id: characterId } });
    expect(c2!.linhThach).toBe(c1!.linhThach);
    expect(r1.run.status).toBe('CLAIMED');
  });

  it('claim throw SECRET_REALM_NOT_CLEARED nếu run chưa cleared', async () => {
    const { userId } = await makeUserChar(prisma);
    const run = await secretRealm.enter(userId, FIRST_REALM);
    await expect(secretRealm.claim(userId, run.id)).rejects.toThrow(
      new SecretRealmError('SECRET_REALM_NOT_CLEARED'),
    );
  });

  it('claim respects reward cap', async () => {
    const { userId, runId } = await setupCleared();
    const r = await secretRealm.claim(userId, runId);
    expect(r.linhThachGranted).toBeLessThanOrEqual(
      SECRET_REALM_REWARD_CAPS.linhThachMax,
    );
    expect(r.expGranted).toBeLessThanOrEqual(SECRET_REALM_REWARD_CAPS.expMax);
  });

  it('ledger entry created sau claim', async () => {
    const { userId, characterId, runId } = await setupCleared();
    await secretRealm.claim(userId, runId);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'SECRET_REALM_CLAIM' },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0]!.currency).toBe(CurrencyKind.LINH_THACH);
  });

  it('history trả ≤ limit, ordered desc', async () => {
    const { userId, runId } = await setupCleared();
    await secretRealm.claim(userId, runId);
    const h = await secretRealm.history(userId, 5);
    expect(h.length).toBe(1);
    expect(h[0]?.id).toBe(runId);
  });
});
