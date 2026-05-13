import { ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/worldContent';

/**
 * Phase 26.5 — World Content V2 store (Pinia).
 *
 * Mirror server `WorldContentController`:
 *   - `summary`         – `GET /world/summary`
 *   - `farmMaps`        – `GET /world/farm-maps`
 *   - `dungeons`        – `GET /world/dungeons`
 *   - `bosses`          – `GET /world/bosses`
 *   - `sectDungeons`    – `GET /world/sect-dungeons`
 *   - `sectBosses`      – `GET /world/sect-bosses`
 *   - `opportunities`   – `GET /world/opportunities`
 *   - `towers`          – `GET /world/towers`
 *
 * Mutating actions:
 *   - `startFarm(mapKey)` / `claimFarm(sessionId)` – farm session lifecycle.
 *   - `attemptTower(towerKey, floor)` – tower floor attempt.
 *
 * Trả `string | null`: `null` = success, code = i18n error code
 * `worldContent.errors.<code>` cho caller hiển thị toast.
 */
export const useWorldContentStore = defineStore('worldContent', () => {
  const summary = ref<api.WorldContentSummary | null>(null);
  const farmMaps = ref<api.FarmMapView[]>([]);
  const dungeons = ref<api.DungeonV2View[]>([]);
  const bosses = ref<api.BossV2View[]>([]);
  const sectDungeons = ref<api.SectDungeonView[]>([]);
  const sectBosses = ref<api.SectBossView[]>([]);
  const opportunities = ref<api.OpportunityView[]>([]);
  const towers = ref<api.TrialTowerView[]>([]);

  const lastFarmClaim = ref<api.FarmSessionClaimResult | null>(null);
  const lastTowerResult = ref<api.TrialTowerAttemptResult | null>(null);
  const activeFarmSession = ref<api.FarmSessionView | null>(null);

  const loaded = ref<Record<string, boolean>>({});
  const inFlight = ref<Set<string>>(new Set());

  function track(key: string): void {
    inFlight.value = new Set(inFlight.value).add(key);
  }
  function untrack(key: string): void {
    if (!inFlight.value.has(key)) return;
    const next = new Set(inFlight.value);
    next.delete(key);
    inFlight.value = next;
  }
  function busy(key: string): boolean {
    return inFlight.value.has(key);
  }

  function extractErrorCode(e: unknown): string {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code?: string }).code;
      if (typeof code === 'string') return code;
    }
    return 'UNKNOWN';
  }

  async function run<T>(
    key: string,
    op: () => Promise<T>,
    onSuccess: (data: T) => void,
  ): Promise<string | null> {
    track(key);
    try {
      onSuccess(await op());
      loaded.value = { ...loaded.value, [key]: true };
      return null;
    } catch (e) {
      return extractErrorCode(e);
    } finally {
      untrack(key);
    }
  }

  async function fetchSummary(): Promise<string | null> {
    return run('summary', api.getWorldSummary, (d) => {
      summary.value = d;
    });
  }
  async function fetchFarmMaps(): Promise<string | null> {
    return run('farmMaps', api.listFarmMaps, (d) => {
      farmMaps.value = d;
    });
  }
  async function fetchDungeons(): Promise<string | null> {
    return run('dungeons', api.listDungeonsV2, (d) => {
      dungeons.value = d;
    });
  }
  async function fetchBosses(): Promise<string | null> {
    return run('bosses', api.listBossesV2, (d) => {
      bosses.value = d;
    });
  }
  async function fetchSectDungeons(): Promise<string | null> {
    return run('sectDungeons', api.listSectDungeons, (d) => {
      sectDungeons.value = d;
    });
  }
  async function fetchSectBosses(): Promise<string | null> {
    return run('sectBosses', api.listSectBosses, (d) => {
      sectBosses.value = d;
    });
  }
  async function fetchOpportunities(): Promise<string | null> {
    return run('opportunities', api.listOpportunities, (d) => {
      opportunities.value = d;
    });
  }
  async function fetchTowers(): Promise<string | null> {
    return run('towers', api.listTrialTowers, (d) => {
      towers.value = d;
    });
  }

  async function startFarm(mapKey: string): Promise<string | null> {
    return run(
      `farmStart:${mapKey}`,
      () => api.startFarmSession(mapKey),
      (d) => {
        activeFarmSession.value = d;
      },
    );
  }

  async function claimFarm(sessionId: string): Promise<string | null> {
    return run(
      `farmClaim:${sessionId}`,
      () => api.claimFarmSession(sessionId),
      (d) => {
        lastFarmClaim.value = d;
        activeFarmSession.value = null;
      },
    );
  }

  async function attemptTower(
    towerKey: string,
    floor: number,
  ): Promise<string | null> {
    return run(
      `tower:${towerKey}:${floor}`,
      () => api.attemptTrialFloor(towerKey, floor),
      (d) => {
        lastTowerResult.value = d;
        // Best-effort optimistic: bump highestFloorCleared if applicable.
        if (d.success && d.isFirstClear) {
          const idx = towers.value.findIndex((t) => t.key === towerKey);
          if (idx >= 0) {
            const cur = towers.value[idx]!;
            towers.value = [
              ...towers.value.slice(0, idx),
              {
                ...cur,
                highestFloorCleared: Math.max(cur.highestFloorCleared, floor),
                seasonHighestFloor: Math.max(cur.seasonHighestFloor, floor),
              },
              ...towers.value.slice(idx + 1),
            ];
          }
        }
      },
    );
  }

  return {
    // state
    summary,
    farmMaps,
    dungeons,
    bosses,
    sectDungeons,
    sectBosses,
    opportunities,
    towers,
    lastFarmClaim,
    lastTowerResult,
    activeFarmSession,
    loaded,
    // actions
    busy,
    fetchSummary,
    fetchFarmMaps,
    fetchDungeons,
    fetchBosses,
    fetchSectDungeons,
    fetchSectBosses,
    fetchOpportunities,
    fetchTowers,
    startFarm,
    claimFarm,
    attemptTower,
  };
});
