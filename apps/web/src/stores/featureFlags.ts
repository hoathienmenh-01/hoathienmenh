/**
 * Phase 15.4 — Pinia store cho Feature Flag (public view).
 *
 * Trách nhiệm:
 *   - Fetch list public flag từ `/feature-flags/public` 1 lần khi mount,
 *     cache 30s. App shell gọi `ensureLoaded()` early.
 *   - Cung cấp `isEnabled(key)` cho component gate UI (Arena challenge,
 *     Reforge/Enchant button, Festival gift claim, ...).
 *   - Default fail-open: nếu API lỗi / chưa fetch xong → coi flag là ON
 *     (tránh ẩn UI khi backend tạm gián đoạn). Server vẫn gate cuối
 *     cùng qua `FEATURE_DISABLED` 503 — UI không bypass được.
 *
 * KHÔNG chứa admin flag (full metadata) — admin panel fetch riêng từ
 * `adminListFeatureFlags()` để tránh leak description/category cho user
 * thường.
 */
import { defineStore } from 'pinia';
import type { FeatureFlagKey, FeatureFlagPublicView } from '@xuantoi/shared';
import { getPublicFeatureFlags } from '@/api/featureFlag';

const TTL_MS = 30_000;

interface State {
  flags: Record<string, boolean>;
  loadedAt: number;
  loading: boolean;
  loaded: boolean;
}

export const useFeatureFlagsStore = defineStore('featureFlags', {
  state: (): State => ({
    flags: {},
    loadedAt: 0,
    loading: false,
    loaded: false,
  }),
  getters: {
    /**
     * Trả `true` nếu flag enabled (hoặc chưa fetch — fail-open).
     * Server vẫn gate cuối cùng (`FEATURE_DISABLED` 503) — FE chỉ ẩn UI
     * cho UX. Không bypass được logic server-authoritative.
     */
    isEnabled(state) {
      return (key: FeatureFlagKey): boolean => {
        if (!state.loaded) return true;
        const v = state.flags[key];
        if (v === undefined) return true;
        return v;
      };
    },
    isDisabled(state) {
      return (key: FeatureFlagKey): boolean => {
        if (!state.loaded) return false;
        const v = state.flags[key];
        if (v === undefined) return false;
        return v === false;
      };
    },
  },
  actions: {
    /** Fetch lần đầu nếu chưa cache hoặc cache hết hạn. */
    async ensureLoaded(force = false): Promise<void> {
      const now = Date.now();
      if (
        !force &&
        this.loaded &&
        now - this.loadedAt < TTL_MS
      ) {
        return;
      }
      if (this.loading) return;
      this.loading = true;
      try {
        const list: FeatureFlagPublicView[] = await getPublicFeatureFlags();
        const next: Record<string, boolean> = {};
        for (const f of list) {
          next[f.key] = f.enabled;
        }
        this.flags = next;
        this.loadedAt = now;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },
    /** Force refresh (sau khi admin toggle, hoặc 30s timer). */
    async refresh(): Promise<void> {
      await this.ensureLoaded(true);
    },
    /** Test/QA helper: reset state. */
    reset(): void {
      this.flags = {};
      this.loadedAt = 0;
      this.loading = false;
      this.loaded = false;
    },
  },
});
