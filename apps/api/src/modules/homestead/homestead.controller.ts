import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import {
  HomesteadError,
  HomesteadService,
  normalizeHomesteadError,
} from './homestead.service';

const ACCESS_COOKIE = 'xt_access';

const SlotInput = z.object({
  slotIndex: z.number().int().min(0).max(99),
});

const PlantInput = SlotInput.extend({
  cropKey: z.string().min(1).max(80),
});

const GardenStartInput = SlotInput.extend({
  productionKey: z.string().min(1).max(80),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('homestead')
export class HomesteadController {
  constructor(
    private readonly auth: AuthService,
    private readonly character: CharacterService,
    private readonly homestead: HomesteadService,
  ) {}

  @Get()
  async overview(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    return { ok: true as const, data: await this.homestead.getOverview(characterId) };
  }

  @Post('upgrade')
  @HttpCode(200)
  async upgrade(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    try {
      return { ok: true as const, data: await this.homestead.upgrade(characterId) };
    } catch (e) {
      this.handleHomesteadErr(e);
    }
  }

  @Get('fields')
  async fields(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    return { ok: true as const, data: await this.homestead.listFields(characterId) };
  }

  @Post('fields/plant')
  @HttpCode(200)
  async plant(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = PlantInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true as const,
        data: await this.homestead.plantField(characterId, parsed.data),
      };
    } catch (e) {
      this.handleHomesteadErr(e);
    }
  }

  @Post('fields/harvest')
  @HttpCode(200)
  async harvest(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = SlotInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true as const,
        data: await this.homestead.harvestField(characterId, parsed.data),
      };
    } catch (e) {
      this.handleHomesteadErr(e);
    }
  }

  @Get('garden')
  async garden(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    return { ok: true as const, data: await this.homestead.listGarden(characterId) };
  }

  @Post('garden/start')
  @HttpCode(200)
  async startGarden(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = GardenStartInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true as const,
        data: await this.homestead.startGarden(characterId, parsed.data),
      };
    } catch (e) {
      this.handleHomesteadErr(e);
    }
  }

  @Post('garden/claim')
  @HttpCode(200)
  async claimGarden(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = SlotInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true as const,
        data: await this.homestead.claimGarden(characterId, parsed.data),
      };
    } catch (e) {
      this.handleHomesteadErr(e);
    }
  }

  private async requireCharacterId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return character.id;
  }

  private handleHomesteadErr(e: unknown): never {
    const err: HomesteadError = normalizeHomesteadError(e);
    switch (err.code) {
      case 'CHARACTER_NOT_FOUND':
      case 'HOMESTEAD_NOT_FOUND':
      case 'FIELD_NOT_FOUND':
      case 'GARDEN_NOT_FOUND':
      case 'CROP_NOT_FOUND':
      case 'PRODUCTION_NOT_FOUND':
      case 'CONFIG_NOT_FOUND':
        fail(err.code, HttpStatus.NOT_FOUND);
      // eslint-disable-next-line no-fallthrough
      case 'REALM_TOO_LOW':
      case 'HOMESTEAD_LEVEL_TOO_LOW':
      case 'INSUFFICIENT_FUNDS':
      case 'INSUFFICIENT_SPIRITUAL_ENERGY':
      case 'SLOT_LOCKED':
        fail(err.code, HttpStatus.FORBIDDEN);
      // eslint-disable-next-line no-fallthrough
      case 'MAX_LEVEL':
      case 'STATE_CHANGED':
      case 'SLOT_OCCUPIED':
      case 'NOT_READY':
      case 'ALREADY_CLAIMED':
      case 'DAILY_CAP_REACHED':
        fail(err.code, HttpStatus.CONFLICT);
    }
  }
}
