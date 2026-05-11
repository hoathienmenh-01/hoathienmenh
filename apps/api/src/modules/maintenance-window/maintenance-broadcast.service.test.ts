/**
 * Phase 15.8 — MaintenanceBroadcastService unit tests.
 *
 * Cover:
 *   - `broadcast()` → realtime.broadcast called với channel
 *     `maintenance:status` + payload public-safe.
 *   - Realtime null → no throw (fail-safe).
 *   - Realtime throws → service catch + KHÔNG rethrow (DB transition
 *     không bị rollback).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAINTENANCE_WS_CHANNEL,
  type MaintenanceBroadcastPayload,
} from '@xuantoi/shared';
import { MaintenanceBroadcastService } from './maintenance-broadcast.service';
import type { RealtimeService } from '../realtime/realtime.service';

function makePayload(
  over: Partial<MaintenanceBroadcastPayload> = {},
): MaintenanceBroadcastPayload {
  return {
    type: 'MAINTENANCE_ACTIVE',
    key: 'mw-1',
    status: 'ACTIVE',
    severity: 'WARNING',
    target: 'ALL_PLAYERS',
    titleVi: 'Bảo trì',
    titleEn: 'Maintenance',
    messageVi: 'msg-vi',
    messageEn: 'msg-en',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-01T02:00:00.000Z',
    serverTime: '2026-08-01T00:30:00.000Z',
    allowAdminBypass: true,
    ...over,
  };
}

describe('MaintenanceBroadcastService.broadcast', () => {
  it('emits to maintenance:status channel với public-safe payload', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new MaintenanceBroadcastService(realtime);

    svc.broadcast(makePayload());

    expect(realtime.broadcast).toHaveBeenCalledTimes(1);
    expect(realtime.broadcast).toHaveBeenCalledWith(
      MAINTENANCE_WS_CHANNEL,
      expect.objectContaining({
        key: 'mw-1',
        type: 'MAINTENANCE_ACTIVE',
        status: 'ACTIVE',
      }),
    );
  });

  it('realtime null — KHÔNG throw (fail-safe)', () => {
    const svc = new MaintenanceBroadcastService(null);
    expect(() => svc.broadcast(makePayload())).not.toThrow();
  });

  it('realtime.broadcast throws — service catch + KHÔNG rethrow', () => {
    const realtime = {
      broadcast: vi.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as RealtimeService;
    const svc = new MaintenanceBroadcastService(realtime);
    expect(() => svc.broadcast(makePayload())).not.toThrow();
  });

  it('broadcasts DISABLED type với payload nguyên vẹn', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new MaintenanceBroadcastService(realtime);
    svc.broadcast(
      makePayload({ type: 'MAINTENANCE_DISABLED', status: 'DISABLED' }),
    );
    expect(realtime.broadcast).toHaveBeenCalledWith(
      MAINTENANCE_WS_CHANNEL,
      expect.objectContaining({
        type: 'MAINTENANCE_DISABLED',
        status: 'DISABLED',
      }),
    );
  });
});
