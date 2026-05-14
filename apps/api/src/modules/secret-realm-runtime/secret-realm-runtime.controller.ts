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
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import {
  SecretRealmError,
  SecretRealmRuntimeService,
} from './secret-realm-runtime.service';

const ACCESS_COOKIE = 'xt_access';
const EnterInput = z.object({ realmKey: z.string().min(1).max(64) });
const ProgressInput = z.object({
  objectiveKey: z.string().min(1).max(64),
  delta: z.number().int().min(1).max(100),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('secret-realms/v1')
export class SecretRealmRuntimeController {
  constructor(
    private readonly svc: SecretRealmRuntimeService,
    private readonly auth: AuthService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get()
  async list(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const realms = await this.svc.list(userId);
      return { ok: true, data: { realms } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('history')
  async history(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = await this.requireUserId(req);
    const parsed = z
      .object({ limit: z.coerce.number().int().min(1).max(90).optional() })
      .safeParse({ limit });
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const history = await this.svc.history(userId, parsed.data.limit ?? 30);
      return { ok: true, data: { history } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('enter')
  @HttpCode(200)
  async enter(@Req() req: Request, @Body() body: unknown) {
    // Phase 45.0 — SECRET_REALM_ENABLED kill switch. Trả 503 khi admin tắt
    // (vd reward audit findings) — người chơi nhận FEATURE_DISABLED.
    await this.featureFlags.requireEnabled('SECRET_REALM_ENABLED');
    const userId = await this.requireUserId(req);
    const parsed = EnterInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.svc.enter(userId, parsed.data.realmKey);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('runs/:runId')
  async getRun(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const run = await this.svc.getRun(userId, runId);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('runs/:runId/progress')
  @HttpCode(200)
  async progress(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    const parsed = ProgressInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.svc.progress(
        userId,
        runId,
        parsed.data.objectiveKey,
        parsed.data.delta,
      );
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('runs/:runId/complete')
  @HttpCode(200)
  async complete(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const run = await this.svc.complete(userId, runId);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('runs/:runId/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const result = await this.svc.claim(userId, runId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SecretRealmError) {
      const code = e.code;
      switch (code) {
        case 'NO_CHARACTER':
        case 'SECRET_REALM_NOT_FOUND':
        case 'SECRET_REALM_RUN_NOT_FOUND':
          fail(code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SECRET_REALM_REALM_LOCKED':
        case 'SECRET_REALM_COOLDOWN':
        case 'SECRET_REALM_RUN_ACTIVE':
        case 'SECRET_REALM_RUN_NOT_ACTIVE':
        case 'SECRET_REALM_OBJECTIVES_INCOMPLETE':
        case 'SECRET_REALM_NOT_CLEARED':
          fail(code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'SECRET_REALM_OBJECTIVE_INVALID':
        case 'SECRET_REALM_DELTA_INVALID':
          fail(code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        default:
          fail(code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
