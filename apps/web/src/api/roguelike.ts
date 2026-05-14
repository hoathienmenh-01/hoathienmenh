import { i18n } from '@/i18n';
import type {
  RoguelikeChoiceDef,
  RoguelikeFloorDef,
  RoguelikeRealmDef,
  RoguelikeRewardPreview,
} from '@xuantoi/shared';
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message?: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.roguelike'));
}

export type RoguelikeRunStatus =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED'
  | 'CLAIMED';

export interface RoguelikeRealmView {
  realm: RoguelikeRealmDef;
  unlocked: boolean;
  activeRunId: string | null;
  dailyUsed: number;
  dailyLimit: number;
  weeklyClaimsUsed: number;
  weeklyClaimLimit: number;
}

export interface RoguelikeActiveBuffView {
  key: string;
  nameVi: string;
  nameEn: string;
  stat: string;
  valuePct: number;
  remainingFloors: number;
}

export interface RoguelikeFloorLogEntry {
  floorNumber: number;
  floorType: RoguelikeFloorDef['floorType'];
  choiceKey: string;
  outcomeVi: string;
  outcomeEn: string;
  hpAfter: number;
  resourceAfter: number;
  scoreAfter: number;
  rewardMultiplierAfter: number;
}

export interface RoguelikeRunView {
  id: string;
  realmKey: string;
  status: RoguelikeRunStatus;
  seed: string;
  currentFloor: number;
  hp: number;
  hpMax: number;
  resource: number;
  score: number;
  rewardMultiplier: number;
  activeBuffs: RoguelikeActiveBuffView[];
  floorHistory: RoguelikeFloorLogEntry[];
  currentFloorDef: RoguelikeFloorDef | null;
  choices: readonly RoguelikeChoiceDef[];
  rewardPreview: RoguelikeRewardPreview;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  abandonedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
}

export interface RoguelikeListView {
  realms: RoguelikeRealmView[];
  activeRun: RoguelikeRunView | null;
}

export interface RoguelikeClaimResult {
  runId: string;
  claimedAt: string;
  granted: {
    linhThach: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
  run: RoguelikeRunView;
}

export interface RoguelikeLeaderboardEntry {
  characterId: string;
  characterName: string;
  bestFloor: number;
  bestScore: number;
  fastestClearMs: number | null;
  weekBucket: string;
  monthBucket: string;
  updatedAt: string;
}

export async function fetchRoguelikeList(): Promise<RoguelikeListView> {
  const { data } = await apiClient.get<Envelope<RoguelikeListView>>(
    '/roguelike-realms',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function startRoguelikeRun(
  realmKey: string,
): Promise<RoguelikeRunView> {
  const { data } = await apiClient.post<Envelope<{ run: RoguelikeRunView }>>(
    `/roguelike-realms/${encodeURIComponent(realmKey)}/start`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function chooseRoguelikeFloor(
  runId: string,
  choiceKey: string,
): Promise<RoguelikeRunView> {
  const { data } = await apiClient.post<Envelope<{ run: RoguelikeRunView }>>(
    `/roguelike-runs/${encodeURIComponent(runId)}/choose`,
    { choiceKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function abandonRoguelikeRun(
  runId: string,
): Promise<RoguelikeRunView> {
  const { data } = await apiClient.post<Envelope<{ run: RoguelikeRunView }>>(
    `/roguelike-runs/${encodeURIComponent(runId)}/abandon`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function claimRoguelikeRun(
  runId: string,
): Promise<RoguelikeClaimResult> {
  const { data } = await apiClient.post<Envelope<RoguelikeClaimResult>>(
    `/roguelike-runs/${encodeURIComponent(runId)}/claim`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function fetchRoguelikeLeaderboard(
  limit = 50,
): Promise<RoguelikeLeaderboardEntry[]> {
  const { data } = await apiClient.get<
    Envelope<{ entries: RoguelikeLeaderboardEntry[] }>
  >('/roguelike-runs/leaderboard', { params: { limit } });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.entries;
}
