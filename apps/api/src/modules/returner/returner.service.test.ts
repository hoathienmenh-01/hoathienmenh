import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ReturnerService } from './returner.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let mail: MailService;
let svc: ReturnerService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  mail = new MailService(prisma, currency, inventory, realtime);
  svc = new ReturnerService(prisma, mail);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('ReturnerService — Phase 31.0', () => {
  it('onLogin lần đầu (no prevLogin) → không trigger, state init', async () => {
    const u = await makeUserChar(prisma);
    const r = await svc.onLogin(u.userId);
    expect(r.tier).toBeNull();
    expect(r.mailId).toBeNull();
    const st = await svc.getState(u.userId);
    expect(st?.lastLoginAt).not.toBeNull();
    expect(st?.currentTier).toBeNull();
  });

  it('onLogin sau 8 ngày → tier=SHORT, gửi mail RETURNER', async () => {
    const u = await makeUserChar(prisma);
    const t0 = new Date('2026-01-01T00:00:00Z');
    await svc.onLogin(u.userId, t0);
    const t1 = new Date(t0.getTime() + 8 * 86_400_000); // 8 ngày sau
    const r = await svc.onLogin(u.userId, t1);
    expect(r.tier).toBe('SHORT');
    expect(r.mailId).not.toBeNull();
    const inbox = await mail.inbox(u.userId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].mailType).toBe('RETURNER');
    expect(inbox[0].rewardLinhThach).toBe('10000');
    expect(inbox[0].rewardTienNgoc).toBe(0); // Phase 31 cap.
  });

  it('onLogin idempotent: gọi 2 lần trong cùng UTC day KHÔNG tạo mail trùng', async () => {
    const u = await makeUserChar(prisma);
    const t0 = new Date('2026-01-01T00:00:00Z');
    await svc.onLogin(u.userId, t0);
    const t1 = new Date(t0.getTime() + 30 * 86_400_000);
    const r1 = await svc.onLogin(u.userId, t1);
    expect(r1.mailId).not.toBeNull();
    // Same cycle key → second call no-op.
    const t1b = new Date(t1.getTime() + 60 * 1000); // 1 min later, same day.
    const r2 = await svc.onLogin(u.userId, t1b);
    expect(r2.mailId).toBeNull();
    const inbox = await mail.inbox(u.userId);
    expect(inbox).toHaveLength(1);
  });

  it('onLogin sau 30 ngày → tier=LONG, reward > SHORT', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const t0 = new Date('2026-01-01T00:00:00Z');
    await svc.onLogin(u.userId, t0);
    const t1 = new Date(t0.getTime() + 30 * 86_400_000);
    const r = await svc.onLogin(u.userId, t1);
    expect(r.tier).toBe('LONG');
    const inbox = await mail.inbox(u.userId);
    expect(inbox[0].rewardLinhThach).toBe('100000');
  });

  it('reward tienNgoc = 0 luôn (Phase 31 hard cap)', async () => {
    const u = await makeUserChar(prisma);
    const t0 = new Date('2026-01-01T00:00:00Z');
    await svc.onLogin(u.userId, t0);
    const t1 = new Date(t0.getTime() + 30 * 86_400_000);
    await svc.onLogin(u.userId, t1);
    const inbox = await mail.inbox(u.userId);
    expect(inbox[0].rewardTienNgoc).toBe(0);
  });
});
