/**
 * Phase 13.1.B — AdminLiveOpsService integration tests.
 *
 * Coverage matrix:
 *   - getStatus: trả ra `tz` + catalog `events` + computed `todayKeys`
 *     `activeKeys` đúng shape, `effectiveEnabled` mirror catalog AND override.
 *   - toggleEvent: upsert `LiveOpsEventOverride` (create + update path),
 *     ghi `AdminAuditLog` action `ADMIN_LIVEOPS_OVERRIDE` với meta đầy đủ.
 *   - toggleEvent EVENT_NOT_FOUND: key không có trong catalog → throw, không
 *     mutate DB.
 *   - toggleEvent INVALID_INPUT: startsAt > endsAt → throw, không mutate.
 *   - getSectWarStatus: aggregate đúng số sect / contributors / contributions
 *     từ `SectWarContribution`, ranking sort theo points desc.
 *   - recalculateSectWar: no-op trả `{ noop: true, weekKey }`, log
 *     `ADMIN_SECT_WAR_RECALCULATE` audit, KHÔNG đụng tới contribution rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_OPS_DEFAULT_TZ, LIVE_OPS_EVENTS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { AdminLiveOpsService } from './admin-liveops.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let svc: AdminLiveOpsService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new AdminLiveOpsService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AdminLiveOpsService.getStatus', () => {
  it('trả về tz + catalog events + todayKeys/activeKeys đúng shape; KHÔNG override → effectiveEnabled mirror catalog', async () => {
    const view = await svc.getStatus();

    expect(view.tz).toBe(LIVE_OPS_DEFAULT_TZ);
    expect(view.events.length).toBe(LIVE_OPS_EVENTS.length);
    expect(Array.isArray(view.todayKeys)).toBe(true);
    expect(Array.isArray(view.activeKeys)).toBe(true);

    // Mỗi event row phải có đủ field shape cơ bản.
    for (const ev of view.events) {
      expect(typeof ev.key).toBe('string');
      expect(typeof ev.type).toBe('string');
      expect(typeof ev.catalogEnabled).toBe('boolean');
      expect(typeof ev.effectiveEnabled).toBe('boolean');
      expect(typeof ev.titleI18nKey).toBe('string');
      expect(typeof ev.descriptionI18nKey).toBe('string');
      expect(ev.override).toBeNull();
      // catalog enabled === effective khi không có override.
      expect(ev.effectiveEnabled).toBe(ev.catalogEnabled);
    }
  });

  it('override.enabled=false → effectiveEnabled=false; override row hiện ra trong response', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;

    await prisma.liveOpsEventOverride.create({
      data: {
        key: targetKey,
        enabled: false,
        startsAt: null,
        endsAt: null,
        reason: 'maintenance',
        updatedBy: adminU.userId,
      },
    });

    const view = await svc.getStatus();
    const ev = view.events.find((e) => e.key === targetKey);
    expect(ev).toBeDefined();
    expect(ev!.effectiveEnabled).toBe(false);
    expect(ev!.override).not.toBeNull();
    expect(ev!.override!.enabled).toBe(false);
    expect(ev!.override!.reason).toBe('maintenance');
    // todayKeys/activeKeys filter theo effective → KHÔNG chứa key này.
    expect(view.todayKeys).not.toContain(targetKey);
    expect(view.activeKeys).not.toContain(targetKey);
  });
});

describe('AdminLiveOpsService.toggleEvent', () => {
  it('toggleEvent CREATE: upsert override row + audit ADMIN_LIVEOPS_OVERRIDE với meta đầy đủ', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;

    const result = await svc.toggleEvent(adminU.userId, {
      key: targetKey,
      enabled: false,
      startsAt: null,
      endsAt: null,
      reason: 'incident smoke',
    });
    expect(result.key).toBe(targetKey);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('incident smoke');
    expect(result.updatedBy).toBe(adminU.userId);

    const row = await prisma.liveOpsEventOverride.findUniqueOrThrow({
      where: { key: targetKey },
    });
    expect(row.enabled).toBe(false);
    expect(row.reason).toBe('incident smoke');
    expect(row.updatedBy).toBe(adminU.userId);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_LIVEOPS_OVERRIDE' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.targetType).toBe('LiveOpsEvent');
    expect(meta.targetId).toBe(targetKey);
    expect(meta.enabled).toBe(false);
    expect(meta.reason).toBe('incident smoke');
    expect(typeof meta.catalogEnabled).toBe('boolean');
  });

  it('toggleEvent UPDATE: 2 lần → 1 row override (upsert), 2 row audit', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;

    await svc.toggleEvent(adminU.userId, {
      key: targetKey,
      enabled: false,
      reason: 'first',
    });
    await svc.toggleEvent(adminU.userId, {
      key: targetKey,
      enabled: true,
      reason: 'reverted',
    });

    const rows = await prisma.liveOpsEventOverride.findMany({
      where: { key: targetKey },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].reason).toBe('reverted');

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'ADMIN_LIVEOPS_OVERRIDE' },
    });
    expect(audits).toHaveLength(2);
  });

  it('toggleEvent EVENT_NOT_FOUND: key vô danh → throw, không mutate DB', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      svc.toggleEvent(adminU.userId, {
        key: 'totally_unknown_event_xyz',
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });

    const overrides = await prisma.liveOpsEventOverride.findMany({});
    expect(overrides).toHaveLength(0);
    const audits = await prisma.adminAuditLog.findMany({
      where: { action: 'ADMIN_LIVEOPS_OVERRIDE' },
    });
    expect(audits).toHaveLength(0);
  });

  it('toggleEvent INVALID_INPUT: startsAt > endsAt → throw, không mutate DB', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;

    await expect(
      svc.toggleEvent(adminU.userId, {
        key: targetKey,
        enabled: true,
        startsAt: new Date('2030-01-10T00:00:00Z'),
        endsAt: new Date('2030-01-01T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const overrides = await prisma.liveOpsEventOverride.findMany({});
    expect(overrides).toHaveLength(0);
  });
});

describe('AdminLiveOpsService.getSectWarStatus', () => {
  it('aggregate đúng totalSects / totalContributors / totalContributions, top sort points desc', async () => {
    const f1 = await makeUserChar(prisma);
    const f2 = await makeUserChar(prisma);
    const f3 = await makeUserChar(prisma);
    const sectA = await prisma.sect.create({
      data: {
        name: `SA-${nextSuffix()}`,
        description: '',
        leaderId: f1.characterId,
        treasuryLinhThach: 0n,
      },
    });
    const sectB = await prisma.sect.create({
      data: {
        name: `SB-${nextSuffix()}`,
        description: '',
        leaderId: f2.characterId,
        treasuryLinhThach: 0n,
      },
    });
    await prisma.character.update({
      where: { id: f1.characterId },
      data: { sectId: sectA.id },
    });
    await prisma.character.update({
      where: { id: f2.characterId },
      data: { sectId: sectB.id },
    });
    await prisma.character.update({
      where: { id: f3.characterId },
      data: { sectId: sectA.id },
    });

    const weekKey = '2030-W10';
    // SectA: f1 = 100, f3 = 50 → 150 total; 2 contributors.
    await prisma.sectWarContribution.create({
      data: {
        characterId: f1.characterId,
        sectId: sectA.id,
        weekKey,
        activityKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 'dr1',
        points: 100,
      },
    });
    await prisma.sectWarContribution.create({
      data: {
        characterId: f3.characterId,
        sectId: sectA.id,
        weekKey,
        activityKey: 'boss_top_damage',
        sourceType: 'WorldBoss',
        sourceId: 'wb1',
        points: 50,
      },
    });
    // SectB: f2 = 200; 1 contributor.
    await prisma.sectWarContribution.create({
      data: {
        characterId: f2.characterId,
        sectId: sectB.id,
        weekKey,
        activityKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 'dr2',
        points: 200,
      },
    });

    const view = await svc.getSectWarStatus(weekKey);
    expect(view.weekKey).toBe(weekKey);
    expect(view.totalSects).toBe(2);
    expect(view.totalContributors).toBe(3);
    expect(view.totalContributions).toBe(3);
    expect(view.topSects).toHaveLength(2);
    expect(view.topSects[0].sectId).toBe(sectB.id); // 200 > 150
    expect(view.topSects[0].points).toBe(200);
    expect(view.topSects[0].contributors).toBe(1);
    expect(view.topSects[1].sectId).toBe(sectA.id);
    expect(view.topSects[1].points).toBe(150);
    expect(view.topSects[1].contributors).toBe(2);
  });

  it('weekKey trống → trả 0 sects / 0 contributors, topSects=[]', async () => {
    const view = await svc.getSectWarStatus('2099-W52');
    expect(view.totalSects).toBe(0);
    expect(view.totalContributors).toBe(0);
    expect(view.totalContributions).toBe(0);
    expect(view.topSects).toEqual([]);
  });
});

describe('AdminLiveOpsService.recalculateSectWar', () => {
  it('recalc no-op: trả { noop: true, weekKey }, ghi audit ADMIN_SECT_WAR_RECALCULATE, KHÔNG mutate contribution', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const f1 = await makeUserChar(prisma);
    const sectA = await prisma.sect.create({
      data: {
        name: `SA-${nextSuffix()}`,
        description: '',
        leaderId: f1.characterId,
        treasuryLinhThach: 0n,
      },
    });
    await prisma.character.update({
      where: { id: f1.characterId },
      data: { sectId: sectA.id },
    });
    const weekKey = '2030-W11';
    await prisma.sectWarContribution.create({
      data: {
        characterId: f1.characterId,
        sectId: sectA.id,
        weekKey,
        activityKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 'dr-rec',
        points: 75,
      },
    });

    const before = await prisma.sectWarContribution.findMany({});
    const beforePts = before.reduce((s, r) => s + r.points, 0);

    const r = await svc.recalculateSectWar(adminU.userId, weekKey, 'incident smoke');
    expect(r.noop).toBe(true);
    expect(r.weekKey).toBe(weekKey);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_RECALCULATE' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.targetId).toBe(weekKey);
    expect(meta.noop).toBe(true);
    expect(meta.reason).toBe('incident smoke');

    // Contribution rows KHÔNG bị mutate.
    const after = await prisma.sectWarContribution.findMany({});
    expect(after).toHaveLength(before.length);
    const afterPts = after.reduce((s, r) => s + r.points, 0);
    expect(afterPts).toBe(beforePts);
  });

  it('recalc 2 lần liên tiếp → 2 audit row ADMIN_SECT_WAR_RECALCULATE; service idempotent (no-op)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const weekKey = '2030-W12';
    await svc.recalculateSectWar(adminU.userId, weekKey);
    await svc.recalculateSectWar(adminU.userId, weekKey);
    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_RECALCULATE' },
    });
    expect(audits).toHaveLength(2);
  });
});

/**
 * Phase 13.1.C — snapshotSectWarStatus: read-after-audit. Trả nguyên bản
 * `getSectWarStatus(weekKey)` + ghi 1 audit `ADMIN_SECT_WAR_STATUS` với
 * meta summary (totalSects/Contributors/Contributions + topSectIds[0..2])
 * + reason. KHÔNG mutate contribution rows.
 */
describe('AdminLiveOpsService.snapshotSectWarStatus', () => {
  it('snapshot rỗng: 0 sects/contributors/contributions, audit row có summary đầy đủ + reason', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const weekKey = '2030-W20';
    const before = await prisma.sectWarContribution.findMany({});
    expect(before).toHaveLength(0);

    const view = await svc.snapshotSectWarStatus(
      adminU.userId,
      weekKey,
      'handoff smoke',
    );
    expect(view.weekKey).toBe(weekKey);
    expect(view.totalSects).toBe(0);
    expect(view.totalContributors).toBe(0);
    expect(view.totalContributions).toBe(0);
    expect(view.topSects).toEqual([]);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_STATUS' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.targetType).toBe('SectWarWeek');
    expect(meta.targetId).toBe(weekKey);
    expect(meta.reason).toBe('handoff smoke');
    const summary = meta.summary as Record<string, unknown>;
    expect(summary.totalSects).toBe(0);
    expect(summary.totalContributors).toBe(0);
    expect(summary.totalContributions).toBe(0);
    expect(summary.topSectIds).toEqual([]);

    // Read-only — KHÔNG tạo contribution row mới.
    const after = await prisma.sectWarContribution.findMany({});
    expect(after).toHaveLength(0);
  });

  it('snapshot có data: ghi summary với topSectIds (≤3) đúng thứ tự points desc; KHÔNG mutate contribution', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const f1 = await makeUserChar(prisma);
    const f2 = await makeUserChar(prisma);
    const sectA = await prisma.sect.create({
      data: {
        name: `SA-${nextSuffix()}`,
        description: '',
        leaderId: f1.characterId,
        treasuryLinhThach: 0n,
      },
    });
    const sectB = await prisma.sect.create({
      data: {
        name: `SB-${nextSuffix()}`,
        description: '',
        leaderId: f2.characterId,
        treasuryLinhThach: 0n,
      },
    });
    await prisma.character.update({
      where: { id: f1.characterId },
      data: { sectId: sectA.id },
    });
    await prisma.character.update({
      where: { id: f2.characterId },
      data: { sectId: sectB.id },
    });

    const weekKey = '2030-W21';
    await prisma.sectWarContribution.create({
      data: {
        characterId: f1.characterId,
        sectId: sectA.id,
        weekKey,
        activityKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 's1-a',
        points: 100,
      },
    });
    await prisma.sectWarContribution.create({
      data: {
        characterId: f2.characterId,
        sectId: sectB.id,
        weekKey,
        activityKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 's1-b',
        points: 250,
      },
    });

    const before = await prisma.sectWarContribution.findMany({});
    const beforePts = before.reduce((s, r) => s + r.points, 0);

    const view = await svc.snapshotSectWarStatus(adminU.userId, weekKey);
    expect(view.totalSects).toBe(2);
    expect(view.topSects[0].sectId).toBe(sectB.id);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_STATUS' },
    });
    const meta = audit.meta as Record<string, unknown>;
    const summary = meta.summary as Record<string, unknown>;
    expect(summary.totalSects).toBe(2);
    expect(summary.totalContributors).toBe(2);
    expect(summary.totalContributions).toBe(2);
    expect(summary.topSectIds).toEqual([sectB.id, sectA.id]);
    // Reason không truyền → null.
    expect(meta.reason).toBeNull();

    // Contribution rows giữ nguyên.
    const after = await prisma.sectWarContribution.findMany({});
    expect(after).toHaveLength(before.length);
    const afterPts = after.reduce((s, r) => s + r.points, 0);
    expect(afterPts).toBe(beforePts);
  });

  it('snapshot 2 lần liên tiếp → 2 audit row riêng biệt (idempotent read, separate paper trail)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const weekKey = '2030-W22';
    await svc.snapshotSectWarStatus(adminU.userId, weekKey);
    await svc.snapshotSectWarStatus(adminU.userId, weekKey, 'second pass');
    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_STATUS' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect((audits[0].meta as Record<string, unknown>).reason).toBeNull();
    expect((audits[1].meta as Record<string, unknown>).reason).toBe(
      'second pass',
    );
  });

  it('snapshot reason whitespace-only → null trong audit (trim)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const weekKey = '2030-W23';
    await svc.snapshotSectWarStatus(adminU.userId, weekKey, '   ');
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_SECT_WAR_STATUS' },
    });
    expect((audit.meta as Record<string, unknown>).reason).toBeNull();
  });
});
