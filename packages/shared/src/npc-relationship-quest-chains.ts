/**
 * Phase 12.10.D — NPC Relationship Quest Chain catalog.
 *
 * Mỗi NPC trụ cột có một (hoặc vài) "tuyến nhiệm vụ quan hệ" — gói các quest
 * có sẵn trong `QUESTS[]` thành chuỗi narrative gắn với NPC, gate mở dần theo
 * affinity tier, kết thúc cấp một reward nhỏ + story flag.
 *
 *   - `requiredAffinityTier` — tier tối thiểu (thuộc `AFFINITY_TIERS`) để FE
 *     hiển thị chain ở trạng thái UNLOCKED. LOCKED chain chỉ hiện hint
 *     "Đạt {tier} với {npcName} để mở".
 *   - `questKeys[]` — tham chiếu `QUESTS[].key`. Server không tự nhận quest hộ
 *     player; chain hoàn thành khi tất cả quest CLAIMED. Quest order trong
 *     mảng = thứ tự narrative để FE render progress.
 *   - `dialogueNodeKeys[]` — tham chiếu `STORY_DIALOGUES[].id`. CTA trong UI
 *     mở `StoryDialogueModal` đúng node tương ứng (vd "tâm sự" hoặc "kết
 *     nguyện").
 *   - `rewardHint` — preview reward nhỏ khi claim chain. Cap thấp hơn quest
 *     bình thường để giữ economy (xem `docs/BALANCE_MODEL.md`).
 *   - `endingFlags` — flag set vào `Character.storyFlags` khi player claim
 *     chain. Phục vụ điều kiện `flag_set` cho dialogue / quest sau này.
 *
 * KHÔNG mutate `QUESTS` / `STORY_DIALOGUES` runtime — catalog chỉ ghép view.
 * KHÔNG dynamic add quest mới qua chain — chỉ tag quest đã có.
 *
 * Idempotency: chain claim ghi `storyFlags['relchain_<chainKey>_claimed']='1'`
 * + `endingFlags`. API `npc-relationship.service.ts` dùng JSON-path CAS
 * `where: { storyFlags: { path: [...], equals: Prisma.DbNull } }` để đảm bảo
 * 2 concurrent claim chỉ một thắng → grant đúng 1 lần.
 *
 * Refs:
 *   - `docs/story/PHASE12_STORY_PROGRESS.md` Phase 12.10.D row.
 *   - `docs/BALANCE_MODEL.md` — chain reward cap.
 */

import { NPCS, npcByKey } from './npcs';
import { QUESTS, questByKey, questsByChain } from './quests';
import { STORY_DIALOGUES } from './story-dialogues';
import {
  AFFINITY_TIERS,
  NPC_AFFINITY,
  npcAffinityDefForKey,
  type AffinityTierDef,
  type AffinityTierKey,
} from './npc-affinity';
import { itemByKey } from './items';

/**
 * Reward preview cho chain completion. Cap (verified ở `BALANCE_MODEL.md`):
 *   - `affinity` ≤ `AFFINITY_DELTA_CAP_PER_QUEST_REWARD` (40) — theo tier.
 *   - `linhThach` ≤ 500 — bằng nửa quest reward chính.
 *   - `tienNgoc` ≤ 10 — premium currency rất giới hạn.
 *   - `exp` ≤ 600 — bằng 1 quest tier thấp.
 *   - `items` 0..3 entries, mỗi item `qty` ≤ 5 (stackable) hoặc =1 (non-stack).
 */
export interface NpcRelationshipChainRewardHint {
  /** Affinity bonus áp dụng khi claim chain. Cap 40 (verified validator). */
  readonly affinity: number;
  readonly linhThach: number;
  readonly tienNgoc: number;
  readonly exp: number;
  readonly items: ReadonlyArray<{ readonly itemKey: string; readonly qty: number }>;
  /** Optional flag-only chain — không cấp reward, chỉ cấp story flag. */
  readonly flagOnly?: boolean;
}

/**
 * Story flags set khi chain hoàn thành. Mỗi flag value lưu vào
 * `Character.storyFlags` (Json map). KHÔNG ghi đè flag đã có nếu trùng key —
 * service dedupe last-write-wins (xem `npc-relationship.service.ts`).
 *
 * Convention: prefix `rel_<npcKey_short>_` để tránh collision với story flag
 * Phase 12.9. Value chuẩn: '1' (truthy) — keep schema đơn giản. Custom
 * value (vd `'truce'` / `'hostile'`) cho phép branching dialogue dùng
 * `flag_equals`.
 */
export type NpcRelationshipChainEndingFlags = Readonly<
  Record<string, string | number | boolean>
>;

/**
 * Phase 12.10.D — chain definition. Một NPC có thể có nhiều chain (vd path A
 * `truce` vs path B `rivalry`); tách bằng `chainKey` riêng + `endingFlags`
 * phân nhánh.
 */
export interface NpcRelationshipQuestChainDef {
  readonly chainKey: string;
  /** Reference `NPCS[].key` + `NPC_AFFINITY[].npcKey`. */
  readonly npcKey: string;
  /** Display title — i18n VI primary. */
  readonly title: string;
  readonly titleEn: string;
  /** Short narrative blurb cho FE preview. */
  readonly description: string;
  readonly descriptionEn: string;
  /** Tier player phải đạt với NPC để chain hiển thị UNLOCKED. */
  readonly requiredAffinityTier: AffinityTierKey;
  /**
   * Quest keys theo thứ tự narrative. Reference `QUESTS[].key`. Empty array
   * không hợp lệ (validator reject).
   */
  readonly questKeys: ReadonlyArray<string>;
  /**
   * Dialogue node ids để FE mở `StoryDialogueModal`. Reference
   * `STORY_DIALOGUES[].id`. Có thể empty (chain không tied tới dialogue
   * branching ngoài quest steps).
   */
  readonly dialogueNodeKeys: ReadonlyArray<string>;
  /** Reward preview hiển thị khi chain claimable. */
  readonly rewardHint: NpcRelationshipChainRewardHint;
  /** Flag set khi player claim chain (thêm cờ `relchain_<chainKey>_claimed`). */
  readonly endingFlags: NpcRelationshipChainEndingFlags;
  /**
   * `true` = chain ẩn khỏi UI cho đến khi đạt tier (xem chỉ hint locked).
   * `false` (default) = chain hiển thị locked với hint tier required.
   */
  readonly hidden?: boolean;
}

/**
 * Reward cap per chain — invariant validator dùng. Bám sát
 * `docs/BALANCE_MODEL.md`.
 */
export const NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP = 40;
export const NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP = 500;
export const NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP = 10;
export const NPC_RELATIONSHIP_CHAIN_EXP_CAP = 600;
export const NPC_RELATIONSHIP_CHAIN_ITEM_QTY_CAP = 5;
export const NPC_RELATIONSHIP_CHAIN_ITEM_ENTRIES_CAP = 3;

/**
 * Chain catalog hiện tại (Phase 12.10.D #1).
 *
 *  1. **Mộc Thanh Y — Sect Path** (sect NPC, early/mid). Required tier
 *     `quen_biet`. Quest tongmon arc (`moc_thanh_y_arc`).
 *  2. **Hàn Dạ — Hoà Giải** (rival NPC, early/mid). Required tier
 *     `quen_biet`. Hoà giải tỉ thí + dialogue resolution.
 *  3. **Tô Nguyệt Ly — Truyền Thừa Ẩn** (story dungeon NPC, mid). Required
 *     tier `ban_huu`. Hidden lineage quest.
 *
 * Khi thêm chain mới (Phase 12.10.D #2 hoặc Phase 12.11+), append vào mảng;
 * invariant validator đảm bảo questKeys / dialogueNodeKeys exist.
 */
export const NPC_RELATIONSHIP_QUEST_CHAINS: readonly NpcRelationshipQuestChainDef[] = [
  {
    chainKey: 'relchain_moc_thanh_y_sect_path',
    npcKey: 'npc_moc_thanh_y',
    title: 'Theo Bước Đại Sư Tỷ',
    titleEn: 'Following Senior Sister',
    description:
      'Mộc Thanh Y dẫn dắt con qua các nhiệm vụ tông môn — chứng minh con xứng đáng đứng cạnh đại sư tỷ.',
    descriptionEn:
      "Mộc Thanh Y guides you through sect missions — prove you are worthy to stand beside her.",
    requiredAffinityTier: 'quen_biet',
    questKeys: ['truc_co_sect_01', 'kim_dan_sect_01', 'nguyen_anh_sect_01'],
    dialogueNodeKeys: ['story_dlg_moc_thanh_y_linh_can'],
    rewardHint: {
      affinity: 20,
      linhThach: 300,
      tienNgoc: 0,
      exp: 400,
      items: [
        { itemKey: 'hoi_nguyen_dan', qty: 3 },
        { itemKey: 'tinh_thiet', qty: 2 },
      ],
    },
    endingFlags: {
      rel_moc_thanh_y_path: 'sect_companion',
    },
  },
  {
    chainKey: 'relchain_han_da_truce',
    npcKey: 'npc_han_da',
    title: 'Hoà Giải Cùng Hàn Dạ',
    titleEn: 'Truce With Hàn Dạ',
    description:
      'Hàn Dạ kiêu ngạo nhưng trọng danh dự. Cùng đối thoại và đối đãi nhau bằng lễ kiếm để mở ra một tình bằng hữu mới.',
    descriptionEn:
      'Hàn Dạ is proud yet honourable. Speak and spar with restraint to forge a new bond of companions.',
    requiredAffinityTier: 'quen_biet',
    questKeys: ['luyenkhi_npc_01'],
    dialogueNodeKeys: [
      'story_dlg_han_da_followup_neutral',
      'story_dlg_han_da_resolution_apology',
    ],
    rewardHint: {
      affinity: 15,
      linhThach: 200,
      tienNgoc: 0,
      exp: 300,
      items: [{ itemKey: 'tinh_thiet', qty: 2 }],
    },
    endingFlags: {
      rel_han_da_path: 'truce',
    },
  },
  {
    chainKey: 'relchain_to_nguyet_ly_lineage',
    npcKey: 'npc_to_nguyet_ly',
    title: 'Truyền Thừa Hoa Thiên Bị Xoá',
    titleEn: 'The Erased Hoa Thiên Lineage',
    description:
      'Tô Nguyệt Ly chỉ tin tưởng kẻ đã đứng cùng nàng. Hoàn thành nhiệm vụ ẩn để khám phá bí mật truyền thừa Hoa Thiên đã bị xoá khỏi lịch sử.',
    descriptionEn:
      'Tô Nguyệt Ly trusts only those who stand beside her. Complete the hidden quest to uncover the erased Hoa Thiên lineage.',
    requiredAffinityTier: 'ban_huu',
    questKeys: ['truc_co_npc_01'],
    dialogueNodeKeys: [],
    rewardHint: {
      affinity: 25,
      linhThach: 250,
      tienNgoc: 1,
      exp: 500,
      items: [{ itemKey: 'huyet_chi_dan', qty: 2 }],
    },
    endingFlags: {
      rel_to_nguyet_ly_lineage_revealed: '1',
    },
    hidden: true,
  },
] as const;

/**
 * Lookup chain by key. Trả `undefined` nếu không tồn tại (FE / API kiểm
 * tra trước khi mutate).
 */
export function npcRelationshipChainByKey(
  chainKey: string,
): NpcRelationshipQuestChainDef | undefined {
  return NPC_RELATIONSHIP_QUEST_CHAINS.find((c) => c.chainKey === chainKey);
}

/**
 * List chain của 1 NPC. FE render trong tab Relationship Quests của
 * `NpcAffinityPanel`. Stable order theo `requiredAffinityTier.order` ASC,
 * sau đó `chainKey` ASC.
 */
export function npcRelationshipChainsForNpc(
  npcKey: string,
): NpcRelationshipQuestChainDef[] {
  const chains = NPC_RELATIONSHIP_QUEST_CHAINS.filter((c) => c.npcKey === npcKey);
  const tierOrder = new Map(AFFINITY_TIERS.map((t) => [t.key, t.order]));
  return chains.slice().sort((a, b) => {
    const ao = tierOrder.get(a.requiredAffinityTier) ?? 0;
    const bo = tierOrder.get(b.requiredAffinityTier) ?? 0;
    if (ao !== bo) return ao - bo;
    return a.chainKey.localeCompare(b.chainKey);
  });
}

/** Resolve tier def (fail-soft → first tier). */
export function affinityTierDefForKey(key: AffinityTierKey): AffinityTierDef {
  return AFFINITY_TIERS.find((t) => t.key === key) ?? AFFINITY_TIERS[0];
}

/**
 * Story flag key cho idempotency claim guard. Server set value `'1'` khi
 * claim thành công; service `where: { path, equals: Prisma.DbNull }` chống
 * double-claim race-safe.
 */
export function chainClaimedFlagKey(chainKey: string): string {
  // Avoid double prefix when chainKey already starts with `relchain_`.
  const base = chainKey.startsWith('relchain_') ? chainKey : `relchain_${chainKey}`;
  return `${base}_claimed`;
}

/**
 * Validate catalog — invariant test:
 *   1. `npcKey` ∈ `NPCS` + `NPC_AFFINITY`.
 *   2. Mọi `questKey` ∈ `QUESTS`.
 *   3. Mọi `dialogueNodeKey` ∈ `STORY_DIALOGUES`.
 *   4. `requiredAffinityTier` ∈ `AFFINITY_TIERS`.
 *   5. Reward cap: affinity ≤ NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP, linhThach
 *      ≤ NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP, tienNgoc ≤
 *      NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP, exp ≤
 *      NPC_RELATIONSHIP_CHAIN_EXP_CAP.
 *   6. Item entries ≤ NPC_RELATIONSHIP_CHAIN_ITEM_ENTRIES_CAP, mỗi qty ≥ 1
 *      và ≤ NPC_RELATIONSHIP_CHAIN_ITEM_QTY_CAP, itemKey ∈ items catalog.
 *   7. KHÔNG duplicate `chainKey`.
 *   8. KHÔNG empty `questKeys`.
 *   9. `endingFlags` non-empty + key prefix `rel_` hoặc `relchain_`.
 *  10. Mọi quest trong `questKeys` có `giverNpcKey === npcKey` HOẶC cùng
 *      `chainKey` của QuestDef bám tới một arc liên quan NPC. (Soft-check —
 *      cảnh báo, không reject; case Mộc Thanh Y arc có 1 quest do Lăng Vân
 *      Sinh giao như tutorial.)
 */
export function validateNpcRelationshipChainsCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const affinityKeys = new Set(NPC_AFFINITY.map((a) => a.npcKey));
  const questKeys = new Set(QUESTS.map((q) => q.key));
  const dialogueKeys = new Set(STORY_DIALOGUES.map((d) => d.id));
  const tierKeys = new Set(AFFINITY_TIERS.map((t) => t.key));

  const seenChainKeys = new Set<string>();

  for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
    const where = c.chainKey;

    if (seenChainKeys.has(c.chainKey)) {
      errs.push(`RelationshipChain ${where} duplicate chainKey`);
    }
    seenChainKeys.add(c.chainKey);

    if (!npcKeys.has(c.npcKey)) {
      errs.push(`RelationshipChain ${where} unknown NPC ${c.npcKey}`);
    }
    if (!affinityKeys.has(c.npcKey)) {
      errs.push(
        `RelationshipChain ${where} NPC ${c.npcKey} missing NPC_AFFINITY config`,
      );
    }
    if (!tierKeys.has(c.requiredAffinityTier)) {
      errs.push(
        `RelationshipChain ${where} unknown tier ${c.requiredAffinityTier}`,
      );
    }

    if (c.title.trim().length === 0) {
      errs.push(`RelationshipChain ${where} empty title`);
    }
    if (c.titleEn.trim().length === 0) {
      errs.push(`RelationshipChain ${where} empty titleEn`);
    }
    if (c.description.trim().length === 0) {
      errs.push(`RelationshipChain ${where} empty description`);
    }
    if (c.descriptionEn.trim().length === 0) {
      errs.push(`RelationshipChain ${where} empty descriptionEn`);
    }

    if (c.questKeys.length === 0) {
      errs.push(`RelationshipChain ${where} empty questKeys`);
    }
    const seenQ = new Set<string>();
    for (const qk of c.questKeys) {
      if (!questKeys.has(qk)) {
        errs.push(`RelationshipChain ${where} unknown questKey ${qk}`);
      }
      if (seenQ.has(qk)) {
        errs.push(`RelationshipChain ${where} duplicate questKey ${qk}`);
      }
      seenQ.add(qk);
    }

    const seenD = new Set<string>();
    for (const dk of c.dialogueNodeKeys) {
      if (!dialogueKeys.has(dk)) {
        errs.push(`RelationshipChain ${where} unknown dialogue node ${dk}`);
      }
      if (seenD.has(dk)) {
        errs.push(`RelationshipChain ${where} duplicate dialogue node ${dk}`);
      }
      seenD.add(dk);
    }

    const r = c.rewardHint;
    if (
      !Number.isInteger(r.affinity) ||
      r.affinity < 0 ||
      r.affinity > NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP
    ) {
      errs.push(
        `RelationshipChain ${where} affinity reward ${r.affinity} > cap ${NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP}`,
      );
    }
    if (
      !Number.isInteger(r.linhThach) ||
      r.linhThach < 0 ||
      r.linhThach > NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP
    ) {
      errs.push(
        `RelationshipChain ${where} linhThach reward ${r.linhThach} > cap ${NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP}`,
      );
    }
    if (
      !Number.isInteger(r.tienNgoc) ||
      r.tienNgoc < 0 ||
      r.tienNgoc > NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP
    ) {
      errs.push(
        `RelationshipChain ${where} tienNgoc reward ${r.tienNgoc} > cap ${NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP}`,
      );
    }
    if (
      !Number.isInteger(r.exp) ||
      r.exp < 0 ||
      r.exp > NPC_RELATIONSHIP_CHAIN_EXP_CAP
    ) {
      errs.push(
        `RelationshipChain ${where} exp reward ${r.exp} > cap ${NPC_RELATIONSHIP_CHAIN_EXP_CAP}`,
      );
    }
    if (r.items.length > NPC_RELATIONSHIP_CHAIN_ITEM_ENTRIES_CAP) {
      errs.push(
        `RelationshipChain ${where} items entries ${r.items.length} > cap ${NPC_RELATIONSHIP_CHAIN_ITEM_ENTRIES_CAP}`,
      );
    }
    for (const it of r.items) {
      const def = itemByKey(it.itemKey);
      if (!def) {
        errs.push(`RelationshipChain ${where} unknown reward item ${it.itemKey}`);
        continue;
      }
      if (!Number.isInteger(it.qty) || it.qty <= 0) {
        errs.push(
          `RelationshipChain ${where} item ${it.itemKey} qty ${it.qty} non-positive`,
        );
      }
      if (it.qty > NPC_RELATIONSHIP_CHAIN_ITEM_QTY_CAP) {
        errs.push(
          `RelationshipChain ${where} item ${it.itemKey} qty ${it.qty} > cap ${NPC_RELATIONSHIP_CHAIN_ITEM_QTY_CAP}`,
        );
      }
      if (!def.stackable && it.qty > 1) {
        errs.push(
          `RelationshipChain ${where} non-stackable ${it.itemKey} qty ${it.qty} > 1`,
        );
      }
    }

    const flagKeys = Object.keys(c.endingFlags);
    if (flagKeys.length === 0) {
      errs.push(`RelationshipChain ${where} empty endingFlags`);
    }
    for (const fk of flagKeys) {
      if (!fk.startsWith('rel_') && !fk.startsWith('relchain_')) {
        errs.push(
          `RelationshipChain ${where} ending flag '${fk}' must start with 'rel_' or 'relchain_'`,
        );
      }
      const v = c.endingFlags[fk];
      if (v === undefined || v === null) {
        errs.push(`RelationshipChain ${where} ending flag ${fk} value nullish`);
      }
    }

    // Soft-check: each questKey resolves to a quest whose giver matches NPC
    // OR whose chainKey is within the same NPC's existing arcs (`questsByChain`
    // includes giver mismatch in moc_thanh_y_arc — Lăng Vân Sinh giao quest đầu
    // arc Mộc Thanh Y). Cảnh báo nhẹ qua errs nhưng không hardline reject —
    // story design có thể hợp pháp.
    for (const qk of c.questKeys) {
      const def = questByKey(qk);
      if (!def) continue; // already errored above.
      if (def.giverNpcKey === c.npcKey) continue;
      // Allow if quest's chainKey shares any other quest given by this NPC.
      if (def.chainKey) {
        const sameChain = questsByChain(def.chainKey);
        if (sameChain.some((q) => q.giverNpcKey === c.npcKey)) continue;
      }
      // Else flag warning prefix `WARN ` so caller có thể filter.
      errs.push(
        `RelationshipChain ${where} WARN quest ${qk} giver ${def.giverNpcKey} mismatches chain NPC ${c.npcKey}`,
      );
    }
  }

  return errs;
}

/**
 * Soft helper — strip warnings (prefix `WARN `) khỏi list err. Test invariant
 * dùng cho hard fail: chỉ check errors thật sự (không phải warnings).
 */
export function hardErrorsOnly(errs: string[]): string[] {
  return errs.filter((e) => !e.includes('WARN'));
}

/**
 * Legacy aliases — `npcByKey` re-export tiện cho consumer ngoài.
 */
export { npcByKey, npcAffinityDefForKey };
