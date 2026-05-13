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
import {
  BOSSES_V2,
  DUNGEONS_V2,
  OPPORTUNITIES,
  SECT_BOSSES,
  SECT_DUNGEONS,
  getWorldContentSummary,
  realmByKey,
  type WorldContentSummary,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import { FarmError, FarmService } from './farm.service';
import {
  TrialTowerError,
  TrialTowerService,
} from './trial-tower.service';

const ACCESS_COOKIE = 'xt_access';

const FarmMapKeyParam = z.string().min(1).max(80);
const SessionIdParam = z.string().min(1).max(80);
const TowerKeyParam = z.string().min(1).max(80);

const TrialAttemptBody = z.object({
  floor: z.number().int().min(1).max(100000),
  clearTimeSeconds: z.number().int().min(0).max(86400).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 26.5 — World Content V2 HTTP surface.
 *
 * Endpoints:
 *  - GET  /world/summary                                → catalog overview
 *  - GET  /world/farm-maps                              → list farm maps
 *  - POST /world/farm/:farmMapKey/start                 → start session
 *  - POST /world/farm/sessions/:sessionId/claim         → claim reward
 *  - GET  /world/dungeons                               → list dungeon V2 catalog
 *  - GET  /world/bosses                                 → list boss V2 catalog
 *  - GET  /world/sect-dungeons                          → list sect dungeons
 *  - GET  /world/sect-bosses                            → list sect bosses
 *  - GET  /world/opportunities                          → list opportunities catalog
 *  - GET  /world/towers                                 → list towers + progress
 *  - POST /world/towers/:towerKey/attempt               → attempt 1 floor
 *
 * Auth: cookie `xt_access` cho stateful endpoints. Catalog reads (`GET
 * /world/dungeons`, `/world/bosses`, `/world/sect-*`, `/world/opportunities`,
 * `/world/summary`) public-safe (chỉ catalog static).
 */
@Controller('world')
export class WorldContentController {
  constructor(
    private readonly auth: AuthService,
    private readonly character: CharacterService,
    private readonly farm: FarmService,
    private readonly trial: TrialTowerService,
  ) {}

  // ─── Catalog read endpoints ────────────────────────────────────────────

  @Get('summary')
  summary(): { ok: true; data: WorldContentSummary } {
    return { ok: true, data: getWorldContentSummary() };
  }

  @Get('dungeons')
  dungeons() {
    return {
      ok: true as const,
      data: DUNGEONS_V2.filter((d) => d.enabled).map((d) => ({
        key: d.key,
        category: d.category,
        regionKey: d.regionKey,
        sourceTier: d.sourceTier,
        dungeonTier: d.dungeonTier,
        unlockRealmOrder: d.unlockRealmOrder,
        dailyAttempts: d.dailyAttempts,
        nameVi: d.nameVi,
        nameEn: d.nameEn,
        descriptionVi: d.descriptionVi,
        descriptionEn: d.descriptionEn,
      })),
    };
  }

  @Get('bosses')
  bosses() {
    return {
      ok: true as const,
      data: BOSSES_V2.filter((b) => b.enabled).map((b) => ({
        key: b.key,
        category: b.category,
        family: b.family,
        element: b.element,
        regionKey: b.regionKey ?? null,
        sourceTier: b.sourceTier,
        bossTier: b.bossTier,
        recommendedRealmOrder: b.recommendedRealmOrder,
        dailyRewardCap: b.dailyRewardCap,
        weeklyRewardCap: b.weeklyRewardCap ?? null,
        manualOnly: b.manualOnly,
        nameVi: b.nameVi,
        nameEn: b.nameEn,
      })),
    };
  }

  @Get('sect-dungeons')
  sectDungeons() {
    return {
      ok: true as const,
      data: SECT_DUNGEONS.filter((d) => d.enabled).map((d) => ({
        key: d.key,
        category: d.category,
        requiredSectLevel: d.requiredSectLevel,
        sourceTier: d.sourceTier,
        dailyAttemptsPerMember: d.dailyAttemptsPerMember,
        weeklyAttemptsPerSect: d.weeklyAttemptsPerSect ?? null,
        contributionCost: d.contributionCost,
        nameVi: d.nameVi,
        nameEn: d.nameEn,
      })),
    };
  }

  @Get('sect-bosses')
  sectBosses() {
    return {
      ok: true as const,
      data: SECT_BOSSES.filter((b) => b.enabled).map((b) => ({
        key: b.key,
        category: b.category,
        family: b.family,
        requiredSectLevel: b.requiredSectLevel,
        sourceTier: b.sourceTier,
        bossTier: b.bossTier,
        nameVi: b.nameVi,
        nameEn: b.nameEn,
      })),
    };
  }

  @Get('opportunities')
  opportunities() {
    return {
      ok: true as const,
      data: OPPORTUNITIES.filter((o) => o.enabled).map((o) => ({
        key: o.key,
        regionKey: o.regionKey,
        rarity: o.rarity,
        sourceTier: o.sourceTier,
        maxDailyTriggers: o.maxDailyTriggers,
        maxWeeklyTriggers: o.maxWeeklyTriggers ?? null,
        nameVi: o.nameVi,
        nameEn: o.nameEn,
      })),
    };
  }

  // ─── Farm endpoints ────────────────────────────────────────────────────

  @Get('farm-maps')
  async farmMaps(@Req() req: Request) {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const realmOrder = realmByKey(character.realmKey)?.order ?? 1;
    const view = await this.farm.listForCharacter({
      characterId: character.id,
      playerRealmOrder: realmOrder,
    });
    return { ok: true as const, data: view };
  }

  @Post('farm/:farmMapKey/start')
  @HttpCode(200)
  async farmStart(
    @Req() req: Request,
    @Param('farmMapKey') farmMapKey: string,
    @Body() _body: unknown,
  ) {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = FarmMapKeyParam.safeParse(farmMapKey);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const session = await this.farm.startSession({
        characterId: character.id,
        farmMapKey: parsed.data,
        playerRealmOrder: realmByKey(character.realmKey)?.order ?? 1,
      });
      return { ok: true as const, data: { session } };
    } catch (e) {
      this.handleFarmErr(e);
    }
  }

  @Post('farm/sessions/:sessionId/claim')
  @HttpCode(200)
  async farmClaim(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Body() _body: unknown,
  ) {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = SessionIdParam.safeParse(sessionId);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.farm.claimSession({
        characterId: character.id,
        sessionId: parsed.data,
      });
      return { ok: true as const, data: result };
    } catch (e) {
      this.handleFarmErr(e);
    }
  }

  // ─── Trial tower endpoints ─────────────────────────────────────────────

  @Get('towers')
  async towers(@Req() req: Request) {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const view = await this.trial.listForCharacter({
      characterId: character.id,
      playerRealmOrder: realmByKey(character.realmKey)?.order ?? 1,
    });
    return { ok: true as const, data: view };
  }

  @Post('towers/:towerKey/attempt')
  @HttpCode(200)
  async towerAttempt(
    @Req() req: Request,
    @Param('towerKey') towerKey: string,
    @Body() body: unknown,
  ) {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const towerParsed = TowerKeyParam.safeParse(towerKey);
    const bodyParsed = TrialAttemptBody.safeParse(body);
    if (!towerParsed.success || !bodyParsed.success) fail('INVALID_INPUT');
    const character = await this.character.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.trial.attemptFloor({
        characterId: character.id,
        towerKey: towerParsed.data,
        floor: bodyParsed.data.floor,
        battlePowerSnapshot: character.power ?? 10,
        clearTimeSeconds: bodyParsed.data.clearTimeSeconds,
      });
      return { ok: true as const, data: result };
    } catch (e) {
      this.handleTrialErr(e);
    }
  }

  private handleFarmErr(e: unknown): never {
    if (e instanceof FarmError) {
      switch (e.code) {
        case 'MAP_NOT_FOUND':
        case 'SESSION_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SESSION_NOT_OWNED':
        case 'MAP_LOCKED':
        case 'REALM_TOO_LOW':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'SESSION_NOT_ACTIVE':
        case 'SESSION_ALREADY_ACTIVE':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }

  private handleTrialErr(e: unknown): never {
    if (e instanceof TrialTowerError) {
      switch (e.code) {
        case 'TOWER_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_FLOOR':
        case 'FLOOR_NOT_GENERATED':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
