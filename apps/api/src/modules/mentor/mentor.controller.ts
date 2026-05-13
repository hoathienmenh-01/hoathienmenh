import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  MentorListStudentsResponse,
  MentorMilestoneListResponse,
  MentorProfileRow,
  MentorRelationRow,
  StudentMentorContextResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import {
  MentorMilestoneError,
  MentorMilestoneService,
} from './mentor-milestone.service';
import { MentorError, MentorService } from './mentor.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const RegisterInput = z.object({
  intro: z.string().max(280).optional().nullable(),
  acceptingStudents: z.boolean().optional(),
});

const RequestInput = z.object({
  mentorUserId: z.string().min(1).max(64),
  message: z.string().max(240).optional().nullable(),
});

const RespondInput = z.object({
  accept: z.boolean(),
});

@Controller('mentor')
export class MentorController {
  constructor(
    private readonly svc: MentorService,
    private readonly milestones: MentorMilestoneService,
    private readonly auth: AuthService,
  ) {}

  @Get('profile')
  async profile(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { profile: MentorProfileRow | null } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const profile = await this.svc.getProfile(userId);
    return { ok: true, data: { profile } };
  }

  @Post('register')
  @HttpCode(200)
  async register(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { profile: MentorProfileRow } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RegisterInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const profile = await this.svc.register(userId, parsed.data);
      return { ok: true, data: { profile } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('request')
  @HttpCode(200)
  async request(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { relation: MentorRelationRow } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RequestInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const relation = await this.svc.request(userId, parsed.data);
      return { ok: true, data: { relation } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('accept/:relationId')
  @HttpCode(200)
  async accept(
    @Req() req: Request,
    @Param('relationId') relationId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { relation: MentorRelationRow } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RespondInput.safeParse(body ?? {});
    const accept = parsed.success ? parsed.data.accept : true;
    try {
      const relation = await this.svc.respond(userId, relationId, accept);
      return { ok: true, data: { relation } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('students')
  async students(
    @Req() req: Request,
  ): Promise<{ ok: true; data: MentorListStudentsResponse }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const data = await this.svc.listStudents(userId);
    return { ok: true, data };
  }

  @Get('student-context')
  async studentContext(
    @Req() req: Request,
  ): Promise<{ ok: true; data: StudentMentorContextResponse }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const data = await this.svc.getStudentContext(userId);
    return { ok: true, data };
  }

  @Get('milestones')
  async milestonesList(
    @Req() req: Request,
  ): Promise<{ ok: true; data: MentorMilestoneListResponse }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.milestones.listForUser(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleMilestoneErr(e);
    }
  }

  @Post('milestones/:milestoneKey/claim')
  @HttpCode(200)
  async milestonesClaim(
    @Req() req: Request,
    @Param('milestoneKey') milestoneKey: string,
  ): Promise<{
    ok: true;
    data: { role: string; rewardLinhThach: string; mailId: string };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.milestones.claim(userId, milestoneKey);
      return { ok: true, data };
    } catch (e) {
      this.handleMilestoneErr(e);
    }
  }

  @Post('milestones/recompute')
  @HttpCode(200)
  async milestonesRecompute(
    @Req() req: Request,
  ): Promise<{
    ok: true;
    data: { relationId: string | null; created: number; promoted: number };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const r = await this.milestones.recomputeForUser(userId);
      return {
        ok: true,
        data: r
          ? { relationId: r.relationId, created: r.created, promoted: r.promoted }
          : { relationId: null, created: 0, promoted: 0 },
      };
    } catch (e) {
      this.handleMilestoneErr(e);
    }
  }

  private handleMilestoneErr(e: unknown): never {
    if (e instanceof MentorMilestoneError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NOT_FOUND':
        case 'MILESTONE_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_AUTHORIZED':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_IN_ACTIVE_RELATION':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'MILESTONE_LOCKED':
        case 'MILESTONE_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }

  private handleErr(e: unknown): never {
    if (e instanceof MentorError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NOT_FOUND':
        case 'NOT_MENTOR':
        case 'NOT_STUDENT':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_AUTHORIZED':
        case 'SELF_NOT_ALLOWED':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'ALREADY_PENDING':
        case 'ALREADY_ACTIVE':
        case 'STUDENT_ALREADY_HAS_MENTOR':
        case 'MENTOR_STUDENT_CAP_REACHED':
        case 'PENDING_REQUEST_CAP_REACHED':
        case 'INVALID_TRANSITION':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'TIER_TOO_LOW':
        case 'TIER_TOO_HIGH':
        case 'TIER_GAP_TOO_SMALL':
        case 'INVALID_INPUT':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
