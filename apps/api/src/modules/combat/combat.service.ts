import { Injectable, Optional } from '@nestjs/common';
import {
  CurrencyKind,
  Prisma,
  EncounterStatus,
  type Character,
  type Encounter,
} from '@prisma/client';
import {
  DUNGEONS,
  ELEMENT_LOG_AMPLIFY_THRESHOLD,
  ELEMENT_LOG_DAMPEN_THRESHOLD,
  SPIRITUAL_ROOT_GRADES,
  STAMINA_PER_ACTION,
  SKILL_BASIC_ATTACK,
  SKILL_TAG_DOT_DAMAGE_RATIO,
  SKILL_TAG_DOT_TURNS,
  SKILL_TAG_SHIELD_HP_RATIO,
  characterSkillElementBonus,
  composeMonsterElementalResist,
  computeBodyStatBonus,
  describeElementMatch,
  dungeonByKey,
  elementMultiplier,
  getDungeonElementProfile,
  getSpiritualRootGradeDef,
  getBodyRealmByKey,
  getTalentDef,
  itemByKey,
  monsterByKey,
  rollDamage,
  rollDungeonLoot,
  rollMonsterLoot,
  simulateActiveTalent,
  skillByKey,
  type DungeonDef,
  type DungeonElementProfile,
  type ElementKey,
  type EffectiveSkill,
  type MonsterDef,
  type SectKey,
  type SkillDef,
  type SkillTag,
  type SpiritualRootGrade,
  type TalentDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CharacterSkillService } from '../character/character-skill.service';
import { CurrencyService } from '../character/currency.service';
import { AchievementService } from '../character/achievement.service';
import { TalentService } from '../character/talent.service';
import { BuffService } from '../character/buff.service';
import { TitleService } from '../character/title.service';
import { methodStatBonusFor } from '../character/cultivation-method.service';
import { CultivationMethodV2Service } from '../character/cultivation-method-v2.service';
import { ArtifactV2Service } from '../character/artifact-v2.service';
import { aggregateEquippedMethods } from '@xuantoi/shared';
import { InventoryService } from '../inventory/inventory.service';
import { MissionService } from '../mission/mission.service';
import { QuestService } from '../quest/quest.service';
import { DropEconomyService } from '../economy/drop-economy.service';
import {
  inferDropMonsterType,
  realmByKey,
  realmOrderToMaterialTier,
} from '@xuantoi/shared';
import { composePassiveTalentMods, type PassiveTalentMods } from '@xuantoi/shared';
import { composeBuffMods, type BuffMods } from '@xuantoi/shared';
import { composeTitleMods, type TitleMods } from '@xuantoi/shared';

/**
 * Phase 14.2.C — Active DOT (burn / poison) trên monster hiện tại. Set khi
 * player cast skill có `tags: ['DOT']`. Tick `perTurnDamage` HP mỗi lượt
 * (tổng `turnsLeft = SKILL_TAG_DOT_TURNS`). Reset khi chuyển sang monster
 * mới (state.monsterIndex thay đổi).
 *
 * Single-active model — re-cast DOT skill (cùng hoặc khác hệ) sẽ overwrite
 * `monsterDot` (refresh turnsLeft + perTurnDamage). Đơn giản hoá so với
 * stack — đủ cho Phase 14.2.C foundation.
 */
export interface EncounterMonsterDot {
  /** Source skill key (vd `moc_doc_van_truong`). */
  skillKey: string;
  /** Element của DOT — log line + cycle-aware UI. */
  element: ElementKey;
  /** Sát thương mỗi lượt (đã cap qua dial DOT_DAMAGE_RATIO). */
  perTurnDamage: number;
  /** Số lượt còn lại — decrement sau mỗi player action tick. */
  turnsLeft: number;
}

export interface EncounterState {
  monsterIndex: number;
  monsterHp: number;
  /**
   * Phase 14.2.C — Active DOT trên monster hiện tại. `undefined` (legacy)
   * = không có DOT. Reset khi `monsterIndex` thay đổi.
   */
  monsterDot?: EncounterMonsterDot;
}

export interface EncounterLogLine {
  side: 'player' | 'monster' | 'system';
  text: string;
  ts: number;
}

export interface EncounterRewardLoot {
  itemKey: string;
  qty: number;
  itemName: string;
  quality: string;
}

export interface EncounterView {
  id: string;
  dungeon: DungeonDef;
  status: EncounterStatus;
  monster: MonsterDef | null;
  monsterHp: number;
  monsterIndex: number;
  log: EncounterLogLine[];
  reward: { exp: string; linhThach: string; loot: EncounterRewardLoot[] } | null;
}

interface ActionInput {
  skillKey?: string;
}

/**
 * Phase 11.3.C narrowing helper — Prisma trả về `string | null` cho
 * `spiritualRootGrade`, runtime cần check khớp catalog
 * `SPIRITUAL_ROOT_GRADES` trước khi gọi `getSpiritualRootGradeDef` để
 * tránh throw. Legacy character (`null`) → return false → multiplier 1.0.
 */
function isValidSpiritualRootGrade(
  grade: string | null,
): grade is SpiritualRootGrade {
  return grade !== null && (SPIRITUAL_ROOT_GRADES as readonly string[]).includes(grade);
}

class CombatError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'DUNGEON_NOT_FOUND'
      | 'DUNGEON_DAILY_LIMIT_REACHED'
      | 'STAMINA_LOW'
      | 'ALREADY_IN_FIGHT'
      | 'ENCOUNTER_NOT_FOUND'
      | 'ENCOUNTER_ENDED'
      | 'SKILL_NOT_USABLE'
      | 'MP_LOW'
      | 'CONTROLLED'
      | 'TALENT_NOT_LEARNED'
      | 'TALENT_NOT_ACTIVE'
      | 'TALENT_ON_COOLDOWN',
  ) {
    super(code);
  }
}

/**
 * Phase 12.2.A — Trả về offset của một IANA timezone tại một thời điểm cụ
 * thể, đơn vị phút. UTC → 0, Asia/Ho_Chi_Minh → 420 (UTC+07, không DST).
 * Mirror helper `tzOffsetMinutes` trong `mission.service.ts` để không tạo
 * cyclical import (mission depends combat catalog meta).
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = fmt.formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/**
 * Phase 12.2.A — Trả về Date đại diện 00:00 local của ngày hiện tại theo
 * `tz`, dạng UTC. Dùng để bracket Prisma `count({ createdAt: { gte } })`
 * khi enforce `DungeonDef.dailyLimit`. Mặc định `Asia/Ho_Chi_Minh` (UTC+07,
 * không DST) — match `MISSION_RESET_TZ` zone.
 */
export function startOfLocalDay(now: Date, tz: string): Date {
  const offMs = tzOffsetMinutes(tz, now) * 60_000;
  const local = new Date(now.getTime() + offMs);
  const startLocalUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(startLocalUtc - offMs);
}

/**
 * Phase 12.2.A — Đọc env `MISSION_RESET_TZ` để xác định timezone của mốc
 * reset DAILY (mirror `mission.service.ts`). Mặc định `Asia/Ho_Chi_Minh`.
 * Combat reuse zone này để keep daily-bucket invariant đồng nhất giữa
 * dungeon dailyLimit / mission DAILY / daily-login streak.
 */
function getCombatResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

@Injectable()
export class CombatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly chars: CharacterService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
    private readonly missions: MissionService,
    @Optional() private readonly characterSkill?: CharacterSkillService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly talents?: TalentService,
    @Optional() private readonly buffs?: BuffService,
    @Optional() private readonly titles?: TitleService,
    @Optional() private readonly quests?: QuestService,
    @Optional() private readonly dropEconomy?: DropEconomyService,
    // Phase 26.3 — Cultivation Method V2. Optional; null → mul 1.0 identity.
    @Optional() private readonly cultivationMethodV2?: CultivationMethodV2Service,
    // Phase 26.4 — Artifact / Pháp Bảo V2 stat snapshot. Optional → identity
    // baseline (atkFlat/defFlat/...=0; atkPercent/defPercent=0) khi DI thiếu
    // hoặc character chưa equip V2 artifact.
    @Optional() private readonly artifactV2?: ArtifactV2Service,
  ) {}

  /**
   * Phase 14.2.D — return DUNGEONS catalog kèm Ngũ Hành identity profile
   * (dominantElement, recommendedCounterElement, rewardElementHint) cho
   * mỗi entry. FE dùng để render badge + recommended counter + reward
   * hint mà không cần re-derive client-side. Combat damage runtime
   * KHÔNG đọc elementProfile — chỉ là metadata UI.
   */
  listDungeons(): Array<DungeonDef & { elementProfile: DungeonElementProfile }> {
    return DUNGEONS.map((d) => ({
      ...d,
      elementProfile: getDungeonElementProfile(d),
    }));
  }

  async getActive(characterId: string): Promise<EncounterView | null> {
    const e = await this.prisma.encounter.findFirst({
      where: { characterId, status: EncounterStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    return e ? this.toView(e) : null;
  }

  async start(userId: string, dungeonKey: string): Promise<EncounterView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new CombatError('NO_CHARACTER');
    const dungeon = dungeonByKey(dungeonKey);
    if (!dungeon) throw new CombatError('DUNGEON_NOT_FOUND');

    // Phase 12.2.A — Enforce `DungeonDef.dailyLimit` server-side. Catalog
    // metadata (PR #397 Phase 10 PR-3 forward-compat) đến giờ chỉ được test
    // ở shared layer; runtime chưa gate → players grind vô hạn (trái với
    // BALANCE_MODEL.md §5.2). Đếm encounter row trong cửa sổ DAILY VN tz
    // (00:00 ICT → 00:00 ICT next day) — bao gồm cả status ABANDONED/LOST/
    // WON để slot daily đã "tiêu" không refund khi player rút sớm.
    if (typeof dungeon.dailyLimit === 'number' && dungeon.dailyLimit > 0) {
      const tz = getCombatResetTz();
      const dayStart = startOfLocalDay(new Date(), tz);
      const todayCount = await this.prisma.encounter.count({
        where: {
          characterId: char.id,
          dungeonKey,
          createdAt: { gte: dayStart },
        },
      });
      if (todayCount >= dungeon.dailyLimit) {
        throw new CombatError('DUNGEON_DAILY_LIMIT_REACHED');
      }
    }

    if (char.stamina < dungeon.staminaEntry) throw new CombatError('STAMINA_LOW');

    const existing = await this.prisma.encounter.findFirst({
      where: { characterId: char.id, status: EncounterStatus.ACTIVE },
    });
    if (existing) throw new CombatError('ALREADY_IN_FIGHT');

    const firstMonster = monsterByKey(dungeon.monsters[0]);
    if (!firstMonster) throw new CombatError('DUNGEON_NOT_FOUND');

    await this.prisma.character.update({
      where: { id: char.id },
      data: { stamina: char.stamina - dungeon.staminaEntry },
    });

    const state: EncounterState = { monsterIndex: 0, monsterHp: firstMonster.hp };
    const log: EncounterLogLine[] = [
      {
        side: 'system',
        text: `Đạo hữu vào ${dungeon.name}, đối diện ${firstMonster.name} (Lv.${firstMonster.level}).`,
        ts: Date.now(),
      },
    ];

    const enc = await this.prisma.encounter.create({
      data: {
        characterId: char.id,
        dungeonKey,
        state: state as unknown as Prisma.InputJsonValue,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });

    const charState = await this.chars.findByUser(userId);
    if (charState) this.realtime.emitToUser(userId, 'state:update', charState);
    return this.toView(enc);
  }

  async action(userId: string, encounterId: string, input: ActionInput): Promise<EncounterView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new CombatError('NO_CHARACTER');
    if (char.stamina < STAMINA_PER_ACTION) throw new CombatError('STAMINA_LOW');

    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!enc || enc.characterId !== char.id) throw new CombatError('ENCOUNTER_NOT_FOUND');
    if (enc.status !== EncounterStatus.ACTIVE) throw new CombatError('ENCOUNTER_ENDED');

    const dungeon = dungeonByKey(enc.dungeonKey);
    if (!dungeon) throw new CombatError('DUNGEON_NOT_FOUND');
    const state = enc.state as unknown as EncounterState;
    const monster = monsterByKey(dungeon.monsters[state.monsterIndex]);
    if (!monster) throw new CombatError('DUNGEON_NOT_FOUND');

    // Phase 11.7.D — Active talent fallback: nếu skillKey không phải SkillDef
    // nhưng là active TalentDef → route sang flow riêng. `skillByKey` null +
    // `getTalentDef` non-null → talent path. Validate ownership qua
    // `TalentService.listLearned` + MP cost + execute via simulateActiveTalent.
    if (input.skillKey) {
      const directSkill = skillByKey(input.skillKey);
      if (!directSkill) {
        const talentDef = getTalentDef(input.skillKey);
        if (talentDef) {
          if (talentDef.type !== 'active' || !talentDef.activeEffect) {
            throw new CombatError('TALENT_NOT_ACTIVE');
          }
          return this.actionViaActiveTalent(
            userId,
            encounterId,
            char,
            enc,
            dungeon,
            state,
            monster,
            talentDef,
          );
        }
      }
    }

    const sectKey = await this.resolveSectKey(char.sectId);
    const skill: SkillDef = input.skillKey
      ? skillByKey(input.skillKey) ?? SKILL_BASIC_ATTACK
      : SKILL_BASIC_ATTACK;
    if (skill.sect !== null && skill.sect !== sectKey) {
      throw new CombatError('SKILL_NOT_USABLE');
    }

    // Phase 11.2.B — compose mastery effect. Legacy character (no
    // CharacterSkill row) → masteryLevel = 0 → no bonus. Service không
    // injected (legacy DI) → fallback baseline.
    const effective: EffectiveSkill = this.characterSkill
      ? await this.characterSkill.getEffectiveSkillFor(char.id, skill)
      : baselineEffective(skill);

    let charHp = char.hp;
    let charMp = char.mp;
    if (charMp < effective.mpCost) throw new CombatError('MP_LOW');

    const equip = await this.inventory.equipBonus(char.id);
    const bodyBonus = computeBodyStatBonus(
      getBodyRealmByKey(char.bodyRealmKey)?.order ?? 0,
      char.bodyStage,
    );
    // Phase 11.3.C — Linh căn statBonusPercent wire vào atk/def.
    // Legacy character (spiritualRootGrade=null) → statMul = 1.0.
    const statMul = isValidSpiritualRootGrade(char.spiritualRootGrade)
      ? 1 + getSpiritualRootGradeDef(char.spiritualRootGrade).statBonusPercent / 100
      : 1.0;
    // Phase 11.7.C — Talent passive mods compose. Legacy character (no
    // talent learned) → all multipliers identity (1.0). Service không
    // injected (legacy DI hoặc test fixture) → fallback identity baseline.
    const talentMods: PassiveTalentMods = this.talents
      ? await this.talents.getMods(char.id)
      : composePassiveTalentMods([]);
    // Phase 11.8.C — Buff/debuff stat mods compose. No active buffs or service
    // not injected → identity baseline (all mul = 1.0, all flat = 0).
    const buffMods: BuffMods = this.buffs
      ? await this.buffs.getMods(char.id)
      : composeBuffMods([]);
    // Phase 11.X.O — Buff control (root/stun/silence) block player action.
    // `controlTurnsMax > 0` khi có active control debuff trong DB
    // (`debuff_root_thuy` 3 turns, `debuff_stun_tho` 1 turn, `debuff_silence_kim`
    // 2 turns). Identity (0, no-op) khi service không injected hoặc không có
    // control debuff. Throw EARLY trước mọi state mutation: encounter status,
    // character HP/MP/stamina, ledger row đều không đụng tới. Player nhận lại
    // CombatError('CONTROLLED') và phải chờ debuff hết hạn (expiresAt sweep).
    if (buffMods.controlTurnsMax > 0) {
      throw new CombatError('CONTROLLED');
    }
    // Phase 11.9.C — Title flavor stat mods compose. No equipped title or
    // service không injected → identity baseline (atkMul=defMul=spiritMul=1).
    // Multiplicative compose với linh căn × talent × buff (Phase 11.3.C/11.7.C/11.8.C).
    // hpMaxMul/mpMaxMul KHÔNG wire ở đây — là stat cap modifier (defer
    // CharacterStatService.computeStats), không ảnh hưởng combat action.
    const titleMods: TitleMods = this.titles
      ? await this.titles.getMods(char.id)
      : composeTitleMods([]);
    // Phase 11.1.D — Cultivation method statBonus.atk/defPercent wire vào
    // effPower/effDef. Catalog huyen-grade `cuu_cuc_kim_cuong_quyet` (atk +5%,
    // def +12%) v.v. — trước đó `statBonus` được khai báo nhưng KHÔNG consume
    // runtime. Pure helper `methodStatBonusFor` legacy (key=null) → identity.
    // Pham starter `khai_thien_quyet` (0%) → identity. hpMaxMul/mpMaxMul là
    // stat cap (defer `CharacterStatService.computeStats`), KHÔNG wire ở đây.
    const methodStat = methodStatBonusFor(char.equippedCultivationMethodKey);
    // Phase 26.3 — Cultivation Method V2 atk/def bonus. Aggregate qua các
    // method đang equip (cap ở `METHOD_BONUS_CAPS`). Legacy character không
    // có V2 row equipped → snapshot=[] → bonus=0 (identity).
    let methodV2Atk = 1.0;
    let methodV2Def = 1.0;
    if (this.cultivationMethodV2) {
      try {
        const snapshot = await this.cultivationMethodV2.getEquippedSnapshot(char.id);
        const v2 = aggregateEquippedMethods(snapshot);
        methodV2Atk = 1 + v2.atkPercent / 100;
        methodV2Def = 1 + v2.defPercent / 100;
      } catch {
        methodV2Atk = 1.0;
        methodV2Def = 1.0;
      }
    }
    // Phase 26.4 — Artifact / Pháp Bảo V2 stat snapshot (flat atk/def/spirit
    // + speed/crit %). Identity (0) baseline khi DI thiếu hoặc character chưa
    // equip V2 artifact. Snapshot đã clamp ở `aggregateArtifactV2Snapshot` →
    // không thể vượt `ARTIFACT_BONUS_CAPS`. % bonuses (cultivation/alchemy
    // /drop/luck) wire ở các pipeline tương ứng (cultivation/alchemy/loot),
    // KHÔNG cộng vào atk/def combat tránh double-dip.
    let artifactV2Atk = 0;
    let artifactV2Def = 0;
    let artifactV2Spirit = 0;
    if (this.artifactV2) {
      try {
        const snap = await this.artifactV2.getEquippedSnapshot(char.id);
        artifactV2Atk = snap.atk;
        artifactV2Def = snap.def;
        artifactV2Spirit = snap.spirit;
      } catch {
        artifactV2Atk = 0;
        artifactV2Def = 0;
        artifactV2Spirit = 0;
      }
    }
    const effPower =
      (char.power + bodyBonus.power + equip.atk + artifactV2Atk) *
      statMul *
      talentMods.atkMul *
      buffMods.atkMul *
      titleMods.atkMul *
      methodStat.atkMul *
      methodV2Atk;
    const effDef =
      (equip.def + bodyBonus.def + artifactV2Def) *
      statMul *
      talentMods.defMul *
      buffMods.defMul *
      titleMods.defMul *
      methodStat.defMul *
      methodV2Def;
    // `artifactV2Spirit` is composed later in spirit-based formulas if
    // needed (defense stat for boss damage reduction). Reserved for future
    // wiring; suppress unused warning by referencing once.
    void artifactV2Spirit;

    const log: EncounterLogLine[] = [
      ...((enc.log as unknown as EncounterLogLine[]) ?? []),
    ];

    // Phase 11.3.B — Linh căn / Ngũ Hành element wire.
    // characterSkillElementBonus = elementMultiplier(skill,target) + character
    // primary +0.10 / secondary +0.05 nếu skill cùng hệ. Legacy character
    // (primaryElement=null) → bypass character bonus, chỉ dùng base multiplier.
    const charElementState =
      char.primaryElement && char.spiritualRootGrade
        ? {
            primaryElement: char.primaryElement as ElementKey,
            secondaryElements: char.secondaryElements as ElementKey[],
          }
        : null;
    const playerElementMul = characterSkillElementBonus(
      charElementState,
      skill.element ?? null,
      monster.element ?? null,
    );
    // Phase 11.7.C — Talent damage_bonus theo element. Compound multiplicative
    // với element bonus (Linh căn) — talent passive ngộ đạo theo hệ.
    const skillElement = skill.element ?? null;
    const talentElementMul =
      skillElement !== null
        ? talentMods.damageBonusByElement.get(skillElement) ?? 1
        : 1;
    // Phase 11.8.C — Buff damage_bonus theo element. Compound multiplicative
    // với talent + linh căn element bonus.
    const buffElementMul =
      skillElement !== null
        ? buffMods.damageBonusByElement.get(skillElement) ?? 1
        : 1;

    // Phase 14.2.A — Elemental Combat Foundation layer (additive bonus).
    // Compose:
    //   monsterResist = composeMonsterElementalResist(monster.elementalResist, skill.element)
    //   equipBonus    = await inventory.equipElementalAtkBonus(charId, skill.element)
    //   phase142Mul   = monsterResist × (1 + equipBonus)
    // Multiplicative với playerElementMul (Phase 11). KHÔNG override —
    // foundation layer phụ. Fallback `1.0` nếu skill vô hệ hoặc legacy
    // monster/equipment chưa khai báo. Pipeline KHÔNG re-apply base
    // multiplier (đã có trong playerElementMul).
    const monsterResistMul = composeMonsterElementalResist(
      monster.elementalResist,
      skillElement,
    );
    const equipElementBonus = await this.inventory.equipElementalAtkBonus(
      char.id,
      skillElement,
    );
    const phase142Mul = monsterResistMul * (1 + equipElementBonus);

    // — Player attack (Phase 11.2.B — atkScale + mpCost từ mastery curve)
    const dmgBase = rollDamage(effPower, monster.def, effective.atkScale);
    const dmg = Math.max(
      1,
      Math.round(
        dmgBase * playerElementMul * talentElementMul * buffElementMul * phase142Mul,
      ),
    );
    let monsterHp = state.monsterHp - dmg;
    charMp -= effective.mpCost;
    const effectiveHpMax = char.hpMax + bodyBonus.hpMax;
    if (skill.selfBloodCost > 0) {
      const lose = Math.max(1, Math.floor(effectiveHpMax * skill.selfBloodCost));
      charHp = Math.max(1, charHp - lose);
      log.push({ side: 'player', text: `Hi sinh ${lose} HP để dụng ${skill.name}.`, ts: Date.now() });
    }
    log.push({
      side: 'player',
      text: `Đạo hữu tung ${skill.name}, gây ${dmg} sát thương lên ${monster.name}.`,
      ts: Date.now(),
    });

    // Phase 14.2.C — Skill identity tag dispatch.
    // `skillTags` mặc định `[]` cho legacy skill (backward-compat).
    const skillTags: readonly SkillTag[] = skill.tags ?? [];
    // Tick existing monsterDot ngay sau player damage (trước khi check
    // monster chết) — DOT có thể kill monster nếu monsterHp đã thấp.
    let nextMonsterDot: EncounterMonsterDot | undefined =
      state.monsterDot && state.monsterDot.turnsLeft > 0 ? { ...state.monsterDot } : undefined;
    if (nextMonsterDot && monsterHp > 0) {
      const tickDmg = Math.max(0, Math.floor(nextMonsterDot.perTurnDamage));
      if (tickDmg > 0) {
        monsterHp = monsterHp - tickDmg;
        log.push({
          side: 'system',
          text: `${monster.name} chịu ${tickDmg} sát thương DOT (hệ ${nextMonsterDot.element}).`,
          ts: Date.now(),
        });
      }
      nextMonsterDot.turnsLeft -= 1;
      if (nextMonsterDot.turnsLeft <= 0) nextMonsterDot = undefined;
    }
    // Apply NEW DOT từ skill cast (overwrite single-active model). Snapshot
    // sát thương 1-shot tại lượt cast để DOT damage không drift theo buff.
    if (skillTags.includes('DOT') && skill.element != null && monsterHp > 0) {
      const perTurn = Math.max(1, Math.floor(dmg * SKILL_TAG_DOT_DAMAGE_RATIO));
      nextMonsterDot = {
        skillKey: skill.key,
        element: skill.element,
        perTurnDamage: perTurn,
        turnsLeft: SKILL_TAG_DOT_TURNS,
      };
      log.push({
        side: 'system',
        text: `${monster.name} bị nhiễm ${describeElementMatch(skill.element, null).vi || `hệ ${skill.element}`} — DOT ${perTurn} sát thương / lượt × ${SKILL_TAG_DOT_TURNS} lượt.`,
        ts: Date.now(),
      });
    }
    // Compute SHIELD absorb (same-turn) — sẽ apply trong monster reply
    // branch, KHÔNG persist sang turn sau (single-use).
    const skillShieldAbsorb =
      skillTags.includes('SHIELD') && skill.element != null
        ? Math.max(1, Math.floor(effectiveHpMax * SKILL_TAG_SHIELD_HP_RATIO))
        : 0;
    if (skillShieldAbsorb > 0) {
      log.push({
        side: 'system',
        text: `Khiên ${skill.element} dựng — sẵn sàng hấp thu ${skillShieldAbsorb} sát thương phản kích.`,
        ts: Date.now(),
      });
    }
    if (playerElementMul >= ELEMENT_LOG_AMPLIFY_THRESHOLD) {
      const matchVi = describeElementMatch(
        skill.element ?? null,
        (monster.element ?? null) as ElementKey | null,
      ).vi;
      log.push({
        side: 'system',
        text: matchVi
          ? `Ngũ Hành ${matchVi} — sát thương khuếch đại ×${playerElementMul.toFixed(2)}.`
          : `Ngũ Hành tương khắc/sinh — sát thương khuếch đại ×${playerElementMul.toFixed(2)}.`,
        ts: Date.now(),
      });
    } else if (playerElementMul <= ELEMENT_LOG_DAMPEN_THRESHOLD) {
      const matchVi = describeElementMatch(
        skill.element ?? null,
        (monster.element ?? null) as ElementKey | null,
      ).vi;
      log.push({
        side: 'system',
        text: matchVi
          ? `Ngũ Hành ${matchVi} — sát thương suy giảm ×${playerElementMul.toFixed(2)}.`
          : `Ngũ Hành lệch hệ — sát thương suy giảm ×${playerElementMul.toFixed(2)}.`,
        ts: Date.now(),
      });
    }
    // Phase 14.2.A — log monster resist / equipment bonus khi non-trivial
    // (resist < 0.95 hoặc equipBonus ≥ 0.05). Ngắn gọn, tách biệt với Phase
    // 11 chain log. Skip khi vô hệ skill (skillElement null) — đã neutral 1.0.
    if (skillElement !== null && monsterResistMul < 0.95) {
      log.push({
        side: 'system',
        text: `${monster.name} kháng hệ ${skillElement} ×${monsterResistMul.toFixed(2)}.`,
        ts: Date.now(),
      });
    }
    if (skillElement !== null && equipElementBonus >= 0.05) {
      log.push({
        side: 'system',
        text: `Trang bị tăng ${(equipElementBonus * 100).toFixed(0)}% sát thương hệ ${skillElement}.`,
        ts: Date.now(),
      });
    }

    let healLine: EncounterLogLine | null = null;
    if (skill.selfHealRatio > 0) {
      const heal = Math.floor(effectiveHpMax * skill.selfHealRatio);
      const before = charHp;
      charHp = Math.min(effectiveHpMax, charHp + heal);
      healLine = {
        side: 'player',
        text: `Linh khí xoay vần, hồi ${charHp - before} HP.`,
        ts: Date.now(),
      };
      log.push(healLine);
    }

    let nextStatus: EncounterStatus = EncounterStatus.ACTIVE;
    // Phase 14.2.C — `nextMonsterDot` được set ở DOT tick / new cast block ở
    // trên. Đính kèm vào nextState ngay từ đầu, sẽ bị reset ở nhánh monster
    // chết (chuyển monster mới hoặc WON).
    let nextState: EncounterState = { ...state, monsterHp, monsterDot: nextMonsterDot };
    let reward: EncounterView['reward'] = null;
    let expGain = 0n;
    let linhThachGain = 0n;

    if (monsterHp <= 0) {
      // Phase 11.7.C — Talent expMul (exp_bonus) + dropMul (drop_bonus) wire.
      // Floor để giữ BigInt deterministic, mul = 1 → identity (no change).
      const expDropEff = Math.max(0, Math.floor(monster.expDrop * talentMods.expMul));
      const linhThachDropEff = Math.max(
        0,
        Math.floor(monster.linhThachDrop * talentMods.dropMul),
      );
      log.push({
        side: 'system',
        text: `${monster.name} đổ xuống — đắc thủ ${expDropEff} EXP, ${linhThachDropEff} linh thạch.`,
        ts: Date.now(),
      });
      expGain += BigInt(expDropEff);
      linhThachGain += BigInt(linhThachDropEff);

      const nextIdx = state.monsterIndex + 1;
      if (nextIdx >= dungeon.monsters.length) {
        nextStatus = EncounterStatus.WON;
        log.push({
          side: 'system',
          text: `Chinh phục ${dungeon.name} thành công, đạo hữu thoát quan.`,
          ts: Date.now(),
        });
        // Phase 14.2.C — clear DOT khi WON (encounter kết thúc).
        nextState = { monsterIndex: nextIdx, monsterHp: 0 };
      } else {
        const nextMonster = monsterByKey(dungeon.monsters[nextIdx]);
        if (nextMonster) {
          // Phase 14.2.C — clear DOT khi chuyển monster mới (monster cũ
          // chết, DOT không carry-over).
          nextState = { monsterIndex: nextIdx, monsterHp: nextMonster.hp };
          log.push({
            side: 'system',
            text: `${nextMonster.name} (Lv.${nextMonster.level}) lao tới.`,
            ts: Date.now(),
          });
        }
      }
    } else {
      // — Monster counter-attack (Phase 11.3.B — element vs character primary)
      // Phase 11.8.C — spiritMul buff wire vào defense calc.
      // Phase 11.9.C — title spiritMul compose (mythic/legendary title flavor).
      // Phase 11.4.D — equip.spiritBonus (item base spirit + gem spirit socket
      // bonus + refine multiplier, đã compute ở `inventory.equipBonus`) cộng
      // additive vào base spirit, sau đó multiply với buff/title spiritMul.
      // Cùng pattern (base + flat) × multipliers như atk: line 232.
      // Phase 11.X.U — talent spiritMul wire. `composePassiveTalentMods`
      // produces `spiritMul` từ `kind=stat_mod, statTarget=spirit`. Hiện tại
      // catalog không có talent producer (talent_kim_thien_co=atk,
      // talent_thuy_long_an=hpMax, talent_tho_son_tuong=def, etc.) → identity
      // 1.0 → zero balance impact. Wire để pattern coverage nhất quán với
      // atkMul/defMul/damageBonusByElement/dropMul/expMul đã wire (#251) và
      // future-proof cho talent spirit producer (vd `talent_huyen_thuy_tam`
      // future +10% spirit). Service không inject (legacy DI/test fixture)
      // → talentMods=identity baseline → no-op.
      const effSpirit =
        (char.spirit + equip.spiritBonus) *
        talentMods.spiritMul *
        buffMods.spiritMul *
        titleMods.spiritMul;
      const replyBase = rollDamage(monster.atk, effSpirit + effPower * 0.3 + effDef, 1);
      const monsterElementMul = elementMultiplier(
        (monster.element ?? null) as ElementKey | null,
        (char.primaryElement ?? null) as ElementKey | null,
      );
      // Phase 11.8.C — damageReductionByElement buff wire: reduce incoming
      // damage from monster's element. Identity (1.0) khi no buff hoặc
      // monster element không match.
      const monsterElemKey = (monster.element ?? null) as ElementKey | null;
      const buffDmgReduction =
        monsterElemKey !== null
          ? buffMods.damageReductionByElement.get(monsterElemKey) ?? 1
          : 1;
      const reply = Math.max(
        1,
        Math.round(
          replyBase *
            monsterElementMul *
            buffDmgReduction *
            (1 - bodyBonus.bossDamageReduction),
        ),
      );
      log.push({
        side: 'monster',
        text: `${monster.name} phản kích, gây ${reply} sát thương.`,
        ts: Date.now(),
      });
      // Phase 11.X.V — Buff invuln (kind=invuln) override: nullify all
      // monster reply damage. Áp PRE-shield: invuln là "ignore all damage"
      // theo spec → không cần shield absorb tốn. Identity false → no-op
      // (hiện tại catalog chưa có producer cho `kind=invuln`, dành future
      // buff design). Pattern coverage nhất quán với cultivationBlocked
      // (#270) + control (#264) — boolean buff state gates damage path.
      if (buffMods.invulnActive) {
        log.push({
          side: 'system',
          text: `Bất tử — vô hiệu hóa toàn bộ sát thương phản kích.`,
          ts: Date.now(),
        });
      } else {
        // Phase 14.2.C — skill SHIELD absorb (single-use, same-turn) áp
        // TRƯỚC buff shield. Compose tuần tự: skill shield → buff shield →
        // remaining damage. Skill shield không persist sang turn sau.
        let remainingReply = reply;
        if (skillShieldAbsorb > 0) {
          const absorbedSkill = Math.min(skillShieldAbsorb, remainingReply);
          remainingReply -= absorbedSkill;
          if (absorbedSkill > 0) {
            log.push({
              side: 'system',
              text: `Khiên ${skill.element} hấp thu ${absorbedSkill} sát thương phản kích.`,
              ts: Date.now(),
            });
          }
        }
        // Phase 11.X.N — Buff shield (talent_shield_phong: 30% hpMax, etc.)
        // absorb monster reply damage. `shieldAbsorb = floor(char.hpMax *
        // buffMods.shieldHpMaxRatio)` re-applied mỗi turn còn buff active
        // (per-turn refresh aura model). Buff hết hạn (`expiresAt` sweep) →
        // shieldHpMaxRatio = 0 → no absorb. Identity (0, no-op) khi service
        // không injected hoặc no shield buff. KHÔNG mutate buff DB row —
        // duration-based, không depletion-based.
        const shieldAbsorb = Math.floor(effectiveHpMax * buffMods.shieldHpMaxRatio);
        const absorbed = Math.min(shieldAbsorb, remainingReply);
        const netReply = remainingReply - absorbed;
        if (absorbed > 0) {
          log.push({
            side: 'system',
            text: `Khiên hấp thu ${absorbed} sát thương.`,
            ts: Date.now(),
          });
        }
        charHp -= netReply;
        if (charHp <= 0) {
          nextStatus = EncounterStatus.LOST;
          charHp = 1;
          log.push({
            side: 'system',
            text: `Đạo hữu rơi vào hôn mê, đan điền tổn thương — phải hồi phục mới có thể chiến tiếp.`,
            ts: Date.now(),
          });
        }
      }
    }

    // Phase 11.X.M — Buff DOT (debuff_burn_hoa, debuff_poison_moc) per-turn HP
    // loss. Áp end-of-turn cho encounter còn ACTIVE (đã không WON/LOST do
    // player attack / monster reply). `dotPerTickFlat` đã tính theo stack
    // (composeBuffMods stack handler: value × stacks). Service không inject
    // hoặc no dot debuff active → identity (0, no-op).
    // Phase 11.X.V — invulnActive cũng skip DOT damage (spec: "ignore all
    // damage"). Identity false → DOT vẫn áp. Future-proof.
    const dotDmg = Math.floor(buffMods.dotPerTickFlat);
    if (dotDmg > 0 && nextStatus === EncounterStatus.ACTIVE && !buffMods.invulnActive) {
      charHp = Math.max(0, charHp - dotDmg);
      log.push({
        side: 'system',
        text: `Độc/bỏng phát tác — chịu ${dotDmg} sát thương DOT.`,
        ts: Date.now(),
      });
      if (charHp <= 0) {
        nextStatus = EncounterStatus.LOST;
        charHp = 1;
        log.push({
          side: 'system',
          text: `Đạo hữu hôn mê do độc/bỏng — chiến đấu thất bại.`,
          ts: Date.now(),
        });
      }
    }

    // Persist encounter & character.
    await this.prisma.encounter.update({
      where: { id: enc.id },
      data: {
        status: nextStatus,
        state: nextState as unknown as Prisma.InputJsonValue,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });

    const newStamina = Math.max(0, char.stamina - STAMINA_PER_ACTION);
    const updateChar: Prisma.CharacterUpdateInput = {
      hp: charHp,
      mp: charMp,
      stamina: newStamina,
    };
    if (expGain > 0n) updateChar.exp = { increment: expGain };

    // Bao trong tx để character.update + ledger row + talent cooldown
    // tick cùng commit/rollback.
    await this.prisma.$transaction(async (tx) => {
      await tx.character.update({ where: { id: char.id }, data: updateChar });
      if (linhThachGain > 0n) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: linhThachGain,
          reason: 'COMBAT_LOOT',
          refType: 'Encounter',
          refId: enc.id,
          meta: {
            dungeonKey: dungeon.key,
            status: nextStatus,
          },
        });
      }
      // Phase 11.7.E — decrement talent active cooldown sau mỗi action
      // skill flow. Active talent KHÔNG cast turn này vẫn tick down.
      if (this.talents) {
        await this.talents.decrementAllCooldowns(tx, char.id);
      }
    });

    const lootView: EncounterRewardLoot[] = [];
    if (nextStatus === EncounterStatus.WON) {
      // Phase 12.4 — ưu tiên monster.lootTable (boss/elite override)
      const monsterLoot = rollMonsterLoot(monster.key, 2);
      const loot = monsterLoot.length > 0 ? monsterLoot : rollDungeonLoot(dungeon.key, 2);
      if (loot.length > 0) {
        await this.inventory.grant(char.id, loot, {
          reason: 'COMBAT_LOOT',
          refType: 'Encounter',
          refId: enc.id,
          extra: { dungeonKey: dungeon.key },
        });
        for (const l of loot) {
          const def = itemByKey(l.itemKey);
          if (!def) continue;
          lootView.push({
            itemKey: l.itemKey,
            qty: l.qty,
            itemName: def.name,
            quality: def.quality,
          });
        }
        log.push({
          side: 'system',
          text: `Đắc thủ chiến lợi: ${lootView
            .map((l) => `${l.itemName} ×${l.qty}`)
            .join(', ')}.`,
          ts: Date.now(),
        });
        // Cập nhật log lần nữa với dòng loot.
        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: { log: log as unknown as Prisma.InputJsonValue },
        });
      }

      // Phase 26.2 — Drop Economy V2 material grant. Chạy SONG SONG với
      // lootTable cũ (không thay thế). Source = NORMAL_MONSTER / ELITE /
      // BOSS theo monster type; sourceTier = realmOrderToMaterialTier
      // (dungeon.recommendedRealm.order). effectiveDropTier =
      // min(playerTier, sourceTier) chống farm endgame ở map thấp.
      if (this.dropEconomy) {
        try {
          const playerOrder =
            realmByKey(char.realmKey)?.order ?? 0;
          const sourceOrder =
            realmByKey(dungeon.recommendedRealm)?.order ?? playerOrder;
          const sourceTier = realmOrderToMaterialTier(sourceOrder);
          const monsterType = inferDropMonsterType(monster.monsterType);
          const source =
            monsterType === 'BOSS'
              ? 'BOSS'
              : monsterType === 'ELITE'
                ? 'ELITE'
                : 'NORMAL_MONSTER';
          const dropMaterials = await this.dropEconomy.rollAndGrant(char.id, {
            playerRealmOrder: playerOrder,
            sourceTier,
            monsterType,
            source,
            refType: 'Encounter',
            refId: enc.id,
          });
          for (const dm of dropMaterials) {
            const def = itemByKey(dm.itemKey);
            if (!def) continue;
            lootView.push({
              itemKey: dm.itemKey,
              qty: dm.qty,
              itemName: def.name,
              quality: def.quality,
            });
          }
          if (dropMaterials.length > 0) {
            log.push({
              side: 'system',
              text: `Phát hiện nguyên liệu: ${dropMaterials
                .map((d) => {
                  const def = itemByKey(d.itemKey);
                  return `${def?.name ?? d.itemKey} ×${d.qty}`;
                })
                .join(', ')}.`,
              ts: Date.now(),
            });
            await this.prisma.encounter.update({
              where: { id: enc.id },
              data: { log: log as unknown as Prisma.InputJsonValue },
            });
          }
        } catch {
          // fail-soft: drop economy lỗi không break combat flow (mirror
          // legacy lootTable grant). Anomaly scanner sẽ phát hiện qua
          // ledger gap.
        }
      }
    }

    if (nextStatus === EncounterStatus.WON || nextStatus === EncounterStatus.LOST) {
      reward = {
        exp: expGain.toString(),
        linhThach: linhThachGain.toString(),
        loot: lootView,
      };
    }

    // Mission + Achievement tracking — dựa trên transition. Một turn có thể
    // vừa kill monster vừa (nếu là quái cuối) clear dungeon. Không throw nếu
    // mission/achievement lỗi (Phase 11.10.C-2 wire trackEvent vào achievement
    // bằng cùng goalKind với mission — fail-soft).
    try {
      if (monsterHp <= 0) {
        await this.missions.track(char.id, 'KILL_MONSTER', 1);
        if (this.achievements) {
          await this.achievements.trackEvent(char.id, 'KILL_MONSTER', 1);
        }
        // Phase 12 Story PR-2 + PR-6 — quest kill step tracking, fail-soft.
        // Track monster.key (real catalog) **và** monster.questTargetIds[*]
        // (placeholder ánh xạ vào quest targetId trừu tượng như 'son_thu').
        if (this.quests) {
          const trackIds = new Set<string>([monster.key]);
          for (const id of monster.questTargetIds ?? []) trackIds.add(id);
          for (const id of trackIds) {
            await this.quests.track(char.id, 'kill', 'monster', id, 1);
          }
        }
      }
      if (nextStatus === EncounterStatus.WON) {
        await this.missions.track(char.id, 'CLEAR_DUNGEON', 1);
        if (this.achievements) {
          await this.achievements.trackEvent(char.id, 'CLEAR_DUNGEON', 1);
        }
      }
    } catch {
      // bỏ qua
    }

    const charState = await this.chars.findByUser(userId);
    if (charState) this.realtime.emitToUser(userId, 'state:update', charState);

    const finalEnc = await this.prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } });
    const view = this.toView(finalEnc);
    view.reward = reward;
    return view;
  }

  /**
   * Phase 11.7.D — Active talent flow trong combat. Gọi từ {@link action} khi
   * `input.skillKey` resolve sang `getTalentDef()` (active type) thay vì
   * `skillByKey()`.
   *
   * Server-authoritative: validate ownership qua `TalentService.listLearned`
   * (reject nếu chưa học) + MP cost từ `activeEffect.mpCost` (reject nếu
   * mp thấp) + execute deterministic qua `simulateActiveTalent(def, atk, spirit)`.
   *
   * Effect mapping:
   * - `damage` → deal `result.damage × playerElementMul × talentElementMul × buffElementMul`
   *   vào current monster (raw — bypass `effective.atkScale` + skill mastery
   *   curve, talent là channel độc lập).
   * - `heal` → restore `result.heal` HP (clamp `char.hpMax`).
   * - `cc` (root/stun) → log control applied + skip monster reply turn này.
   * - `dot` → log dot applied + skip monster reply turn này (DOT damage stack
   *   chưa schema persist — Phase 11.X.M defer cumulative cross-turn).
   * - `utility` (escape `talent_phong_lui`) → set encounter ABANDONED +
   *   return view (early exit, không monster reply).
   *
   * MP deduct cố định = `result.mpConsumed` (= `activeEffect.mpCost`),
   * trừ stamina `STAMINA_PER_ACTION` như skill flow.
   *
   * Cooldown turns chưa schema persist (DB chỉ có `learnedAt`); Phase 11.7.E
   * defer.
   *
   * Linh căn / talent / buff / title / method stat mods KHÔNG áp cho talent
   * channel (deterministic atk × value, không multipliers stack — keep talent
   * power-curve dễ balance). Nhưng element multipliers (linh căn primary +
   * talent damage_bonus + buff damage_bonus) áp cho `damage` kind giống skill
   * flow (cùng pattern `playerElementMul × talentElementMul × buffElementMul`).
   */
  private async actionViaActiveTalent(
    userId: string,
    _encounterId: string,
    char: Character,
    enc: Encounter,
    dungeon: DungeonDef,
    state: EncounterState,
    monster: MonsterDef,
    talent: TalentDef,
  ): Promise<EncounterView> {
    if (!talent.activeEffect) {
      throw new CombatError('TALENT_NOT_ACTIVE');
    }

    // Validate ownership: character phải đã học talent qua TalentService.
    if (!this.talents) {
      throw new CombatError('TALENT_NOT_LEARNED');
    }
    const learned = await this.talents.listLearned(char.id);
    const owns = learned.some((l) => l.talentKey === talent.key);
    if (!owns) {
      throw new CombatError('TALENT_NOT_LEARNED');
    }

    // MP cost from activeEffect.
    if (char.mp < talent.activeEffect.mpCost) {
      throw new CombatError('MP_LOW');
    }

    // Phase 11.7.E — Cooldown check. Reject EARLY (trước stamina/HP/MP
    // mutation, ledger row, encounter status update) khi active talent
    // còn cooldown > 0. Player nhận `TALENT_ON_COOLDOWN` và phải đợi
    // (hoặc chuyển sang skill khác). Cast cooldown được set ở cuối flow
    // sau khi mọi check pass, qua cùng `prisma.$transaction` với character
    // update + ledger row.
    const cooldownRemaining = await this.talents.getCooldownRemaining(
      char.id,
      talent.key,
    );
    if (cooldownRemaining > 0) {
      throw new CombatError('TALENT_ON_COOLDOWN');
    }

    // Compute element multipliers cho damage kind (same pattern with skill flow).
    const charElementState =
      char.primaryElement && char.spiritualRootGrade
        ? {
            primaryElement: char.primaryElement as ElementKey,
            secondaryElements: char.secondaryElements as ElementKey[],
          }
        : null;
    const playerElementMul = characterSkillElementBonus(
      charElementState,
      talent.element,
      (monster.element ?? null) as ElementKey | null,
    );
    // Talent damage_bonus by element compose (passive talent học khác có
    // damage_bonus by element vẫn áp cho talent active damage).
    const talentMods = this.talents
      ? await this.talents.getMods(char.id)
      : null;
    const talentElementMul =
      talentMods && talent.element !== null
        ? talentMods.damageBonusByElement.get(talent.element) ?? 1
        : 1;
    const buffMods = this.buffs ? await this.buffs.getMods(char.id) : null;
    const buffElementMul =
      buffMods && talent.element !== null
        ? buffMods.damageBonusByElement.get(talent.element) ?? 1
        : 1;
    // Phase 11.X.O — Buff control vẫn block player action (cùng pattern skill).
    if (buffMods && buffMods.controlTurnsMax > 0) {
      throw new CombatError('CONTROLLED');
    }

    // Phase 14.2.A — Elemental Combat Foundation layer (parity với skill flow).
    // Compose monsterResist × (1 + equipBonus) cho talent active damage path.
    // Fallback `1.0` nếu talent.element null hoặc legacy monster/equipment chưa
    // khai báo. Multiplicative với playerElementMul/talentElementMul/buffElementMul.
    const talentElementKey = talent.element ?? null;
    const monsterResistMul = composeMonsterElementalResist(
      monster.elementalResist,
      talentElementKey,
    );
    const equipElementBonus = await this.inventory.equipElementalAtkBonus(
      char.id,
      talentElementKey,
    );
    const phase142Mul = monsterResistMul * (1 + equipElementBonus);

    const result = simulateActiveTalent(talent, char.power, char.spirit);

    // Apply effect.
    let charHp = char.hp;
    let charMp = char.mp - result.mpConsumed;
    let monsterHp = state.monsterHp;
    let nextStatus: EncounterStatus = EncounterStatus.ACTIVE;
    let skipMonsterReply = false;

    const log: EncounterLogLine[] = [
      ...((enc.log as unknown as EncounterLogLine[]) ?? []),
    ];

    const aoeLabel = result.aoe ? ' (AOE)' : '';

    switch (talent.activeEffect.kind) {
      case 'damage': {
        const dmg = Math.max(
          1,
          Math.round(
            result.damage *
              playerElementMul *
              talentElementMul *
              buffElementMul *
              phase142Mul,
          ),
        );
        monsterHp = state.monsterHp - dmg;
        log.push({
          side: 'player',
          text: `Đạo hữu phát động ${talent.name}${aoeLabel}, gây ${dmg} sát thương lên ${monster.name}.`,
          ts: Date.now(),
        });
        // Phase 11 nâng cao §3 — parity với skill flow: log breakdown khi
        // playerElementMul vượt amplify/dampen threshold.
        if (playerElementMul >= ELEMENT_LOG_AMPLIFY_THRESHOLD) {
          const matchVi = describeElementMatch(
            talent.element,
            (monster.element ?? null) as ElementKey | null,
          ).vi;
          log.push({
            side: 'system',
            text: matchVi
              ? `Ngũ Hành ${matchVi} — sát thương khuếch đại ×${playerElementMul.toFixed(2)}.`
              : `Ngũ Hành tương khắc/sinh — sát thương khuếch đại ×${playerElementMul.toFixed(2)}.`,
            ts: Date.now(),
          });
        } else if (playerElementMul <= ELEMENT_LOG_DAMPEN_THRESHOLD) {
          const matchVi = describeElementMatch(
            talent.element,
            (monster.element ?? null) as ElementKey | null,
          ).vi;
          log.push({
            side: 'system',
            text: matchVi
              ? `Ngũ Hành ${matchVi} — sát thương suy giảm ×${playerElementMul.toFixed(2)}.`
              : `Ngũ Hành lệch hệ — sát thương suy giảm ×${playerElementMul.toFixed(2)}.`,
            ts: Date.now(),
          });
        }
        // Phase 14.2.A — log monster resist / equipment bonus khi non-trivial.
        // Parity với skill flow (action()).
        if (talentElementKey !== null && monsterResistMul < 0.95) {
          log.push({
            side: 'system',
            text: `${monster.name} kháng hệ ${talentElementKey} ×${monsterResistMul.toFixed(2)}.`,
            ts: Date.now(),
          });
        }
        if (talentElementKey !== null && equipElementBonus >= 0.05) {
          log.push({
            side: 'system',
            text: `Trang bị tăng ${(equipElementBonus * 100).toFixed(0)}% sát thương hệ ${talentElementKey}.`,
            ts: Date.now(),
          });
        }
        break;
      }
      case 'heal': {
        const before = charHp;
        charHp = Math.min(char.hpMax, charHp + result.heal);
        log.push({
          side: 'player',
          text: `Đạo hữu vận ${talent.name}, hồi ${charHp - before} HP.`,
          ts: Date.now(),
        });
        skipMonsterReply = true;
        break;
      }
      case 'cc': {
        log.push({
          side: 'player',
          text: `Đạo hữu phong toả ${monster.name} bằng ${talent.name}${aoeLabel} (${result.ccTurns} lượt).`,
          ts: Date.now(),
        });
        skipMonsterReply = true;
        break;
      }
      case 'dot': {
        log.push({
          side: 'player',
          text: `Đạo hữu thiêu ${monster.name} bằng ${talent.name} — burn ${result.dotTurns} lượt.`,
          ts: Date.now(),
        });
        skipMonsterReply = true;
        break;
      }
      case 'utility': {
        // Escape utility (talent_phong_lui): rút lui khỏi encounter ngay.
        log.push({
          side: 'player',
          text: `Đạo hữu vận ${talent.name} thoát thân khỏi ải.`,
          ts: Date.now(),
        });
        const newStaminaEarly = Math.max(0, char.stamina - STAMINA_PER_ACTION);
        // Phase 11.7.E — wrap utility (escape) cũng trong tx để set cooldown
        // talent vừa cast + decrement cooldown các talent khác cùng atomic.
        await this.prisma.$transaction(async (tx) => {
          await tx.character.update({
            where: { id: char.id },
            data: { mp: charMp, stamina: newStaminaEarly },
          });
          await this.talents!.decrementAllCooldowns(tx, char.id);
          await this.talents!.setCooldown(
            tx,
            char.id,
            talent.key,
            talent.activeEffect!.cooldownTurns,
          );
        });
        const updated = await this.prisma.encounter.update({
          where: { id: enc.id },
          data: {
            status: EncounterStatus.ABANDONED,
            log: log as unknown as Prisma.InputJsonValue,
          },
        });
        const charState = await this.chars.findByUser(userId);
        if (charState) this.realtime.emitToUser(userId, 'state:update', charState);
        return this.toView(updated);
      }
    }

    // Monster killed (damage path) → progress encounter.
    let nextState: EncounterState = { ...state, monsterHp };
    let expGain = 0n;
    let linhThachGain = 0n;
    let reward: EncounterView['reward'] = null;

    if (monsterHp <= 0) {
      log.push({
        side: 'system',
        text: `${monster.name} đổ xuống — đắc thủ ${monster.expDrop} EXP, ${monster.linhThachDrop} linh thạch.`,
        ts: Date.now(),
      });
      expGain += BigInt(monster.expDrop);
      linhThachGain += BigInt(monster.linhThachDrop);
      const nextIdx = state.monsterIndex + 1;
      if (nextIdx >= dungeon.monsters.length) {
        nextStatus = EncounterStatus.WON;
        log.push({
          side: 'system',
          text: `Chinh phục ${dungeon.name} thành công, đạo hữu thoát quan.`,
          ts: Date.now(),
        });
        nextState = { monsterIndex: nextIdx, monsterHp: 0 };
      } else {
        const nextMonster = monsterByKey(dungeon.monsters[nextIdx]);
        if (nextMonster) {
          nextState = { monsterIndex: nextIdx, monsterHp: nextMonster.hp };
          log.push({
            side: 'system',
            text: `${nextMonster.name} (Lv.${nextMonster.level}) lao tới.`,
            ts: Date.now(),
          });
        }
      }
    } else if (!skipMonsterReply) {
      // Monster counter-attack (damage path, monster còn sống).
      const replyBase = rollDamage(monster.atk, char.spirit + char.power * 0.3, 1);
      const monsterElementMul = elementMultiplier(
        (monster.element ?? null) as ElementKey | null,
        (char.primaryElement ?? null) as ElementKey | null,
      );
      const reply = Math.max(1, Math.round(replyBase * monsterElementMul));
      log.push({
        side: 'monster',
        text: `${monster.name} phản kích, gây ${reply} sát thương.`,
        ts: Date.now(),
      });
      charHp -= reply;
      if (charHp <= 0) {
        nextStatus = EncounterStatus.LOST;
        charHp = 1;
        log.push({
          side: 'system',
          text: `Đạo hữu rơi vào hôn mê, đan điền tổn thương — phải hồi phục mới có thể chiến tiếp.`,
          ts: Date.now(),
        });
      }
    }

    // Persist encounter & character.
    await this.prisma.encounter.update({
      where: { id: enc.id },
      data: {
        status: nextStatus,
        state: nextState as unknown as Prisma.InputJsonValue,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });

    const newStamina = Math.max(0, char.stamina - STAMINA_PER_ACTION);
    const updateChar: Prisma.CharacterUpdateInput = {
      hp: charHp,
      mp: charMp,
      stamina: newStamina,
    };
    if (expGain > 0n) updateChar.exp = { increment: expGain };

    await this.prisma.$transaction(async (tx) => {
      await tx.character.update({ where: { id: char.id }, data: updateChar });
      if (linhThachGain > 0n) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: linhThachGain,
          reason: 'COMBAT_LOOT',
          refType: 'Encounter',
          refId: enc.id,
          meta: {
            dungeonKey: dungeon.key,
            status: nextStatus,
            talentKey: talent.key,
          },
        });
      }
      // Phase 11.7.E — Talent active cooldown persist:
      //   1. Decrement -1 cooldown của mọi active talent đang còn cooldown
      //      (talent KHÔNG cast turn này vẫn tick down).
      //   2. Set cooldown talent vừa cast = `talent.activeEffect.cooldownTurns`.
      //      Thứ tự: decrement TRƯỚC set — đảm bảo talent vừa cast nhận đúng
      //      cooldown đầy đủ (không bị decrement trên cooldown vừa set).
      await this.talents!.decrementAllCooldowns(tx, char.id);
      await this.talents!.setCooldown(
        tx,
        char.id,
        talent.key,
        talent.activeEffect!.cooldownTurns,
      );
    });

    const lootView: EncounterRewardLoot[] = [];
    if (nextStatus === EncounterStatus.WON) {
      // Phase 12.4 — ưu tiên monster.lootTable (boss/elite override)
      const monsterLoot = rollMonsterLoot(monster.key, 2);
      const loot = monsterLoot.length > 0 ? monsterLoot : rollDungeonLoot(dungeon.key, 2);
      if (loot.length > 0) {
        await this.inventory.grant(char.id, loot, {
          reason: 'COMBAT_LOOT',
          refType: 'Encounter',
          refId: enc.id,
          extra: { dungeonKey: dungeon.key, talentKey: talent.key },
        });
        for (const l of loot) {
          const def = itemByKey(l.itemKey);
          if (!def) continue;
          lootView.push({
            itemKey: l.itemKey,
            qty: l.qty,
            itemName: def.name,
            quality: def.quality,
          });
        }
        log.push({
          side: 'system',
          text: `Đắc thủ chiến lợi: ${lootView
            .map((l) => `${l.itemName} ×${l.qty}`)
            .join(', ')}.`,
          ts: Date.now(),
        });
        await this.prisma.encounter.update({
          where: { id: enc.id },
          data: { log: log as unknown as Prisma.InputJsonValue },
        });
      }
    }

    if (nextStatus === EncounterStatus.WON || nextStatus === EncounterStatus.LOST) {
      reward = {
        exp: expGain.toString(),
        linhThach: linhThachGain.toString(),
        loot: lootView,
      };
    }

    // Mission + achievement tracking — fail-soft.
    try {
      if (monsterHp <= 0) {
        await this.missions.track(char.id, 'KILL_MONSTER', 1);
        if (this.achievements) {
          await this.achievements.trackEvent(char.id, 'KILL_MONSTER', 1);
        }
        // Phase 12 Story PR-2 + PR-6 — quest kill step tracking, fail-soft.
        // Track monster.key (real catalog) **và** monster.questTargetIds[*]
        // (placeholder ánh xạ vào quest targetId trừu tượng như 'son_thu').
        if (this.quests) {
          const trackIds = new Set<string>([monster.key]);
          for (const id of monster.questTargetIds ?? []) trackIds.add(id);
          for (const id of trackIds) {
            await this.quests.track(char.id, 'kill', 'monster', id, 1);
          }
        }
      }
      if (nextStatus === EncounterStatus.WON) {
        await this.missions.track(char.id, 'CLEAR_DUNGEON', 1);
        if (this.achievements) {
          await this.achievements.trackEvent(char.id, 'CLEAR_DUNGEON', 1);
        }
      }
    } catch {
      // bỏ qua
    }

    const charState = await this.chars.findByUser(userId);
    if (charState) this.realtime.emitToUser(userId, 'state:update', charState);

    const finalEnc = await this.prisma.encounter.findUniqueOrThrow({ where: { id: enc.id } });
    const view = this.toView(finalEnc);
    view.reward = reward;
    return view;
  }

  async abandon(userId: string, encounterId: string): Promise<EncounterView> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new CombatError('NO_CHARACTER');
    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!enc || enc.characterId !== char.id) throw new CombatError('ENCOUNTER_NOT_FOUND');
    if (enc.status !== EncounterStatus.ACTIVE) throw new CombatError('ENCOUNTER_ENDED');

    const log: EncounterLogLine[] = [
      ...((enc.log as unknown as EncounterLogLine[]) ?? []),
      { side: 'system', text: 'Đạo hữu rút lui khỏi ải.', ts: Date.now() },
    ];
    const updated = await this.prisma.encounter.update({
      where: { id: enc.id },
      data: {
        status: EncounterStatus.ABANDONED,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toView(updated);
  }

  private toView(e: {
    id: string;
    dungeonKey: string;
    status: EncounterStatus;
    state: Prisma.JsonValue;
    log: Prisma.JsonValue;
  }): EncounterView {
    const dungeon = dungeonByKey(e.dungeonKey);
    if (!dungeon) {
      throw new CombatError('DUNGEON_NOT_FOUND');
    }
    const st = (e.state as unknown as EncounterState) ?? { monsterIndex: 0, monsterHp: 0 };
    const monster = monsterByKey(dungeon.monsters[st.monsterIndex]) ?? null;
    return {
      id: e.id,
      dungeon,
      status: e.status,
      monster,
      monsterHp: st.monsterHp,
      monsterIndex: st.monsterIndex,
      log: ((e.log as unknown as EncounterLogLine[]) ?? []).slice(-30),
      reward: null,
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
}

/**
 * Phase 11.2.B fallback — khi `CharacterSkillService` không inject (legacy
 * test setup, integration không cần mastery), trả EffectiveSkill từ
 * baseline `SkillDef` không bonus. Tránh CombatService bị break khi
 * service vắng mặt.
 */
function baselineEffective(skill: SkillDef): EffectiveSkill {
  return {
    key: skill.key,
    atkScale: skill.atkScale,
    mpCost: skill.mpCost,
    selfHealRatio: skill.selfHealRatio,
    selfBloodCost: skill.selfBloodCost,
    cooldownTurns: skill.cooldownTurns ?? 0,
    element: skill.element ?? null,
    sect: skill.sect,
    masteryLevel: 0,
    tier: 'basic',
  };
}

export { CombatError };
