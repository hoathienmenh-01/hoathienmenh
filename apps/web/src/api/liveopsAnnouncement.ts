/**
 * Phase 15.3.B — Player API client cho LiveOps Announcement.
 *
 * `GET /liveops/announcements/active` — public-safe view (KHÔNG có
 * adminId / id / disabledAt). Anonymous viewer được phép xem (chỉ thấy
 * `target=ALL`). Trả `[]` nếu API lỗi (fail-soft — marquee sẽ render
 * empty thay vì crash trang).
 */
import { apiClient } from './client';
import type { LiveOpsAnnouncementPublicView } from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export type { LiveOpsAnnouncementPublicView };

export async function getActiveLiveOpsAnnouncements(): Promise<
  LiveOpsAnnouncementPublicView[]
> {
  try {
    const { data } = await apiClient.get<
      Envelope<LiveOpsAnnouncementPublicView[]>
    >('/liveops/announcements/active');
    if (!data.ok || !data.data) return [];
    return data.data;
  } catch {
    return [];
  }
}
