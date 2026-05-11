#!/usr/bin/env node
/**
 * Phase 17.1 — Deploy Verify Gate orchestrator.
 *
 * Mục đích: smoke production-readiness end-to-end TRƯỚC khi cutover.
 * Chạy cả ở local (developer) + CI (pre-merge). Failure → exit code != 0.
 *
 * Steps (theo thứ tự, dừng ngay khi 1 step fail):
 *   1. `prisma migrate deploy` — apply migration lên DB target.
 *   2. Khởi động `apps/api` (`node dist/main.js`) ở background, đợi 30s
 *      cho listening port.
 *   3. Poll `GET /api/healthz` (liveness) — phải trả 200 + `ok: true`.
 *   4. Poll `GET /api/readyz` (DB + Redis) — phải trả 200 + `ok: true`.
 *   5. Poll `GET /api/version` — phải trả `name: '@xuantoi/api'`.
 *   6. Chạy `pnpm --filter @xuantoi/api bootstrap` lần 1 — phải tạo
 *      admin + 3 sect.
 *   7. Chạy `bootstrap` lần 2 — phải idempotent (không tạo duplicate).
 *   8. Kill API process, exit 0.
 *
 * Mặc định verify-mode = `production-like`:
 *   - Set `NODE_ENV=production` + đủ env critical (qua `.env` nếu tồn
 *     tại hoặc qua env biến hiện tại của shell). Nếu thiếu critical
 *     env, schema sẽ throw ở step 2 → ta báo lỗi cụ thể.
 *   - CI mode (`CI=1` hoặc env `VERIFY_DEPLOY_CI=1`) dùng dummy strong
 *     env do CI workflow inject, KHÔNG đụng `.env` local.
 *
 * Reuse: script là pure Node 20+, KHÔNG cần thêm dependency runtime —
 * tránh phải `pnpm install` ở step trước migrate.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

const PORT = Number(process.env.PORT ?? 3100);
const API_BASE = `http://127.0.0.1:${PORT}/api`;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;

const STRONG = {
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET ??
    'verify-deploy-access-secret-32chars-AAAAAAAA',
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET ??
    'verify-deploy-refresh-secret-32chars-BBBBBBBB',
  SECURITY_IP_HASH_SALT:
    process.env.SECURITY_IP_HASH_SALT ??
    'verify-deploy-ip-hash-salt-32chars-CCCCCCCC',
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'https://verify.xt.local',
  SESSION_COOKIE_DOMAIN:
    process.env.SESSION_COOKIE_DOMAIN ?? '.verify.xt.local',
};

const BOOTSTRAP_EMAIL =
  process.env.INITIAL_ADMIN_EMAIL ?? 'verify-deploy-admin@xt.local';
const BOOTSTRAP_PASSWORD =
  process.env.INITIAL_ADMIN_PASSWORD ?? 'verify-deploy-pass-1234567890';

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[verify-deploy] ${msg}`);
}

function fatal(msg, err) {
  // eslint-disable-next-line no-console
  console.error(`[verify-deploy] FATAL: ${msg}`);
  if (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  process.exit(1);
}

function buildApiEnv() {
  // Bắt buộc production env strict — schema sẽ refuse start nếu thiếu.
  // KHÔNG đọc apps/api/.env (có thể chứa placeholder dev) — verify
  // mode bơm env strong qua process.env trực tiếp.
  const inherited = { ...process.env };
  if (!inherited.DATABASE_URL) {
    fatal('DATABASE_URL không set trong env shell. Bắt buộc cho verify:deploy.');
  }
  if (!inherited.REDIS_URL) {
    fatal('REDIS_URL không set trong env shell. Bắt buộc cho verify:deploy.');
  }
  return {
    ...inherited,
    NODE_ENV: 'production',
    PORT: String(PORT),
    JWT_ACCESS_SECRET: STRONG.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: STRONG.JWT_REFRESH_SECRET,
    SECURITY_IP_HASH_SALT: STRONG.SECURITY_IP_HASH_SALT,
    CORS_ORIGINS: STRONG.CORS_ORIGINS,
    SESSION_COOKIE_DOMAIN: STRONG.SESSION_COOKIE_DOMAIN,
    // Disable optional features có thể đòi infra ngoài (Sentry/SMTP)
    // → tránh false-negative.
    SENTRY_DSN_API: '',
    SENTRY_ENABLED: 'false',
    MAIL_TRANSPORT: 'console',
    // Tắt cron — verify chỉ quan tâm healthz/readyz/version + bootstrap.
    TERRITORY_CRON_ENABLED: 'false',
    SECT_SEASON_CRON_ENABLED: 'false',
    LEDGER_CHECKER_CRON_ENABLED: 'false',
    ECONOMY_ANOMALY_CRON_ENABLED: 'false',
    // Bootstrap admin credentials cho step 6/7.
    INITIAL_ADMIN_EMAIL: BOOTSTRAP_EMAIL,
    INITIAL_ADMIN_PASSWORD: BOOTSTRAP_PASSWORD,
  };
}

/** Resolve entry point của apps/api sau khi build. Nest CLI có 2 layout:
 *  - `dist/main.js` (default tsc)
 *  - `dist/src/main.js` (khi tsconfig outDir = dist + rootDir = src bị thay bằng
 *    layout nested do swc preserveStructure).
 * Trả về path tồn tại; fail nếu cả 2 đều thiếu (chưa build).
 */
function resolveApiMainJs() {
  const candidates = [
    resolve(API_DIR, 'dist/main.js'),
    resolve(API_DIR, 'dist/src/main.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  fatal(
    `apps/api/dist/main.js (hoặc dist/src/main.js) chưa build. Chạy "pnpm --filter @xuantoi/api build" trước verify:deploy.`,
  );
  return null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

async function step1MigrateDeploy(env) {
  log('Step 1/7 — prisma migrate deploy');
  await runCmd(
    'pnpm',
    ['--filter', '@xuantoi/api', 'exec', 'prisma', 'migrate', 'deploy'],
    { env, cwd: REPO_ROOT },
  );
}

async function step2StartApi(env) {
  log(`Step 2/7 — start API (NODE_ENV=production, PORT=${PORT})`);
  const mainJs = resolveApiMainJs();
  const child = spawn('node', [mainJs], {
    cwd: API_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutLines = [];
  const stderrLines = [];
  child.stdout.on('data', (b) => {
    const s = b.toString();
    stdoutLines.push(s);
    process.stdout.write(`[api] ${s}`);
  });
  child.stderr.on('data', (b) => {
    const s = b.toString();
    stderrLines.push(s);
    process.stderr.write(`[api err] ${s}`);
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // eslint-disable-next-line no-console
      console.error(`[verify-deploy] API exited code=${code} prematurely.`);
    }
  });
  return { child, stdoutLines, stderrLines };
}

async function step3PollHealth(path, name) {
  log(`Step ${name} — poll ${path}`);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}${path}`);
      const body = await res.json();
      if (res.status === 200 && body && body.ok === true) {
        log(`  ✓ ${path} 200 ok`);
        return body;
      }
      lastErr = new Error(`HTTP ${res.status} body=${JSON.stringify(body)}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  fatal(`Health probe ${path} không pass trong ${HEALTH_TIMEOUT_MS}ms.`, lastErr);
}

async function step5VersionCheck() {
  log('Step 5/7 — poll /version');
  const res = await fetch(`${API_BASE}/version`);
  const body = await res.json();
  if (res.status !== 200) {
    fatal(`/version trả ${res.status}, expected 200.`);
  }
  if (body.name !== '@xuantoi/api') {
    fatal(
      `/version.name = ${JSON.stringify(body.name)}, expected '@xuantoi/api'.`,
    );
  }
  if (typeof body.version !== 'string' || body.version.length === 0) {
    fatal(`/version.version invalid: ${JSON.stringify(body.version)}`);
  }
  if (typeof body.node !== 'string' || !body.node.startsWith('v')) {
    fatal(`/version.node invalid: ${JSON.stringify(body.node)}`);
  }
  log(
    `  ✓ /version name=${body.name} version=${body.version} commit=${body.commit} node=${body.node}`,
  );
  return body;
}

async function step6Bootstrap(env, label) {
  log(`Step ${label} — pnpm --filter @xuantoi/api bootstrap`);
  const { stdout } = await runCmdCapture(
    'pnpm',
    ['--filter', '@xuantoi/api', 'bootstrap'],
    { env, cwd: REPO_ROOT },
  );
  process.stdout.write(stdout);
  return stdout;
}

function runCmd(cmd, args, { env, cwd }) {
  return new Promise((resolveP, rejectP) => {
    const c = spawn(cmd, args, { env, cwd, stdio: 'inherit' });
    c.on('exit', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    c.on('error', rejectP);
  });
}

function runCmdCapture(cmd, args, { env, cwd }) {
  return new Promise((resolveP, rejectP) => {
    const c = spawn(cmd, args, { env, cwd });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    c.stderr.on('data', (b) => {
      stderr += b.toString();
      process.stderr.write(b);
    });
    c.on('exit', (code) => {
      if (code === 0) resolveP({ stdout, stderr });
      else
        rejectP(
          new Error(`${cmd} ${args.join(' ')} exited ${code}\n${stderr}`),
        );
    });
    c.on('error', rejectP);
  });
}

async function main() {
  // Skip migrate-only mode (vd dùng riêng `pnpm verify:deploy:migrate` sau này).
  const env = buildApiEnv();

  await step1MigrateDeploy(env);

  const proc = await step2StartApi(env);
  let exitCode = 0;
  try {
    await step3PollHealth('/healthz', '3/7 /healthz');
    await step3PollHealth('/readyz', '4/7 /readyz');
    await step5VersionCheck();
    const out1 = await step6Bootstrap(env, '6/7 bootstrap (lần 1)');
    if (!/created admin|admin .* đã có/.test(out1)) {
      fatal(
        `Bootstrap lần 1 không match expected stdout. stdout=\n${out1}`,
      );
    }
    const out2 = await step6Bootstrap(env, '7/7 bootstrap (lần 2, idempotent)');
    if (!/đã có|kept|giữ/.test(out2)) {
      fatal(
        `Bootstrap lần 2 KHÔNG idempotent — expected "đã có / kept / giữ" trong stdout. stdout=\n${out2}`,
      );
    }
    if (/created admin/.test(out2) || /\(mới\)/.test(out2)) {
      fatal(
        `Bootstrap lần 2 tạo entity mới — KHÔNG idempotent. stdout=\n${out2}`,
      );
    }
    log('✓ All 7 steps passed. Deploy Verify Gate OPEN.');
  } catch (e) {
    exitCode = 1;
    // eslint-disable-next-line no-console
    console.error(`[verify-deploy] ${e instanceof Error ? e.message : e}`);
  } finally {
    log('Cleanup — kill API process');
    proc.child.kill('SIGTERM');
    await sleep(500);
    if (!proc.child.killed) proc.child.kill('SIGKILL');
  }
  process.exit(exitCode);
}

// noinspection JSUnresolvedFunction
const _ = readJson; // keep import alive for future env-file mode

main().catch((e) => {
  fatal('Unhandled exception in main()', e);
});
