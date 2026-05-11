import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  CoopBossContributionDto,
  CoopBossRewardClaimDto,
  CoopBossRewardPreview,
  CoopBossRunDetailResponse,
  CoopBossRunListResponse,
  MyCoopBossRunResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { CoopBossError, CoopBossService } from './coop-boss.service';

const ACCESS_COOKIE = 'xt_access';

const CreateRunInput = z.object({
  bossKey: z.string().min(1).max(80),
  worldBossEventId: z.string().min(1).max(80).optional(),
});

const ContributionInput = z.object({
  runId: z.string().min(1).max(80),
  damageDone: z
    .union([z.number(), z.string()])
    .refine(
      (v) => {
        if (typeof v === 'number') return Number.isFinite(v) && v >= 0;
        return /^\d+$/.test(v);
      },
      { message: 'damageDone must be non-negative integer' },
    ),
  supportScore: z.number().int().min(0).max(1_000_000),
  survivalSeconds: z.number().int().min(0).max(86_400),
});

const FinishInput = z.object({
  runId: z.string().min(1).max(80),
  result: z.enum(['CLEARED', 'FAILED']),
});

const RunIdParam = z.string().min(1).max(80);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 20.2 — Co-op Boss Party Contribution REST surface.
 *
 * Auth: cookie `xt_access` → `AuthService.requireUserId`. Mọi
 * endpoint yêu cầu authenticated PLAYER.
 *
 * Privacy / authz: mutation pass qua service `CoopBossService`.
 * Service enforce:
 *   - Caller phải ở party active. Non-member → `NOT_IN_PARTY` →
 *     404 mask (`NOT_FOUND`).
 *   - Caller phải cùng party với run. Người ngoài → `NOT_PARTY_MEMBER`
 *     → 404 mask.
 *   - Leader-only ops (`createRun`, `finishRun`, `cancelRun`) →
 *     `NOT_PARTY_LEADER` → 403.
 *
 * Rate-limit:
 *   - `POST /coop/boss/runs`               → `COOP_BOSS_CREATE`
 *   - `POST /coop/boss/runs/:id/join`      → `COOP_BOSS_JOIN`
 *   - `POST /coop/boss/runs/:id/leave`     → `COOP_BOSS_JOIN`
 *   - `POST /coop/boss/runs/:id/contribution` → `COOP_BOSS_CONTRIBUTION`
 *   - `POST /coop/boss/runs/:id/finish`    → `COOP_BOSS_FINISH`
 *   - `POST /coop/boss/runs/:id/cancel`    → `COOP_BOSS_FINISH`
 *   - `POST /coop/boss/runs/:id/claim-reward` → `COOP_BOSS_CLAIM`
 *
 * GET endpoints KHÔNG gắn policy (fall through `DEFAULT_API`).
 *
 * KHÔNG log token / cookie / secret.
 */
@Controller('coop/boss')
export class CoopBossController {
  constructor(
    private readonly coopBoss: CoopBossService,
    private readonly auth: AuthService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[ACCESS_COOKIE];
    const id = await this.auth.userIdFromAccess(token);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private statusFor(code: CoopBossError['code']): number {
    switch (code) {
      case 'NOT_FOUND':
      case 'RUN_NOT_FOUND':
      case 'PARTICIPANT_NOT_FOUND':
      case 'REWARD_NOT_FOUND':
      case 'NOT_IN_PARTY':
      case 'NOT_PARTY_MEMBER':
        return HttpStatus.NOT_FOUND;
      case 'NOT_AUTHORIZED':
      case 'NOT_PARTY_LEADER':
      case 'REWARD_NOT_ELIGIBLE':
        return HttpStatus.FORBIDDEN;
      case 'INVALID_INPUT':
      case 'INVALID_BOSS_KEY':
      case 'NO_CHARACTER':
        return HttpStatus.BAD_REQUEST;
      case 'RUN_ALREADY_EXISTS':
      case 'RUN_NOT_LOBBY':
      case 'RUN_NOT_ACTIVE':
      case 'RUN_ALREADY_FINISHED':
      case 'RUN_NOT_FINISHED':
      case 'NOT_ENOUGH_MEMBERS':
      case 'CONTRIBUTION_WINDOW_CLOSED':
      case 'PARTICIPANT_LEFT':
      case 'REWARD_ALREADY_CLAIMED':
      case 'DAILY_CAP_REACHED':
      case 'WEEKLY_CAP_REACHED':
        // Phase 20.3 — cap gate reject mirrors REWARD_ALREADY_CLAIMED
        // (caller có row claim hợp lệ nhưng bị reject vì rate ngoài
        // tham số) → 409 Conflict.
        return HttpStatus.CONFLICT;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }

  private rethrowAsHttp(e: unknown): never {
    if (e instanceof CoopBossError) {
      throw new HttpException(
        { ok: false, error: { code: e.code, message: e.code } },
        this.statusFor(e.code),
      );
    }
    if (e instanceof HttpException) throw e;
    throw new HttpException(
      { ok: false, error: { code: 'INTERNAL' } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  @Get('runs/current')
  async getCurrent(
    @Req() req: Request,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const data = await this.coopBoss.getMyRun(userId);
    return { ok: true, data };
  }

  @Get('runs/mine')
  async listMine(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ): Promise<{ ok: true; data: CoopBossRunListResponse }> {
    const userId = await this.requireUserId(req);
    const lim = limit ? Number(limit) : undefined;
    const data = await this.coopBoss.listMyBossRuns({ userId, limit: lim });
    return { ok: true, data };
  }

  @Get('runs/:id')
  async getRun(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: CoopBossRunDetailResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.getRunSummary({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Get('runs/:id/reward-preview')
  async previewReward(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { preview: CoopBossRewardPreview | null } }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const preview = await this.coopBoss.previewReward({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data: { preview } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  @Post('runs')
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('COOP_BOSS_CREATE')
  async createRun(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = CreateRunInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.createRun({
        leaderUserId: userId,
        bossKey: parsed.data.bossKey,
        worldBossEventId: parsed.data.worldBossEventId ?? null,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/join')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_JOIN')
  async joinRun(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.joinRun({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/leave')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_JOIN')
  async leaveRun(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.leaveRun({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/contribution')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_CONTRIBUTION')
  async recordContribution(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: { contribution: CoopBossContributionDto } }> {
    const userId = await this.requireUserId(req);
    const parsedId = RunIdParam.safeParse(id);
    if (!parsedId.success) fail('INVALID_INPUT');
    const parsedBody = ContributionInput.safeParse({
      ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}),
      runId: parsedId.data,
    });
    if (!parsedBody.success) fail('INVALID_INPUT');
    const damage =
      typeof parsedBody.data.damageDone === 'string'
        ? BigInt(parsedBody.data.damageDone)
        : parsedBody.data.damageDone;
    try {
      const contribution = await this.coopBoss.recordContribution({
        userId,
        runId: parsedId.data,
        damageDone: damage,
        supportScore: parsedBody.data.supportScore,
        survivalSeconds: parsedBody.data.survivalSeconds,
      });
      return { ok: true, data: { contribution } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/finish')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_FINISH')
  async finishRun(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const parsedId = RunIdParam.safeParse(id);
    if (!parsedId.success) fail('INVALID_INPUT');
    const parsedBody = FinishInput.safeParse({
      ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}),
      runId: parsedId.data,
    });
    if (!parsedBody.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.finishRun({
        leaderUserId: userId,
        runId: parsedId.data,
        result: parsedBody.data.result,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_FINISH')
  async cancelRun(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: MyCoopBossRunResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.coopBoss.cancelRun({
        leaderUserId: userId,
        runId: parsed.data,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/claim-reward')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('COOP_BOSS_CLAIM')
  async claimReward(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { claim: CoopBossRewardClaimDto } }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const claim = await this.coopBoss.claimReward({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data: { claim } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }
}
