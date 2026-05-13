import { Injectable, Optional } from '@nestjs/common';
import {
  CurrencyKind,
  DungeonRunStatus,
  Prisma,
  type DungeonRun,
} from '@prisma/client';
import {
  DUNGEONS,
  REALMS,
  dungeonByKey,
  inferDropMonsterType,
  monsterByKey,
  realmByKey,
  realmOrderToMaterialTier,
  rollDungeonLoot,
  rollMonsterLoot,
  territoryRegionBuffsForRegion,
  type DungeonDef,
  type DungeonRunReward,
  type DropSource,
  type MonsterDef,
  type RolledLoot,
  type TerritoryRegionBuffDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { DropEconomyService } from '../economy/drop-economy.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { QuestService } from '../quest/quest.service';
import { Phase33StoryService } from '../story-v2/story-v2.service';
import { startOfLocalDay } from '../combat/combat.service';
import { SectWarService } from '../sect-war/sect-war.service';
import { TerritoryService } from '../territory/territory.service';
import { LiveOpsEventSchedulerService } from '../liveops-event-scheduler/liveops-event-scheduler.service';

/**
 * Phase 12.2.B — DungeonRun runtime service.
 *
 * Khác `CombatService` (turn-based single Encounter):
 *  - DungeonRun = multi-encounter expedition. Mỗi `next()` call auto-resolve
 *    1 encounter (kill monster + quest track + advance index). Không có
 *    skill choice / MP / HP per encounter. Đơn giản hơn combat — phù hợp
 *    farm-loop sau khi player đã clear nội dung lần đầu via combat.
 *  - DungeonRun reward = bonus deterministic claim sau khi clear toàn bộ
 *    encounter (linhThach + tienNgoc + exp + items, reason
 *    `DUNGEON_RUN_REWARD`).
 *  - Per-encounter loot drop (Phase 12.3) = random `rollDungeonLoot()`
 *    pull từ `DUNGEON_LOOT[dungeon.key]` mỗi `next()` call, grant qua
 *    `inventory.grant` reason `DUNGEON_LOOT` + refType `DungeonRun`.
 *    Mirror combat.service `COMBAT_LOOT` (cùng drop table, khác refType).
 *
 * Server-authoritative invariants:
 *  - Realm gate: player.realmKey order >= dungeon.recommendedRealm order.
 *    Khác combat (chỉ "gợi ý", không cản) — DungeonRun siết chặt hơn.
 *  - Daily limit: count `DungeonRun` rows trong cửa sổ DAILY local tz
 *    (mirror `combat.service` `startOfLocalDay`). Slot daily đã tiêu sẽ
 *    KHÔNG refund khi run ABANDONED — anti-grind.
 *  - Ownership: mọi mutation (`next`, `claim`) check `run.characterId`
 *    match user's character.
 *  - Idempotent claim: `tx.dungeonRun.updateMany({ where: { id, status:
 *    COMPLETED, claimedAt: null }, data: { status: CLAIMED, claimedAt }})`
 *    CAS guard. Race 2 claim cùng runId → đúng 1 winner ghi 1 ledger row.
 *  - Quest hook: `QuestService.track('kill','monster', id, 1)` cho mỗi id
 *    trong [monster.key, ...questTargetIds] khi resolve encounter (mirror
 *    `combat.service` PR-6 fail-soft pattern). FE KHÔNG tự cộng quest.
 */

export class DungeonRunError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'DUNGEON_NOT_FOUND'
      | 'DUNGEON_LOCKED_REALM'
      | 'DUNGEON_DAILY_LIMIT_REACHED'
      | 'STAMINA_LOW'
      | 'ALREADY_IN_RUN'
      | 'RUN_NOT_FOUND'
      | 'RUN_NOT_OWNED'
      | 'RUN_NOT_ACTIVE'
      | 'RUN_NOT_COMPLETED'
      | 'RUN_ALREADY_CLAIMED'
      | 'RUN_NO_REWARD',
  ) {
    super(code);
  }
}

export interface DungeonAvailability {
  dungeon: DungeonDef;
  /** Player có đạt realm gate không. */
  unlocked: boolean;
  /** `false` khi `unlocked=false` hoặc đã hết slot daily. */
  startable: boolean;
  /** `staminaEntry > player.stamina`. */
  staminaShort: boolean;
  /** Số slot daily đã dùng / dailyLimit (null nếu không giới hạn). */
  dailyUsed: number;
  dailyLimit: number | null;
  /** Lý do (nếu có) ngăn `start`: `LOCKED_REALM` / `DAILY_LIMIT` / `STAMINA_LOW`. */
  lockReason: 'LOCKED_REALM' | 'DAILY_LIMIT' | 'STAMINA_LOW' | null;
}

/**
 * Phase 12.3 — Loot snapshot per killed monster. `loot` chính xác item drop
 * đã được `inventory.grant` với reason `DUNGEON_LOOT` (refType `DungeonRun`,
 * refId `run.id`). FE chỉ render — KHÔNG tự cộng inventory. Trường này có
 * thể `undefined` cho killed entry legacy trước Phase 12.3 (đã COMPLETED
 * hoặc lưu trong DB trước khi feature wire).
 */
export interface DungeonRunKilledEntry {
  monsterKey: string;
  killedAt: string;
  loot?: RolledLoot[];
}

export interface DungeonRunView {
  id: string;
  templateKey: string;
  status: DungeonRunStatus;
  encounterIndex: number;
  totalEncounters: number;
  /** Monster `dungeon.monsters[encounterIndex]` (next monster cần đánh).
   * `null` khi run COMPLETED/CLAIMED/ABANDONED hoặc index out-of-range. */
  currentMonster: MonsterDef | null;
  killedMonsters: DungeonRunKilledEntry[];
  startedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  /** Reward catalog snapshot — FE render preview claim button. */
  reward: DungeonRunReward | null;
}

export interface DungeonListView {
  available: DungeonAvailability[];
  activeRun: DungeonRunView | null;
}

export interface DungeonClaimResult {
  runId: string;
  templateKey: string;
  claimedAt: Date;
  granted: {
    linhThach: number;
    tienNgoc: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
  /**
   * Phase 14.0.C — territory buff applied (nếu có). FE display "+X từ
   * region buff". Empty array nếu không có buff (no-sect / non-owner /
   * no-region / fail-soft).
   */
  territoryBuff?: {
    regionKey: string;
    buffs: Array<{
      buffKey: string;
      buffType: string;
      value: number;
    }>;
    bonus: {
      linhThach: number;
      exp: number;
    };
  };
  /**
   * Phase 15.2 — LiveOps Event Scheduler `DOUBLE_DUNGEON_DROP` multiplier
   * applied (nếu có). Undefined khi không có event active hoặc multiplier
   * = 1.0 (không apply boost). FE render "Sự kiện ×1.5 drop" badge.
   */
  liveOpsDropMultiplier?: number;
  /**
   * Phase 16.5 — Daily reward cap result. `capped=true` khi total
   * EXP/linhThach grant từ DUNGEON đã chạm ngưỡng ngày. `granted` ở
   * trên đã là số THỰC SAU CAP (không lừa player).
   */
  capped: boolean;
  cappedAmount?: { exp: number; linhThach: number };
  dailyCapRemaining: { exp: number; linhThach: number };
}

function readRolledLoot(raw: unknown): RolledLoot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RolledLoot[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).itemKey === 'string' &&
      typeof (item as Record<string, unknown>).qty === 'number'
    ) {
      out.push({
        itemKey: (item as Record<string, string>).itemKey,
        qty: (item as Record<string, number>).qty,
      });
    }
  }
  return out;
}

function readKilledMonsters(json: Prisma.JsonValue | null): DungeonRunKilledEntry[] {
  if (!Array.isArray(json)) return [];
  const out: DungeonRunKilledEntry[] = [];
  for (const v of json) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof (v as Record<string, unknown>).monsterKey === 'string' &&
      typeof (v as Record<string, unknown>).killedAt === 'string'
    ) {
      const entry: DungeonRunKilledEntry = {
        monsterKey: (v as Record<string, string>).monsterKey,
        killedAt: (v as Record<string, string>).killedAt,
      };
      const loot = readRolledLoot((v as Record<string, unknown>).loot);
      if (loot && loot.length > 0) entry.loot = loot;
      out.push(entry);
    }
  }
  return out;
}

/**
 * Phase 12.2.B — Đọc env `MISSION_RESET_TZ` để xác định timezone của mốc
 * reset DAILY (mirror `combat.service.getCombatResetTz`). Mặc định
 * `Asia/Ho_Chi_Minh`. DungeonRun reuse cùng zone với combat dailyLimit /
 * mission DAILY / daily-login streak để keep daily-bucket invariant đồng nhất.
 */
function getDungeonRunResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

@Injectable()
export class DungeonRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly rewardCap: RewardCapService,
    @Optional() private readonly quests?: QuestService,
    @Optional() private readonly sectWar?: SectWarService,
    @Optional() private readonly territory?: TerritoryService,
    @Optional()
    private readonly liveOpsEvents?: LiveOpsEventSchedulerService,
    @Optional() private readonly dropEconomy?: DropEconomyService,
    // Phase 33.3 — Story V2 (Phase 33 catalog) kill/collect step deep wire.
    // Optional + đặt CUỐI constructor để giữ positional compat với Phase 12
    // tests construct `new DungeonRunService(prisma, ..., quests, undefined,
    // undefined, liveOps)` (xem liveops-event-runtime.integration.test).
    @Optional() private readonly phase33Story?: Phase33StoryService,
  ) {}

  /**
   * GET /dungeons/me — list catalog với availability flag + active run nếu có.
   * Realm gate + daily-slot count + stamina-check tính per-dungeon.
   *
   * `activeRun` priority: ACTIVE run trước (đang chạy), fallback COMPLETED +
   * `claimedAt = null` (player còn phải click claim qua UI). CLAIMED /
   * ABANDONED runs KHÔNG return.
   */
  async listForUser(userId: string): Promise<DungeonListView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        realmKey: true,
        stamina: true,
      },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const playerRealm = realmByKey(char.realmKey);
    const playerOrder = playerRealm?.order ?? -1;

    // Đếm daily count cho từng dungeon (1 query gộp).
    const tz = getDungeonRunResetTz();
    const dayStart = startOfLocalDay(new Date(), tz);
    const grouped = await this.prisma.dungeonRun.groupBy({
      by: ['templateKey'],
      where: {
        characterId: char.id,
        startedAt: { gte: dayStart },
      },
      _count: { _all: true },
    });
    const usedByKey = new Map<string, number>();
    for (const g of grouped) usedByKey.set(g.templateKey, g._count._all);

    const available: DungeonAvailability[] = [];
    for (const d of DUNGEONS) {
      const required = realmByKey(d.recommendedRealm);
      const requiredOrder = required?.order ?? 0;
      const unlocked = playerOrder >= requiredOrder;
      const used = usedByKey.get(d.key) ?? 0;
      const limit = typeof d.dailyLimit === 'number' && d.dailyLimit > 0 ? d.dailyLimit : null;
      const dailyExceeded = limit !== null && used >= limit;
      const staminaShort = char.stamina < d.staminaEntry;
      let lockReason: DungeonAvailability['lockReason'] = null;
      if (!unlocked) lockReason = 'LOCKED_REALM';
      else if (dailyExceeded) lockReason = 'DAILY_LIMIT';
      else if (staminaShort) lockReason = 'STAMINA_LOW';
      available.push({
        dungeon: d,
        unlocked,
        startable: unlocked && !dailyExceeded && !staminaShort,
        staminaShort,
        dailyUsed: used,
        dailyLimit: limit,
        lockReason,
      });
    }

    // Active priority: ACTIVE run trước (đang chạy). Nếu không có ACTIVE thì
    // fallback COMPLETED + chưa claim (player còn cần click claim button qua
    // UI — FE chỉ render activeRun nên BE phải expose COMPLETED unclaimed run
    // ở đây). CLAIMED/ABANDONED runs KHÔNG return (đã đóng vòng đời).
    let active = await this.prisma.dungeonRun.findFirst({
      where: { characterId: char.id, status: DungeonRunStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) {
      active = await this.prisma.dungeonRun.findFirst({
        where: {
          characterId: char.id,
          status: DungeonRunStatus.COMPLETED,
          claimedAt: null,
        },
        orderBy: { completedAt: 'desc' },
      });
    }
    return {
      available,
      activeRun: active ? this.toView(active) : null,
    };
  }

  /**
   * POST /dungeons/:templateKey/start — start run mới.
   * Validate ordered: NO_CHARACTER → DUNGEON_NOT_FOUND → DUNGEON_LOCKED_REALM
   * → DUNGEON_DAILY_LIMIT_REACHED → STAMINA_LOW → ALREADY_IN_RUN → create.
   */
  async startRun(userId: string, templateKey: string): Promise<DungeonRunView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true, stamina: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const dungeon = dungeonByKey(templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const required = realmByKey(dungeon.recommendedRealm);
    const requiredOrder = required?.order ?? 0;
    const playerRealm = realmByKey(char.realmKey);
    const playerOrder = playerRealm?.order ?? -1;
    if (playerOrder < requiredOrder) {
      throw new DungeonRunError('DUNGEON_LOCKED_REALM');
    }

    if (typeof dungeon.dailyLimit === 'number' && dungeon.dailyLimit > 0) {
      const tz = getDungeonRunResetTz();
      const dayStart = startOfLocalDay(new Date(), tz);
      const todayCount = await this.prisma.dungeonRun.count({
        where: {
          characterId: char.id,
          templateKey,
          startedAt: { gte: dayStart },
        },
      });
      if (todayCount >= dungeon.dailyLimit) {
        throw new DungeonRunError('DUNGEON_DAILY_LIMIT_REACHED');
      }
    }

    if (char.stamina < dungeon.staminaEntry) {
      throw new DungeonRunError('STAMINA_LOW');
    }

    const existingActive = await this.prisma.dungeonRun.findFirst({
      where: { characterId: char.id, status: DungeonRunStatus.ACTIVE },
      select: { id: true },
    });
    if (existingActive) throw new DungeonRunError('ALREADY_IN_RUN');

    // Validate dungeon catalog: ít nhất 1 monster + monster resolve được.
    if (dungeon.monsters.length === 0) {
      throw new DungeonRunError('DUNGEON_NOT_FOUND');
    }
    const firstMonster = monsterByKey(dungeon.monsters[0]);
    if (!firstMonster) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    // Atomic: trừ stamina + create run trong cùng transaction (anti-race
    // ALREADY_IN_RUN window). Nếu stamina raced (concurrent action khác
    // tiêu stamina), updateMany count=0 → throw STAMINA_LOW.
    const run = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.character.updateMany({
        where: { id: char.id, stamina: { gte: dungeon.staminaEntry } },
        data: { stamina: { decrement: dungeon.staminaEntry } },
      });
      if (upd.count !== 1) throw new DungeonRunError('STAMINA_LOW');

      return tx.dungeonRun.create({
        data: {
          characterId: char.id,
          templateKey,
          status: DungeonRunStatus.ACTIVE,
          encounterIndex: 0,
          killedMonsters: [] as Prisma.InputJsonValue,
        },
      });
    });

    return this.toView(run);
  }

  /**
   * POST /dungeon-runs/:runId/next — advance 1 encounter.
   * Resolve monster `dungeon.monsters[encounterIndex]` as killed:
   *   1. Track quest kill (`monster.key` + `questTargetIds[]`) fail-soft.
   *   2. Append to `killedMonsters` JSON.
   *   3. Increment `encounterIndex`.
   *   4. Nếu hết list → status=COMPLETED, set `completedAt`.
   *
   * Atomic với CAS guard `status=ACTIVE` updateMany count check chống race
   * 2 next call cùng runId.
   */
  async nextEncounter(userId: string, runId: string): Promise<DungeonRunView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const run = await this.prisma.dungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new DungeonRunError('RUN_NOT_FOUND');
    if (run.characterId !== char.id) throw new DungeonRunError('RUN_NOT_OWNED');
    if (run.status !== DungeonRunStatus.ACTIVE) {
      throw new DungeonRunError('RUN_NOT_ACTIVE');
    }

    const dungeon = dungeonByKey(run.templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const idx = run.encounterIndex;
    if (idx >= dungeon.monsters.length) {
      // Edge case: index past end nhưng status vẫn ACTIVE — đẩy về COMPLETED.
      throw new DungeonRunError('RUN_NOT_ACTIVE');
    }
    const monsterKey = dungeon.monsters[idx];
    const monster = monsterByKey(monsterKey);
    if (!monster) throw new DungeonRunError('DUNGEON_NOT_FOUND');

    const nextIndex = idx + 1;
    const isLast = nextIndex >= dungeon.monsters.length;
    const nowIso = new Date().toISOString();
    const killed = readKilledMonsters(run.killedMonsters);

    // Phase 12.3 — per-encounter random loot drop. Phase 12.4: ưu tiên
    // `monster.lootTable` (boss/elite override) → fallback `DUNGEON_LOOT[dungeon.key]`.
    // Roll TRƯỚC CAS update để snapshot loot vào `killedMonsters` JSON cùng
    // atomic write. Nếu CAS fail (race khác đã advance) → roll bị huỷ luôn,
    // không grant. Nếu CAS pass nhưng `inventory.grant` throw sau đó → killed
    // entry vẫn ghi loot đã roll, ledger row mất (fail-soft tránh block flow).
    const monsterLoot = rollMonsterLoot(monsterKey, 2);
    const loot = monsterLoot.length > 0 ? monsterLoot : rollDungeonLoot(dungeon.key, 2);
    const killedEntry: DungeonRunKilledEntry = { monsterKey, killedAt: nowIso };
    if (loot.length > 0) killedEntry.loot = loot;
    killed.push(killedEntry);

    // CAS guard: chỉ advance nếu vẫn ACTIVE + encounterIndex chưa thay đổi.
    const upd = await this.prisma.dungeonRun.updateMany({
      where: { id: run.id, status: DungeonRunStatus.ACTIVE, encounterIndex: idx },
      data: {
        encounterIndex: nextIndex,
        killedMonsters: killed as unknown as Prisma.InputJsonValue,
        status: isLast ? DungeonRunStatus.COMPLETED : DungeonRunStatus.ACTIVE,
        completedAt: isLast ? new Date() : null,
      },
    });
    if (upd.count !== 1) throw new DungeonRunError('RUN_NOT_ACTIVE');

    // Grant loot sau CAS — đảm bảo 1 winner / encounter advance ghi đúng 1 ledger
    // row. Reason `DUNGEON_LOOT` + refType `DungeonRun` + refId run.id. KHÔNG
    // idempotent (mirror combat.service `COMBAT_LOOT`). Fail-soft try/catch tránh
    // break flow nếu InventoryService throw — encounter đã advance không thể
    // rollback ở point này (CAS đã consume).
    if (loot.length > 0) {
      try {
        await this.inventory.grant(char.id, loot, {
          reason: 'DUNGEON_LOOT',
          refType: 'DungeonRun',
          refId: run.id,
          extra: { dungeonKey: dungeon.key, encounterIndex: idx },
        });
      } catch {
        // fail-soft: loot grant lỗi không fail next() — encounter advance bền
        // vững. Killed entry vẫn ghi loot đã roll cho FE display purposes;
        // ItemLedger row mất là cost chấp nhận được (mirror combat.service).
      }
    }

    // Phase 26.2 — Drop Economy V2 material grant per encounter. Source =
    // BODY_DUNGEON / ALCHEMY_DUNGEON / DUNGEON theo dungeon category (suy
    // ra từ dungeon key prefix `body_*` / `alchemy_*`). Boss cuối dùng
    // monsterType DUNGEON_BOSS, encounter thường dùng NORMAL/ELITE từ
    // `monster.monsterType` legacy mapping.
    if (this.dropEconomy) {
      try {
        const playerOrder = realmByKey(char.realmKey)?.order ?? 0;
        const sourceOrder =
          realmByKey(dungeon.recommendedRealm)?.order ?? playerOrder;
        const sourceTier = realmOrderToMaterialTier(sourceOrder);
        const baseType = inferDropMonsterType(monster.monsterType);
        const monsterType = isLast && baseType !== 'BOSS' ? 'DUNGEON_BOSS' : baseType;
        const source: DropSource = pickDungeonDropSource(dungeon.key);
        const dropMaterials = await this.dropEconomy.rollAndGrant(char.id, {
          playerRealmOrder: playerOrder,
          sourceTier,
          monsterType,
          source,
          dungeonTier: sourceTier,
          refType: 'DungeonRun',
          refId: run.id,
        });
        if (dropMaterials.length > 0) {
          // Snapshot drop materials vào killed entry (mirror legacy loot
          // snapshot — FE chỉ render, KHÔNG tự cộng inventory).
          const last = killed[killed.length - 1];
          if (last) {
            last.loot = [
              ...(last.loot ?? []),
              ...dropMaterials.map((d) => ({ itemKey: d.itemKey, qty: d.qty })),
            ];
            await this.prisma.dungeonRun.update({
              where: { id: run.id },
              data: { killedMonsters: killed as unknown as Prisma.InputJsonValue },
            });
          }
        }
      } catch {
        // fail-soft
      }
    }

    // Phase 12 PR-6 — quest kill step tracking, fail-soft. Mirror
    // `combat.service` flow: track `monster.key` + mọi `questTargetIds[*]`
    // (placeholder ánh xạ vào quest targetId trừu tượng như `son_thu`).
    if (this.quests) {
      const trackIds = new Set<string>([monster.key]);
      for (const id of monster.questTargetIds ?? []) trackIds.add(id);
      for (const id of trackIds) {
        try {
          await this.quests.track(char.id, 'kill', 'monster', id, 1);
        } catch {
          // fail-soft: quest tracking lỗi không nên break dungeon flow.
        }
      }
    }
    // Phase 33.3 — Story V2 (Phase 33 catalog) kill step tracking,
    // fail-soft, additive. Mở rộng quest hook mà KHÔNG đụng Phase 12.
    if (this.phase33Story) {
      const trackIds = new Set<string>([monster.key]);
      for (const id of monster.questTargetIds ?? []) trackIds.add(id);
      for (const id of trackIds) {
        try {
          await this.phase33Story.track(char.id, 'kill', 'monster', id, 1);
        } catch {
          // fail-soft: Story V2 không break Phase 12 dungeon-run path.
        }
      }
    }

    const fresh = await this.prisma.dungeonRun.findUnique({ where: { id: run.id } });
    return this.toView(fresh!);
  }

  /**
   * POST /dungeon-runs/:runId/claim — claim reward bonus.
   *
   * Idempotency CAS guard `claimedAt=null` (mirror QuestService.claim Phase 12
   * PR-3). Atomic transaction:
   *   1. CAS updateMany {status: COMPLETED, claimedAt: null} → CLAIMED.
   *   2. CurrencyService.applyTx (linhThach/tienNgoc) với reason
   *      'DUNGEON_RUN_REWARD' + refType='DungeonRun' + refId=runId.
   *   3. tx.character.update({ exp: { increment } }).
   *   4. InventoryService.grantTx (items) với cùng reason/refType/refId.
   *
   * Race 2 claim cùng runId → đúng 1 winner ghi 1 ledger row / runId.
   */
  async claimRun(userId: string, runId: string): Promise<DungeonClaimResult> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new DungeonRunError('NO_CHARACTER');

    const run = await this.prisma.dungeonRun.findUnique({ where: { id: runId } });
    if (!run) throw new DungeonRunError('RUN_NOT_FOUND');
    if (run.characterId !== char.id) throw new DungeonRunError('RUN_NOT_OWNED');
    if (run.status === DungeonRunStatus.CLAIMED || run.claimedAt !== null) {
      throw new DungeonRunError('RUN_ALREADY_CLAIMED');
    }
    if (run.status !== DungeonRunStatus.COMPLETED) {
      throw new DungeonRunError('RUN_NOT_COMPLETED');
    }

    const dungeon = dungeonByKey(run.templateKey);
    if (!dungeon) throw new DungeonRunError('DUNGEON_NOT_FOUND');
    const reward = dungeon.runReward;
    if (!reward) throw new DungeonRunError('RUN_NO_REWARD');

    const characterId = char.id;

    return this.prisma.$transaction(async (tx) => {
      // CAS race guard.
      const claimedAt = new Date();
      const upd = await tx.dungeonRun.updateMany({
        where: { id: run.id, status: DungeonRunStatus.COMPLETED, claimedAt: null },
        data: { status: DungeonRunStatus.CLAIMED, claimedAt },
      });
      if (upd.count !== 1) {
        throw new DungeonRunError('RUN_ALREADY_CLAIMED');
      }

      const linhThachBase = reward.linhThach ?? 0;
      const tienNgoc = reward.tienNgoc ?? 0;
      const expBase = reward.exp ?? 0;

      // Phase 15.2 — LiveOps Event Scheduler `DOUBLE_DUNGEON_DROP` boost.
      // Wire trước cap apply để bonus đi cùng base trong audit
      // `DUNGEON_RUN_REWARD`. Multiplier kẹp ≤ 2.0 (shared
      // `clampLiveOpsMultiplier`) — server-authoritative anti-balance.
      // Apply lên linhThach + item qty (drop semantics). KHÔNG apply lên
      // exp (đã có `CULTIVATION_EXP_BOOST` riêng) và tienNgoc (premium
      // currency không boost). Fail-soft: lỗi service → multiplier 1.0,
      // claim flow chính tiếp tục.
      let liveOpsDropMultiplier = 1.0;
      try {
        if (this.liveOpsEvents) {
          liveOpsDropMultiplier = await this.liveOpsEvents.getActiveMultiplier(
            'DOUBLE_DUNGEON_DROP',
          );
        }
      } catch {
        liveOpsDropMultiplier = 1.0;
      }
      const liveOpsLinhThachBonus = liveOpsDropMultiplier > 1
        ? Math.floor(linhThachBase * liveOpsDropMultiplier) - linhThachBase
        : 0;

      // Phase 14.0.C — Territory region buff (DUNGEON_REWARD context).
      // Apply BEFORE granting reward để bonus đi cùng base trong 1 ledger
      // entry (audit trail = `delta = base + bonus`, reason
      // `DUNGEON_RUN_REWARD`). Idempotent: outer CAS guard ngăn claim
      // retry → buff cũng exactly-once. Fail-soft: lỗi compute không
      // phá flow chính.
      const buffApplied = await this.computeDungeonTerritoryBuff(
        tx,
        characterId,
        dungeon,
      );
      const expBonus = buffApplied
        ? Math.floor(expBase * buffApplied.expMul) - expBase
        : 0;
      const linhThachBonus = buffApplied
        ? Math.floor(linhThachBase * buffApplied.linhThachMul) - linhThachBase
        : 0;
      const linhThachRequested =
        linhThachBase + linhThachBonus + liveOpsLinhThachBonus;
      const expRequested = expBase + expBonus;

      // Phase 16.5 — Daily Reward Cap. Cap apply trên total = base +
      // territory bonus (bonus là legitimate game-state buff, vẫn tính
      // vào ngân sách ngày). tienNgoc + items KHÔNG cap ở phase này
      // (phase 16.5 scope chỉ EXP + linhThach — premium currency tienNgoc
      // và items đi qua audit khác).
      const cap = await this.rewardCap.applyCapTx(tx, {
        characterId,
        source: 'DUNGEON',
        requestedExp: BigInt(expRequested),
        requestedLinhThach: BigInt(linhThachRequested),
        realmKey: char.realmKey,
        refType: 'DungeonRun',
        refId: run.id,
        meta: {
          templateKey: run.templateKey,
          baseExp: expBase,
          baseLinhThach: linhThachBase,
          territoryBonusExp: expBonus,
          territoryBonusLinhThach: linhThachBonus,
          liveOpsDropMultiplier,
          liveOpsLinhThachBonus,
        },
      });

      const linhThach = Number(cap.grantedLinhThach);
      const exp = Number(cap.grantedExp);

      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
          refId: run.id,
        });
      }
      if (tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(tienNgoc),
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
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
        // Phase 15.2 — apply DOUBLE_DUNGEON_DROP multiplier on item qty
        // (`Math.floor(qty * mul)`, ≥ 1). Multiplier đã clamp ≤ 2.0.
        const grantList = reward.items.map((it) => ({
          itemKey: it.itemKey,
          qty:
            liveOpsDropMultiplier > 1
              ? Math.max(1, Math.floor(it.qty * liveOpsDropMultiplier))
              : it.qty,
        }));
        await this.inventory.grantTx(tx, characterId, grantList, {
          reason: 'DUNGEON_RUN_REWARD',
          refType: 'DungeonRun',
          refId: run.id,
        });
        grantedItems.push(...grantList);
      }

      // Phase 13.1.A — Sect War contribution hook. Fail-soft: nếu sect-war
      // ghi điểm fail thì dungeon claim vẫn thành công (player đã grant
      // currency/items/exp). Idempotent qua composite UNIQUE
      // `(weekKey, characterId, activityKey, sourceType, sourceId)` —
      // retry endpoint cùng runId không double điểm.
      if (this.sectWar) {
        try {
          await this.sectWar.addContributionTx(tx, {
            characterId,
            activityKey: 'dungeon_clear',
            sourceId: run.id,
          });
        } catch {
          // swallow — sect-war là cosmetic + không phá flow chính.
        }
      }

      // Phase 14.0.A — Sect Territory influence hook. Fail-soft pattern
      // giống sect-war: dungeon claim vẫn thành công nếu territory ghi
      // fail. Idempotent qua composite UNIQUE
      // `(regionKey, characterId, sourceKey, sourceType, sourceId)` —
      // retry cùng runId không double điểm. RegionKey từ catalog
      // `dungeonByKey(run.templateKey).regionKey` — không có region thì
      // skip (legacy / non-region dungeon).
      if (this.territory && dungeon.regionKey) {
        try {
          await this.territory.addInfluenceTx(tx, {
            characterId,
            regionKey: dungeon.regionKey,
            sourceKey: 'dungeon_clear',
            sourceId: run.id,
          });
        } catch {
          // swallow — territory là cosmetic + không phá flow chính.
        }
      }

      const territoryBuff = buffApplied
        ? {
            regionKey: buffApplied.regionKey,
            buffs: buffApplied.buffs.map((b) => ({
              buffKey: b.buffKey,
              buffType: b.buffType,
              value: b.value,
            })),
            bonus: {
              linhThach: linhThachBonus,
              exp: expBonus,
            },
          }
        : undefined;

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
        liveOpsDropMultiplier:
          liveOpsDropMultiplier > 1 ? liveOpsDropMultiplier : undefined,
        territoryBuff,
        capped: cap.wasCapped,
        cappedAmount: cap.wasCapped
          ? {
              exp: Number(cap.cappedExp),
              linhThach: Number(cap.cappedLinhThach),
            }
          : undefined,
        dailyCapRemaining: {
          exp: Number(cap.remainingExp),
          linhThach: Number(cap.remainingLinhThach),
        },
      };
    });
  }

  /**
   * Phase 14.0.C — compute dungeon territory buff multiplier cho 1 character
   * tại reward time. Server-authoritative — KHÔNG phụ thuộc client input.
   *
   * Returns null nếu:
   *   - dungeon.regionKey null (legacy / world dungeon).
   *   - dungeon.regionKey === 'world'.
   *   - character không có sect.
   *   - region không có owner sect (chưa settle).
   *   - sect của character không phải owner.
   *   - region không có buff `DUNGEON_REWARD` trong catalog.
   *
   * Trả `{regionKey, expMul, linhThachMul, buffs}` — multiplier sẵn sàng
   * cho `Math.floor(base * mul)`. `expMul` / `linhThachMul` ≥ 1.
   *
   * Fail-soft: bất kỳ exception (DB error / catalog mismatch) → return
   * null (claim flow chính tiếp tục với base reward).
   */
  private async computeDungeonTerritoryBuff(
    tx: Prisma.TransactionClient,
    characterId: string,
    dungeon: DungeonDef,
  ): Promise<{
    regionKey: string;
    expMul: number;
    linhThachMul: number;
    buffs: TerritoryRegionBuffDef[];
  } | null> {
    if (!dungeon.regionKey || dungeon.regionKey === 'world') return null;
    try {
      const buffs = territoryRegionBuffsForRegion(dungeon.regionKey).filter(
        (b) => b.appliesTo.includes('DUNGEON_REWARD'),
      );
      if (buffs.length === 0) return null;

      const char = await tx.character.findUnique({
        where: { id: characterId },
        select: { sectId: true },
      });
      if (!char || !char.sectId) return null;

      const owner = await tx.sectTerritoryRegionState.findUnique({
        where: { regionKey: dungeon.regionKey },
        select: { ownerSectId: true },
      });
      if (!owner || !owner.ownerSectId) return null;
      if (owner.ownerSectId !== char.sectId) return null;

      let expMul = 1;
      let linhThachMul = 1;
      const applied: TerritoryRegionBuffDef[] = [];
      for (const buff of buffs) {
        if (buff.buffType === 'EXP_BONUS') {
          expMul += buff.value;
          applied.push(buff);
        } else if (buff.buffType === 'LINH_THACH_BONUS') {
          linhThachMul += buff.value;
          applied.push(buff);
        }
      }
      if (applied.length === 0) return null;
      return {
        regionKey: dungeon.regionKey,
        expMul,
        linhThachMul,
        buffs: applied,
      };
    } catch {
      // Fail-soft — không phá claim flow chính.
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────────────────

  private toView(run: DungeonRun): DungeonRunView {
    const dungeon = dungeonByKey(run.templateKey);
    const totalEncounters = dungeon?.monsters.length ?? 0;
    const idx = run.encounterIndex;
    const currentMonsterKey =
      dungeon && run.status === DungeonRunStatus.ACTIVE && idx < totalEncounters
        ? dungeon.monsters[idx]
        : null;
    const currentMonster = currentMonsterKey ? monsterByKey(currentMonsterKey) ?? null : null;
    return {
      id: run.id,
      templateKey: run.templateKey,
      status: run.status,
      encounterIndex: idx,
      totalEncounters,
      currentMonster,
      killedMonsters: readKilledMonsters(run.killedMonsters),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      claimedAt: run.claimedAt ? run.claimedAt.toISOString() : null,
      reward: dungeon?.runReward ?? null,
    };
  }
}

// Re-export catalog reference for tests.
export { DUNGEONS, REALMS };

/**
 * Phase 26.2 — Suy ra `DropSource` từ dungeon key.
 *
 * Convention catalog: dungeon key prefix
 *   - `body_*` / chứa `luyen_the` → `BODY_DUNGEON`
 *     (ưu tiên drop ALCHEMY_BODY / BODY_BREAKTHROUGH)
 *   - `alchemy_*` / chứa `luyen_dan` → `ALCHEMY_DUNGEON`
 *     (ưu tiên drop ALCHEMY_QI / FURNACE_UPGRADE)
 *   - default → `DUNGEON`
 *
 * Tách export ra ngoài để unit-testable (vitest service test) mà không
 * cần spin up Nest DI.
 */
export function pickDungeonDropSource(dungeonKey: string): DropSource {
  const k = dungeonKey.toLowerCase();
  if (k.startsWith('body_') || k.includes('luyen_the')) return 'BODY_DUNGEON';
  if (
    k.startsWith('alchemy_') ||
    k.includes('luyen_dan') ||
    k.includes('luyen_khi')
  ) {
    return 'ALCHEMY_DUNGEON';
  }
  return 'DUNGEON';
}
