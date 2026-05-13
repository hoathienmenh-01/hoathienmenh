import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { MentorError, MentorService } from './mentor.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let mentor: MentorService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  mentor = new MentorService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('MentorService — Phase 31.0', () => {
  it('register: mentor TIER_TOO_LOW khi realmTier < MIN_MENTOR_REALM_TIER', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'truc_co' }); // order=2
    await expect(mentor.register(u.userId, { intro: 'hi' })).rejects.toMatchObject({
      code: 'TIER_TOO_LOW',
    });
  });

  it('register: mentor cao tier đăng ký thành công + acceptingStudents default=true', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'do_kiep' }); // order=9
    const profile = await mentor.register(u.userId, { intro: 'thu nhận đệ tử' });
    expect(profile.realmTier).toBe(9);
    expect(profile.intro).toBe('thu nhận đệ tử');
    expect(profile.acceptingStudents).toBe(true);
    expect(profile.activeStudentCount).toBe(0);
  });

  it('request: student gửi bái sư thành công khi tier hợp lệ', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' }); // order=1
    await mentor.register(m.userId, {});
    const rel = await mentor.request(s.userId, {
      mentorUserId: m.userId,
      message: 'xin sư phụ thu nhận',
    });
    expect(rel.status).toBe('PENDING');
    expect(rel.mentorUserId).toBe(m.userId);
    expect(rel.studentUserId).toBe(s.userId);
    expect(rel.message).toBe('xin sư phụ thu nhận');
  });

  it('request: TIER_GAP_TOO_SMALL khi mentor-student gap < 3', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' }); // 9
    const s = await makeUserChar(prisma, { realmKey: 'luyen_hu' }); // 6 -> gap=3 (OK)
    await mentor.register(m.userId, {});
    // tier_gap 9-6 = 3 (== MIN) → pass. Use student order=7 (hop_the) to fail.
    const s2 = await makeUserChar(prisma, { realmKey: 'hop_the' }); // 7
    // wait — student tier max = 6. So order=7 hits TIER_TOO_HIGH first.
    await expect(
      mentor.request(s2.userId, { mentorUserId: m.userId }),
    ).rejects.toMatchObject({ code: 'TIER_TOO_HIGH' });
    // gap test: mentor=do_kiep(9), student=luyen_hu(6) → gap=3 OK
    const ok = await mentor.request(s.userId, { mentorUserId: m.userId });
    expect(ok.status).toBe('PENDING');
  });

  it('request: ALREADY_PENDING khi gọi lần 2 cùng cặp mentor-student', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m.userId, {});
    await mentor.request(s.userId, { mentorUserId: m.userId });
    await expect(
      mentor.request(s.userId, { mentorUserId: m.userId }),
    ).rejects.toMatchObject({ code: 'ALREADY_PENDING' });
  });

  it('request: SELF_NOT_ALLOWED khi student = mentor', async () => {
    const u = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    await mentor.register(u.userId, {});
    await expect(
      mentor.request(u.userId, { mentorUserId: u.userId }),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('respond accept: chuyển PENDING → ACTIVE + tăng activeStudentCount', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m.userId, {});
    const rel = await mentor.request(s.userId, { mentorUserId: m.userId });
    const accepted = await mentor.respond(m.userId, rel.id, true);
    expect(accepted.status).toBe('ACTIVE');
    expect(accepted.respondedAt).not.toBeNull();
    const profile = await mentor.getProfile(m.userId);
    expect(profile?.activeStudentCount).toBe(1);
  });

  it('respond decline: chuyển PENDING → DECLINED không tăng count', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m.userId, {});
    const rel = await mentor.request(s.userId, { mentorUserId: m.userId });
    const declined = await mentor.respond(m.userId, rel.id, false);
    expect(declined.status).toBe('DECLINED');
    const profile = await mentor.getProfile(m.userId);
    expect(profile?.activeStudentCount).toBe(0);
  });

  it('respond: NOT_AUTHORIZED khi không phải mentor của relation', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const other = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    await mentor.register(m.userId, {});
    const rel = await mentor.request(s.userId, { mentorUserId: m.userId });
    await expect(
      mentor.respond(other.userId, rel.id, true),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('respond: INVALID_TRANSITION khi accept lần 2 (đã ACTIVE)', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m.userId, {});
    const rel = await mentor.request(s.userId, { mentorUserId: m.userId });
    await mentor.respond(m.userId, rel.id, true);
    await expect(
      mentor.respond(m.userId, rel.id, true),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('listStudents: trả về students ACTIVE + pending PENDING', async () => {
    const m = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s1 = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const s2 = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m.userId, {});
    const r1 = await mentor.request(s1.userId, { mentorUserId: m.userId });
    await mentor.respond(m.userId, r1.id, true);
    await mentor.request(s2.userId, { mentorUserId: m.userId });

    const list = await mentor.listStudents(m.userId);
    expect(list.students).toHaveLength(1);
    expect(list.students[0].status).toBe('ACTIVE');
    expect(list.pending).toHaveLength(1);
    expect(list.pending[0].status).toBe('PENDING');
  });

  it('request: STUDENT_ALREADY_HAS_MENTOR khi student đã có mentor ACTIVE', async () => {
    const m1 = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const m2 = await makeUserChar(prisma, { realmKey: 'do_kiep' });
    const s = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await mentor.register(m1.userId, {});
    await mentor.register(m2.userId, {});
    const r1 = await mentor.request(s.userId, { mentorUserId: m1.userId });
    await mentor.respond(m1.userId, r1.id, true);
    await expect(
      mentor.request(s.userId, { mentorUserId: m2.userId }),
    ).rejects.toMatchObject({ code: 'STUDENT_ALREADY_HAS_MENTOR' });
  });

  it('NO_CHARACTER khi user chưa có character', async () => {
    const u = await prisma.user.create({
      data: {
        email: `nochar-${Date.now()}@xt.test`,
        passwordHash: 'x',
        role: 'PLAYER',
      },
    });
    await expect(mentor.getProfile(u.id)).resolves.toBeNull();
    await expect(mentor.register(u.id, {})).rejects.toBeInstanceOf(MentorError);
  });
});
