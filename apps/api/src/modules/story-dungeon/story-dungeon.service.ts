import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CurrencyKind,
  Prisma,
  StoryDungeonRunStatus,
  type StoryDungeonRun,
} from '@prisma/client';
import {
  bossByKey,
  monsterByKey,
  questByKey,
  realmByKey,
  STORY_DUNGEONS,
  storyDungeonByKey,
  computeStoryDungeonStatus,
  type BossDef,
  type MonsterDef,
  type QuestDef,
  type QuestStateForStoryDungeon,
  type StoryDungeonAvailabilityStatus,
  type StoryDungeonRewardHint,
  type StoryDungeonTemplateDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';

/**
 * Phase 12.8.A + 12.8.B — Story Dungeon API service.
 *
 * Phase 12.8.A read-only path:
 *   - Trả về catalog snapshot `STORY_DUNGEONS` (filter `enabled=true`).
 *   - Compute status `locked / available / cleared` per template từ
 *     `QuestProgress` (read-only) + `Character.realmKey` (qua `realmByKey`).
 *   - Hydrate boss/monster preview cho FE list (kèm tên + element + rarity).
 *
 * Phase 12.8.B runtime path:
 *   - `startRun(userId, key)` — server-authoritative gate (quest + minRealm
 *     + oneTime). Idempotent retry (cùng templateKey + ACTIVE) trả về run hiện
 *     có thay vì create duplicate.
 *   - `advance(userId, runId)` — kill 1 monster theo `currentStep` index;
 *     fail-soft `QuestService.track('kill','monster',...)` cho mỗi
 *     monster.key + questTargetIds (mirror DungeonRunService.nextEncounter).
 *   - `clear(userId, runId)` — verify đã hết monsterKeys + transition
 *     ACTIVE→CLEARED + auto-advance quest step (set
 *     `stepProgress[requiredQuestStep]=count` + auto-COMPLETE quest nếu
 *     mọi step done). Re-clear không double-progress (CAS guard).
 *   - `claim(userId, runId)` — atomic transaction: CAS `claimedAt=null`
 *     guard + grant currency/items/exp via `CurrencyService.applyTx` +
 *     `InventoryService.grantTx` + `tx.character.update({ exp })` với
 *     reason `STORY_DUNGEON_REWARD`, refType `StoryDungeonRun`,
 *     refId=runId. Idempotent — race 2 claim cùng runId chỉ 1 winner.
 *
 * Server-authoritative invariants:
 *   - Auth: caller phải có `Character` row (controller resolve `userId`
 *     qua cookie `xt_access`). Throw `StoryDungeonError('NO_CHARACTER')`.
 *   - Status compute (read-only): dựa thuần vào `QuestProgress.status` +
 *     step progress (`stepProgress` JSON) + `Character.realmKey.order`.
 *     KHÔNG cộng/trừ state phía service.
 *   - One-time: nếu `template.oneTime`, reject `start` nếu `(characterId,
 *     templateKey)` đã có row `claimedAt != null`.
 *   - Ownership: mọi mutation (`advance`, `clear`, `claim`) check
 *     `run.characterId` match user's character.
 *   - Idempotent claim: CAS `where { id, status: CLEARED, claimedAt: null }`
 *     updateMany count=1 winner.
 */

export class StoryDungeonError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'DUNGEON_NOT_FOUND'
      | 'DUNGEON_LOCKED'
      | 'DUNGEON_ALREADY_CLEARED'
      | 'ALREADY_IN_RUN'
      | 'RUN_NOT_FOUND'
      | 'RUN_NOT_OWNED'
      | 'RUN_NOT_ACTIVE'
      | 'RUN_STEP_INVALID'
      | 'RUN_NOT_CLEARED'
      | 'RUN_ALREADY_CLAIMED'
      | 'RUN_NO_REWARD',
  ) {
    super(code);
  }
}

export interface StoryDungeonMonsterPreview {
  key: string;
  name: string;
  element?: string | null;
  level?: number | null;
}

export interface StoryDungeonBossPreview {
  key: string;
  name: string;
  recommendedRealm: string;
  regionKey?: string | null;
}

export interface StoryDungeonView {
  key: string;
  titleI18nKey: string;
  descriptionI18nKey: string;
  titleVi: string;
  descriptionVi: string;
  requiredQuestKey: string;
  requiredQuestStep: string | null;
  regionKey: string;
  recommendedRealm: string;
  minRealmKey: string | null;
  npcKey: string | null;
  entryDialogueKey: string | null;
  clearDialogueKey: string | null;
  monsters: StoryDungeonMonsterPreview[];
  boss: StoryDungeonBossPreview | null;
  rewardHint: StoryDungeonRewardHint | null;
  oneTime: boolean;
  status: StoryDungeonAvailabilityStatus;
}

/**
 * Phase 12.8.B — Per-monster killed entry (mirror DungeonRun.killedMonsters
 * shape, KHÔNG có loot drop để giữ runtime đơn giản — story dungeon reward
 * chỉ ở claim path qua `rewardHint`).
 */
export interface StoryDungeonRunKilledEntry {
  monsterKey: string;
  killedAt: string;
}

export interface StoryDungeonRunView {
  id: string;
  templateKey: string;
  status: StoryDungeonRunStatus;
  currentStep: number;
  totalSteps: number;
  /** Monster `template.monsterKeys[currentStep]` (next monster cần đánh).
   * `null` khi run CLEARED/CLAIMED/FAILED hoặc index out-of-range. */
  currentMonster: MonsterDef | null;
  killedMonsters: StoryDungeonRunKilledEntry[];
  startedAt: string;
  clearedAt: string | null;
  claimedAt: string | null;
  /** Reward catalog snapshot — FE render preview claim button. */
  rewardHint: StoryDungeonRewardHint | null;
}

export interface StoryDungeonClaimResult {
  runId: string;
  templateKey: string;
  claimedAt: Date;
  granted: {
    linhThach: number;
    tienNgoc: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
}

interface CharCtx {
  characterId: string;
  realmOrder: number;
  questStateByKey: Map<string, QuestStateForStoryDungeon>;
  questStepProgressByKey: Map<string, Record<string, number>>;
}

function readStepProgressJson(raw: Prisma.JsonValue | null | undefined): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = Math.floor(v);
    }
  }
  return out;
}

function readKilledMonsters(json: Prisma.JsonValue | null): StoryDungeonRunKilledEntry[] {
  if (!Array.isArray(json)) return [];
  const out: StoryDungeonRunKilledEntry[] = [];
  for (const v of json) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof (v as Record<string, unknown>).monsterKey === 'string' &&
      typeof (v as Record<string, unknown>).killedAt === 'string'
    ) {
      out.push({
        monsterKey: (v as Record<string, string>).monsterKey,
        killedAt: (v as Record<string, string>).killedAt,
      });
    }
  }
  return out;
}

function monsterPreview(m: MonsterDef): StoryDungeonMonsterPreview {
  return {
    key: m.key,
    name: m.name,
    element: m.element ?? null,
    level: typeof m.level === 'number' ? m.level : null,
  };
}

function bossPreview(b: BossDef): StoryDungeonBossPreview {
  return {
    key: b.key,
    name: b.name,
    recommendedRealm: b.recommendedRealm,
    regionKey: b.regionKey ?? null,
  };
}

function buildView(
  template: StoryDungeonTemplateDef,
  status: StoryDungeonAvailabilityStatus,
): StoryDungeonView {
  const monsters: StoryDungeonMonsterPreview[] = [];
  for (const mk of template.monsterKeys) {
    const m = monsterByKey(mk);
    if (m) monsters.push(monsterPreview(m));
  }
  const boss = template.bossKey ? bossByKey(template.bossKey) : undefined;
  return {
    key: template.key,
    titleI18nKey: template.titleI18nKey,
    descriptionI18nKey: template.descriptionI18nKey,
    titleVi: template.titleVi,
    descriptionVi: template.descriptionVi,
    requiredQuestKey: template.requiredQuestKey,
    requiredQuestStep: template.requiredQuestStep ?? null,
    regionKey: template.regionKey,
    recommendedRealm: template.recommendedRealm,
    minRealmKey: template.minRealmKey ?? null,
    npcKey: template.npcKey ?? null,
    entryDialogueKey: template.entryDialogueKey ?? null,
    clearDialogueKey: template.clearDialogueKey ?? null,
    monsters,
    boss: boss ? bossPreview(boss) : null,
    rewardHint: template.rewardHint ?? null,
    oneTime: template.oneTime,
    status,
  };
}

@Injectable()
export class StoryDungeonService {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 12.8.B — claim path injects via Optional + token để Phase 12.8.A
    // tests trực tiếp construct service với chỉ `prisma` vẫn pass (read-only
    // path không cần các service runtime).
    @Optional() @Inject(CurrencyService) private readonly currency?: CurrencyService,
    @Optional() @Inject(InventoryService) private readonly inventory?: InventoryService,
    @Optional() @Inject(QuestService) private readonly quests?: QuestService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Phase 12.8.A read-only API
  // ──────────────────────────────────────────────────────────────────────

  async listForUser(userId: string): Promise<StoryDungeonView[]> {
    const ctx = await this.loadCtx(userId);
    return STORY_DUNGEONS.filter((t) => t.enabled).map((t) =>
      buildView(t, this.computeStatus(t, ctx)),
    );
  }

  async getByKey(userId: string, key: string): Promise<StoryDungeonView> {
    const template = storyDungeonByKey(key);
    if (!template || !template.enabled) {
      throw new StoryDungeonError('DUNGEON_NOT_FOUND');
    }
    const ctx = await this.loadCtx(userId);
    return buildView(template, this.computeStatus(template, ctx));
  }

  /**
   * Phase 12.8.C — surface ACTIVE / CLEARED-but-unclaimed run cho FE list
   * UI biết "tôi đang trong run nào" + render run panel inline khi reload
   * trang. Trả `null` nếu không có run cần xử lý:
   *  - run đã CLAIMED / FAILED → coi như không còn (FE không cần render
   *    panel runtime).
   *  - 1 character chỉ có tối đa 1 ACTIVE run (`startRun` invariant
   *    `ALREADY_IN_RUN`); nếu có nhiều CLEARED chưa claim → ưu tiên cái
   *    `startedAt` mới nhất.
   *  - template legacy / disabled → trả `null` defensive (FE không có
   *    catalog entry để render).
   */
  async getActiveRun(userId: string): Promise<StoryDungeonRunView | null> {
    const characterId = await this.requireCharacterId(userId);
    const run = await this.prisma.storyDungeonRun.findFirst({
      where: {
        characterId,
        status: {
          in: [StoryDungeonRunStatus.ACTIVE, StoryDungeonRunStatus.CLEARED],
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (!run) return null;
    const template = storyDungeonByKey(run.templateKey);
    if (!template) return null;
    return this.toView(run, template);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Phase 12.8.B runtime API
  // ──────────────────────────────────────────────────────────────────────

  /**
   * POST /story/dungeons/:key/start.
   *
   * Validate ordered:
   *  1. NO_CHARACTER (caller chưa có character).
   *  2. DUNGEON_NOT_FOUND (key invalid hoặc enabled=false).
   *  3. DUNGEON_LOCKED (quest gate / minRealm gate fail per
   *     `computeStoryDungeonStatus` returning `'locked'`).
   *  4. DUNGEON_ALREADY_CLEARED (oneTime + đã có row claimedAt cho
   *     `(characterId, templateKey)`).
   *  5. Idempotent: nếu đã có ACTIVE run cùng templateKey → trả về run đó
   *     (không tạo mới). Nếu có ACTIVE run khác templateKey → ALREADY_IN_RUN.
   *  6. Tạo row mới `status=ACTIVE, currentStep=0`.
   */
  async startRun(userId: string, key: string): Promise<StoryDungeonRunView> {
    const template = storyDungeonByKey(key);
    if (!template || !template.enabled) {
      throw new StoryDungeonError('DUNGEON_NOT_FOUND');
    }

    const ctx = await this.loadCtx(userId);
    const status = this.computeStatus(template, ctx);
    if (status === 'locked') {
      throw new StoryDungeonError('DUNGEON_LOCKED');
    }

    if (template.oneTime) {
      const claimed = await this.prisma.storyDungeonRun.findFirst({
        where: {
          characterId: ctx.characterId,
          templateKey: template.key,
          claimedAt: { not: null },
        },
        select: { id: true },
      });
      if (claimed) {
        throw new StoryDungeonError('DUNGEON_ALREADY_CLEARED');
      }
    }

    // Idempotent retry: ACTIVE run cùng template → trả về luôn.
    const existingActiveSame = await this.prisma.storyDungeonRun.findFirst({
      where: {
        characterId: ctx.characterId,
        templateKey: template.key,
        status: StoryDungeonRunStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });
    if (existingActiveSame) {
      return this.toView(existingActiveSame, template);
    }

    // ACTIVE run nhưng khác templateKey → block (1 active story dungeon at a
    // time, mirror DungeonRun semantics).
    const existingActiveOther = await this.prisma.storyDungeonRun.findFirst({
      where: {
        characterId: ctx.characterId,
        status: StoryDungeonRunStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (existingActiveOther) {
      throw new StoryDungeonError('ALREADY_IN_RUN');
    }

    if (template.monsterKeys.length === 0) {
      // Catalog invariant — defensive.
      throw new StoryDungeonError('DUNGEON_NOT_FOUND');
    }

    const run = await this.prisma.storyDungeonRun.create({
      data: {
        characterId: ctx.characterId,
        templateKey: template.key,
        status: StoryDungeonRunStatus.ACTIVE,
        currentStep: 0,
        killedMonsters: [] as Prisma.InputJsonValue,
      },
    });
    return this.toView(run, template);
  }

  /**
   * POST /story/dungeons/:runId/advance.
   *
   * Resolve monster `template.monsterKeys[currentStep]` as killed:
   *   1. Validate run + ownership + status=ACTIVE + step trong range.
   *   2. CAS update `currentStep` (idx → idx+1), append `killedMonsters` JSON.
   *   3. fail-soft `QuestService.track('kill','monster',[monster.key,
   *      ...questTargetIds])` (mirror DungeonRunService.nextEncounter).
   *
   * Re-advance race: CAS guard `where { id, status: ACTIVE, currentStep: idx }`
   * — count !== 1 → RUN_NOT_ACTIVE.
   *
   * Note: advance KHÔNG auto-clear khi `currentStep` chạm cuối — caller phải
   * gọi `clear` riêng. Tách biệt để FE có animation kill cuối + dialog
   * trước khi confirm clear.
   */
  async advance(userId: string, runId: string): Promise<StoryDungeonRunView> {
    const characterId = await this.requireCharacterId(userId);
    const run = await this.prisma.storyDungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new StoryDungeonError('RUN_NOT_FOUND');
    if (run.characterId !== characterId) {
      throw new StoryDungeonError('RUN_NOT_OWNED');
    }
    if (run.status !== StoryDungeonRunStatus.ACTIVE) {
      throw new StoryDungeonError('RUN_NOT_ACTIVE');
    }

    const template = storyDungeonByKey(run.templateKey);
    if (!template) throw new StoryDungeonError('DUNGEON_NOT_FOUND');

    const idx = run.currentStep;
    if (idx >= template.monsterKeys.length) {
      // Edge case: index past end nhưng status vẫn ACTIVE — caller phải gọi
      // `clear` thay vì `advance`.
      throw new StoryDungeonError('RUN_STEP_INVALID');
    }
    const monsterKey = template.monsterKeys[idx];
    const monster = monsterByKey(monsterKey);
    if (!monster) throw new StoryDungeonError('DUNGEON_NOT_FOUND');

    const nowIso = new Date().toISOString();
    const killed = readKilledMonsters(run.killedMonsters);
    killed.push({ monsterKey, killedAt: nowIso });
    const nextIndex = idx + 1;

    const upd = await this.prisma.storyDungeonRun.updateMany({
      where: {
        id: run.id,
        status: StoryDungeonRunStatus.ACTIVE,
        currentStep: idx,
      },
      data: {
        currentStep: nextIndex,
        killedMonsters: killed as unknown as Prisma.InputJsonValue,
      },
    });
    if (upd.count !== 1) throw new StoryDungeonError('RUN_NOT_ACTIVE');

    // fail-soft quest kill tracking — mirror DungeonRunService.nextEncounter.
    if (this.quests) {
      const trackIds = new Set<string>([monster.key]);
      for (const id of monster.questTargetIds ?? []) trackIds.add(id);
      for (const id of trackIds) {
        try {
          await this.quests.track(characterId, 'kill', 'monster', id, 1);
        } catch {
          // fail-soft: quest tracking lỗi không break flow.
        }
      }
    }

    const fresh = await this.prisma.storyDungeonRun.findUnique({ where: { id: run.id } });
    return this.toView(fresh!, template);
  }

  /**
   * POST /story/dungeons/:runId/clear.
   *
   * Validate ordered:
   *  1. NO_CHARACTER / RUN_NOT_FOUND / RUN_NOT_OWNED.
   *  2. status phải ACTIVE — re-clear khi đã CLEARED → RUN_NOT_ACTIVE
   *     (idempotency: 2nd call không double quest progress).
   *  3. `currentStep === monsterKeys.length` — chưa hết encounter → RUN_STEP_INVALID.
   *  4. CAS `status=ACTIVE → CLEARED + clearedAt=now`.
   *  5. Auto-advance quest step (set `stepProgress[requiredQuestStep]=count`)
   *     + auto-COMPLETE quest nếu mọi step done. Fail-soft khi quest đã
   *     CLAIMED/COMPLETED — KHÔNG throw 500.
   */
  async clear(userId: string, runId: string): Promise<StoryDungeonRunView> {
    const characterId = await this.requireCharacterId(userId);
    const run = await this.prisma.storyDungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new StoryDungeonError('RUN_NOT_FOUND');
    if (run.characterId !== characterId) {
      throw new StoryDungeonError('RUN_NOT_OWNED');
    }
    if (run.status !== StoryDungeonRunStatus.ACTIVE) {
      throw new StoryDungeonError('RUN_NOT_ACTIVE');
    }

    const template = storyDungeonByKey(run.templateKey);
    if (!template) throw new StoryDungeonError('DUNGEON_NOT_FOUND');

    if (run.currentStep < template.monsterKeys.length) {
      throw new StoryDungeonError('RUN_STEP_INVALID');
    }

    const upd = await this.prisma.storyDungeonRun.updateMany({
      where: { id: run.id, status: StoryDungeonRunStatus.ACTIVE },
      data: {
        status: StoryDungeonRunStatus.CLEARED,
        clearedAt: new Date(),
      },
    });
    if (upd.count !== 1) throw new StoryDungeonError('RUN_NOT_ACTIVE');

    // Quest auto-advance — fail-soft. Race-safe vì CAS ở trên đảm bảo 1
    // winner / runId. Re-clear không thể double-progress vì status đã
    // CLEARED, second updateMany count=0 → RUN_NOT_ACTIVE throw trước đây.
    await this.applyQuestStepAdvance(characterId, template);

    const fresh = await this.prisma.storyDungeonRun.findUnique({ where: { id: run.id } });
    return this.toView(fresh!, template);
  }

  /**
   * POST /story/dungeons/:runId/claim.
   *
   * Atomic flow trong 1 `prisma.$transaction`:
   *   1. CAS guard `updateMany({ where: { id, status: 'CLEARED', claimedAt: null } })`
   *      → set `status='CLAIMED'`, `claimedAt=now()`. Race-safe: 2 concurrent
   *      claim cùng runId, đúng 1 winner.
   *   2. Grant linhThach / tienNgoc qua `CurrencyService.applyTx` với
   *      `reason='STORY_DUNGEON_REWARD'` + `refType='StoryDungeonRun'` +
   *      `refId=runId`.
   *   3. Grant exp trực tiếp qua `tx.character.update({ increment })`.
   *   4. Grant items qua `InventoryService.grantTx` với cùng reason/refType/refId.
   *
   * @throws StoryDungeonError('RUN_ALREADY_CLAIMED') CAS lose / 2nd call.
   */
  async claim(userId: string, runId: string): Promise<StoryDungeonClaimResult> {
    if (!this.currency || !this.inventory) {
      // Defensive — controller wire mọi service. Test direct construct
      // service phải pass cả 3 dependency để không hit branch này.
      throw new StoryDungeonError('RUN_NO_REWARD');
    }
    const characterId = await this.requireCharacterId(userId);
    const run = await this.prisma.storyDungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new StoryDungeonError('RUN_NOT_FOUND');
    if (run.characterId !== characterId) {
      throw new StoryDungeonError('RUN_NOT_OWNED');
    }
    if (run.status === StoryDungeonRunStatus.CLAIMED || run.claimedAt !== null) {
      throw new StoryDungeonError('RUN_ALREADY_CLAIMED');
    }
    if (run.status !== StoryDungeonRunStatus.CLEARED) {
      throw new StoryDungeonError('RUN_NOT_CLEARED');
    }

    const template = storyDungeonByKey(run.templateKey);
    if (!template) throw new StoryDungeonError('DUNGEON_NOT_FOUND');
    const reward = template.rewardHint;
    if (!reward) throw new StoryDungeonError('RUN_NO_REWARD');

    const currency = this.currency;
    const inventory = this.inventory;

    return this.prisma.$transaction(async (tx) => {
      const claimedAt = new Date();
      const upd = await tx.storyDungeonRun.updateMany({
        where: {
          id: run.id,
          status: StoryDungeonRunStatus.CLEARED,
          claimedAt: null,
        },
        data: {
          status: StoryDungeonRunStatus.CLAIMED,
          claimedAt,
        },
      });
      if (upd.count !== 1) {
        throw new StoryDungeonError('RUN_ALREADY_CLAIMED');
      }

      const linhThach = reward.linhThach ?? 0;
      const tienNgoc = reward.tienNgoc ?? 0;
      const exp = reward.exp ?? 0;

      if (linhThach > 0) {
        await currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'STORY_DUNGEON_REWARD',
          refType: 'StoryDungeonRun',
          refId: run.id,
        });
      }
      if (tienNgoc > 0) {
        await currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(tienNgoc),
          reason: 'STORY_DUNGEON_REWARD',
          refType: 'StoryDungeonRun',
          refId: run.id,
        });
      }
      if (exp > 0) {
        await tx.character.update({
          where: { id: characterId },
          data: { exp: { increment: BigInt(exp) } },
        });
      }

      const grantedItems: Array<{ itemKey: string; qty: number }> = [];
      if (reward.items && reward.items.length > 0) {
        const grantList = reward.items.map((it) => ({
          itemKey: it.itemKey,
          qty: it.qty,
        }));
        await inventory.grantTx(tx, characterId, grantList, {
          reason: 'STORY_DUNGEON_REWARD',
          refType: 'StoryDungeonRun',
          refId: run.id,
        });
        grantedItems.push(...grantList);
      }

      return {
        runId: run.id,
        templateKey: run.templateKey,
        claimedAt,
        granted: {
          linhThach,
          tienNgoc,
          exp,
          items: grantedItems,
        },
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────

  private computeStatus(
    template: StoryDungeonTemplateDef,
    ctx: CharCtx,
  ): StoryDungeonAvailabilityStatus {
    return computeStoryDungeonStatus(template, {
      realmOrder: ctx.realmOrder,
      questStateByKey: ctx.questStateByKey,
      questStepProgress: ctx.questStepProgressByKey,
    });
  }

  private async loadCtx(userId: string): Promise<CharCtx> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new StoryDungeonError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;
    const rows = await this.prisma.questProgress.findMany({
      where: { characterId: char.id },
      select: { questKey: true, status: true, stepProgress: true },
    });
    const questStateByKey = new Map<string, QuestStateForStoryDungeon>();
    const questStepProgressByKey = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const status = r.status as string;
      // Map Prisma `QuestStatus` (LOCKED|AVAILABLE|ACCEPTED|COMPLETED|CLAIMED)
      // → `QuestStateForStoryDungeon` (NOT_STARTED|AVAILABLE|ACCEPTED|COMPLETED|CLAIMED).
      // `LOCKED` collapse vào NOT_STARTED (compute coi như chưa qualify).
      switch (status) {
        case 'AVAILABLE':
        case 'ACCEPTED':
        case 'COMPLETED':
        case 'CLAIMED':
          questStateByKey.set(r.questKey, status);
          break;
        default:
          questStateByKey.set(r.questKey, 'NOT_STARTED');
      }
      questStepProgressByKey.set(r.questKey, readStepProgressJson(r.stepProgress));
    }
    return {
      characterId: char.id,
      realmOrder,
      questStateByKey,
      questStepProgressByKey,
    };
  }

  private async requireCharacterId(userId: string): Promise<string> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new StoryDungeonError('NO_CHARACTER');
    return char.id;
  }

  /**
   * Phase 12.8.B — quest auto-advance khi clear story dungeon.
   *
   * Logic:
   *  - Nếu template có `requiredQuestStep`, set `stepProgress[step.id]=step.count`
   *    (idempotent — re-clear không double).
   *  - Nếu mọi step trong quest đã done → auto-COMPLETE quest (mirror
   *    `QuestService.transitionToCompleted` pattern). Service trực tiếp
   *    updateMany `status: ACCEPTED → COMPLETED + completedAt`.
   *  - Fail-soft cho mọi nhánh "quest đã CLAIMED/COMPLETED" — re-clear hoặc
   *    flow legacy không gây 500.
   */
  private async applyQuestStepAdvance(
    characterId: string,
    template: StoryDungeonTemplateDef,
  ): Promise<void> {
    const def = questByKey(template.requiredQuestKey);
    if (!def) return;

    const row = await this.prisma.questProgress.findUnique({
      where: {
        characterId_questKey: {
          characterId,
          questKey: template.requiredQuestKey,
        },
      },
      select: { id: true, status: true, stepProgress: true },
    });
    // Quest chưa từng accept/seed — KHÔNG tạo row mới (tránh phá flow Quest
    // service chính). Player phải accept quest trước qua quest UI.
    if (!row) return;
    // Quest đã CLAIMED/COMPLETED — không touch (avoid double-reward path
    // hoặc revert state). Chỉ ACCEPTED mới được advance step.
    if (row.status !== 'ACCEPTED') return;

    const stepIdToBump = template.requiredQuestStep;
    const progress = readStepProgressJson(row.stepProgress);

    if (stepIdToBump) {
      const stepDef = def.steps.find((s) => s.id === stepIdToBump);
      if (stepDef) {
        const cur = progress[stepDef.id] ?? 0;
        if (cur < stepDef.count) {
          progress[stepDef.id] = stepDef.count;
          await this.prisma.questProgress.updateMany({
            where: { id: row.id, status: 'ACCEPTED' },
            data: { stepProgress: progress as Prisma.InputJsonValue },
          });
        }
      }
    }

    // Auto-COMPLETE nếu mọi step đã done.
    if (this.allStepsDone(def, progress)) {
      await this.transitionToCompleted(row.id);
    }
  }

  private allStepsDone(def: QuestDef, progress: Record<string, number>): boolean {
    for (const step of def.steps) {
      if ((progress[step.id] ?? 0) < step.count) return false;
    }
    return true;
  }

  private async transitionToCompleted(progressId: string): Promise<void> {
    const upd = await this.prisma.questProgress.updateMany({
      where: { id: progressId, status: 'ACCEPTED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (upd.count !== 1) return;
    // Mirror QuestService.transitionToCompleted: bump storyChapter cho main
    // quest. Tách riêng khỏi claim để chapter tiến cả khi player chưa claim.
    const row = await this.prisma.questProgress.findUnique({
      where: { id: progressId },
      select: { characterId: true, questKey: true },
    });
    if (!row) return;
    const def = questByKey(row.questKey);
    if (!def || def.kind !== 'main') return;
    const targetChapter = def.requiredRealmOrder + 1;
    await this.prisma.character.updateMany({
      where: { id: row.characterId, storyChapter: { lt: targetChapter } },
      data: { storyChapter: targetChapter },
    });
  }

  private toView(
    run: StoryDungeonRun,
    template: StoryDungeonTemplateDef,
  ): StoryDungeonRunView {
    const totalSteps = template.monsterKeys.length;
    const idx = run.currentStep;
    const currentMonsterKey =
      run.status === StoryDungeonRunStatus.ACTIVE && idx < totalSteps
        ? template.monsterKeys[idx]
        : null;
    const currentMonster = currentMonsterKey ? monsterByKey(currentMonsterKey) ?? null : null;
    return {
      id: run.id,
      templateKey: run.templateKey,
      status: run.status,
      currentStep: idx,
      totalSteps,
      currentMonster,
      killedMonsters: readKilledMonsters(run.killedMonsters),
      startedAt: run.startedAt.toISOString(),
      clearedAt: run.clearedAt ? run.clearedAt.toISOString() : null,
      claimedAt: run.claimedAt ? run.claimedAt.toISOString() : null,
      rewardHint: template.rewardHint ?? null,
    };
  }
}
