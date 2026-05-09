import { apiClient } from './client';

export type MissionPeriod = 'DAILY' | 'WEEKLY' | 'ONCE';

export interface MissionRewardItem {
  itemKey: string;
  qty: number;
}

export interface MissionReward {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  congHien?: number;
  items?: MissionRewardItem[];
}

export interface MissionProgressView {
  key: string;
  name: string;
  description: string;
  period: MissionPeriod;
  goalKind: string;
  goalAmount: number;
  currentAmount: number;
  claimed: boolean;
  completable: boolean;
  windowEnd: string | null;
  rewards: MissionReward;
  quality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THANH';
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function listMissions(): Promise<MissionProgressView[]> {
  const { data } = await apiClient.get<Envelope<{ missions: MissionProgressView[] }>>(
    '/missions/me',
  );
  return unwrap(data).missions;
}

/**
 * Phase 16.5 — Daily Reward Cap. Mission claim trả thêm `claim` object
 * với cap info (capped, cappedAmount, dailyCapRemaining). Optional cho
 * compat với pre-16.5 server (sẽ không tồn tại field).
 */
export interface MissionClaimInfo {
  missionKey: string;
  granted: { exp: number; linhThach: number; tienNgoc: number };
  capped: boolean;
  cappedAmount?: { exp: number; linhThach: number };
  dailyCapRemaining: { exp: number; linhThach: number };
}

export interface MissionClaimResult {
  missions: MissionProgressView[];
  /** Optional — chỉ tồn tại khi server >= Phase 16.5. */
  claim?: MissionClaimInfo;
}

export async function claimMission(
  missionKey: string,
): Promise<MissionClaimResult> {
  const { data } = await apiClient.post<
    Envelope<{ missions: MissionProgressView[]; claim?: MissionClaimInfo }>
  >('/missions/claim', { missionKey });
  const payload = unwrap(data);
  return { missions: payload.missions, claim: payload.claim };
}
