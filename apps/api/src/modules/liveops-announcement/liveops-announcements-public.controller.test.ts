/**
 * Phase 15.4 — LiveOpsAnnouncementsPublicController unit tests
 * (cover runtime gate `LIVEOPS_ANNOUNCEMENTS_ENABLED`).
 *
 * Cover:
 *   - flag off → trả `data: []` (không gọi service)
 *   - flag on  → trả `data` từ `service.getActiveAnnouncementsPublic`
 */
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { LiveOpsAnnouncementsPublicController } from './liveops-announcements-public.controller';
import type {
  LiveOpsAnnouncementPublicView,
  LiveOpsAnnouncementService,
} from './liveops-announcement.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';
import type { FeatureFlagService } from '../feature-flag/feature-flag.service';

function makeReq(): Request {
  return { cookies: {} } as unknown as Request;
}

function makeController(opts: {
  flagDisabled?: boolean;
  active?: LiveOpsAnnouncementPublicView[];
}) {
  const service = {
    getActiveAnnouncementsPublic: vi.fn(async () => opts.active ?? []),
  } as unknown as LiveOpsAnnouncementService;
  const auth = {
    userIdFromAccess: async () => null,
  } as unknown as AuthService;
  const prisma = {
    user: { findUnique: async () => null },
  } as unknown as PrismaService;
  const featureFlags = {
    isEnabled: async () => !opts.flagDisabled,
  } as unknown as FeatureFlagService;
  return {
    c: new LiveOpsAnnouncementsPublicController(
      service,
      auth,
      prisma,
      featureFlags,
    ),
    service,
  };
}

describe('LiveOpsAnnouncementsPublicController (Phase 15.4 gate)', () => {
  it('flag off → returns empty data without calling service', async () => {
    const { c, service } = makeController({ flagDisabled: true });
    const r = await c.listActive(makeReq());
    expect(r).toEqual({ ok: true, data: [] });
    expect(service.getActiveAnnouncementsPublic).not.toHaveBeenCalled();
  });

  it('flag on → returns service result in envelope', async () => {
    const stub: LiveOpsAnnouncementPublicView[] = [
      {
        key: 'ann-1',
        severity: 'INFO',
        target: 'ALL',
        titleVi: 'T',
        titleEn: null,
        messageVi: 'M',
        messageEn: null,
        startsAt: '2026-04-29T00:00:00Z',
        endsAt: '2026-05-01T00:00:00Z',
      },
    ];
    const { c, service } = makeController({ active: stub });
    const r = await c.listActive(makeReq());
    expect(r).toEqual({ ok: true, data: stub });
    expect(service.getActiveAnnouncementsPublic).toHaveBeenCalledOnce();
  });
});
