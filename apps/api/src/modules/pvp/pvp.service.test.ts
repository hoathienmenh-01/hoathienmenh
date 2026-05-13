/**
 * Phase 29.0 — PvP Foundation API integration tests.
 *
 * Coverage (spec PHẦN 17):
 *   - snapshot.service: build from character stats; reject missing character.
 *   - defense.service: upsert + load + label limit.
 *   - battle.service: challenge resolves; FRIENDLY_SPARRING zero reward;
 *     same-target cooldown blocks; idempotency dedupes; invalidate flips status.
 *   - anomaly.service: record severity auto-derive; admin resolve audit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { PvpSnapshotError, PvpSnapshotService } from './snapshot.service';
import { PvpDefenseError, PvpDefenseService } from './defense.service';
import { PvpBattleError, PvpBattleService } from './battle.service';
import { PvpAnomalyService } from './anomaly.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let snapshot: PvpSnapshotService;
let defense: PvpDefenseService;
let battle: PvpBattleService;
let anomalies: PvpAnomalyService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  snapshot = new PvpSnapshotService(prisma);
  defense = new PvpDefenseService(prisma, snapshot);
  battle = new PvpBattleService(prisma, snapshot, defense);
  anomalies = new PvpAnomalyService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PvpSnapshotService', () => {
  it('builds snapshot from character (ATTACKER type)', async () => {
    const a = await makeUserChar(prisma);
    const snap = await snapshot.buildForCharacter(a.characterId, 'ATTACKER');
    expect(snap.snapshotType).toBe('ATTACKER');
    expect(snap.characterKey).toBe(a.characterId);
    expect(snap.totalPower).toBeGreaterThan(0);
    expect(snap.realmOrder).toBeGreaterThanOrEqual(0);
    expect(snap.stats).toBeDefined();
  });

  it('throws PVP_TARGET_NOT_FOUND for unknown character', async () => {
    await expect(
      snapshot.buildForCharacter('nope-id', 'ATTACKER'),
    ).rejects.toBeInstanceOf(PvpSnapshotError);
  });
});

describe('PvpDefenseService', () => {
  it('returns null when no profile saved', async () => {
    const a = await makeUserChar(prisma);
    expect(await defense.get(a.characterId)).toBeNull();
  });

  it('upserts defense profile + reads back', async () => {
    const a = await makeUserChar(prisma);
    const created = await defense.upsert(a.characterId, 'Hỏa Pháp');
    expect(created.label).toBe('Hỏa Pháp');
    expect(created.snapshot.snapshotType).toBe('DEFENDER');
    const loaded = await defense.get(a.characterId);
    expect(loaded?.label).toBe('Hỏa Pháp');
    expect(loaded?.snapshot.totalPower).toBe(created.snapshot.totalPower);
  });

  it('upsert overwrites prior snapshot', async () => {
    const a = await makeUserChar(prisma);
    await defense.upsert(a.characterId, 'v1');
    await defense.upsert(a.characterId, 'v2');
    const count = await prisma.pvpDefenseProfile.count({
      where: { characterId: a.characterId },
    });
    expect(count).toBe(1);
    const loaded = await defense.get(a.characterId);
    expect(loaded?.label).toBe('v2');
  });

  it('rejects label > 60 chars', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      defense.upsert(a.characterId, 'x'.repeat(61)),
    ).rejects.toBeInstanceOf(PvpDefenseError);
  });

  it('loadOrBuild falls back to live snapshot when no profile', async () => {
    const a = await makeUserChar(prisma);
    const snap = await defense.loadOrBuild(a.characterId);
    expect(snap.snapshotType).toBe('DEFENDER');
  });
});

describe('PvpBattleService.challenge', () => {
  it('rejects self-challenge', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      battle.challenge({
        attackerCharacterId: a.characterId,
        defenderCharacterId: a.characterId,
        mode: 'DUEL',
      }),
    ).rejects.toMatchObject({ code: 'PVP_TARGET_SELF' });
  });

  it('rejects ARENA mode (use ArenaService)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await expect(
      battle.challenge({
        attackerCharacterId: a.characterId,
        defenderCharacterId: b.characterId,
        mode: 'ARENA',
      }),
    ).rejects.toMatchObject({ code: 'PVP_INVALID_MODE' });
  });

  it('resolves DUEL → creates RESOLVED battle row with snapshots', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const result = await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
    });
    expect(['ATTACKER_WIN', 'DEFENDER_WIN', 'DRAW']).toContain(result.result);
    expect(result.attackerSnapshot.snapshotType).toBe('ATTACKER');
    expect(result.defenderSnapshot.snapshotType).toBe('DEFENDER');
    const row = await prisma.pvpBattle.findUnique({
      where: { id: result.battleId },
    });
    expect(row?.status).toBe('RESOLVED');
    expect(row?.result).toBe(result.result);
  });

  it('FRIENDLY_SPARRING → rewardGranted=false, ratingChange=null', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const r = await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'FRIENDLY_SPARRING',
    });
    expect(r.rewardGranted).toBe(false);
    expect(r.ratingChange).toBeNull();
    const row = await prisma.pvpBattle.findUnique({
      where: { id: r.battleId },
    });
    expect(row?.rewardGranted).toBe(false);
    expect(row?.rewardJson).toBeNull();
  });

  it('same-target cooldown blocks immediate re-challenge', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
    });
    await expect(
      battle.challenge({
        attackerCharacterId: a.characterId,
        defenderCharacterId: b.characterId,
        mode: 'DUEL',
      }),
    ).rejects.toMatchObject({ code: 'PVP_SAME_TARGET_COOLDOWN' });
  });

  it('idempotencyKey returns same battleId without creating dup row', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const key = 'idem-test-1';
    const r1 = await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
      idempotencyKey: key,
    });
    const r2 = await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
      idempotencyKey: key,
    });
    expect(r1.battleId).toBe(r2.battleId);
    const count = await prisma.pvpBattle.count();
    expect(count).toBe(1);
  });

  it('listLogs returns matches for character (both attacker + defender)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
    });
    const aLogs = await battle.listLogs(a.characterId);
    const bLogs = await battle.listLogs(b.characterId);
    expect(aLogs).toHaveLength(1);
    expect(bLogs).toHaveLength(1);
    expect(aLogs[0].id).toBe(bLogs[0].id);
  });

  it('invalidate flips status + zeroes rewardGranted', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const r = await battle.challenge({
      attackerCharacterId: a.characterId,
      defenderCharacterId: b.characterId,
      mode: 'DUEL',
    });
    const after = await battle.invalidate(r.battleId, 'admin test');
    expect(after.status).toBe('INVALIDATED');
    expect(after.rewardGranted).toBe(false);
  });

  it('invalidate throws PVP_BATTLE_NOT_FOUND for unknown id', async () => {
    await expect(
      battle.invalidate('nope-id', 'reason'),
    ).rejects.toBeInstanceOf(PvpBattleError);
  });
});

describe('PvpAnomalyService', () => {
  it('record creates row with auto-derived severity + blockReward', async () => {
    const c = await makeUserChar(prisma);
    const row = await anomalies.record({
      anomalyType: 'TERRITORY_PRODUCTION_DUPLICATE_CLAIM',
      characterId: c.characterId,
      detail: { window: '2026-W19' },
    });
    expect(row.severity).toBeGreaterThanOrEqual(0.9);
    expect(row.blockedReward).toBe(true);
  });

  it('list filters by status=PENDING (resolution null)', async () => {
    const c = await makeUserChar(prisma);
    await anomalies.record({
      anomalyType: 'PVP_DAMAGE_OUTLIER',
      characterId: c.characterId,
      detail: {},
    });
    const pending = await anomalies.list({ status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0].resolution).toBeNull();
  });

  it('resolve marks anomaly with resolvedBy + reason', async () => {
    const c = await makeUserChar(prisma);
    const a = await anomalies.record({
      anomalyType: 'PVP_DAMAGE_OUTLIER',
      characterId: c.characterId,
      detail: {},
    });
    const resolved = await anomalies.resolve(
      a.id,
      'admin-user-1',
      'DISMISSED',
      'false positive',
    );
    expect(resolved.resolution).toBe('DISMISSED');
    expect(resolved.resolvedBy).toBe('admin-user-1');
    expect(resolved.resolveReason).toBe('false positive');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('list filter by status=RESOLVED excludes pending', async () => {
    const c = await makeUserChar(prisma);
    const a = await anomalies.record({
      anomalyType: 'PVP_DAMAGE_OUTLIER',
      characterId: c.characterId,
      detail: {},
    });
    await anomalies.record({
      anomalyType: 'ARENA_TARGET_FARMING',
      characterId: c.characterId,
      detail: {},
    });
    await anomalies.resolve(a.id, 'admin', 'CONFIRMED', 'ok');
    const resolved = await anomalies.list({ status: 'RESOLVED' });
    const pending = await anomalies.list({ status: 'PENDING' });
    expect(resolved).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });
});
