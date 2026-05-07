/**
 * Phase 13.1.B — Sect Shop API client.
 *
 * Endpoints:
 *   - GET  /sect/shop          → SectShopListView
 *   - POST /sect/shop/buy      → SectShopBuyResult
 *
 * Server authoritative cost / limit. FE chỉ render + dispatch buy.
 */
import { apiClient } from './client';

export interface SectShopEntryView {
  key: string;
  itemKey: string;
  itemNameI18nKey: string | null;
  contributionCost: number;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  /** Quantity user đã mua trong period hiện tại (DAILY). */
  boughtToday: number;
  /** Quantity user đã mua trong period hiện tại (WEEKLY). */
  boughtThisWeek: number;
  /** Sect level required (null = no requirement). */
  requiredSectLevel: number | null;
  stackable: boolean;
}

export interface SectShopListView {
  /** Spendable contribution balance hiện tại của user. */
  contribBalance: number;
  /** Sect level user (nếu có). */
  sectLevel: number | null;
  /** Sect ID active (null = no sect). */
  sectId: string | null;
  entries: ReadonlyArray<SectShopEntryView>;
}

export interface SectShopBuyResult {
  entryKey: string;
  itemKey: string;
  qty: number;
  totalCost: number;
  contribBalanceAfter: number;
  boughtTodayAfter: number;
  boughtThisWeekAfter: number;
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

export async function getSectShop(): Promise<SectShopListView> {
  const { data } = await apiClient.get<Envelope<SectShopListView>>('/sect/shop');
  return unwrap(data);
}

export async function buySectShopEntry(
  entryKey: string,
  qty: number,
): Promise<SectShopBuyResult> {
  const { data } = await apiClient.post<Envelope<SectShopBuyResult>>(
    '/sect/shop/buy',
    { entryKey, qty },
  );
  return unwrap(data);
}
