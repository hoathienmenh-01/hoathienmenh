import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CurrencyKind, Role, TopupStatus } from '@prisma/client';
import { z } from 'zod';
import { sectWarWeekKey } from '@xuantoi/shared';
import { AdminGuard } from './admin.guard';
import { RequireAdmin } from './require-admin.decorator';
import { AdminError, AdminService } from './admin.service';
import {
  AdminLiveOpsError,
  AdminLiveOpsService,
} from './admin-liveops.service';
import {
  clampStaleHours,
  resolveEconomyAlertsBounds,
  type EconomyAlertsBounds,
} from './economy-alerts-config';
import { GiftCodeError, GiftCodeService } from '../giftcode/giftcode.service';
import { MailError, MailService } from '../mail/mail.service';
import { formatUsersCsv } from './user-csv';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const RoleZ = z.enum(['PLAYER', 'MOD', 'ADMIN']);

const BanInput = z.object({
  banned: z.boolean(),
});
const RoleInput = z.object({
  role: RoleZ,
});
const GrantInput = z.object({
  /** Có thể âm để trừ. */
  linhThach: z.string().regex(/^-?\d+$/).default('0'),
  tienNgoc: z.number().int().default(0),
  reason: z.string().max(200).default(''),
});
const InventoryRevokeInput = z.object({
  itemKey: z.string().min(1).max(80),
  qty: z.number().int().positive().max(999),
  reason: z.string().max(200).default(''),
});
const GrantExpInput = z.object({
  /** EXP cộng — chỉ nhận positive BigInt (không trừ EXP). Decimal regex giới hạn 19 char. */
  exp: z
    .string()
    .regex(/^\d{1,19}$/, 'exp must be a positive bigint up to 10^18'),
  reason: z.string().max(200).default(''),
});
const GrantItemInput = z.object({
  itemKey: z.string().min(1).max(80),
  qty: z.number().int().positive().max(999),
  reason: z.string().max(200).default(''),
});
const GrantSpiritualRootInput = z.object({
  grade: z.enum(['pham', 'linh', 'huyen', 'tien', 'than']),
  primaryElement: z.enum(['kim', 'moc', 'thuy', 'hoa', 'tho']),
  /** Optional override; nếu omit, server tự derive theo ELEMENTS order skip primary. */
  secondaryElements: z
    .array(z.enum(['kim', 'moc', 'thuy', 'hoa', 'tho']))
    .max(4)
    .optional(),
  /** Optional 1-100; default 100 (admin override = max purity). */
  purity: z.number().int().min(1).max(100).optional(),
  reason: z.string().max(200).default(''),
});
const GrantTalentPointInput = z.object({
  /** Số điểm bonus cộng vào `Character.bonusTalentPoints`. Chỉ positive (1..99). */
  delta: z.number().int().positive().max(99),
  reason: z.string().max(200).default(''),
});
const SetRealmInput = z.object({
  /** Realm key (vd `truc_co`, `kim_dan`); validate vs `REALMS` catalog ở service. */
  realmKey: z.string().min(1).max(80),
  /** 1..realm.stages — service validate cap theo realm. Default 1 cho admin set quick. */
  realmStage: z.number().int().min(1).max(9).default(1),
  reason: z.string().max(200).default(''),
});
const QuestTrackInput = z.object({
  /** Step kind. talk/explore/choice phải qua POST /quests/progress (player-driven, server vẫn validate). */
  kind: z.enum(['kill', 'collect']),
  targetType: z.enum(['monster', 'item']),
  /** vd "son_thu", "linh_co". Service validate format (1..80). */
  targetId: z.string().min(1).max(80),
  /** 1..999 — admin track tối đa 1 lần (catalog max step.count = 5). */
  amount: z.number().int().positive().max(999),
  reason: z.string().max(200).default(''),
});
const GrantCurrencyInput = z.object({
  currency: z.enum(['LINH_THACH', 'TIEN_NGOC']),
  /** BigInt-as-string (mirror grant-exp pattern). Có thể âm để trừ. */
  delta: z.string().regex(/^-?\d{1,19}$/, 'delta must be a signed bigint up to 10^18'),
  reason: z.string().max(200).default(''),
});
const GrantMethodInput = z.object({
  /** Cultivation method key trong shared `CULTIVATION_METHODS` catalog. Service validate vs catalog → INVALID_INPUT nếu typo. */
  methodKey: z.string().min(1).max(80),
  reason: z.string().max(200).default(''),
});
const SeedDailyLoginStreakInput = z.object({
  /** Số ngày seed liên tiếp ngay TRƯỚC hôm nay (yesterday, day-2, ..., day-days). Service cap [1..30]. */
  days: z.number().int().min(1).max(30),
  reason: z.string().max(200).default(''),
});
const TopupActionInput = z.object({
  note: z.string().max(200).default(''),
});

const GiftItemZ = z.object({
  itemKey: z.string().min(1).max(80),
  qty: z.number().int().positive().max(999),
});
const GiftCreateZ = z.object({
  code: z.string().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/),
  rewardLinhThach: z.string().regex(/^\d+$/).default('0'),
  rewardTienNgoc: z.number().int().min(0).default(0),
  rewardExp: z.string().regex(/^\d+$/).default('0'),
  rewardItems: z.array(GiftItemZ).max(10).default([]),
  maxRedeems: z.number().int().positive().max(1_000_000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const MailItemZ = z.object({
  itemKey: z.string().min(1).max(80),
  qty: z.number().int().positive().max(999),
});
const MailBaseZ = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  senderName: z.string().min(1).max(80).optional(),
  rewardLinhThach: z.string().regex(/^\d+$/).default('0'),
  rewardTienNgoc: z.number().int().min(0).default(0),
  rewardExp: z.string().regex(/^\d+$/).default('0'),
  rewardItems: z.array(MailItemZ).max(10).default([]),
  expiresAt: z.string().datetime().optional(),
});
const MailSendZ = MailBaseZ.extend({
  recipientCharacterId: z.string().min(1).max(80),
});

type AdminReq = Request & { userId: string; role: Role };

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  private readonly economyAlertsBounds: EconomyAlertsBounds;

  constructor(
    private readonly admin: AdminService,
    private readonly giftCodes: GiftCodeService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly liveOps: AdminLiveOpsService,
  ) {
    this.economyAlertsBounds = resolveEconomyAlertsBounds(
      (key) => this.config.get<string>(key),
      (msg) => this.logger.warn(`[economy-alerts] ${msg}`),
    );
  }

  @Get('users')
  async users(
    @Query('q') q: string | undefined,
    @Query('page') page: string | undefined,
    @Query('role') role: string | undefined,
    @Query('banned') banned: string | undefined,
    @Query('linhThachMin') linhThachMin: string | undefined,
    @Query('linhThachMax') linhThachMax: string | undefined,
    @Query('tienNgocMin') tienNgocMin: string | undefined,
    @Query('tienNgocMax') tienNgocMax: string | undefined,
    @Query('realmKey') realmKey: string | undefined,
  ) {
    const p = Math.max(0, Number.parseInt(page ?? '0', 10) || 0);
    const filters: {
      role?: Role;
      banned?: boolean;
      linhThachMin?: bigint;
      linhThachMax?: bigint;
      tienNgocMin?: number;
      tienNgocMax?: number;
      realmKey?: string;
    } = {};
    if (role === 'PLAYER' || role === 'MOD' || role === 'ADMIN') filters.role = role;
    if (banned === 'true') filters.banned = true;
    else if (banned === 'false') filters.banned = false;
    // Parse smart filter: nếu user gõ string không hợp lệ thì bỏ qua thay vì 400.
    const parseBig = (s: string | undefined): bigint | undefined => {
      if (!s) return undefined;
      try {
        const n = BigInt(s);
        return n >= 0n ? n : undefined;
      } catch {
        return undefined;
      }
    };
    const parseInt32 = (s: string | undefined): number | undefined => {
      if (!s) return undefined;
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    filters.linhThachMin = parseBig(linhThachMin);
    filters.linhThachMax = parseBig(linhThachMax);
    filters.tienNgocMin = parseInt32(tienNgocMin);
    filters.tienNgocMax = parseInt32(tienNgocMax);
    if (realmKey && /^[a-z0-9_-]{1,32}$/.test(realmKey)) filters.realmKey = realmKey;
    const r = await this.admin.listUsers(q, p, filters);
    return { ok: true, data: r };
  }

  /**
   * Smart admin user export CSV (session 9i task E). Reuse cùng filter logic
   * với GET /admin/users (single source of truth). Trả về `text/csv` raw để
   * trình duyệt download trực tiếp. Cap 5000 row trong service; nếu truncated
   * thì set header `X-Export-Truncated: true` để FE hiện cảnh báo.
   *
   * Audit log entry `user.exportCsv` được ghi trong service (không lộ data PII
   * trong query string admin).
   */
  @Get('users.csv')
  @RequireAdmin()
  async usersCsv(
    @Req() req: AdminReq,
    @Res({ passthrough: true }) res: Response,
    @Query('q') q: string | undefined,
    @Query('role') role: string | undefined,
    @Query('banned') banned: string | undefined,
    @Query('linhThachMin') linhThachMin: string | undefined,
    @Query('linhThachMax') linhThachMax: string | undefined,
    @Query('tienNgocMin') tienNgocMin: string | undefined,
    @Query('tienNgocMax') tienNgocMax: string | undefined,
    @Query('realmKey') realmKey: string | undefined,
  ): Promise<string> {
    const filters: {
      role?: Role;
      banned?: boolean;
      linhThachMin?: bigint;
      linhThachMax?: bigint;
      tienNgocMin?: number;
      tienNgocMax?: number;
      realmKey?: string;
    } = {};
    if (role === 'PLAYER' || role === 'MOD' || role === 'ADMIN') filters.role = role;
    if (banned === 'true') filters.banned = true;
    else if (banned === 'false') filters.banned = false;
    const parseBig = (s: string | undefined): bigint | undefined => {
      if (!s) return undefined;
      try {
        const n = BigInt(s);
        return n >= 0n ? n : undefined;
      } catch {
        return undefined;
      }
    };
    const parseInt32 = (s: string | undefined): number | undefined => {
      if (!s) return undefined;
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    filters.linhThachMin = parseBig(linhThachMin);
    filters.linhThachMax = parseBig(linhThachMax);
    filters.tienNgocMin = parseInt32(tienNgocMin);
    filters.tienNgocMax = parseInt32(tienNgocMax);
    if (realmKey && /^[a-z0-9_-]{1,32}$/.test(realmKey)) filters.realmKey = realmKey;
    const r = await this.admin.exportUsers(req.userId, q, filters);
    const csv = formatUsersCsv(r.rows);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="xuantoi-users-${ts}.csv"`,
    );
    res.setHeader('X-Export-Total', String(r.total));
    res.setHeader('X-Export-Rows', String(r.rows.length));
    if (r.truncated) res.setHeader('X-Export-Truncated', 'true');
    return csv;
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  async ban(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = BanInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.setBanned(req.userId, req.role, id, parsed.data.banned);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('users/:id/role')
  @HttpCode(200)
  @RequireAdmin()
  async role(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = RoleInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.setRole(req.userId, req.role, id, parsed.data.role);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('users/:id/grant')
  @HttpCode(200)
  @RequireAdmin()
  async grant(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = GrantInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grant(
        req.userId,
        req.role,
        id,
        BigInt(parsed.data.linhThach),
        parsed.data.tienNgoc,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('users/:id/inventory/revoke')
  @HttpCode(200)
  @RequireAdmin()
  async revokeInventory(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = InventoryRevokeInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.revokeInventory(
        req.userId,
        req.role,
        id,
        parsed.data.itemKey,
        parsed.data.qty,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — cộng EXP trực tiếp vào Character. Use-case:
   * positive-path smoke breakthrough (EXP đủ next-realm), test cultivation
   * method exp multiplier mà không phải chờ Nhập Định tick. Audit
   * `admin.exp.grant`. KHÔNG ledger (EXP không phải currency).
   */
  @Post('users/:id/grant-exp')
  @HttpCode(200)
  @RequireAdmin()
  async grantExp(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = GrantExpInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantExp(
        req.userId,
        req.role,
        id,
        BigInt(parsed.data.exp),
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — cấp item vào túi. Use-case: positive-path smoke
   * cho item-consume (skill book, linh_can_dan reroll, pill, equip) không
   * phải chờ drop hoặc giftcode redeem. Reuse inventory.grant() →
   * ItemLedger reason='ADMIN_GRANT'. Audit `admin.inventory.grant`.
   */
  @Post('users/:id/grant-item')
  @HttpCode(200)
  @RequireAdmin()
  async grantItem(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = GrantItemInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantItem(
        req.userId,
        req.role,
        id,
        parsed.data.itemKey,
        parsed.data.qty,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 12 Story PR-5 — admin seed harness: bypass-track quest progress
   * cho step kind kill/collect. Use-case: positive-flow E2E + smoke main
   * storyline Chapter 1 (`phamnhan_main_01` step_03 kill 3 sơn thử)
   * không phải spin combat loop thật. Reuse `QuestService.track()` →
   * tự match ACCEPTED quest theo (kind, targetType, targetId), cộng
   * counter atomic + auto-transition COMPLETED. Audit `admin.quest.track`.
   * KHÔNG ledger (claim path mới ghi ledger). talk/explore/choice phải
   * qua `POST /quests/progress` player-driven, không seed qua admin.
   */
  @Post('users/:id/quest-track')
  @HttpCode(200)
  @RequireAdmin()
  async grantQuestTrack(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = QuestTrackInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantQuestTrack(req.userId, req.role, id, {
        kind: parsed.data.kind,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
      });
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — override Linh căn / Spiritual Root. Use-case:
   * positive-path smoke combat element (controlled grade=than +
   * primaryElement=kim → max bonus), spiritual root reroll smoke (verify
   * SpiritualRootRollLog source='admin_grant' insert + Character update).
   * Audit `admin.spiritualRoot.grant`.
   */
  @Post('users/:id/grant-spiritual-root')
  @HttpCode(200)
  @RequireAdmin()
  async grantSpiritualRoot(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantSpiritualRootInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantSpiritualRoot(req.userId, req.role, id, {
        grade: parsed.data.grade,
        primaryElement: parsed.data.primaryElement,
        secondaryElements: parsed.data.secondaryElements,
        purity: parsed.data.purity,
        reason: parsed.data.reason,
      });
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — cộng điểm ngộ đạo (talent point) bonus. Use-case:
   * positive-path smoke talent flow / Phase 11.X UI E2E talent learn → cast →
   * cooldown không cần advance realm. Server compose `bonusTalentPoints` trên
   * `computeTalentPointBudget(realmOrder)` trong `TalentService.learnTalent`.
   * Audit `admin.talentPoint.grant`.
   */
  @Post('users/:id/grant-talent-point')
  @HttpCode(200)
  @RequireAdmin()
  async grantTalentPoint(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantTalentPointInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantTalentPoint(
        req.userId,
        req.role,
        id,
        parsed.data.delta,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — override `Character.realmKey` + `realmStage`. Use-case:
   * positive-path smoke breakthrough peak → next realm transition / cultivation
   * method realm-gated test / talent realm requirement gate. Reset
   * `Character.exp = 0` mỗi lần set-realm để tránh phá invariant của
   * `CultivationProcessor`/`grantExp` auto-advance. Audit `admin.realm.set`
   * ghi previousRealmKey/Stage để rollback.
   */
  @Post('users/:id/set-realm')
  @HttpCode(200)
  @RequireAdmin()
  async setRealm(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = SetRealmInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.setRealm(
        req.userId,
        req.role,
        id,
        parsed.data.realmKey,
        parsed.data.realmStage,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — cộng currency single-channel (LINH_THACH | TIEN_NGOC)
   * qua `CurrencyService.applyTx`. Use-case: positive-path smoke cho skill
   * upgrade-mastery (cần LinhThach), market post listing (cần LinhThach),
   * daily-login claim (cần TienNgoc init). Reuse `currency.applyTx({ reason:
   * 'ADMIN_GRANT' })` → ghi `CurrencyLedger` đầy đủ + `actorUserId` + meta
   * reason. Anti-FE-self-grant invariant. Audit `admin.currency.grant`.
   */
  @Post('users/:id/grant-currency')
  @HttpCode(200)
  @RequireAdmin()
  async grantCurrency(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantCurrencyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantCurrency(
        req.userId,
        req.role,
        id,
        parsed.data.currency === 'LINH_THACH'
          ? CurrencyKind.LINH_THACH
          : CurrencyKind.TIEN_NGOC,
        BigInt(parsed.data.delta),
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Admin seed harness — cấp quyền sở hữu cultivation method (công pháp)
   * cho character (mirror dungeon drop / sect shop / boss drop /
   * event source). Use-case: positive-path smoke `smoke:cultivation-method`
   * switch mở khốa `equippedMethodKey != STARTER`, Phase 11.X UI E2E
   * cultivation method swap. Bypass realm/sect/element validation — admin
   * override semantics. Idempotent qua P2002 catch (`@@unique([characterId,
   * methodKey])`). Audit `admin.method.grant`.
   */
  @Post('users/:id/grant-method')
  @HttpCode(200)
  @RequireAdmin()
  async grantMethod(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantMethodInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.grantMethod(
        req.userId,
        req.role,
        id,
        parsed.data.methodKey,
        parsed.data.reason,
      );
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Seed `dailyLoginClaim` rows cho `days` ngày liên tiếp trước hôm nay
   * (yesterday, day-2, ..., day-days), mỗi row với `streakAtClaim` tăng dần
   * 1..days. Use-case: positive-path smoke `smoke:daily-login` multi-day —
   * test streak chain logic (player claim hôm nay → newStreak = days+1).
   * KHÔNG cộng tiền (admin chỉ seed historical rows). Idempotent qua skip
   * P2002. Audit `admin.daily_login.seed`.
   */
  @Post('users/:id/seed-daily-login-streak')
  @HttpCode(200)
  @RequireAdmin()
  async seedDailyLoginStreak(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = SeedDailyLoginStreakInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.admin.seedDailyLoginStreak(
        req.userId,
        req.role,
        id,
        parsed.data.days,
        parsed.data.reason,
      );
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('topups')
  async topups(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('email') email: string | undefined,
  ) {
    const p = Math.max(0, Number.parseInt(page ?? '0', 10) || 0);
    const st: TopupStatus | null =
      status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? status : null;
    const filters: { fromDate?: Date; toDate?: Date; userEmail?: string } = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) filters.fromDate = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) filters.toDate = d;
    }
    if (email && email.length > 0 && email.length <= 120) filters.userEmail = email;
    const r = await this.admin.listTopups(st, p, filters);
    return { ok: true, data: r };
  }

  @Post('topups/:id/approve')
  @HttpCode(200)
  @RequireAdmin()
  async approveTopup(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = TopupActionInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.approveTopup(req.userId, id, parsed.data.note);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('topups/:id/reject')
  @HttpCode(200)
  @RequireAdmin()
  async rejectTopup(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = TopupActionInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.admin.rejectTopup(req.userId, id, parsed.data.note);
      return { ok: true, data: { ok: true } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('audit')
  async audit(
    @Query('page') page: string | undefined,
    @Query('action') action: string | undefined,
    @Query('email') email: string | undefined,
  ) {
    const p = Math.max(0, Number.parseInt(page ?? '0', 10) || 0);
    const filters: { actionPrefix?: string; actorEmail?: string } = {};
    if (action && action.length > 0 && action.length <= 64) filters.actionPrefix = action;
    if (email && email.length > 0 && email.length <= 120) filters.actorEmail = email;
    const r = await this.admin.listAudit(p, filters);
    return { ok: true, data: r };
  }

  @Get('stats')
  async stats() {
    const r = await this.admin.stats();
    return { ok: true, data: r };
  }

  /**
   * Trả danh sách cảnh báo economy:
   *   - Currency âm (`Character.linhThach/tienNgoc < 0`).
   *   - Inventory âm (`InventoryItem.qty < 1`).
   *   - Topup PENDING quá `staleHours` (mặc định 24h, ops override qua
   *     env `ECONOMY_ALERTS_DEFAULT_STALE_HOURS` / `_MIN_` / `_MAX_`).
   *
   * Read-only. Xem `docs/ADMIN_GUIDE.md §11` cho cron monitoring.
   */
  @Get('economy/alerts')
  async economyAlerts(@Query('staleHours') staleHours: string | undefined) {
    const hrs = clampStaleHours(staleHours, this.economyAlertsBounds);
    const r = await this.admin.getEconomyAlerts(hrs);
    return {
      ok: true,
      data: { ...r, bounds: this.economyAlertsBounds },
    };
  }

  /**
   * Smart economy safety endpoint: chạy ledger audit on-demand từ AdminView.
   *
   * Quét toàn bộ `CurrencyLedger` + `ItemLedger` so sánh với
   * `Character.linhThach/tienNgoc` + `InventoryItem.qty` per (char, item) —
   * phát hiện double-spend, double-grant, hoặc bug ledger không sync.
   *
   * Read-only, không gây side-effect. MOD đọc được (cùng tier với `economy/alerts`).
   * Có thể hơi nặng trên DB lớn (groupBy 4 query); closed-beta vài trăm character OK,
   * production sau này nên rate-limit hoặc cache.
   */
  @Get('economy/audit-ledger')
  async economyAuditLedger() {
    const r = await this.admin.runLedgerAudit();
    return { ok: true, data: r };
  }

  /**
   * Smart economy report: top 10 whales theo linhThach + tienNgoc + tổng circulation.
   *
   * Read-only, MOD đọc được (cùng tier với `economy/alerts` + `economy/audit-ledger`).
   * Closed-beta vài trăm character chạy < 50ms. Production sau này nên cache 60s nếu
   * traffic admin tăng.
   */
  @Get('economy/report')
  async economyReport() {
    const r = await this.admin.getEconomyReport();
    return { ok: true, data: r };
  }

  @Get('giftcodes')
  async giftList(
    @Query('limit') limit: string | undefined,
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
  ) {
    const l = Math.max(1, Math.min(500, Number.parseInt(limit ?? '100', 10) || 100));
    const filters: Parameters<typeof this.giftCodes.list>[1] = {};
    if (q && typeof q === 'string') {
      const trimmed = q.trim().slice(0, 64);
      if (trimmed) filters.q = trimmed;
    }
    if (status === 'ACTIVE' || status === 'REVOKED' || status === 'EXPIRED' || status === 'EXHAUSTED') {
      filters.status = status;
    }
    const r = await this.giftCodes.list(l, filters);
    return { ok: true, data: { codes: r } };
  }

  @Post('giftcodes')
  @HttpCode(200)
  @RequireAdmin()
  async giftCreate(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = GiftCreateZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const code = await this.giftCodes.create({
        code: parsed.data.code,
        rewardLinhThach: BigInt(parsed.data.rewardLinhThach),
        rewardTienNgoc: parsed.data.rewardTienNgoc,
        rewardExp: BigInt(parsed.data.rewardExp),
        rewardItems: parsed.data.rewardItems,
        maxRedeems: parsed.data.maxRedeems ?? null,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        createdByAdminId: req.userId,
      });
      return { ok: true, data: { code } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('giftcodes/:code/revoke')
  @HttpCode(200)
  @RequireAdmin()
  async giftRevoke(@Param('code') code: string) {
    try {
      const r = await this.giftCodes.revoke(code);
      return { ok: true, data: { code: r } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('mail/send')
  @HttpCode(200)
  @RequireAdmin()
  async mailSend(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = MailSendZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const mail = await this.mailService.sendToCharacter({
        recipientCharacterId: parsed.data.recipientCharacterId,
        subject: parsed.data.subject,
        body: parsed.data.body,
        senderName: parsed.data.senderName,
        rewardLinhThach: BigInt(parsed.data.rewardLinhThach),
        rewardTienNgoc: parsed.data.rewardTienNgoc,
        rewardExp: BigInt(parsed.data.rewardExp),
        rewardItems: parsed.data.rewardItems,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
        createdByAdminId: req.userId,
      });
      return { ok: true, data: { mail } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('mail/broadcast')
  @HttpCode(200)
  @RequireAdmin()
  async mailBroadcast(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = MailBaseZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const count = await this.mailService.broadcast({
        subject: parsed.data.subject,
        body: parsed.data.body,
        senderName: parsed.data.senderName,
        rewardLinhThach: BigInt(parsed.data.rewardLinhThach),
        rewardTienNgoc: parsed.data.rewardTienNgoc,
        rewardExp: BigInt(parsed.data.rewardExp),
        rewardItems: parsed.data.rewardItems,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
        createdByAdminId: req.userId,
      });
      return { ok: true, data: { count } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ───────── Phase 13.1.B — Admin LiveOps Controls ─────────

  /**
   * GET /admin/liveops — list catalog + DB overrides + computed today/active.
   * Read-only; KHÔNG audit.
   */
  @Get('liveops')
  async liveOpsStatus() {
    const data = await this.liveOps.getStatus();
    return { ok: true, data };
  }

  /**
   * POST /admin/liveops/event/toggle — upsert override + audit log.
   * Body: { key, enabled, startsAt?, endsAt?, reason? }.
   */
  @Post('liveops/event/toggle')
  @HttpCode(200)
  @RequireAdmin()
  async liveOpsToggle(@Req() req: AdminReq, @Body() body: unknown) {
    const Z = z.object({
      key: z.string().min(1).max(80),
      enabled: z.boolean(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      reason: z.string().max(200).optional(),
    });
    const parsed = Z.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.liveOps.toggleEvent(req.userId, {
        key: parsed.data.key,
        enabled: parsed.data.enabled,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        reason: parsed.data.reason ?? null,
      });
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * GET /admin/sect-war/status?weekKey=YYYY-Www — read-only snapshot.
   * `weekKey` optional; default = current ISO week.
   */
  @Get('sect-war/status')
  async sectWarStatus(@Query('weekKey') weekKey?: string) {
    const key = weekKey && /^\d{4}-W\d{2}$/.test(weekKey)
      ? weekKey
      : sectWarWeekKey(new Date());
    const data = await this.liveOps.getSectWarStatus(key);
    return { ok: true, data };
  }

  /**
   * POST /admin/sect-war/recalculate — placeholder no-op cho Phase 13.2.
   * Body: { weekKey?, reason? }.
   */
  @Post('sect-war/recalculate')
  @HttpCode(200)
  @RequireAdmin()
  async sectWarRecalculate(@Req() req: AdminReq, @Body() body: unknown) {
    const Z = z.object({
      weekKey: z
        .string()
        .regex(/^\d{4}-W\d{2}$/)
        .optional(),
      reason: z.string().max(200).optional(),
    });
    const parsed = Z.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const weekKey = parsed.data.weekKey ?? sectWarWeekKey(new Date());
    try {
      const data = await this.liveOps.recalculateSectWar(
        req.userId,
        weekKey,
        parsed.data.reason,
      );
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof AdminLiveOpsError) {
      const status =
        e.code === 'EVENT_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    if (e instanceof AdminError) {
      const status =
        e.code === 'NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : e.code === 'FORBIDDEN'
            ? HttpStatus.FORBIDDEN
            : e.code === 'ALREADY_PROCESSED'
              ? HttpStatus.CONFLICT
              : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    if (e instanceof GiftCodeError) {
      const status =
        e.code === 'CODE_NOT_FOUND' || e.code === 'NO_CHARACTER'
          ? HttpStatus.NOT_FOUND
          : e.code === 'ALREADY_REDEEMED' ||
              e.code === 'CODE_EXPIRED' ||
              e.code === 'CODE_REVOKED' ||
              e.code === 'CODE_EXHAUSTED' ||
              e.code === 'CODE_EXISTS'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    if (e instanceof MailError) {
      const status =
        e.code === 'RECIPIENT_NOT_FOUND' || e.code === 'MAIL_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : e.code === 'ALREADY_CLAIMED' || e.code === 'MAIL_EXPIRED' || e.code === 'NO_REWARD'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
