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
import {
  LIVE_OPS_DEFAULT_TZ,
  LIVE_OPS_EVENTS,
  bossByKey,
} from '@xuantoi/shared';
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

/**
 * Phase 13.1.D — schedulePreview: read-only aggregate cho admin xem trước
 * lịch event/boss/sect war/override. KHÔNG mutate, KHÔNG audit.
 */
describe('AdminLiveOpsService.schedulePreview', () => {
  it('trả về tz + nowIso + activeEvents + upcomingEvents + bossSchedule + sectWar + overrides; KHÔNG mutate DB', async () => {
    const beforeOverrides = await prisma.liveOpsEventOverride.findMany({});
    const beforeAudit = await prisma.adminAuditLog.findMany({});

    const view = await svc.schedulePreview();

    expect(view.tz).toBe(LIVE_OPS_DEFAULT_TZ);
    expect(typeof view.nowIso).toBe('string');
    expect(Array.isArray(view.activeEvents)).toBe(true);
    expect(Array.isArray(view.upcomingEvents)).toBe(true);
    expect(Array.isArray(view.bossScheduleToday)).toBe(true);
    expect(Array.isArray(view.bossScheduleWeek)).toBe(true);
    expect(view.sectWar).toBeDefined();
    expect(typeof view.sectWar.season.weekKey).toBe('string');
    expect(view.sectWar.status.weekKey).toBe(view.sectWar.season.weekKey);
    expect(Array.isArray(view.overrides)).toBe(true);

    // Read-only — KHÔNG mutate override row, KHÔNG ghi audit.
    const afterOverrides = await prisma.liveOpsEventOverride.findMany({});
    const afterAudit = await prisma.adminAuditLog.findMany({});
    expect(afterOverrides.length).toBe(beforeOverrides.length);
    expect(afterAudit.length).toBe(beforeAudit.length);
  });

  it('override.enabled=false được reflect trong overrides[] với enabled=false (admin biết event đang OFF)', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;
    await prisma.liveOpsEventOverride.create({
      data: {
        key: targetKey,
        enabled: false,
        startsAt: null,
        endsAt: null,
        reason: 'preview test',
        updatedBy: adminU.userId,
      },
    });

    const view = await svc.schedulePreview();
    const ovr = view.overrides.find((o) => o.key === targetKey);
    expect(ovr).toBeDefined();
    expect(ovr!.enabled).toBe(false);
    expect(ovr!.reason).toBe('preview test');
    expect(ovr!.updatedBy).toBe(adminU.userId);

    // activeEvents KHÔNG chứa key này (override.enabled=false → effective=false).
    expect(view.activeEvents.find((e) => e.key === targetKey)).toBeUndefined();
  });

  it('upcomingEvents có shape đầy đủ (catalogEnabled / effectiveEnabled / slotStartIso / slotEndIso)', async () => {
    const view = await svc.schedulePreview();
    for (const ev of view.upcomingEvents) {
      expect(typeof ev.key).toBe('string');
      expect(typeof ev.type).toBe('string');
      expect(typeof ev.titleI18nKey).toBe('string');
      expect(typeof ev.catalogEnabled).toBe('boolean');
      expect(typeof ev.effectiveEnabled).toBe('boolean');
      expect(typeof ev.slotStartIso).toBe('string');
      expect(typeof ev.slotEndIso).toBe('string');
      // start <= end
      expect(
        new Date(ev.slotStartIso).getTime(),
      ).toBeLessThanOrEqual(new Date(ev.slotEndIso).getTime());
    }
  });
});

/**
 * Phase 13.1.D — dryRun: simulate event/boss execution KHÔNG mutate DB
 * (KHÔNG ghi reward, KHÔNG insert WorldBoss). Ghi 1 audit nhẹ
 * `ADMIN_LIVEOPS_DRY_RUN`.
 */
describe('AdminLiveOpsService.dryRun event', () => {
  it('event ok: trả result với key/type/effectiveEnabled/simulated=true; ghi 1 audit ADMIN_LIVEOPS_DRY_RUN', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;

    const beforeOverrides = await prisma.liveOpsEventOverride.findMany({});
    const beforeWorldBoss = await prisma.worldBoss.findMany({});
    const beforeLedger = await prisma.currencyLedger.findMany({});

    const r = await svc.dryRun(adminU.userId, {
      kind: 'event',
      key: targetKey,
      reason: 'preview event',
    });
    expect(r.kind).toBe('event');
    if (r.kind !== 'event') return;
    expect(r.key).toBe(targetKey);
    expect(typeof r.catalogEnabled).toBe('boolean');
    expect(typeof r.effectiveEnabled).toBe('boolean');
    expect(r.simulated).toBe(true);
    expect(r.reason).toBe('preview event');
    expect(typeof r.simulatedAt).toBe('string');

    // Audit row được ghi.
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_LIVEOPS_DRY_RUN' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.kind).toBe('event');
    expect(meta.targetType).toBe('LiveOpsEvent');
    expect(meta.targetId).toBe(targetKey);
    expect(meta.reason).toBe('preview event');

    // KHÔNG mutate override / worldboss / ledger.
    const afterOverrides = await prisma.liveOpsEventOverride.findMany({});
    const afterWorldBoss = await prisma.worldBoss.findMany({});
    const afterLedger = await prisma.currencyLedger.findMany({});
    expect(afterOverrides.length).toBe(beforeOverrides.length);
    expect(afterWorldBoss.length).toBe(beforeWorldBoss.length);
    expect(afterLedger.length).toBe(beforeLedger.length);
  });

  it('event với override DB → effectiveEnabled=false được reflect; KHÔNG bypass override', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const targetKey = LIVE_OPS_EVENTS[0].key;
    await prisma.liveOpsEventOverride.create({
      data: {
        key: targetKey,
        enabled: false,
        updatedBy: adminU.userId,
      },
    });

    const r = await svc.dryRun(adminU.userId, {
      kind: 'event',
      key: targetKey,
    });
    expect(r.kind).toBe('event');
    if (r.kind !== 'event') return;
    expect(r.effectiveEnabled).toBe(false);
    expect(r.override).not.toBeNull();
    expect(r.override!.enabled).toBe(false);
  });

  it('event EVENT_NOT_FOUND: key không có trong catalog → throw, KHÔNG ghi audit', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      svc.dryRun(adminU.userId, {
        kind: 'event',
        key: 'totally_unknown_event_xyz',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });

    const audits = await prisma.adminAuditLog.findMany({
      where: { action: 'ADMIN_LIVEOPS_DRY_RUN' },
    });
    expect(audits).toHaveLength(0);
  });
});

describe('AdminLiveOpsService.dryRun boss', () => {
  it('boss ok: trả result với simulatedMaxHp + simulatedReward (catalog drops, KHÔNG grant); KHÔNG insert WorldBoss', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    // Use first available boss def from shared catalog (multi-region keys).
    const allBossKeys = [
      'yeu_vuong_tho_huyet',
      'huyet_long_quan',
      'moc_dinh_co_yeu',
    ];
    let bossKey: string | null = null;
    for (const k of allBossKeys) {
      if (bossByKey(k)) {
        bossKey = k;
        break;
      }
    }
    expect(bossKey).not.toBeNull();
    if (!bossKey) return;

    const beforeWorldBoss = await prisma.worldBoss.findMany({});
    const beforeLedger = await prisma.currencyLedger.findMany({});

    const r = await svc.dryRun(adminU.userId, {
      kind: 'boss',
      key: bossKey,
      level: 5,
      reason: 'preview boss',
    });
    expect(r.kind).toBe('boss');
    if (r.kind !== 'boss') return;
    expect(r.bossKey).toBe(bossKey);
    expect(r.level).toBe(5);
    expect(typeof r.simulatedMaxHp).toBe('string');
    expect(BigInt(r.simulatedMaxHp)).toBeGreaterThan(0n);
    expect(r.simulatedReward.baseLinhThach).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.simulatedReward.topDropPool)).toBe(true);
    expect(Array.isArray(r.simulatedReward.midDropPool)).toBe(true);
    expect(Array.isArray(r.simulatedReward.lowDropPool)).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.reason).toBe('preview boss');

    // Audit row được ghi.
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorUserId: adminU.userId, action: 'ADMIN_LIVEOPS_DRY_RUN' },
    });
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.kind).toBe('boss');
    expect(meta.targetType).toBe('Boss');
    expect(meta.targetId).toBe(bossKey);
    expect(meta.level).toBe(5);
    expect(meta.reason).toBe('preview boss');

    // KHÔNG insert WorldBoss row, KHÔNG ledger.
    const afterWorldBoss = await prisma.worldBoss.findMany({});
    const afterLedger = await prisma.currencyLedger.findMany({});
    expect(afterWorldBoss.length).toBe(beforeWorldBoss.length);
    expect(afterLedger.length).toBe(beforeLedger.length);
  });

  it('boss BOSS_NOT_FOUND: key không có trong catalog → throw, KHÔNG ghi audit', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    await expect(
      svc.dryRun(adminU.userId, {
        kind: 'boss',
        key: 'totally_unknown_boss_xyz',
      }),
    ).rejects.toMatchObject({ code: 'BOSS_NOT_FOUND' });
    const audits = await prisma.adminAuditLog.findMany({
      where: { action: 'ADMIN_LIVEOPS_DRY_RUN' },
    });
    expect(audits).toHaveLength(0);
  });

  it('boss level clamp: level=0/-1 → coerce 1, level=999 → clamp 99', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const allBossKeys = ['huyet_ma', 'phong_yeu', 'son_thu_lon'];
    let bossKey: string | null = null;
    for (const k of allBossKeys) {
      if (bossByKey(k)) {
        bossKey = k;
        break;
      }
    }
    if (!bossKey) return;

    const r1 = await svc.dryRun(adminU.userId, {
      kind: 'boss',
      key: bossKey,
      level: 0,
    });
    expect(r1.kind).toBe('boss');
    if (r1.kind !== 'boss') return;
    expect(r1.level).toBe(1);

    const r2 = await svc.dryRun(adminU.userId, {
      kind: 'boss',
      key: bossKey,
      level: 9999,
    });
    expect(r2.kind).toBe('boss');
    if (r2.kind !== 'boss') return;
    expect(r2.level).toBe(99);
  });
});
