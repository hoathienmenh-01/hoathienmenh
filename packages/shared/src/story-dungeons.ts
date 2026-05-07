/**
 * Story Dungeon catalog — Phase 12.8.A foundation.
 *
 * Layer dungeon "đặc biệt" gắn vào main story chain — KHÁC dungeon farm chung
 * (`combat.ts:DUNGEONS` / `dungeon-run` runtime). Mỗi `StoryDungeonTemplateDef`:
 *
 *   - Gắn 1 `requiredQuestKey` (+ optional `requiredQuestStep`) — phải accept
 *     quest đó trước khi dungeon `available`.
 *   - Tham chiếu `regionKey` (typed `RegionKey`) + `recommendedRealm` /
 *     `minRealmKey` để gate UI hint + future server-side gating.
 *   - Reuse `MonsterDef.key` cho `monsterKeys[]` + optional `bossKey` từ
 *     `BOSSES` catalog để invariant test verify zero orphan.
 *   - `entryDialogueKey` / `clearDialogueKey` optional liên kết với
 *     `STORY_DIALOGUES` (Phase 12 Story Dialogue Foundation) để phase 12.8.B
 *     runtime mở dialogue khi enter / clear.
 *   - `rewardHint` (linhThach / tienNgoc / exp / items) — **catalog hint** cho
 *     UI preview; runtime claim sẽ wire ở Phase 12.8.B (qua `RewardLedger`
 *     idempotency `(characterId, STORY_DUNGEON_REWARD, runId)`).
 *   - `oneTime` boolean — `true` = chỉ chạy 1 lần (story climax); `false` =
 *     repeatable (training arc). Phase 12.8.B sẽ enforce server-side qua
 *     `StoryDungeonRun` Prisma model + idempotency key.
 *   - `enabled` boolean — admin-toggleable; service filter `enabled=true` ở
 *     `GET /story/dungeons` (mục đích: rollout pace + chống flag drift).
 *
 * Phase 12.8.A scope:
 *   - Catalog static, helpers thuần (không Prisma migration, không runtime
 *     persistence).
 *   - API read-only `GET /story/dungeons` + `GET /story/dungeons/:key` —
 *     return catalog snapshot + status (locked / available / cleared) tính
 *     light từ `QuestProgress` (read-only join, không mutate).
 *
 * Phase 12.8.B (next PR):
 *   - `StoryDungeonRun` Prisma + start/advance/claim runtime.
 *   - Wire quest auto-advance khi clear (`advance_quest_step` qua
 *     QuestService.track).
 *   - Reward grant atomic qua `CurrencyService.applyTx` /
 *     `InventoryService.grantTx` (mirror DungeonRun).
 *
 * Naming convention: `story_dgn_<realm_code>_<arc>`.
 *
 * Source design: spec Phase 12.8.A Story Dungeon Catalog + API Foundation.
 * Progress tracker: `docs/story/PHASE12_STORY_PROGRESS.md` §11 Story Dungeon.
 */

import { BOSSES } from './boss';
import { MONSTERS } from './combat';
import { ITEMS } from './items';
import { isMapRegionKey, type RegionKey } from './map-regions';
import { QUESTS, type QuestStepDef } from './quests';
import { realmByKey } from './realms';
import { STORY_DIALOGUES } from './story-dialogues';

/**
 * Reward hint cho FE UI preview. **CATALOG-ONLY** — runtime claim chưa wire
 * ở Phase 12.8.A. Phase 12.8.B sẽ wire qua `RewardLedger` reason
 * `STORY_DUNGEON_REWARD` + `refType='StoryDungeonRun'` + `refId=runId`.
 */
export interface StoryDungeonRewardHint {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
}

export interface StoryDungeonTemplateDef {
  /** Unique key, format `story_dgn_<realm_code>_<arc>`. */
  key: string;
  /**
   * I18n key prefix. UI render `t('story_dungeon.<key>.title')` /
   * `<key>.description`. Vietnamese fallback hard-coded ở `titleVi` /
   * `descriptionVi` để FE list không trống nếu i18n bundle chưa load.
   */
  titleI18nKey: string;
  descriptionI18nKey: string;
  titleVi: string;
  descriptionVi: string;
  /**
   * Quest gate — phải có row `QuestProgress` với `status ∈ {ACCEPTED, COMPLETED, CLAIMED}`
   * mới `available`. `CLAIMED` đặc biệt → `cleared` (xem service compute).
   * Match `QuestDef.key` trong `quests.ts`.
   */
  requiredQuestKey: string;
  /**
   * Optional step gate — phải tới step này (≥) mới available. Match
   * `QuestStepDef.id` trong cùng `requiredQuestKey`. `null` / undefined =
   * chỉ cần quest accepted.
   */
  requiredQuestStep?: string | null;
  /** Region key — typed union từ `map-regions.ts`. */
  regionKey: RegionKey;
  /**
   * Realm gợi ý cho UI hint (không gate). Match `RealmDef.key`.
   */
  recommendedRealm: string;
  /**
   * Realm minimum (gate). Player phải đạt `realm.order >= minRealm.order`
   * mới available. `null` = không gate (chỉ dựa vào `requiredQuestKey`).
   */
  minRealmKey?: string | null;
  /**
   * Optional NPC khởi động dungeon (UI map / quest hint). Match `NPCS[].key`.
   */
  npcKey?: string | null;
  /**
   * Optional dialogue node nội mở khi enter dungeon (Phase 12.8.B sẽ wire
   * runtime). Match `STORY_DIALOGUES[].id`.
   */
  entryDialogueKey?: string | null;
  /**
   * Optional dialogue node sau khi clear (Phase 12.8.B). Match
   * `STORY_DIALOGUES[].id`.
   */
  clearDialogueKey?: string | null;
  /**
   * Encounter chain — `MonsterDef.key`. Catalog test enforce ≥ 1 entry +
   * mỗi key resolve qua `monsterByKey`. Phase 12.8.B `nextEncounter` sẽ
   * tuần tự duyệt list này (tương tự `DungeonRunService`).
   */
  monsterKeys: readonly string[];
  /**
   * Optional final boss — match `BossDef.key`. Catalog test verify resolve
   * + region match (boss `regionKey` phải khớp dungeon `regionKey`).
   */
  bossKey?: string | null;
  /**
   * Reward hint catalog-only (xem `StoryDungeonRewardHint` doc). Phase
   * 12.8.A KHÔNG mutate runtime; FE chỉ render preview.
   */
  rewardHint?: StoryDungeonRewardHint | null;
  /**
   * `true` = chỉ chạy 1 lần (story climax). Phase 12.8.B sẽ enforce qua
   * `StoryDungeonRun` row idempotency.
   */
  oneTime: boolean;
  /** Admin toggle. `false` → service filter trả về (FE không thấy). */
  enabled: boolean;
}

/**
 * Catalog 4 story dungeon foundation gắn với 4 main quest đầu tiên
 * (phamnhan / luyenkhi / truc_co / kim_dan). Mỗi entry reuse monster +
 * region từ catalog hiện có để **không** invariant test orphan.
 */
export const STORY_DUNGEONS: readonly StoryDungeonTemplateDef[] = [
  {
    key: 'story_dgn_phamnhan_back_mountain',
    titleI18nKey: 'story_dungeon.story_dgn_phamnhan_back_mountain.title',
    descriptionI18nKey: 'story_dungeon.story_dgn_phamnhan_back_mountain.description',
    titleVi: 'Hậu Sơn Linh Tuyền Động',
    descriptionVi:
      'Hậu sơn Hoa Thiên Môn — nơi đệ tử mới đối mặt yêu thú nhỏ để chứng minh chí hướng. Lăng Vân Sinh giao dạy cho con đường đầu tiên.',
    requiredQuestKey: 'phamnhan_realm_01',
    requiredQuestStep: 'step_01',
    regionKey: 'son_coc',
    recommendedRealm: 'phamnhan',
    minRealmKey: null,
    npcKey: 'npc_lang_van_sinh',
    entryDialogueKey: 'story_dlg_lang_van_sinh_seed_truth',
    clearDialogueKey: null,
    monsterKeys: ['son_thu_lon', 'da_quan', 'huyet_lang'],
    bossKey: null,
    rewardHint: {
      linhThach: 80,
      exp: 150,
      items: [{ itemKey: 'linh_lo_dan', qty: 1 }],
    },
    oneTime: true,
    enabled: true,
  },
  {
    key: 'story_dgn_luyenkhi_hac_lam_trial',
    titleI18nKey: 'story_dungeon.story_dgn_luyenkhi_hac_lam_trial.title',
    descriptionI18nKey: 'story_dungeon.story_dgn_luyenkhi_hac_lam_trial.description',
    titleVi: 'Hắc Lâm Tâm Thử',
    descriptionVi:
      'Rừng Hắc Lâm âm khí dày đặc — đệ tử Luyện Khí phải vượt qua tâm thử của Tích Linh Ảnh để tiếp tục chính đạo.',
    requiredQuestKey: 'luyenkhi_main_01',
    requiredQuestStep: 'step_02',
    regionKey: 'hac_lam',
    recommendedRealm: 'luyenkhi',
    minRealmKey: 'luyenkhi',
    npcKey: 'npc_lang_van_sinh',
    entryDialogueKey: null,
    clearDialogueKey: null,
    monsterKeys: ['hac_yeu_xa', 'thi_quy', 'hac_lam_ma', 'tich_linh_anh'],
    bossKey: null,
    rewardHint: {
      linhThach: 200,
      exp: 480,
      items: [{ itemKey: 'co_thien_dan', qty: 1 }],
    },
    oneTime: true,
    enabled: true,
  },
  {
    key: 'story_dgn_truc_co_co_thu_ky',
    titleI18nKey: 'story_dungeon.story_dgn_truc_co_co_thu_ky.title',
    descriptionI18nKey: 'story_dungeon.story_dgn_truc_co_co_thu_ky.description',
    titleVi: 'Mộc Huyền Lâm — Ký Ức Cổ Thụ',
    descriptionVi:
      'Mộc Huyền Lâm thiên niên — Cổ Thụ Chi Linh giữ ký ức Hoa Thiên Môn cổ. Trúc Cơ tu sĩ tìm tới để mở khoá truyền thừa.',
    requiredQuestKey: 'truc_co_main_01',
    requiredQuestStep: 'step_03',
    regionKey: 'moc_huyen_lam',
    recommendedRealm: 'truc_co',
    minRealmKey: 'truc_co',
    npcKey: 'npc_moc_thanh_y',
    entryDialogueKey: null,
    clearDialogueKey: null,
    monsterKeys: [
      'thanh_mang_xa',
      'tang_diep_yeu_phu',
      'co_thu_chi_linh',
      'tich_linh_quy',
    ],
    bossKey: null,
    rewardHint: {
      linhThach: 600,
      tienNgoc: 5,
      exp: 1200,
      items: [
        { itemKey: 'cuu_huyen_dan', qty: 1 },
        { itemKey: 'tinh_thiet', qty: 2 },
      ],
    },
    oneTime: true,
    enabled: true,
  },
  {
    key: 'story_dgn_kim_dan_kim_son_thien_lo',
    titleI18nKey: 'story_dungeon.story_dgn_kim_dan_kim_son_thien_lo.title',
    descriptionI18nKey: 'story_dungeon.story_dgn_kim_dan_kim_son_thien_lo.description',
    titleVi: 'Kim Sơn Thiên Lò Lệnh',
    descriptionVi:
      'Kim Sơn Mạch — lò luyện đan cổ Hoa Thiên. Kim Đan tu sĩ phải hạ sát Tích Thiên Sát Thủ để giành lệnh truyền lò.',
    requiredQuestKey: 'kim_dan_main_01',
    requiredQuestStep: 'step_02',
    regionKey: 'kim_son_mach',
    recommendedRealm: 'kim_dan',
    minRealmKey: 'kim_dan',
    npcKey: 'npc_lang_van_sinh',
    entryDialogueKey: null,
    clearDialogueKey: null,
    monsterKeys: [
      'kim_quang_thach_giap',
      'huyen_kim_lang_thu',
      'tinh_thiet_kiem_linh',
      'tich_thien_sat_thu',
    ],
    bossKey: null,
    rewardHint: {
      linhThach: 1500,
      tienNgoc: 20,
      exp: 2800,
      items: [
        { itemKey: 'linh_can_dan', qty: 1 },
        { itemKey: 'phu_van_ngoc', qty: 3 },
      ],
    },
    oneTime: true,
    enabled: true,
  },
];

// ============================================================================
// Helpers — pure (không runtime). Service consume.
// ============================================================================

export function storyDungeonByKey(key: string): StoryDungeonTemplateDef | undefined {
  return STORY_DUNGEONS.find((d) => d.key === key);
}

export function storyDungeonsForQuest(questKey: string): StoryDungeonTemplateDef[] {
  return STORY_DUNGEONS.filter((d) => d.requiredQuestKey === questKey);
}

/**
 * Quest state mà player đang ở. Service dùng để decide dungeon nào
 * `available` cho UI list.
 */
export type QuestStateForStoryDungeon =
  | 'NOT_STARTED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED';

export interface StoryDungeonAvailabilityInput {
  /** Realm `order`. */
  realmOrder: number;
  /** Map `questKey -> state` của player. */
  questStateByKey: ReadonlyMap<string, QuestStateForStoryDungeon>;
  /**
   * Map `questKey -> { stepId: progress }` để compare với
   * `requiredQuestStep`. Optional — undefined / missing entry = step chưa
   * progress (= không qualify nếu dungeon yêu cầu step cụ thể).
   */
  questStepProgress?: ReadonlyMap<string, Readonly<Record<string, number>>>;
}

export type StoryDungeonAvailabilityStatus = 'locked' | 'available' | 'cleared';

/**
 * Tính status cho 1 dungeon dựa trên player snapshot. Pure — không Prisma.
 *
 * Logic:
 *   - `enabled=false` → coi như không tồn tại (caller filter trước).
 *   - `realmOrder < minRealmKey.order` → `locked`.
 *   - `requiredQuestKey` state ∈ `CLAIMED` → `cleared`.
 *   - state ∈ `ACCEPTED` / `COMPLETED` (+ optional `requiredQuestStep`
 *     progress đạt `count`) → `available`.
 *   - Else → `locked`.
 */
export function computeStoryDungeonStatus(
  template: StoryDungeonTemplateDef,
  input: StoryDungeonAvailabilityInput,
): StoryDungeonAvailabilityStatus {
  if (template.minRealmKey) {
    const min = realmByKey(template.minRealmKey);
    if (min && input.realmOrder < min.order) return 'locked';
  }
  const state = input.questStateByKey.get(template.requiredQuestKey) ?? 'NOT_STARTED';
  if (state === 'CLAIMED') return 'cleared';
  if (state !== 'ACCEPTED' && state !== 'COMPLETED') return 'locked';
  if (template.requiredQuestStep) {
    const def = QUESTS.find((q) => q.key === template.requiredQuestKey);
    const stepDef: QuestStepDef | undefined = def?.steps.find(
      (s) => s.id === template.requiredQuestStep,
    );
    // Nếu step cụ thể không tồn tại trong quest catalog → coi như chưa
    // qualify (defensive — invariant test sẽ catch ở build time).
    if (!stepDef) return 'locked';
    const progress = input.questStepProgress?.get(template.requiredQuestKey)?.[stepDef.id] ?? 0;
    // Nếu quest đã COMPLETED, mọi step coi như đã đạt count (mirror
    // QuestService.progress semantics).
    if (state === 'COMPLETED') return 'available';
    if (progress < stepDef.count) return 'locked';
  }
  return 'available';
}

/**
 * Convenience helper — list các dungeon có status ≠ `locked` cho 1 player
 * snapshot. UI map view dùng để render danh sách "đang mở".
 */
export function availableStoryDungeonsForQuestState(
  input: StoryDungeonAvailabilityInput,
): Array<{ template: StoryDungeonTemplateDef; status: StoryDungeonAvailabilityStatus }> {
  const out: Array<{
    template: StoryDungeonTemplateDef;
    status: StoryDungeonAvailabilityStatus;
  }> = [];
  for (const t of STORY_DUNGEONS) {
    if (!t.enabled) continue;
    const status = computeStoryDungeonStatus(t, input);
    if (status === 'locked') continue;
    out.push({ template: t, status });
  }
  return out;
}

// ============================================================================
// Catalog invariant validator — gọi trong test + service bootstrap (defensive)
// ============================================================================

export interface StoryDungeonCatalogIssue {
  templateKey: string;
  message: string;
}

/**
 * Trả về list issue rỗng nếu catalog hợp lệ. Mục đích:
 *   - Service `bootstrap` (Phase 12.8.B nếu cần) có thể fail-fast.
 *   - Test `story-dungeons.test.ts > validateStoryDungeonCatalog returns
 *     no issues` enforce ở build time — orphan reference / typo sẽ fail
 *     CI trước khi merge.
 *
 * Checks:
 *   - `key` snake_case, unique.
 *   - `requiredQuestKey` resolve qua `QUESTS`.
 *   - `requiredQuestStep` (nếu set) resolve trong `QuestDef.steps`.
 *   - `regionKey` ∈ `RegionKey`.
 *   - `recommendedRealm` / `minRealmKey` (nếu set) resolve qua `realmByKey`.
 *   - `monsterKeys[]` mỗi key resolve qua `MonsterDef.key`.
 *   - `bossKey` (nếu set) resolve qua `BossDef.key` + region match.
 *   - `entryDialogueKey` / `clearDialogueKey` (nếu set) resolve qua
 *     `STORY_DIALOGUES[].id`.
 *   - `rewardHint` integer dương (nếu có) + `items[].itemKey` resolve qua
 *     `ITEMS` catalog + `qty > 0`.
 *   - `oneTime` / `enabled` boolean.
 */
export function validateStoryDungeonCatalog(): StoryDungeonCatalogIssue[] {
  const issues: StoryDungeonCatalogIssue[] = [];
  const seenKeys = new Set<string>();
  const monsterKeys = new Set(MONSTERS.map((m) => m.key));
  const bossKeys = new Set(BOSSES.map((b) => b.key));
  const dialogueIds = new Set(STORY_DIALOGUES.map((d) => d.id));
  for (const t of STORY_DUNGEONS) {
    const push = (msg: string) => issues.push({ templateKey: t.key, message: msg });
    if (!/^[a-z][a-z0-9_]*$/.test(t.key)) push(`key not snake_case`);
    if (seenKeys.has(t.key)) push(`duplicate key`);
    seenKeys.add(t.key);
    if (!t.titleVi.trim()) push(`titleVi empty`);
    if (!t.descriptionVi.trim()) push(`descriptionVi empty`);
    const quest = QUESTS.find((q) => q.key === t.requiredQuestKey);
    if (!quest) {
      push(`requiredQuestKey ${t.requiredQuestKey} not in QUESTS`);
    } else if (t.requiredQuestStep) {
      const stepDef = quest.steps.find((s) => s.id === t.requiredQuestStep);
      if (!stepDef) {
        push(`requiredQuestStep ${t.requiredQuestStep} not in quest ${quest.key}`);
      }
    }
    if (!isMapRegionKey(t.regionKey)) push(`regionKey ${t.regionKey} not RegionKey`);
    if (!realmByKey(t.recommendedRealm)) {
      push(`recommendedRealm ${t.recommendedRealm} unknown`);
    }
    if (t.minRealmKey && !realmByKey(t.minRealmKey)) {
      push(`minRealmKey ${t.minRealmKey} unknown`);
    }
    if (t.monsterKeys.length === 0) push(`monsterKeys empty`);
    for (const mk of t.monsterKeys) {
      if (!monsterKeys.has(mk)) push(`monsterKey ${mk} unknown`);
    }
    if (t.bossKey) {
      if (!bossKeys.has(t.bossKey)) {
        push(`bossKey ${t.bossKey} unknown`);
      } else {
        const boss = BOSSES.find((b) => b.key === t.bossKey);
        if (boss && boss.regionKey && boss.regionKey !== t.regionKey) {
          push(
            `bossKey ${t.bossKey} regionKey ${boss.regionKey} != template regionKey ${t.regionKey}`,
          );
        }
      }
    }
    if (t.entryDialogueKey && !dialogueIds.has(t.entryDialogueKey)) {
      push(`entryDialogueKey ${t.entryDialogueKey} not in STORY_DIALOGUES`);
    }
    if (t.clearDialogueKey && !dialogueIds.has(t.clearDialogueKey)) {
      push(`clearDialogueKey ${t.clearDialogueKey} not in STORY_DIALOGUES`);
    }
    const r = t.rewardHint;
    if (r) {
      if (r.linhThach != null && (!Number.isInteger(r.linhThach) || r.linhThach < 0)) {
        push(`rewardHint.linhThach invalid`);
      }
      if (r.tienNgoc != null && (!Number.isInteger(r.tienNgoc) || r.tienNgoc < 0)) {
        push(`rewardHint.tienNgoc invalid`);
      }
      if (r.exp != null && (!Number.isInteger(r.exp) || r.exp < 0)) {
        push(`rewardHint.exp invalid`);
      }
      const itemKeys = new Set(ITEMS.map((i) => i.key));
      for (const it of r.items ?? []) {
        if (!itemKeys.has(it.itemKey)) {
          push(`rewardHint.items itemKey ${it.itemKey} not in ITEMS catalog`);
        }
        if (!Number.isInteger(it.qty) || it.qty <= 0) {
          push(`rewardHint.items qty invalid for ${it.itemKey}`);
        }
      }
    }
  }
  return issues;
}
