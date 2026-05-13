import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  getPushPreferences,
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  updatePushPreferences,
  urlBase64ToUint8Array,
  type PreferencesPatch,
} from '@/api/webPush';
import type { WebPushPreferencesView } from '@xuantoi/shared';

/**
 * Phase PWA-1 — useWebPush composable.
 *
 * Centralises:
 *   - permission state.
 *   - PushManager subscribe / unsubscribe.
 *   - per-type preferences fetch + update.
 *
 * Browser support detection — push notifications require service
 * worker + PushManager + Notification API; gracefully degrade.
 */

export type PermissionStatus = 'default' | 'granted' | 'denied' | 'unsupported';

export interface UseWebPushApi {
  permission: Ref<PermissionStatus>;
  subscribed: Ref<boolean>;
  prefs: Ref<WebPushPreferencesView | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  supported: ComputedRef<boolean>;
  refreshStatus: () => Promise<void>;
  enable: () => Promise<{ ok: boolean; reason?: string }>;
  disable: () => Promise<void>;
  updatePrefs: (patch: PreferencesPatch) => Promise<void>;
}

function detectSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (typeof Notification === 'undefined') return false;
  return true;
}

function currentPermission(): PermissionStatus {
  if (!detectSupported()) return 'unsupported';
  switch (Notification.permission) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'default';
  }
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // Wait for registration if not yet ready — vite-plugin-pwa registers async.
  return navigator.serviceWorker.ready;
}

export function useWebPush(): UseWebPushApi {
  const permission = ref<PermissionStatus>(currentPermission());
  const subscribed = ref(false);
  const prefs = ref<WebPushPreferencesView | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const supported = computed(() => permission.value !== 'unsupported');

  async function fetchPrefsSilent(): Promise<void> {
    try {
      prefs.value = await getPushPreferences();
    } catch (err: unknown) {
      // Permission to view prefs (cookie required) — surface non-blocking.
      error.value = mapError(err);
    }
  }

  async function refreshStatus(): Promise<void> {
    permission.value = currentPermission();
    if (!supported.value) {
      subscribed.value = false;
      return;
    }
    const reg = await getServiceWorkerRegistration();
    if (!reg) {
      subscribed.value = false;
      return;
    }
    const sub = await reg.pushManager.getSubscription();
    subscribed.value = sub !== null;
    await fetchPrefsSilent();
  }

  async function enable(): Promise<{ ok: boolean; reason?: string }> {
    if (!supported.value) return { ok: false, reason: 'UNSUPPORTED' };
    loading.value = true;
    error.value = null;
    try {
      // 1. Permission.
      const perm = await Notification.requestPermission();
      permission.value =
        perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'default';
      if (perm !== 'granted') {
        return { ok: false, reason: 'PERMISSION_DENIED' };
      }
      // 2. VAPID key.
      const vapid = await getVapidPublicKey();
      // PushManager.subscribe() expects `BufferSource` — wrap explicitly
      // to avoid `Uint8Array<ArrayBufferLike>` vs `ArrayBuffer` mismatch
      // in newer lib.dom typings.
      const applicationServerKey = urlBase64ToUint8Array(vapid)
        .buffer as ArrayBuffer;
      // 3. PushManager subscribe.
      const reg = await getServiceWorkerRegistration();
      if (!reg) return { ok: false, reason: 'SW_NOT_REGISTERED' };
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }
      // 4. POST to backend.
      const json = sub.toJSON();
      const endpoint = json.endpoint ?? sub.endpoint;
      const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string };
      if (!endpoint || !keys.p256dh || !keys.auth) {
        return { ok: false, reason: 'KEYS_MISSING' };
      }
      await subscribePush({
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
      });
      subscribed.value = true;
      await fetchPrefsSilent();
      return { ok: true };
    } catch (err: unknown) {
      error.value = mapError(err);
      return { ok: false, reason: 'ERROR' };
    } finally {
      loading.value = false;
    }
  }

  async function disable(): Promise<void> {
    if (!supported.value) return;
    loading.value = true;
    error.value = null;
    try {
      const reg = await getServiceWorkerRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      subscribed.value = false;
    } catch (err: unknown) {
      error.value = mapError(err);
    } finally {
      loading.value = false;
    }
  }

  async function updatePrefs(patch: PreferencesPatch): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      prefs.value = await updatePushPreferences(patch);
    } catch (err: unknown) {
      error.value = mapError(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    permission,
    subscribed,
    prefs,
    loading,
    error,
    supported,
    refreshStatus,
    enable,
    disable,
    updatePrefs,
  };
}

function mapError(err: unknown): string {
  if (err && typeof err === 'object') {
    const obj = err as { code?: string; message?: string };
    if (obj.code) return String(obj.code);
    if (obj.message) return obj.message;
  }
  return 'UNKNOWN';
}
