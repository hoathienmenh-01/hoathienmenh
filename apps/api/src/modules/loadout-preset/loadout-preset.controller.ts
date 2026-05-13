/**
 * Phase QOL-2 — Loadout Preset REST endpoints.
 *
 * Auth via `xt_access` cookie (cùng pattern `InventoryController`).
 * Tất cả route đều `/loadouts` prefix.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ARTIFACT_EQUIP_SLOTS,
  EQUIP_SLOTS,
  LOADOUT_PRESET_MODES,
  type ArtifactEquipSlot,
  type EquipSlot,
  type LoadoutApplyResult,
  type LoadoutPresetMode,
  type LoadoutPresetView,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import {
  LoadoutPresetError,
  LoadoutPresetService,
} from './loadout-preset.service';

const ACCESS_COOKIE = 'xt_access';

const EquipSlotEnum = z.enum(EQUIP_SLOTS as readonly [EquipSlot, ...EquipSlot[]]);
const ArtifactEquipSlotEnum = z.enum(
  ARTIFACT_EQUIP_SLOTS as readonly [ArtifactEquipSlot, ...ArtifactEquipSlot[]],
);
const ModeEnum = z.enum(
  LOADOUT_PRESET_MODES as readonly [LoadoutPresetMode, ...LoadoutPresetMode[]],
);

const EquipmentSlotsSchema = z.record(EquipSlotEnum, z.string().min(1)).optional().nullable();
const ArtifactSlotsSchema = z
  .record(ArtifactEquipSlotEnum, z.string().min(1))
  .optional()
  .nullable();
const SkillSlotsSchema = z.array(z.string().min(1)).optional().nullable();

const CreateInput = z.object({
  name: z.string().min(1).max(40),
  mode: ModeEnum,
  equipmentSlots: EquipmentSlotsSchema,
  skillSlots: SkillSlotsSchema,
  artifactSlots: ArtifactSlotsSchema,
});

const UpdateInput = z.object({
  name: z.string().min(1).max(40).optional(),
  mode: ModeEnum.optional(),
  equipmentSlots: EquipmentSlotsSchema,
  skillSlots: SkillSlotsSchema,
  artifactSlots: ArtifactSlotsSchema,
});

const SetDefaultInput = z.object({
  mode: ModeEnum,
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('loadouts')
export class LoadoutPresetController {
  constructor(
    private readonly svc: LoadoutPresetService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireCharacter(
    req: Request,
  ): Promise<{ userId: string; characterId: string }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return { userId, characterId: c.id };
  }

  @Get()
  async list(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { presets: LoadoutPresetView[] } }> {
    const { characterId } = await this.requireCharacter(req);
    const presets = await this.svc.list(characterId);
    return { ok: true, data: { presets } };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { preset: LoadoutPresetView } }> {
    const parsed = CreateInput.safeParse(body);
    if (!parsed.success) fail('LOADOUT_PRESET_PAYLOAD_INVALID');
    const { characterId } = await this.requireCharacter(req);
    try {
      const preset = await this.svc.create(characterId, {
        name: parsed.data.name,
        mode: parsed.data.mode,
        equipmentSlots: parsed.data.equipmentSlots ?? null,
        skillSlots: parsed.data.skillSlots ?? null,
        artifactSlots: parsed.data.artifactSlots ?? null,
      });
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { preset: LoadoutPresetView } }> {
    const parsed = UpdateInput.safeParse(body);
    if (!parsed.success) fail('LOADOUT_PRESET_PAYLOAD_INVALID');
    const { characterId } = await this.requireCharacter(req);
    try {
      const preset = await this.svc.update(characterId, id, {
        name: parsed.data.name,
        mode: parsed.data.mode,
        equipmentSlots:
          parsed.data.equipmentSlots === undefined
            ? undefined
            : (parsed.data.equipmentSlots ?? null),
        skillSlots:
          parsed.data.skillSlots === undefined
            ? undefined
            : (parsed.data.skillSlots ?? null),
        artifactSlots:
          parsed.data.artifactSlots === undefined
            ? undefined
            : (parsed.data.artifactSlots ?? null),
      });
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { deleted: true } }> {
    const { characterId } = await this.requireCharacter(req);
    try {
      await this.svc.delete(characterId, id);
      return { ok: true, data: { deleted: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/apply')
  @HttpCode(200)
  async apply(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: LoadoutApplyResult }> {
    const { characterId } = await this.requireCharacter(req);
    try {
      const result = await this.svc.apply(characterId, id);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/set-default')
  @HttpCode(200)
  async setDefault(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { preset: LoadoutPresetView } }> {
    const parsed = SetDefaultInput.safeParse(body);
    if (!parsed.success) fail('LOADOUT_PRESET_PAYLOAD_INVALID');
    const { characterId } = await this.requireCharacter(req);
    try {
      const preset = await this.svc.setDefault(characterId, id, parsed.data.mode);
      return { ok: true, data: { preset } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof LoadoutPresetError) {
      const status = mapErrorStatus(e.code);
      fail(e.code, status);
    }
    if (e instanceof HttpException) throw e;
    throw e;
  }
}

function mapErrorStatus(code: string): number {
  switch (code) {
    case 'LOADOUT_PRESET_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'LOADOUT_PRESET_NAME_TAKEN':
      return HttpStatus.CONFLICT;
    case 'LOADOUT_PRESET_LIMIT_REACHED':
      return HttpStatus.CONFLICT;
    case 'LOADOUT_PRESET_NAME_INVALID':
    case 'LOADOUT_PRESET_MODE_INVALID':
    case 'LOADOUT_PRESET_PAYLOAD_INVALID':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}
