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
  TRIBULATION_LOG_DEFAULT_LIMIT,
  TRIBULATION_LOG_MAX_LIMIT,
  TribulationError,
  TribulationService,
  toAttemptOutcomeView,
} from './tribulation.service';
import {
  AchievementError,
  AchievementService,
} from './achievement.service';
import { TalentError, TalentService } from './talent.service';
import { AlchemyError, AlchemyService } from './alchemy.service';
import { AuthService } from '../auth/auth.service';
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

const AchievementClaimInput = z.object({
  achievementKey: z.string().min(1).max(64),
});

const TalentLearnInput = z.object({
  talentKey: z.string().min(1).max(64),
});

const AlchemyCraftInput = z.object({
  recipeKey: z.string().min(1).max(64),
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
    @Optional() private readonly tribulation?: TribulationService,
    @Optional() private readonly achievement?: AchievementService,
    @Optional() private readonly talent?: TalentService,
    @Optional() private readonly alchemy?: AlchemyService,
    @Optional() @Inject(PROFILE_RATE_LIMITER) profileLimiter?: RateLimiter,
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
  async tribulationAttempt(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    if (!this.tribulation) {
      fail('TRIBULATION_UNAVAILABLE', HttpStatus.NOT_IMPLEMENTED);
    }
    const character = await this.chars.findByUser(userId);
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    try {
      const result = await this.tribulation.attemptTribulation(character.id);
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
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      return HttpStatus.BAD_REQUEST;
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
