import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 26.5 — World Content V2 (Farm Maps / Dungeons V2 / Bosses V2 /
 * Sect / Trial Towers / Opportunities) UI API client.
 *
 * Wire endpoint server (`WorldContentController`):
 *   - `GET    /world/summary`               – content statistics.
 *   - `GET    /world/farm-maps`             – list farm maps (auth).
 *   - `POST   /world/farm/:farmMapKey/start`         – start session.
 *   - `POST   /world/farm/sessions/:sessionId/claim` – claim reward.
 *   - `GET    /world/dungeons`              – DUNGEONS_V2 catalog.
 *   - `GET    /world/bosses`                – BOSSES_V2 catalog.
 *   - `GET    /world/sect-dungeons`         – SECT_DUNGEONS catalog.
 *   - `GET    /world/sect-bosses`           – SECT_BOSSES catalog.
 *   - `GET    /world/opportunities`         – OPPORTUNITIES catalog.
 *   - `GET    /world/towers`                – tower list + progress (auth).
 *   - `POST   /world/towers/:towerKey/attempt` – attempt floor (auth).
 *
 * Server-authoritative: client KHÔNG truyền reward / sourceTier /
 * battlePower — server tự tính từ snapshot character & catalog static.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

// ─── Summary ─────────────────────────────────────────────────────────────

export interface WorldContentSummary {
  totalRegions: number;
  totalFarmMaps: number;
  totalDungeons: number;
  totalStoryDungeons: number;
  totalSectDungeons: number;
  totalTrialTowers: number;
  totalBosses: number;
  totalWorldBosses: number;
  totalEventBosses: number;
  totalSectBosses: number;
  totalQuestBosses: number;
  totalMonsters: number;
  totalEliteMonsters: number;
  totalOpportunities: number;
  contentByRegion: ReadonlyArray<WorldRegionContentRow>;
}

export interface WorldRegionContentRow {
  regionKey: string;
  farmMaps: number;
  dungeons: number;
  bosses: number;
  opportunities: number;
}

// ─── Farm Map ────────────────────────────────────────────────────────────

export interface FarmMapView {
  key: string;
  regionKey: string;
  nameVi: string;
  nameEn: string;
  sourceTier: number;
  recommendedRealmOrder: number;
  unlockRealmOrder: number;
  unlocked: boolean;
  unlockReason: string | null;
  autoFarmAllowed: boolean;
  sweepAllowed: boolean;
  freeSessionMinutes: number;
  sessionLimitMinutes: number;
  maxSessionMinutes: number;
  monsterPoolSize: number;
  opportunityPoolSize: number;
  enabled: boolean;
}

export interface FarmRewardSnapshot {
  linhThach: number;
  exp: number;
  sourceTier: number;
  items: ReadonlyArray<{ itemKey: string; qty: number }>;
}

export interface FarmSessionView {
  id: string;
  farmMapKey: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  minutesProcessed: number;
  sessionLimitMinutes: number;
  rewards: FarmRewardSnapshot;
}

export interface FarmSessionClaimResult {
  sessionId: string;
  farmMapKey: string;
  minutesProcessed: number;
  startedAt: string;
  claimedAt: string;
  rewards: FarmRewardSnapshot;
  capUsage: {
    dayBucket: string;
    minutesUsed: number;
    sessionsUsed: number;
    dailyLimit: number;
  };
}

// ─── Dungeon V2 ─────────────────────────────────────────────────────────

export interface DungeonV2View {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: string;
  regionKey: string;
  sourceTier: number;
  dungeonTier: number;
  unlockRealmOrder: number;
  dailyAttempts: number;
}

// ─── Boss V2 ─────────────────────────────────────────────────────────────

export interface BossV2View {
  key: string;
  nameVi: string;
  nameEn: string;
  category: string;
  family: string;
  element: string;
  regionKey: string | null;
  sourceTier: number;
  bossTier: number;
  recommendedRealmOrder: number;
  dailyRewardCap: number | null;
  weeklyRewardCap: number | null;
  manualOnly: boolean;
}

// ─── Sect Content ────────────────────────────────────────────────────────

export interface SectDungeonView {
  key: string;
  nameVi: string;
  nameEn: string;
  category: string;
  requiredSectLevel: number;
  sourceTier: number;
  dailyAttemptsPerMember: number;
  weeklyAttemptsPerSect: number | null;
  contributionCost: number;
}

export interface SectBossView {
  key: string;
  nameVi: string;
  nameEn: string;
  category: string;
  family: string;
  requiredSectLevel: number;
  sourceTier: number;
  bossTier: number;
}

// ─── Opportunity ─────────────────────────────────────────────────────────

export interface OpportunityView {
  key: string;
  nameVi: string;
  nameEn: string;
  regionKey: string;
  rarity: string;
  sourceTier: number;
  maxDailyTriggers: number;
  maxWeeklyTriggers: number | null;
}

// ─── Trial Tower ─────────────────────────────────────────────────────────

export interface TrialTowerView {
  key: string;
  towerType: 'DANG_TIEN_THAP' | 'LINH_KHI_THAP' | 'HUYET_THE_THAP';
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  unlockRealmOrder: number;
  unlocked: boolean;
  infiniteScaling: boolean;
  maxGeneratedFloor: number | null;
  dailyAttempts: number;
  statWeights: Record<string, number>;
  highestFloorCleared: number;
  seasonHighestFloor: number;
  enabled: boolean;
}

export interface TrialTowerFloorReward {
  linhThach: number;
  exp: number;
  trialPoints: number;
}

export interface TrialTowerAttemptResult {
  towerKey: string;
  floor: number;
  success: boolean;
  requiredPower: number;
  battlePower: number;
  enemyType: string;
  isFirstClear: boolean;
  milestoneClaimed: boolean;
  reward: TrialTowerFloorReward;
}

// ─── API helpers ─────────────────────────────────────────────────────────

async function get<T>(url: string, op: string): Promise<T> {
  const { data } = await apiClient.get<Envelope<T>>(url);
  if (!data.ok || !data.data) throw data.error ?? fallbackError(op);
  return data.data;
}

async function post<T>(url: string, body: unknown, op: string): Promise<T> {
  const { data } = await apiClient.post<Envelope<T>>(url, body);
  if (!data.ok || !data.data) throw data.error ?? fallbackError(op);
  return data.data;
}

// ─── Public exports ──────────────────────────────────────────────────────

export async function getWorldSummary(): Promise<WorldContentSummary> {
  return get<WorldContentSummary>('/world/summary', 'worldSummary');
}

export async function listFarmMaps(): Promise<FarmMapView[]> {
  return get<FarmMapView[]>('/world/farm-maps', 'farmMaps');
}

export async function startFarmSession(
  farmMapKey: string,
): Promise<FarmSessionView> {
  const r = await post<{ session: FarmSessionView }>(
    `/world/farm/${farmMapKey}/start`,
    {},
    'farmStart',
  );
  return r.session;
}

export async function claimFarmSession(
  sessionId: string,
): Promise<FarmSessionClaimResult> {
  return post<FarmSessionClaimResult>(
    `/world/farm/sessions/${sessionId}/claim`,
    {},
    'farmClaim',
  );
}

export async function listDungeonsV2(): Promise<DungeonV2View[]> {
  return get<DungeonV2View[]>('/world/dungeons', 'dungeonsV2');
}

export async function listBossesV2(): Promise<BossV2View[]> {
  return get<BossV2View[]>('/world/bosses', 'bossesV2');
}

export async function listSectDungeons(): Promise<SectDungeonView[]> {
  return get<SectDungeonView[]>('/world/sect-dungeons', 'sectDungeons');
}

export async function listSectBosses(): Promise<SectBossView[]> {
  return get<SectBossView[]>('/world/sect-bosses', 'sectBosses');
}

export async function listOpportunities(): Promise<OpportunityView[]> {
  return get<OpportunityView[]>('/world/opportunities', 'opportunities');
}

export async function listTrialTowers(): Promise<TrialTowerView[]> {
  return get<TrialTowerView[]>('/world/towers', 'trialTowers');
}

export async function attemptTrialFloor(
  towerKey: string,
  floor: number,
  clearTimeSeconds?: number,
): Promise<TrialTowerAttemptResult> {
  return post<TrialTowerAttemptResult>(
    `/world/towers/${towerKey}/attempt`,
    { floor, ...(clearTimeSeconds == null ? {} : { clearTimeSeconds }) },
    'trialTowerAttempt',
  );
}
