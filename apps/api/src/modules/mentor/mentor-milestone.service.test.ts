import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  MentorMilestoneError,
  MentorMilestoneService,
} from './mentor-milestone.service';
import { MentorService } from './mentor.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let mentor: MentorService;
let svc: MentorMilestoneService;
let mail: MailService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  mail = new MailService(prisma, currency, inventory, realtime);
  mentor = new MentorService(prisma);
  svc = new MentorMilestoneService(prisma, mail);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

/**
 * Helper: tạo mentor (do_kiep order=9) và student (truc_co order=2 -> AVAILABLE
 * cho milestone truc_co; nhưng tier gap = 7 và student tier 2 ≤ MAX_STUDENT_REALM_TIER=6,
 * mentor tier 9 ≥ MIN_MENTOR_REALM_TIER=9. PASS.).
 */
async function setupActiveRelation(opts?: {
  studentRealmKey?: string;
  mentorRealmKey?: string;
}) {
  const mentorRealm = opts?.mentorRealmKey ?? 'do_kiep';
  const studentRealm = opts?.studentRealmKey ?? 'truc_co';
  const m = await makeUserChar(prisma, { realmKey: mentorRealm });
  const s = await makeUserChar(prisma, { realmKey: studentRealm });
  await mentor.register(m.userId, { intro: 'sư phụ' });
  const rel = await mentor.request(s.userId, { mentorUserId: m.userId });
  await mentor.respond(m.userId, rel.id, true);
  return { mentorUserId: m.userId, studentUserId: s.userId, relationId: rel.id };
}

describe('MentorMilestoneService — Phase 35.2', () => {
  it('recompute lazy-creates progress row LOCKED khi disciple chưa đạt realm', async () => {
    // Student luyenkhi (order=1) — no milestone earned yet.
    const { relationId } = await setupActiveRelation({
      studentRealmKey: 'luyenkhi',
    });
    const r = await svc.recomputeForRelation(relationId);
    expect(r.created).toBe(8);
    expect(r.promoted).toBe(0);
    const rows = await prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId: relationId },
    });
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row.status).toBe('LOCKED');
  });

  it('recompute flip LOCKED→AVAILABLE khi disciple đạt requiredOrder', async () => {
    // Student kim_dan (order=3) — Trúc Cơ + Kim Đan milestones earned.
    const { relationId } = await setupActiveRelation({
      studentRealmKey: 'kim_dan',
    });
    const r = await svc.recomputeForRelation(relationId);
    expect(r.created).toBe(8);
    expect(r.promoted).toBe(2);
    const available = await prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId: relationId, status: 'AVAILABLE' },
    });
    expect(available.map((a) => a.milestoneKey).sort()).toEqual(
      ['mentor_milestone_kim_dan', 'mentor_milestone_truc_co'].sort(),
    );
  });

  it('recompute idempotent — chạy 2 lần không double-create', async () => {
    const { relationId } = await setupActiveRelation();
    await svc.recomputeForRelation(relationId);
    const r2 = await svc.recomputeForRelation(relationId);
    expect(r2.created).toBe(0);
    expect(r2.promoted).toBe(0);
    const rows = await prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId: relationId },
    });
    expect(rows).toHaveLength(8);
  });

  it('listForUser trả về cả asMentor lẫn asDisciple', async () => {
    const { mentorUserId, studentUserId, relationId } =
      await setupActiveRelation();
    const mentorView = await svc.listForUser(mentorUserId);
    expect(mentorView.asMentor).toHaveLength(1);
    expect(mentorView.asMentor[0]!.relationId).toBe(relationId);
    expect(mentorView.asMentor[0]!.progress).toHaveLength(8);
    expect(mentorView.asDisciple).toBeNull();

    const studentView = await svc.listForUser(studentUserId);
    expect(studentView.asMentor).toHaveLength(0);
    expect(studentView.asDisciple).toBeTruthy();
    expect(studentView.asDisciple!.relationId).toBe(relationId);
  });

  it('claim AVAILABLE → tạo mail SYSTEM + audit row, không mint Tiên Ngọc', async () => {
    const { studentUserId } = await setupActiveRelation();
    const result = await svc.claim(studentUserId, 'mentor_milestone_truc_co');
    expect(result.role).toBe('DISCIPLE');
    expect(result.rewardLinhThach).toBe('8000');
    expect(result.mailId).toBeTruthy();
    const audit = await prisma.mentorRewardClaim.findFirst({
      where: { claimerUserId: studentUserId },
    });
    expect(audit).toBeTruthy();
    expect(audit!.role).toBe('DISCIPLE');
    const mailRow = await prisma.mail.findUnique({
      where: { id: result.mailId },
    });
    expect(mailRow).toBeTruthy();
    expect(mailRow!.rewardTienNgoc).toBe(0);
    expect(mailRow!.rewardLinhThach.toString()).toBe('8000');
    expect(mailRow!.mailType).toBe('SYSTEM');
  });

  it('claim LOCKED → MILESTONE_LOCKED', async () => {
    const { studentUserId } = await setupActiveRelation({
      studentRealmKey: 'luyenkhi',
    });
    await expect(
      svc.claim(studentUserId, 'mentor_milestone_kim_dan'),
    ).rejects.toBeInstanceOf(MentorMilestoneError);
    await expect(
      svc.claim(studentUserId, 'mentor_milestone_kim_dan'),
    ).rejects.toMatchObject({ code: 'MILESTONE_LOCKED' });
  });

  it('claim duplicate cùng role → MILESTONE_ALREADY_CLAIMED', async () => {
    const { studentUserId } = await setupActiveRelation();
    await svc.claim(studentUserId, 'mentor_milestone_truc_co');
    await expect(
      svc.claim(studentUserId, 'mentor_milestone_truc_co'),
    ).rejects.toMatchObject({ code: 'MILESTONE_ALREADY_CLAIMED' });
  });

  it('mentor + disciple claim độc lập — flip status → CLAIMED khi cả 2 đã claim', async () => {
    const { mentorUserId, studentUserId, relationId } =
      await setupActiveRelation();
    const r1 = await svc.claim(studentUserId, 'mentor_milestone_truc_co');
    expect(r1.role).toBe('DISCIPLE');
    expect(r1.rewardLinhThach).toBe('8000');
    const r2 = await svc.claim(mentorUserId, 'mentor_milestone_truc_co');
    expect(r2.role).toBe('MENTOR');
    expect(r2.rewardLinhThach).toBe('5000');
    const progress = await prisma.mentorMilestoneProgress.findUnique({
      where: {
        mentorRelationId_milestoneKey: {
          mentorRelationId: relationId,
          milestoneKey: 'mentor_milestone_truc_co',
        },
      },
    });
    expect(progress!.status).toBe('CLAIMED');
  });

  it('claim invalid milestoneKey → MILESTONE_NOT_FOUND', async () => {
    const { studentUserId } = await setupActiveRelation();
    await expect(
      svc.claim(studentUserId, 'mentor_milestone_does_not_exist'),
    ).rejects.toMatchObject({ code: 'MILESTONE_NOT_FOUND' });
  });

  it('user không có ACTIVE relation → NOT_IN_ACTIVE_RELATION', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(
      svc.claim(u.userId, 'mentor_milestone_truc_co'),
    ).rejects.toMatchObject({ code: 'NOT_IN_ACTIVE_RELATION' });
  });

  it('relation ENDED → claim không được nữa', async () => {
    const { mentorUserId, studentUserId, relationId } =
      await setupActiveRelation();
    await prisma.mentorRelation.update({
      where: { id: relationId },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await expect(
      svc.claim(studentUserId, 'mentor_milestone_truc_co'),
    ).rejects.toMatchObject({ code: 'NOT_IN_ACTIVE_RELATION' });
    await expect(
      svc.claim(mentorUserId, 'mentor_milestone_truc_co'),
    ).rejects.toMatchObject({ code: 'NOT_IN_ACTIVE_RELATION' });
  });

  it('mentor reward < disciple reward snapshot match catalog', async () => {
    const { mentorUserId, studentUserId } = await setupActiveRelation({
      studentRealmKey: 'kim_dan',
    });
    const mentorClaim = await svc.claim(mentorUserId, 'mentor_milestone_kim_dan');
    const discipleClaim = await svc.claim(
      studentUserId,
      'mentor_milestone_kim_dan',
    );
    expect(BigInt(mentorClaim.rewardLinhThach)).toBeLessThan(
      BigInt(discipleClaim.rewardLinhThach),
    );
    expect(mentorClaim.rewardLinhThach).toBe('10000');
    expect(discipleClaim.rewardLinhThach).toBe('15000');
  });

  it('recompute KHÔNG flip về LOCKED nếu disciple downgrade (defensive)', async () => {
    const { relationId, studentUserId } = await setupActiveRelation({
      studentRealmKey: 'kim_dan',
    });
    await svc.recomputeForRelation(relationId);
    // Disciple "downgrade" — set realmKey về luyenkhi (chỉ test defensive).
    await prisma.character.update({
      where: { userId: studentUserId },
      data: { realmKey: 'luyenkhi' },
    });
    await svc.recomputeForRelation(relationId);
    const available = await prisma.mentorMilestoneProgress.findMany({
      where: { mentorRelationId: relationId, status: 'AVAILABLE' },
    });
    // Still AVAILABLE (no demotion).
    expect(available.length).toBeGreaterThanOrEqual(2);
  });

  it('listForUser sau khi disciple breakthrough — progress auto-recompute', async () => {
    const { studentUserId, relationId } = await setupActiveRelation({
      studentRealmKey: 'luyenkhi',
    });
    // breakthrough mock: bump realmKey
    await prisma.character.update({
      where: { userId: studentUserId },
      data: { realmKey: 'nguyen_anh' },
    });
    const view = await svc.listForUser(studentUserId);
    const earned = view.asDisciple!.progress.filter(
      (p) => p.status === 'AVAILABLE',
    );
    // Trúc Cơ + Kim Đan + Nguyên Anh = 3.
    expect(earned).toHaveLength(3);
    expect(view.asDisciple!.selfRealmOrder).toBe(4);
    void relationId;
  });

  it('listForUser populate viewerRewardLinhThach đúng role', async () => {
    const { mentorUserId, studentUserId } = await setupActiveRelation();
    const mentorView = await svc.listForUser(mentorUserId);
    const studentView = await svc.listForUser(studentUserId);
    const mTruc = mentorView.asMentor[0]!.progress.find(
      (p) => p.milestoneKey === 'mentor_milestone_truc_co',
    );
    const sTruc = studentView.asDisciple!.progress.find(
      (p) => p.milestoneKey === 'mentor_milestone_truc_co',
    );
    expect(mTruc!.viewerRewardLinhThach).toBe('5000');
    expect(sTruc!.viewerRewardLinhThach).toBe('8000');
  });

  it('SELF_NOT_ALLOWED guard inherit từ MentorService — không có self-claim path', async () => {
    // Phase 31.0 service đã block self-mentor; verify rằng MentorMilestoneService
    // không bypass — không có endpoint để 1 user vừa là mentor vừa là student.
    const u = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    await mentor.register(u.userId, {});
    await expect(
      mentor.request(u.userId, { mentorUserId: u.userId }),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('recomputeForUser trả về null nếu user không có relation ACTIVE', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const r = await svc.recomputeForUser(u.userId);
    expect(r).toBeNull();
  });
});
