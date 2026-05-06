import { i18n } from '@/i18n';
import type {
  DungeonDef,
  DungeonRunReward,
  MonsterDef,
  RolledLoot,
} from '@xuantoi/shared';
import { apiClient } from './client';

/**
 * Phase 12.2.C — DungeonRun runtime client (multi-encounter expedition).
 *
 * Wire 4 endpoint của `DungeonRunModule` (Phase 12.2.B #434):
 *   - `GET /dungeons/me`              → list catalog + active run.
 *   - `POST /dungeons/:templateKey/start` → start run mới.
 *   - `POST /dungeon-runs/:runId/next`    → advance 1 encounter (auto-resolve).
 *   - `POST /dungeon-runs/:runId/claim`   → claim completion bonus reward.
 *
 * Server-authoritative: realm gate + daily limit + stamina gate enforced
 * server-side, FE chỉ render. Reward grant qua `CurrencyService.applyTx` +
 * `InventoryService.grantTx` + `tx.character.update` (exp) — FE KHÔNG
 * tự cộng linhThach/tienNgoc/exp/items.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.dungeonRun'));
}

export type DungeonRunStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CLAIMED'
  | 'ABANDONED';

export type DungeonLockReason =
  | 'LOCKED_REALM'
  | 'DAILY_LIMIT'
  | 'STAMINA_LOW'
  | null;

export interface DungeonAvailabilityView {
  dungeon: DungeonDef;
  unlocked: boolean;
  startable: boolean;
  staminaShort: boolean;
  dailyUsed: number;
  dailyLimit: number | null;
  lockReason: DungeonLockReason;
}

export interface DungeonRunKilledEntry {
  monsterKey: string;
  killedAt: string;
  /**
   * Phase 12.3 — random per-encounter loot drop đã grant qua server
   * (reason `DUNGEON_LOOT`). FE chỉ render — KHÔNG tự cộng inventory.
   * `undefined` cho legacy entry (run pre-Phase-12.3 hoặc loot table empty).
   */
  loot?: RolledLoot[];
}

export interface DungeonRunView {
  id: string;
  templateKey: string;
  status: DungeonRunStatus;
  encounterIndex: number;
  totalEncounters: number;
  /** Monster sắp đánh (`null` khi run COMPLETED/CLAIMED/ABANDONED). */
  currentMonster: MonsterDef | null;
  killedMonsters: DungeonRunKilledEntry[];
  startedAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  reward: DungeonRunReward | null;
}

export interface DungeonListView {
  available: DungeonAvailabilityView[];
  activeRun: DungeonRunView | null;
}

export interface DungeonClaimResult {
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
 * GET /dungeons/me — list catalog (per-dungeon availability + lockReason +
 * daily count) + active run nếu có.
 *
 * Throw `{code}` envelope khi UNAUTHENTICATED / NO_CHARACTER.
 */
export async function fetchDungeonRunList(): Promise<DungeonListView> {
  const { data } = await apiClient.get<Envelope<DungeonListView>>(
    '/dungeons/me',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

/**
 * POST /dungeons/:templateKey/start — start run mới. Server validate ordered:
 * NO_CHARACTER → DUNGEON_NOT_FOUND → DUNGEON_LOCKED_REALM →
 * DUNGEON_DAILY_LIMIT_REACHED → STAMINA_LOW → ALREADY_IN_RUN.
 */
export async function startDungeonRun(templateKey: string): Promise<DungeonRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: DungeonRunView }>
  >(`/dungeons/${encodeURIComponent(templateKey)}/start`, {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

/**
 * POST /dungeon-runs/:runId/next — advance 1 encounter (auto-resolve monster
 * `dungeon.monsters[encounterIndex]` as killed + track quest kill fail-soft +
 * advance index hoặc COMPLETED khi hết list). CAS guard `encounterIndex` chống
 * race 2 next call cùng runId.
 */
export async function nextDungeonEncounter(runId: string): Promise<DungeonRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: DungeonRunView }>
  >(`/dungeon-runs/${encodeURIComponent(runId)}/next`, {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

/**
 * POST /dungeon-runs/:runId/claim — claim bonus reward (linhThach/tienNgoc/
 * exp/items) atomic qua CurrencyService.applyTx + InventoryService.grantTx +
 * tx.character.update. Idempotent CAS guard `claimedAt=null`. Race 2 claim
 * cùng runId → đúng 1 winner ghi 1 ledger row.
 */
export async function claimDungeonRun(runId: string): Promise<DungeonClaimResult> {
  const { data } = await apiClient.post<Envelope<DungeonClaimResult>>(
    `/dungeon-runs/${encodeURIComponent(runId)}/claim`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
