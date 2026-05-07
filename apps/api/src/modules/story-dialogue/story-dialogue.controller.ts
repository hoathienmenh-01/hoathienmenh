import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  StoryDialogueChoiceResult,
  StoryDialogueError,
  StoryDialogueNodeView,
  StoryDialogueService,
} from './story-dialogue.service';

/**
 * Phase 12 Story Dialogue Foundation — HTTP routes:
 *
 *   - `GET  /story/dialogue/:npcKey`        → pick + render current node.
 *   - `POST /story/dialogue/:npcKey/choice` → apply choice effects, return next node.
 *
 * Auth: cookie `xt_access` (mirror `NpcController`). Rate limit chưa wire (giống
 * `/npcs/:npcKey/dialogue` — read-mostly + small effect grant capped).
 */

const ACCESS_COOKIE = 'xt_access';

const NpcKeyParam = z.string().min(1).max(80).regex(/^npc_[a-z0-9_]+$/);
const NodeIdField = z.string().min(1).max(120).regex(/^story_dlg_[a-z0-9_]+$/);
const ChoiceKeyField = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

const ChoiceBody = z.object({
  nodeId: NodeIdField,
  choiceKey: ChoiceKeyField,
});

function fail(code: string, status = HttpStatus.BAD_REQUEST, detail?: string): never {
  throw new HttpException(
    { ok: false, error: { code, message: detail ?? code } },
    status,
  );
}

@Controller('story/dialogue')
export class StoryDialogueController {
  constructor(
    private readonly service: StoryDialogueService,
    private readonly auth: AuthService,
  ) {}

  @Get(':npcKey')
  async getDialogue(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{ ok: true; data: { node: StoryDialogueNodeView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const node = await this.service.getDialogue(userId, parsed.data);
      return { ok: true, data: { node } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':npcKey/choice')
  async applyChoice(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: StoryDialogueChoiceResult }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const npcParsed = NpcKeyParam.safeParse(npcKey);
    if (!npcParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const bodyParsed = ChoiceBody.safeParse(body);
    if (!bodyParsed.success) {
      fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, bodyParsed.error.message);
    }
    try {
      const result = await this.service.applyChoice(
        userId,
        npcParsed.data,
        bodyParsed.data.nodeId,
        bodyParsed.data.choiceKey,
      );
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof StoryDialogueError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NPC_UNKNOWN':
        case 'NODE_UNKNOWN':
        case 'CHOICE_UNKNOWN':
        case 'NO_DIALOGUE':
          fail(e.code, HttpStatus.NOT_FOUND, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'NPC_LOCKED_REALM':
        case 'QUEST_NOT_ACCEPTED':
        case 'QUEST_STEP_LOCKED':
        case 'QUEST_STEP_KIND_MISMATCH':
          fail(e.code, HttpStatus.FORBIDDEN, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_CHOICE':
        case 'NODE_NPC_MISMATCH':
        case 'ALREADY_APPLIED':
          fail(e.code, HttpStatus.CONFLICT, e.detail);
      }
    }
    throw e;
  }
}
