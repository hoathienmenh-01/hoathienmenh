import { Inject, Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  sanitizeUserAgent,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordInput,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { EmailService } from '../email/email.service';
import {
  InMemorySlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';
import { SessionService } from './session.service';

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'WEAK_PASSWORD'
  | 'OLD_PASSWORD_WRONG'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_BANNED'
  | 'INVALID_RESET_TOKEN';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode) {
    super(code);
  }
}

interface AuthOutput {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/**
 * Auth request context. Phase 18.2 thêm:
 *   - `ipHash` (sha256(salt||ip)) — caller hash trước; service KHÔNG
 *     nhận raw IP cho session row (privacy).
 *   - `userAgent` raw — service tự sanitize qua `sanitizeUserAgent`
 *     trước khi persist.
 *
 * `ip` raw vẫn cần cho rate-limit (LoginAttempt count theo ip column
 * legacy + forgot-password limiter key); session row chỉ dùng `ipHash`.
 */
interface AuthCtx {
  ip: string;
  /** sha256(salt || ip) hash đã tính ở controller. Null nếu không có. */
  ipHash?: string | null;
  /** Raw UA header; service sẽ sanitize. Null nếu request không gửi. */
  userAgent?: string | null;
}

interface UserForToken {
  id: string;
  email: string;
  role: 'PLAYER' | 'MOD' | 'ADMIN';
  passwordVersion: number;
  banned: boolean;
  createdAt: Date;
}

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
};

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_FAILS = 5;

/** Anti-bot/anti-scripted-spam cho register: tối đa 5 user mới/IP/15 phút. */
export const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const REGISTER_RATE_LIMIT_MAX = 5;
export const REGISTER_RATE_LIMITER = 'AUTH_REGISTER_RATE_LIMITER';

/** Forgot-password rate limit: tối đa 3 request/IP/15 phút (anti-spam mailflood). */
export const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const FORGOT_PASSWORD_RATE_LIMIT_MAX = 3;
export const FORGOT_PASSWORD_RATE_LIMITER = 'AUTH_FORGOT_PASSWORD_RATE_LIMITER';

/** TTL token reset password (đặt lại mật khẩu) — mặc định 30 phút. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const ACCESS_TTL_SEC_DEFAULT = 15 * 60;
const REFRESH_TTL_SEC_DEFAULT = 30 * 24 * 60 * 60;

const INSECURE_DEFAULTS = new Set([
  'change-me-access-secret',
  'change-me-refresh-secret',
  'dev-access-secret',
  'dev-refresh-secret',
]);

@Injectable()
export class AuthService {
  private readonly registerLimiter: RateLimiter;
  private readonly forgotPasswordLimiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly sessions: SessionService,
    @Optional() @Inject(REGISTER_RATE_LIMITER) registerLimiter?: RateLimiter,
    @Optional() @Inject(FORGOT_PASSWORD_RATE_LIMITER) forgotPasswordLimiter?: RateLimiter,
    @Optional() private readonly email?: EmailService,
  ) {
    this.registerLimiter =
      registerLimiter ??
      new InMemorySlidingWindowRateLimiter(
        REGISTER_RATE_LIMIT_WINDOW_MS,
        REGISTER_RATE_LIMIT_MAX,
      );
    this.forgotPasswordLimiter =
      forgotPasswordLimiter ??
      new InMemorySlidingWindowRateLimiter(
        FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
        FORGOT_PASSWORD_RATE_LIMIT_MAX,
      );
  }

  // ---------------- public API ----------------

  async register(input: RegisterInput, ctx: AuthCtx): Promise<AuthOutput> {
    const result = await this.registerLimiter.check(`ip:${ctx.ip}`);
    if (!result.allowed) throw new AuthError('RATE_LIMITED');

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AuthError('EMAIL_TAKEN');

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTS);
    const user = await this.prisma.user.create({
      data: { email: input.email, passwordHash },
    });
    return this.issueTokens(user, ctx);
  }

  async login(input: LoginInput, ctx: AuthCtx): Promise<AuthOutput> {
    await this.assertNotRateLimited(input.email, ctx.ip);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.recordAttempt(input.email, ctx.ip, false);
      throw new AuthError('INVALID_CREDENTIALS');
    }
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.recordAttempt(input.email, ctx.ip, false);
      throw new AuthError('INVALID_CREDENTIALS');
    }
    if (user.banned) {
      await this.recordAttempt(input.email, ctx.ip, false);
      throw new AuthError('ACCOUNT_BANNED');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.recordAttempt(input.email, ctx.ip, true);
    return this.issueTokens(user, ctx);
  }

  /**
   * Forgot-password — silent: luôn trả `{ ok: true }` cho client (không leak
   * email exists/not). Bên trong:
   *  - rate-limit theo IP (3 req/15 phút) — vượt → throw RATE_LIMITED.
   *  - nếu user tồn tại + chưa banned → tạo `PasswordResetToken` mới
   *    (revoke các token cũ chưa consumed của user trước), gửi email reset.
   *  - nếu user không tồn tại / banned → return silently, không gửi mail.
   *
   * Trả `{ devToken }` chỉ khi `NODE_ENV !== 'production'` để E2E/dev test
   * không cần vào Mailhog UI; production luôn `null`.
   */
  async forgotPassword(
    input: ForgotPasswordInput,
    ctx: AuthCtx,
  ): Promise<{ devToken: string | null }> {
    const rl = await this.forgotPasswordLimiter.check(`ip:${ctx.ip}`);
    if (!rl.allowed) throw new AuthError('RATE_LIMITED');

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.banned) {
      // Timing side-channel mitigation: chạy argon2.hash giả với cùng chi phí
      // (~100ms) để response time path-này tương đương path-có-user. Không có
      // dummy work, attacker đo network latency có thể phân biệt email tồn
      // tại vs không (Devin Review fix r3163261711).
      await argon2.hash('xt-forgot-password-dummy-padding', ARGON2_OPTS);
      return { devToken: null };
    }

    // Token format: `<tokenId>.<secret>` — `tokenId` là `id` DB row (non-secret,
    // chỉ để lookup O(1)); `secret` là 32-byte URL-safe base64 (~43 ký tự).
    // DB lưu argon2 hash của `secret` (không lưu `tokenId`).
    const tokenId = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const hashed = await argon2.hash(secret, ARGON2_OPTS);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
    const plaintext = `${tokenId}.${secret}`;

    await this.prisma.$transaction([
      // Revoke các token reset cũ chưa consumed/expired của user (one-shot per request).
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { id: tokenId, userId: user.id, hashedToken: hashed, expiresAt },
      }),
    ]);

    if (this.email) {
      try {
        await this.email.sendPasswordResetEmail({
          to: user.email,
          token: plaintext,
          expiresAt,
        });
      } catch {
        // Không throw để tránh leak email exists qua thời gian response.
        // EmailService log error qua Logger nội bộ.
      }
    }

    const isProd = (this.cfg.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
    return { devToken: isProd ? null : plaintext };
  }

  /**
   * Reset password bằng token đã gửi qua email.
   * Token format `<tokenId>.<secret>`: split → lookup row by `tokenId` (O(1)
   * indexed PK), rồi `argon2.verify` chỉ row đó. Không còn quét toàn bộ
   * token active (PR #101 review fix — chống DOS bằng cách flood 51+ token
   * khác user → đẩy token nạn nhân khỏi top-50 scan window).
   *
   * Side-effect (atomic):
   *  - Mark token consumed (one-shot).
   *  - Update user passwordHash + bump `passwordVersion` (invalidate access tokens cũ).
   *  - Revoke tất cả refresh tokens active của user.
   *  - Mark mọi reset token còn lại của user là consumed (revoke).
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const dotIdx = input.token.indexOf('.');
    if (dotIdx <= 0 || dotIdx === input.token.length - 1) {
      throw new AuthError('INVALID_RESET_TOKEN');
    }
    const tokenId = input.token.slice(0, dotIdx);
    const secret = input.token.slice(dotIdx + 1);

    const row = await this.prisma.passwordResetToken.findUnique({
      where: { id: tokenId },
    });
    if (!row || row.consumedAt !== null || row.expiresAt <= new Date()) {
      throw new AuthError('INVALID_RESET_TOKEN');
    }

    let ok = false;
    try {
      ok = await argon2.verify(row.hashedToken, secret);
    } catch {
      ok = false;
    }
    if (!ok) throw new AuthError('INVALID_RESET_TOKEN');

    const matched = { id: row.id, userId: row.userId };
    const user = await this.prisma.user.findUnique({ where: { id: matched.userId } });
    if (!user || user.banned) throw new AuthError('INVALID_RESET_TOKEN');

    const newHash = await argon2.hash(input.newPassword, ARGON2_OPTS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: matched.id },
        data: { consumedAt: now },
      }),
      // Revoke tất cả token reset khác của user (chống multi-window misuse).
      this.prisma.passwordResetToken.updateMany({
        where: { userId: matched.userId, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.user.update({
        where: { id: matched.userId },
        data: { passwordHash: newHash, passwordVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: matched.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    // Phase 18.2 — revoke tất cả UserSession của user khi reset password.
    await this.sessions.revokeAllForUser({
      userId: matched.userId,
      reason: 'PASSWORD_CHANGED',
      revokedById: matched.userId,
    });
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthError('OLD_PASSWORD_WRONG');
    const ok = await argon2.verify(user.passwordHash, input.oldPassword);
    if (!ok) throw new AuthError('OLD_PASSWORD_WRONG');

    const newHash = await argon2.hash(input.newPassword, ARGON2_OPTS);
    // Atomically rotate password + bump passwordVersion + revoke all refresh tokens.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash, passwordVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    // Phase 18.2 — revoke tất cả UserSession của user khi password đổi.
    await this.sessions.revokeAllForUser({
      userId,
      reason: 'PASSWORD_CHANGED',
      revokedById: userId,
    });
  }

  async session(accessToken: string | undefined): Promise<PublicUser> {
    const userId = await this.userIdFromAccess(accessToken);
    if (!userId) throw new AuthError('UNAUTHENTICATED');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthError('UNAUTHENTICATED');
    if (user.banned) throw new AuthError('ACCOUNT_BANNED');
    return this.toPublic(user);
  }

  /**
   * Refresh token rotation:
   *  - verify JWT
   *  - look up RefreshToken row by jti
   *  - **Reuse detection**: nếu row đã revoke (rotate trước đó) NHƯNG
   *    argon2 hash khớp → genuine reuse → defensive revoke cả session
   *    family + emit `REFRESH_TOKEN_REUSED` SecurityEvent + throw
   *    `SESSION_EXPIRED`.
   *  - check argon2 hashedToken vs presented JWT
   *  - revoke old, mint new (linked qua `rotatedFromId` + cùng
   *    `sessionId`); touch `lastSeenAt` của session.
   */
  async refresh(presented: string | undefined, ctx: AuthCtx): Promise<AuthOutput> {
    if (!presented) throw new AuthError('SESSION_EXPIRED');

    let payload: { sub: string; v: number; jti: string; exp?: number };
    try {
      payload = await this.jwt.verifyAsync(presented, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new AuthError('SESSION_EXPIRED');
    }

    const row = await this.prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
    if (!row) throw new AuthError('SESSION_EXPIRED');

    // Phase 18.2 — Reuse detection.
    // Token row đã revoke nhưng argon2 hash khớp → present lại token
    // cũ đã rotate. Defensive revoke session family + emit
    // SecurityEvent REFRESH_TOKEN_REUSED.
    if (row.revokedAt) {
      let matchesRevoked = false;
      try {
        matchesRevoked = await argon2.verify(row.hashedToken, presented);
      } catch {
        matchesRevoked = false;
      }
      if (matchesRevoked) {
        await this.sessions.handleReuseDetected({
          refreshTokenId: row.id,
          sessionId: row.sessionId,
          userId: row.userId,
          ipHash: ctx.ipHash ?? null,
        });
      }
      throw new AuthError('SESSION_EXPIRED');
    }

    if (row.expiresAt.getTime() <= Date.now()) throw new AuthError('SESSION_EXPIRED');

    const matches = await argon2.verify(row.hashedToken, presented);
    if (!matches) {
      // Hash mismatch trên row chưa revoke — tampered token (vd attacker
      // brute-force jti). KHÔNG escalate session reuse (chưa có bằng
      // chứng rotation): revoke chỉ row này.
      await this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      throw new AuthError('SESSION_EXPIRED');
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw new AuthError('UNAUTHENTICATED');
    if (user.banned) throw new AuthError('ACCOUNT_BANNED');
    if (user.passwordVersion !== row.passwordVersion) throw new AuthError('SESSION_EXPIRED');

    // Phase 18.2 — kiểm tra session vẫn ACTIVE.
    if (row.sessionId) {
      const session = await this.sessions.findById(row.sessionId);
      if (!session || session.revokedAt) throw new AuthError('SESSION_EXPIRED');
      if (session.expiresAt.getTime() <= Date.now()) {
        throw new AuthError('SESSION_EXPIRED');
      }
    }

    // Mint new tokens — link với cùng sessionId của old row (continue
    // session family).
    const minted = await this.mintForRotation(user, ctx, row.id, row.sessionId);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    if (row.sessionId) {
      await this.sessions.touchSession(row.sessionId);
    }
    return minted;
  }

  /**
   * Revoke ALL refresh tokens của user → các thiết bị khác sẽ logout
   * trong vòng 1 access TTL (mặc định 15 phút).
   * Không bump passwordVersion vì password chưa đổi.
   *
   * Phase 18.2 — revoke kèm tất cả UserSession active của user.
   */
  async logoutAll(userId: string): Promise<{ revoked: number }> {
    const r = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.sessions.revokeAllForUser({
      userId,
      reason: 'USER_LOGOUT',
      revokedById: userId,
    });
    return { revoked: r.count };
  }

  /**
   * Revoke the presented refresh token (logout). Idempotent.
   *
   * Phase 18.2 — revoke kèm UserSession của refresh token đó (1 device
   * logout) để session list user thấy được trạng thái mới ngay.
   *
   * Return: id session đã revoke (hoặc null nếu token đã expire/tampered).
   */
  async logout(presented: string | undefined): Promise<{ sessionId: string | null }> {
    if (!presented) return { sessionId: null };
    let jti: string | undefined;
    try {
      const payload = await this.jwt.verifyAsync<{ jti?: string }>(presented, {
        secret: this.refreshSecret(),
      });
      jti = payload.jti;
    } catch {
      return { sessionId: null };
    }
    if (!jti) return { sessionId: null };
    const row = await this.prisma.refreshToken.findUnique({ where: { jti } });
    if (!row) return { sessionId: null };
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: row.revokedAt ?? new Date() },
    });
    if (row.sessionId) {
      await this.sessions.revokeSession({
        sessionId: row.sessionId,
        reason: 'USER_LOGOUT',
        revokedById: row.userId,
      });
    }
    return { sessionId: row.sessionId ?? null };
  }

  /**
   * Phase 18.2 — Resolve sessionId của request hiện tại từ refresh
   * cookie. Dùng để flag `current=true` trong list session response.
   *
   * Trả null nếu cookie thiếu/expired/tampered/row không tồn tại.
   */
  async sessionIdFromRefreshCookie(
    presented: string | undefined,
  ): Promise<string | null> {
    if (!presented) return null;
    let jti: string | undefined;
    try {
      const payload = await this.jwt.verifyAsync<{ jti?: string }>(presented, {
        secret: this.refreshSecret(),
      });
      jti = payload.jti;
    } catch {
      return null;
    }
    if (!jti) return null;
    const row = await this.prisma.refreshToken.findUnique({
      where: { jti },
      select: { sessionId: true },
    });
    return row?.sessionId ?? null;
  }

  async userIdFromAccess(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; v?: number }>(token, {
        secret: this.accessSecret(),
      });
      if (!payload.sub) return null;
      // passwordVersion match check — invalidates access tokens issued before password change.
      // (Banned status is checked by callers like session() so they can return a distinct
      // error code; we only care here that the token was minted for the *current* password.)
      if (typeof payload.v === 'number') {
        const u = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { passwordVersion: true },
        });
        if (!u) return null;
        if (u.passwordVersion !== payload.v) return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  toPublic(user: UserForToken | { id: string; email: string; role: 'PLAYER' | 'MOD' | 'ADMIN'; createdAt: Date }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  // ---------------- internals ----------------

  private async issueTokens(user: UserForToken, ctx: AuthCtx): Promise<AuthOutput> {
    // Phase 18.2 — login/register: tạo UserSession mới, sau đó mint
    // refresh token + link sessionId.
    const refreshTtl = Number(this.cfg.get<string>('JWT_REFRESH_TTL') ?? REFRESH_TTL_SEC_DEFAULT);
    const session = await this.sessions.createSession({
      userId: user.id,
      ipHash: ctx.ipHash ?? null,
      userAgent: sanitizeUserAgent(ctx.userAgent ?? null),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    // Phase 18.2 — suspicious login detection (fire-and-forget).
    // Check concurrent sessions from different IP within 5 min window.
    void this.sessions.detectSuspiciousLogin({
      userId: user.id,
      newSessionId: session.id,
      newIpHash: ctx.ipHash ?? null,
    });

    return this.mintForRotation(user, ctx, null, session.id);
  }

  /**
   * Mint access + refresh token; persist RefreshToken row linked với
   * `sessionId` (Phase 18.2).
   *
   * Caller:
   *   - `issueTokens` (login/register) → `rotatedFromId=null`, sessionId
   *     của UserSession vừa tạo.
   *   - `refresh` rotation → `rotatedFromId=oldRow.id`, sessionId của
   *     session đang được rotate (continue family).
   */
  private async mintForRotation(
    user: UserForToken,
    _ctx: AuthCtx,
    rotatedFromId: string | null,
    sessionId: string | null,
  ): Promise<AuthOutput> {
    const accessTtl = Number(this.cfg.get<string>('JWT_ACCESS_TTL') ?? ACCESS_TTL_SEC_DEFAULT);
    const refreshTtl = Number(this.cfg.get<string>('JWT_REFRESH_TTL') ?? REFRESH_TTL_SEC_DEFAULT);

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, v: user.passwordVersion },
      { secret: this.accessSecret(), expiresIn: `${accessTtl}s` },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, v: user.passwordVersion, jti },
      { secret: this.refreshSecret(), expiresIn: `${refreshTtl}s` },
    );
    const hashedToken = await argon2.hash(refreshToken, ARGON2_OPTS);
    await this.prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        hashedToken,
        passwordVersion: user.passwordVersion,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        rotatedFromId,
        sessionId,
      },
    });

    return { user: this.toPublic(user), accessToken, refreshToken };
  }

  private async assertNotRateLimited(email: string, ip: string): Promise<void> {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const fails = await this.prisma.loginAttempt.count({
      where: { email, ip, success: false, createdAt: { gte: since } },
    });
    if (fails >= RATE_LIMIT_MAX_FAILS) throw new AuthError('RATE_LIMITED');
  }

  private async recordAttempt(email: string, ip: string, success: boolean): Promise<void> {
    await this.prisma.loginAttempt.create({ data: { email, ip, success } });
  }

  private accessSecret(): string {
    const v = this.cfg.get<string>('JWT_ACCESS_SECRET');
    if (process.env.NODE_ENV === 'production') {
      if (!v || INSECURE_DEFAULTS.has(v)) {
        throw new Error('[xuantoi/api] Production thiếu JWT_ACCESS_SECRET hợp lệ');
      }
      return v;
    }
    return v && v.length > 0 ? v : 'dev-access-secret';
  }

  private refreshSecret(): string {
    const v = this.cfg.get<string>('JWT_REFRESH_SECRET');
    if (process.env.NODE_ENV === 'production') {
      if (!v || INSECURE_DEFAULTS.has(v)) {
        throw new Error('[xuantoi/api] Production thiếu JWT_REFRESH_SECRET hợp lệ');
      }
      return v;
    }
    return v && v.length > 0 ? v : 'dev-refresh-secret';
  }
}
