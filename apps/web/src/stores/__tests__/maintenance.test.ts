/**
 * Phase 15.5 — useMaintenanceStore tests.
 *
 * Cover:
 *   - `refresh()` set status t\u1eeb API.
 *   - `markBlockedByApi(meta)` set blockedByApi=true v\u00e0 mirror status.
 *   - `refresh()` v\u1edbi active=false g\u1ee1 blockedByApi.
 *   - `start()/stop()` ch\u1ec9 c\u00f3 1 timer t\u1ea1i 1 th\u1eddi \u0111i\u1ec3m.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { MaintenanceWindowPublicView } from '@xuantoi/shared';

const { getStatusMock } = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
}));

vi.mock('@/api/maintenance', () => ({
  getMaintenanceStatus: getStatusMock,
}));

import { useMaintenanceStore } from '@/stores/maintenance';

const ACTIVE_VIEW: MaintenanceWindowPublicView = {
  active: true,
  severity: 'WARNING',
  target: 'ALL_PLAYERS',
  titleVi: 'Bảo trì',
  titleEn: null,
  messageVi: 'msg',
  messageEn: null,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-01T02:00:00.000Z',
  serverTime: '2026-08-01T00:30:00.000Z',
  allowAdminBypass: true,
};

const INACTIVE_VIEW: MaintenanceWindowPublicView = {
  active: false,
  severity: null,
  target: null,
  titleVi: null,
  titleEn: null,
  messageVi: null,
  messageEn: null,
  startsAt: null,
  endsAt: null,
  serverTime: '2026-08-01T03:00:00.000Z',
  allowAdminBypass: true,
};

beforeEach(() => {
  setActivePinia(createPinia());
  getStatusMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMaintenanceStore', () => {
  it('refresh() set status từ API', async () => {
    getStatusMock.mockResolvedValue(ACTIVE_VIEW);
    const store = useMaintenanceStore();
    await store.refresh();
    expect(store.active).toBe(true);
    expect(store.severity).toBe('WARNING');
  });

  it('markBlockedByApi(meta) set blockedByApi=true và mirror status', () => {
    const store = useMaintenanceStore();
    store.markBlockedByApi({
      severity: 'CRITICAL',
      target: 'ALL_PLAYERS',
      titleVi: 'Khẩn',
      titleEn: 'Urgent',
      messageVi: 'Vui lòng quay lại.',
      messageEn: 'Please come back.',
      endsAt: '2026-08-01T02:00:00.000Z',
      serverTime: '2026-08-01T00:30:00.000Z',
    });
    expect(store.blockedByApi).toBe(true);
    expect(store.active).toBe(true);
    expect(store.status?.severity).toBe('CRITICAL');
  });

  it('refresh() với active=false xóa blockedByApi', async () => {
    const store = useMaintenanceStore();
    store.markBlockedByApi({
      severity: 'WARNING',
      target: 'ALL_PLAYERS',
      titleVi: 't',
      titleEn: null,
      messageVi: 'm',
      messageEn: null,
      endsAt: '2026-08-01T02:00:00.000Z',
      serverTime: '2026-08-01T00:30:00.000Z',
    });
    expect(store.blockedByApi).toBe(true);
    getStatusMock.mockResolvedValue(INACTIVE_VIEW);
    await store.refresh();
    expect(store.blockedByApi).toBe(false);
    expect(store.active).toBe(false);
  });

  it('start() / stop() chỉ tạo 1 timer', () => {
    vi.useFakeTimers();
    getStatusMock.mockResolvedValue(INACTIVE_VIEW);
    const store = useMaintenanceStore();
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    store.start();
    store.start(); // không tạo thêm
    expect(setSpy).toHaveBeenCalledTimes(1);
    store.stop();
    setSpy.mockRestore();
  });
});
