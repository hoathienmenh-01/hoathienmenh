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
import { SectError, SectService } from './sect.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

const CreateInput = z.object({
  name: z.string().min(2).max(16),
  description: z.string().max(200).optional().default(''),
});

const ContributeInput = z.object({
  amount: z
    .union([z.string().regex(/^[0-9]+$/), z.number().int().positive()])
    .transform((v) => BigInt(v)),
});

const TargetInput = z.object({
  targetCharacterId: z.string().min(1),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('sect')
export class SectController {
  constructor(
    private readonly sect: SectService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async getViewer(req: Request): Promise<{
    userId: string | null;
    characterId: string | null;
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) return { userId: null, characterId: null };
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    return { userId, characterId: c?.id ?? null };
  }

  @Get('list')
  async list() {
    const sects = await this.sect.list();
    return { ok: true, data: { sects } };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const { userId, characterId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!characterId) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { sectId: true },
    });
    if (!char?.sectId) {
      return { ok: true, data: { sect: null } };
    }
    const sect = await this.sect.detail(char.sectId, characterId);
    return { ok: true, data: { sect } };
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const { characterId } = await this.getViewer(req);
    try {
      const sect = await this.sect.detail(id, characterId);
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('create')
  @HttpCode(200)
  async create(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = CreateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const sect = await this.sect.create(
        userId,
        parsed.data.name,
        parsed.data.description ?? '',
      );
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/join')
  @HttpCode(200)
  async join(@Req() req: Request, @Param('id') id: string) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const sect = await this.sect.join(userId, id);
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('leave')
  @HttpCode(200)
  async leave(@Req() req: Request) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const r = await this.sect.leave(userId);
      return { ok: true, data: r };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('contribute')
  @HttpCode(200)
  async contribute(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ContributeInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const sect = await this.sect.contribute(userId, parsed.data.amount);
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('promote')
  @HttpCode(200)
  async promote(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = TargetInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const sect = await this.sect.promote(userId, parsed.data.targetCharacterId);
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('demote')
  @HttpCode(200)
  async demote(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = TargetInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const sect = await this.sect.demote(userId, parsed.data.targetCharacterId);
      return { ok: true, data: { sect } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('kick')
  @HttpCode(200)
  async kick(@Req() req: Request, @Body() body: unknown) {
    const { userId } = await this.getViewer(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = TargetInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.sect.kick(userId, parsed.data.targetCharacterId);
      return { ok: true, data: r };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'SECT_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_AMOUNT':
        case 'INVALID_NAME':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_IN_SECT':
        case 'ALREADY_IN_SECT':
        case 'INSUFFICIENT_LINH_THACH':
        case 'NAME_TAKEN':
        case 'ALREADY_LEADER':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_LEADER':
        case 'NOT_ELDER_OR_LEADER':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'CANNOT_KICK_SELF':
        case 'CANNOT_KICK_HIGHER_ROLE':
        case 'TARGET_NOT_IN_SECT':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
