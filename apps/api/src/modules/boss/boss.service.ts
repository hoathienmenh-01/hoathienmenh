import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { Prisma, BossStatus, CurrencyKind } from '@prisma/client';
import {
  BOSS_ATTACK_COOLDOWN_MS,
  BOSS_LIFETIME_MS,
  BOSS_RESPAWN_DELAY_MS,
  BOSS_STAMINA_PER_HIT,
  SKILL_BASIC_ATTACK,
  WORLD_BOSS_REGION_KEY,
  activeScheduledBossEventForRegion,
  liveOpsEventForBossSpawn,
  bossByKey,
  bossSpawnRegions,
  bossesByRegion,
  characterSkillElementBonus,
  clampLiveOpsMultiplier,
  composeBuffMods,
  computeBodyStatBonus,
  composePassiveTalentMods,
  composeTitleMods,
  getBossElementProfile,
  getBodyRealmByKey,
  inferDropMonsterType,
  realmByKey,
  realmOrderToMaterialTier,
  rollDamage,
  skillByKey,
  type BossDef,
  type BossElementProfile,
  type BuffMods,
  type ElementKey,
  type PassiveTalentMods,
  type SectKey,
  type SkillDef,
  type TitleMods,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { AchievementService } from '../character/achievement.service';
import { TalentService } from '../character/talent.service';
import { BuffService } from '../character/buff.service';
import { TitleService } from '../character/title.service';
import { methodStatBonusFor } from '../character/cultivation-method.service';
import { InventoryService } from '../inventory/inventory.service';
import { MissionService } from '../mission/mission.service';
import { SectWarService } from '../sect-war/sect-war.service';
import { TerritoryService } from '../territory/territory.service';
import { LiveOpsEventSchedulerService } from '../liveops-event-scheduler/liveops-event-scheduler.service';
import { DropEconomyService } from '../economy/drop-economy.service';
import { Phase33StoryService } from '../story-v2/story-v2.service';
import { WebPushService } from '../web-push/web-push.service';
import { WebPushTriggerService } from '../web-push/web-push-trigger.service';
import { PetSnapshotService } from '../pet/pet-snapshot.service';

export class BossError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NO_ACTIVE_BOSS'
      | 'BOSS_DEFEATED'
      | 'COOLDOWN'
      | 'STAMINA_LOW'
      | 'MP_LOW'
      | 'HP_LOW'
      | 'SKILL_NOT_USABLE'
      | 'BOSS_ALREADY_ACTIVE'
      | 'INVALID_BOSS_KEY'
      | 'INVALID_LEVEL'
      | 'CONTROLLED'
      | 'CULTIVATION_BLOCKED',
  ) {
    super(code);
  }
}

export interface BossLeaderboardRow {
  rank: number;
  characterId: string;
  characterName: string;
  damage: string;
  hits: number;
}

export interface BossView {
  id: string;
  bossKey: string;
  name: string;
  description: string;
  level: number;
  maxHp: string;
  currentHp: string;
  status: BossStatus;
  spawnedAt: string;
  expiresAt: string;
  /**
   * Phase 12.6 — region scope cho multi-region auto-spawn. Match
   * `WorldBoss.regionKey` ở Prisma layer. `'world'` cho legacy
   * cross-region world boss, hoặc region key `hac_lam`/`kim_son_mach`/...
   * tương ứng `MAP_REGIONS` catalog.
   */
  regionKey: string;
  leaderboard: BossLeaderboardRow[];
  myDamage: string | null;
  myRank: number | null;
  participants: number;
  /** Cố định: thời điểm có thể đánh lần kế tiếp (per char). Null nếu không log-in. */
  cooldownUntil: string | null;
  /** UI gợi ý — boss-specific drop pool. */
  topDropPool: readonly string[];
  midDropPool: readonly string[];
  /**
   * Phase 14.2.D — Ngũ Hành identity profile (element, weakness, resist
   * elements, reward hint). Pure metadata — combat damage tính qua
   * `elementalMultiplier` + `composeMonsterElementalResist` (Phase
   * 11.3.B / 14.2.B), không đọc field này. FE dùng để render badge +
   * recommended counter + warning.
   *
   * Sentinel `null` = boss legacy không có catalog def (vô hệ
   * implicit). Field luôn present trong response (deterministic shape)
   * — caller có thể destructure mà không guard.
   */
  elementProfile: BossElementProfile;
}

export interface AttackResult {
  damageDealt: string;
  bossHp: string;
  bossMaxHp: string;
  defeated: boolean;
  myDamageTotal: string;
  myRank: number;
  charHp: number;
  charMp: number;
  charStamina: number;
}

export interface DefeatedRewardSlice {
  rank: number;
  characterId: string;
  characterName: string;
  damage: string;
  linhThach: string;
  items: { itemKey: string; qty: number }[];
}

const LEADERBOARD_SIZE = 20;

@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BossService.name);
  /** characterId → last attack ms (rate-limit). */
  private readonly cooldowns = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Concurrency phase 2 — in-process re-entry guard. Nếu tick trước vẫn
   * đang chạy (DB chậm, distribute reward backlog), `setInterval` 30s
   * vẫn fire next tick — flag này skip overlap thay vì 2 heartbeat song
   * song trên cùng process. Cross-process race vẫn cần partial unique
   * index `WorldBoss_status_active_unique` (DB-level backstop) — flag
   * chỉ là tối ưu intra-process.
   */
  private heartbeatRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly chars: CharacterService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
    private readonly missions: MissionService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly talents?: TalentService,
    @Optional() private readonly buffs?: BuffService,
    @Optional() private readonly titles?: TitleService,
    @Optional() private readonly sectWar?: SectWarService,
    @Optional() private readonly territory?: TerritoryService,
    @Optional()
    private readonly liveOpsEvents?: LiveOpsEventSchedulerService,
    @Optional() private readonly dropEconomy?: DropEconomyService,
    @Optional() private readonly webPush?: WebPushService,
    // Phase 44.1 — high-level web push trigger composer. Optional inject
    // — test bootstrap có thể bỏ. Fail-soft trong service.
    @Optional() private readonly webPushTrigger?: WebPushTriggerService,
    // Phase 33.3 — Story V2 boss_defeat step tracking. Optional inject
    // — test bootstrap có thể bỏ. Fail-soft trong service.
    @Optional() private readonly phase33Story?: Phase33StoryService,
    @Optional() private readonly petSnapshot?: PetSnapshotService,
  ) {}

  onModuleInit(): void {
    // Heartbeat 30s: spawn boss mới, expire boss quá hạn.
    this.timer = setInterval(() => {
      this.heartbeat().catch((e) => this.logger.error('boss heartbeat', e as Error));
    }, 30_000);
    // Tick lần đầu sau 2s để khởi động sau migrate.
    setTimeout(() => {
      this.heartbeat().catch(() => undefined);
    }, 2000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- public API ----------

  /**
   * Trả về boss ACTIVE "primary" (most recent spawn) — backwards-compat
   * với UI singleton mode (Phase 7). Phase 12.6 multi-region: dùng
   * `listActive()` để list tất cả ACTIVE boss across regions, hoặc
   * `getCurrentByRegion(regionKey)` để filter 1 region.
   */
  async getCurrent(viewerCharId: string | null): Promise<BossView | null> {
    const boss = await this.prisma.worldBoss.findFirst({
      where: { status: BossStatus.ACTIVE },
      orderBy: { spawnedAt: 'desc' },
    });
    if (!boss) return null;
    return this.toView(boss, viewerCharId);
  }

  /**
   * Phase 12.6 — list tất cả boss ACTIVE across regions. Sorted theo
   * regionKey ascending (deterministic UI ordering); FE BossView render
   * region tabs từ list này.
   */
  async listActive(viewerCharId: string | null): Promise<BossView[]> {
    const bosses = await this.prisma.worldBoss.findMany({
      where: { status: BossStatus.ACTIVE },
      orderBy: [{ regionKey: 'asc' }, { spawnedAt: 'desc' }],
    });
    if (bosses.length === 0) return [];
    return Promise.all(bosses.map((b) => this.toView(b, viewerCharId)));
  }

  /**
   * Phase 12.6 — boss ACTIVE trong region cụ thể (≤1 do partial unique
   * index `WorldBoss_status_region_active_unique`). Null nếu region
   * trống slot.
   */
  async getCurrentByRegion(
    regionKey: string,
    viewerCharId: string | null,
  ): Promise<BossView | null> {
    const boss = await this.prisma.worldBoss.findFirst({
      where: { status: BossStatus.ACTIVE, regionKey },
      orderBy: { spawnedAt: 'desc' },
    });
    if (!boss) return null;
    return this.toView(boss, viewerCharId);
  }

  /**
   * Player attack boss. Phase 12.6 multi-region:
   * - `bossId` truyền in → attack boss đó (chỉ check ACTIVE).
   * - `bossId` không truyền → fallback "primary" boss (1st ACTIVE found,
   *   most recent spawn) — backwards-compat với UI Phase 7 singleton.
   *   Multi-region UI nên LUÔN truyền `bossId` để tránh ambiguity.
   */
  async attack(
    userId: string,
    skillKey: string | undefined,
    bossId?: string,
  ): Promise<{ result: AttackResult; defeated: DefeatedRewardSlice[] | null }> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new BossError('NO_CHARACTER');

    // Phase 11.X.Q — Buff control wire (parallel to Phase 11.X.O combat wire).
    // Catalog producer: `debuff_root_thuy` (3 turns), `debuff_stun_tho` (1 turn),
    // `debuff_silence_kim` (2 turns). Throw `CONTROLLED` BEFORE any state
    // mutation (cooldown set, mp/stamina/hp deduct, ledger). Service không
    // injected (legacy DI / test fixture without `buffs`) → identity (no
    // throw). Player bị root/stun/silence không thể boss-attack — frontend
    // hiển thị "Đang bị khống chế, không thể tấn công boss."
    // Phase 11.X.R — Buff cultivationBlocked wire vào BossService.attack().
    // Catalog producer: `debuff_taoma` (Tâm Ma — block cultivation EXP gain).
    // Semantically Tâm Ma'd character không thể tập trung tu luyện hoặc chiến
    // đấu boss — block boss attack giống control. Throw `CULTIVATION_BLOCKED`
    // BEFORE state mutation. Cùng lần `getMods` với control check (consolidate
    // single buff fetch).
    // Phase 11.X.W — Buff atkMul/spiritMul wire vào BossService.attack() damage
    // calc. Move buff fetch ra ngoài `if (this.buffs)` block để reuse cho cả
    // (a) control/cultivation throw và (b) damage compose. Service không inject
    // → `composeBuffMods([])` identity (atkMul=1.0, spiritMul=1.0, no-op).
    // Single fetch consolidate — không double-call DB.
    const buffMods: BuffMods = this.buffs
      ? await this.buffs.getMods(char.id)
      : composeBuffMods([]);
    // Phase 11.X.Q — Buff control wire (parallel to Phase 11.X.O combat wire).
    if (buffMods.controlTurnsMax > 0) {
      throw new BossError('CONTROLLED');
    }
    // Phase 11.X.R — Buff cultivationBlocked wire vào BossService.attack().
    if (buffMods.cultivationBlocked) {
      throw new BossError('CULTIVATION_BLOCKED');
    }

    const now = Date.now();
    const last = this.cooldowns.get(char.id) ?? 0;
    if (now - last < BOSS_ATTACK_COOLDOWN_MS) {
      throw new BossError('COOLDOWN');
    }

    // Phase 12.6 — bossId optional. Nếu truyền → attack đúng boss đó (cross-
    // region disambiguation). Nếu không → fallback "primary" (1st ACTIVE,
    // most recent spawn) cho backwards-compat singleton UI.
    const boss = bossId
      ? await this.prisma.worldBoss.findUnique({ where: { id: bossId } })
      : await this.prisma.worldBoss.findFirst({
          where: { status: BossStatus.ACTIVE },
          orderBy: { spawnedAt: 'desc' },
        });
    if (!boss) throw new BossError('NO_ACTIVE_BOSS');
    if (boss.status !== BossStatus.ACTIVE) {
      // bossId truyền in nhưng boss đã defeat/expire → surface đúng status.
      throw new BossError(
        boss.status === BossStatus.DEFEATED ? 'BOSS_DEFEATED' : 'NO_ACTIVE_BOSS',
      );
    }
    const def = bossByKey(boss.bossKey);
    if (!def) throw new BossError('NO_ACTIVE_BOSS');

    const sectKey = await this.resolveSectKey(char.sectId);
    const skill: SkillDef = skillKey
      ? (skillByKey(skillKey) ?? SKILL_BASIC_ATTACK)
      : SKILL_BASIC_ATTACK;
    if (skill.sect !== null && skill.sect !== sectKey) {
      throw new BossError('SKILL_NOT_USABLE');
    }
    if (char.mp < skill.mpCost) throw new BossError('MP_LOW');
    if (char.stamina < BOSS_STAMINA_PER_HIT) throw new BossError('STAMINA_LOW');

    // Phase 11.4.E — Equipment atk/spirit bonus wire vào BossService.attack().
    // Trước đây boss attack chỉ dùng `char.power` raw + `char.spirit` raw, bỏ
    // qua hoàn toàn equip bonus (atk/spiritBonus từ trang bị + sockets +
    // refine). Player với full bộ equip giảm DPS boss đáng kể so với combat.
    // Subset của Phase 11.X.S full stat wire — chỉ wire equip bonus, KHÔNG
    // wire talent/buff/title atkMul (defer scope balance review). Element
    // bonus / Linh căn statMul cũng defer Phase 11.X.S/T.
    const equip = await this.inventory.equipBonus(char.id);
    const bodyBonus = computeBodyStatBonus(
      getBodyRealmByKey(char.bodyRealmKey)?.order ?? 0,
      char.bodyStage,
    );
    const effectiveHpMax = char.hpMax + bodyBonus.hpMax;
    // Huyết tế: trừ % HP — không cho dùng nếu < ngưỡng.
    const bloodCost = Math.floor(effectiveHpMax * skill.selfBloodCost);
    if (bloodCost > 0 && char.hp <= bloodCost) throw new BossError('HP_LOW');
    // Phase 11.4.F — Talent atkMul wire vào BossService.attack().
    // Phase 11.4.G — Talent spiritMul wire vào BossService.attack() spirit branch.
    // Phase 11.X.W — Buff atkMul/spiritMul wire vào BossService.attack().
    // Phase 11.X.X — Title atkMul/spiritMul wire vào BossService.attack().
    // Symmetric với Phase 11.X.S/U/Title combat path (talentMods.atkMul/spiritMul
    // + buffMods.atkMul/spiritMul + titleMods.atkMul/spiritMul). Multiplicative
    // compose talent × buff × title — vd `talent_kim_thien_co` (+10% atk) +
    // `pill_atk_buff_t1` (+12% atk) + `realm_thien_tien_celestial` (+7% atk) =
    // 1.10 × 1.12 × 1.07 = ~1.319 atk multiplier. Catalog producer atkMul:
    // talent (`talent_kim_thien_co` +10% kim), buff (`pill_atk_buff_t1` +12%,
    // `sect_aura_hoa` +5%, `debuff_boss_atk_down` ×0.82), title
    // (`element_kim_blade_master` +5%, `realm_thien_tien_celestial` +7%,
    // `realm_hu_khong_chi_ton` +12%, `element_hoa_phoenix_flame` +5%, etc.).
    // Catalog producer spiritMul: talent (`talent_huyen_thuy_tam` +10% thuy),
    // buff (`pill_spirit_buff_t1` +18%, `event_double_exp` ×2.0), title
    // (`realm_nguyen_anh_master` +2%, `realm_hoa_than_sage` +4%,
    // `realm_thanh_nhan_sage` +8%, etc.).
    // Service không inject (legacy DI / test fixture without `talents`/`buffs`/
    // `titles`) → identity baseline (atkMul=1.0, spiritMul=1.0, no-op).
    const talentMods: PassiveTalentMods = this.talents
      ? await this.talents.getMods(char.id)
      : composePassiveTalentMods([]);
    const titleMods: TitleMods = this.titles
      ? await this.titles.getMods(char.id)
      : composeTitleMods([]);
    // Phase 11.1.D-2 — Cultivation method statBonus.atkPercent wire vào
    // BossService.attack() charAtk. Symmetric với combat Phase 11.1.D
    // (combat.service.ts effPower/effDef). Catalog huyen-grade
    // `cuu_cuc_kim_cuong_quyet` (atk +5%) v.v. trước đó được khai báo nhưng
    // KHÔNG consume runtime ở boss path. Pure helper `methodStatBonusFor`
    // legacy (key=null) → identity. Pham starter `khai_thien_quyet` (0%) →
    // identity. defMul/hpMaxMul/mpMaxMul N/A boss (boss không reply, không
    // stat cap recompute). Method KHÔNG có spiritMul (chỉ atk/def/hpMax/mpMax),
    // nên spirit branch (atkScale > 1) không apply method bonus.
    const methodStat = methodStatBonusFor(char.equippedCultivationMethodKey);
    const charAtk =
      Math.floor(
        (char.power + bodyBonus.power + equip.atk) *
          talentMods.atkMul *
          buffMods.atkMul *
          titleMods.atkMul *
          methodStat.atkMul,
      ) +
      (skill.atkScale > 1
        ? Math.floor(
            (char.spirit + equip.spiritBonus) *
              talentMods.spiritMul *
              buffMods.spiritMul *
              titleMods.spiritMul,
          )
        : 0);
    const raw = rollDamage(charAtk, def.def, skill.atkScale);
    // Phase 11.X.Y — Talent + Buff `damageBonusByElement` wire vào BossService.attack().
    // Symmetric với Phase 11.7.C/11.8.C combat path (combat.service.ts L271-283
    // — combat đã wire `talentMods.damageBonusByElement.get(skillElement)` và
    // `buffMods.damageBonusByElement.get(skillElement)`). Boss path giờ
    // multiplicative compose `raw × talentElementMul × buffElementMul`.
    // Catalog producer talent damage_bonus theo element: `talent_hoa_tam_dao`
    // (+15% sát thương vs kim, tương khắc). Catalog producer buff: `buff_*`
    // damage_bonus có `elementTarget`. Khi `skill.element === null` (basic
    // attack / utility) → identity (no element bonus). Service không inject
    // talents/buffs → identity (compose*Mods empty Map → get() = undefined →
    // ?? 1 fallback). Title KHÔNG có damageBonusByElement (skip).
    const skillElement = skill.element ?? null;
    const talentElementMul =
      skillElement !== null
        ? talentMods.damageBonusByElement.get(skillElement) ?? 1
        : 1;
    const buffElementMul =
      skillElement !== null
        ? buffMods.damageBonusByElement.get(skillElement) ?? 1
        : 1;
    // Phase 11.X.Z — Linh căn / Ngũ Hành element wire vào BossService.attack().
    // Symmetric với Phase 11.3.B combat path (combat.service.ts L255-270 — combat
    // đã wire `characterSkillElementBonus(charElementState, skill.element, monster.element)`).
    // Boss path giờ multiplicative compose:
    //   damage = max(1, round(raw × playerElementMul × talentElementMul × buffElementMul)).
    // Boss def có `element` field (e.g. yeu_vuong_tho_huyet=tho, kim_phach_long_dieu=kim).
    // characterSkillElementBonus = elementMultiplier(skill,target) base + character
    // primary +0.10 / secondary +0.05 nếu skill cùng hệ. Legacy character
    // (primaryElement=null hoặc spiritualRootGrade=null) → charElementState=null →
    // bypass character bonus, chỉ dùng base elementMultiplier(skill, boss). Nếu
    // skill.element=null (basic attack) HOẶC boss.element=null → identity
    // (`elementMultiplier` returns 1.0 khi either side null).
    const charElementState =
      char.primaryElement && char.spiritualRootGrade
        ? {
            primaryElement: char.primaryElement as ElementKey,
            secondaryElements: char.secondaryElements as ElementKey[],
          }
        : null;
    const playerElementMul = characterSkillElementBonus(
      charElementState,
      skillElement,
      def.element ?? null,
    );
    // Phase 44.2 — Pet BOSS combat bonus. Symmetric với combat.service.ts DUNGEON path.
    // context=BOSS, cap 8% (per PetDef.contributionCap BOSS). Identity (1.0) khi
    // DI thiếu hoặc chưa equip pet. Fail-soft: try-catch → fallback 1.0.
    let petCombatMul = 1.0;
    if (this.petSnapshot) {
      try {
        const petBonus = await this.petSnapshot.getCombatBonus(char.id, 'BOSS');
        if (petBonus && charAtk > 0) {
          const capFrac = petBonus.damageContributionCapPercent / 100;
          const rawFrac = petBonus.petStats.atk / charAtk;
          const contribFrac = Math.max(0, Math.min(rawFrac, capFrac));
          petCombatMul = 1 + contribFrac;
        }
      } catch {
        petCombatMul = 1.0;
      }
    }
    const damage = Math.max(
      1,
      Math.round(
        raw * playerElementMul * talentElementMul * buffElementMul * petCombatMul,
      ),
    );
    this.cooldowns.set(char.id, now);

    const healRatio = skill.selfHealRatio;

    let defeated = false;
    let bossHpAfter = boss.currentHp;
    let myDamageTotal = 0n;
    let myRank = 0;
    let rewardSlices: DefeatedRewardSlice[] | null = null;
    let postHp = char.hp;
    let postMp = char.mp;
    let postStamina = char.stamina;

    await this.prisma.$transaction(async (tx) => {
      // Trừ resource character bằng atomic decrement — guard để không
      // overwrite cập nhật concurrent (potion / cron / dungeon).
      // bloodCost = 0 cho skill không phải huyết tế.
      const upd = await tx.character.updateMany({
        where: {
          id: char.id,
          mp: { gte: skill.mpCost },
          stamina: { gte: BOSS_STAMINA_PER_HIT },
          hp: { gt: bloodCost },
        },
        data: {
          mp: { decrement: skill.mpCost },
          stamina: { decrement: BOSS_STAMINA_PER_HIT },
          hp: { decrement: bloodCost },
        },
      });
      if (upd.count === 0) {
        // Lý do nào? Đọc lại để phân biệt.
        const cur = await tx.character.findUnique({
          where: { id: char.id },
          select: { mp: true, stamina: true, hp: true },
        });
        if (!cur) throw new BossError('NO_CHARACTER');
        if (cur.mp < skill.mpCost) throw new BossError('MP_LOW');
        if (cur.stamina < BOSS_STAMINA_PER_HIT) throw new BossError('STAMINA_LOW');
        throw new BossError('HP_LOW');
      }

      // Apply heal (huyền thuỷ): re-read fresh để clamp đúng tại hpMax.
      if (healRatio > 0) {
        const cur = await tx.character.findUnique({
          where: { id: char.id },
          select: { hp: true, hpMax: true },
        });
        if (cur) {
          const healAmt = Math.floor((cur.hpMax + bodyBonus.hpMax) * healRatio);
          const target = Math.min(cur.hpMax + bodyBonus.hpMax, cur.hp + healAmt);
          await tx.character.update({
            where: { id: char.id },
            data: { hp: target },
          });
        }
      }

      // Đọc lại stat sau atomic update để trả response chính xác.
      const post = await tx.character.findUnique({
        where: { id: char.id },
        select: { hp: true, mp: true, stamina: true },
      });
      if (post) {
        postHp = post.hp;
        postMp = post.mp;
        postStamina = post.stamina;
      }

      // Trừ HP boss — cap tại 0, atomic.
      const dmg = BigInt(damage);
      const bossUpd = await tx.worldBoss.updateMany({
        where: { id: boss.id, status: BossStatus.ACTIVE, currentHp: { gt: 0n } },
        data: { currentHp: { decrement: dmg } },
      });
      if (bossUpd.count === 0) throw new BossError('BOSS_DEFEATED');

      // Re-fetch để lấy currentHp sau decrement.
      const bossNow = await tx.worldBoss.findUnique({ where: { id: boss.id } });
      if (!bossNow) throw new BossError('NO_ACTIVE_BOSS');
      bossHpAfter = bossNow.currentHp;

      // Cộng dồn damage character (idempotent).
      const dmgRow = await tx.bossDamage.upsert({
        where: { bossId_characterId: { bossId: boss.id, characterId: char.id } },
        create: {
          bossId: boss.id,
          characterId: char.id,
          characterName: char.name,
          totalDamage: dmg,
          hits: 1,
          lastHitAt: new Date(),
        },
        update: {
          totalDamage: { increment: dmg },
          hits: { increment: 1 },
          lastHitAt: new Date(),
        },
      });
      myDamageTotal = dmgRow.totalDamage;

      // Nếu bossHp <= 0 → mark DEFEATED, distribute rewards trong tx,
      // và cập nhật bossHpAfter về 0 để response/broadcast nhất quán.
      if (bossHpAfter <= 0n) {
        const flip = await tx.worldBoss.updateMany({
          where: { id: boss.id, status: BossStatus.ACTIVE },
          data: {
            status: BossStatus.DEFEATED,
            defeatedAt: new Date(),
            currentHp: 0n,
          },
        });
        if (flip.count > 0) {
          defeated = true;
          bossHpAfter = 0n;
          rewardSlices = await this.distributeRewards(tx, boss.id, def);
        }
      }
    });

    // Đảm bảo response không bao giờ trả HP âm ngay cả khi tx flip
    // không xảy ra (tránh hiển thị `-95 / 120000` ở client).
    if (bossHpAfter < 0n) bossHpAfter = 0n;

    // Tính rank ngoài tx (read-only, không cần lock).
    const rankRow = await this.prisma.bossDamage.count({
      where: { bossId: boss.id, totalDamage: { gt: myDamageTotal } },
    });
    myRank = rankRow + 1;

    // Mission + Achievement tracking — mỗi lần hit thành công (dmg > 0) →
    // BOSS_HIT +1. Phase 11.10.C-2 wire trackEvent vào achievement bằng
    // cùng goalKind. Fail-soft: không throw nếu mission/achievement lỗi.
    try {
      await this.missions.track(char.id, 'BOSS_HIT', 1);
      if (this.achievements) {
        await this.achievements.trackEvent(char.id, 'BOSS_HIT', 1);
      }
    } catch {
      // bỏ qua
    }

    // Re-emit state user + boss room.
    await this.refreshState(userId);
    void this.broadcastBossUpdate(boss.id, viewerOnlyHp(bossHpAfter));

    if (defeated) {
      const slicesSnapshot: DefeatedRewardSlice[] = rewardSlices ?? [];
      void this.broadcastBossDefeated(boss.id, slicesSnapshot);
      // Phase 26.2 — Drop Economy V2 WORLD_BOSS material grant. Chạy
      // SAU tx attack vì `DropEconomyService.rollAndGrant` mở `$transaction`
      // riêng (cap upsert + grant atomic). Mỗi slice nhận 1 lần roll.
      // Fail-soft — không break boss reward path.
      if (slicesSnapshot.length > 0) {
        void this.applyWorldBossDropEconomy(slicesSnapshot, boss.id, def);
      }
      // Phase 33.3 — Story V2 boss_defeat step tracking, fail-soft, additive.
      // Track cho attacker (người đánh hit cuối). Boss key = targetId.
      if (this.phase33Story) {
        try {
          await this.phase33Story.track(char.id, 'boss_defeat', 'boss', boss.bossKey, 1);
        } catch {
          // fail-soft: Story V2 không break boss flow.
        }
      }
    }

    return {
      result: {
        damageDealt: damage.toString(),
        bossHp: bossHpAfter.toString(),
        bossMaxHp: boss.maxHp.toString(),
        defeated,
        myDamageTotal: myDamageTotal.toString(),
        myRank,
        charHp: postHp,
        charMp: postMp,
        charStamina: postStamina,
      },
      defeated: rewardSlices,
    };
  }

  // ---------- private helpers ----------

  private async heartbeat(): Promise<void> {
    // In-process re-entry guard. Nếu previous tick còn đang chạy
    // (DB chậm hoặc distributeRewardsExpired đang grant reward), skip
    // tick mới thay vì chạy song song trên cùng process. Cross-process
    // (multi-pod) race vẫn cần partial unique index DB-level — xem
    // `spawnNew` P2002 catch + migration
    // `20260523000000_phase_12_6_world_boss_region_key`.
    if (this.heartbeatRunning) {
      this.logger.debug('boss heartbeat: previous tick still in-flight, skip');
      return;
    }
    this.heartbeatRunning = true;
    try {
      // Phase 12.6 — iterate distinct regions có ≥1 boss spawn-able trong
      // catalog (`bossSpawnRegions()` returns sorted distinct region keys).
      // Mỗi region 1 spawn slot (partial unique
      // `WorldBoss_status_region_active_unique`). Heartbeat sequential:
      // expire-if-overdue → spawn-if-empty per region. KHÔNG parallelize
      // qua `Promise.all` vì distributeRewardsExpired() ghi ledger
      // multi-row trong tx + spawn DB write có thể mâu thuẫn nếu cùng
      // region 2× tick concurrent (re-entry guard handle); sequential
      // là an toàn nhất.
      for (const regionKey of bossSpawnRegions()) {
        await this.heartbeatRegion(regionKey);
      }
    } finally {
      this.heartbeatRunning = false;
    }
  }

  /**
   * Phase 12.6 — heartbeat tick cho 1 region cụ thể. Tách ra cho test +
   * future BullMQ worker per-region rouchg.
   *   1. Expire boss ACTIVE quá hạn → distribute 60% rewards.
   *   2. Spawn boss mới nếu region trống slot và đã qua respawn delay
   *      tính từ boss DEFEATED/EXPIRED gần nhất TRONG REGION ĐÓ.
   *
   * KHÔNG throw — log + swallow per region để 1 region lỗi không break
   * heartbeat tick toàn hệ thống.
   */
  private async heartbeatRegion(regionKey: string): Promise<void> {
    try {
      // 1) Expire boss quá hạn trong region.
      const active = await this.prisma.worldBoss.findFirst({
        where: { status: BossStatus.ACTIVE, regionKey },
        orderBy: { spawnedAt: 'desc' },
      });
      if (active && active.expiresAt.getTime() <= Date.now()) {
        const def = bossByKey(active.bossKey);
        const flip = await this.prisma.worldBoss.updateMany({
          where: { id: active.id, status: BossStatus.ACTIVE },
          data: { status: BossStatus.EXPIRED, defeatedAt: new Date() },
        });
        if (flip.count > 0 && def) {
          // Cũng phân thưởng giảm cho người tham gia (60% pool).
          const slices = await this.distributeRewardsExpired(active.id, def);
          this.realtime.broadcast('boss:end', {
            id: active.id,
            status: 'EXPIRED',
            rewards: slices,
          });
          // Phase 26.2 — Drop Economy V2 WORLD_BOSS expired path.
          if (slices.length > 0) {
            void this.applyWorldBossDropEconomy(slices, active.id, def);
          }
        }
      }

      // 2) Spawn boss mới nếu region trống slot và đã đủ delay.
      const stillActive = await this.prisma.worldBoss.findFirst({
        where: { status: BossStatus.ACTIVE, regionKey },
      });
      if (stillActive) return;

      // Phase 13.0 §B — Scheduled boss check. Nếu region đang có 1 BOSS
      // LiveOpsEvent ACTIVE (slot window): force-spawn đúng `bossKey` của
      // event đó, BYPASS auto-rotate + respawn delay. Slot dedup: nếu đã
      // có WorldBoss với cùng (regionKey, bossKey) `spawnedAt >= slotStart`
      // → no-op (slot đã trigger lần này). Sau slot end, fall-through về
      // logic auto-rotate cũ.
      const scheduled = activeScheduledBossEventForRegion(
        regionKey,
        new Date(),
      );
      if (scheduled) {
        const slotAlreadySpawned = await this.prisma.worldBoss.findFirst({
          where: {
            regionKey,
            bossKey: scheduled.ev.bossKey,
            spawnedAt: { gte: scheduled.slotStart },
          },
          select: { id: true },
        });
        if (slotAlreadySpawned) {
          // Slot này đã spawn 1 lần (boss có thể đang ACTIVE vẫn được lọc
          // bởi check `stillActive` ở trên; hoặc DEFEATED/EXPIRED — không
          // respawn cùng slot). No-op.
          return;
        }
        const def = bossByKey(scheduled.ev.bossKey!);
        if (def) {
          // Force-spawn scheduled boss bất kể respawn delay (slot prio
          // hơn rotation cooldown). spawnSource log qua AdminAuditLog
          // tránh schema migration — tracking via `bossKey + spawnedAt
          // >= slotStart` đủ cho slot dedup.
          await this.spawnNew({ def, regionKey });
          return;
        }
        this.logger.warn(
          `boss heartbeat: scheduled event ${scheduled.ev.key} bossKey=${scheduled.ev.bossKey} không tồn tại trong BOSSES catalog, fall-through rotation`,
        );
      }

      const last = await this.prisma.worldBoss.findFirst({
        where: {
          status: { in: [BossStatus.DEFEATED, BossStatus.EXPIRED] },
          regionKey,
        },
        orderBy: { spawnedAt: 'desc' },
      });
      if (last) {
        const since = Date.now() - (last.defeatedAt ?? last.spawnedAt).getTime();
        if (since < BOSS_RESPAWN_DELAY_MS) return;
      }
      // spawnNew có thể return null nếu race với heartbeat khác (multi-pod)
      // — partial unique index P2002 → no-op. Heartbeat không cần action
      // thêm. Cross-region: race winner ở region X không block region Y.
      await this.spawnNew({ regionKey });
    } catch (e) {
      this.logger.error(`boss heartbeat region ${regionKey}`, e as Error);
    }
  }

  /**
   * Phase 12.6 — spawn boss mới trong 1 region cụ thể (atomic, race-safe
   * qua partial unique `WorldBoss_status_region_active_unique`).
   *
   *   - `overrides.def` (admin force) → dùng def đó; def.regionKey phải
   *     match `overrides.regionKey` (caller validate trước).
   *   - Auto-rotate (heartbeat): pick boss từ catalog filtered by
   *     `regionKey` (`bossesByRegion`); rotate theo total spawn count
   *     trong region đó (count `regionKey` filter để rotate per-region
   *     deterministic — region trẻ chưa spawn lần nào → boss[0] of
   *     region; region đã spawn N lần → boss[N % regionBosses.length]).
   *
   * Return null + log warn khi P2002 (race lost) — caller (heartbeat
   * loop) no-op, caller (adminSpawn) throw `BOSS_ALREADY_ACTIVE`.
   * Return null + log warn khi region không có boss spawn-able (catalog
   * empty cho region đó — tránh insert NULL bossKey).
   */
  private async spawnNew(
    overrides: { def?: BossDef; level?: number; regionKey?: string } = {},
  ): Promise<{
    id: string;
    bossKey: string;
    level: number;
    maxHp: bigint;
    regionKey: string;
  } | null> {
    const regionKey = overrides.regionKey ?? WORLD_BOSS_REGION_KEY;
    let def: BossDef;
    let level: number;
    if (overrides.def) {
      def = overrides.def;
      level = overrides.level ?? 1;
    } else {
      // Phase 12.6 — pick từ region catalog. `bossesByRegion('world')`
      // map sang catalog regionKey=null (legacy world boss).
      const candidates = bossesByRegion(regionKey);
      if (candidates.length === 0) {
        this.logger.warn(
          `boss spawnNew: catalog không có boss cho region ${regionKey}, no-op`,
        );
        return null;
      }
      // Auto-rotate per region: count spawn IN THIS REGION → rotate idx.
      // Level: ưu tiên override (admin truyền), fallback auto-rotate (region
      // age tier).
      const totalSpawnedInRegion = await this.prisma.worldBoss.count({
        where: { regionKey },
      });
      def = candidates[totalSpawnedInRegion % candidates.length];
      level =
        overrides.level ??
        Math.min(10, 1 + Math.floor(totalSpawnedInRegion / candidates.length));
    }
    const maxHp = BigInt(def.baseMaxHp) * BigInt(level);

    // Check for existing ACTIVE boss in region before create (defense-in-depth
    // with partial unique index). Prevents race when index missing/disabled.
    const existing = await this.prisma.worldBoss.findFirst({
      where: { status: BossStatus.ACTIVE, regionKey },
    });
    if (existing) {
      this.logger.warn(
        `boss spawnNew region=${regionKey}: ACTIVE boss already exists (id=${existing.id}), no-op`,
      );
      return null;
    }

    let created;
    try {
      created = await this.prisma.worldBoss.create({
        data: {
          bossKey: def.key,
          name: def.name,
          level,
          maxHp,
          currentHp: maxHp,
          status: BossStatus.ACTIVE,
          spawnedAt: new Date(),
          expiresAt: new Date(Date.now() + BOSS_LIFETIME_MS),
          rewardTotal: BigInt(def.baseRewardLinhThach) * BigInt(level),
          regionKey,
        },
      });
    } catch (e) {
      // Concurrency phase 2 + Phase 12.6 — boss spawn cron auto race
      // backstop. Partial unique index
      // `WorldBoss_status_region_active_unique` (migration
      // `20260523000000_phase_12_6_world_boss_region_key`) enforces ≤1
      // ACTIVE per region. Concurrent heartbeat() (multi-pod hoặc
      // in-process re-entry, hoặc cross-region paralell race với
      // adminSpawn cùng regionKey) lost race → Prisma `P2002`. Benign
      // no-op: region đó đã có ACTIVE boss; return null cho caller
      // (heartbeat — no-op; adminSpawn — throw `BOSS_ALREADY_ACTIVE`).
      // Cross-region race KHÔNG conflict (region X spawn không block
      // region Y).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        this.logger.warn(
          `boss spawnNew region=${regionKey}: race lost on partial unique index (another ACTIVE boss exists in region), no-op`,
        );
        return null;
      }
      throw e;
    }

    this.realtime.broadcast('boss:spawn', {
      id: created.id,
      bossKey: created.bossKey,
      name: created.name,
      level: created.level,
      maxHp: created.maxHp.toString(),
      currentHp: created.currentHp.toString(),
      spawnedAt: created.spawnedAt.toISOString(),
      expiresAt: created.expiresAt.toISOString(),
      regionKey: created.regionKey,
    });
    // Phase 44.1 — Web Push trigger: boss spawn → notify mọi user opt-in
    // `bossSpawnEnabled`. Fail-soft trong WebPushTriggerService (gateway lỗi,
    // env off, prefs disabled, cooldown 5 phút → log + no-op, KHÔNG crash).
    if (this.webPushTrigger) {
      this.webPushTrigger
        .notifyBossSpawn({
          id: created.id,
          bossKey: created.bossKey,
          name: created.name,
          level: created.level,
          regionKey: created.regionKey,
        })
        .catch((e: unknown) =>
          this.logger.warn(
            `webPush.notifyBossSpawn failed: ${(e as Error).message}`,
          ),
        );
    }
    this.logger.log(
      `Boss spawn region=${created.regionKey}: ${created.name} Lv.${created.level} maxHp=${maxHp}`,
    );
    // Phase 44.1 — Web Push fan-out cho người chơi đã opt-in BOSS_SPAWN.
    // Fire-and-forget — push fail không được phá realtime broadcast hay
    // boss spawn flow. Dedupe key = `boss-<id>` đảm bảo cùng 1 spawn
    // không gửi push trùng nếu heartbeat re-fire.
    if (this.webPush) {
      void this.dispatchBossSpawnPush(created).catch((e) =>
        this.logger.warn(
          `boss spawn push fan-out failed region=${created.regionKey} bossId=${created.id}: ${(e as Error).message}`,
        ),
      );
    }
    return {
      id: created.id,
      bossKey: created.bossKey,
      level: created.level,
      maxHp,
      regionKey: created.regionKey,
    };
  }

  /**
   * Admin force-spawn 1 boss mới trong region cụ thể. Phase 12.6:
   * - `regionKey` optional → default 'world' (legacy world boss).
   * - Nếu đã có ACTIVE TRONG REGION ĐÓ và `force=false` → throw
   *   BOSS_ALREADY_ACTIVE. Force=true → expire ACTIVE region đó rồi
   *   spawn (KHÔNG ảnh hưởng region khác).
   * - Nếu `bossKey` truyền in: validate def.regionKey match regionKey
   *   (catalog null → 'world'); mismatch → throw INVALID_BOSS_KEY.
   *
   * Phase 13.1.C — Admin LiveOps Advanced Controls:
   * Ghi 2 audit row trong cùng action:
   *   1. `BOSS_SPAWN` (legacy, full spawn meta) — backwards-compat với
   *      mọi audit consumer hiện hữu.
   *   2. `ADMIN_FORCE_BOSS_SCHEDULE` (new) — admin tooling intent log với
   *      `scheduledEventKey` (lookup từ LiveOps catalog nếu bossKey +
   *      regionKey + spawnedAt match BOSS event đang active) + optional
   *      `reason` từ admin để gắn paper trail.
   * Cả 2 row được ghi atomic (cùng pattern dual-audit) — nếu boss create
   * thành công nhưng audit fail thì throw nguyên trạng.
   */
  async adminSpawn(
    actorId: string,
    opts: {
      bossKey?: string;
      level?: number;
      force?: boolean;
      regionKey?: string;
      reason?: string;
    } = {},
  ): Promise<{
    id: string;
    bossKey: string;
    level: number;
    maxHp: string;
    regionKey: string;
  }> {
    const level = opts.level ?? 1;
    if (!Number.isInteger(level) || level < 1 || level > 10) {
      throw new BossError('INVALID_LEVEL');
    }
    let def: BossDef | undefined;
    if (opts.bossKey) {
      def = bossByKey(opts.bossKey);
      if (!def) throw new BossError('INVALID_BOSS_KEY');
    }
    // Phase 12.6 — regionKey resolution: ưu tiên opts.regionKey explicit,
    // fallback derive từ def.regionKey (catalog null → 'world'), cuối cùng
    // default 'world' (auto-rotate world boss khi không chỉ định gì). Nếu
    // CẢ HAI explicit và def.regionKey mâu thuẫn → INVALID_BOSS_KEY.
    let regionKey: string;
    if (opts.regionKey) {
      regionKey = opts.regionKey;
      if (def) {
        const defRegionKey = def.regionKey ?? WORLD_BOSS_REGION_KEY;
        if (defRegionKey !== regionKey) {
          throw new BossError('INVALID_BOSS_KEY');
        }
      }
    } else if (def) {
      regionKey = def.regionKey ?? WORLD_BOSS_REGION_KEY;
    } else {
      regionKey = WORLD_BOSS_REGION_KEY;
    }

    const active = await this.prisma.worldBoss.findFirst({
      where: { status: BossStatus.ACTIVE, regionKey },
      orderBy: { spawnedAt: 'desc' },
    });
    // replacedBossId chỉ ghi vào audit khi force-expire thực sự diễn ra
    // (flip.count > 0). Trường hợp race với player kill boss giữa findFirst
    // và update → flip=0 → audit log không nói dối là admin đã thay boss đó.
    let replacedBossId: string | null = null;
    if (active) {
      if (!opts.force) throw new BossError('BOSS_ALREADY_ACTIVE');
      // Optimistic lock: chỉ flip ACTIVE → EXPIRED. Nếu giữa findFirst và đây
      // boss đã bị defeat (DEFEATED) bởi player thì skip — không ghi đè
      // historical record. updateMany với status=ACTIVE filter là cách
      // an toàn để tránh race condition này. Phase 12.6 — chỉ flip ACTIVE
      // trong region requested (regionKey filter); region khác KHÔNG bị
      // ảnh hưởng.
      const flip = await this.prisma.worldBoss.updateMany({
        where: { id: active.id, status: BossStatus.ACTIVE },
        data: { status: BossStatus.EXPIRED, defeatedAt: new Date() },
      });
      if (flip.count > 0) {
        replacedBossId = active.id;
        // Phát thưởng EXPIRED 60% pool cho người tham chiến — KHÔNG được
        // skip kể cả khi admin force, nếu không người chơi đã đầu tư
        // stamina/MP/thời gian sẽ mất trắng phần thưởng (Devin Review
        // #36 #3153247323). Khớp đúng pattern heartbeat() line 355-363.
        const activeDef = bossByKey(active.bossKey);
        if (activeDef) {
          const slices = await this.distributeRewardsExpired(active.id, activeDef);
          this.realtime.broadcast('boss:end', {
            id: active.id,
            status: 'EXPIRED',
            rewards: slices,
          });
          // Phase 26.2 — Drop Economy V2 WORLD_BOSS expired path (adminSpawn force).
          if (slices.length > 0) {
            void this.applyWorldBossDropEconomy(slices, active.id, activeDef);
          }
        } else {
          this.realtime.broadcast('boss:end', {
            id: active.id,
            status: BossStatus.EXPIRED,
          });
        }
      }
    }

    const spawned = await this.spawnNew({ def, level, regionKey });
    if (!spawned) {
      // Concurrency phase 2 + Phase 12.6 — race window between `force=true`
      // flip-EXPIRED and `worldBoss.create()`: parallel heartbeat() (cùng
      // region) spawned fresh ACTIVE in between. Partial unique index
      // rejected our create with P2002 → `spawnNew` returned null. Surface
      // as `BOSS_ALREADY_ACTIVE` so admin retries (force=true để
      // force-replace race winner). KHÔNG ghi audit log vì boss admin
      // yêu cầu thực ra chưa được tạo. Cũng catch case region không có
      // catalog boss spawn-able (defensive).
      throw new BossError('BOSS_ALREADY_ACTIVE');
    }
    // Phase 13.1.C — dual audit. Lookup scheduledEventKey nếu boss spawn
    // rơi đúng slot LiveOps BOSS event (cùng bossKey + regionKey + slot
    // window). Null nếu spawn ngoài lịch (admin pure force).
    const scheduledEvent = liveOpsEventForBossSpawn(
      spawned.bossKey,
      spawned.regionKey,
      new Date(),
    );
    const reason = opts.reason?.trim() || null;
    await this.prisma.adminAuditLog.createMany({
      data: [
        {
          actorUserId: actorId,
          action: 'BOSS_SPAWN',
          meta: {
            bossId: spawned.id,
            bossKey: spawned.bossKey,
            level: spawned.level,
            forced: !!opts.force,
            replacedBossId,
            regionKey: spawned.regionKey,
          } as Prisma.InputJsonValue,
        },
        {
          actorUserId: actorId,
          action: 'ADMIN_FORCE_BOSS_SCHEDULE',
          meta: {
            bossId: spawned.id,
            bossKey: spawned.bossKey,
            level: spawned.level,
            forced: !!opts.force,
            replacedBossId,
            regionKey: spawned.regionKey,
            scheduledEventKey: scheduledEvent?.key ?? null,
            reason,
          } as Prisma.InputJsonValue,
        },
      ],
    });
    return {
      id: spawned.id,
      bossKey: spawned.bossKey,
      level: spawned.level,
      maxHp: spawned.maxHp.toString(),
      regionKey: spawned.regionKey,
    };
  }

  /**
   * Phase 44.1 — Fan-out push 'BOSS_SPAWN' tới user opt-in. Recency 7 ngày
   * chặn dead-cold accounts. WebPushService cooldown 5 phút + dedupeKey
   * `boss-<id>` đảm bảo không gửi trùng cùng 1 spawn ngay cả nếu heartbeat
   * race re-call.
   */
  private async dispatchBossSpawnPush(boss: {
    id: string;
    bossKey: string;
    name: string;
    level: number;
    regionKey: string;
  }): Promise<void> {
    if (!this.webPush) return;
    const userIds = await this.webPush.findEligibleUserIds('BOSS_SPAWN', {
      recentSinceMs: 7 * 24 * 60 * 60_000,
      limit: 5_000,
    });
    if (userIds.length === 0) return;
    const dedupeKey = `boss-${boss.id}`;
    await this.webPush.broadcastToUsers(userIds, 'BOSS_SPAWN', {
      title: `Yêu thú xuất hiện: ${boss.name}`,
      body: `Lv.${boss.level} đã xuất hiện ở vùng ${boss.regionKey}. Tham chiến ngay để giành thưởng.`,
      url: `/world-boss?region=${encodeURIComponent(boss.regionKey)}`,
      tag: dedupeKey,
      dedupeKey,
    });
  }

  private async broadcastBossUpdate(bossId: string, _hp: bigint): Promise<void> {
    const boss = await this.prisma.worldBoss.findUnique({ where: { id: bossId } });
    if (!boss) return;
    const top = await this.prisma.bossDamage.findMany({
      where: { bossId },
      orderBy: [{ totalDamage: 'desc' }, { lastHitAt: 'asc' }],
      take: 5,
    });
    this.realtime.broadcast('boss:update', {
      id: boss.id,
      currentHp: boss.currentHp.toString(),
      maxHp: boss.maxHp.toString(),
      status: boss.status,
      leaderboardTop5: top.map((r, i) => ({
        rank: i + 1,
        characterId: r.characterId,
        characterName: r.characterName,
        damage: r.totalDamage.toString(),
        hits: r.hits,
      })),
    });
  }

  private async broadcastBossDefeated(
    bossId: string,
    rewards: DefeatedRewardSlice[],
  ): Promise<void> {
    const boss = await this.prisma.worldBoss.findUnique({ where: { id: bossId } });
    if (!boss) return;
    this.realtime.broadcast('boss:defeated', {
      id: boss.id,
      bossKey: boss.bossKey,
      name: boss.name,
      level: boss.level,
      defeatedAt: boss.defeatedAt?.toISOString() ?? new Date().toISOString(),
      rewards,
    });
  }

  /**
   * Phân thưởng khi boss chết (full pool).
   * - Top 1: 50% linh thạch + 1 item từ topDropPool
   * - Top 2-3: 15% mỗi + 1 item từ midDropPool
   * - Top 4-10: chia đều 18%
   * - Top 11+: chia đều 2%
   * - Cộng cho mọi người EXP nhỏ + thông báo.
   */
  private async distributeRewards(
    tx: Prisma.TransactionClient,
    bossId: string,
    def: BossDef,
  ): Promise<DefeatedRewardSlice[]> {
    const boss = await tx.worldBoss.findUnique({ where: { id: bossId } });
    if (!boss) return [];

    // Phase 15.3.A — LiveOps BOSS_REWARD_BOOST max-only compose. Pull
    // outside per-character loop — multiplier là server-state-wide,
    // không theo char. Fail-soft: lỗi service → multiplier 1.0 (no-op),
    // boss reward grant tiếp tục bình thường.
    const bossLiveOpsBoost = await this.pickBossRewardBoost();
    const all = await tx.bossDamage.findMany({
      where: { bossId },
      orderBy: [{ totalDamage: 'desc' }, { lastHitAt: 'asc' }],
    });
    if (all.length === 0) return [];

    const total = boss.rewardTotal;
    const top1 = (total * 50n) / 100n;
    const top23Each = (total * 15n) / 100n;
    const top410Pool = (total * 18n) / 100n;
    const restPool = (total * 2n) / 100n;

    const rest = all.length > 10 ? all.length - 10 : 0;
    const top410n = Math.min(7, Math.max(0, all.length - 3));
    const top410Each = top410n > 0 ? top410Pool / BigInt(top410n) : 0n;
    const restEach = rest > 0 ? restPool / BigInt(rest) : 0n;

    const slices: DefeatedRewardSlice[] = [];
    for (let i = 0; i < all.length; i++) {
      const row = all[i];
      const rank = i + 1;
      let linhThach = 0n;
      const items: { itemKey: string; qty: number }[] = [];
      if (rank === 1) {
        linhThach = top1;
        const drop = pickRandom(def.topDropPool);
        if (drop) items.push({ itemKey: drop, qty: 1 });
      } else if (rank === 2 || rank === 3) {
        linhThach = top23Each;
        const drop = pickRandom(def.midDropPool);
        if (drop) items.push({ itemKey: drop, qty: 1 });
      } else if (rank <= 10) {
        linhThach = top410Each;
      } else {
        linhThach = restEach;
      }
      // Phase 11.X.G — Talent `dropMul` (drop_bonus passive) wire vào boss
      // reward share. Catalog `talent_phuc_van` (drop_bonus +20%) v.v. áp dụng
      // additive multiplicatively cho linhThach reward distribution. Service
      // không inject (legacy DI) → identity (no bonus). Apply BEFORE ghi
      // ledger để CurrencyLedger reflects the actual delta granted.
      const linhThachBeforeTalent = linhThach;
      if (this.talents && linhThach > 0n) {
        const talentMods = await this.talents.getMods(row.characterId);
        if (talentMods.dropMul !== 1) {
          // BigInt × float compute: convert via Number rồi BigInt floor.
          // Range safe — max boss rewardTotal ~ 10M (BigInt(baseRewardLinhThach)
          // × BigInt(level)) within Number safe integer range (2^53).
          linhThach = BigInt(
            Math.floor(Number(linhThach) * talentMods.dropMul),
          );
        }
      }
      // Phase 15.3.A — LiveOps `BOSS_REWARD_BOOST` runtime wire.
      // Apply AFTER talent dropMul so multiplier compose multiplicatively
      // — player benefits from BOTH talent + event simultaneously. Cap
      // ≤ 2.0 server-side. Apply BEFORE ledger so audit reflects actual
      // grant. Attribution / rank logic không đổi — boost chỉ scale linh
      // thạch share, `top1 / top23 / top410 / restPool` ratios giữ yên.
      const linhThachBeforeLiveOps = linhThach;
      if (linhThach > 0n && bossLiveOpsBoost.multiplier > 1.0) {
        linhThach = BigInt(
          Math.floor(Number(linhThach) * bossLiveOpsBoost.multiplier),
        );
      }
      const liveOpsBonusDelta = linhThach - linhThachBeforeLiveOps;
      void linhThachBeforeTalent;

      // Trao thưởng character (atomic + ghi ledger).
      if (linhThach > 0n) {
        await this.currency.applyTx(tx, {
          characterId: row.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: linhThach,
          reason: 'BOSS_REWARD',
          refType: 'WorldBoss',
          refId: bossId,
          meta: {
            rank,
            damage: row.totalDamage.toString(),
            bossKey: def.key,
            liveOpsBoost:
              bossLiveOpsBoost.multiplier > 1.0
                ? {
                    multiplier: bossLiveOpsBoost.multiplier,
                    bonusLinhThach: liveOpsBonusDelta.toString(),
                    eventKey: bossLiveOpsBoost.eventKey,
                  }
                : null,
          },
        });
      }
      if (items.length > 0) {
        await this.inventory.grantTx(tx, row.characterId, items, {
          reason: 'BOSS_REWARD',
          refType: 'WorldBoss',
          refId: bossId,
          extra: {
            rank,
            bossKey: def.key,
            liveOpsBoost:
              bossLiveOpsBoost.multiplier > 1.0
                ? {
                    multiplier: bossLiveOpsBoost.multiplier,
                    eventKey: bossLiveOpsBoost.eventKey,
                  }
                : null,
          },
        });
      }
      // Phase 13.0 §C — Reward hooks (title + buff). Inside cùng tx với
      // currency/inventory grant để rollback toàn bộ nếu service throw.
      // Defensive: skip nếu DI không inject (legacy test harness, optional).
      // 1. Title participation: mọi character damage boss → unlock
      //    `achievement_first_boss` (idempotent qua composite UNIQUE).
      // 2. Title event Huyết Nguyệt: nếu boss spawn từ
      //    event_huyet_nguyet_weekend slot → thêm `event_huyet_nguyet_2026`.
      // 3. Buff top damage: rank 1 → apply `event_double_drop` (1h).
      if (this.titles) {
        try {
          await this.titles.unlockTitleTx(
            tx,
            row.characterId,
            'achievement_first_boss',
            'achievement',
          );
        } catch (e) {
          // Idempotent: composite unique race → log + continue, không
          // rollback grant currency/items vì title chỉ là cosmetic +
          // unlock đã có từ trước (TitleService throws TITLE_NOT_OWNED
          // khi equip — unlockTitleTx safe).
          this.logger.warn(
            `boss reward hook: unlock achievement_first_boss for char ${row.characterId} failed: ${(e as Error).message}`,
          );
        }
        const ev = liveOpsEventForBossSpawn(
          def.key,
          boss.regionKey,
          boss.spawnedAt,
        );
        if (ev?.key === 'event_huyet_nguyet_weekend') {
          try {
            await this.titles.unlockTitleTx(
              tx,
              row.characterId,
              'event_huyet_nguyet_2026',
              'event',
            );
          } catch (e) {
            this.logger.warn(
              `boss reward hook: unlock event_huyet_nguyet_2026 for char ${row.characterId} failed: ${(e as Error).message}`,
            );
          }
        }
      }
      if (this.buffs && rank === 1) {
        try {
          await this.buffs.applyBuffTx(
            tx,
            row.characterId,
            'event_double_drop',
            'event',
          );
        } catch (e) {
          this.logger.warn(
            `boss reward hook: apply event_double_drop for char ${row.characterId} failed: ${(e as Error).message}`,
          );
        }
      }
      // Phase 13.1.A — Sect War contribution hooks. Mọi participant nhận
      // `boss_participation`; rank 1 thêm `boss_top_damage` bonus. Source
      // ID composite `bossId:characterId` đảm bảo idempotency cùng boss
      // không cộng 2 lần (nếu distributeRewards retry / replay).
      if (this.sectWar) {
        try {
          await this.sectWar.addContributionTx(tx, {
            characterId: row.characterId,
            activityKey: 'boss_participation',
            sourceId: `${bossId}:${row.characterId}`,
          });
        } catch (e) {
          this.logger.warn(
            `boss reward hook: sect-war boss_participation for char ${row.characterId} failed: ${(e as Error).message}`,
          );
        }
        if (rank === 1) {
          try {
            await this.sectWar.addContributionTx(tx, {
              characterId: row.characterId,
              activityKey: 'boss_top_damage',
              sourceId: `${bossId}:${row.characterId}`,
            });
          } catch (e) {
            this.logger.warn(
              `boss reward hook: sect-war boss_top_damage for char ${row.characterId} failed: ${(e as Error).message}`,
            );
          }
        }
      }

      // Phase 14.0.A — Sect Territory influence hook. Cùng pattern sect-war
      // (mọi participant `boss_participation`; rank 1 thêm `boss_top_damage`
      // bonus). RegionKey từ `boss.regionKey` ở Prisma (legacy `'world'`
      // skip vì không phải MAP_REGIONS region). Idempotent qua composite
      // UNIQUE — sourceId `${bossId}:${row.characterId}`.
      if (this.territory && boss.regionKey && boss.regionKey !== 'world') {
        try {
          await this.territory.addInfluenceTx(tx, {
            characterId: row.characterId,
            regionKey: boss.regionKey,
            sourceKey: 'boss_participation',
            sourceId: `${bossId}:${row.characterId}`,
          });
        } catch (e) {
          this.logger.warn(
            `boss reward hook: territory boss_participation for char ${row.characterId} failed: ${(e as Error).message}`,
          );
        }
        if (rank === 1) {
          try {
            await this.territory.addInfluenceTx(tx, {
              characterId: row.characterId,
              regionKey: boss.regionKey,
              sourceKey: 'boss_top_damage',
              sourceId: `${bossId}:${row.characterId}`,
            });
          } catch (e) {
            this.logger.warn(
              `boss reward hook: territory boss_top_damage for char ${row.characterId} failed: ${(e as Error).message}`,
            );
          }
        }
      }
      slices.push({
        rank,
        characterId: row.characterId,
        characterName: row.characterName,
        damage: row.totalDamage.toString(),
        linhThach: linhThach.toString(),
        items,
      });
    }
    return slices;
  }

  /**
   * Phase 26.2 — Drop Economy V2 WORLD_BOSS material grant. Chạy SAU
   * `distributeRewards` (linh thạch + items legacy) đã commit. Mỗi
   * reward slice nhận 1-2 lần roll material drop (`rank === 1` được
   * +1 roll). WeeklyMaterialCap enforce qua DropEconomyService —
   * top-tier ARTIFACT_CRAFT chỉ rơi đúng `maxWeeklyQty` mỗi tuần.
   *
   * Fail-soft: lỗi trong roll/grant chỉ log, không throw — boss
   * reward path KHÔNG được rollback vì drop economy chỉ là bonus.
   */
  private async applyWorldBossDropEconomy(
    slices: DefeatedRewardSlice[],
    bossId: string,
    def: BossDef,
  ): Promise<void> {
    if (!this.dropEconomy) return;
    try {
      const sourceOrder = realmByKey(def.recommendedRealm)?.order ?? 0;
      const sourceTier = realmOrderToMaterialTier(sourceOrder);
      // World boss = WORLD_BOSS dropSource. `inferDropMonsterType` defensive
      // — nếu boss def thiếu `monsterType` (legacy) fallback NORMAL, nhưng
      // chúng ta override hard sang `'WORLD_BOSS'` cho roll context.
      const legacyType = inferDropMonsterType(def.monsterType ?? 'BOSS');
      void legacyType;
      const charIds = slices.map((s) => s.characterId);
      if (charIds.length === 0) return;
      const chars = await this.prisma.character.findMany({
        where: { id: { in: charIds } },
        select: { id: true, realmKey: true },
      });
      const realmKeyById = new Map(chars.map((c) => [c.id, c.realmKey]));
      for (const slice of slices) {
        const playerRealmKey = realmKeyById.get(slice.characterId);
        if (!playerRealmKey) continue;
        const playerOrder = realmByKey(playerRealmKey)?.order ?? 0;
        // Top-rank được roll thêm 1 lần để chênh lệch thưởng vs rest;
        // weekly cap vẫn enforce qua catalog rule.
        const rollCount = slice.rank === 1 ? 2 : 1;
        try {
          await this.dropEconomy.rollAndGrant(slice.characterId, {
            playerRealmOrder: playerOrder,
            sourceTier,
            monsterType: 'WORLD_BOSS',
            source: 'WORLD_BOSS',
            rollCount,
            refType: 'WorldBoss',
            refId: bossId,
          });
        } catch (e) {
          this.logger.warn(
            `boss drop economy WORLD_BOSS bossId=${bossId} char=${slice.characterId} failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`applyWorldBossDropEconomy bossId=${bossId} failed: ${(e as Error).message}`);
    }
  }

  /**
   * Phase 15.3.A — helper read max-only `BOSS_REWARD_BOOST` modifier.
   * Cap clamp ≤ 2.0. No event → `{ multiplier: 1.0, eventKey: '' }`.
   * Fail-soft trả identity nếu LiveOps service unavailable.
   */
  private async pickBossRewardBoost(
    now: Date = new Date(),
  ): Promise<{ multiplier: number; eventKey: string }> {
    if (!this.liveOpsEvents) return { multiplier: 1.0, eventKey: '' };
    try {
      const modifiers = await this.liveOpsEvents.getRuntimeModifiers(now);
      let bestMul = 1.0;
      let bestKey = '';
      for (const m of modifiers) {
        if (m.type !== 'BOSS_REWARD_BOOST') continue;
        const clamped = clampLiveOpsMultiplier('BOSS_REWARD_BOOST', m.multiplier);
        if (clamped > bestMul) {
          bestMul = clamped;
          bestKey = m.eventKey;
        }
      }
      return { multiplier: bestMul, eventKey: bestKey };
    } catch {
      return { multiplier: 1.0, eventKey: '' };
    }
  }

  /** Phân thưởng giảm khi boss EXPIRED — dùng 60% reward pool. */
  private async distributeRewardsExpired(
    bossId: string,
    def: BossDef,
  ): Promise<DefeatedRewardSlice[]> {
    return this.prisma.$transaction(async (tx) => {
      const boss = await tx.worldBoss.findUnique({ where: { id: bossId } });
      if (!boss) return [];
      // Giảm reward pool còn 60% và thực hiện cùng logic.
      // Hack đơn giản: tạm sửa rewardTotal trong tx.
      const reduced = (boss.rewardTotal * 60n) / 100n;
      await tx.worldBoss.update({
        where: { id: bossId },
        data: { rewardTotal: reduced },
      });
      const slices = await this.distributeRewards(tx, bossId, def);
      // Khôi phục để audit (không cần thiết nhưng giữ cho rõ).
      await tx.worldBoss.update({
        where: { id: bossId },
        data: { rewardTotal: boss.rewardTotal },
      });
      return slices;
    });
  }

  private async toView(
    boss: {
      id: string;
      bossKey: string;
      name: string;
      level: number;
      maxHp: bigint;
      currentHp: bigint;
      status: BossStatus;
      spawnedAt: Date;
      expiresAt: Date;
      regionKey: string;
    },
    viewerCharId: string | null,
  ): Promise<BossView> {
    const def = bossByKey(boss.bossKey);
    const top = await this.prisma.bossDamage.findMany({
      where: { bossId: boss.id },
      orderBy: [{ totalDamage: 'desc' }, { lastHitAt: 'asc' }],
      take: LEADERBOARD_SIZE,
    });
    const participants = await this.prisma.bossDamage.count({ where: { bossId: boss.id } });

    let myDamage: string | null = null;
    let myRank: number | null = null;
    if (viewerCharId) {
      const mine = await this.prisma.bossDamage.findUnique({
        where: { bossId_characterId: { bossId: boss.id, characterId: viewerCharId } },
      });
      if (mine) {
        myDamage = mine.totalDamage.toString();
        const ahead = await this.prisma.bossDamage.count({
          where: { bossId: boss.id, totalDamage: { gt: mine.totalDamage } },
        });
        myRank = ahead + 1;
      }
    }

    const cooldown = viewerCharId ? this.cooldowns.get(viewerCharId) ?? 0 : 0;
    const cdNext = cooldown + BOSS_ATTACK_COOLDOWN_MS;
    const cooldownUntil =
      viewerCharId && cdNext > Date.now() ? new Date(cdNext).toISOString() : null;

    return {
      id: boss.id,
      bossKey: boss.bossKey,
      name: boss.name,
      description: def?.description ?? '',
      level: boss.level,
      maxHp: boss.maxHp.toString(),
      currentHp: boss.currentHp.toString(),
      status: boss.status,
      spawnedAt: boss.spawnedAt.toISOString(),
      expiresAt: boss.expiresAt.toISOString(),
      regionKey: boss.regionKey,
      leaderboard: top.map((r, i) => ({
        rank: i + 1,
        characterId: r.characterId,
        characterName: r.characterName,
        damage: r.totalDamage.toString(),
        hits: r.hits,
      })),
      myDamage,
      myRank,
      participants,
      cooldownUntil,
      topDropPool: def?.topDropPool ?? [],
      midDropPool: def?.midDropPool ?? [],
      elementProfile: def
        ? getBossElementProfile(def)
        : {
            element: null,
            weaknessElement: null,
            resistElements: [],
            rewardElementHint: null,
          },
    };
  }

  private async resolveSectKey(sectId: string | null): Promise<SectKey | null> {
    if (!sectId) return null;
    const sect = await this.prisma.sect.findUnique({ where: { id: sectId } });
    if (!sect) return null;
    if (sect.name === 'Thanh Vân Môn') return 'thanh_van';
    if (sect.name === 'Huyền Thuỷ Cung') return 'huyen_thuy';
    if (sect.name === 'Tu La Tông') return 'tu_la';
    return null;
  }

  private async refreshState(userId: string): Promise<void> {
    const state = await this.chars.findByUser(userId);
    if (state) this.realtime.emitToUser(userId, 'state:update', state);
  }
}

/**
 * **Phase 14.1.A** — `rng` optional. Default `Math.random` cho backward
 * compat (toàn bộ call site cũ vẫn dùng Math.random). Caller deterministic
 * inject seeded RNG (qua `createSeededRng(seed).next` ở `@xuantoi/shared`)
 * cho Arena prep / replay verify.
 */
function pickRandom<T>(
  arr: readonly T[],
  rng: () => number = Math.random,
): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

function viewerOnlyHp(hp: bigint): bigint {
  return hp;
}
