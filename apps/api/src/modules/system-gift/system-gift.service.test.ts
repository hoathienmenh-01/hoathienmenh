import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SystemGiftError, SystemGiftService } from './system-gift.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: SystemGiftService;
let mail: MailService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  mail = new MailService(prisma, currency, inventory, realtime);
  svc = new SystemGiftService(prisma, mail);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

const goodDef = (overrides: Partial<Parameters<SystemGiftService['upsertDef']>[0]> = {}) => ({
  giftKey: 'maintenance_2026_01',
  title: 'Quà bảo trì',
  body: 'Tạ lỗi server downtime',
  reward: {
    linhThach: '1000',
    tienNgoc: 0,
    exp: '5000',
    items: [],
  },
  targetRule: { type: 'ALL_PLAYERS' as const },
  expiresAt: null,
  createdByAdminId: null,
  ...overrides,
});

describe('SystemGiftService — Phase 31.0', () => {
  it('upsertDef: tạo gift hợp lệ + read back', async () => {
    const def = await svc.upsertDef(goodDef(), 'admin-1');
    expect(def.giftKey).toBe('maintenance_2026_01');
    const got = await svc.get('maintenance_2026_01');
    expect(got?.title).toBe('Quà bảo trì');
  });

  it('upsertDef: INVALID_DEF khi reward tiên ngọc > 0', async () => {
    await expect(
      svc.upsertDef(
        goodDef({
          reward: {
            linhThach: '0',
            tienNgoc: 100, // Phase 31 cap = 0.
            exp: '0',
            items: [],
          },
        }),
        null,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEF' });
  });

  it('upsertDef: INVALID_DEF khi item bị forbidden (endgame)', async () => {
    await expect(
      svc.upsertDef(
        goodDef({
          reward: {
            linhThach: '0',
            tienNgoc: 0,
            exp: '0',
            items: [{ itemKey: 'tien_huyen_kiem', qty: 1 }],
          },
        }),
        null,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEF' });
  });

  it('distribute: tạo 1 mail / character matching ALL_PLAYERS rule', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    await svc.upsertDef(goodDef(), null);
    const r = await svc.distribute('maintenance_2026_01', null);
    expect(r.matchedCount).toBe(2);
    expect(r.createdMailCount).toBe(2);
    expect(r.skippedAlreadyClaimedCount).toBe(0);

    const inbox1 = await mail.inbox(u1.userId);
    const inbox2 = await mail.inbox(u2.userId);
    expect(inbox1).toHaveLength(1);
    expect(inbox2).toHaveLength(1);
    expect(inbox1[0].mailType).toBe('REWARD');
  });

  it('distribute idempotent: gọi 2 lần KHÔNG tạo mail trùng', async () => {
    await makeUserChar(prisma);
    await svc.upsertDef(goodDef(), null);
    const r1 = await svc.distribute('maintenance_2026_01', null);
    const r2 = await svc.distribute('maintenance_2026_01', null);
    expect(r1.createdMailCount).toBe(1);
    expect(r2.createdMailCount).toBe(0);
    expect(r2.skippedAlreadyClaimedCount).toBe(1);
  });

  it('GIFT_NOT_FOUND khi distribute giftKey không tồn tại', async () => {
    await expect(
      svc.distribute('khong_co', null),
    ).rejects.toBeInstanceOf(SystemGiftError);
  });

  it('GIFT_EXPIRED khi expiresAt trong quá khứ', async () => {
    await svc.upsertDef(
      goodDef({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      null,
    );
    await expect(
      svc.distribute('maintenance_2026_01', null),
    ).rejects.toMatchObject({ code: 'GIFT_EXPIRED' });
  });

  it('resolveTargets REALM_RANGE: filter theo tier', async () => {
    const lo = await makeUserChar(prisma, { realmKey: 'luyenkhi' }); // order=1
    const hi = await makeUserChar(prisma, { realmKey: 'do_kiep' }); // order=9
    const ids = await svc.resolveTargets({
      type: 'REALM_RANGE',
      realmTierMin: 5,
      realmTierMax: 28,
    });
    expect(ids).toContain(hi.characterId);
    expect(ids).not.toContain(lo.characterId);
  });
});
