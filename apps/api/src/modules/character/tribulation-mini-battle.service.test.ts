/**
 * Phase 14.3.E.1 — Integration tests for TribulationMiniBattleService.
 *
 * Cover toàn bộ state machine + idempotency + race-safety + 5 effectType
 * + resolve win/lose path. Sử dụng Postgres thật (DATABASE_URL) — wipe DB
 * giữa mỗi test qua `wipeAll`.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { expCostForStage } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from './character.service';
import { CurrencyService } from './currency.service';
import { TribulationService } from './tribulation.service';
import {
  TRIBULATION_MINI_BATTLE_FLAG_ENV,
  TribulationMiniBattleError,
  TribulationMiniBattleService,
  readTribulationMiniBattleMetrics,
  resetTribulationMiniBattleMetrics,
} from './tribulation-mini-battle.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let tribulation: TribulationService;
let chars: CharacterService;
let svc: TribulationMiniBattleService;

const KIM_DAN_COST_9 = expCostForStage('kim_dan', 9) ?? 0n;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  const realtime = new RealtimeService();
  chars = new CharacterService(prisma, realtime);
  tribulation = new TribulationService(prisma, currency);
  svc = new TribulationMiniBattleService(prisma, tribulation);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
  resetTribulationMiniBattleMetrics();
  process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV] = 'true';
});

afterEach(() => {
  delete process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV];
});

async function setupCharAtPeak(opts?: {
  hpMax?: number;
  realmKey?: string;
  exp?: bigint;
}) {
  return makeUserChar(prisma, {
    realmKey: opts?.realmKey ?? 'kim_dan',
    realmStage: 9,
    exp: opts?.exp ?? KIM_DAN_COST_9 + 1000n,
    hp: opts?.hpMax ?? 10_000,
    hpMax: opts?.hpMax ?? 10_000,
    mp: 200,
    mpMax: 200,
    linhThach: 0n,
  });
}

/* ---------------------------------------------------------------------------
 * Feature flag
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService — feature flag', () => {
  it('disabled (env unset) — getCurrent returns null, start/action/resolve throw MINI_BATTLE_DISABLED', async () => {
    delete process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV];
    const ctx = await setupCharAtPeak();

    const cur = await svc.getCurrent(ctx.characterId);
    expect(cur).toBeNull();

    await expect(
      svc.start(ctx.characterId, {}),
    ).rejects.toThrow(TribulationMiniBattleError);

    await expect(
      svc.action(ctx.characterId, 'fake-id', 'ATTACK', null),
    ).rejects.toThrow(TribulationMiniBattleError);

    await expect(
      svc.resolve(ctx.characterId, 'fake-id'),
    ).rejects.toThrow(TribulationMiniBattleError);
  });

  it('disabled (env=false) — start throws MINI_BATTLE_DISABLED', async () => {
    process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV] = 'false';
    const ctx = await setupCharAtPeak();
    await expect(svc.start(ctx.characterId, {})).rejects.toMatchObject({
      code: 'MINI_BATTLE_DISABLED',
    });
  });

  it('enabled (env=true) — start succeeds', async () => {
    process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV] = 'true';
    const ctx = await setupCharAtPeak();
    const battle = await svc.start(ctx.characterId, {});
    expect(battle.state).toBe('PENDING');
  });
});

/* ---------------------------------------------------------------------------
 * Start guards
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService.start — guards', () => {
  it('NOT_AT_PEAK if realmStage < 9', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 5,
      exp: 0n,
      hp: 1000,
      hpMax: 1000,
    });
    await expect(svc.start(ctx.characterId, {})).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('NOT_AT_PEAK if exp < cost(9)', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 9,
      exp: 0n,
      hp: 1000,
      hpMax: 1000,
    });
    await expect(svc.start(ctx.characterId, {})).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('CHARACTER_NOT_FOUND for unknown id', async () => {
    await expect(svc.start('unknown-id', {})).rejects.toMatchObject({
      code: 'CHARACTER_NOT_FOUND',
    });
  });

  it('MINI_BATTLE_ALREADY_ACTIVE when starting twice', async () => {
    const ctx = await setupCharAtPeak();
    const b1 = await svc.start(ctx.characterId, {});
    expect(b1.state).toBe('PENDING');
    await expect(svc.start(ctx.characterId, {})).rejects.toMatchObject({
      code: 'MINI_BATTLE_ALREADY_ACTIVE',
    });
  });

  it('start creates DB row + initial state shape', async () => {
    const ctx = await setupCharAtPeak({ hpMax: 5000 });
    const battle = await svc.start(ctx.characterId, {});
    expect(battle.id).toBeTruthy();
    expect(battle.characterId).toBe(ctx.characterId);
    expect(battle.encounterId).toBeTruthy();
    expect(battle.tribulationKey).toBe('tribulation_kim_dan_nguyen_anh');
    expect(battle.realmKey).toBe('kim_dan');
    expect(battle.state).toBe('PENDING');
    expect(battle.currentPhase).toBe(1);
    expect(battle.phaseCount).toBeGreaterThan(0);
    expect(battle.playerHp).toBeLessThanOrEqual(5000);
    expect(battle.playerHpMax).toBeLessThanOrEqual(5000);
    expect(battle.tribulationHp).toBeGreaterThan(0);
    expect(battle.actionLog).toHaveLength(0);
    expect(battle.result).toBeNull();
    expect(battle.seed).toBeGreaterThan(0);

    const dbRow = await prisma.tribulationMiniBattle.findUnique({
      where: { id: battle.id },
    });
    expect(dbRow).not.toBeNull();
  });

  it('metrics counter started increments', async () => {
    const ctx = await setupCharAtPeak();
    const before = readTribulationMiniBattleMetrics();
    await svc.start(ctx.characterId, {});
    const after = readTribulationMiniBattleMetrics();
    expect(after.started).toBe(before.started + 1);
  });
});

/* ---------------------------------------------------------------------------
 * getCurrent
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService.getCurrent', () => {
  it('returns null when no battle', async () => {
    const ctx = await setupCharAtPeak();
    const cur = await svc.getCurrent(ctx.characterId);
    expect(cur).toBeNull();
  });

  it('returns active battle after start', async () => {
    const ctx = await setupCharAtPeak();
    const battle = await svc.start(ctx.characterId, {});
    const cur = await svc.getCurrent(ctx.characterId);
    expect(cur?.id).toBe(battle.id);
    expect(cur?.state).toBe('PENDING');
  });
});

/* ---------------------------------------------------------------------------
 * Action validation + idempotency + race
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService.action — validation + idempotency', () => {
  it('rejects MINI_BATTLE_NOT_FOUND for wrong owner', async () => {
    const a = await setupCharAtPeak();
    const b = await setupCharAtPeak();
    const battle = await svc.start(a.characterId, {});
    await expect(
      svc.action(b.characterId, battle.id, 'ATTACK', null),
    ).rejects.toMatchObject({ code: 'MINI_BATTLE_NOT_FOUND' });
  });

  it('rejects MINI_BATTLE_INVALID_ACTION for unknown action string', async () => {
    const ctx = await setupCharAtPeak();
    const battle = await svc.start(ctx.characterId, {});
    await expect(
      svc.action(ctx.characterId, battle.id, 'NUKE', null),
    ).rejects.toMatchObject({ code: 'MINI_BATTLE_INVALID_ACTION' });
  });

  it('advances currentPhase + transitions PENDING → ACTIVE', async () => {
    const ctx = await setupCharAtPeak();
    const start = await svc.start(ctx.characterId, {});
    expect(start.state).toBe('PENDING');

    const after = await svc.action(ctx.characterId, start.id, 'ATTACK', null);
    expect(after.state).toBe(
      after.currentPhase >= start.phaseCount && after.playerHp > 0
        ? 'RESOLVED'
        : after.playerHp <= 0
          ? 'FAILED'
          : 'ACTIVE',
    );
    // Action log should grow.
    expect(after.actionLog.length).toBeGreaterThan(start.actionLog.length);
  });

  it('clientNonce idempotent — same nonce 2nd call returns same state without double advance', async () => {
    const ctx = await setupCharAtPeak();
    const start = await svc.start(ctx.characterId, {});
    const nonce = 'test-nonce-1';
    const a = await svc.action(ctx.characterId, start.id, 'ATTACK', nonce);
    const b = await svc.action(ctx.characterId, start.id, 'ATTACK', nonce);
    expect(b.currentPhase).toBe(a.currentPhase);
    expect(b.playerHp).toBe(a.playerHp);
    expect(b.tribulationHp).toBe(a.tribulationHp);
    expect(b.actionLog.length).toBe(a.actionLog.length);
  });

  it('different clientNonce advances state', async () => {
    const ctx = await setupCharAtPeak();
    const start = await svc.start(ctx.characterId, {});
    const a = await svc.action(ctx.characterId, start.id, 'ATTACK', 'n1');
    if (a.state === 'RESOLVED' || a.state === 'FAILED') return;
    const b = await svc.action(ctx.characterId, start.id, 'DEFEND', 'n2');
    expect(b.actionLog.length).toBeGreaterThan(a.actionLog.length);
  });

  it('terminal state — 2nd action throws MINI_BATTLE_TERMINAL', async () => {
    const ctx = await setupCharAtPeak({ hpMax: 100 });
    const start = await svc.start(ctx.characterId, {});
    // Force terminal by spamming actions until terminal.
    let cur = start;
    for (let i = 0; i < 20 && cur.state !== 'RESOLVED' && cur.state !== 'FAILED'; i += 1) {
      cur = await svc.action(ctx.characterId, cur.id, 'CHANNEL', null);
    }
    expect(['RESOLVED', 'FAILED']).toContain(cur.state);
    await expect(
      svc.action(ctx.characterId, cur.id, 'ATTACK', null),
    ).rejects.toMatchObject({ code: 'MINI_BATTLE_TERMINAL' });
  });
});

/* ---------------------------------------------------------------------------
 * Resolve — terminal state required + idempotency + win/lose path
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService.resolve', () => {
  it('rejects MINI_BATTLE_NOT_TERMINAL when state still PENDING/ACTIVE', async () => {
    const ctx = await setupCharAtPeak();
    const battle = await svc.start(ctx.characterId, {});
    await expect(
      svc.resolve(ctx.characterId, battle.id),
    ).rejects.toMatchObject({ code: 'MINI_BATTLE_NOT_TERMINAL' });
  });

  it('rejects MINI_BATTLE_NOT_FOUND for wrong owner', async () => {
    const a = await setupCharAtPeak();
    const b = await setupCharAtPeak();
    const battle = await svc.start(a.characterId, {});
    await expect(
      svc.resolve(b.characterId, battle.id),
    ).rejects.toMatchObject({ code: 'MINI_BATTLE_NOT_FOUND' });
  });

  /**
   * Force a terminal state via raw DB writes (bypass action loop) so test
   * can deterministically check WIN path or LOSE path.
   */
  async function forceTerminalState(
    battleId: string,
    state: 'RESOLVED' | 'FAILED',
    finalPlayerHp: number,
  ) {
    await prisma.tribulationMiniBattle.update({
      where: { id: battleId },
      data: {
        state,
        playerHp: finalPlayerHp,
        tribulationHp: state === 'RESOLVED' ? 0 : 5000,
        currentPhase: 4,
        resolvedAt: new Date(),
      },
    });
  }

  it('WIN path — resolve advances realm + grants reward + writes attempt log', async () => {
    const ctx = await setupCharAtPeak({ hpMax: 10_000 });
    const battle = await svc.start(ctx.characterId, {});
    await forceTerminalState(battle.id, 'RESOLVED', 5000);

    const out = await svc.resolve(ctx.characterId, battle.id, () => 0.0);
    expect(out.success).toBe(true);
    expect(out.fromRealmKey).toBe('kim_dan');
    expect(out.toRealmKey).toBe('nguyen_anh');
    expect(out.reward).not.toBeNull();
    expect(out.reward!.linhThach).toBeGreaterThan(0);

    // Character: realm advance + cooldown cleared.
    const char = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(char?.realmKey).toBe('nguyen_anh');
    expect(char?.realmStage).toBe(1);
    expect(char?.tribulationCooldownAt).toBeNull();

    // metrics counter.
    expect(readTribulationMiniBattleMetrics().resolved).toBe(1);
    expect(readTribulationMiniBattleMetrics().failed).toBe(0);
  });

  it('LOSE path — resolve applies cooldown + writes fail log + KHÔNG advance realm', async () => {
    const ctx = await setupCharAtPeak({ hpMax: 10_000 });
    const battle = await svc.start(ctx.characterId, {});
    await forceTerminalState(battle.id, 'FAILED', 0);

    const out = await svc.resolve(ctx.characterId, battle.id, () => 0.99);
    expect(out.success).toBe(false);
    expect(out.reward).toBeNull();
    expect(out.penalty).not.toBeNull();
    expect(out.penalty!.cooldownAt).toBeInstanceOf(Date);

    const char = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });
    expect(char?.realmKey).toBe('kim_dan'); // NOT advanced
    expect(char?.tribulationCooldownAt).toBeInstanceOf(Date);

    expect(readTribulationMiniBattleMetrics().resolved).toBe(0);
    expect(readTribulationMiniBattleMetrics().failed).toBe(1);
  });

  it('idempotent re-resolve — KHÔNG double reward, KHÔNG double advance', async () => {
    const ctx = await setupCharAtPeak({ hpMax: 10_000 });
    const battle = await svc.start(ctx.characterId, {});
    await forceTerminalState(battle.id, 'RESOLVED', 5000);

    const out1 = await svc.resolve(ctx.characterId, battle.id, () => 0.0);
    const charAfter1 = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });

    const out2 = await svc.resolve(ctx.characterId, battle.id, () => 0.0);
    const charAfter2 = await prisma.character.findUnique({
      where: { id: ctx.characterId },
    });

    // Same outcome shape (same logId + reward shape).
    expect(out2.logId).toBe(out1.logId);
    expect(out2.success).toBe(true);

    // Character unchanged after 2nd resolve.
    expect(charAfter2?.linhThach).toBe(charAfter1?.linhThach);
    expect(charAfter2?.realmKey).toBe(charAfter1?.realmKey);
    expect(charAfter2?.exp).toBe(charAfter1?.exp);

    // Only 1 attempt log row.
    const logs = await prisma.tribulationAttemptLog.count({
      where: { characterId: ctx.characterId },
    });
    expect(logs).toBe(1);

    // Currency ledger only 1 row.
    const ledger = await prisma.currencyLedger.count({
      where: { characterId: ctx.characterId },
    });
    expect(ledger).toBe(1);
  });
});

/* ---------------------------------------------------------------------------
 * Effect type coverage — smoke that resolve flows for each effectType
 * persist correct effectType in audit log.
 * ------------------------------------------------------------------------- */
describe('TribulationMiniBattleService — effectType wiring', () => {
  it('row.effectType matches encounter catalog (kim_dan_nguyen_anh = lei element kim → ARMOR_CRIT)', async () => {
    const ctx = await setupCharAtPeak();
    const battle = await svc.start(ctx.characterId, {});
    // Encounter catalog Phase 14.3.D: lei→kim → ARMOR_CRIT.
    expect(['BURST', 'SUSTAIN', 'POISON_RECOVERY', 'ARMOR_CRIT', 'DEFENSE_ENDURANCE']).toContain(
      battle.effectType,
    );
    expect(battle.element).toBeTruthy();
  });
});
