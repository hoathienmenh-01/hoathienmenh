#!/usr/bin/env node
/**
 * Phase 43 — Data Integrity Check (report-only).
 *
 * Mục tiêu: scan các invariants dữ liệu nền (currency / inventory /
 * giftcode redemption) → REPORT only. KHÔNG auto-fix, KHÔNG mutate dữ
 * liệu, KHÔNG drop bảng — vận hành production gọi đều đặn (cron / pre-deploy).
 *
 * Sử dụng:
 *
 *   pnpm integrity:check                           # human-readable
 *   pnpm integrity:check --json                    # JSON output
 *   pnpm integrity:check --scope=currency,inventory# subset
 *   pnpm integrity:check --no-redis                # bỏ ghi last-run
 *
 * Exit code:
 *   0 — clean (không issue).
 *   1 — phát hiện ≥ 1 issue (vẫn report bình thường — caller / CI
 *       có thể bật strict mode bằng env `INTEGRITY_STRICT=1`).
 *   2 — script lỗi runtime / không kết nối được DB.
 *
 * Ghi artefact:
 *   - Khi Redis reachable + không có `--no-redis` flag → ghi summary
 *     vào key `xt:system-status:integrity:last-run` (TTL 7 ngày). Admin
 *     UI `/admin/system-status` đọc artefact này.
 *
 * KHÔNG log secret: chỉ dùng dữ liệu shape (id / count / scope name).
 */
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';

const ALL_SCOPES = ['currency', 'inventory', 'giftcode', 'character'];

/** Mỗi check trả về danh sách `IntegrityIssue`. */
async function checkCurrencyNegative(prisma) {
  const rows = await prisma.character.findMany({
    where: {
      OR: [
        { linhThach: { lt: 0n } },
        { tienNgoc: { lt: 0 } },
        { tienNgocKhoa: { lt: 0 } },
        { nguyenThach: { lt: 0 } },
        { congHien: { lt: 0 } },
        { congDuc: { lt: 0 } },
        { trialPoint: { lt: 0 } },
        { eventToken: { lt: 0 } },
        { sectContribBalance: { lt: 0 } },
      ],
    },
    select: {
      id: true,
      linhThach: true,
      tienNgoc: true,
      tienNgocKhoa: true,
      nguyenThach: true,
      congHien: true,
      congDuc: true,
      trialPoint: true,
      eventToken: true,
      sectContribBalance: true,
    },
    take: 100,
  });
  if (rows.length === 0) return [];
  return [
    {
      scope: 'currency',
      severity: 'ERROR',
      message: `${rows.length} character(s) có currency âm — vi phạm hard invariant Phase 9 (currency phải >= 0)`,
      count: rows.length,
    },
  ];
}

async function checkInventoryNegative(prisma) {
  const rows = await prisma.inventoryItem.count({
    where: { qty: { lt: 0 } },
  });
  if (rows === 0) return [];
  return [
    {
      scope: 'inventory',
      severity: 'ERROR',
      message: `${rows} inventory_item row(s) có qty âm — vi phạm invariant qty >= 0`,
      count: rows,
    },
  ];
}

async function checkInventoryZeroStale(prisma) {
  // Stale qty=0 rows không phải bug nghiêm trọng (consume flow đôi khi
  // soft-delete bằng qty=0). Report WARN để admin biết khối lượng.
  const rows = await prisma.inventoryItem.count({
    where: { qty: 0 },
  });
  if (rows === 0) return [];
  return [
    {
      scope: 'inventory',
      severity: 'WARN',
      message: `${rows} inventory_item row(s) còn lại với qty=0 (stale row, không phải corruption)`,
      count: rows,
    },
  ];
}

async function checkGiftcodeDuplicate(prisma) {
  // UNIQUE (giftCodeId, userId) đã enforce ở DB. Defensive count duplicates.
  const dupes = await prisma.$queryRaw`
    SELECT "giftCodeId", "userId", COUNT(*)::int AS c
    FROM "GiftCodeRedemption"
    GROUP BY "giftCodeId", "userId"
    HAVING COUNT(*) > 1
    LIMIT 50
  `;
  if (!Array.isArray(dupes) || dupes.length === 0) return [];
  return [
    {
      scope: 'giftcode',
      severity: 'FATAL',
      message: `${dupes.length} (giftCodeId,userId) pair có nhiều hơn 1 redemption — UNIQUE constraint bị bypass?`,
      count: dupes.length,
    },
  ];
}

async function checkOrphanCharacter(prisma) {
  // CASCADE delete đảm bảo không có row mồ côi. Defensive count:
  // CurrencyLedger / ItemLedger nơi character không tồn tại.
  const orphanCurrency = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "CurrencyLedger" cl
    LEFT JOIN "Character" ch ON cl."characterId" = ch.id
    WHERE ch.id IS NULL
  `;
  const orphanItem = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "ItemLedger" il
    LEFT JOIN "Character" ch ON il."characterId" = ch.id
    WHERE ch.id IS NULL
  `;
  const cOrphan = Array.isArray(orphanCurrency) ? orphanCurrency[0]?.c ?? 0 : 0;
  const iOrphan = Array.isArray(orphanItem) ? orphanItem[0]?.c ?? 0 : 0;
  const issues = [];
  if (cOrphan > 0) {
    issues.push({
      scope: 'character',
      severity: 'ERROR',
      message: `${cOrphan} CurrencyLedger row(s) trỏ tới character đã bị xóa`,
      count: cOrphan,
    });
  }
  if (iOrphan > 0) {
    issues.push({
      scope: 'character',
      severity: 'ERROR',
      message: `${iOrphan} ItemLedger row(s) trỏ tới character đã bị xóa`,
      count: iOrphan,
    });
  }
  return issues;
}

const SCOPE_FNS = {
  currency: [checkCurrencyNegative],
  inventory: [checkInventoryNegative, checkInventoryZeroStale],
  giftcode: [checkGiftcodeDuplicate],
  character: [checkOrphanCharacter],
};

function parseArgs(argv) {
  const opts = {
    json: false,
    scope: ALL_SCOPES,
    noRedis: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '--json') opts.json = true;
    else if (a === '--no-redis') opts.noRedis = true;
    else if (a.startsWith('--scope=')) {
      const list = a
        .slice('--scope='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = list.filter((s) => !ALL_SCOPES.includes(s));
      if (unknown.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[integrity] Unknown scope(s): ${unknown.join(', ')}. Valid: ${ALL_SCOPES.join(', ')}`,
        );
        process.exit(2);
      }
      opts.scope = list;
    } else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        'Usage: pnpm integrity:check [--json] [--scope=currency,inventory,giftcode,character] [--no-redis]',
      );
      process.exit(0);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[integrity] Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

async function writeRedisArtefact(redisUrl, payload) {
  if (!redisUrl) return false;
  let redis = null;
  try {
    redis = new IORedis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });
    await redis.connect();
    await redis.set(
      'xt:system-status:integrity:last-run',
      JSON.stringify(payload),
      'EX',
      60 * 60 * 24 * 7,
    );
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[integrity] Bỏ qua ghi Redis artefact: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  } finally {
    try {
      await redis?.quit();
    } catch {
      /* ignore */
    }
  }
}

function renderHuman(report) {
  const lines = [];
  lines.push(`[integrity] runAt=${report.runAt}`);
  lines.push(`[integrity] scopes=${report.scopes.join(',')}`);
  lines.push(`[integrity] status=${report.status} issues=${report.issueCount}`);
  if (report.issues.length === 0) {
    lines.push('[integrity] ✓ CLEAN — không phát hiện issue.');
  } else {
    for (const i of report.issues) {
      lines.push(
        `[integrity] ${i.severity.padEnd(5)} ${i.scope.padEnd(10)} ${i.message}`,
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const prisma = new PrismaClient();
  const runAt = new Date().toISOString();
  const issues = [];

  try {
    for (const s of opts.scope) {
      const fns = SCOPE_FNS[s] ?? [];
      for (const fn of fns) {
        try {
          const found = await fn(prisma);
          issues.push(...found);
        } catch (e) {
          issues.push({
            scope: s,
            severity: 'WARN',
            message: `Check "${fn.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const issueCount = issues.reduce(
    (a, i) => a + (typeof i.count === 'number' ? i.count : 1),
    0,
  );
  const status = issues.length === 0 ? 'CLEAN' : 'ISSUES';
  const report = {
    runAt,
    status,
    scopes: opts.scope,
    issueCount,
    issues: issues.slice(0, 50),
  };

  if (!opts.noRedis) {
    await writeRedisArtefact(process.env.REDIS_URL, report);
  }

  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log(renderHuman(report));
  }

  const strict = process.env.INTEGRITY_STRICT === '1';
  if (issues.length === 0) process.exit(0);
  if (strict) process.exit(1);
  // Default: report-only mode → exit 0 dù có issue, để cron không alarm
  // sai. CI/admin có thể bật strict mode khi cần gate deploy.
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[integrity] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof Error && e.stack) {
    // eslint-disable-next-line no-console
    console.error(e.stack);
  }
  process.exit(2);
});
