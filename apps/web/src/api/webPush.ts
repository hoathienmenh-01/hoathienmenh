import { i18n } from '@/i18n';
import { apiClient } from './client';
import type {
  WebPushPreferencesView,
  WebPushSubscriptionView,
} from '@xuantoi/shared';

/**
 * Phase PWA-1 — Web Push API client.
 *
 * Wraps `/push/*` endpoints with envelope unwrap. Caller maps thrown
 * `error.code` to i18n key `webPush.errors.${code}`.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

function unwrap<T>(env: Envelope<T>, op: string): T {
  if (!env.ok || env.data === undefined) {
    if (env.error?.code) throw env.error;
    throw fallbackError(op);
  }
  return env.data;
}

export interface PreferencesPatch {
  bossSpawnEnabled?: boolean;
  staminaFullEnabled?: boolean;
  mailEnabled?: boolean;
  dailyReminderEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string | null;
}

export async function getVapidPublicKey(): Promise<string> {
  const res = await apiClient.get<Envelope<{ publicKey: string }>>(
    '/push/vapid-public-key',
  );
  return unwrap(res.data, 'pushVapid').publicKey;
}

export async function subscribePush(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<WebPushSubscriptionView> {
  const res = await apiClient.post<Envelope<WebPushSubscriptionView>>(
    '/push/subscribe',
    input,
  );
  return unwrap(res.data, 'pushSubscribe');
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await apiClient.post<Envelope<{ ok: true }>>(
    '/push/unsubscribe',
    { endpoint },
  );
  unwrap(res.data, 'pushUnsubscribe');
}

export async function listPushSubscriptions(): Promise<
  WebPushSubscriptionView[]
> {
  const res = await apiClient.get<Envelope<WebPushSubscriptionView[]>>(
    '/push/subscriptions',
  );
  return unwrap(res.data, 'pushList');
}

export async function getPushPreferences(): Promise<WebPushPreferencesView> {
  const res = await apiClient.get<Envelope<WebPushPreferencesView>>(
    '/push/preferences',
  );
  return unwrap(res.data, 'pushPrefs');
}

export async function updatePushPreferences(
  patch: PreferencesPatch,
): Promise<WebPushPreferencesView> {
  const res = await apiClient.patch<Envelope<WebPushPreferencesView>>(
    '/push/preferences',
    patch,
  );
  return unwrap(res.data, 'pushPrefsUpdate');
}

/**
 * Base64url ⇄ Uint8Array helper. PushManager.subscribe yêu cầu
 * `applicationServerKey` là `Uint8Array | ArrayBuffer`.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}
