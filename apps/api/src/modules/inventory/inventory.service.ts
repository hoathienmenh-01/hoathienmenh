import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { EquipSlot, Prisma } from '@prisma/client';
import {
  buffForItem,
  composeEquipmentElementalAtkBonus,
  composeEquippedItemElementResist,
  composeSocketBonus,
  getRefineStatMultiplier,
  itemByKey,
  itemOrGemByKey,
  type ElementKey,
  type ItemDef,
  type RolledLoot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BuffService } from '../character/buff.service';
import { CharacterService } from '../character/character.service';

/**
 * Lý do thay đổi vật phẩm — ghi vào `ItemLedger.reason`.
 * - Inflow:  COMBAT_LOOT | BOSS_REWARD | MARKET_BUY | MISSION_CLAIM
 *           | MAIL_CLAIM | GIFTCODE_REDEEM | SHOP_BUY | ADMIN_GRANT
 * - Outflow: USE | MARKET_SELL | ADMIN_REVOKE
 */
export type ItemLedgerReason =
  | 'COMBAT_LOOT'
  | 'BOSS_REWARD'
  | 'MARKET_BUY'
  | 'MARKET_SELL'
  | 'MISSION_CLAIM'
  | 'MAIL_CLAIM'
  | 'GIFTCODE_REDEEM'
  | 'SHOP_BUY'
  | 'ADMIN_GRANT'
  | 'ADMIN_REVOKE'
  | 'USE'
  // Phase 11.4.B Gem MVP runtime — socket / unsocket / combine ops.
  // Negative qtyDelta: GEM_SOCKET (consume gem) / GEM_COMBINE (consume 3 src).
  // Positive qtyDelta: GEM_UNSOCKET (return gem) / GEM_COMBINE (grant 1 next-tier).
  | 'GEM_SOCKET'
  | 'GEM_UNSOCKET'
  | 'GEM_COMBINE'
  // Phase 11.5.B Refine MVP runtime — luyện khí ops (consume material/protection).
  // Negative qtyDelta: REFINE_MATERIAL (consume `tinh_thiet`/`yeu_dan`/`han_ngoc`)
  // hoặc REFINE_PROTECTION (consume `refine_protection_charm` khi protection trigger).
  // KHÔNG có positive qtyDelta — refine không trả lại item dù fail.
  | 'REFINE_MATERIAL'
  | 'REFINE_PROTECTION'
  // Phase 11.10.D Achievement item rewards — claim achievement với
  // `def.reward.items` non-empty grant items qua AchievementService.claimReward
  // → InventoryService.grantTx (positive qtyDelta). Mirror với CurrencyLedger
  // reason `ACHIEVEMENT_REWARD` đã wire ở Phase 11.10.C-1 cho linhThach/tienNgoc.
  | 'ACHIEVEMENT_REWARD'
  // Phase 11.3.D Linh căn reroll — consume 1× `linh_can_dan` qua
  // SpiritualRootService.reroll (server-authoritative). Negative qtyDelta=-1.
  // Atomic cùng SpiritualRootRollLog.create + Character update (grade/element
  // /secondary/purity/rerollCount++).
  | 'SPIRITUAL_ROOT_REROLL'
  // Phase 11.2.D Skill book consume — consume 1× `skill_book_*` qua
  // CharacterSkillService.learnFromBook (server-authoritative). Negative
  // qtyDelta=-1. Atomic cùng InventoryItem decrement + CharacterSkill.create
  // ({ masteryLevel: 1, source: 'item_consume' }). Idempotent qua P2002 →
  // CharacterSkillError 'ALREADY_LEARNED' (item KHÔNG bị consume khi throw).
  | 'SKILL_LEARN'
  // Phase 12 Story PR-3 — Quest claim item rewards. Wire qua
  // `QuestService.claim → InventoryService.grantTx(positive qtyDelta)` với
  // `refType='Quest'` + `refId=questKey`. CAS claim guard
  // (`QuestProgress.claimedAt` updateMany) đảm bảo 1 winner / questKey
  // → grant đúng 1 lần / questKey / character. Mirror cùng `CurrencyLedger`
  // reason `QUEST_CLAIM` cho linhThach/tienNgoc (cùng `refId`).
  | 'QUEST_CLAIM'
  // Phase 12.2.B — DungeonRun completion reward bonus item grant. Wire qua
  // `DungeonRunService.claim → InventoryService.grantTx(positive qtyDelta)`
  // với `refType='DungeonRun'` + `refId=runId`. CAS claim guard
  // (`DungeonRun.claimedAt` updateMany) đảm bảo 1 winner / runId → grant đúng
  // 1 lần / runId / character. Mirror cùng `CurrencyLedger` reason
  // `DUNGEON_RUN_REWARD`. Khác `COMBAT_LOOT` (per-encounter random loot drop
  // trong combat flow turn-based, không idempotent — drop 1 lần per kill).
  | 'DUNGEON_RUN_REWARD'
  // Phase 12.3 — DungeonRun per-encounter loot drop. Wire qua
  // `DungeonRunService.nextEncounter → InventoryService.grant(positive qtyDelta)`
  // với `refType='DungeonRun'` + `refId=runId` + `extra={ dungeonKey,
  // encounterIndex }`. KHÔNG idempotent — mỗi `next()` call drop 1 lần (mirror
  // `COMBAT_LOOT`). Khác `DUNGEON_RUN_REWARD` (deterministic claim end-of-run,
  // idempotent qua CAS `claimedAt`). Khác `COMBAT_LOOT` ở refType: ledger filter
  // theo `refType` để telemetry / admin tách combat module vs dungeon-run module
  // mặc dù nguồn drop table chung (`DUNGEON_LOOT`).
  | 'DUNGEON_LOOT'
  // Phase 12.8.B — Story Dungeon claim reward bonus item grant. Wire qua
  // `StoryDungeonService.claim → InventoryService.grantTx(positive qtyDelta)`
  // với `refType='StoryDungeonRun'` + `refId=runId`. CAS claim guard
  // (`StoryDungeonRun.claimedAt` updateMany) đảm bảo 1 winner / runId →
  // grant đúng 1 lần / runId / character. Mirror cùng `CurrencyLedger`
  // reason `STORY_DUNGEON_REWARD` cho linhThach/tienNgoc.
  | 'STORY_DUNGEON_REWARD'
  // Phase 13.2.B — Sect Season milestone claim item grant. Wire qua
  // `SectSeasonService.claimMilestone → InventoryService.grantTx(positive
  // qtyDelta)` với `refType='SectSeasonClaim'` + `refId={seasonKey}:{milestoneKey}`.
  // CAS claim guard (UNIQUE `(characterId, seasonKey, milestoneKey)`) đảm
  // bảo 1 winner / milestone / character → grant đúng 1 lần. Mirror cùng
  // `CurrencyLedger` reason `SECT_SEASON_REWARD` cho linhThach/tienNgoc.
  | 'SECT_SEASON_REWARD'
  // Phase 12.10.B — NPC gift item consume. Wire qua
  // `NpcAffinityService.giftNpcTx → consumeOneByItemKeyTx(negative qtyDelta=-1)`
  // với `refType='CharacterNpcGiftLog'` + `refId={giftLogId}`. CAS guard
  // qua `CharacterNpcGiftLog` composite UNIQUE `(characterId, npcKey,
  // dayBucket, sequence)` đảm bảo daily limit + atomic decrement + grant
  // affinity all-or-nothing. KHÔNG mirror `CurrencyLedger` (gift không tiêu
  // currency).
  | 'NPC_GIFT'
  // Phase 12.10.C — NPC Affinity Shop purchase. Wire
  // `NpcAffinityShopService.buyTx → grantTx(positive qtyDelta)` với
  // `refType='NpcAffinityShop'` + `refId='${npcKey}:${itemKey}'`. Daily/weekly
  // limit enforce qua aggregate (`reason='NPC_SHOP_BUY'`, `refId`) +
  // `createdAt` window (start of local day / week MISSION_RESET_TZ). Mirror
  // cùng `CurrencyLedger` reason `NPC_SHOP_BUY` cho linhThach/tienNgoc.
  | 'NPC_SHOP_BUY'
  // Phase 14.3.C — Tribulation support item consume khi player attempt thiên
  // kiếp với selectedSupportItemKeys non-empty. Wire qua
  // `TribulationService.attemptTribulation → consumeOneByItemKeyTx(negative
  // qtyDelta=-1)` per selected key, **trong cùng transaction** với
  // `TribulationAttemptLog.create` + `Character.update` (success path)
  // hoặc penalty apply (fail path). `refType='TribulationAttemptLog'` +
  // `refId={logId}` để link audit consume → attempt outcome.
  //
  // Failed attempt vẫn consume item — design choice để player phải tính toán
  // build trước khi attempt, không thể "lãng phí" thử rồi refund.
  // Atomic guarantee: nếu consume fail (qty đã=0 do race) → throw
  // SUPPORT_ITEM_MISSING → rollback toàn bộ tx (KHÔNG ghi log, KHÔNG mất exp,
  // KHÔNG cooldown). Player retry an toàn.
  | 'TRIBULATION_SUPPORT_CONSUME'
  // Phase 12.10.D — NPC Relationship Quest Chain claim item grant. Wire qua
  // `NpcRelationshipChainService.claimChain → InventoryService.grantTx
  // (positive qtyDelta)` với `refType='NpcRelationshipChain'` + `refId=chainKey`.
  // Idempotency CAS qua `Character.storyFlags['relchain_<chainKey>_claimed']`
  // JSON-path guard — đảm bảo grant đúng 1 lần / chain / character. Mirror
  // cùng `CurrencyLedger` reason `NPC_RELATIONSHIP_CHAIN_REWARD`.
  | 'NPC_RELATIONSHIP_CHAIN_REWARD';

export interface ItemLedgerMeta {
  reason: ItemLedgerReason;
  refType?: string;
  refId?: string;
  actorUserId?: string;
  extra?: Prisma.InputJsonValue;
}

export class InventoryError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'ITEM_NOT_FOUND'
      | 'INVENTORY_ITEM_NOT_FOUND'
      | 'NOT_EQUIPPABLE'
      | 'NOT_USABLE'
      | 'WRONG_SLOT'
      | 'ALREADY_USED'
      | 'INSUFFICIENT_QTY',
  ) {
    super(code);
  }
}

export interface InventoryView {
  id: string;
  itemKey: string;
  qty: number;
  equippedSlot: EquipSlot | null;
  item: ItemDef;
  /** Phase 11.4.B Gem MVP — danh sách gemKey đã khảm theo thứ tự slot. */
  sockets: string[];
  /** Phase 11.5.B Refine MVP — cấp luyện khí 0..15. */
  refineLevel: number;
}

export interface EquipBonusSummary {
  atk: number;
  def: number;
  hpMaxBonus: number;
  mpMaxBonus: number;
  spiritBonus: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(forwardRef(() => CharacterService))
    private readonly chars: CharacterService,
    // Phase 11.10.E — Pill/elixir consume → apply BuffDef cùng tx với
    // inventory decrement. Optional inject để giữ legacy bootstrap (test
    // không có DI module) tiếp tục work — null = skip apply, không throw.
    @Inject(forwardRef(() => BuffService))
    private readonly buffs?: BuffService,
  ) {}

  async list(characterId: string): Promise<InventoryView[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { characterId },
      orderBy: [{ equippedSlot: 'asc' }, { createdAt: 'asc' }],
    });
    const out: InventoryView[] = [];
    for (const r of rows) {
      // Phase 11.4.C — fallback `itemOrGemByKey` để gem inventory rows
      // (itemKey = 'gem_*') không bị skip; trước đó `itemByKey` chỉ
      // search ITEMS catalog → gem rows undefined → vô hình trên UI.
      const item = itemOrGemByKey(r.itemKey);
      if (!item) continue;
      out.push({
        id: r.id,
        itemKey: r.itemKey,
        qty: r.qty,
        equippedSlot: r.equippedSlot,
        item,
        sockets: r.sockets,
        refineLevel: r.refineLevel,
      });
    }
    return out;
  }

  /**
   * Tổng bonus từ trang bị đang đeo của 1 character. Dùng trong combat.
   *
   * Phase 11.4.B: cộng thêm `composeSocketBonus(item.sockets)` cho mọi
   * equipped item — socket bonus stack additive với base bonus, không cap
   * ở service này (cap ở `BALANCE_MODEL.md` §6 enforce qua quality
   * → `socketCapacityForQuality()` cap số lượng gem mỗi item).
   *
   * Phase 11.5.B: nhân `getRefineStatMultiplier(item.refineLevel)` lên
   * (base bonus + socket bonus) per item — luyện khí amplify tổng power
   * của trang bị. Refine 0 = no-op (multiplier 1.0). Cộng dồn additive
   * sang summary sau khi đã scale per-item.
   */
  async equipBonus(characterId: string): Promise<EquipBonusSummary> {
    const equipped = await this.prisma.inventoryItem.findMany({
      where: { characterId, equippedSlot: { not: null } },
    });
    let atk = 0;
    let def = 0;
    let hpMaxBonus = 0;
    let mpMaxBonus = 0;
    let spiritBonus = 0;
    for (const r of equipped) {
      const def_ = itemByKey(r.itemKey);
      if (!def_) continue;
      let itemAtk = 0;
      let itemDef = 0;
      let itemHpMax = 0;
      let itemMpMax = 0;
      let itemSpirit = 0;
      if (def_.bonuses) {
        itemAtk += def_.bonuses.atk ?? 0;
        itemDef += def_.bonuses.def ?? 0;
        itemHpMax += def_.bonuses.hpMax ?? 0;
        itemMpMax += def_.bonuses.mpMax ?? 0;
        itemSpirit += def_.bonuses.spirit ?? 0;
      }
      // Phase 11.4.B socket bonus.
      if (r.sockets.length > 0) {
        const sb = composeSocketBonus(r.sockets);
        itemAtk += sb.atk ?? 0;
        itemDef += sb.def ?? 0;
        itemHpMax += sb.hpMax ?? 0;
        itemMpMax += sb.mpMax ?? 0;
        itemSpirit += sb.spirit ?? 0;
      }
      // Phase 11.5.B refine multiplier (1.0 nếu refineLevel=0).
      const mult = getRefineStatMultiplier(r.refineLevel);
      atk += Math.round(itemAtk * mult);
      def += Math.round(itemDef * mult);
      hpMaxBonus += Math.round(itemHpMax * mult);
      mpMaxBonus += Math.round(itemMpMax * mult);
      spiritBonus += Math.round(itemSpirit * mult);
    }
    return { atk, def, hpMaxBonus, mpMaxBonus, spiritBonus };
  }

  /**
   * Phase 11.6.E — equipment elemental tribulation resist composer.
   *
   * Aggregate `ItemBonus.elementResist` từ TẤT CẢ trang bị đang đeo của
   * character, fold qua {@link composeEquippedItemElementResist} (multiply
   * stack per element). Trả `ReadonlyMap<ElementKey, number>` cho
   * `TribulationService.attemptTribulation` `elementResistFn` consume.
   *
   * KHÔNG áp refine multiplier hay socket bonus — element resist là flat
   * multiplier per item, không scale theo refine level (refine làm tăng raw
   * stat, không tăng resist). Phase tương lai có thể wire socket gem element
   * resist vào đây nếu thêm gem kind `element_resist`.
   *
   * Wire điểm: `apps/api/src/modules/character/tribulation.service.ts`
   * inject `InventoryService` Optional (legacy test → fallback empty map).
   * Compose chain: `rootResist × talentResist × equipmentResist`, clamp
   * `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR, ELEMENT_MODIFIER_ABSOLUTE_CEIL]` qua
   * envelope chung.
   *
   * Empty map nếu character không trang bị nào có `elementResist` (legacy
   * armor + weapon thông thường) — composer fallback identity 1.0.
   */
  async equipElementResistMods(
    characterId: string,
  ): Promise<ReadonlyMap<ElementKey, number>> {
    const equipped = await this.prisma.inventoryItem.findMany({
      where: { characterId, equippedSlot: { not: null } },
    });
    if (equipped.length === 0) {
      return new Map<ElementKey, number>();
    }
    const bonuses = equipped
      .map((r) => itemByKey(r.itemKey)?.bonuses)
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    return composeEquippedItemElementResist(bonuses);
  }

  /**
   * **Phase 14.2.A** — compose Ngũ Hành combat ATK bonus từ trang bị đang đeo
   * cho 1 skill element. Trả additive bonus (e.g. `0.07` = +7% damage). Stack
   * additive across equipped items, capped per-item + total qua
   * {@link composeEquipmentElementalAtkBonus}. Pure delegate; consume bởi
   * `CombatService.action` / `actionViaActiveTalent` Phase 14.2.A pipeline.
   *
   * Empty / `0` nếu:
   *   - Không trang bị nào có `ItemBonus.elementalAtkBonus` (legacy default).
   *   - `skillElement` null (vô hệ skill / basic attack).
   *   - Catalog chưa khai báo bonus cho element này.
   *
   * Khác `equipElementResistMods` (tribulation kháng kiếp) — `equipElementalAtkBonus`
   * là **bonus tấn công** trong combat. 2 method độc lập, đọc 2 field riêng
   * (`elementResist` vs `elementalAtkBonus`).
   */
  async equipElementalAtkBonus(
    characterId: string,
    skillElement: ElementKey | null,
  ): Promise<number> {
    if (skillElement === null) return 0;
    const equipped = await this.prisma.inventoryItem.findMany({
      where: { characterId, equippedSlot: { not: null } },
    });
    if (equipped.length === 0) return 0;
    const bonuses = equipped
      .map((r) => itemByKey(r.itemKey)?.bonuses)
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    return composeEquipmentElementalAtkBonus(bonuses, skillElement);
  }

  /**
   * Thêm item vào túi: stackable thì gộp qty, không thì tạo row mới.
   * Mọi grant đều ghi `ItemLedger` để audit (qtyDelta dương).
   */
  async grant(
    characterId: string,
    loot: RolledLoot[],
    meta: ItemLedgerMeta,
  ): Promise<void> {
    for (const l of loot) {
      await this.grantOneTx(this.prisma, characterId, l.itemKey, l.qty, meta);
    }
  }

  /** Tx-aware grant — dùng trong reward distribution boss/market/mail/giftcode. */
  async grantTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    items: { itemKey: string; qty: number }[],
    meta: ItemLedgerMeta,
  ): Promise<void> {
    for (const it of items) {
      await this.grantOneTx(tx, characterId, it.itemKey, it.qty, meta);
    }
  }

  private async grantOneTx(
    db: Prisma.TransactionClient | PrismaService,
    characterId: string,
    itemKey: string,
    qty: number,
    meta: ItemLedgerMeta,
  ): Promise<void> {
    const def = itemByKey(itemKey);
    if (!def) return;
    if (qty <= 0) return;
    if (def.stackable) {
      const existing = await db.inventoryItem.findFirst({
        where: { characterId, itemKey, equippedSlot: null },
      });
      if (existing) {
        await db.inventoryItem.update({
          where: { id: existing.id },
          data: { qty: { increment: qty } },
        });
        await this.writeLedgerTx(db, characterId, itemKey, qty, meta);
        return;
      }
    }
    await db.inventoryItem.create({
      data: { characterId, itemKey, qty },
    });
    await this.writeLedgerTx(db, characterId, itemKey, qty, meta);
  }

  private async writeLedgerTx(
    db: Prisma.TransactionClient | PrismaService,
    characterId: string,
    itemKey: string,
    qtyDelta: number,
    meta: ItemLedgerMeta,
  ): Promise<void> {
    await db.itemLedger.create({
      data: {
        characterId,
        itemKey,
        qtyDelta,
        reason: meta.reason,
        refType: meta.refType ?? null,
        refId: meta.refId ?? null,
        actorUserId: meta.actorUserId ?? null,
        meta: meta.extra ?? {},
      },
    });
  }

  /**
   * Phase 12.10.B — atomic "consume 1 stack of `itemKey`" inside an existing
   * transaction. Mirror `use()` decrement pattern (race-safe `updateMany` với
   * filter `qty > 0`) nhưng KHÔNG resolve qua `inventoryItemId` (vì caller
   * `NpcAffinityService.giftNpcTx` chỉ biết `itemKey`).
   *
   * Algorithm:
   *   1. Find first non-equipped row với `qty >= 1` (deterministic order theo
   *      `createdAt` ASC — oldest stack first, không phá row đang đeo).
   *   2. `updateMany({ id, qty: { gt: 0 } }, { qty: { decrement: 1 } })` →
   *      atomic decrement. Race với concurrent gift / use → một thread thắng,
   *      thread kia thấy count=0 → throw `INVENTORY_ITEM_NOT_FOUND`.
   *   3. Post-decrement: nếu qty xuống 0 → delete row.
   *   4. Write ledger (`qtyDelta=-1`, `meta.reason=meta.reason`).
   *
   * Caller chịu trách nhiệm wrap toàn bộ logic (consume + grant affinity +
   * gift log create) trong cùng `$transaction` cho atomic all-or-nothing.
   *
   * Throws:
   *   - `ITEM_NOT_FOUND` — itemKey không thuộc catalog.
   *   - `INVENTORY_ITEM_NOT_FOUND` — character không có row qty>=1 (gift KHÔNG
   *     consume row đang `equippedSlot != null` để tránh tháo trang bị bất ngờ).
   */
  async consumeOneByItemKeyTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    itemKey: string,
    meta: ItemLedgerMeta,
  ): Promise<void> {
    const def = itemByKey(itemKey);
    if (!def) throw new InventoryError('ITEM_NOT_FOUND');
    const candidate = await tx.inventoryItem.findFirst({
      where: { characterId, itemKey, equippedSlot: null, qty: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
    const decResult = await tx.inventoryItem.updateMany({
      where: { id: candidate.id, qty: { gt: 0 } },
      data: { qty: { decrement: 1 } },
    });
    if (decResult.count === 0) {
      // Race: concurrent gift / use chiếm slot. Throw để caller rollback tx.
      throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
    }
    const post = await tx.inventoryItem.findUnique({
      where: { id: candidate.id },
      select: { qty: true },
    });
    if (post && post.qty === 0) {
      await tx.inventoryItem.delete({ where: { id: candidate.id } });
    }
    await this.writeLedgerTx(tx, characterId, itemKey, -1, meta);
  }

  /**
   * Admin revoke — thu hồi item khỏi túi người chơi. Ghi ledger `ADMIN_REVOKE`.
   *
   * Logic:
   *  1. Tổng qty của `itemKey` trên character = Σ qty của mọi row (equipped + unequipped stack).
   *  2. Nếu tổng < qty yêu cầu → throw `INSUFFICIENT_QTY`. KHÔNG trừ một phần (atomic).
   *  3. Ưu tiên trừ từ row KHÔNG equipped trước (tránh làm player bị mất trang bị đang đeo
   *     đột ngột). Nếu hết row non-equipped mà vẫn còn nợ → đụng row equipped,
   *     nhưng clear `equippedSlot` khi hết sạch row đó.
   *  4. Row qty → 0: delete row.
   *  5. Ghi ledger với `qtyDelta = -qty` (total), `reason = ADMIN_REVOKE`.
   *
   * Caller (AdminService) chịu trách nhiệm check role hierarchy + audit log.
   */
  async revoke(
    characterId: string,
    itemKey: string,
    qty: number,
    meta: Omit<ItemLedgerMeta, 'reason'>,
  ): Promise<void> {
    if (qty <= 0) throw new InventoryError('INSUFFICIENT_QTY');
    const def = itemByKey(itemKey);
    if (!def) throw new InventoryError('ITEM_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.inventoryItem.findMany({
        where: { characterId, itemKey },
        orderBy: [
          // non-equipped trước (equippedSlot IS NULL → true → xếp trước)
          { equippedSlot: 'asc' },
          { createdAt: 'asc' },
        ],
      });
      const total = rows.reduce((s, r) => s + r.qty, 0);
      if (total < qty) throw new InventoryError('INSUFFICIENT_QTY');

      let remaining = qty;
      // Chiến lược "non-equipped trước": sort lại thủ công vì Prisma sort NULL
      // theo locale DB, không ổn định.
      const sorted = [...rows].sort((a, b) => {
        const ae = a.equippedSlot === null ? 0 : 1;
        const be = b.equippedSlot === null ? 0 : 1;
        if (ae !== be) return ae - be;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      // Atomic per-row guard chống concurrent revoke race (2 admin call song
      // song trên cùng character/itemKey). Trước fix: `data: { qty: r.qty -
      // take }` capture JS variable (đọc từ findMany trước tx commit) → 2
      // thread cùng update qty=N-take = under-revoke (ledger ghi -N+ -N
      // nhưng row chỉ giảm 1× take). Sau fix: `updateMany` + `deleteMany`
      // với guard `qty: { gte: take }` / `qty: take` → chỉ 1 thread succeed
      // nếu concurrent đụng cùng row, thread sau throw INSUFFICIENT_QTY →
      // tx rollback giữ ledger-row delta consistent. Pattern parity với
      // `use()` atomic decrement (Phase 12.X).
      for (const r of sorted) {
        if (remaining <= 0) break;
        const take = Math.min(r.qty, remaining);
        remaining -= take;
        if (r.qty === take) {
          // Take whole row → guarded delete (chỉ delete nếu DB qty còn = take).
          // Nếu concurrent revoke đã decrement row → count=0 → throw.
          const delResult = await tx.inventoryItem.deleteMany({
            where: { id: r.id, qty: take },
          });
          if (delResult.count === 0) {
            throw new InventoryError('INSUFFICIENT_QTY');
          }
        } else {
          // Take partial → guarded decrement. Filter `qty >= take` đảm bảo
          // row còn đủ (concurrent không lấy bớt). count=0 → throw.
          const decResult = await tx.inventoryItem.updateMany({
            where: { id: r.id, qty: { gte: take } },
            data: { qty: { decrement: take } },
          });
          if (decResult.count === 0) {
            throw new InventoryError('INSUFFICIENT_QTY');
          }
          // Post-decrement: nếu row qty xuống 0 (concurrent decrement xảy ra
          // trước update của ta) → delete giữ invariant `qty >= 1` cho row sống.
          const post = await tx.inventoryItem.findUnique({ where: { id: r.id } });
          if (post && post.qty === 0) {
            await tx.inventoryItem.delete({ where: { id: r.id } });
          }
        }
      }

      await this.writeLedgerTx(tx, characterId, itemKey, -qty, {
        reason: 'ADMIN_REVOKE',
        refType: meta.refType,
        refId: meta.refId,
        actorUserId: meta.actorUserId,
        extra: meta.extra,
      });
    });
  }

  async equip(userId: string, inventoryItemId: string): Promise<InventoryView[]> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new InventoryError('NO_CHARACTER');
    const inv = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!inv || inv.characterId !== char.id) {
      throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
    }
    const def = itemByKey(inv.itemKey);
    if (!def) throw new InventoryError('ITEM_NOT_FOUND');
    if (!def.slot) throw new InventoryError('NOT_EQUIPPABLE');

    await this.prisma.$transaction(async (tx) => {
      // Tháo món hiện tại ở slot này (nếu có)
      const cur = await tx.inventoryItem.findFirst({
        where: { characterId: char.id, equippedSlot: def.slot ?? undefined },
      });
      if (cur && cur.id !== inv.id) {
        await tx.inventoryItem.update({
          where: { id: cur.id },
          data: { equippedSlot: null },
        });
      }
      await tx.inventoryItem.update({
        where: { id: inv.id },
        data: { equippedSlot: def.slot ?? null },
      });
    });

    await this.refreshState(userId);
    return this.list(char.id);
  }

  async unequip(userId: string, slot: EquipSlot): Promise<InventoryView[]> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new InventoryError('NO_CHARACTER');
    const cur = await this.prisma.inventoryItem.findFirst({
      where: { characterId: char.id, equippedSlot: slot },
    });
    if (!cur) throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
    await this.prisma.inventoryItem.update({
      where: { id: cur.id },
      data: { equippedSlot: null },
    });
    await this.refreshState(userId);
    return this.list(char.id);
  }

  async use(userId: string, inventoryItemId: string): Promise<InventoryView[]> {
    const char = await this.prisma.character.findUnique({ where: { userId } });
    if (!char) throw new InventoryError('NO_CHARACTER');
    const inv = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!inv || inv.characterId !== char.id) {
      throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
    }
    const def = itemByKey(inv.itemKey);
    if (!def) throw new InventoryError('ITEM_NOT_FOUND');
    if (!def.effect) throw new InventoryError('NOT_USABLE');

    const updates: Record<string, unknown> = {};
    if (def.effect.hp) {
      updates.hp = Math.min(char.hpMax, char.hp + def.effect.hp);
    }
    if (def.effect.mp) {
      updates.mp = Math.min(char.mpMax, char.mp + def.effect.mp);
    }
    if (def.effect.exp) {
      updates.exp = { increment: BigInt(def.effect.exp) };
    }

    // Phase 11.10.E — Pill/elixir buff effect. Pre-resolve BuffDef trước khi
    // mở tx để fail-fast nếu catalog drift (item declared `buffKey` nhưng
    // buff không tồn tại) — tránh decrement inventory rồi mới phát hiện.
    const buffDef = def.effect.buffKey ? buffForItem(inv.itemKey) : undefined;
    if (def.effect.buffKey && !buffDef) {
      // Catalog drift: item.effect.buffKey trỏ tới buff không tồn tại.
      // Hard fail KHÔNG decrement — guard against silent loss of pill.
      throw new InventoryError('ITEM_NOT_FOUND');
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic decrement guard concurrent use() race trên cùng inventoryItemId
      // (player double-click / network retry / bot grind). `updateMany` với
      // filter `qty > 0` + `decrement: 1` đảm bảo chỉ N thread đầu tiên (với
      // N = current qty) lấy được slot — thread thứ N+1+ thấy count=0 → throw
      // INVENTORY_ITEM_NOT_FOUND. Trước đó: `data: { qty: inv.qty - 1 }` capture
      // JS variable (đọc trước tx) → 2 thread cùng update qty=N-1 = item duplication
      // EXPLOITABLE (tiêu effect 2 lần nhưng chỉ trừ 1 đan).
      const decResult = await tx.inventoryItem.updateMany({
        where: { id: inv.id, qty: { gt: 0 } },
        data: { qty: { decrement: 1 } },
      });
      if (decResult.count === 0) {
        throw new InventoryError('INVENTORY_ITEM_NOT_FOUND');
      }
      // Post-decrement: nếu row qty xuống 0 → delete (giữ invariant `qty >= 1`
      // cho row sống). Refetch để biết qty chính xác sau atomic decrement.
      const post = await tx.inventoryItem.findUnique({ where: { id: inv.id } });
      if (post && post.qty === 0) {
        await tx.inventoryItem.delete({ where: { id: inv.id } });
      }

      await tx.character.update({ where: { id: char.id }, data: updates });
      await this.writeLedgerTx(tx, char.id, inv.itemKey, -1, {
        reason: 'USE',
        refType: 'InventoryItem',
        refId: inv.id,
      });

      // Phase 11.10.E — apply pill buff cùng tx với decrement (atomic):
      // tx fail → buff KHÔNG insert + pill KHÔNG decrement (nguyên trạng).
      // Idempotent qua `CharacterBuff` composite UNIQUE: non-stackable
      // refresh `expiresAt`, stackable +1 stack cap `maxStacks` (4 pill
      // baseline đều non-stackable). Optional `buffs` inject — legacy
      // bootstrap (no DI) skip silently.
      if (buffDef && this.buffs) {
        await this.buffs.applyBuffTx(tx, char.id, buffDef.key, 'pill');
      }
    });

    await this.refreshState(userId);
    return this.list(char.id);
  }

  private async refreshState(userId: string): Promise<void> {
    const state = await this.chars.findByUser(userId);
    if (state) this.realtime.emitToUser(userId, 'state:update', state);
  }
}
