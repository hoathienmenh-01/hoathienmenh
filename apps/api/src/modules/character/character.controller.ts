import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  BREAKTHROUGH_LOG_DEFAULT_LIMIT,
  BREAKTHROUGH_LOG_MAX_LIMIT,
  BreakthroughError,
  CharacterService,
  type BreakthroughAttemptOutcome,
} from './character.service';
import { SpiritualRootError, SpiritualRootService } from './spiritual-root.service';
import {
  CultivationMethodError,
  CultivationMethodService,
} from './cultivation-method.service';
import {
  CharacterSkillError,
  CharacterSkillService,
} from './character-skill.service';
import { GemError, GemService } from './gem.service';
import { RefineError, RefineService } from './refine.service';
import {
  EquipmentError,
  EquipmentService,
} from './equipment.service';
import {
  TRIBULATION_LOG_DEFAULT_LIMIT,
  TRIBULATION_LOG_MAX_LIMIT,
  TribulationError,
  TribulationService,
  toAttemptOutcomeView,
} from './tribulation.service';
import {
  TribulationMiniBattleError,
  TribulationMiniBattleService,
} from './tribulation-mini-battle.service';
import {
  AchievementError,
  AchievementService,
} from './achievement.service';
import { TalentError, TalentService } from './talent.service';
import { AlchemyError, AlchemyService } from './alchemy.service';
import { TitleError, TitleService } from './title.service';
import { BuffService } from './buff.service';
import { getBuffDef, getTitleDef, TITLES } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import {
  InMemorySlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';

const ACCESS_COOKIE = 'xt_access';

/**
 * Anti-scrape rate limit cho `GET /character/profile/:id`.
 *
 * 120 request/IP/15 phút. Đủ lớn cho các flow bình thường (leaderboard 50
 * tên tập đoàn + chat tap-name + boss damage list) nhưng đủ chặt để chặn
 * enumerate cuid để tìm hết player. Cùng pattern với PR #60 (`POST /auth/register`).
 */
export const PROFILE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const PROFILE_RATE_LIMIT_MAX = 120;
export const PROFILE_RATE_LIMITER = 'CHARACTER_PROFILE_RATE_LIMITER';

const OnboardInput = z.object({
  name: z
    .string()
    .min(3)
    .max(16)
    .regex(/^[A-Za-zÀ-ỹ0-9._]+$/),
  sectKey: z.enum(['thanh_van', 'huyen_thuy', 'tu_la']),
});

const CultivateInput = z.object({
  cultivating: z.boolean(),
});

const CultivationMethodEquipInput = z.object({
  methodKey: z.string().min(1).max(64),
});

const SkillKeyInput = z.object({
  skillKey: z.string().min(1).max(64),
});

/** Phase 11.2.D — body cho `POST /character/skill/learn-from-book`. */
const SkillLearnFromBookInput = z.object({
  inventoryItemId: z.string().min(1).max(64),
});

const GemSocketInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
  gemKey: z.string().min(1).max(64),
});

const GemUnsocketInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
  slotIndex: z.number().int().min(0).max(3),
});

const GemCombineInput = z.object({
  srcGemKey: z.string().min(1).max(64),
});

const RefineEquipmentInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
  useProtection: z.boolean().optional().default(false),
});

const EquipmentReforgeInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
});

const EquipmentEnchantInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
  element: z.enum(['kim', 'moc', 'thuy', 'hoa', 'tho']),
});

const EquipmentUpgradePreviewInput = z.object({
  equipmentInventoryItemId: z.string().min(1).max(64),
});

const AchievementClaimInput = z.object({
  achievementKey: z.string().min(1).max(64),
});

const TalentLearnInput = z.object({
  talentKey: z.string().min(1).max(64),
});

const AlchemyCraftInput = z.object({
  recipeKey: z.string().min(1).max(64),
});

const TitleEquipInput = z.object({
  titleKey: z.string().min(1).max(64),
});

/**
 * `POST /character/tribulation` body — không có input field. Server-authoritative
 * resolve transition từ `c.realmKey` → `nextRealm(c.realmKey)`. Tránh client
 * spoof `toRealmKey` (defence-in-depth ngoài DTO Zod).
 */

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('character')
export class CharacterController {
  private readonly profileLimiter: RateLimiter;

  constructor(
    private readonly chars: CharacterService,
    private readonly auth: AuthService,
    @Optional() private readonly spiritualRoot?: SpiritualRootService,
    @Optional() private readonly cultivationMethod?: CultivationMethodService,
    @Optional() private readonly characterSkill?: CharacterSkillService,
    @Optional() private readonly gem?: GemService,
    @Optional() private readonly refine?: RefineService,
    @Optional() private readonly equipment?: EquipmentService,
    @Optional() private readonly tribulation?: TribulationService,
    @Optional() private readonly achievement?: AchievementService,
    @Optional() private readonly talent?: TalentService,
    @Optional() private readonly alchemy?: AlchemyService,
    @Optional() private readonly title?: TitleService,
    @Optional() private readonly buff?: BuffService,
    @Optional()
    private readonly tribulationMiniBattle?: TribulationMiniBattleService,
    @Optional() @Inject(PROFILE_RATE_LIMITER) profileLimiter?: RateLimiter,
    // Phase 15.4 — runtime gate cho equipment reforge/enchant +
    // tribulation mini-battle. Optional vì module test bỏ qua FeatureFlagModule;
    // nếu inject null → controller skip gate (hành vi cũ = always allow).
    @Optional() private readonly featureFlags?: FeatureFlagService,
  ) {
    this.profileLimiter =
      profileLimiter ??
      new InMemorySlidingWindowRateLimiter(
        PROFILE_RATE_LIMIT_WINDOW_MS,
        PROFILE_RATE_LIMIT_MAX,
      );
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    const character = await this.chars.findByUser(userId);
    return { ok: true, data: { character } };
  }

  @Get('profile/:id')
  async profile(@Req() req: Request, @Param('id') id: string) {
    // Yêu cầu phải đăng nhập để xem profile (anti-scrape lớp 1).
    await this.requireUserId(req);
    // Per-IP rate limit (lớp 2): chặn enumerate cuid hàng loạt.
    const ip = req.ip ?? 'unknown';
    const limit = await this.profileLimiter.check(`ip:${ip}`);
    if (!limit.allowed) fail('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    const profile = await this.chars.findPublicProfile(id);
    if (!profile) fail('NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: { profile } };
  }

  @Get('state')
  async state(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return { ok: true, data: { character } };
  }

  @Post('onboard')
  @HttpCode(200)
  async onboard(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = OnboardInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');

    try {
      const character = await this.chars.onboard(userId, parsed.data);
      return { ok: true, data: { character } };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'NAME_TAKEN') fail('NAME_TAKEN', HttpStatus.CONFLICT);
      if (code === 'ALREADY_ONBOARDED') fail('ALREADY_ONBOARDED', HttpStatus.CONFLICT);
      throw e;
    }
  }

  @Post('cultivate')
  @HttpCode(200)
  async cultivate(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = CultivateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const character = await this.chars.setCultivating(userId, parsed.data.cultivating);
      return { ok: true, data: { character } };
    } catch (e) {
      if ((e as { code?: string })?.code === 'NO_CHARACTER') {
        fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  @Post('breakthrough')
  @HttpCode(200)
  async breakthrough(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const character = await this.chars.breakthrough(userId);
      return { ok: true, data: { character } };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'NO_CHARACTER') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
      if (code === 'NOT_AT_PEAK') fail('NOT_AT_PEAK', HttpStatus.CONFLICT);
      // Phase 14.3.A — gate manual breakthrough cho realm transition cần kiếp.
      // FE phải redirect player sang `POST /character/tribulation`.
      if (code === 'TRIBULATION_REQUIRED') {
        fail('TRIBULATION_REQUIRED', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  /**
   * Phase 11 nâng cao §5 PR2 wire — RNG-based breakthrough attempt endpoint.
   *
   * Khác `POST /breakthrough` (deterministic, luôn thành công nếu peak +
   * đủ EXP), endpoint này:
   *   - Compute `BreakthroughChanceBreakdown` (4 layer: base + rootPurity +
   *     methodAffinity + itemBonus).
   *   - Server roll RNG `[0, 1)` → success / fail.
   *   - SUCCESS → realm advance + restats giống `breakthrough()` + INSERT
   *     `BreakthroughAttemptLog{success:true}`.
   *   - FAIL → KHÔNG advance, KHÔNG trừ EXP; apply `tam_ma_light` debuff
   *     (300s, `cultivation_rate_mul ×0.7` áp EXP gain) + INSERT log.
   *
   * Response shape: `{ success, breakdown, rngRoll, attemptIndex, debuff,
   * character }` (BigInt fields cast → string trong `character` qua
   * `toState()`; `debuffExpiresAt` cast → ISO string defensive).
   *
   * Forward-compat: client cũ vẫn có thể gọi `POST /breakthrough` deterministic.
   * UI Phase 11 nâng cao §5 PR3 sẽ migrate sang endpoint này.
   */
  @Post('breakthrough/attempt')
  @HttpCode(200)
  async breakthroughAttempt(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const outcome = await this.chars.attemptBreakthrough(userId);
      return { ok: true, data: { outcome: toBreakthroughAttemptView(outcome) } };
    } catch (e) {
      if (e instanceof BreakthroughError) {
        if (e.code === 'NO_CHARACTER') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
        if (e.code === 'NOT_AT_PEAK') fail('NOT_AT_PEAK', HttpStatus.CONFLICT);
        if (e.code === 'INVALID_RNG') fail('INVALID_RNG', HttpStatus.BAD_REQUEST);
      }
      throw e;
    }
  }

  /**
   * Phase 11 nâng cao §5 PR3 prep — read-only audit log của
   * `BreakthroughAttemptLog` cho FE history view.
   *
   *   - Auth gate (cookie session → userId → character).
   *   - 404 `NO_CHARACTER` nếu user chưa onboard.
   *   - Idempotent GET — không thay đổi state.
   *   - Sort theo `createdAt` DESC (mới nhất đầu).
   *   - Optional `?limit=N` (1..100, default 20). Invalid → fallback default.
   *   - BigInt fields cast → string ở
   *     `CharacterService.listBreakthroughAttemptLogs` để FE serialize an
   *     toàn (ko mất precision).
   *   - Response shape: `{ ok: true, data: { rows, limit } }` mirror
   *     `tribulation/log` pattern.
   */
  @Get('breakthrough/log')
  async breakthroughLog(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = await this.requireUserId(req);
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const parsedLimit = parseBreakthroughLogLimit(limit);
    const rows = await this.chars.listBreakthroughAttemptLogs(
      character.id,
      parsedLimit,
    );
    return { ok: true, data: { rows, limit: parsedLimit } };
  }

  /**
   * Phase 11.3.A — Đọc state Linh căn / Spiritual Root server-authoritative.
   * Nếu character pre-Phase 11.3 (legacy) thì lazy-roll lần đầu (idempotent).
   */
  @Get('spiritual-root')
  async spiritualRootState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.spiritualRoot) {
      fail('SPIRITUAL_ROOT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const state = await this.spiritualRoot.getState(character.id);
    return { ok: true, data: { spiritualRoot: state } };
  }

  /**
   * Phase 11.3.D — Reroll linh căn bằng item `linh_can_dan`. Server-authoritative
   * consume 1 stack qua `ItemLedger` atomic với roll mới + Character update +
   * `SpiritualRootRollLog` row source='reroll'. Returns new state.
   *
   * Errors: `LINH_CAN_DAN_INSUFFICIENT` 409 (thiếu item), `NOT_INITIALIZED`
   * 409 (chưa onboard linh căn — phải GET /spiritual-root trước),
   * `NO_CHARACTER` 404, `SPIRITUAL_ROOT_UNAVAILABLE` 501 (DI thiếu).
   */
  @Post('spiritual-root/reroll')
  @HttpCode(200)
  async spiritualRootReroll(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.spiritualRoot) {
      fail('SPIRITUAL_ROOT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const state = await this.spiritualRoot.reroll(character.id);
      return { ok: true, data: { spiritualRoot: state } };
    } catch (e) {
      if (e instanceof SpiritualRootError) {
        if (e.code === 'CHARACTER_NOT_FOUND') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
        if (e.code === 'NOT_INITIALIZED') fail('NOT_INITIALIZED', HttpStatus.CONFLICT);
        if (e.code === 'LINH_CAN_DAN_INSUFFICIENT') {
          fail('LINH_CAN_DAN_INSUFFICIENT', HttpStatus.CONFLICT);
        }
      }
      throw e;
    }
  }

  /**
   * Phase 11.1.B — Đọc state công pháp (Cultivation Method) đã học + đang
   * equip. Auto-grant + auto-equip starter `khai_thien_quyet` cho legacy
   * character (idempotent qua `getState`).
   */
  @Get('cultivation-method')
  async cultivationMethodState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.cultivationMethod) {
      fail('CULTIVATION_METHOD_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const state = await this.cultivationMethod.getState(character.id);
    return { ok: true, data: { cultivationMethod: state } };
  }

  /**
   * Phase 11.1.B — Equip công pháp đã học. Validate ownership + realm/sect/
   * forbiddenElement + đổi `Character.equippedCultivationMethodKey`.
   */
  @Post('cultivation-method/equip')
  @HttpCode(200)
  async cultivationMethodEquip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.cultivationMethod) {
      fail('CULTIVATION_METHOD_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = CultivationMethodEquipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');

    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);

    try {
      const state = await this.cultivationMethod.equip(
        character.id,
        parsed.data.methodKey,
      );
      return { ok: true, data: { cultivationMethod: state } };
    } catch (e) {
      if (e instanceof CultivationMethodError) {
        const httpStatus =
          e.code === 'METHOD_NOT_FOUND' || e.code === 'CHARACTER_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.CONFLICT;
        fail(e.code, httpStatus);
      }
      throw e;
    }
  }

  /**
   * Phase 11.2.B — Đọc state skill mastery (đã học + isEquipped + effective
   * atkScale/mpCost). Auto-grant `basic_attack` cho legacy character
   * (idempotent qua getState).
   */
  @Get('skill')
  async skillState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.characterSkill) {
      fail('CHARACTER_SKILL_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const state = await this.characterSkill.getState(character.id);
    return { ok: true, data: { skill: state } };
  }

  /**
   * Phase 11.2.B — Equip skill đã học. Cap MAX_EQUIPPED_SKILLS = 4 (basic
   * attack ngoại lệ — luôn usable).
   */
  @Post('skill/equip')
  @HttpCode(200)
  async skillEquip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.characterSkill) {
      fail('CHARACTER_SKILL_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = SkillKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const state = await this.characterSkill.equip(
        character.id,
        parsed.data.skillKey,
      );
      return { ok: true, data: { skill: state } };
    } catch (e) {
      if (e instanceof CharacterSkillError) {
        fail(e.code, mapSkillErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.2.B — Unequip skill đã học.
   */
  @Post('skill/unequip')
  @HttpCode(200)
  async skillUnequip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.characterSkill) {
      fail('CHARACTER_SKILL_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = SkillKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const state = await this.characterSkill.unequip(
        character.id,
        parsed.data.skillKey,
      );
      return { ok: true, data: { skill: state } };
    } catch (e) {
      if (e instanceof CharacterSkillError) {
        fail(e.code, mapSkillErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.2.B — Upgrade mastery +1 level. Trừ LinhThach atomic. Throws
   * INSUFFICIENT_FUNDS, MASTERY_MAX, NOT_LEARNED.
   */
  @Post('skill/upgrade-mastery')
  @HttpCode(200)
  async skillUpgradeMastery(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.characterSkill) {
      fail('CHARACTER_SKILL_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = SkillKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.characterSkill.upgradeMastery(
        character.id,
        parsed.data.skillKey,
      );
      return { ok: true, data: { upgrade: result } };
    } catch (e) {
      if (e instanceof CharacterSkillError) {
        fail(e.code, mapSkillErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.2.D — consume 1× `kind: 'SKILL_BOOK'` item để học skill mới.
   * Server-authoritative: validate ownership + kind + unlocks, ghi
   * `ItemLedger { reason: 'SKILL_LEARN' }` atomic với CharacterSkill.create.
   * Throws INVENTORY_ITEM_NOT_FOUND / NOT_SKILL_BOOK / ALREADY_LEARNED /
   * SKILL_NOT_FOUND / REALM_TOO_LOW / WRONG_SECT / METHOD_NOT_LEARNED.
   */
  @Post('skill/learn-from-book')
  @HttpCode(200)
  async skillLearnFromBook(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.characterSkill) {
      fail('CHARACTER_SKILL_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = SkillLearnFromBookInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.characterSkill.learnFromBook(
        character.id,
        parsed.data.inventoryItemId,
      );
      return { ok: true, data: { learn: result } };
    } catch (e) {
      if (e instanceof CharacterSkillError) {
        fail(e.code, mapSkillErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.4.B Gem MVP — khảm 1 gem vào equipment slot kế tiếp.
   * Server-authoritative: verify capacity (`socketCapacityForQuality`),
   * verify gem `compatibleSlots` ⊇ equipment slot, deduct 1 qty qua
   * `ItemLedger` reason `GEM_SOCKET`, append vào `sockets[]`.
   */
  @Post('gem/socket')
  @HttpCode(200)
  async gemSocket(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.gem) fail('GEM_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const parsed = GemSocketInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.gem.socketGem(
        character.id,
        parsed.data.equipmentInventoryItemId,
        parsed.data.gemKey,
      );
      return { ok: true, data: { socket: result } };
    } catch (e) {
      if (e instanceof GemError) {
        fail(e.code, mapGemErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.4.B Gem MVP — gỡ gem khỏi 1 slot. Gem qty về inventory unequipped row.
   */
  @Post('gem/unsocket')
  @HttpCode(200)
  async gemUnsocket(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.gem) fail('GEM_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const parsed = GemUnsocketInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.gem.unsocketGem(
        character.id,
        parsed.data.equipmentInventoryItemId,
        parsed.data.slotIndex,
      );
      return { ok: true, data: { unsocket: result } };
    } catch (e) {
      if (e instanceof GemError) {
        fail(e.code, mapGemErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.4.B Gem MVP — combine 3× gem cùng key thành 1× gem next-tier.
   * Deterministic: không RNG; THAN tier không combine được.
   */
  @Post('gem/combine')
  @HttpCode(200)
  async gemCombine(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.gem) fail('GEM_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const parsed = GemCombineInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.gem.combineGems(
        character.id,
        parsed.data.srcGemKey,
      );
      return { ok: true, data: { combine: result } };
    } catch (e) {
      if (e instanceof GemError) {
        fail(e.code, mapGemErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.5.B Refine MVP — luyện khí 1 attempt cho equipment.
   * Server-authoritative: verify cost (`linhThachCost` + `materialQty`),
   * roll deterministic RNG, apply outcome (success +1 / fail risky -1 / fail
   * extreme break = delete row), consume protection charm nếu trigger.
   * Tất cả qua `prisma.$transaction` + `ItemLedger`/`CurrencyLedger` audit.
   */
  @Post('refine')
  @HttpCode(200)
  async refineEquipment(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.refine) fail('REFINE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const parsed = RefineEquipmentInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.refine.refineEquipment(
        character.id,
        parsed.data.equipmentInventoryItemId,
        parsed.data.useProtection,
      );
      return { ok: true, data: { refine: result } };
    } catch (e) {
      if (e instanceof RefineError) {
        fail(e.code, mapRefineErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 15.0.A — Equipment Reforge Foundation. Re-roll substats trong
   * `ALLOWED_SUBSTAT_KINDS` (atk/def/hpMax/mpMax/spirit). Cost theo quality
   * (PHAM/LINH/HUYEN/TIEN/THAN). Atomic: consume linhThach + material →
   * update substats → ghi `EquipmentReforgeHistory`. Server-authoritative.
   */
  @Post('equipment/reforge')
  @HttpCode(200)
  async equipmentReforge(@Req() req: Request, @Body() body: unknown) {
    // Phase 15.4 — runtime gate. Tắt khi exploit hoặc cần freeze
    // economy stat-roll burst. 503 + FEATURE_DISABLED.
    if (this.featureFlags) {
      await this.featureFlags.requireEnabled('EQUIPMENT_REFORGE_ENABLED');
    }
    const userId = await this.requireUserId(req);
    if (!this.equipment) {
      fail('EQUIPMENT_UPGRADE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = EquipmentReforgeInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.equipment.reforge(
        character.id,
        parsed.data.equipmentInventoryItemId,
      );
      return { ok: true, data: { reforge: result } };
    } catch (e) {
      if (e instanceof EquipmentError) {
        fail(e.code, mapEquipmentErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 15.0.A — Equipment Enchant Foundation. Apply 1 hệ Ngũ Hành lên
   * trang bị. Lần đầu chọn element; các lần sau cùng element → level + 1.
   * Cap `MAX_ENCHANT_LEVEL=5`. Atomic: consume linhThach + material → update
   * `enchantElement`/`enchantLevel` → ghi `EquipmentEnchantHistory`.
   */
  @Post('equipment/enchant')
  @HttpCode(200)
  async equipmentEnchant(@Req() req: Request, @Body() body: unknown) {
    // Phase 15.4 — runtime gate. Tắt khi exploit ngũ hành hoặc
    // cần freeze power-up bức xạ. 503 + FEATURE_DISABLED.
    if (this.featureFlags) {
      await this.featureFlags.requireEnabled('EQUIPMENT_ENCHANT_ENABLED');
    }
    const userId = await this.requireUserId(req);
    if (!this.equipment) {
      fail('EQUIPMENT_UPGRADE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = EquipmentEnchantInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.equipment.enchant(
        character.id,
        parsed.data.equipmentInventoryItemId,
        parsed.data.element,
      );
      return { ok: true, data: { enchant: result } };
    } catch (e) {
      if (e instanceof EquipmentError) {
        fail(e.code, mapEquipmentErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 15.0.A — read-only preview cho UI. Trả config + cost cho cả
   * reforge + enchant. Không mutate. KHÔNG ghi ledger / history.
   */
  @Post('equipment/upgrade-preview')
  @HttpCode(200)
  async equipmentUpgradePreview(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.equipment) {
      fail('EQUIPMENT_UPGRADE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = EquipmentUpgradePreviewInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const preview = await this.equipment.upgradePreview(
        character.id,
        parsed.data.equipmentInventoryItemId,
      );
      return { ok: true, data: { preview } };
    } catch (e) {
      if (e instanceof EquipmentError) {
        fail(e.code, mapEquipmentErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.6.B Tribulation MVP — manual breakthrough qua kiếp.
   * Server-authoritative deterministic kiếp:
   *   - Verify peak gate (stage 9 + đủ EXP cost) giống `breakthrough`.
   *   - Verify catalog `getTribulationForBreakthrough(c.realmKey, next.key)`
   *     có def. Nếu KHÔNG (low-tier transition) → 409 NO_TRIBULATION_FOR_TRANSITION
   *     để client biết phải dùng `POST /character/breakthrough` thay vì
   *     route này.
   *   - Verify cooldown chưa active.
   *   - Resolve sim qua `simulateTribulation`. Success → realm advance + linhThach
   *     reward qua `CurrencyLedger.TRIBULATION_REWARD`. Fail → EXP loss + cooldown
   *     + optional Tâm Ma debuff (`taoMaUntil`).
   *   - Audit qua `TribulationAttemptLog` (1 row mỗi attempt).
   */
  @Post('tribulation')
  @HttpCode(200)
  async tribulationAttempt(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    // Phase 14.3.C — parse `selectedSupportItemKeys` (defensive narrow). Accept
    // empty/missing body cho backward-compat (legacy attempt without selection).
    const selectedSupportItemKeys = parseSelectedSupportItemKeys(body);
    try {
      const result = await this.tribulation.attemptTribulation(
        character.id,
        Math.random,
        new Date(),
        { selectedSupportItemKeys },
      );
      // Phase 11.6.B HTTP fix — cast BigInt + Date → string. Express JSON
      // serialize không support BigInt → throw INTERNAL_ERROR cho mọi attempt
      // (success/fail). View mirror `TribulationAttemptLogView` (Phase 11.6.F).
      return { ok: true, data: { tribulation: toAttemptOutcomeView(result) } };
    } catch (e) {
      if (e instanceof TribulationError) {
        fail(e.code, mapTribulationErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.A — Tribulation preview (read-only).
   *
   * Trả snapshot kiếp sắp tới cho character + ước tính success chance
   * deterministic + reward/penalty hint. KHÔNG mutate state, KHÔNG roll
   * RNG. FE TribulationView dùng để render preview panel trước khi player
   * click "Vượt kiếp".
   *
   *   - Auth gate (cookie session → userId → character).
   *   - Idempotent GET — không thay đổi state.
   *   - 200 + `{ preview: null }` nếu transition hiện tại không có catalog
   *     entry (low-tier breakthrough hoặc đã ở đỉnh) — FE render empty.
   *   - 200 + `{ preview: TribulationPreview }` nếu có def cho transition.
   *   - 503 nếu module chưa wire (`TRIBULATION_UNAVAILABLE`).
   *   - BigInt `rewardHint.expBonus` cast → string ở
   *     `summarizeTribulationRewardHint` (FE serialize an toàn).
   */
  @Get('tribulation/preview')
  async tribulationPreview(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const preview = await this.tribulation.previewTribulation(character.id);
      return { ok: true, data: { preview } };
    } catch (e) {
      if (e instanceof TribulationError) {
        fail(e.code, mapTribulationErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.6.F Tribulation log — list recent tribulation attempts của
   * character đang đăng nhập.
   *
   *   - Auth gate (cookie session → userId → character).
   *   - Idempotent GET — không thay đổi state.
   *   - Sort theo `createdAt` DESC.
   *   - Optional `?limit=N` (1..100, default 20). Invalid → fallback default.
   *   - 503 nếu module chưa wire (`TRIBULATION_UNAVAILABLE`).
   *   - BigInt fields cast → string ở `TribulationService.listAttemptLogs`
   *     để FE serialize an toàn (ko mất precision).
   */
  @Get('tribulation/log')
  async tribulationLog(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const parsedLimit = parseTribulationLogLimit(limit);
    const rows = await this.tribulation.listAttemptLogs(
      character.id,
      parsedLimit,
    );
    return { ok: true, data: { rows, limit: parsedLimit } };
  }

  /**
   * Phase 14.3.D — Tribulation Encounter (read-only current view).
   *
   * Trả snapshot encounter sắp tới (hoặc đang pending) cho character. UI
   * dùng để render encounter panel + status badges + element advantage.
   *
   *   - Auth gate (cookie session → userId → character).
   *   - Idempotent GET — không thay đổi state.
   *   - 200 + `{ encounter: null }` nếu transition hiện tại không có catalog
   *     entry (low-tier breakthrough hoặc đã ở đỉnh).
   *   - 200 + `{ encounter: TribulationEncounterCurrentView }` nếu có def.
   *   - 503 nếu module chưa wire (`TRIBULATION_UNAVAILABLE`).
   *
   * Routing convention: encounter endpoints nested under existing
   * `/character/tribulation/*` (cultivation controller chưa tách module).
   * Spec gốc viết `/cultivation/tribulation/encounter/*` — alias cùng
   * resource, tài liệu API ghi route thực tế.
   */
  @Get('tribulation/encounter/current')
  async tribulationEncounterCurrent(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const encounter = await this.tribulation.getCurrentEncounter(character.id);
      return { ok: true, data: { encounter } };
    } catch (e) {
      if (e instanceof TribulationError) {
        fail(e.code, mapTribulationErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.D — start a tribulation encounter session.
   *
   * Server-authoritative: validate peak gate + selection (catalog/dedupe/
   * cap), tạo row `TribulationEncounter{state: 'pending'}` snapshot
   * `selectedSupportItemKeys`. KHÔNG consume item ở đây (consume diễn ra
   * trong resolve).
   *
   * Idempotent re-call: pending row cùng `tribulationKey` → trả về row đó.
   *   - 200 + `{ encounter: TribulationEncounterRowView }` khi tạo/return.
   *   - 409 `ENCOUNTER_ALREADY_PENDING` nếu pending row khác tribulationKey.
   *   - 4xx khi peak gate/selection fail (mirror attempt errors).
   */
  @Post('tribulation/encounter/start')
  @HttpCode(200)
  async tribulationEncounterStart(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const selectedSupportItemKeys = parseSelectedSupportItemKeys(body);
    try {
      const encounter = await this.tribulation.startEncounter(character.id, {
        selectedSupportItemKeys,
      });
      return { ok: true, data: { encounter } };
    } catch (e) {
      if (e instanceof TribulationError) {
        fail(e.code, mapTribulationErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.D — resolve a pending encounter.
   *
   * Server-authoritative: simulate kiếp + consume selected items + atomic
   * update character/currency/log + transition state pending → resolved.
   *
   * Idempotency: re-call sau khi state='resolved' → re-fetch cached
   * outcome từ persisted attempt log; KHÔNG double breakthrough, KHÔNG
   * double consume support, KHÔNG double reward.
   *
   *   - 200 + `{ tribulation: TribulationAttemptOutcomeView }` (success/fail).
   *   - 404 `NO_PENDING_ENCOUNTER` nếu không có row pending/resolved.
   *   - 4xx khi runtime gate fail (cooldown, character not found, etc).
   */
  @Post('tribulation/encounter/resolve')
  @HttpCode(200)
  async tribulationEncounterResolve(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.tribulation.resolveEncounter(character.id);
      return {
        ok: true,
        data: { tribulation: toAttemptOutcomeView(result) },
      };
    } catch (e) {
      if (e instanceof TribulationError) {
        fail(e.code, mapTribulationErrorStatus(e.code));
      }
      throw e;
    }
  }

  /* ---------------------------------------------------------------------------
   * Phase 14.3.E.1 — Mini-battle backend endpoints. Feature flag
   * `TRIBULATION_MINI_BATTLE_ENABLED=true` để bật. Khi tắt, 4 endpoint trả
   * 501 NOT_IMPLEMENTED để FE fallback flow Phase 14.3.D.
   * ------------------------------------------------------------------------- */

  /**
   * Phase 14.3.E.1 — return active mini-battle if exists.
   *   - 200 + `{ battle: TribulationMiniBattleView | null }`.
   *   - 404 NO_CHARACTER nếu chưa onboard.
   */
  @Get('tribulation/battle/current')
  async tribulationBattleCurrent(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.tribulationMiniBattle) {
      fail('TRIBULATION_MINI_BATTLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const battle = await this.tribulationMiniBattle.getCurrent(character.id);
      return { ok: true, data: { battle } };
    } catch (e) {
      if (e instanceof TribulationMiniBattleError) {
        fail(e.code, mapTribulationMiniBattleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.E.1 — start a new mini-battle. Body có optional
   * `selectedSupportItemKeys` mirror `tribulation/encounter/start`.
   *   - 200 + `{ battle }` khi tạo mới.
   *   - 409 MINI_BATTLE_ALREADY_ACTIVE nếu đã có battle PENDING/ACTIVE.
   *   - 501 MINI_BATTLE_DISABLED nếu feature flag tắt.
   */
  @Post('tribulation/battle/start')
  @HttpCode(200)
  async tribulationBattleStart(@Req() req: Request, @Body() body: unknown) {
    // Phase 15.4 — runtime gate (DB-backed override bên trên env-based
    // lằn trong service). 503 + FEATURE_DISABLED.
    if (this.featureFlags) {
      await this.featureFlags.requireEnabled('TRIBULATION_MINI_BATTLE_ENABLED');
    }
    const userId = await this.requireUserId(req);
    if (!this.tribulationMiniBattle) {
      fail('TRIBULATION_MINI_BATTLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const selectedSupportItemKeys = parseSelectedSupportItemKeys(body);
    try {
      const battle = await this.tribulationMiniBattle.start(character.id, {
        selectedSupportItemKeys,
      });
      return { ok: true, data: { battle } };
    } catch (e) {
      if (e instanceof TribulationMiniBattleError) {
        fail(e.code, mapTribulationMiniBattleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.E.1 — submit one player action. Body shape:
   *   `{ battleId: string, action: TribulationBattleAction, clientNonce?: string }`.
   *   - 200 + `{ battle }` snapshot sau khi apply (terminal nếu phase done).
   *   - 400 MINI_BATTLE_INVALID_ACTION cho action không hợp lệ / phase quá
   *     hạn / race condition lost.
   *   - 404 MINI_BATTLE_NOT_FOUND khi `battleId` sai owner.
   *   - 409 MINI_BATTLE_TERMINAL khi battle đã RESOLVED/FAILED.
   */
  @Post('tribulation/battle/action')
  @HttpCode(200)
  async tribulationBattleAction(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.tribulationMiniBattle) {
      fail('TRIBULATION_MINI_BATTLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const parsed = parseTribulationBattleActionBody(body);
    try {
      const battle = await this.tribulationMiniBattle.action(
        character.id,
        parsed.battleId,
        parsed.action,
        parsed.clientNonce ?? null,
      );
      return { ok: true, data: { battle } };
    } catch (e) {
      if (e instanceof TribulationMiniBattleError) {
        fail(e.code, mapTribulationMiniBattleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 14.3.E.1 — resolve a terminal mini-battle: apply WIN/LOSE outcome
   * (realm advance / cooldown / consume support items) idempotently.
   * Body shape: `{ battleId: string }`.
   *   - 200 + `{ tribulation: TribulationAttemptOutcomeView }`.
   *   - 400 MINI_BATTLE_NOT_TERMINAL nếu battle vẫn PENDING/ACTIVE.
   *   - 404 MINI_BATTLE_NOT_FOUND khi battleId sai owner.
   */
  @Post('tribulation/battle/resolve')
  @HttpCode(200)
  async tribulationBattleResolve(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.tribulationMiniBattle) {
      fail('TRIBULATION_MINI_BATTLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const parsed = parseTribulationBattleResolveBody(body);
    try {
      const result = await this.tribulationMiniBattle.resolve(
        character.id,
        parsed.battleId,
      );
      return {
        ok: true,
        data: { tribulation: toAttemptOutcomeView(result) },
      };
    } catch (e) {
      if (e instanceof TribulationMiniBattleError) {
        fail(e.code, mapTribulationMiniBattleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.10.E Achievement state — return server-authoritative state cho
   * UI achievement screen: tất cả visible achievement merge với progress
   * /completedAt/claimedAt.
   *
   *   - Reuse `AchievementService.listAllWithProgress`.
   *   - Hidden achievement chỉ hiện khi đã complete (anti-spoil).
   *   - Sort theo thứ tự catalog (`ACHIEVEMENTS` array order).
   *   - Idempotent GET — không thay đổi state.
   */
  @Get('achievements')
  async achievementsState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.achievement) {
      fail('ACHIEVEMENT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const list = await this.achievement.listAllWithProgress(character.id);
      return {
        ok: true,
        data: {
          achievements: list.map((entry) => ({
            achievementKey: entry.achievementKey,
            progress: entry.progress,
            completedAt:
              entry.completedAt === null ? null : entry.completedAt.toISOString(),
            claimedAt:
              entry.claimedAt === null ? null : entry.claimedAt.toISOString(),
            def: entry.def,
          })),
        },
      };
    } catch (e) {
      if (e instanceof AchievementError) {
        fail(e.code, mapAchievementErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.10.C-1 Achievement claim — atomic grant linhThach/tienNgoc/exp
   * + auto-unlock title qua `titleForAchievement`.
   *
   * Server-authoritative idempotent claim:
   *   - Verify row exists + completedAt != null + claimedAt == null.
   *   - CAS update `where { id, claimedAt: null }` → `data { claimedAt: now }`
   *     (race-safe: concurrent call chỉ 1 winner).
   *   - Apply `linhThach`/`tienNgoc` qua `CurrencyService.applyTx` reason
   *     `ACHIEVEMENT_REWARD` (CurrencyLedger audit).
   *   - Apply `exp` qua `tx.character.update`.
   *   - Auto-unlock title qua `TitleService.unlockTitleTx(source='achievement')`
   *     nếu `def.rewardTitleKey` set + `titleForAchievement` match.
   *   - Phase 11.10.D — `def.reward.items` non-empty → grant items qua
   *     `InventoryService.grantTx` reason `'ACHIEVEMENT_REWARD'` (`ItemLedger`
   *     audit). Identity hiện tại (32 baseline không có items) → no-op.
   */
  @Post('achievement/claim')
  @HttpCode(200)
  async achievementClaim(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.achievement) {
      fail('ACHIEVEMENT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = AchievementClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.achievement.claimReward(
        character.id,
        parsed.data.achievementKey,
      );
      return { ok: true, data: { claim: result } };
    } catch (e) {
      if (e instanceof AchievementError) {
        fail(e.code, mapAchievementErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.X.AS Talent state — return server-authoritative state cho user
   * UI talent catalog: list talent đã học (kèm `def` snapshot từ catalog),
   * điểm ngộ đạo đã spent + còn lại.
   *
   *   - Reuse `TalentService.listLearned` + `TalentService.getRemainingTalentPoints`.
   *   - Idempotent GET — không thay đổi state. Không có rate-limit riêng vì
   *     bound theo character của caller (auth required).
   *   - Catalog metadata-only (server compute từ rows + `getTalentDef`).
   *   - Frontend filter "đã học / chưa học" + budget badge wire qua endpoint
   *     này (Phase 11.X.AT future PR).
   */
  @Get('talents/state')
  async talentsState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.talent) {
      fail('TALENT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const [learned, remaining] = await Promise.all([
        this.talent.listLearned(character.id),
        this.talent.getRemainingTalentPoints(character.id),
      ]);
      const spent = learned.reduce((s, l) => s + l.def.talentPointCost, 0);
      return {
        ok: true,
        data: {
          talents: {
            learned: learned.map((l) => ({
              talentKey: l.talentKey,
              learnedAt: l.learnedAt.toISOString(),
              cooldownTurnsRemaining: l.cooldownTurnsRemaining,
            })),
            spent,
            remaining,
            budget: spent + remaining,
          },
        },
      };
    } catch (e) {
      if (e instanceof TalentError) {
        fail(e.code, mapTalentErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.X.AS Talent learn — server-authoritative POST cho frontend
   * "Học" button trong TalentCatalogView.
   *
   *   - Body: `{ talentKey: string }` (Zod validated).
   *   - Validate auth → resolve character → reuse `TalentService.learnTalent`.
   *   - Atomic transaction trong service (composite UNIQUE
   *     `(characterId, talentKey)` chống double-learn race).
   *   - Trả về row vừa tạo + budget remaining cập nhật để frontend không
   *     cần round-trip thêm `GET talents/state`.
   *   - Error mapping qua `mapTalentErrorStatus`.
   */
  @Post('talents/learn')
  @HttpCode(200)
  async talentsLearn(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.talent) {
      fail('TALENT_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = TalentLearnInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.talent.learnTalent(
        character.id,
        parsed.data.talentKey,
      );
      const remaining = await this.talent.getRemainingTalentPoints(character.id);
      return {
        ok: true,
        data: {
          learn: {
            talentKey: result.talentKey,
            learnedAt: result.learnedAt.toISOString(),
          },
          remaining,
        },
      };
    } catch (e) {
      if (e instanceof TalentError) {
        fail(e.code, mapTalentErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.11.C Alchemy state — list recipe khả dụng theo `furnaceLevel`
   * hiện tại của character + furnace level. Server-authoritative — frontend
   * không tự filter theo catalog.
   *
   *   - Reuse `AlchemyService.getFurnaceLevel` + `AlchemyService.listAvailableRecipes`.
   *   - Idempotent GET — không thay đổi state. Auth required (bound theo
   *     character của caller).
   *   - Trả về `recipes[]` snapshot từ catalog `ALCHEMY_RECIPES` (frozen,
   *     không có instance per-character) — frontend hiển thị availability +
   *     cost preview.
   */
  @Get('alchemy/recipes')
  async alchemyRecipes(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.alchemy) {
      fail('ALCHEMY_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const [furnaceLevel, recipes, nextUpgrade] = await Promise.all([
        this.alchemy.getFurnaceLevel(character.id),
        this.alchemy.listAvailableRecipes(character.id),
        this.alchemy.getFurnaceUpgradePreview(character.id),
      ]);
      return {
        ok: true,
        data: {
          alchemy: {
            furnaceLevel,
            nextUpgrade: nextUpgrade
              ? {
                  toLevel: nextUpgrade.toLevel,
                  linhThachCost: nextUpgrade.linhThachCost,
                  realmRequirement: nextUpgrade.realmRequirement,
                }
              : null,
            recipes: recipes.map((r) => ({
              key: r.key,
              name: r.name,
              description: r.description,
              outputItem: r.outputItem,
              outputQty: r.outputQty,
              outputQuality: r.outputQuality,
              inputs: r.inputs.map((i) => ({ itemKey: i.itemKey, qty: i.qty })),
              furnaceLevel: r.furnaceLevel,
              realmRequirement: r.realmRequirement,
              linhThachCost: r.linhThachCost,
              successRate: r.successRate,
            })),
          },
        },
      };
    } catch (e) {
      if (e instanceof AlchemyError) {
        fail(e.code, mapAlchemyErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.11.C Alchemy craft — server-authoritative POST cho frontend
   * "Luyện đan" button.
   *
   *   - Body: `{ recipeKey: string }` (Zod validated).
   *   - Validate auth → resolve character → reuse `AlchemyService.attemptCraft`
   *     (atomic `prisma.$transaction` consume input + linhThach + grant
   *     output qua `ItemLedger`/`CurrencyLedger`).
   *   - Input + linhThach LUÔN bị consume dù fail (balance intent — khớp
   *     comment trong catalog `simulateAlchemyAttempt`).
   *   - RNG mặc định `Math.random` — không cho client inject; reuse pattern
   *     từ `tribulation` endpoint.
   *   - Trả về `outcome` + `furnaceLevel` để frontend render kết quả + refresh
   *     inventory.
   */
  @Post('alchemy/craft')
  @HttpCode(200)
  async alchemyCraft(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.alchemy) {
      fail('ALCHEMY_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const parsed = AlchemyCraftInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const outcome = await this.alchemy.attemptCraft(
        character.id,
        parsed.data.recipeKey,
      );
      const furnaceLevel = await this.alchemy.getFurnaceLevel(character.id);
      return {
        ok: true,
        data: {
          alchemy: {
            furnaceLevel,
            outcome: {
              recipeKey: outcome.recipeKey,
              success: outcome.success,
              rollValue: outcome.rollValue,
              outputItem: outcome.outputItem,
              outputQty: outcome.outputQty,
              linhThachConsumed: outcome.linhThachConsumed,
              inputsConsumed: outcome.inputsConsumed.map((i) => ({
                itemKey: i.itemKey,
                qty: i.qty,
              })),
            },
          },
        },
      };
    } catch (e) {
      if (e instanceof AlchemyError) {
        fail(e.code, mapAlchemyErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.11.D-2 — Upgrade lò đan, server-authoritative POST.
   *
   *   - No body (target = currentLevel + 1, server quyết định).
   *   - Validate auth → resolve character → reuse `AlchemyService.upgradeFurnace`
   *     (atomic `prisma.$transaction` deduct linhThach qua `CurrencyLedger`
   *     reason `ALCHEMY_FURNACE_UPGRADE` + CAS bump alchemyFurnaceLevel).
   *   - Trả về `{ fromLevel, toLevel, linhThachConsumed }` + `nextUpgrade`
   *     preview cho UI render tiếp.
   */
  @Post('alchemy/upgrade-furnace')
  @HttpCode(200)
  async alchemyUpgradeFurnace(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.alchemy) {
      fail('ALCHEMY_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const outcome = await this.alchemy.upgradeFurnace(character.id);
      const nextUpgrade = await this.alchemy.getFurnaceUpgradePreview(character.id);
      return {
        ok: true,
        data: {
          alchemy: {
            furnaceLevel: outcome.toLevel,
            outcome: {
              fromLevel: outcome.fromLevel,
              toLevel: outcome.toLevel,
              linhThachConsumed: outcome.linhThachConsumed,
            },
            nextUpgrade: nextUpgrade
              ? {
                  toLevel: nextUpgrade.toLevel,
                  linhThachCost: nextUpgrade.linhThachCost,
                  realmRequirement: nextUpgrade.realmRequirement,
                }
              : null,
          },
        },
      };
    } catch (e) {
      if (e instanceof AlchemyError) {
        fail(e.code, mapAlchemyErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.9.C — list owned titles + currently equipped + def metadata.
   *
   * Server-authoritative read:
   *   - `owned`: array title đã unlock cho character (CharacterTitleUnlock
   *     rows mapped với `def` metadata từ `TITLES` catalog). Sort theo
   *     `unlockedAt asc` (chronological).
   *   - `catalog`: full 26-title catalog snapshot — FE render lock state
   *     bằng cách so sánh `owned[].titleKey` ∈ `catalog`.
   *   - `equipped`: title đang equip (`Character.title`) hoặc `null`.
   *
   * Idempotent GET — không thay đổi state. Auth required, không có rate-limit
   * riêng vì bound theo character của caller.
   */
  @Get('titles')
  async titlesState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.title) fail('TITLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const owned = await this.title.listOwned(character.id);
      const equipped = await this.title.getEquipped(character.id);
      return {
        ok: true,
        data: {
          owned: owned.map((row) => ({
            titleKey: row.titleKey,
            source: row.source,
            unlockedAt: row.unlockedAt.toISOString(),
            def: row.def,
          })),
          catalog: TITLES,
          equipped: equipped
            ? { titleKey: equipped.titleKey, def: equipped.def }
            : null,
        },
      };
    } catch (e) {
      if (e instanceof TitleError) {
        fail(e.code, mapTitleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.9.C — equip 1 title (single-slot). Validate ownership trước khi
   * set `Character.title`. Re-equip cùng title an toàn (idempotent set).
   *
   * @throws TITLE_NOT_FOUND — titleKey không tồn tại trong catalog.
   * @throws TITLE_NOT_OWNED — character chưa unlock title này.
   *
   * Trả về `{ character: CharacterStatePayload, equipped: { titleKey, def } }`.
   * FE update store từ `character` (đã include `title` field).
   */
  @Post('title/equip')
  @HttpCode(200)
  async titleEquip(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    if (!this.title) fail('TITLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const parsed = TitleEquipInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    if (!getTitleDef(parsed.data.titleKey)) {
      fail('TITLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      await this.title.equipTitle(character.id, parsed.data.titleKey);
      const fresh = await this.chars.getStateOrThrow(userId);
      const equipped = await this.title.getEquipped(character.id);
      return {
        ok: true,
        data: {
          character: fresh,
          equipped: equipped
            ? { titleKey: equipped.titleKey, def: equipped.def }
            : null,
        },
      };
    } catch (e) {
      if (e instanceof TitleError) {
        fail(e.code, mapTitleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.9.C — unequip title hiện tại (clear `Character.title = null`).
   * Idempotent — no-op nếu chưa equip.
   *
   * Trả về `{ character: CharacterStatePayload }`. FE update store.
   */
  @Post('title/unequip')
  @HttpCode(200)
  async titleUnequip(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.title) fail('TITLE_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      await this.title.unequipTitle(character.id);
      const fresh = await this.chars.getStateOrThrow(userId);
      return { ok: true, data: { character: fresh } };
    } catch (e) {
      if (e instanceof TitleError) {
        fail(e.code, mapTitleErrorStatus(e.code));
      }
      throw e;
    }
  }

  /**
   * Phase 11.8.D — list active (non-expired) buffs cho character với def
   * metadata. Auto-prune expired rows trước khi return — caller không cần
   * worry về stale data.
   *
   * Returns array `{ buffKey, stacks, source, expiresAt, def }` sorted by
   * `expiresAt asc` (sắp hết hạn lên đầu — UI render countdown convenient).
   * Defensive skip catalog miss (key rename).
   *
   * Idempotent GET — không thay đổi state ngoại trừ side effect prune (acceptable
   * — expired data invalid khắp mọi consumer).
   */
  @Get('buffs')
  async buffsState(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.buff) fail('BUFF_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const active = await this.buff.listActive(character.id);
    const out = active.flatMap((row) => {
      const def = getBuffDef(row.buffKey);
      if (!def) return [];
      return [
        {
          buffKey: row.buffKey,
          stacks: row.stacks,
          source: row.source,
          expiresAt: row.expiresAt.toISOString(),
          def,
        },
      ];
    });
    return { ok: true, data: { active: out } };
  }
}

/** Map TitleError code → HTTP status (Phase 11.9.C). */
function mapTitleErrorStatus(code: TitleError['code']): HttpStatus {
  switch (code) {
    case 'TITLE_NOT_FOUND':
    case 'CHARACTER_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'TITLE_NOT_OWNED':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map GemError code → HTTP status. */
function mapGemErrorStatus(code: GemError['code']): HttpStatus {
  switch (code) {
    case 'GEM_NOT_FOUND':
    case 'EQUIPMENT_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_EQUIPPABLE':
    case 'GEM_INCOMPATIBLE_SLOT':
    case 'NO_SOCKET_CAPACITY':
    case 'SOCKETS_FULL':
    case 'NO_NEXT_TIER':
      return HttpStatus.CONFLICT;
    case 'INSUFFICIENT_QTY':
      return HttpStatus.CONFLICT;
    case 'INVALID_SLOT_INDEX':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map RefineError code → HTTP status. */
function mapRefineErrorStatus(code: RefineError['code']): HttpStatus {
  switch (code) {
    case 'EQUIPMENT_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_REFINABLE':
    case 'MAX_LEVEL_REACHED':
    case 'INSUFFICIENT_MATERIAL':
    case 'INSUFFICIENT_PROTECTION':
    case 'INSUFFICIENT_FUNDS':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map EquipmentError (Phase 15.0.A reforge/enchant) code → HTTP status. */
function mapEquipmentErrorStatus(code: EquipmentError['code']): HttpStatus {
  switch (code) {
    case 'EQUIPMENT_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'INVALID_EQUIPMENT':
    case 'INVALID_ELEMENT':
      return HttpStatus.BAD_REQUEST;
    case 'INSUFFICIENT_FUNDS':
    case 'INSUFFICIENT_MATERIAL':
    case 'MAX_ENCHANT_REACHED':
    case 'ELEMENT_LOCKED':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map TribulationError code → HTTP status. */
function mapTribulationErrorStatus(
  code: TribulationError['code'],
): HttpStatus {
  switch (code) {
    case 'CHARACTER_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AT_PEAK':
    case 'NO_NEXT_REALM':
    case 'NO_TRIBULATION_FOR_TRANSITION':
    case 'COOLDOWN_ACTIVE':
      return HttpStatus.CONFLICT;
    case 'INVALID_RNG':
    case 'INVENTORY_UNAVAILABLE':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    // Phase 14.3.C — selection / inventory rejections.
    case 'INVALID_SUPPORT_SELECTION':
    case 'TOO_MANY_SUPPORT_ITEMS':
    case 'DUPLICATE_SUPPORT_ITEM':
    case 'INVALID_SUPPORT_ITEM':
    case 'SUPPORT_ITEM_MISSING':
      return HttpStatus.BAD_REQUEST;
    // Phase 14.3.D — encounter system rejections.
    case 'NO_PENDING_ENCOUNTER':
      return HttpStatus.NOT_FOUND;
    case 'ENCOUNTER_ALREADY_PENDING':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Phase 14.3.C — parse `selectedSupportItemKeys` từ POST /character/tribulation
 * body. Accept:
 *   - Missing body (undefined) → empty.
 *   - Body without `selectedSupportItemKeys` → empty (backward-compat).
 *   - Body với `selectedSupportItemKeys: string[]` → return mảng.
 *   - Anything else → throw HTTP 400 — service-side validate sẽ catch lại
 *     defensive nếu bypass.
 *
 * KHÔNG validate catalog/duplicate ở đây — service validate qua
 * `validateTribulationSupportSelection`. Controller chỉ shape narrow.
 */
function parseSelectedSupportItemKeys(body: unknown): readonly string[] {
  if (body === undefined || body === null) return [];
  if (typeof body !== 'object') {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  const raw = (body as Record<string, unknown>).selectedSupportItemKeys;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    fail('INVALID_SUPPORT_SELECTION', HttpStatus.BAD_REQUEST);
  }
  for (const k of raw as unknown[]) {
    if (typeof k !== 'string') {
      fail('INVALID_SUPPORT_SELECTION', HttpStatus.BAD_REQUEST);
    }
  }
  return raw as readonly string[];
}

/**
 * Phase 14.3.E.1 — parse body cho `POST /character/tribulation/battle/action`.
 *   - `battleId`: required string (cuid).
 *   - `action`: required string ∈ TRIBULATION_BATTLE_ACTIONS (validate
 *     server-side bằng helper, controller chỉ shape narrow).
 *   - `clientNonce`: optional string ≤ 64 chars (idempotency dedupe).
 */
function parseTribulationBattleActionBody(body: unknown): {
  battleId: string;
  action: string;
  clientNonce: string | null;
} {
  if (!body || typeof body !== 'object') {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  const obj = body as Record<string, unknown>;
  const battleId = obj.battleId;
  const action = obj.action;
  if (typeof battleId !== 'string' || battleId.length === 0 || battleId.length > 128) {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  if (typeof action !== 'string' || action.length === 0 || action.length > 32) {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  const nonceRaw = obj.clientNonce;
  let clientNonce: string | null = null;
  if (nonceRaw !== undefined && nonceRaw !== null) {
    if (typeof nonceRaw !== 'string' || nonceRaw.length > 64) {
      fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
    }
    clientNonce = nonceRaw;
  }
  return { battleId: battleId as string, action: action as string, clientNonce };
}

/**
 * Phase 14.3.E.1 — parse body cho `POST /character/tribulation/battle/resolve`.
 *   - `battleId`: required string.
 */
function parseTribulationBattleResolveBody(body: unknown): { battleId: string } {
  if (!body || typeof body !== 'object') {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  const obj = body as Record<string, unknown>;
  const battleId = obj.battleId;
  if (typeof battleId !== 'string' || battleId.length === 0 || battleId.length > 128) {
    fail('INVALID_BODY', HttpStatus.BAD_REQUEST);
  }
  return { battleId: battleId as string };
}

/**
 * Phase 14.3.E.1 — map TribulationMiniBattleError code → HTTP status. Re-uses
 * tribulation status map cho codes shared (CHARACTER_NOT_FOUND etc.) +
 * adds 6 mini-battle codes.
 */
function mapTribulationMiniBattleErrorStatus(
  code: TribulationMiniBattleError['code'],
): HttpStatus {
  switch (code) {
    case 'MINI_BATTLE_DISABLED':
      return HttpStatus.NOT_IMPLEMENTED;
    case 'MINI_BATTLE_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'MINI_BATTLE_ALREADY_ACTIVE':
    case 'MINI_BATTLE_TERMINAL':
      return HttpStatus.CONFLICT;
    case 'MINI_BATTLE_NOT_TERMINAL':
    case 'MINI_BATTLE_INVALID_ACTION':
      return HttpStatus.BAD_REQUEST;
    default:
      return mapTribulationErrorStatus(
        code as TribulationError['code'],
      );
  }
}

/**
 * Phase 11.6.F — parse `?limit=N` query string an toàn.
 * Invalid (non-numeric, NaN, <=0) → fallback `TRIBULATION_LOG_DEFAULT_LIMIT`.
 * Cap > MAX → MAX. Service cũng có `Math.max/min` guard nhưng controller
 * normalize trước để response shape `data.limit` luôn match thực tế cap.
 */
function parseTribulationLogLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return TRIBULATION_LOG_DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return TRIBULATION_LOG_DEFAULT_LIMIT;
  return Math.min(TRIBULATION_LOG_MAX_LIMIT, Math.floor(n));
}

/**
 * Phase 11 nâng cao §5 PR3 prep — parse `?limit=N` query string an toàn cho
 * `GET /character/breakthrough/log`. Mirror `parseTribulationLogLimit`.
 * Invalid (non-numeric, NaN, <=0) → fallback `BREAKTHROUGH_LOG_DEFAULT_LIMIT`.
 * Cap > MAX → MAX. Service cũng có guard nhưng controller normalize trước
 * để response shape `data.limit` luôn match thực tế cap.
 */
function parseBreakthroughLogLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return BREAKTHROUGH_LOG_DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return BREAKTHROUGH_LOG_DEFAULT_LIMIT;
  return Math.min(BREAKTHROUGH_LOG_MAX_LIMIT, Math.floor(n));
}

/** Map TalentError code → HTTP status. */
function mapTalentErrorStatus(code: TalentError['code']): HttpStatus {
  switch (code) {
    case 'TALENT_NOT_FOUND':
    case 'CHARACTER_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'ALREADY_LEARNED':
    case 'REALM_TOO_LOW':
    case 'INSUFFICIENT_TALENT_POINTS':
    case 'INVALID_REALM_REQUIREMENT':
      return HttpStatus.CONFLICT;
    case 'INVALID_REALM':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map AchievementError code → HTTP status. */
function mapAchievementErrorStatus(
  code: AchievementError['code'],
): HttpStatus {
  switch (code) {
    case 'ACHIEVEMENT_NOT_FOUND':
    case 'CHARACTER_NOT_FOUND':
    case 'NOT_FOUND_PROGRESS':
      return HttpStatus.NOT_FOUND;
    case 'NOT_COMPLETED':
    case 'ALREADY_CLAIMED':
      return HttpStatus.CONFLICT;
    case 'INVALID_AMOUNT':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Map `CharacterSkillError` code → HTTP status.
 *
 * 404 NOT_FOUND nhóm: SKILL_NOT_FOUND / CHARACTER_NOT_FOUND / REALM_NOT_FOUND
 * + INVENTORY_ITEM_NOT_FOUND (Phase 11.2.D `learnFromBook`).
 *
 * 409 CONFLICT nhóm: NOT_LEARNED / METHOD_NOT_LEARNED / TOO_MANY_EQUIPPED /
 * MASTERY_MAX / REALM_TOO_LOW / WRONG_SECT + ALREADY_LEARNED (Phase 11.2.D
 * — đã học, không consume) + NOT_SKILL_BOOK (Phase 11.2.D — item sai kind).
 *
 * 402 PAYMENT_REQUIRED: INSUFFICIENT_FUNDS (linh thạch shortage cho
 * upgrade-mastery).
 */
function mapSkillErrorStatus(code: CharacterSkillError['code']): HttpStatus {
  switch (code) {
    case 'SKILL_NOT_FOUND':
    case 'CHARACTER_NOT_FOUND':
    case 'REALM_NOT_FOUND':
    case 'INVENTORY_ITEM_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_LEARNED':
    case 'METHOD_NOT_LEARNED':
    case 'TOO_MANY_EQUIPPED':
    case 'MASTERY_MAX':
    case 'REALM_TOO_LOW':
    case 'WRONG_SECT':
    case 'ALREADY_LEARNED':
    case 'NOT_SKILL_BOOK':
      return HttpStatus.CONFLICT;
    case 'INSUFFICIENT_FUNDS':
      return HttpStatus.PAYMENT_REQUIRED;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/** Map AlchemyError code → HTTP status (Phase 11.11.C, extended Phase 11.11.D-2). */
function mapAlchemyErrorStatus(code: AlchemyError['code']): HttpStatus {
  switch (code) {
    case 'RECIPE_NOT_FOUND':
    case 'CHARACTER_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'FURNACE_LEVEL_TOO_LOW':
    case 'FURNACE_LEVEL_MAX':
    case 'FURNACE_RACE':
    case 'REALM_REQUIREMENT_NOT_MET':
    case 'INSUFFICIENT_INGREDIENTS':
    case 'INSUFFICIENT_FUNDS':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Phase 11 nâng cao §5 PR2 wire — view mapper cho `BreakthroughAttemptOutcome`.
 *
 * Cast `Date` fields → ISO string (FE serialize chuẩn JSON), giữ nguyên
 * `breakdown` (4 layer numbers, ≤6 decimal precision OK qua JSON), `rngRoll`
 * (number), `attemptIndex` (int). `character` đã là `CharacterStatePayload`
 * (BigInt → string trong `toState()`).
 *
 * Mirror pattern `TribulationAttemptOutcomeView` (Phase 11.6.B). Function
 * pure — KHÔNG side-effect, để controller test/mock dễ.
 */
function toBreakthroughAttemptView(o: BreakthroughAttemptOutcome) {
  return {
    success: o.success,
    fromRealmKey: o.fromRealmKey,
    fromRealmStage: o.fromRealmStage,
    toRealmKey: o.toRealmKey,
    toRealmStage: o.toRealmStage,
    breakdown: {
      reason: o.breakdown.reason,
      baseChance: o.breakdown.baseChance,
      rootPurityBonus: o.breakdown.rootPurityBonus,
      methodAffinityBonus: o.breakdown.methodAffinityBonus,
      itemBonus: o.breakdown.itemBonus,
      rawChance: o.breakdown.rawChance,
      finalChance: o.breakdown.finalChance,
    },
    rngRoll: o.rngRoll,
    attemptIndex: o.attemptIndex,
    logId: o.logId,
    debuff: {
      applied: o.debuffApplied,
      key: o.debuffKey,
      expiresAt: o.debuffExpiresAt ? o.debuffExpiresAt.toISOString() : null,
    },
    character: o.character,
  };
}
