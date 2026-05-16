/**
 * Phase 15.8 — Admin Sect Season client.
 *
 * Endpoints (ADMIN-only, `AdminGuard` server-side):
 *   - GET /admin/sect-season/hall-of-fame — overview list mọi season đã
 *     finalize + reward grant stats + champion snapshot meta + aggregate
 *     Hall of Fame. Dùng cho Admin Hall of Fame view.
 *   - GET /admin/sect-season/:seasonKey/champion-snapshot — full
 *     champion membership snapshot (audit detail). Phase 15.8 đã có
 *     trong session trước; client wrap nằm ở đây để gom đầu mối admin.
 *
 * KHÔNG mutate. KHÔNG expose dữ liệu nhạy cảm (chỉ characterId).
 */
import { apiClient } from './client';
import type {
  SectSeasonHistoryMemberEntry,
  SectSeasonHistorySectEntry,
  SectHallOfFameView,
} from './sectSeason';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined || env.data === null) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export interface AdminSectSeasonRewardStatus {
  championGrants: number;
  mvpGrants: number;
  lastChampionGrantAt: string | null;
  lastMvpGrantAt: string | null;
}

export interface AdminSectSeasonChampionSnapshotMeta {
  sectId: string;
  rank: number;
  memberCount: number;
  createdAt: string;
}

export interface AdminSectSeasonSummary {
  seasonKey: string;
  finalizedAt: string;
  totalSects: number;
  totalContributors: number;
  totalPoints: number;
  champion: SectSeasonHistorySectEntry | null;
  mvp: SectSeasonHistoryMemberEntry | null;
  rewardStatus: AdminSectSeasonRewardStatus;
  championSnapshot: AdminSectSeasonChampionSnapshotMeta | null;
}

export interface AdminSectSeasonHallOfFameView {
  checkedAt: string;
  seasons: ReadonlyArray<AdminSectSeasonSummary>;
  hallOfFame: SectHallOfFameView;
}

export interface AdminSectSeasonChampionSnapshotDetail {
  seasonKey: string;
  sectId: string;
  rank: number;
  memberCount: number;
  memberCharacterIds: ReadonlyArray<string>;
  createdAt: string;
}

export async function getAdminSectSeasonHallOfFame(): Promise<AdminSectSeasonHallOfFameView> {
  const { data } = await apiClient.get<Envelope<AdminSectSeasonHallOfFameView>>(
    '/admin/sect-season/hall-of-fame',
  );
  return unwrap(data);
}

export async function getAdminSectSeasonChampionSnapshot(
  seasonKey: string,
): Promise<AdminSectSeasonChampionSnapshotDetail> {
  const { data } = await apiClient.get<Envelope<AdminSectSeasonChampionSnapshotDetail>>(
    `/admin/sect-season/${encodeURIComponent(seasonKey)}/champion-snapshot`,
  );
  return unwrap(data);
}
