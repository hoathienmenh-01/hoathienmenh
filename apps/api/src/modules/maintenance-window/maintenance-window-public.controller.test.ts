/**
 * Phase 15.5 — MaintenanceWindowPublicController unit tests.
 *
 * Cover:
 *   - GET /maintenance/status proxies to service.publicStatus()
 *   - shape `{ ok: true, data: MaintenanceWindowPublicView }`
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  MaintenanceSeverity,
  MaintenanceTarget,
  MaintenanceWindowPublicView,
} from '@xuantoi/shared';
import { MaintenanceWindowPublicController } from './maintenance-window-public.controller';
import type { MaintenanceWindowService } from './maintenance-window.service';

describe('MaintenanceWindowPublicController.status', () => {
  it('returns service result inside ok envelope', async () => {
    const view: MaintenanceWindowPublicView = {
      active: true,
      severity: 'WARNING' as MaintenanceSeverity,
      target: 'ALL_PLAYERS' as MaintenanceTarget,
      titleVi: 'Bảo trì',
      titleEn: 'Maintenance',
      messageVi: 'Hệ thống đang bảo trì.',
      messageEn: 'System under maintenance.',
      startsAt: '2026-08-01T01:00:00.000Z',
      endsAt: '2026-08-01T02:00:00.000Z',
      serverTime: '2026-08-01T01:30:00.000Z',
      allowAdminBypass: true,
    };
    const svc = {
      publicStatus: vi.fn(async () => view),
    } as unknown as MaintenanceWindowService;
    const c = new MaintenanceWindowPublicController(svc);
    const r = await c.status();
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(view);
  });

  it('inactive state → active=false', async () => {
    const view: MaintenanceWindowPublicView = {
      active: false,
      severity: null,
      target: null,
      titleVi: null,
      titleEn: null,
      messageVi: null,
      messageEn: null,
      startsAt: null,
      endsAt: null,
      serverTime: '2026-08-01T01:00:00.000Z',
      allowAdminBypass: true,
    };
    const svc = {
      publicStatus: vi.fn(async () => view),
    } as unknown as MaintenanceWindowService;
    const c = new MaintenanceWindowPublicController(svc);
    const r = await c.status();
    expect(r.data.active).toBe(false);
  });
});
