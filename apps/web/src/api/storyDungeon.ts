import { i18n } from '@/i18n';
import type { MonsterDef } from '@xuantoi/shared';
import { apiClient } from './client';

/**
 * Phase 12.8.C — Story Dungeon FE API client.
 *
 * Wire 6 endpoint của `StoryDungeonModule` (Phase 12.8.A catalog + Phase
 * 12.8.B runtime):
 *   - `GET  /story/dungeons`                → list catalog + ACTIVE/CLEARED run.
 *   - `GET  /story/dungeons/:key`           → single template + status.
 *   - `POST /story/dungeons/:key/start`     → start (idempotent retry).
 *   - `POST /story/dungeons/:runId/advance` → kill 1 monster step.
 *   - `POST /story/dungeons/:runId/clear`   → ACTIVE → CLEARED + quest auto-advance.
 *   - `POST /story/dungeons/:runId/claim`   → grant reward (CAS-guarded, idempotent).
 *
 * Server-authoritative: quest gate + minRealm gate + oneTime + claim
 * reward grant đều enforce server-side. FE chỉ render — KHÔNG tự cộng
 * linhThach/tienNgoc/exp/items.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.storyDungeon'));
}

export type StoryDungeonAvailabilityStatus = 'locked' | 'available' | 'cleared';

export type StoryDungeonRunStatus =
  | 'ACTIVE'
  | 'CLEARED'
  | 'CLAIMED'
  | 'FAILED';

export interface StoryDungeonRewardHint {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
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
  /** Monster sắp đánh (`null` khi run CLEARED/CLAIMED/FAILED hoặc index out-of-range). */
  currentMonster: MonsterDef | null;
  killedMonsters: StoryDungeonRunKilledEntry[];
  startedAt: string;
  clearedAt: string | null;
  claimedAt: string | null;
  rewardHint: StoryDungeonRewardHint | null;
}

export interface StoryDungeonListView {
  dungeons: StoryDungeonView[];
  /**
   * ACTIVE / CLEARED-but-unclaimed run cho character. `null` nếu không có
   * (đã CLAIMED hoặc chưa start). Phase 12.8.C polish — controller
   * `GET /story/dungeons` bundle thêm field này.
   */
  activeRun: StoryDungeonRunView | null;
}

export interface StoryDungeonClaimResult {
  runId: string;
  templateKey: string;
  claimedAt: string;
  granted: {
    linhThach: number;
    tienNgoc: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
}

/**
 * GET /story/dungeons — list catalog (`enabled=true`) + status per template
 * + activeRun (Phase 12.8.C polish).
 */
export async function fetchStoryDungeonList(): Promise<StoryDungeonListView> {
  const { data } = await apiClient.get<Envelope<StoryDungeonListView>>(
    '/story/dungeons',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

/** GET /story/dungeons/:key — single template + status. */
export async function fetchStoryDungeon(
  key: string,
): Promise<StoryDungeonView> {
  const { data } = await apiClient.get<Envelope<{ dungeon: StoryDungeonView }>>(
    `/story/dungeons/${encodeURIComponent(key)}`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.dungeon;
}

/**
 * POST /story/dungeons/:key/start — start run (idempotent retry: ACTIVE
 * cùng templateKey trả về run hiện có). Throw envelope `{ code }`:
 *   - `DUNGEON_NOT_FOUND` (404) / `DUNGEON_LOCKED` (403) /
 *     `DUNGEON_ALREADY_CLEARED` (409 — oneTime đã claim) /
 *     `ALREADY_IN_RUN` (409 — đang run khác templateKey).
 */
export async function startStoryDungeon(
  key: string,
): Promise<StoryDungeonRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: StoryDungeonRunView }>
  >(`/story/dungeons/${encodeURIComponent(key)}/start`, {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

/**
 * POST /story/dungeons/:runId/advance — kill 1 monster theo
 * `template.monsterKeys[currentStep]` + fail-soft track quest kill. CAS
 * guard `currentStep` chống race 2 advance call cùng runId.
 */
export async function advanceStoryDungeon(
  runId: string,
): Promise<StoryDungeonRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: StoryDungeonRunView }>
  >(`/story/dungeons/${encodeURIComponent(runId)}/advance`, {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

/**
 * POST /story/dungeons/:runId/clear — transition ACTIVE → CLEARED + quest
 * step auto-advance (fail-soft). CAS guard chống re-clear double progress.
 */
export async function clearStoryDungeon(
  runId: string,
): Promise<StoryDungeonRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: StoryDungeonRunView }>
  >(`/story/dungeons/${encodeURIComponent(runId)}/clear`, {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

/**
 * POST /story/dungeons/:runId/claim — grant reward (linhThach/tienNgoc/
 * exp/items) atomic qua CurrencyService.applyTx + InventoryService.grantTx
 * + tx.character.update. CAS guard `claimedAt=null` — race 2 claim cùng
 * runId chỉ 1 winner.
 */
export async function claimStoryDungeon(
  runId: string,
): Promise<StoryDungeonClaimResult> {
  const { data } = await apiClient.post<Envelope<StoryDungeonClaimResult>>(
    `/story/dungeons/${encodeURIComponent(runId)}/claim`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
