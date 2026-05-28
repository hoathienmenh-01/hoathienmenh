import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  GroupChatListResponse,
  GroupChatMemberRow,
  GroupChatMessageRow,
  GroupChatMessagesResponse,
  GroupChatRow,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  ChatGroupError,
  ChatGroupService,
} from './chat-group.service';

const ACCESS_COOKIE = 'xt_access';

const CreateGroupInput = z.object({
  name: z.string().min(1).max(200),
});

const AddMemberInput = z.object({
  userId: z.string().min(1).max(64),
});

const SendInput = z.object({
  body: z.string().min(1).max(2000),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function statusFor(code: ChatGroupError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
      return HttpStatus.FORBIDDEN;
    case 'BLOCKED':
      return HttpStatus.FORBIDDEN;
    case 'MUTED':
      return HttpStatus.FORBIDDEN;
    case 'GROUP_LOCKED':
      return HttpStatus.FORBIDDEN;
    case 'GROUP_DISSOLVED':
      return HttpStatus.FORBIDDEN;
    case 'DUPLICATE_MEMBER':
      return HttpStatus.CONFLICT;
    case 'GROUP_FULL':
      return HttpStatus.CONFLICT;
    case 'INVALID_INPUT':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

@Controller('chat/groups')
export class ChatGroupController {
  constructor(
    private readonly group: ChatGroupService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  @Get()
  async listGroups(
    @Req() req: Request,
  ): Promise<{ ok: true; data: GroupChatListResponse }> {
    const userId = await this.requireUserId(req);
    const groups = await this.group.listGroups(userId);
    // Phase 44.2 — Onboarding auto-track CHAT_OPEN. Best-effort.
    if (this.onboarding) {
      try {
        const c = await this.prisma.character.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (c) void this.onboarding.notifyAction(c.id, 'CHAT_OPEN');
      } catch { /* fail-soft */ }
    }
    return { ok: true, data: { groups } };
  }

  @Post()
  @HttpCode(200)
  @RateLimitPolicy('CHAT_GROUP_CREATE')
  async createGroup(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { group: GroupChatRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = CreateGroupInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const g = await this.group.createGroupChat(userId, parsed.data.name);
      return { ok: true, data: { group: g } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':groupId/members')
  @HttpCode(200)
  @RateLimitPolicy('CHAT_GROUP_MEMBER_ADD')
  async addMember(
    @Req() req: Request,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { member: GroupChatMemberRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = AddMemberInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const member = await this.group.addGroupMember(
        userId,
        groupId,
        parsed.data.userId,
      );
      return { ok: true, data: { member } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete(':groupId/members/:targetUserId')
  @HttpCode(200)
  async removeMember(
    @Req() req: Request,
    @Param('groupId') groupId: string,
    @Param('targetUserId') targetUserId: string,
  ): Promise<{ ok: true; data: { removed: boolean } }> {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.group.removeGroupMember(
        userId,
        groupId,
        targetUserId,
      );
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':groupId/messages')
  async listMessages(
    @Req() req: Request,
    @Param('groupId') groupId: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ ok: true; data: GroupChatMessagesResponse }> {
    const userId = await this.requireUserId(req);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    try {
      const [messages, members] = await Promise.all([
        this.group.listGroupMessages(userId, groupId, limit),
        this.group.listGroupMembers(userId, groupId),
      ]);
      return { ok: true, data: { groupId, messages, members } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':groupId/messages')
  @HttpCode(200)
  @RateLimitPolicy('CHAT_GROUP_SEND')
  async sendMessage(
    @Req() req: Request,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { message: GroupChatMessageRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = SendInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const message = await this.group.sendGroupMessage(
        userId,
        groupId,
        parsed.data.body,
      );
      return { ok: true, data: { message } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof ChatGroupError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
