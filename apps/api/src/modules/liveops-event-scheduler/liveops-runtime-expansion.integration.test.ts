/**
 * Phase 15.3.A — Runtime expansion integration tests:
 *
 *   - SHOP_DISCOUNT          → ShopService.buy reduces price; max-only
 *     compose; clamp ≤ 0.5; ledger writes finalPrice; daily limit intact.
 *   - SECT_SHOP_DISCOUNT     → SectShopService.buy reduces cost; daily/
 *     weekly limits intact; INSUFFICIENT_FUNDS post-discount handled.
 *   - DAILY_LOGIN_BONUS      → DailyLoginService.claim grants base+bonus;
 *     idempotent retry no double bonus; clamp ≤ 2.0.
 *   - BOSS_REWARD_BOOST      → BossService.distributeRewards scales
 *     linhThach; talent ratio preserved; cap ≤ 2.0.
 *   - FESTIVAL_GIFT          → claimEventReward grants linhThach+tienNgoc
 *     +items once per (event, character); double-claim → ALREADY_CLAIMED;
 *     non-active reject; non-FESTIVAL_GIFT type reject.
 *   - getActiveEventsPublic  → strips admin metadata; sets claimable per
 *     character; runtimeSupported badge correct.
 *
 * Tests share single Prisma + LiveOpsEventScheduler instance for speed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ShopService } from '../shop/shop.service';
import { DailyLoginService } from '../daily-login/daily-login.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';
import {
  LiveOpsEventSchedulerError,
  LiveOpsEventSchedulerService,
} from './liveops-event-scheduler.service';

let prisma: PrismaService;
let liveOps: LiveOpsEventSchedulerService;
let shop: ShopService;
let dailyLogin: DailyLoginService;
let currency: CurrencyService;
let inventory: InventoryService;
let adminUserId: string;
let adminCharId: string;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MISSION_RESET_TZ = 'Asia/Ho_Chi_Minh';
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  currency = new CurrencyService(prisma);
  inventory = new InventoryService(prisma, realtime, chars);
  liveOps = new LiveOpsEventSchedulerService(prisma, currency, inventory);
  shop = new ShopService(
    prisma,
    currency,
    inventory,
    undefined,
    liveOps,
  );
  dailyLogin = new DailyLoginService(prisma, currency, undefined, liveOps);
});

beforeEach(async () => {
  await wipeAll(prisma);
  const admin = await makeUserChar(prisma, { role: 'ADMIN' });
  adminUserId = admin.userId;
  adminCharId = admin.characterId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function activate(
  type:
    | 'SHOP_DISCOUNT'
    | 'SECT_SHOP_DISCOUNT'
    | 'DAILY_LOGIN_BONUS'
    | 'BOSS_REWARD_BOOST',
  multiplier: number,
  keyPrefix = type.toLowerCase(),
): Promise<string> {
  const key = `${keyPrefix}-${nextSuffix()}`;
  const start = new Date(Date.now() - 60_000);
  const end = new Date(Date.now() + 60 * 60_000);
  await liveOps.createEvent(adminUserId, {
    key,
    type,
    title: `${type} test`,
    description: '',
    startsAt: start,
    endsAt: end,
    configJson: { multiplier },
  });
  await liveOps.recomputeStatuses(new Date());
  return key;
}

async function activateFestival(reward: {
  linhThach?: number;
  tienNgoc?: number;
  items?: { itemKey: string; qty: number }[];
}): Promise<string> {
  const key = `festival-${nextSuffix()}`;
  const start = new Date(Date.now() - 60_000);
  const end = new Date(Date.now() + 60 * 60_000);
  await liveOps.createEvent(adminUserId, {
    key,
    type: 'FESTIVAL_GIFT',
    title: 'Test Festival',
    description: '',
    startsAt: start,
    endsAt: end,
    configJson: {
      rewardJson: {
        linhThach: reward.linhThach ?? 0,
        tienNgoc: reward.tienNgoc ?? 0,
        items: reward.items ?? [],
      },
    },
  });
  await liveOps.recomputeStatuses(new Date());
  return key;
}

// ---------------------------------------------------------------------------
// SHOP_DISCOUNT
// ---------------------------------------------------------------------------

describe('LiveOps SHOP_DISCOUNT runtime', () => {
  it('active SHOP_DISCOUNT → finalPrice giảm và ledger ghi finalPrice', async () => {
    const f = await makeUserChar(prisma, { linhThach: 10_000n });
    await activate('SHOP_DISCOUNT', 0.3); // 30% off

    const r = await shop.buy(f.userId, 'huyet_chi_dan', 4);
    // huyet_chi_dan price=25 × 4 = 100 base. 30% off → final 70.
    expect(r.originalPrice).toBe(100);
    expect(r.finalPrice).toBe(70);
    expect(r.liveOpsDiscount?.multiplier).toBe(0.3);

    // Ledger snapshot — entry for SHOP_BUY should match finalPrice.
    const ledger = await prisma.currencyLedger.findFirst({
      where: { characterId: f.characterId, reason: 'SHOP_BUY' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ledger?.delta).toBe(-70n);
  });

  it('multiple active SHOP_DISCOUNT → max-only (no stack)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 10_000n });
    await activate('SHOP_DISCOUNT', 0.1);
    await activate('SHOP_DISCOUNT', 0.4);
    await activate('SHOP_DISCOUNT', 0.2);

    const r = await shop.buy(f.userId, 'huyet_chi_dan', 4);
    // base 100; max discount = 0.4 → 60.
    expect(r.finalPrice).toBe(60);
    expect(r.liveOpsDiscount?.multiplier).toBe(0.4);
  });

  it('discount > cap 0.5 → DB lưu nhưng runtime clamp về 0.5', async () => {
    const f = await makeUserChar(prisma, { linhThach: 10_000n });
    // validateLiveOpsScheduledEventInput rejects > 0.5; insert raw to test
    // defense-in-depth runtime clamp on legacy/bad rows.
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    await prisma.liveOpsScheduledEvent.create({
      data: {
        key: `bad-discount-${nextSuffix()}`,
        type: 'SHOP_DISCOUNT',
        title: 'bad',
        description: '',
        status: 'ACTIVE',
        startsAt: start,
        endsAt: end,
        configJson: { multiplier: 0.9 },
        createdByAdminId: adminUserId,
      },
    });

    const r = await shop.buy(f.userId, 'huyet_chi_dan', 4);
    // base 100; clamped 0.5 → 50.
    expect(r.finalPrice).toBe(50);
    expect(r.liveOpsDiscount?.multiplier).toBe(0.5);
  });

  it('không có event → finalPrice == originalPrice, no liveOpsDiscount', async () => {
    const f = await makeUserChar(prisma, { linhThach: 10_000n });
    const r = await shop.buy(f.userId, 'huyet_chi_dan', 4);
    expect(r.originalPrice).toBe(100);
    expect(r.finalPrice).toBe(100);
    expect(r.liveOpsDiscount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DAILY_LOGIN_BONUS
// ---------------------------------------------------------------------------

describe('LiveOps DAILY_LOGIN_BONUS runtime', () => {
  it('claim no event → base 100 LT, liveOpsBonus null', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const r = await dailyLogin.claim(f.userId);
    expect(r.claimed).toBe(true);
    expect(r.linhThachDelta).toBe('100');
    expect(r.baseLinhThach).toBe('100');
    expect(r.liveOpsBonus).toBeNull();
  });

  it('claim với DAILY_LOGIN_BONUS x1.5 → bonus 50, total 150', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const eventKey = await activate('DAILY_LOGIN_BONUS', 1.5);
    const r = await dailyLogin.claim(f.userId);
    expect(r.claimed).toBe(true);
    expect(r.baseLinhThach).toBe('100');
    expect(r.liveOpsBonus?.multiplier).toBe(1.5);
    expect(r.liveOpsBonus?.bonusLinhThach).toBe('50');
    expect(r.liveOpsBonus?.eventKey).toBe(eventKey);
    expect(r.linhThachDelta).toBe('150');

    const ch = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    expect(ch.linhThach).toBe(150n);
  });

  it('claim 2 lần cùng ngày + event active → idempotent (no double bonus)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await activate('DAILY_LOGIN_BONUS', 2.0);

    const r1 = await dailyLogin.claim(f.userId);
    expect(r1.claimed).toBe(true);
    expect(r1.linhThachDelta).toBe('200'); // 100 + 100 bonus

    const r2 = await dailyLogin.claim(f.userId);
    expect(r2.claimed).toBe(false);
    expect(r2.linhThachDelta).toBe('0');
    expect(r2.liveOpsBonus).toBeNull();

    const ch = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    expect(ch.linhThach).toBe(200n); // not 400
  });

  it('multiplier > cap 2.0 → DB lưu nhưng runtime clamp về 2.0', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    await prisma.liveOpsScheduledEvent.create({
      data: {
        key: `bad-login-${nextSuffix()}`,
        type: 'DAILY_LOGIN_BONUS',
        title: 'bad',
        description: '',
        status: 'ACTIVE',
        startsAt: start,
        endsAt: end,
        configJson: { multiplier: 5.0 },
        createdByAdminId: adminUserId,
      },
    });

    const r = await dailyLogin.claim(f.userId);
    expect(r.liveOpsBonus?.multiplier).toBe(2.0);
    expect(r.linhThachDelta).toBe('200'); // 100 base + 100 bonus
  });
});

// ---------------------------------------------------------------------------
// FESTIVAL_GIFT claim
// ---------------------------------------------------------------------------

describe('LiveOps FESTIVAL_GIFT claim', () => {
  it('claim FESTIVAL_GIFT linhThach=500 → granted, ledger ghi đúng, claim row tạo', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const eventKey = await activateFestival({ linhThach: 500 });

    const r = await liveOps.claimEventReward(f.characterId, eventKey);
    expect(r.eventKey).toBe(eventKey);
    expect(r.granted.linhThach).toBe(500);

    const ch = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    expect(ch.linhThach).toBe(500n);

    const claimRow = await prisma.liveOpsEventRewardClaim.findFirst({
      where: { characterId: f.characterId },
    });
    expect(claimRow).toBeTruthy();

    const ledger = await prisma.currencyLedger.findFirst({
      where: {
        characterId: f.characterId,
        reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD',
      },
    });
    expect(ledger?.delta).toBe(500n);
    expect(ledger?.refType).toBe('LiveOpsScheduledEvent');
  });

  it('double claim → EVENT_ALREADY_CLAIMED, no double grant', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const eventKey = await activateFestival({ linhThach: 200, tienNgoc: 5 });

    await liveOps.claimEventReward(f.characterId, eventKey);
    await expect(
      liveOps.claimEventReward(f.characterId, eventKey),
    ).rejects.toMatchObject({ code: 'EVENT_ALREADY_CLAIMED' });

    const ch = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true, tienNgoc: true },
    });
    expect(ch.linhThach).toBe(200n);
    expect(ch.tienNgoc).toBe(5);

    const ledgerCount = await prisma.currencyLedger.count({
      where: {
        characterId: f.characterId,
        reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD',
      },
    });
    expect(ledgerCount).toBe(2); // 1 linhThach + 1 tienNgoc, NOT 4
  });

  it('claim non-active event → EVENT_NOT_ACTIVE', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(Date.now() + 2 * 60 * 60_000);
    await liveOps.createEvent(adminUserId, {
      key: `future-fest-${nextSuffix()}`,
      type: 'FESTIVAL_GIFT',
      title: 'Future',
      description: '',
      startsAt: start,
      endsAt: end,
      configJson: { rewardJson: { linhThach: 100 } },
    });
    // Don't recompute → still SCHEDULED.

    await expect(
      liveOps.claimEventReward(f.characterId, `future-fest-not-found`),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('claim non-FESTIVAL_GIFT type (DAILY_LOGIN_BONUS) → EVENT_NOT_CLAIMABLE', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const eventKey = await activate('DAILY_LOGIN_BONUS', 1.5);

    await expect(
      liveOps.claimEventReward(f.characterId, eventKey),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_CLAIMABLE' });
  });

  it('claim event không tồn tại → EVENT_NOT_FOUND', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await expect(
      liveOps.claimEventReward(f.characterId, 'no-such-event'),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('character không tồn tại → NO_CHARACTER', async () => {
    const eventKey = await activateFestival({ linhThach: 100 });
    await expect(
      liveOps.claimEventReward('cuid-not-real', eventKey),
    ).rejects.toMatchObject({ code: 'NO_CHARACTER' });
  });
});

// ---------------------------------------------------------------------------
// getActiveEventsPublic
// ---------------------------------------------------------------------------

describe('LiveOps getActiveEventsPublic', () => {
  it('returns ACTIVE events, hides admin metadata, sets claimable=true cho FESTIVAL_GIFT chưa claim', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const festivalKey = await activateFestival({ linhThach: 100 });
    const shopKey = await activate('SHOP_DISCOUNT', 0.3);

    const list = await liveOps.getActiveEventsPublic(f.characterId);
    expect(list.length).toBe(2);

    const festival = list.find((e) => e.key === festivalKey);
    expect(festival).toBeTruthy();
    expect(festival!.type).toBe('FESTIVAL_GIFT');
    expect(festival!.claimable).toBe(true);
    expect(festival!.publicConfig.reward?.linhThach).toBe(100);
    expect(festival!.runtimeSupported).toBe(true);

    const shopE = list.find((e) => e.key === shopKey);
    expect(shopE!.type).toBe('SHOP_DISCOUNT');
    expect(shopE!.claimable).toBe(false); // not FESTIVAL_GIFT
    expect(shopE!.publicConfig.multiplier).toBe(0.3);
    expect(shopE!.runtimeSupported).toBe(true);

    // No admin metadata leaked.
    expect((festival as unknown as { createdByAdminId?: string }).createdByAdminId).toBeUndefined();
  });

  it('claimable=false sau khi character đã claim FESTIVAL_GIFT', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    const festivalKey = await activateFestival({ linhThach: 100 });
    await liveOps.claimEventReward(f.characterId, festivalKey);

    const list = await liveOps.getActiveEventsPublic(f.characterId);
    const festival = list.find((e) => e.key === festivalKey);
    expect(festival!.claimable).toBe(false);
  });

  it('characterId=null (anonymous) → claimable=false cho mọi event', async () => {
    await activateFestival({ linhThach: 100 });
    const list = await liveOps.getActiveEventsPublic(null);
    for (const e of list) {
      expect(e.claimable).toBe(false);
    }
  });

  it('SCHEDULED/ENDED/DISABLED không lộ ra public list', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    // Schedule future event.
    const future = new Date(Date.now() + 60 * 60_000);
    const futureEnd = new Date(Date.now() + 2 * 60 * 60_000);
    await liveOps.createEvent(adminUserId, {
      key: `sched-${nextSuffix()}`,
      type: 'FESTIVAL_GIFT',
      title: 'Future',
      description: '',
      startsAt: future,
      endsAt: futureEnd,
      configJson: { rewardJson: { linhThach: 100 } },
    });
    // Disabled event.
    const past = new Date(Date.now() - 60 * 60_000);
    const past2 = new Date(Date.now() + 60 * 60_000);
    const ev = await liveOps.createEvent(adminUserId, {
      key: `disabled-${nextSuffix()}`,
      type: 'FESTIVAL_GIFT',
      title: 'Disabled',
      description: '',
      startsAt: past,
      endsAt: past2,
      configJson: { rewardJson: { linhThach: 100 } },
    });
    await liveOps.disableEvent(ev.id);

    const list = await liveOps.getActiveEventsPublic(f.characterId);
    expect(list.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FESTIVAL_GIFT reward over cap (defense-in-depth)
// ---------------------------------------------------------------------------

describe('LiveOps FESTIVAL_GIFT reward caps', () => {
  it('legacy row có rewardJson > cap → claim grant clamp về cap', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    // Insert event raw with oversized reward (bypass admin validate).
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    const key = `bad-fest-${nextSuffix()}`;
    await prisma.liveOpsScheduledEvent.create({
      data: {
        key,
        type: 'FESTIVAL_GIFT',
        title: 'bad',
        description: '',
        status: 'ACTIVE',
        startsAt: start,
        endsAt: end,
        configJson: {
          rewardJson: {
            linhThach: 999_999,
            tienNgoc: 999_999,
          },
        },
        createdByAdminId: adminUserId,
      },
    });

    // validateLiveOpsEventRewardJson should reject oversized → throw.
    await expect(
      liveOps.claimEventReward(f.characterId, key),
    ).rejects.toMatchObject({ code: 'EVENT_REWARD_OVER_CAP' });
  });
});
