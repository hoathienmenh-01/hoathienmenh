/**
 * Phase 35.0 — Pet / Linh Thú player controller.
 *
 * Endpoints:
 *   - GET    /pets/catalog                            → list pet catalog.
 *   - GET    /pets/catalog/:petKey                    → detail catalog entry.
 *   - GET    /pets/skills                             → list shared skills.
 *   - GET    /pets/caps                               → public caps.
 *   - GET    /pets/collection                         → list owned pets.
 *   - GET    /pets/shards                             → list shard balances.
 *   - GET    /pets/:characterPetId                    → detail owned pet.
 *   - POST   /pets/:characterPetId/equip              → equip.
 *   - POST   /pets/:characterPetId/unequip            → unequip.
 *   - POST   /pets/:characterPetId/lock               → lock.
 *   - POST   /pets/:characterPetId/unlock             → unlock.
 *   - POST   /pets/:characterPetId/rename             → rename.
 *   - GET    /pets/snapshot/:context                  → equipped snapshot.
 *
 *   Box (35.0B):
 *   - GET    /pets/boxes                              → list boxes.
 *   - GET    /pets/boxes/:boxKey                      → detail box (rates + pity).
 *   - GET    /pets/boxes/:boxKey/pity                 → my pity counters.
 *   - POST   /pets/boxes/:boxKey/open                 → open 1 box (idempotent).
 *   - GET    /pets/boxes/logs                         → my open logs.
 *
 *   Upgrade (35.0C):
 *   - POST   /pets/:characterPetId/feed               → feed exp item.
 *   - POST   /pets/:characterPetId/star-up            → star up (consume shard).
 *   - POST   /pets/:characterPetId/breakthrough       → breakthrough level.
 *   - POST   /pets/:characterPetId/evolve             → evolve stage.
 *   - POST   /pets/:characterPetId/skills/:skillKey/upgrade → upgrade skill.
 *
 *   Sources (35.0D):
 *   - GET    /pets/sources/:petKey                    → sources for pet.
 *   - GET    /pets/materials/sources/:itemKey         → sources for material.
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
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { isPetCombatContext, type PetCombatContext } from '@xuantoi/shared';

import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { PetCatalogService } from './pet-catalog.service';
import { PetCollectionService, PetCollectionError } from './pet-collection.service';
import { PetSnapshotService } from './pet-snapshot.service';
import { PetShardService, PetShardError } from './pet-shard.service';
import { PetBoxService, PetBoxError } from './pet-box.service';
import { PetUpgradeService, PetUpgradeError } from './pet-upgrade.service';
import { PetSourceService } from './pet-source.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function handlePetError(e: unknown): never {
  if (
    e instanceof PetCollectionError ||
    e instanceof PetShardError ||
    e instanceof PetBoxError ||
    e instanceof PetUpgradeError
  ) {
    fail(e.code);
  }
  throw e;
}

const EquipZ = z.object({ slot: z.number().int().min(0).max(3).optional() }).strict();
const RenameZ = z.object({ name: z.string().min(1).max(64) }).strict();
const OpenBoxZ = z.object({ requestId: z.string().min(1).max(80).optional() }).strict();
const FeedZ = z
  .object({ itemKey: z.string().min(1).max(80), qty: z.number().int().min(1).max(9999) })
  .strict();

@Controller('pets')
export class PetPlayerController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly catalog: PetCatalogService,
    private readonly collection: PetCollectionService,
    private readonly snapshot: PetSnapshotService,
    private readonly shards: PetShardService,
    private readonly boxes: PetBoxService,
    private readonly upgrade: PetUpgradeService,
    private readonly sources: PetSourceService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireCharacter(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId: userId as string },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return c!.id;
  }

  // ─── Catalog (public, không cần auth) ─────────────────────────────────
  @Get('catalog')
  catalogList(
    @Query('type') type?: string,
    @Query('element') element?: string,
    @Query('rarity') rarity?: string,
    @Query('role') role?: string,
    @Query('eventOnly') eventOnly?: string,
  ) {
    const data = this.catalog.list({
      type: type === 'PET' || type === 'LINH_THU' ? type : undefined,
      element,
      rarity,
      role,
      eventOnly:
        eventOnly === 'true' ? true : eventOnly === 'false' ? false : undefined,
    });
    return { ok: true, data };
  }

  @Get('catalog/:petKey')
  catalogGet(@Param('petKey') petKey: string) {
    const pet = this.catalog.get(petKey);
    if (!pet) fail('PET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: pet };
  }

  @Get('skills')
  skillsList() {
    return { ok: true, data: this.catalog.listSkills() };
  }

  @Get('caps')
  caps() {
    return { ok: true, data: this.catalog.caps() };
  }

  // ─── Collection ──────────────────────────────────────────────────────
  @Get('collection')
  async collectionList(@Req() req: Request) {
    const characterId = await this.requireCharacter(req);
    return { ok: true, data: await this.collection.list(characterId) };
  }

  @Get('shards')
  async shardList(@Req() req: Request) {
    const characterId = await this.requireCharacter(req);
    return { ok: true, data: await this.shards.listAll(characterId) };
  }

  @Get('snapshot/:context')
  async snapshotGet(
    @Req() req: Request,
    @Param('context') context: string,
  ) {
    const characterId = await this.requireCharacter(req);
    if (!isPetCombatContext(context)) fail('PET_INVALID_CONTEXT');
    return {
      ok: true,
      data: await this.snapshot.getEquippedPetSnapshot(
        characterId,
        context as PetCombatContext,
      ),
    };
  }

  // ─── Box endpoints (public catalog, auth open) ────────────────────────
  @Get('boxes')
  boxList() {
    return { ok: true, data: this.boxes.catalog() };
  }

  @Get('boxes/logs')
  async boxLogs(
    @Req() req: Request,
    @Query('boxKey') boxKey?: string,
    @Query('limit') limit?: string,
  ) {
    const characterId = await this.requireCharacter(req);
    return {
      ok: true,
      data: await this.boxes.logs(
        characterId,
        boxKey,
        limit ? parseInt(limit, 10) : 50,
      ),
    };
  }

  @Get('boxes/:boxKey')
  boxGet(@Param('boxKey') boxKey: string) {
    const box = this.boxes.get(boxKey);
    if (!box) fail('PET_BOX_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: box };
  }

  @Get('boxes/:boxKey/pity')
  async boxPity(@Req() req: Request, @Param('boxKey') boxKey: string) {
    const characterId = await this.requireCharacter(req);
    const box = this.boxes.get(boxKey);
    if (!box) fail('PET_BOX_NOT_FOUND', HttpStatus.NOT_FOUND);
    return {
      ok: true,
      data: await this.boxes.readCounters(
        characterId,
        box!.boxKey,
        box!.poolKey,
      ),
    };
  }

  @Post('boxes/:boxKey/open')
  @HttpCode(200)
  async boxOpen(
    @Req() req: Request,
    @Param('boxKey') boxKey: string,
    @Body() body: unknown,
  ) {
    // Phase 45.0 — PET_BOX_ENABLED kill switch. Admin tắt khi audit pity /
    // gacha pool bất thường → 503 FEATURE_DISABLED cho đến khi resolved.
    await this.featureFlags.requireEnabled('PET_BOX_ENABLED');
    const characterId = await this.requireCharacter(req);
    const parsed = OpenBoxZ.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.boxes.open({
          characterId,
          boxKey,
          requestId: parsed.data.requestId,
        }),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  // ─── Sources ─────────────────────────────────────────────────────────
  @Get('sources/:petKey')
  sourcesFor(@Param('petKey') petKey: string) {
    return { ok: true, data: this.sources.forPet(petKey) };
  }

  @Get('materials/sources/:itemKey')
  materialSources(@Param('itemKey') itemKey: string) {
    return { ok: true, data: this.sources.forMaterial(itemKey) };
  }

  // ─── Pet detail + mutations (must come AFTER any specific routes) ─────
  @Get(':characterPetId')
  async detail(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return { ok: true, data: await this.collection.get(characterId, characterPetId) };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/equip')
  @HttpCode(200)
  async equip(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const characterId = await this.requireCharacter(req);
    const parsed = EquipZ.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.collection.equip(
          characterId,
          characterPetId,
          parsed.data.slot,
        ),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/unequip')
  @HttpCode(200)
  async unequip(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return {
        ok: true,
        data: await this.collection.unequip(characterId, characterPetId),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/lock')
  @HttpCode(200)
  async lock(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return { ok: true, data: await this.collection.lock(characterId, characterPetId) };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/unlock')
  @HttpCode(200)
  async unlock(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return { ok: true, data: await this.collection.unlock(characterId, characterPetId) };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/rename')
  @HttpCode(200)
  async rename(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const characterId = await this.requireCharacter(req);
    const parsed = RenameZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.collection.rename(
          characterId,
          characterPetId,
          parsed.data.name,
        ),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/feed')
  @HttpCode(200)
  async feed(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
    @Body() body: unknown,
  ) {
    const characterId = await this.requireCharacter(req);
    const parsed = FeedZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.upgrade.feed(
          characterId,
          characterPetId,
          parsed.data.itemKey,
          parsed.data.qty,
        ),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/star-up')
  @HttpCode(200)
  async starUp(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return {
        ok: true,
        data: await this.upgrade.starUp(characterId, characterPetId),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/breakthrough')
  @HttpCode(200)
  async breakthrough(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return {
        ok: true,
        data: await this.upgrade.breakthrough(characterId, characterPetId),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/evolve')
  @HttpCode(200)
  async evolve(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return {
        ok: true,
        data: await this.upgrade.evolve(characterId, characterPetId),
      };
    } catch (e) {
      handlePetError(e);
    }
  }

  @Post(':characterPetId/skills/:skillKey/upgrade')
  @HttpCode(200)
  async upgradeSkill(
    @Req() req: Request,
    @Param('characterPetId') characterPetId: string,
    @Param('skillKey') skillKey: string,
  ) {
    const characterId = await this.requireCharacter(req);
    try {
      return {
        ok: true,
        data: await this.upgrade.upgradeSkill(
          characterId,
          characterPetId,
          skillKey,
        ),
      };
    } catch (e) {
      handlePetError(e);
    }
  }
}
