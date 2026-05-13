import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  LOADOUT_PRESET_NAME_MAX,
  LOADOUT_PRESET_TYPES,
  LoadoutPresetError,
  LoadoutPresetService,
} from './loadout-preset.service';

const ACCESS_COOKIE = 'xt_access';

const PresetTypeSchema = z.enum(LOADOUT_PRESET_TYPES);
const NameSchema = z.string().min(1).max(LOADOUT_PRESET_NAME_MAX);
const EquipmentEntrySchema = z.object({
  slot: z.enum([
    'WEAPON',
    'ARMOR',
    'BELT',
    'BOOTS',
    'HAT',
    'TRAM',
    'ARTIFACT_1',
    'ARTIFACT_2',
    'ARTIFACT_3',
  ]),
  inventoryItemId: z.string().min(1),
});
const CreateInput = z.object({
  presetType: PresetTypeSchema,
  name: NameSchema,
  equipment: z.array(EquipmentEntrySchema).max(9).optional(),
});
const UpdateInput = z.object({
  name: NameSchema.optional(),
  equipment: z.array(EquipmentEntrySchema).max(9).optional(),
});
const SaveCurrentInput = z.object({
  presetType: PresetTypeSchema,
  name: NameSchema,
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('loadouts/v1')
export class LoadoutPresetController {
  constructor(
    private readonly svc: LoadoutPresetService,
    private readonly auth: AuthService,
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
      const presets = await this.svc.list(userId);
      return { ok: true, data: { presets } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':presetId')
  async detail(@Req() req: Request, @Param('presetId') presetId: string) {
    const userId = await this.requireUserId(req);
    if (!presetId) fail('INVALID_INPUT');
    try {
      const preset = await this.svc.findOne(userId, presetId);
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post()
  @HttpCode(200)
  async create(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = CreateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const preset = await this.svc.create(userId, parsed.data);
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Put(':presetId')
  @HttpCode(200)
  async update(
    @Req() req: Request,
    @Param('presetId') presetId: string,
    @Body() body: unknown,
  ) {
    const userId = await this.requireUserId(req);
    if (!presetId) fail('INVALID_INPUT');
    const parsed = UpdateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const preset = await this.svc.update(userId, presetId, parsed.data);
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete(':presetId')
  @HttpCode(200)
  async remove(@Req() req: Request, @Param('presetId') presetId: string) {
    const userId = await this.requireUserId(req);
    if (!presetId) fail('INVALID_INPUT');
    try {
      await this.svc.delete(userId, presetId);
      return { ok: true, data: {} };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('save-current')
  @HttpCode(200)
  async saveCurrent(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = SaveCurrentInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const preset = await this.svc.saveCurrent(userId, parsed.data);
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':presetId/validate')
  @HttpCode(200)
  async validate(@Req() req: Request, @Param('presetId') presetId: string) {
    const userId = await this.requireUserId(req);
    if (!presetId) fail('INVALID_INPUT');
    try {
      const result = await this.svc.validate(userId, presetId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':presetId/apply')
  @HttpCode(200)
  async apply(@Req() req: Request, @Param('presetId') presetId: string) {
    const userId = await this.requireUserId(req);
    if (!presetId) fail('INVALID_INPUT');
    try {
      const report = await this.svc.apply(userId, presetId);
      return { ok: true, data: report };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof LoadoutPresetError) {
      const code = e.code;
      switch (code) {
        case 'NO_CHARACTER':
        case 'LOADOUT_PRESET_NOT_FOUND':
          fail(code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'LOADOUT_PRESET_LIMIT_REACHED':
        case 'LOADOUT_PRESET_TYPE_EXISTS':
          fail(code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'LOADOUT_PRESET_NAME_EMPTY':
        case 'LOADOUT_PRESET_NAME_TOO_LONG':
        case 'LOADOUT_PRESET_TYPE_INVALID':
        case 'LOADOUT_PRESET_SLOT_INVALID':
        case 'LOADOUT_PRESET_SLOT_DUPLICATE':
        case 'LOADOUT_PRESET_ITEM_INVALID':
          fail(code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        default:
          if (code.startsWith('LOADOUT_PRESET_APPLY_FAILED:')) {
            fail(code, HttpStatus.CONFLICT);
          }
          fail(code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
