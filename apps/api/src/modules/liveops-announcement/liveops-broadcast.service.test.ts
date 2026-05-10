/**
 * Phase 15.3.B — LiveOpsBroadcastService unit tests.
 *
 * Cover:
 *   - broadcastAnnouncement → realtime.broadcast called với channel
 *     `liveops:announcement` + payload public-safe.
 *   - ADMIN_ONLY target → KHÔNG broadcast public.
 *   - Realtime service null/throw → no exception (fail-safe), log warn.
 *   - broadcastEvent → channel `liveops:event`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LIVEOPS_WS_CHANNEL_ANNOUNCEMENT,
  LIVEOPS_WS_CHANNEL_EVENT,
  type LiveOpsAnnouncementBroadcastPayload,
  type LiveOpsEventBroadcastPayload,
} from '@xuantoi/shared';
import { LiveOpsBroadcastService } from './liveops-broadcast.service';
import type { RealtimeService } from '../realtime/realtime.service';

function makeAnnPayload(
  over: Partial<LiveOpsAnnouncementBroadcastPayload> = {},
): LiveOpsAnnouncementBroadcastPayload {
  return {
    type: 'ANNOUNCEMENT_ACTIVE',
    key: 'ann-1',
    severity: 'INFO',
    target: 'ALL',
    title: 'T',
    message: 'M',
    titleVi: 'T',
    titleEn: null,
    messageVi: 'M',
    messageEn: null,
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function makeEventPayload(
  over: Partial<LiveOpsEventBroadcastPayload> = {},
): LiveOpsEventBroadcastPayload {
  return {
    type: 'LIVEOPS_EVENT_ACTIVE',
    eventKey: 'event-1',
    eventType: 'DOUBLE_DUNGEON_DROP',
    title: 'Title',
    description: 'Desc',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-02T00:00:00.000Z',
    runtimeSupported: true,
    ...over,
  };
}

describe('LiveOpsBroadcastService.broadcastAnnouncement', () => {
  it('emits to liveops:announcement channel với public-safe payload', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new LiveOpsBroadcastService(realtime);
    svc.broadcastAnnouncement(makeAnnPayload());
    expect(realtime.broadcast).toHaveBeenCalledTimes(1);
    expect(realtime.broadcast).toHaveBeenCalledWith(
      LIVEOPS_WS_CHANNEL_ANNOUNCEMENT,
      expect.objectContaining({ key: 'ann-1', type: 'ANNOUNCEMENT_ACTIVE' }),
    );
  });

  it('ADMIN_ONLY target — KHÔNG broadcast public', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new LiveOpsBroadcastService(realtime);
    svc.broadcastAnnouncement(makeAnnPayload({ target: 'ADMIN_ONLY' }));
    expect(realtime.broadcast).not.toHaveBeenCalled();
  });

  it('realtime null — no throw (fail-safe)', () => {
    const svc = new LiveOpsBroadcastService(null);
    expect(() => svc.broadcastAnnouncement(makeAnnPayload())).not.toThrow();
  });

  it('realtime.broadcast throws — service catch + no rethrow', () => {
    const realtime = {
      broadcast: vi.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as RealtimeService;
    const svc = new LiveOpsBroadcastService(realtime);
    expect(() => svc.broadcastAnnouncement(makeAnnPayload())).not.toThrow();
  });
});

describe('LiveOpsBroadcastService.broadcastEvent', () => {
  it('emits to liveops:event channel', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new LiveOpsBroadcastService(realtime);
    svc.broadcastEvent(makeEventPayload());
    expect(realtime.broadcast).toHaveBeenCalledTimes(1);
    expect(realtime.broadcast).toHaveBeenCalledWith(
      LIVEOPS_WS_CHANNEL_EVENT,
      expect.objectContaining({
        eventKey: 'event-1',
        type: 'LIVEOPS_EVENT_ACTIVE',
      }),
    );
  });

  it('event payload KHÔNG bao gồm configJson / createdByAdminId', () => {
    const realtime = {
      broadcast: vi.fn(),
    } as unknown as RealtimeService;
    const svc = new LiveOpsBroadcastService(realtime);
    const payload = makeEventPayload();
    svc.broadcastEvent(payload);
    const callArgs = (realtime.broadcast as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('configJson');
    expect(callArgs).not.toHaveProperty('createdByAdminId');
  });
});
