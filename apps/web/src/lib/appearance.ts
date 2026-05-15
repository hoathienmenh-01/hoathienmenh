/**
 * Cửu Thiên Mộng — Appearance helper.
 *
 * Áp data-theme attribute lên <html>:
 *   - 'dark'   → data-theme="night" (Cửu Thiên Mộng default).
 *   - 'light'  → data-theme="day"   (legacy Celestial Jade opt-in).
 *   - 'system' → theo prefers-color-scheme.
 *
 * Persist sang localStorage để load đầu trang không nhấp nháy.
 * KHÔNG đụng tới backend — `appearance` đã có sẵn trong PlayerSettings.
 */

const STORAGE_KEY = 'xt.appearance';

export type AppearanceMode = 'light' | 'dark' | 'system';

function isValidMode(v: unknown): v is AppearanceMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

function resolveTheme(mode: AppearanceMode): 'day' | 'night' {
  if (mode === 'light') return 'day';
  if (mode === 'dark') return 'night';
  // system
  if (typeof window === 'undefined') return 'night';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'night'
    : 'day';
}

export function applyAppearance(mode: AppearanceMode): void {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // SSR / privacy mode — ignore.
  }
}

export function loadCachedAppearance(): AppearanceMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (isValidMode(v)) return v;
  } catch {
    // ignore
  }
  return 'dark';
}

/** Gắn listener theo system mode khi user chọn 'system'. */
let mediaQuery: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;

export function watchSystemAppearance(currentMode: () => AppearanceMode): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (mediaQuery && mediaHandler) {
    mediaQuery.removeEventListener('change', mediaHandler);
  }
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaHandler = () => {
    if (currentMode() === 'system') applyAppearance('system');
  };
  mediaQuery.addEventListener('change', mediaHandler);
  return () => {
    if (mediaQuery && mediaHandler) {
      mediaQuery.removeEventListener('change', mediaHandler);
    }
  };
}
