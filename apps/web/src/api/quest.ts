import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12 Story Runtime MVP (PR-5) — Quest list / accept / claim client.
 *
 * Wire 3 endpoint của `QuestModule` (Phase 12 PR-2 #426 + PR-3 #427):
 *   - `GET /quests/me`: list quest visible (server lazy-create AVAILABLE rows
 *     theo realm gate + prereq + dynamic catalog).
 *   - `POST /quests/accept`: accept quest (CAS guard `where { status: AVAILABLE }`).
 *   - `POST /quests/claim`: claim reward atomic (CAS guard `claimedAt`, ledger row).
 *
 * Tất cả runtime data (status / step done / reward grant) chạy server-side;
 * FE chỉ render. KHÔNG có optimistic mutation — mọi action gọi server và
 * reload state từ response.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type QuestStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED';

export type QuestKind = 'main' | 'realm' | 'sect' | 'npc' | 'grind';

export type QuestStepKind = 'kill' | 'collect' | 'talk' | 'explore' | 'choice';

export type QuestStepTargetType =
  | 'monster'
  | 'item'
  | 'npc'
  | 'region'
  | 'choice';

export interface QuestStepView {
  id: string;
  kind: QuestStepKind;
  description: string;
  targetType: QuestStepTargetType;
  targetId: string;
  count: number;
  currentCount: number;
  done: boolean;
}

export interface QuestRewardItem {
  itemKey: string;
  qty: number;
}

export interface QuestRewards {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  congHien?: number;
  items?: QuestRewardItem[];
}

export interface QuestProgressView {
  key: string;
  name: string;
  description: string;
  kind: QuestKind;
  realmKey: string;
  requiredRealmOrder: number;
  giverNpcKey: string;
  chainKey: string | null;
  prerequisiteQuestKey: string | null;
  status: QuestStatus;
  steps: QuestStepView[];
  /** Tất cả step.done. */
  completable: boolean;
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
  rewards: QuestRewards;
}

export interface QuestClaimGranted {
  linhThach: number;
  tienNgoc: number;
  exp: number;
  congHien: number;
  items: QuestRewardItem[];
}

export interface QuestClaimResult {
  questKey: string;
  claimedAt: string;
  granted: QuestClaimGranted;
}

/**
 * GET /quests/me — list quest visible (LOCKED / AVAILABLE / ACCEPTED /
 * COMPLETED / CLAIMED). Server lazy-create AVAILABLE row cho quest đã thoả
 * gate; LOCKED row chỉ hiện khi prereq tồn tại nhưng chưa CLAIMED.
 *
 * Throw `{code}` envelope khi UNAUTHENTICATED / NO_CHARACTER.
 */
export async function fetchQuests(): Promise<QuestProgressView[]> {
  const { data } = await apiClient.get<
    Envelope<{ quests: QuestProgressView[] }>
  >('/quests/me');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quests;
}

/**
 * POST /quests/accept — accept quest từ NPC dialogue choice hoặc QuestView
 * accept button. Server CAS guard `where { status: AVAILABLE }` chống
 * double-accept. Re-export từ PR-4 (NPC dialogue UI) — alias để giữ contract.
 *
 * Throw `{code}` envelope khi UNAUTHENTICATED / NO_CHARACTER / QUEST_UNKNOWN /
 * QUEST_LOCKED_REALM / QUEST_LOCKED_PREREQUISITE / QUEST_NOT_AVAILABLE.
 */
export async function acceptQuest(questKey: string): Promise<QuestProgressView> {
  const { data } = await apiClient.post<
    Envelope<{ quest: QuestProgressView }>
  >('/quests/accept', { questKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quest;
}

/**
 * POST /quests/claim — claim reward atomic (CAS guard `claimedAt`, ledger
 * row qua `CurrencyService.applyTx` + `InventoryService.grantTx`). Server
 * idempotent: 2 parallel claim → 1 winner + 1 ledger row.
 *
 * Throw `{code}` envelope khi UNAUTHENTICATED / NO_CHARACTER / QUEST_UNKNOWN /
 * QUEST_NOT_FOUND_PROGRESS / QUEST_NOT_COMPLETED / QUEST_ALREADY_CLAIMED.
 */
export async function claimQuest(questKey: string): Promise<QuestClaimResult> {
  const { data } = await apiClient.post<Envelope<QuestClaimResult>>(
    '/quests/claim',
    { questKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
