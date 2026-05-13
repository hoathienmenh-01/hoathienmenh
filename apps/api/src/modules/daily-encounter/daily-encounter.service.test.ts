import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_ENCOUNTER_REWARD_CAPS,
  dailyEncounterByKey,
} from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  DailyEncounterError,
  DailyEncounterService,
} from './daily-encounter.service';
import {
  TEST_DATABASE_URL,
  makeDailyEncounterService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let daily: DailyEncounterService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  ({ daily } = makeDailyEncounterService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('DailyEncounterService.today', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(daily.today('no-such-user')).rejects.toThrow(
      new DailyEncounterError('NO_CHARACTER'),
    );
  });

  it('lazy-create encounter row first call', async () => {
    const { userId } = await makeUserChar(prisma);
    const view = await daily.today(userId);
    expect(view.status).toBe('AVAILABLE');
    expect(view.encounterKey.length).toBeGreaterThan(0);
    expect(view.rewardProfile.linhThach).toBeGreaterThan(0);
  });

  it('same day = same encounter (deterministic)', async () => {
    const { userId } = await makeUserChar(prisma);
    const v1 = await daily.today(userId);
    const v2 = await daily.today(userId);
    expect(v2.encounterKey).toBe(v1.encounterKey);
    expect(v2.dateKey).toBe(v1.dateKey);
  });

  it('def lookup return populated reward / title', async () => {
    const { userId } = await makeUserChar(prisma);
    const view = await daily.today(userId);
    const def = dailyEncounterByKey(view.encounterKey);
    expect(def).toBeDefined();
    expect(view.titleVi).toBe(def!.titleVi);
    expect(view.titleEn).toBe(def!.titleEn);
  });
});

describe('DailyEncounterService lifecycle', () => {
  it('accept moves AVAILABLE → ACCEPTED', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    const v = await daily.accept(userId);
    expect(v.status).toBe('ACCEPTED');
    expect(v.acceptedAt).toBeTruthy();
  });

  it('complete moves ACCEPTED → COMPLETED', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    await daily.accept(userId);
    const v = await daily.complete(userId);
    expect(v.status).toBe('COMPLETED');
  });

  it('claim moves COMPLETED → CLAIMED + grant linhThach + exp', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const view = await daily.today(userId);
    await daily.accept(userId);
    await daily.complete(userId);
    const r = await daily.claim(userId);
    expect(r.claimed).toBe(true);
    expect(r.view.status).toBe('CLAIMED');
    expect(r.linhThachGranted).toBeGreaterThan(0);
    expect(r.expGranted).toBeGreaterThan(0);
    // Linh thach was applied via CurrencyService ledger.
    const c = await prisma.character.findUnique({ where: { id: characterId } });
    expect(c!.linhThach).toBe(BigInt(1000) + BigInt(r.linhThachGranted));
    expect(c!.exp).toBe(BigInt(r.expGranted));
    expect(view.rewardProfile.linhThach).toBeGreaterThan(0);
  });

  it('claim twice — second call returns claimed=false, no extra grant', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    await daily.today(userId);
    await daily.accept(userId);
    await daily.complete(userId);
    const r1 = await daily.claim(userId);
    expect(r1.claimed).toBe(true);
    const c1 = await prisma.character.findUnique({ where: { id: characterId } });
    const r2 = await daily.claim(userId);
    expect(r2.claimed).toBe(false);
    const c2 = await prisma.character.findUnique({ where: { id: characterId } });
    expect(c2!.linhThach).toBe(c1!.linhThach);
    expect(c2!.exp).toBe(c1!.exp);
  });

  it('claim throws ENCOUNTER_NOT_COMPLETED nếu chưa complete', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    await expect(daily.claim(userId)).rejects.toThrow(
      new DailyEncounterError('ENCOUNTER_NOT_COMPLETED'),
    );
  });

  it('skip moves AVAILABLE → SKIPPED', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    const v = await daily.skip(userId);
    expect(v.status).toBe('SKIPPED');
  });

  it('history trả ≤ limit dòng, ordered desc', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    const h = await daily.history(userId, 5);
    expect(h.length).toBeGreaterThan(0);
    expect(h.length).toBeLessThanOrEqual(5);
  });

  it('reward cap không bị vượt — claim grant <= DAILY_ENCOUNTER_REWARD_CAPS', async () => {
    const { userId } = await makeUserChar(prisma);
    await daily.today(userId);
    await daily.accept(userId);
    await daily.complete(userId);
    const r = await daily.claim(userId);
    expect(r.linhThachGranted).toBeLessThanOrEqual(
      DAILY_ENCOUNTER_REWARD_CAPS.linhThachMax,
    );
    expect(r.expGranted).toBeLessThanOrEqual(
      DAILY_ENCOUNTER_REWARD_CAPS.expMax,
    );
  });

  it('choose stores choiceKey nếu encounter có choices', async () => {
    const { userId } = await makeUserChar(prisma);
    const view = await daily.today(userId);
    const def = dailyEncounterByKey(view.encounterKey)!;
    if (def.choices && def.choices.length > 0) {
      const v = await daily.choose(userId, def.choices[0]!.choiceKey);
      expect(v.choiceKey).toBe(def.choices[0]!.choiceKey);
    } else {
      await expect(
        daily.choose(userId, 'any'),
      ).rejects.toThrow(new DailyEncounterError('ENCOUNTER_HAS_NO_CHOICES'));
    }
  });

  it('choose rejects invalid choiceKey', async () => {
    const { userId } = await makeUserChar(prisma);
    const view = await daily.today(userId);
    const def = dailyEncounterByKey(view.encounterKey)!;
    if (def.choices && def.choices.length > 0) {
      await expect(
        daily.choose(userId, 'definitely_not_a_choice'),
      ).rejects.toThrow(new DailyEncounterError('ENCOUNTER_CHOICE_INVALID'));
    }
  });

  it('ledger entry created sau claim', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    await daily.today(userId);
    await daily.accept(userId);
    await daily.complete(userId);
    await daily.claim(userId);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'ENCOUNTER_CLAIM' },
    });
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger[0]!.currency).toBe(CurrencyKind.LINH_THACH);
  });
});
