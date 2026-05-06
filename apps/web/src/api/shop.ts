import { i18n } from '@/i18n';
import { apiClient } from './client';

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface ShopEntry {
  itemKey: string;
  name: string;
  description: string;
  kind: string;
  quality: string;
  price: number;
  currency: 'LINH_THACH' | 'TIEN_NGOC';
  stackable: boolean;
  /** M10 — Daily purchase cap; null khi unlimited. */
  dailyLimit: number | null;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function listNpcShop(): Promise<ShopEntry[]> {
  const { data } = await apiClient.get<Envelope<{ entries: ShopEntry[] }>>('/shop/npc');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('shopLoad');
  return data.data.entries;
}

export interface ShopBuyResult {
  itemKey: string;
  qty: number;
  totalPrice: number;
  currency: 'LINH_THACH' | 'TIEN_NGOC';
}

export async function buyFromShop(
  itemKey: string,
  qty: number,
): Promise<ShopBuyResult> {
  const { data } = await apiClient.post<Envelope<ShopBuyResult>>('/shop/buy', {
    itemKey,
    qty,
  });
  if (!data.ok || !data.data) throw data.error ?? fallbackError('shopBuy');
  return data.data;
}
