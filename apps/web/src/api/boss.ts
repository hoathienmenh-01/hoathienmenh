import type { ElementKey } from '@xuantoi/shared';
import { apiClient } from './client';

export interface BossLeaderboardRow {
  rank: number;
  characterId: string;
  characterName: string;
  damage: string;
  hits: number;
}

export interface BossView {
  id: string;
  bossKey: string;
  name: string;
  description: string;
  level: number;
  maxHp: string;
  currentHp: string;
  status: 'ACTIVE' | 'DEFEATED' | 'EXPIRED';
  spawnedAt: string;
  expiresAt: string;
  /**
   * Phase 12.6 — region scope cho multi-region auto-spawn. `'world'` cho
   * legacy cross-region world boss; ngược lại match `RegionKey` ở
   * `@xuantoi/shared/src/map-regions.ts` (`'hac_lam'`, `'kim_son_mach'`,
   * v.v.).
   */
  regionKey: string;
  leaderboard: BossLeaderboardRow[];
  myDamage: string | null;
  myRank: number | null;
  participants: number;
  cooldownUntil: string | null;
  topDropPool: string[];
  midDropPool: string[];
  /**
   * Phase 14.2.D — Ngũ Hành identity profile cho boss. UI hint thuần
   * (combat damage tính qua `elementalMultiplier` +
   * `composeMonsterElementalResist` ở shared, không đọc field này).
   */
  elementProfile: {
    element: ElementKey | null;
    weaknessElement: ElementKey | null;
    resistElements: readonly ElementKey[];
    rewardElementHint: ElementKey | null;
  };
}

export interface AttackResult {
  damageDealt: string;
  bossHp: string;
  bossMaxHp: string;
  defeated: boolean;
  myDamageTotal: string;
  myRank: number;
  charHp: number;
  charMp: number;
  charStamina: number;
}

export interface DefeatedRewardSlice {
  rank: number;
  characterId: string;
  characterName: string;
  damage: string;
  linhThach: string;
  items: { itemKey: string; qty: number }[];
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

export async function getCurrentBoss(): Promise<BossView | null> {
  const { data } = await apiClient.get<Envelope<{ boss: BossView | null }>>('/boss/current');
  return unwrap(data).boss;
}

/**
 * Phase 12.6 — list ACTIVE boss across regions (sorted ascending theo
 * regionKey). FE BossView dùng cho region tabs.
 */
export async function getActiveBosses(): Promise<BossView[]> {
  const { data } = await apiClient.get<Envelope<{ bosses: BossView[] }>>(
    '/boss/active',
  );
  return unwrap(data).bosses;
}

/**
 * Phase 12.6 — single ACTIVE boss trong region cụ thể, hoặc null nếu
 * region trống slot.
 */
export async function getCurrentBossByRegion(
  regionKey: string,
): Promise<BossView | null> {
  const { data } = await apiClient.get<Envelope<{ boss: BossView | null }>>(
    `/boss/region/${encodeURIComponent(regionKey)}`,
  );
  return unwrap(data).boss;
}

/**
 * Phase 12.6 — attack boss. `bossId` optional cho multi-region
 * disambiguation. Không truyền → server fallback "primary" (1st ACTIVE
 * found, most recent spawn).
 */
export async function attackBoss(
  skillKey?: string,
  bossId?: string,
): Promise<{ result: AttackResult; defeated: DefeatedRewardSlice[] | null }> {
  const { data } = await apiClient.post<
    Envelope<{ result: AttackResult; defeated: DefeatedRewardSlice[] | null }>
  >('/boss/attack', { skillKey, bossId });
  return unwrap(data);
}
