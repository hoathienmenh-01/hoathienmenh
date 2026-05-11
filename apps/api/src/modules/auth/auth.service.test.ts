import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma.service';
import {
  AuthService,
  AuthError,
  FORGOT_PASSWORD_RATE_LIMIT_MAX,
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
  REGISTER_RATE_LIMIT_MAX,
  REGISTER_RATE_LIMIT_WINDOW_MS,
} from './auth.service';
import { InMemorySlidingWindowRateLimiter } from '../../common/rate-limiter';
import { SessionService } from './session.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

const ACCESS_SECRET = 'test-access-secret-' + Math.random().toString(36).slice(2);
const REFRESH_SECRET = 'test-refresh-secret-' + Math.random().toString(36).slice(2);

class FakeConfig extends ConfigService {
  constructor() {
    super({
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_ACCESS_TTL: '900',
      JWT_REFRESH_TTL: '2592000',
    });
  }
}

let prisma: PrismaService;
let jwt: JwtService;
let auth: AuthService;
let registerLimiter: InMemorySlidingWindowRateLimiter;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  jwt = new JwtService({});
});

beforeEach(async () => {
  // Wipe auth-related tables only (don't touch unrelated phase tables to keep tests fast).
  await prisma.passwordResetToken.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.userSession.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.user.deleteMany({});
  // Fresh limiter per test — register limiter có state in-memory persist giữa test.
  registerLimiter = new InMemorySlidingWindowRateLimiter(
    REGISTER_RATE_LIMIT_WINDOW_MS,
    REGISTER_RATE_LIMIT_MAX,
  );
  const forgotLimiter = new InMemorySlidingWindowRateLimiter(
    FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
    FORGOT_PASSWORD_RATE_LIMIT_MAX,
  );
  const cfg = new FakeConfig();
  const sessions = new SessionService(prisma);
  auth = new AuthService(prisma, jwt, cfg, sessions, registerLimiter, forgotLimiter);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ctx = { ip: '127.0.0.1' };
const PASSWORD = 'Test1234';

describe('AuthService', () => {
  it('register tạo user mới + phát access/refresh token + ghi RefreshToken row', async () => {
    const out = await auth.register({ email: 'a@xt.local', password: PASSWORD }, ctx);
    expect(out.user.email).toBe('a@xt.local');
    expect(out.accessToken.length).toBeGreaterThan(20);
    expect(out.refreshToken.length).toBeGreaterThan(20);
    const rows = await prisma.refreshToken.findMany({ where: { userId: out.user.id } });
    expect(rows.length).toBe(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it('register cùng email lần 2 ném EMAIL_TAKEN', async () => {
    await auth.register({ email: 'b@xt.local', password: PASSWORD }, ctx);
    await expect(
      auth.register({ email: 'b@xt.local', password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('login thành công với mật khẩu đúng', async () => {
    await auth.register({ email: 'c@xt.local', password: PASSWORD }, ctx);
    const out = await auth.login({ email: 'c@xt.local', password: PASSWORD }, ctx);
    expect(out.user.email).toBe('c@xt.local');
  });

  it('login sai mật khẩu ném INVALID_CREDENTIALS + ghi LoginAttempt fail', async () => {
    await auth.register({ email: 'd@xt.local', password: PASSWORD }, ctx);
    await expect(
      auth.login({ email: 'd@xt.local', password: 'WrongPwd1' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const attempts = await prisma.loginAttempt.findMany({
      where: { email: 'd@xt.local', success: false },
    });
    expect(attempts.length).toBe(1);
  });

  it('register quá 5 lần/IP/15 phút → RATE_LIMITED (anti-bot scripted spam)', async () => {
    for (let i = 0; i < REGISTER_RATE_LIMIT_MAX; i++) {
      await auth.register({ email: `bot${i}@xt.local`, password: PASSWORD }, ctx);
    }
    // Lần thứ 6 từ cùng IP → reject ngay cả khi email chưa tồn tại.
    await expect(
      auth.register({ email: 'bot-overflow@xt.local', password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('register từ IP khác KHÔNG bị limit chéo (per-IP isolation)', async () => {
    for (let i = 0; i < REGISTER_RATE_LIMIT_MAX; i++) {
      await auth.register(
        { email: `ip1-${i}@xt.local`, password: PASSWORD },
        { ip: '10.0.0.1' },
      );
    }
    const out = await auth.register(
      { email: 'ip2@xt.local', password: PASSWORD },
      { ip: '10.0.0.2' },
    );
    expect(out.user.email).toBe('ip2@xt.local');
  });

  it('login sai 5 lần / 15 phút / IP+email → RATE_LIMITED', async () => {
    await auth.register({ email: 'rate@xt.local', password: PASSWORD }, ctx);
    for (let i = 0; i < 5; i++) {
      await auth
        .login({ email: 'rate@xt.local', password: 'WrongPwd1' }, ctx)
        .catch(() => undefined);
    }
    await expect(
      auth.login({ email: 'rate@xt.local', password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('login user banned ném ACCOUNT_BANNED', async () => {
    const out = await auth.register({ email: 'banned@xt.local', password: PASSWORD }, ctx);
    await prisma.user.update({ where: { id: out.user.id }, data: { banned: true } });
    await expect(
      auth.login({ email: 'banned@xt.local', password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: 'ACCOUNT_BANNED' });
  });

  it('session(accessToken) trả PublicUser khi token hợp lệ', async () => {
    const out = await auth.register({ email: 'sess@xt.local', password: PASSWORD }, ctx);
    const u = await auth.session(out.accessToken);
    expect(u.email).toBe('sess@xt.local');
  });

  it('session(undefined) ném UNAUTHENTICATED', async () => {
    await expect(auth.session(undefined)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('session ném ACCOUNT_BANNED khi user bị ban', async () => {
    const out = await auth.register({ email: 'sb@xt.local', password: PASSWORD }, ctx);
    await prisma.user.update({ where: { id: out.user.id }, data: { banned: true } });
    await expect(auth.session(out.accessToken)).rejects.toMatchObject({
      code: 'ACCOUNT_BANNED',
    });
  });

  it('refresh rotate token: revoke cũ, cấp mới, hashedToken khác', async () => {
    const reg = await auth.register({ email: 'rot@xt.local', password: PASSWORD }, ctx);
    const before = await prisma.refreshToken.findMany({ where: { userId: reg.user.id } });
    const out = await auth.refresh(reg.refreshToken, ctx);
    expect(out.refreshToken).not.toBe(reg.refreshToken);
    const after = await prisma.refreshToken.findMany({
      where: { userId: reg.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(after.length).toBe(2);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].revokedAt).not.toBeNull();
    expect(after[1].revokedAt).toBeNull();
    expect(after[1].rotatedFromId).toBe(after[0].id);
  });

  it('refresh với token đã revoke ném SESSION_EXPIRED', async () => {
    const reg = await auth.register({ email: 'rev@xt.local', password: PASSWORD }, ctx);
    await auth.logout(reg.refreshToken);
    await expect(auth.refresh(reg.refreshToken, ctx)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('change-password revoke toàn bộ refresh token cũ', async () => {
    const reg = await auth.register({ email: 'chp@xt.local', password: PASSWORD }, ctx);
    await auth.changePassword(reg.user.id, {
      oldPassword: PASSWORD,
      newPassword: 'NewPass123',
    });
    const tokens = await prisma.refreshToken.findMany({ where: { userId: reg.user.id } });
    expect(tokens.length).toBe(1);
    expect(tokens[0].revokedAt).not.toBeNull();
    // Refresh phải fail vì token cũ bị revoke + passwordVersion bumped.
    await expect(auth.refresh(reg.refreshToken, ctx)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('change-password sai oldPassword ném OLD_PASSWORD_WRONG', async () => {
    const reg = await auth.register({ email: 'chp2@xt.local', password: PASSWORD }, ctx);
    await expect(
      auth.changePassword(reg.user.id, {
        oldPassword: 'WrongOld1',
        newPassword: 'NewPass123',
      }),
    ).rejects.toMatchObject({ code: 'OLD_PASSWORD_WRONG' });
  });

  it('logout idempotent: không throw khi token undefined / không hợp lệ', async () => {
    await expect(auth.logout(undefined)).resolves.toBeUndefined();
    await expect(auth.logout('garbage.jwt.token')).resolves.toBeUndefined();
  });

  it('logoutAll: revoke toàn bộ refresh token đang active của user, trả count', async () => {
    const out1 = await auth.register({ email: 'la1@xt.local', password: PASSWORD }, ctx);
    // login lần 2 cùng user → có 2 refresh token active
    await auth.login({ email: 'la1@xt.local', password: PASSWORD }, ctx);

    const before = await prisma.refreshToken.count({
      where: { userId: out1.user.id, revokedAt: null },
    });
    expect(before).toBe(2);

    const r = await auth.logoutAll(out1.user.id);
    expect(r.revoked).toBe(2);

    const after = await prisma.refreshToken.count({
      where: { userId: out1.user.id, revokedAt: null },
    });
    expect(after).toBe(0);

    // refresh token cũ không còn dùng được
    await expect(
      auth.refresh(out1.refreshToken, ctx),
    ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('logoutAll idempotent: gọi 2 lần không lỗi, lần 2 revoked=0', async () => {
    const out = await auth.register({ email: 'la2@xt.local', password: PASSWORD }, ctx);
    const r1 = await auth.logoutAll(out.user.id);
    const r2 = await auth.logoutAll(out.user.id);
    expect(r1.revoked).toBe(1);
    expect(r2.revoked).toBe(0);
  });

  it('logoutAll: chỉ ảnh hưởng user của chính mình', async () => {
    const a = await auth.register({ email: 'la3a@xt.local', password: PASSWORD }, ctx);
    const b = await auth.register({ email: 'la3b@xt.local', password: PASSWORD }, ctx);

    await auth.logoutAll(a.user.id);

    // refresh token của B vẫn dùng được
    const refreshed = await auth.refresh(b.refreshToken, ctx);
    expect(refreshed.user.id).toBe(b.user.id);
  });

  it('logoutAll: KHÔNG bump passwordVersion (documented behavior, SECURITY.md §1)', async () => {
    // Regression guard — nếu future code thêm passwordVersion++ trong logoutAll,
    // test này fail và docs/SECURITY.md §1 cần cập nhật theo.
    const out = await auth.register({ email: 'la4@xt.local', password: PASSWORD }, ctx);
    const before = await prisma.user.findUnique({
      where: { id: out.user.id },
      select: { passwordVersion: true },
    });
    expect(before?.passwordVersion).toBe(1);

    await auth.logoutAll(out.user.id);

    const after = await prisma.user.findUnique({
      where: { id: out.user.id },
      select: { passwordVersion: true },
    });
    expect(after?.passwordVersion).toBe(before?.passwordVersion);
  });

  it('AuthError exposes code property', () => {
    const e = new AuthError('RATE_LIMITED');
    expect(e.code).toBe('RATE_LIMITED');
  });

  // ---------------- forgot/reset password ----------------

  it('forgotPassword: user tồn tại → tạo PasswordResetToken row + return devToken (NODE_ENV != production)', async () => {
    await auth.register({ email: 'fp1@xt.local', password: PASSWORD }, ctx);
    const out = await auth.forgotPassword({ email: 'fp1@xt.local' }, ctx);
    expect(typeof out.devToken).toBe('string');
    expect((out.devToken ?? '').length).toBeGreaterThan(20);
    const rows = await prisma.passwordResetToken.findMany({});
    expect(rows.length).toBe(1);
    expect(rows[0].consumedAt).toBeNull();
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('forgotPassword: email không tồn tại → silent ok, không tạo token (chống user enumeration)', async () => {
    const out = await auth.forgotPassword({ email: 'nobody@xt.local' }, ctx);
    expect(out.devToken).toBeNull();
    const rows = await prisma.passwordResetToken.findMany({});
    expect(rows.length).toBe(0);
  });

  it('forgotPassword: user banned → silent ok, không tạo token', async () => {
    const r = await auth.register({ email: 'fp-ban@xt.local', password: PASSWORD }, ctx);
    await prisma.user.update({ where: { id: r.user.id }, data: { banned: true } });
    const out = await auth.forgotPassword({ email: 'fp-ban@xt.local' }, ctx);
    expect(out.devToken).toBeNull();
    expect(await prisma.passwordResetToken.count({})).toBe(0);
  });

  it('forgotPassword: gọi 2 lần cho cùng user → token cũ bị mark consumed (one-shot per request)', async () => {
    await auth.register({ email: 'fp2@xt.local', password: PASSWORD }, ctx);
    await auth.forgotPassword({ email: 'fp2@xt.local' }, ctx);
    await auth.forgotPassword({ email: 'fp2@xt.local' }, ctx);
    const rows = await prisma.passwordResetToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.length).toBe(2);
    expect(rows[0].consumedAt).not.toBeNull(); // cũ revoked
    expect(rows[1].consumedAt).toBeNull(); // mới active
  });

  it('forgotPassword: rate limit 3/IP/15 phút → RATE_LIMITED', async () => {
    await auth.register({ email: 'fp3@xt.local', password: PASSWORD }, ctx);
    for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT_MAX; i++) {
      await auth.forgotPassword({ email: 'fp3@xt.local' }, ctx);
    }
    await expect(
      auth.forgotPassword({ email: 'fp3@xt.local' }, ctx),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('resetPassword: token hợp lệ → đổi pass + bump passwordVersion + revoke refresh tokens', async () => {
    const r = await auth.register({ email: 'rp1@xt.local', password: PASSWORD }, ctx);
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    const fp = await auth.forgotPassword({ email: 'rp1@xt.local' }, ctx);
    await auth.resetPassword({ token: fp.devToken!, newPassword: 'NewPass1234' });

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(userAfter.passwordVersion).toBe(userBefore.passwordVersion + 1);
    // Login với pass mới ok.
    const login = await auth.login({ email: 'rp1@xt.local', password: 'NewPass1234' }, ctx);
    expect(login.user.id).toBe(r.user.id);
    // Refresh token cũ đã revoke.
    await expect(auth.refresh(r.refreshToken, ctx)).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
    // Token đã consumed.
    const rows = await prisma.passwordResetToken.findMany({});
    expect(rows.length).toBe(1);
    expect(rows[0].consumedAt).not.toBeNull();
  });

  it('resetPassword: token sai → INVALID_RESET_TOKEN, password không đổi', async () => {
    await auth.register({ email: 'rp2@xt.local', password: PASSWORD }, ctx);
    await auth.forgotPassword({ email: 'rp2@xt.local' }, ctx);
    await expect(
      auth.resetPassword({ token: 'definitely-not-the-real-token-xxxx', newPassword: 'NewPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    // Pass cũ vẫn login được.
    const login = await auth.login({ email: 'rp2@xt.local', password: PASSWORD }, ctx);
    expect(login.user.email).toBe('rp2@xt.local');
  });

  it('resetPassword: token đã consumed → INVALID_RESET_TOKEN (one-shot)', async () => {
    await auth.register({ email: 'rp3@xt.local', password: PASSWORD }, ctx);
    const fp = await auth.forgotPassword({ email: 'rp3@xt.local' }, ctx);
    await auth.resetPassword({ token: fp.devToken!, newPassword: 'NewPass1234' });
    // Reuse → fail.
    await expect(
      auth.resetPassword({ token: fp.devToken!, newPassword: 'AnotherPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resetPassword: token đã expired → INVALID_RESET_TOKEN', async () => {
    await auth.register({ email: 'rp4@xt.local', password: PASSWORD }, ctx);
    const fp = await auth.forgotPassword({ email: 'rp4@xt.local' }, ctx);
    // Force expire.
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      auth.resetPassword({ token: fp.devToken!, newPassword: 'NewPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resetPassword: user banned sau khi xin token → INVALID_RESET_TOKEN', async () => {
    const r = await auth.register({ email: 'rp5@xt.local', password: PASSWORD }, ctx);
    const fp = await auth.forgotPassword({ email: 'rp5@xt.local' }, ctx);
    await prisma.user.update({ where: { id: r.user.id }, data: { banned: true } });
    await expect(
      auth.resetPassword({ token: fp.devToken!, newPassword: 'NewPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resetPassword: token format `id.secret` → lookup O(1) by id (Devin Review fix — không còn quét scan limit 50)', async () => {
    const r = await auth.register({ email: 'rp6@xt.local', password: PASSWORD }, ctx);
    const fp = await auth.forgotPassword({ email: 'rp6@xt.local' }, ctx);
    expect(fp.devToken).toMatch(/^[^.]+\..+$/);
    const [tokenId, secret] = fp.devToken!.split('.');
    const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: tokenId } });
    expect(row.userId).toBe(r.user.id);
    // Secret không bao giờ được lưu plaintext trong DB.
    expect(row.hashedToken).not.toContain(secret);
    expect(row.hashedToken.startsWith('$argon2')).toBe(true);
  });

  it('resetPassword: token id đúng + secret sai → INVALID_RESET_TOKEN (không leak token row tồn tại)', async () => {
    await auth.register({ email: 'rp7@xt.local', password: PASSWORD }, ctx);
    const fp = await auth.forgotPassword({ email: 'rp7@xt.local' }, ctx);
    const [tokenId] = fp.devToken!.split('.');
    await expect(
      auth.resetPassword({ token: `${tokenId}.wrong-secret-xxxxx`, newPassword: 'NewPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resetPassword: token id không tồn tại → INVALID_RESET_TOKEN (chống enum)', async () => {
    await expect(
      auth.resetPassword({
        token: 'nonexistent-id-xxxxx.some-secret-xxxxx',
        newPassword: 'NewPass1234',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('resetPassword: token thiếu dấu chấm → INVALID_RESET_TOKEN (format guard)', async () => {
    await expect(
      auth.resetPassword({ token: 'no-dot-here-xxxxxxxxx', newPassword: 'NewPass1234' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('forgotPassword: timing parity user-exists vs not-exists (Devin Review fix r3163261711 chống enum)', async () => {
    await auth.register({ email: 'fp-timing-yes@xt.local', password: PASSWORD }, ctx);

    // Warm up cache argon2 (1st call có overhead init).
    await auth.forgotPassword({ email: 'fp-timing-yes@xt.local' }, ctx);

    const t1 = Date.now();
    await auth.forgotPassword({ email: 'fp-timing-yes@xt.local' }, ctx);
    const dExists = Date.now() - t1;

    const t2 = Date.now();
    await auth.forgotPassword({ email: 'fp-timing-nope@xt.local' }, ctx);
    const dMissing = Date.now() - t2;

    // Cả 2 path phải chạy argon2.hash → chênh lệch ≤ 50ms (overhead DB query
    // + transaction). Nếu missing không có dummy work, dMissing ≪ dExists
    // (vài ms vs ~100ms+).
    const ratio = dMissing / Math.max(dExists, 1);
    expect(ratio).toBeGreaterThan(0.5);
  });
});
