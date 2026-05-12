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
import { COSMETIC_TYPES } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { CosmeticError, CosmeticsService } from './cosmetics.service';

const ACCESS_COOKIE = 'xt_access';

const EquipInput = z.object({
  cosmeticId: z.string().min(1).max(100),
});

const UnequipInput = z.object({
  type: z.enum([
    'AURA',
    'TITLE',
    'AVATAR_FRAME',
    'CHAT_BADGE',
    'PROFILE_DECORATION',
    'ELEMENT_AURA',
  ]),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('cosmetics')
export class CosmeticsController {
  constructor(
    private readonly service: CosmeticsService,
    private readonly auth: AuthService,
  ) {}

  @Get('catalog')
  async catalog() {
    return { ok: true, data: { catalog: this.service.catalog(), types: COSMETIC_TYPES } };
  }

  @Get('profile/:characterId')
  async profile(@Param('characterId') characterId: string) {
    try {
      const loadout = await this.service.loadoutByCharacterId(characterId);
      return { ok: true, data: { loadout } };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      return { ok: true, data: await this.service.me(userId) };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  @Post('equip')
  @HttpCode(200)
  async equip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = EquipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const loadout = await this.service.equip(userId, parsed.data.cosmeticId);
      return { ok: true, data: { loadout } };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  @Post('unequip')
  @HttpCode(200)
  async unequip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = UnequipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const loadout = await this.service.unequip(userId, parsed.data.type);
      return { ok: true, data: { loadout } };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private failCosmetic(e: unknown): never {
    if (e instanceof CosmeticError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'COSMETIC_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : e.code === 'NOT_OWNED' || e.code === 'OWNERSHIP_EXPIRED' || e.code === 'COSMETIC_INACTIVE'
            ? HttpStatus.FORBIDDEN
            : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
