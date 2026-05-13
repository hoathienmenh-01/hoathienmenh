/**
 * Phase 35.0 — Pet / Linh Thú admin controller.
 *
 * Require permission `ADMIN_MANAGE_PETS`. Mọi mutate đi qua
 * `AdminAuditWriter.write` với riskLevel default trong shared catalog.
 *
 * Endpoints:
 *   - GET    /admin/pets/catalog                  → catalog audit issues.
 *   - GET    /admin/pets/boxes                    → list boxes + rate audit.
 *   - GET    /admin/pets/sources/audit            → audit pet sources.
 *   - GET    /admin/pets/character/:characterId   → list character pets.
 *   - GET    /admin/pets/character/:characterId/shards → shard balances.
 *   - GET    /admin/pets/character/:characterId/box-logs → box open logs.
 *   - POST   /admin/pets/grant                    → grant pet to character.
 *   - POST   /admin/pets/shard/grant              → grant shard.
 *   - POST   /admin/pets/shard/revoke             → revoke shard.
 *   - POST   /admin/pets/:characterPetId/adjust   → adjust level/star/stage.
 *   - POST   /admin/pets/:characterPetId/revoke   → revoke pet.
 *   - POST   /admin/pets/:characterPetId/pity-reset → pity reset for box.
 *   - POST   /admin/pets/:characterPetId/lock     → force lock.
 *   - POST   /admin/pets/:characterPetId/unlock   → force unlock.
 */
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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { type AdminRoleKey } from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { PetCatalogService } from './pet-catalog.service';
import { PetBoxService } from './pet-box.service';
import { PetSourceService } from './pet-source.service';
import { PetCollectionService, PetCollectionError } from './pet-collection.service';
import { PetShardService, PetShardError } from './pet-shard.service';
import { PetUpgradeError } from './pet-upgrade.service';

interface AdminReq extends Request {
  userId: string;
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function handle(e: unknown): never {
  if (
    e instanceof PetCollectionError ||
    e instanceof PetShardError ||
    e instanceof PetUpgradeError
  ) {
    fail(e.code);
  }
  throw e;
}

const GrantPetZ = z
  .object({
    characterId: z.string().min(1),
    petKey: z.string().min(1).max(80),
    reason: z.string().min(3).max(500),
  })
  .strict();
const ShardGrantZ = z
  .object({
    characterId: z.string().min(1),
    petKey: z.string().min(1).max(80),
    amount: z.number().int().min(1).max(99999),
    reason: z.string().min(3).max(500),
  })
  .strict();
const AdjustZ = z
  .object({
    level: z.number().int().min(1).max(200).optional(),
    star: z.number().int().min(1).max(10).optional(),
    evolutionStage: z.number().int().min(0).max(5).optional(),
    skillKey: z.string().min(1).max(80).optional(),
    skillLevel: z.number().int().min(0).max(20).optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();
const RevokeZ = z
  .object({ reason: z.string().min(3).max(500) })
  .strict();
const PityResetZ = z
  .object({
    boxKey: z.string().min(1).max(80),
    reason: z.string().min(3).max(500),
  })
  .strict();
const LogQueryZ = z
  .object({
    boxKey: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

@Controller('admin/pets')
@UseGuards(AdminPermissionGuard)
export class PetAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PetCatalogService,
    private readonly boxes: PetBoxService,
    private readonly sources: PetSourceService,
    private readonly collection: PetCollectionService,
    private readonly shards: PetShardService,
    private readonly audit: AdminAuditWriter,
  ) {}

  @Get('catalog')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  catalogAudit() {
    return {
      ok: true,
      data: {
        count: this.catalog.list().length,
        issues: this.catalog.audit(),
        caps: this.catalog.caps(),
      },
    };
  }

  @Get('boxes')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  async boxAudit(@Req() req: AdminReq) {
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_BOX_RATE_VIEW',
      targetType: 'PetBoxCatalog',
      targetId: 'all',
      reason: 'admin review pet box rates',
    });
    return {
      ok: true,
      data: {
        boxes: this.boxes.catalog(),
      },
    };
  }

  @Get('sources/audit')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  sourcesAudit() {
    return { ok: true, data: { issues: this.sources.audit() } };
  }

  @Get('character/:characterId')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  async listCharacterPets(@Param('characterId') characterId: string) {
    return { ok: true, data: await this.collection.list(characterId) };
  }

  @Get('character/:characterId/shards')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  async listCharacterShards(@Param('characterId') characterId: string) {
    return { ok: true, data: await this.shards.listAll(characterId) };
  }

  @Get('character/:characterId/box-logs')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  async listBoxLogs(
    @Req() req: AdminReq,
    @Param('characterId') characterId: string,
    @Query('boxKey') boxKey?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = LogQueryZ.safeParse({
      boxKey,
      limit: limit ? Number(limit) : undefined,
    });
    if (!parsed.success) fail('INVALID_INPUT');
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_BOX_LOG_VIEW',
      targetType: 'Character',
      targetId: characterId,
      reason: 'admin view box logs',
    });
    return {
      ok: true,
      data: await this.boxes.logs(characterId, parsed.data.boxKey, parsed.data.limit),
    };
  }

  @Post('grant')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async grantPet(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = GrantPetZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.collection.grantPet({
        characterId: parsed.data.characterId,
        petKey: parsed.data.petKey,
        source: 'ADMIN_GRANT',
      });
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType: 'PET_GRANT',
        targetType: 'Character',
        targetId: parsed.data.characterId,
        reason: parsed.data.reason,
        afterJson: { petKey: parsed.data.petKey, characterPetId: view.id },
      });
      return { ok: true, data: view };
    } catch (e) {
      handle(e);
    }
  }

  @Post('shard/grant')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async grantShard(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = ShardGrantZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const after = await this.prisma.$transaction((tx) =>
        this.shards.grantTx(
          tx,
          parsed.data.characterId,
          parsed.data.petKey,
          parsed.data.amount,
        ),
      );
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType: 'PET_SHARD_ADJUST',
        targetType: 'Character',
        targetId: parsed.data.characterId,
        reason: parsed.data.reason,
        afterJson: { petKey: parsed.data.petKey, amount: parsed.data.amount, after },
      });
      return { ok: true, data: { amount: after } };
    } catch (e) {
      handle(e);
    }
  }

  @Post('shard/revoke')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async revokeShard(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = ShardGrantZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const after = await this.prisma.$transaction((tx) =>
        this.shards.consumeTx(
          tx,
          parsed.data.characterId,
          parsed.data.petKey,
          parsed.data.amount,
        ),
      );
      await this.audit.write({
        adminUserId: req.userId,
        adminRole: req.adminRole,
        actionType: 'PET_SHARD_ADJUST',
        targetType: 'Character',
        targetId: parsed.data.characterId,
        reason: parsed.data.reason,
        afterJson: { petKey: parsed.data.petKey, amount: -parsed.data.amount, after },
      });
      return { ok: true, data: { amount: after } };
    } catch (e) {
      handle(e);
    }
  }

  @Post(':characterPetId/adjust')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async adjust(
    @Req() req: AdminReq,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const parsed = AdjustZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row) fail('PET_INSTANCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const data: Record<string, unknown> = {};
    if (parsed.data.level !== undefined) data.level = parsed.data.level;
    if (parsed.data.star !== undefined) data.star = parsed.data.star;
    if (parsed.data.evolutionStage !== undefined)
      data.evolutionStage = parsed.data.evolutionStage;
    if (parsed.data.skillKey && parsed.data.skillLevel !== undefined) {
      const cur = (row!.skillLevelsJson as Record<string, number>) ?? {};
      data.skillLevelsJson = {
        ...cur,
        [parsed.data.skillKey]: parsed.data.skillLevel,
      };
    }
    await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data,
    });
    const actionType =
      parsed.data.level !== undefined
        ? 'PET_LEVEL_ADJUST'
        : parsed.data.star !== undefined
        ? 'PET_STAR_ADJUST'
        : parsed.data.evolutionStage !== undefined
        ? 'PET_EVOLUTION_ADJUST'
        : 'PET_SKILL_LEVEL_ADJUST';
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType,
      targetType: 'CharacterPet',
      targetId: characterPetId,
      reason: parsed.data.reason,
      beforeJson: {
        level: row!.level,
        star: row!.star,
        evolutionStage: row!.evolutionStage,
      },
      afterJson: data,
    });
    return { ok: true };
  }

  @Post(':characterPetId/revoke')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async revokePet(
    @Req() req: AdminReq,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const parsed = RevokeZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row) fail('PET_INSTANCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (row!.isLocked) fail('PET_LOCKED');
    await this.prisma.characterPet.delete({ where: { id: characterPetId } });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_REVOKE',
      targetType: 'CharacterPet',
      targetId: characterPetId,
      reason: parsed.data.reason,
      beforeJson: { petKey: row!.petKey, characterId: row!.characterId },
    });
    return { ok: true };
  }

  @Post(':characterPetId/lock')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async forceLock(
    @Req() req: AdminReq,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const parsed = RevokeZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row) fail('PET_INSTANCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data: { isLocked: true },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_LOCK_FORCE',
      targetType: 'CharacterPet',
      targetId: characterPetId,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Post(':characterPetId/unlock')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async forceUnlock(
    @Req() req: AdminReq,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const parsed = RevokeZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row) fail('PET_INSTANCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data: { isLocked: false },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_UNLOCK_FORCE',
      targetType: 'CharacterPet',
      targetId: characterPetId,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Post('character/:characterId/pity-reset')
  @RequireAdminPermission('ADMIN_MANAGE_PETS')
  @HttpCode(200)
  async pityReset(
    @Req() req: AdminReq,
    @Param('characterId') characterId: string,
    @Body() body: unknown,
  ) {
    const parsed = PityResetZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const box = this.boxes.get(parsed.data.boxKey);
    if (!box) fail('PET_BOX_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.characterPetBoxPityCounter.updateMany({
      where: { characterId, boxKey: box!.boxKey, poolKey: box!.poolKey },
      data: {
        opensSinceRare: 0,
        opensSinceEpic: 0,
        opensSinceLegendary: 0,
        opensSinceMythic: 0,
        lastResetAt: new Date(),
      },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'PET_PITY_RESET',
      targetType: 'Character',
      targetId: characterId,
      reason: parsed.data.reason,
      afterJson: { boxKey: parsed.data.boxKey },
    });
    return { ok: true };
  }
}
