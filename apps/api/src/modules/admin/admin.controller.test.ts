/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/admin/admin.controller.ts`.
 *
 * Đây là controller LỚN NHẤT trong codebase (562 lines, 19 endpoint), bọc bởi
 * class-level `@UseGuards(AdminGuard)` và method-level `@RequireAdmin()` cho
 * action ảnh hưởng tài sản. Test bypass guard bằng cách instantiate trực tiếp
 * (vì test pure-unit) — guard logic test riêng ở `admin.guard.test.ts`.
 *
 * Endpoint coverage:
 *  - **Read**: GET users + users.csv + topups + audit + stats + economy/{alerts,audit-ledger,report} + giftcodes
 *  - **Write user**: POST users/:id/{ban, role, grant, inventory/revoke}
 *  - **Write topup**: POST topups/:id/{approve, reject}
 *  - **Write giftcode**: POST giftcodes + giftcodes/:code/revoke
 *  - **Write mail**: POST mail/{send, broadcast}
 *
 * Filter parsing patterns to lock in:
 *  1. `page`: `Math.max(0, parseInt(...) || 0)` — clamp ≥ 0, NaN/missing → 0.
 *  2. `role` enum: PLAYER/MOD/ADMIN only; case-sensitive — invalid → undefined.
 *  3. `banned` 'true'/'false' string match — anything else → undefined.
 *  4. `linhThachMin/Max` BigInt parse, ≥ 0 only — invalid → undefined (no 400).
 *  5. `tienNgocMin/Max` parseInt ≥ 0 — invalid/negative → undefined.
 *  6. `realmKey` regex `^[a-z0-9_-]{1,32}$` — uppercase/long → undefined.
 *  7. `from/to` Date.parse — NaN → drop filter.
 *  8. `email` length 1..120 — empty/long → drop.
 *  9. `actionPrefix` length 1..64 — empty/long → drop.
 *  10. `limit` 1..500 clamp.
 *  11. `q` trim + slice 64 — empty after trim → drop.
 *  12. `staleHours` clamped to bounds.
 *
 * Error mapping (3 error classes, instanceof + switch):
 *  - **AdminError**: NOT_FOUND→404, FORBIDDEN→403, ALREADY_PROCESSED→409, others (INVALID_INPUT/CANNOT_TARGET_SELF)→400
 *  - **GiftCodeError**: CODE_NOT_FOUND/NO_CHARACTER→404, ALREADY_REDEEMED/CODE_EXPIRED/CODE_REVOKED/CODE_EXHAUSTED/CODE_EXISTS→409, others (INVALID_INPUT)→400
 *  - **MailError**: RECIPIENT_NOT_FOUND/MAIL_NOT_FOUND→404, ALREADY_CLAIMED/MAIL_EXPIRED/NO_REWARD→409, others (NO_CHARACTER/INVALID_INPUT)→400
 *  - default: rethrow nguyên (giữ stack trace cho 500).
 *
 * Critical lock-in invariants:
 *  - `users.csv` reuse cùng filter logic với `users` (single source of truth).
 *  - `users.csv` set headers: Content-Type, Content-Disposition (UTC timestamp), X-Export-Total, X-Export-Rows; X-Export-Truncated chỉ khi truncated=true.
 *  - `grant.linhThach` signed BigInt — ÂM được phép (admin trừ tiền). qty/tienNgoc default 0.
 *  - `revokeInventory.qty` chặn ở 1..999 (chống admin gõ nhầm 999999).
 *  - `giftCreate.code` regex `[A-Za-z0-9_-]+` length 4..32, BigInt convert reward.
 *  - `mailSend.recipientCharacterId` REQUIRED (vs broadcast no recipient).
 *  - `req.userId` + `req.role` được attach bởi guard (test mock req object trực tiếp).
 *  - `economyAlertsBounds` tính trong constructor 1 lần (resolve env), trả trong response.
 *  - Endpoint read-only (users/topups/audit/stats/economy alerts/audit-ledger/report/giftcodes-list) đều không cần @RequireAdmin — MOD đọc được.
 *  - Endpoint **write** quan trọng (role/grant/inventory/topup approve-reject/giftcode create-revoke/mail send-broadcast) đều yêu cầu `@RequireAdmin` — chỉ ADMIN, MOD bị reject.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { Role } from '@prisma/client';
import { AdminController } from './admin.controller';
import { AdminError, type AdminService } from './admin.service';
import { GiftCodeError, type GiftCodeService } from '../giftcode/giftcode.service';
import { MailError, type MailService } from '../mail/mail.service';

type AdminReq = Request & { userId: string; role: Role };

function makeReq(opts: { userId?: string; role?: Role } = {}): AdminReq {
  return {
    userId: opts.userId ?? 'admin1',
    role: opts.role ?? ('ADMIN' as Role),
    cookies: {},
  } as unknown as AdminReq;
}

interface HeaderMap {
  [k: string]: string;
}

function makeRes(): { res: Response; headers: HeaderMap } {
  const headers: HeaderMap = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response;
  return { res, headers };
}

interface ServiceStubs {
  listUsers?: AdminService['listUsers'];
  exportUsers?: AdminService['exportUsers'];
  setBanned?: AdminService['setBanned'];
  setRole?: AdminService['setRole'];
  grant?: AdminService['grant'];
  revokeInventory?: AdminService['revokeInventory'];
  listTopups?: AdminService['listTopups'];
  approveTopup?: AdminService['approveTopup'];
  rejectTopup?: AdminService['rejectTopup'];
  listAudit?: AdminService['listAudit'];
  stats?: AdminService['stats'];
  getEconomyAlerts?: AdminService['getEconomyAlerts'];
  runLedgerAudit?: AdminService['runLedgerAudit'];
  getEconomyReport?: AdminService['getEconomyReport'];
  giftList?: GiftCodeService['list'];
  giftCreate?: GiftCodeService['create'];
  giftRevoke?: GiftCodeService['revoke'];
  mailSend?: MailService['sendToCharacter'];
  mailBroadcast?: MailService['broadcast'];
  configGet?: (key: string) => string | undefined;
  /**
   * Phase 13.1.C — stub `AdminLiveOpsService.snapshotSectWarStatus(actorId,
   * weekKey, reason?)` cho test endpoint POST /admin/sect-war/snapshot.
   * Default stub trả empty week — override khi test cần assert call args.
   */
  liveOpsSnapshot?: (
    actorUserId: string,
    weekKey: string,
    reason?: string,
  ) => Promise<{
    weekKey: string;
    totalSects: number;
    totalContributors: number;
    totalContributions: number;
    topSects: ReadonlyArray<{
      sectId: string;
      sectName: string | null;
      points: number;
      contributors: number;
    }>;
  }>;
  /**
   * Phase 14.1.C — stub `ArenaSeasonService.settleSeason(seasonKey?)` cho
   * test endpoint POST /admin/arena/season/settle. Default stub trả
   * summary rỗng.
   */
  arenaSeasonSettle?: (seasonKey?: string) => Promise<{
    seasonKey: string;
    settledAtIso: string;
    participants: number;
    grants: number;
    newGrants: number;
  }>;
  /**
   * Phase 14.1.C — stub `ArenaSeasonService.createNextSeason()` cho test
   * endpoint POST /admin/arena/season/create-next.
   */
  arenaSeasonCreateNext?: () => Promise<{
    seasonKey: string;
    status: 'ACTIVE' | 'SETTLED' | 'ARCHIVED';
    startsAtIso: string;
    endsAtIso: string;
    settledAtIso: string | null;
    cadence: 'weekly';
    timezone: string;
  }>;
}

function makeController(stubs: ServiceStubs = {}): AdminController {
  const adminSvc = {
    listUsers: stubs.listUsers ?? (async () => ({ rows: [], total: 0, page: 0 } as never)),
    exportUsers:
      stubs.exportUsers ??
      (async () => ({ rows: [], total: 0, truncated: false } as never)),
    setBanned: stubs.setBanned ?? (async () => undefined),
    setRole: stubs.setRole ?? (async () => undefined),
    grant: stubs.grant ?? (async () => undefined),
    revokeInventory: stubs.revokeInventory ?? (async () => undefined),
    listTopups: stubs.listTopups ?? (async () => ({ rows: [], total: 0, page: 0 } as never)),
    approveTopup: stubs.approveTopup ?? (async () => undefined),
    rejectTopup: stubs.rejectTopup ?? (async () => undefined),
    listAudit: stubs.listAudit ?? (async () => ({ rows: [], total: 0, page: 0 } as never)),
    stats: stubs.stats ?? (async () => ({} as never)),
    getEconomyAlerts: stubs.getEconomyAlerts ?? (async () => ({} as never)),
    runLedgerAudit: stubs.runLedgerAudit ?? (async () => ({} as never)),
    getEconomyReport: stubs.getEconomyReport ?? (async () => ({} as never)),
  } as unknown as AdminService;
  const giftSvc = {
    list: stubs.giftList ?? (async () => []),
    create: stubs.giftCreate ?? (async () => ({} as never)),
    revoke: stubs.giftRevoke ?? (async () => ({} as never)),
  } as unknown as GiftCodeService;
  const mailSvc = {
    sendToCharacter: stubs.mailSend ?? (async () => ({} as never)),
    broadcast: stubs.mailBroadcast ?? (async () => 0),
  } as unknown as MailService;
  const config = {
    get: stubs.configGet ?? (() => undefined),
  } as unknown as ConfigService;
  // Phase 13.1.B + 13.1.C — AdminLiveOpsService stub.
  const liveOpsSvc = {
    getStatus: async () => ({ tz: 'Asia/Bangkok', events: [], todayKeys: [], activeKeys: [] }),
    toggleEvent: async () => ({} as never),
    getSectWarStatus: async () => ({
      weekKey: '',
      totalSects: 0,
      totalContributors: 0,
      totalContributions: 0,
      topSects: [],
    }),
    recalculateSectWar: async () => ({ noop: true as const, weekKey: '' }),
    // Phase 13.1.C — snapshot read-after-audit. Default stub mirrors a
    // snapshot of empty week; tests that need to assert call args replace
    // this with a custom stub.
    snapshotSectWarStatus: stubs.liveOpsSnapshot ??
      (async () => ({
        weekKey: '',
        totalSects: 0,
        totalContributors: 0,
        totalContributions: 0,
        topSects: [],
      })),
  } as unknown as import('./admin-liveops.service').AdminLiveOpsService;
  // Phase 14.1.C — minimal ArenaSeasonService stub. Tests cụ thể cho
  // arena season settle dùng setup riêng (xem arena-season.controller.test).
  const arenaSeasonSvc = {
    settleSeason: stubs.arenaSeasonSettle ??
      (async () => ({
        seasonKey: 'arena_2026-W19',
        settledAtIso: new Date().toISOString(),
        participants: 0,
        grants: 0,
        newGrants: 0,
      })),
    createNextSeason: stubs.arenaSeasonCreateNext ??
      (async () => ({
        seasonKey: 'arena_2026-W20',
        status: 'ACTIVE' as const,
        startsAtIso: new Date().toISOString(),
        endsAtIso: new Date().toISOString(),
        settledAtIso: null,
        cadence: 'weekly' as const,
        timezone: 'Asia/Ho_Chi_Minh',
      })),
  } as unknown as import('../arena/arena-season.service').ArenaSeasonService;
  return new AdminController(adminSvc, giftSvc, mailSvc, config, liveOpsSvc, arenaSeasonSvc);
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
    throw new Error('expected throw');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ ok: false, error: { code } });
  }
}

describe('AdminController', () => {
  describe('GET /admin/users — filter parsing', () => {
    it('200 + truyền filters parsed', async () => {
      const calls: Array<[string | undefined, number, Record<string, unknown>]> = [];
      const c = makeController({
        listUsers: (async (q, page, filters) => {
          calls.push([q, page, filters as Record<string, unknown>]);
          return { rows: [], total: 0, page } as never;
        }) as AdminService['listUsers'],
      });
      const r = await c.users(
        'qry',
        '2',
        'PLAYER',
        'true',
        '100',
        '999',
        '5',
        '50',
        'phong-van',
      );
      expect(r.ok).toBe(true);
      expect(calls.length).toBe(1);
      const [q, page, f] = calls[0]!;
      expect(q).toBe('qry');
      expect(page).toBe(2);
      expect(f.role).toBe('PLAYER');
      expect(f.banned).toBe(true);
      expect(f.linhThachMin).toBe(100n);
      expect(f.linhThachMax).toBe(999n);
      expect(f.tienNgocMin).toBe(5);
      expect(f.tienNgocMax).toBe(50);
      expect(f.realmKey).toBe('phong-van');
    });
    it('page default 0 khi không truyền', async () => {
      const calls: Array<[string | undefined, number]> = [];
      const c = makeController({
        listUsers: (async (q, p) => {
          calls.push([q, p]);
          return { rows: [], total: 0, page: p } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      );
      expect(calls[0]?.[1]).toBe(0);
    });
    it('page negative clamp về 0', async () => {
      const calls: Array<number> = [];
      const c = makeController({
        listUsers: (async (_q, p) => {
          calls.push(p);
          return { rows: [], total: 0, page: p } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(
        undefined, '-5', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      );
      expect(calls[0]).toBe(0);
    });
    it('page non-numeric → 0', async () => {
      const calls: Array<number> = [];
      const c = makeController({
        listUsers: (async (_q, p) => {
          calls.push(p);
          return { rows: [], total: 0, page: p } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(
        undefined, 'abc', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      );
      expect(calls[0]).toBe(0);
    });
    it('role invalid → undefined (silent drop)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', 'GUEST', undefined, undefined, undefined, undefined, undefined, undefined);
      expect(calls[0]?.role).toBeUndefined();
    });
    it('role lowercase → undefined (case-sensitive)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', 'player', undefined, undefined, undefined, undefined, undefined, undefined);
      expect(calls[0]?.role).toBeUndefined();
    });
    it('banned "false" → false (KHÔNG undefined)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, 'false', undefined, undefined, undefined, undefined, undefined);
      expect(calls[0]?.banned).toBe(false);
    });
    it('banned "yes" → undefined (drop)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, 'yes', undefined, undefined, undefined, undefined, undefined);
      expect(calls[0]?.banned).toBeUndefined();
    });
    it('linhThachMin negative → undefined', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, undefined, '-100', undefined, undefined, undefined, undefined);
      expect(calls[0]?.linhThachMin).toBeUndefined();
    });
    it('linhThachMin invalid string → undefined (no 400)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, undefined, 'abc', undefined, undefined, undefined, undefined);
      expect(calls[0]?.linhThachMin).toBeUndefined();
    });
    it('tienNgocMin negative → undefined', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, undefined, undefined, undefined, '-5', undefined, undefined);
      expect(calls[0]?.tienNgocMin).toBeUndefined();
    });
    it('realmKey uppercase → undefined (regex case-sensitive)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, undefined, undefined, undefined, undefined, undefined, 'PHONG-VAN');
      expect(calls[0]?.realmKey).toBeUndefined();
    });
    it('realmKey > 32 ký tự → undefined', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const c = makeController({
        listUsers: (async (_q, _p, f) => {
          calls.push(f as Record<string, unknown>);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listUsers'],
      });
      await c.users(undefined, '0', undefined, undefined, undefined, undefined, undefined, undefined, 'a'.repeat(33));
      expect(calls[0]?.realmKey).toBeUndefined();
    });
  });

  describe('GET /admin/users.csv — CSV export with headers', () => {
    it('200 trả CSV string + đầy đủ headers (KHÔNG truncated)', async () => {
      const { res, headers } = makeRes();
      const c = makeController({
        exportUsers: (async () => ({
          rows: [],
          total: 5,
          truncated: false,
        } as never)) as AdminService['exportUsers'],
      });
      const csv = await c.usersCsv(
        makeReq(), res,
        'qry', 'ADMIN', 'true', '100', '999', '0', '50', 'phong-van',
      );
      expect(typeof csv).toBe('string');
      expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(headers['Content-Disposition']).toMatch(
        /^attachment; filename="xuantoi-users-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z\.csv"$/,
      );
      expect(headers['X-Export-Total']).toBe('5');
      expect(headers['X-Export-Rows']).toBe('0');
      expect(headers['X-Export-Truncated']).toBeUndefined();
    });
    it('X-Export-Truncated="true" chỉ set khi truncated=true', async () => {
      const { res, headers } = makeRes();
      const c = makeController({
        exportUsers: (async () => ({
          rows: [],
          total: 9999,
          truncated: true,
        } as never)) as AdminService['exportUsers'],
      });
      await c.usersCsv(
        makeReq(), res,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      );
      expect(headers['X-Export-Truncated']).toBe('true');
    });
    it('truyền (req.userId, q, filters) — userId từ AdminGuard', async () => {
      const { res } = makeRes();
      const calls: Array<[string, string | undefined, Record<string, unknown>]> = [];
      const c = makeController({
        exportUsers: (async (uid, q, f) => {
          calls.push([uid, q, f as Record<string, unknown>]);
          return { rows: [], total: 0, truncated: false } as never;
        }) as AdminService['exportUsers'],
      });
      await c.usersCsv(
        makeReq({ userId: 'admin42' }), res,
        'searchQ', 'MOD', 'false', '50', undefined, undefined, undefined, 'phong',
      );
      expect(calls.length).toBe(1);
      expect(calls[0]?.[0]).toBe('admin42');
      expect(calls[0]?.[1]).toBe('searchQ');
      expect(calls[0]?.[2].role).toBe('MOD');
      expect(calls[0]?.[2].banned).toBe(false);
      expect(calls[0]?.[2].linhThachMin).toBe(50n);
      expect(calls[0]?.[2].realmKey).toBe('phong');
    });
  });

  describe('POST /admin/users/:id/ban — BanInput zod', () => {
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.ban(makeReq(), 'u1', null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi banned không phải boolean', async () => {
      const c = makeController();
      await expectHttpError(
        c.ban(makeReq(), 'u1', { banned: 'true' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; truyền (userId, role, id, banned)', async () => {
      const calls: Array<[string, Role, string, boolean]> = [];
      const c = makeController({
        setBanned: (async (uid, r, id, b) => {
          calls.push([uid, r, id, b]);
        }) as AdminService['setBanned'],
      });
      const r = await c.ban(
        makeReq({ userId: 'a1', role: 'ADMIN' as Role }),
        'target',
        { banned: true },
      );
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual([['a1', 'ADMIN', 'target', true]]);
    });
    it('200 with banned=false (unban)', async () => {
      const calls: Array<boolean> = [];
      const c = makeController({
        setBanned: (async (_u, _r, _id, b) => {
          calls.push(b);
        }) as AdminService['setBanned'],
      });
      await c.ban(makeReq(), 'u1', { banned: false });
      expect(calls).toEqual([false]);
    });
  });

  describe('POST /admin/users/:id/role — RoleInput zod', () => {
    it('400 INVALID_INPUT khi body null', async () => {
      const c = makeController();
      await expectHttpError(
        c.role(makeReq(), 'u1', null),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi role không hợp lệ', async () => {
      const c = makeController();
      await expectHttpError(
        c.role(makeReq(), 'u1', { role: 'GUEST' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi role lowercase', async () => {
      const c = makeController();
      await expectHttpError(
        c.role(makeReq(), 'u1', { role: 'admin' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    for (const role of ['PLAYER', 'MOD', 'ADMIN'] as const) {
      it(`200; accept role=${role}`, async () => {
        const calls: Array<Role> = [];
        const c = makeController({
          setRole: (async (_u, _r, _id, newR) => {
            calls.push(newR);
          }) as AdminService['setRole'],
        });
        await c.role(makeReq(), 'u1', { role });
        expect(calls).toEqual([role]);
      });
    }
  });

  describe('POST /admin/users/:id/grant — GrantInput zod (signed BigInt)', () => {
    it('400 khi linhThach chứa ký tự lạ', async () => {
      const c = makeController();
      await expectHttpError(
        c.grant(makeReq(), 'u1', { linhThach: 'abc', tienNgoc: 0 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi reason > 200 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.grant(makeReq(), 'u1', {
          linhThach: '100',
          tienNgoc: 0,
          reason: 'x'.repeat(201),
        }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi tienNgoc không nguyên', async () => {
      const c = makeController();
      await expectHttpError(
        c.grant(makeReq(), 'u1', { linhThach: '0', tienNgoc: 1.5 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; linhThach âm được phép (admin trừ tiền)', async () => {
      const calls: Array<[string, Role, string, bigint, number, string]> = [];
      const c = makeController({
        grant: (async (uid, role, id, lt, tn, reason) => {
          calls.push([uid, role, id, lt, tn, reason]);
        }) as AdminService['grant'],
      });
      const r = await c.grant(
        makeReq({ userId: 'a1', role: 'ADMIN' as Role }),
        'target',
        { linhThach: '-500', tienNgoc: -10, reason: 'Hoàn tiền' },
      );
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual([
        ['a1', 'ADMIN', 'target', -500n, -10, 'Hoàn tiền'],
      ]);
    });
    it('200; default linhThach="0" + tienNgoc=0 + reason=""', async () => {
      const calls: Array<[bigint, number, string]> = [];
      const c = makeController({
        grant: (async (_u, _r, _id, lt, tn, reason) => {
          calls.push([lt, tn, reason]);
        }) as AdminService['grant'],
      });
      await c.grant(makeReq(), 'u1', {});
      expect(calls).toEqual([[0n, 0, '']]);
    });
    it('200; linhThach BigInt very large', async () => {
      const calls: Array<bigint> = [];
      const c = makeController({
        grant: (async (_u, _r, _id, lt) => {
          calls.push(lt);
        }) as AdminService['grant'],
      });
      await c.grant(makeReq(), 'u1', {
        linhThach: '999999999999999999',
        tienNgoc: 0,
      });
      expect(calls[0]).toBe(999999999999999999n);
    });
  });

  describe('POST /admin/users/:id/inventory/revoke — qty bounds', () => {
    it('400 khi qty=0 (positive)', async () => {
      const c = makeController();
      await expectHttpError(
        c.revokeInventory(makeReq(), 'u1', { itemKey: 'sword', qty: 0 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi qty > 999 (chống admin gõ nhầm)', async () => {
      const c = makeController();
      await expectHttpError(
        c.revokeInventory(makeReq(), 'u1', { itemKey: 'sword', qty: 1000 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi qty âm', async () => {
      const c = makeController();
      await expectHttpError(
        c.revokeInventory(makeReq(), 'u1', { itemKey: 'sword', qty: -1 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi itemKey rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.revokeInventory(makeReq(), 'u1', { itemKey: '', qty: 1 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi itemKey > 80 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.revokeInventory(makeReq(), 'u1', { itemKey: 'a'.repeat(81), qty: 1 }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; truyền (userId, role, id, itemKey, qty, reason)', async () => {
      const calls: Array<[string, Role, string, string, number, string]> = [];
      const c = makeController({
        revokeInventory: (async (uid, role, id, ik, q, reason) => {
          calls.push([uid, role, id, ik, q, reason]);
        }) as AdminService['revokeInventory'],
      });
      const r = await c.revokeInventory(
        makeReq({ userId: 'a1', role: 'ADMIN' as Role }),
        'target',
        { itemKey: 'sword', qty: 5, reason: 'Bug item' },
      );
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual([
        ['a1', 'ADMIN', 'target', 'sword', 5, 'Bug item'],
      ]);
    });
    it('200; qty=999 boundary accept', async () => {
      const calls: Array<number> = [];
      const c = makeController({
        revokeInventory: (async (_u, _r, _id, _ik, q) => {
          calls.push(q);
        }) as AdminService['revokeInventory'],
      });
      await c.revokeInventory(makeReq(), 'u1', { itemKey: 's', qty: 999 });
      expect(calls).toEqual([999]);
    });
  });

  describe('GET /admin/topups — filter parsing', () => {
    it('status enum strict; "PENDING"/"APPROVED"/"REJECTED" only', async () => {
      const calls: Array<string | null> = [];
      const c = makeController({
        listTopups: (async (st) => {
          calls.push(st);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listTopups'],
      });
      await c.topups('PENDING', '0', undefined, undefined, undefined);
      await c.topups('APPROVED', '0', undefined, undefined, undefined);
      await c.topups('REJECTED', '0', undefined, undefined, undefined);
      await c.topups('OTHER', '0', undefined, undefined, undefined);
      await c.topups('pending', '0', undefined, undefined, undefined);
      expect(calls).toEqual(['PENDING', 'APPROVED', 'REJECTED', null, null]);
    });
    it('from/to Date parse — invalid date drop', async () => {
      const calls: Array<{ fromDate?: Date; toDate?: Date; userEmail?: string }> = [];
      const c = makeController({
        listTopups: (async (_st, _p, f) => {
          calls.push(f as never);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listTopups'],
      });
      await c.topups(undefined, '0', '2024-01-01', '2024-12-31', undefined);
      expect(calls[0]?.fromDate).toBeInstanceOf(Date);
      expect(calls[0]?.toDate).toBeInstanceOf(Date);
    });
    it('from invalid → drop', async () => {
      const calls: Array<{ fromDate?: Date }> = [];
      const c = makeController({
        listTopups: (async (_st, _p, f) => {
          calls.push(f as never);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listTopups'],
      });
      await c.topups(undefined, '0', 'not-a-date', undefined, undefined);
      expect(calls[0]?.fromDate).toBeUndefined();
    });
    it('email length 1..120; > 120 drop; empty drop', async () => {
      const calls: Array<{ userEmail?: string }> = [];
      const c = makeController({
        listTopups: (async (_st, _p, f) => {
          calls.push(f as never);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listTopups'],
      });
      await c.topups(undefined, '0', undefined, undefined, '');
      await c.topups(undefined, '0', undefined, undefined, 'a'.repeat(121));
      await c.topups(undefined, '0', undefined, undefined, 'admin@x.com');
      expect(calls[0]?.userEmail).toBeUndefined();
      expect(calls[1]?.userEmail).toBeUndefined();
      expect(calls[2]?.userEmail).toBe('admin@x.com');
    });
  });

  describe('POST /admin/topups/:id/{approve,reject} — TopupActionInput', () => {
    it('approve 400 INVALID_INPUT khi note > 200', async () => {
      const c = makeController();
      await expectHttpError(
        c.approveTopup(makeReq(), 't1', { note: 'x'.repeat(201) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('approve 200; default note=""; truyền (userId, id, note)', async () => {
      const calls: Array<[string, string, string]> = [];
      const c = makeController({
        approveTopup: (async (uid, id, note) => {
          calls.push([uid, id, note]);
        }) as AdminService['approveTopup'],
      });
      const r = await c.approveTopup(
        makeReq({ userId: 'a1' }), 't1', {},
      );
      expect(r).toEqual({ ok: true, data: { ok: true } });
      expect(calls).toEqual([['a1', 't1', '']]);
    });
    it('reject 200; truyền (userId, id, note)', async () => {
      const calls: Array<[string, string, string]> = [];
      const c = makeController({
        rejectTopup: (async (uid, id, note) => {
          calls.push([uid, id, note]);
        }) as AdminService['rejectTopup'],
      });
      await c.rejectTopup(
        makeReq({ userId: 'a1' }), 't1', { note: 'invalid receipt' },
      );
      expect(calls).toEqual([['a1', 't1', 'invalid receipt']]);
    });
  });

  describe('GET /admin/audit — filter parsing', () => {
    it('action 1..64 length; >64 drop', async () => {
      const calls: Array<{ actionPrefix?: string; actorEmail?: string }> = [];
      const c = makeController({
        listAudit: (async (_p, f) => {
          calls.push(f as never);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listAudit'],
      });
      await c.audit('0', 'a'.repeat(65), undefined);
      await c.audit('0', 'user.', undefined);
      await c.audit('0', '', undefined);
      expect(calls[0]?.actionPrefix).toBeUndefined();
      expect(calls[1]?.actionPrefix).toBe('user.');
      expect(calls[2]?.actionPrefix).toBeUndefined();
    });
    it('email 1..120 length; >120 drop', async () => {
      const calls: Array<{ actorEmail?: string }> = [];
      const c = makeController({
        listAudit: (async (_p, f) => {
          calls.push(f as never);
          return { rows: [], total: 0, page: 0 } as never;
        }) as AdminService['listAudit'],
      });
      await c.audit('0', undefined, 'a'.repeat(121));
      await c.audit('0', undefined, 'admin@x.com');
      expect(calls[0]?.actorEmail).toBeUndefined();
      expect(calls[1]?.actorEmail).toBe('admin@x.com');
    });
  });

  describe('GET /admin/stats + economy/{audit-ledger,report}', () => {
    it('stats 200 envelope', async () => {
      const c = makeController({
        stats: (async () => ({ users: 5 } as never)) as AdminService['stats'],
      });
      const r = await c.stats();
      expect(r).toEqual({ ok: true, data: { users: 5 } });
    });
    it('economy/audit-ledger 200 envelope', async () => {
      const c = makeController({
        runLedgerAudit: (async () => ({ disc: 0 } as never)) as AdminService['runLedgerAudit'],
      });
      const r = await c.economyAuditLedger();
      expect(r).toEqual({ ok: true, data: { disc: 0 } });
    });
    it('economy/report 200 envelope', async () => {
      const c = makeController({
        getEconomyReport: (async () => ({ topWhales: [] } as never)) as AdminService['getEconomyReport'],
      });
      const r = await c.economyReport();
      expect(r).toEqual({ ok: true, data: { topWhales: [] } });
    });
  });

  describe('GET /admin/economy/alerts — staleHours clamp + bounds', () => {
    it('200 + bounds default; truyền hrs vào service', async () => {
      const calls: Array<number | undefined> = [];
      const c = makeController({
        getEconomyAlerts: (async (h) => {
          calls.push(h);
          return { alerts: [] } as never;
        }) as AdminService['getEconomyAlerts'],
      });
      const r = await c.economyAlerts(undefined);
      expect(r.ok).toBe(true);
      expect(r.data).toMatchObject({
        bounds: { defaultHours: 24, minHours: 1, maxHours: 720 },
      });
      expect(calls[0]).toBe(24);
    });
    it('staleHours clamp tới min', async () => {
      const calls: Array<number | undefined> = [];
      const c = makeController({
        getEconomyAlerts: (async (h) => {
          calls.push(h);
          return { alerts: [] } as never;
        }) as AdminService['getEconomyAlerts'],
      });
      await c.economyAlerts('0');
      expect(calls[0]).toBe(1);
    });
    it('staleHours clamp tới max', async () => {
      const calls: Array<number | undefined> = [];
      const c = makeController({
        getEconomyAlerts: (async (h) => {
          calls.push(h);
          return { alerts: [] } as never;
        }) as AdminService['getEconomyAlerts'],
      });
      await c.economyAlerts('999999');
      expect(calls[0]).toBe(720);
    });
    it('config env override defaultHours', async () => {
      const calls: Array<number | undefined> = [];
      const c = makeController({
        configGet: (key: string) =>
          key === 'ECONOMY_ALERTS_DEFAULT_STALE_HOURS' ? '48' : undefined,
        getEconomyAlerts: (async (h) => {
          calls.push(h);
          return { alerts: [] } as never;
        }) as AdminService['getEconomyAlerts'],
      });
      const r = await c.economyAlerts(undefined);
      expect(r.data).toMatchObject({ bounds: { defaultHours: 48 } });
      expect(calls[0]).toBe(48);
    });
  });

  describe('GET /admin/giftcodes — filter parsing', () => {
    it('limit clamp 1..500; default 100', async () => {
      const calls: Array<[number | undefined, unknown]> = [];
      const c = makeController({
        giftList: (async (l, f) => {
          calls.push([l, f]);
          return [];
        }) as GiftCodeService['list'],
      });
      await c.giftList(undefined, undefined, undefined);
      // Note: '0' parses to 0 which is falsy → fallback default 100 (NOT clamped to 1).
      // This is a quirk of `parseInt('0', 10) || 100` operator precedence;
      // documented as expected behavior.
      await c.giftList('0', undefined, undefined);
      await c.giftList('-5', undefined, undefined);
      await c.giftList('501', undefined, undefined);
      await c.giftList('250', undefined, undefined);
      expect(calls.map((c) => c[0])).toEqual([100, 100, 1, 500, 250]);
    });
    it('q trim + slice 64; empty after trim drop', async () => {
      const calls: Array<{ q?: string }> = [];
      const c = makeController({
        giftList: (async (_l, f) => {
          calls.push(f as never);
          return [];
        }) as GiftCodeService['list'],
      });
      await c.giftList(undefined, '   ', undefined);
      await c.giftList(undefined, 'q'.repeat(70), undefined);
      await c.giftList(undefined, '  hello  ', undefined);
      expect(calls[0]?.q).toBeUndefined();
      expect(calls[1]?.q?.length).toBe(64);
      expect(calls[2]?.q).toBe('hello');
    });
    it('status enum strict ACTIVE/REVOKED/EXPIRED/EXHAUSTED', async () => {
      const calls: Array<{ status?: string }> = [];
      const c = makeController({
        giftList: (async (_l, f) => {
          calls.push(f as never);
          return [];
        }) as GiftCodeService['list'],
      });
      await c.giftList(undefined, undefined, 'ACTIVE');
      await c.giftList(undefined, undefined, 'PENDING');
      await c.giftList(undefined, undefined, 'active');
      expect(calls[0]?.status).toBe('ACTIVE');
      expect(calls[1]?.status).toBeUndefined();
      expect(calls[2]?.status).toBeUndefined();
    });
  });

  describe('POST /admin/giftcodes — GiftCreateZ', () => {
    it('400 khi code không match regex (chứa khoảng trắng)', async () => {
      const c = makeController();
      await expectHttpError(
        c.giftCreate(makeReq(), { code: 'BAD CODE' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi code < 4 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.giftCreate(makeReq(), { code: 'ABC' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi rewardItems > 10', async () => {
      const c = makeController();
      const items = Array.from({ length: 11 }).map((_, i) => ({
        itemKey: `item${i}`,
        qty: 1,
      }));
      await expectHttpError(
        c.giftCreate(makeReq(), { code: 'GIFTABCD', rewardItems: items }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi expiresAt không phải ISO datetime', async () => {
      const c = makeController();
      await expectHttpError(
        c.giftCreate(makeReq(), {
          code: 'GIFTABCD',
          expiresAt: '2024-01-01',
        }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; BigInt convert + maxRedeems null when missing + expiresAt Date', async () => {
      const calls: Array<{
        code: string;
        rewardLinhThach: bigint;
        rewardTienNgoc: number;
        rewardExp: bigint;
        rewardItems: Array<{ itemKey: string; qty: number }>;
        maxRedeems: number | null;
        expiresAt: Date | null;
        createdByAdminId: string;
      }> = [];
      const c = makeController({
        giftCreate: (async (input) => {
          calls.push(input as never);
          return { code: 'X' } as never;
        }) as GiftCodeService['create'],
      });
      const r = await c.giftCreate(makeReq({ userId: 'admin1' }), {
        code: 'NEWYEAR2025',
        rewardLinhThach: '1000',
        rewardTienNgoc: 50,
        rewardExp: '500',
        rewardItems: [{ itemKey: 'sword', qty: 2 }],
        maxRedeems: 100,
        expiresAt: '2025-12-31T00:00:00Z',
      });
      expect(r?.ok).toBe(true);
      expect(calls.length).toBe(1);
      expect(calls[0].code).toBe('NEWYEAR2025');
      expect(typeof calls[0].rewardLinhThach).toBe('bigint');
      expect(calls[0].rewardLinhThach).toBe(1000n);
      expect(calls[0].rewardExp).toBe(500n);
      expect(calls[0].maxRedeems).toBe(100);
      expect(calls[0].expiresAt).toBeInstanceOf(Date);
      expect(calls[0].createdByAdminId).toBe('admin1');
    });
    it('200; default reward=0 + maxRedeems=null + expiresAt=null', async () => {
      const calls: Array<{
        rewardLinhThach: bigint;
        rewardTienNgoc: number;
        maxRedeems: number | null;
        expiresAt: Date | null;
      }> = [];
      const c = makeController({
        giftCreate: (async (input) => {
          calls.push(input as never);
          return { code: 'X' } as never;
        }) as GiftCodeService['create'],
      });
      await c.giftCreate(makeReq(), { code: 'GIFTNONE' });
      expect(calls[0].rewardLinhThach).toBe(0n);
      expect(calls[0].rewardTienNgoc).toBe(0);
      expect(calls[0].maxRedeems).toBeNull();
      expect(calls[0].expiresAt).toBeNull();
    });
  });

  describe('POST /admin/giftcodes/:code/revoke', () => {
    it('200; truyền (code)', async () => {
      const calls: string[] = [];
      const c = makeController({
        giftRevoke: (async (code) => {
          calls.push(code);
          return { code } as never;
        }) as GiftCodeService['revoke'],
      });
      const r = await c.giftRevoke('NEWYEAR2025');
      expect(r?.ok).toBe(true);
      expect(calls).toEqual(['NEWYEAR2025']);
    });
  });

  describe('POST /admin/mail/send — MailSendZ (recipient REQUIRED)', () => {
    it('400 khi không có recipientCharacterId', async () => {
      const c = makeController();
      await expectHttpError(
        c.mailSend(makeReq(), { subject: 'Hi', body: 'Hello' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi subject rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.mailSend(makeReq(), {
          recipientCharacterId: 'c1',
          subject: '',
          body: 'Hello',
        }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('400 khi body > 2000 ký tự', async () => {
      const c = makeController();
      await expectHttpError(
        c.mailSend(makeReq(), {
          recipientCharacterId: 'c1',
          subject: 'Hi',
          body: 'x'.repeat(2001),
        }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
    it('200; BigInt convert + createdByAdminId từ req.userId', async () => {
      const calls: Array<{
        recipientCharacterId: string;
        rewardLinhThach: bigint;
        rewardExp: bigint;
        createdByAdminId: string;
      }> = [];
      const c = makeController({
        mailSend: (async (input) => {
          calls.push(input as never);
          return { id: 'm1' } as never;
        }) as MailService['sendToCharacter'],
      });
      const r = await c.mailSend(makeReq({ userId: 'admin42' }), {
        recipientCharacterId: 'char-1',
        subject: 'Hello',
        body: 'Welcome to closed beta',
        rewardLinhThach: '500',
        rewardExp: '100',
      });
      expect(r?.ok).toBe(true);
      expect(calls[0].recipientCharacterId).toBe('char-1');
      expect(calls[0].rewardLinhThach).toBe(500n);
      expect(calls[0].rewardExp).toBe(100n);
      expect(calls[0].createdByAdminId).toBe('admin42');
    });
  });

  describe('POST /admin/mail/broadcast — MailBaseZ (no recipient)', () => {
    it('200; gọi service.broadcast (KHÔNG sendToCharacter); trả count', async () => {
      const sendCalls: number[] = [];
      const broadcastCalls: Array<{
        subject: string;
        rewardLinhThach: bigint;
        createdByAdminId: string;
      }> = [];
      const c = makeController({
        mailSend: (async () => {
          sendCalls.push(1);
          return { id: 'm1' } as never;
        }) as MailService['sendToCharacter'],
        mailBroadcast: (async (input) => {
          broadcastCalls.push(input as never);
          return 42;
        }) as MailService['broadcast'],
      });
      const r = await c.mailBroadcast(makeReq({ userId: 'admin1' }), {
        subject: 'Maintenance',
        body: 'Server restarts at 0:00 UTC',
      });
      expect(r).toEqual({ ok: true, data: { count: 42 } });
      expect(sendCalls.length).toBe(0);
      expect(broadcastCalls[0].subject).toBe('Maintenance');
      expect(broadcastCalls[0].createdByAdminId).toBe('admin1');
      expect(broadcastCalls[0].rewardLinhThach).toBe(0n);
    });
    it('400 khi body rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.mailBroadcast(makeReq(), { subject: 'Hi', body: '' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
  });

  describe('handleErr — AdminError mapping', () => {
    const cases: Array<[
      'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_PROCESSED' | 'INVALID_INPUT' | 'CANNOT_TARGET_SELF',
      number,
    ]> = [
      ['NOT_FOUND', HttpStatus.NOT_FOUND],
      ['FORBIDDEN', HttpStatus.FORBIDDEN],
      ['ALREADY_PROCESSED', HttpStatus.CONFLICT],
      ['INVALID_INPUT', HttpStatus.BAD_REQUEST],
      ['CANNOT_TARGET_SELF', HttpStatus.BAD_REQUEST],
    ];
    for (const [code, status] of cases) {
      it(`ban: AdminError(${code}) → ${status}`, async () => {
        const c = makeController({
          setBanned: (async () => {
            throw new AdminError(code);
          }) as AdminService['setBanned'],
        });
        await expectHttpError(
          c.ban(makeReq(), 'u1', { banned: true }),
          status,
          code,
        );
      });
    }
    it('grant: AdminError(NOT_FOUND) → 404 (cross-endpoint)', async () => {
      const c = makeController({
        grant: (async () => {
          throw new AdminError('NOT_FOUND');
        }) as AdminService['grant'],
      });
      await expectHttpError(
        c.grant(makeReq(), 'unknown', { linhThach: '0', tienNgoc: 0 }),
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
      );
    });
    it('approveTopup: AdminError(ALREADY_PROCESSED) → 409', async () => {
      const c = makeController({
        approveTopup: (async () => {
          throw new AdminError('ALREADY_PROCESSED');
        }) as AdminService['approveTopup'],
      });
      await expectHttpError(
        c.approveTopup(makeReq(), 't1', {}),
        HttpStatus.CONFLICT,
        'ALREADY_PROCESSED',
      );
    });
  });

  describe('handleErr — GiftCodeError mapping', () => {
    const cases: Array<[
      | 'CODE_NOT_FOUND'
      | 'NO_CHARACTER'
      | 'ALREADY_REDEEMED'
      | 'CODE_EXPIRED'
      | 'CODE_REVOKED'
      | 'CODE_EXHAUSTED'
      | 'CODE_EXISTS'
      | 'INVALID_INPUT',
      number,
    ]> = [
      ['CODE_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['ALREADY_REDEEMED', HttpStatus.CONFLICT],
      ['CODE_EXPIRED', HttpStatus.CONFLICT],
      ['CODE_REVOKED', HttpStatus.CONFLICT],
      ['CODE_EXHAUSTED', HttpStatus.CONFLICT],
      ['CODE_EXISTS', HttpStatus.CONFLICT],
      ['INVALID_INPUT', HttpStatus.BAD_REQUEST],
    ];
    for (const [code, status] of cases) {
      it(`giftCreate: GiftCodeError(${code}) → ${status}`, async () => {
        const c = makeController({
          giftCreate: (async () => {
            throw new GiftCodeError(code);
          }) as GiftCodeService['create'],
        });
        await expectHttpError(
          c.giftCreate(makeReq(), { code: 'NEWYEAR2025' }),
          status,
          code,
        );
      });
    }
    it('giftRevoke: GiftCodeError(CODE_NOT_FOUND) → 404 (cross-endpoint)', async () => {
      const c = makeController({
        giftRevoke: (async () => {
          throw new GiftCodeError('CODE_NOT_FOUND');
        }) as GiftCodeService['revoke'],
      });
      await expectHttpError(
        c.giftRevoke('UNKNOWN'),
        HttpStatus.NOT_FOUND,
        'CODE_NOT_FOUND',
      );
    });
  });

  describe('handleErr — MailError mapping', () => {
    const cases: Array<[
      | 'RECIPIENT_NOT_FOUND'
      | 'MAIL_NOT_FOUND'
      | 'ALREADY_CLAIMED'
      | 'MAIL_EXPIRED'
      | 'NO_REWARD'
      | 'NO_CHARACTER'
      | 'INVALID_INPUT',
      number,
    ]> = [
      ['RECIPIENT_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['MAIL_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['ALREADY_CLAIMED', HttpStatus.CONFLICT],
      ['MAIL_EXPIRED', HttpStatus.CONFLICT],
      ['NO_REWARD', HttpStatus.CONFLICT],
      ['NO_CHARACTER', HttpStatus.BAD_REQUEST],
      ['INVALID_INPUT', HttpStatus.BAD_REQUEST],
    ];
    for (const [code, status] of cases) {
      it(`mailSend: MailError(${code}) → ${status}`, async () => {
        const c = makeController({
          mailSend: (async () => {
            throw new MailError(code);
          }) as MailService['sendToCharacter'],
        });
        await expectHttpError(
          c.mailSend(makeReq(), {
            recipientCharacterId: 'c1',
            subject: 'Hi',
            body: 'Hello',
          }),
          status,
          code,
        );
      });
    }
    it('mailBroadcast: MailError(NO_REWARD) → 409 (cross-endpoint)', async () => {
      const c = makeController({
        mailBroadcast: (async () => {
          throw new MailError('NO_REWARD');
        }) as MailService['broadcast'],
      });
      await expectHttpError(
        c.mailBroadcast(makeReq(), { subject: 'X', body: 'Y' }),
        HttpStatus.CONFLICT,
        'NO_REWARD',
      );
    });
  });

  describe('handleErr — rethrow non-known', () => {
    it('rethrow plain Error nguyên', async () => {
      const boom = new Error('db down');
      const c = makeController({
        setBanned: (async () => {
          throw boom;
        }) as AdminService['setBanned'],
      });
      await expect(c.ban(makeReq(), 'u1', { banned: true })).rejects.toBe(boom);
    });
    it('rethrow Error có code field nhưng không phải instance', async () => {
      class FakeAdminErr extends Error {
        constructor(public code: string) {
          super(code);
        }
      }
      const boom = new FakeAdminErr('NOT_FOUND');
      const c = makeController({
        setBanned: (async () => {
          throw boom;
        }) as AdminService['setBanned'],
      });
      await expect(c.ban(makeReq(), 'u1', { banned: true })).rejects.toBe(boom);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 13.1.C — POST /admin/sect-war/snapshot endpoint
  // ─────────────────────────────────────────────────────────────────────
  describe('POST /admin/sect-war/snapshot', () => {
    it('200 + truyền actorId/weekKey/reason vào liveOps.snapshotSectWarStatus', async () => {
      const calls: Array<[string, string, string | undefined]> = [];
      const c = makeController({
        liveOpsSnapshot: async (uid, wk, r) => {
          calls.push([uid, wk, r]);
          return {
            weekKey: wk,
            totalSects: 1,
            totalContributors: 2,
            totalContributions: 3,
            topSects: [{ sectId: 's1', sectName: 'A', points: 100, contributors: 2 }],
          };
        },
      });
      const r = await c.sectWarSnapshot(makeReq({ userId: 'admin-7' }), {
        weekKey: '2030-W30',
        reason: 'audit',
      });
      expect(r.ok).toBe(true);
      expect(r.data.weekKey).toBe('2030-W30');
      expect(r.data.totalSects).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['admin-7', '2030-W30', 'audit']);
    });

    it('weekKey thiếu → fallback computed week (truyền chuỗi YYYY-WNN xuống service)', async () => {
      const captured: Array<string> = [];
      const c = makeController({
        liveOpsSnapshot: async (_uid, wk) => {
          captured.push(wk);
          return {
            weekKey: wk,
            totalSects: 0,
            totalContributors: 0,
            totalContributions: 0,
            topSects: [],
          };
        },
      });
      const r = await c.sectWarSnapshot(makeReq(), {});
      expect(r.ok).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('weekKey sai format → 400 INVALID_INPUT, KHÔNG gọi service', async () => {
      const captured: Array<string> = [];
      const c = makeController({
        liveOpsSnapshot: async (_uid, wk) => {
          captured.push(wk);
          return {
            weekKey: wk,
            totalSects: 0,
            totalContributors: 0,
            totalContributions: 0,
            topSects: [],
          };
        },
      });
      await expectHttpError(
        c.sectWarSnapshot(makeReq(), { weekKey: 'bad-week-key' }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
      expect(captured).toHaveLength(0);
    });

    it('reason quá 200 ký tự → 400 INVALID_INPUT', async () => {
      const c = makeController();
      await expectHttpError(
        c.sectWarSnapshot(makeReq(), { reason: 'x'.repeat(201) }),
        HttpStatus.BAD_REQUEST,
        'INVALID_INPUT',
      );
    });
  });
});
