import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 33.2 — Story V2 client (Quyển II–IV "Tu Tiên Lộ" runtime).
 *
 * Wire 7 endpoint của `Phase33StoryModule` (Phase 33.1 PR-B):
 *   - `GET /story/v2/chapters`: list chapter visible (realm gate).
 *   - `GET /story/v2/chapters/:chapKey/quests`: list quest per chapter (realm/
 *     prereq/storyFlag/affinity gate).
 *   - `GET /story/v2/quests/:questKey/dialogues?phase=`: list dialogue runtime.
 *   - `POST /story/v2/quests/accept`: accept (CAS guard AVAILABLE → ACCEPTED).
 *   - `POST /story/v2/quests/progress`: progress 1 step (talk/explore/choice/flag_set).
 *   - `POST /story/v2/quests/complete`: explicit ACCEPTED → COMPLETED.
 *   - `POST /story/v2/quests/claim`: atomic ledger reward + audit.
 *
 * Server-authoritative: status/step done/reward grant chạy server-side; FE
 * KHÔNG tự cộng reward. Mọi mutation gọi server → reload state từ response.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type Phase33QuestStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED';

export type Phase33ChapterStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export type Phase33QuestKind =
  | 'main'
  | 'side'
  | 'branch'
  | 'hidden'
  | 'daily'
  | 'weekly';

export type Phase33StepKind =
  | 'talk'
  | 'explore'
  | 'choice'
  | 'flag_set'
  | 'kill'
  | 'collect';

export type Phase33TargetType =
  | 'npc'
  | 'region'
  | 'choice'
  | 'flag'
  | 'monster'
  | 'item';

export type Phase33DialoguePhase =
  | 'INTRO'
  | 'ACCEPT'
  | 'IN_PROGRESS'
  | 'READY_TO_COMPLETE'
  | 'COMPLETE'
  | 'CLAIMED'
  | 'HIDDEN_HINT'
  | 'HIDDEN_TRIGGER'
  | 'BOSS_PRE'
  | 'BOSS_START'
  | 'BOSS_VICTORY'
  | 'AFTERMATH';

export interface Phase33QuestStepView {
  id: string;
  kind: Phase33StepKind;
  description: string;
  targetType: Phase33TargetType;
  targetId: string;
  count: number;
  currentCount: number;
  done: boolean;
}

export interface Phase33QuestRewards {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  congHien?: number;
  items?: Array<{ itemKey: string; qty: number }>;
  affinity?: Array<{ npcKey: string; delta: number }>;
  storyFlags?: string[];
}

export interface Phase33QuestView {
  questKey: string;
  kind: Phase33QuestKind;
  chapKey: string;
  volumeKey: string;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  giverNpcKey: string;
  requiredRealmKey: string;
  requiredRealmOrder: number;
  prerequisiteQuestKey: string | null;
  status: Phase33QuestStatus;
  steps: Phase33QuestStepView[];
  completable: boolean;
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
  rewards: Phase33QuestRewards;
}

export interface Phase33ChapterView {
  chapKey: string;
  volumeKey: string;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  status: Phase33ChapterStatus;
  mainQuestsTotal: number;
  mainQuestsCompletedCount: number;
  unlockedAt: string | null;
  completedAt: string | null;
  storyFlags: string[];
}

export interface Phase33DialogueView {
  dialogueId: string;
  questKey: string;
  chapterKey: string;
  speakerNpcKey: string;
  phase: Phase33DialoguePhase;
  textVi: string;
  textEn: string;
  nextDialogueId?: string;
}

export interface Phase33ClaimGranted {
  linhThach: number;
  tienNgoc?: number;
  exp: number;
  congHien: number;
  items: Array<{ itemKey: string; qty: number }>;
  affinity: Array<{ npcKey: string; delta: number }>;
  storyFlags: string[];
}

export interface Phase33ClaimResult {
  questKey: string;
  claimedAt: string;
  granted: Phase33ClaimGranted;
}

/** GET /story/v2/chapters */
export async function fetchPhase33Chapters(): Promise<Phase33ChapterView[]> {
  const { data } = await apiClient.get<
    Envelope<{ chapters: Phase33ChapterView[] }>
  >('/story/v2/chapters');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.chapters;
}

/** GET /story/v2/chapters/:chapKey/quests */
export async function fetchPhase33Quests(
  chapKey: string,
): Promise<Phase33QuestView[]> {
  const { data } = await apiClient.get<
    Envelope<{ quests: Phase33QuestView[] }>
  >(`/story/v2/chapters/${encodeURIComponent(chapKey)}/quests`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quests;
}

/** GET /story/v2/quests/:questKey/dialogues?phase= */
export async function fetchPhase33Dialogues(
  questKey: string,
  phase?: Phase33DialoguePhase,
): Promise<Phase33DialogueView[]> {
  const qs = phase ? `?phase=${encodeURIComponent(phase)}` : '';
  const { data } = await apiClient.get<
    Envelope<{ dialogues: Phase33DialogueView[] }>
  >(`/story/v2/quests/${encodeURIComponent(questKey)}/dialogues${qs}`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.dialogues;
}

/** POST /story/v2/quests/accept */
export async function acceptPhase33Quest(
  questKey: string,
): Promise<Phase33QuestView> {
  const { data } = await apiClient.post<
    Envelope<{ quest: Phase33QuestView }>
  >('/story/v2/quests/accept', { questKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quest;
}

/** POST /story/v2/quests/progress */
export async function progressPhase33Quest(
  questKey: string,
  stepId: string,
  amount?: number,
): Promise<Phase33QuestView> {
  const { data } = await apiClient.post<
    Envelope<{ quest: Phase33QuestView }>
  >('/story/v2/quests/progress', { questKey, stepId, amount });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quest;
}

/** POST /story/v2/quests/complete */
export async function completePhase33Quest(
  questKey: string,
): Promise<Phase33QuestView> {
  const { data } = await apiClient.post<
    Envelope<{ quest: Phase33QuestView }>
  >('/story/v2/quests/complete', { questKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.quest;
}

/** POST /story/v2/quests/claim */
export async function claimPhase33Quest(
  questKey: string,
): Promise<Phase33ClaimResult> {
  const { data } = await apiClient.post<Envelope<Phase33ClaimResult>>(
    '/story/v2/quests/claim',
    { questKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
