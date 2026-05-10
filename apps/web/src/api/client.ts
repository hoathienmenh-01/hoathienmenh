import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  withCredentials: true,
  timeout: 15_000,
});

interface ApiErrorBody {
  ok?: boolean;
  error?: { code?: string; message?: string };
}

interface RetryConfig extends InternalAxiosRequestConfig {
  __xtRetried?: boolean;
}

const REFRESH_PATH = '/_auth/refresh';
const SESSION_PATH = '/_auth/session';
const LOGIN_PATH = '/_auth/login';
const REGISTER_PATH = '/_auth/register';

let inflightRefresh: Promise<boolean> | null = null;

async function tryRefreshOnce(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const { data } = await apiClient.post<ApiErrorBody>(REFRESH_PATH);
      return data?.ok === true;
    } catch {
      return false;
    } finally {
      // Allow next 401 to attempt again later (e.g. user re-logs in).
      setTimeout(() => {
        inflightRefresh = null;
      }, 0);
    }
  })();
  return inflightRefresh;
}

apiClient.interceptors.response.use(
  (resp) => resp,
  async (err: AxiosError<ApiErrorBody>) => {
    const status = err?.response?.status;
    const cfg = err?.config as RetryConfig | undefined;
    const url = cfg?.url ?? '';
    const body = err?.response?.data;
    const appCode = body?.error?.code;
    const appMessage = body?.error?.message;

    // Annotate the error early so callers can read err.code / err.message.
    if (appCode) (err as AxiosError & { code?: string }).code = appCode;
    if (appMessage) err.message = appMessage;

    const isAuthAttempt =
      url.endsWith(REFRESH_PATH) ||
      url.endsWith(LOGIN_PATH) ||
      url.endsWith(REGISTER_PATH);

    if (status === 401 && cfg && !cfg.__xtRetried && !isAuthAttempt) {
      cfg.__xtRetried = true;
      const refreshed = await tryRefreshOnce();
      if (refreshed) {
        return apiClient.request(cfg);
      }
    }

    if (status === 401 && typeof window !== 'undefined') {
      const here = window.location.pathname;
      // Don't bounce away from public auth pages or initial /session probes.
      if (!here.startsWith('/auth') && !url.endsWith(SESSION_PATH)) {
        window.location.href = '/auth';
      }
    }

    // Phase 15.5 — detect maintenance block. Server trả 503 +
    // `error.code = MAINTENANCE_ACTIVE` kèm meta cho FE render overlay.
    // Lên hệ store async để tránh import circular giữa client ↔ stores.
    if (
      status === 503 &&
      appCode === 'MAINTENANCE_ACTIVE' &&
      body?.error &&
      typeof window !== 'undefined'
    ) {
      const meta = (body.error as { meta?: Record<string, unknown> }).meta;
      if (meta && typeof meta === 'object') {
        // Dynamic import để lib axios standalone vẫn build cho test.
        void import('@/stores/maintenance').then((mod) => {
          try {
            const store = mod.useMaintenanceStore();
            store.markBlockedByApi({
              severity: String(meta.severity ?? 'INFO'),
              target: String(meta.target ?? 'ALL_PLAYERS'),
              titleVi: String(meta.titleVi ?? ''),
              titleEn: meta.titleEn == null ? null : String(meta.titleEn),
              messageVi: String(meta.messageVi ?? ''),
              messageEn: meta.messageEn == null ? null : String(meta.messageEn),
              endsAt: String(meta.endsAt ?? ''),
              serverTime: String(meta.serverTime ?? new Date().toISOString()),
            });
          } catch {
            /* ignore — pinia chưa mốunt */
          }
        });
      }
    }

    return Promise.reject(err);
  },
);
