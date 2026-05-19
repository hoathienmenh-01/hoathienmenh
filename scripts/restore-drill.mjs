#!/usr/bin/env node
/**
 * Phase Ops — Restore Drill Script.
 *
 * Automated end-to-end restore drill that:
 *   1. Creates a backup via `scripts/backup-db.sh`
 *   2. Creates a temporary database (xuantoi_drill_<timestamp>)
 *   3. Restores the backup into the temp DB
 *   4. Runs `scripts/verify-restore.sh` against the temp DB
 *   5. Cleans up the temp DB
 *   6. Outputs a structured drill report
 *
 * Safety: KHÔNG bao giờ touch DB gốc. Luôn restore vào temp DB rồi
 * verify + cleanup. Production guard: NODE_ENV=production bị chặn trừ
 * khi DRILL_ALLOW_PRODUCTION=YES.
 *
 * Usage:
 *   node scripts/restore-drill.mjs                          # full drill
 *   node scripts/restore-drill.mjs --dry-run                # show plan only
 *   node scripts/restore-drill.mjs --help                   # show help
 *   DRILL_ALLOW_PRODUCTION=YES node scripts/restore-drill.mjs  # production drill
 *
 * Env vars:
 *   DATABASE_URL            — source DB (default: postgresql://mtt:mtt@localhost:5432/mtt)
 *   DRILL_DATABASE_URL      — override drill target DB (default: derive from DATABASE_URL)
 *   BACKUP_DIR              — backup dir (default: ./backups)
 *   DRILL_ALLOW_PRODUCTION  — YES to allow production drill
 *   USE_DOCKER              — 1 to force docker, 0 for host, auto (default)
 *
 * Exit codes:
 *   0 — all steps pass.
 *   1 — any step fail.
 *   2 — env/config error.
 *   9 — production guard blocked.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

// --- Config ---
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://mtt:mtt@localhost:5432/mtt';
const BACKUP_DIR = process.env.BACKUP_DIR ?? resolve(REPO_ROOT, 'backups');
const USE_DOCKER = process.env.USE_DOCKER ?? 'auto';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const DRILL_ALLOW_PRODUCTION = process.env.DRILL_ALLOW_PRODUCTION ?? '';
const TIMESTAMP = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
const DRILL_DB_NAME = `xuantoi_drill_${TIMESTAMP}`;

const BACKUP_SCRIPT = resolve(REPO_ROOT, 'scripts', 'backup-db.sh');
const VERIFY_SCRIPT = resolve(REPO_ROOT, 'scripts', 'verify-restore.sh');

// --- Helpers ---
function maskUrl(url) {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

function log(msg) {
  console.log(msg);
}

function logStep(step, msg) {
  console.log(`[restore-drill] Step ${step}: ${msg}`);
}

function logResult(step, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[restore-drill] Step ${step}: ${mark}${detail ? ' — ' + detail : ''}`);
}

/**
 * Spawn a script with env, capture output, return { exitCode, stdout, stderr }.
 * Same pattern as BackupService.scriptRunner.
 */
function runScript(scriptPath, env = {}, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const CAP = 16 * 1024;

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < CAP) stdout += chunk.toString().slice(0, CAP - stdout.length);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < CAP) stderr += chunk.toString().slice(0, CAP - stderr.length);
    });

    let resolved = false;
    const finish = (code) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode: code, stdout, stderr });
    };

    const tid = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* noop */ }
      finish(-1);
    }, timeoutMs);

    child.on('close', (code) => { clearTimeout(tid); finish(code ?? -1); });
    child.on('error', (err) => { clearTimeout(tid); stderr += `\nspawn error: ${err.message}`; finish(-1); });
  });
}

/**
 * Run a psql command. Returns { exitCode, stdout }.
 */
function runPsql(sql, targetUrl, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const child = spawn('psql', [targetUrl, '-t', '-A', '-c', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });

    let resolved = false;
    const finish = (code) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() });
    };

    const tid = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* noop */ }
      finish(-1);
    }, timeoutMs);

    child.on('close', (code) => { clearTimeout(tid); finish(code ?? -1); });
    child.on('error', () => { clearTimeout(tid); finish(-1); });
  });
}

// --- Parse args ---
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isHelp = args.includes('--help') || args.includes('-h');

if (isHelp) {
  console.log(`
restore-drill.mjs — Automated restore drill

Usage:
  node scripts/restore-drill.mjs                    # full drill
  node scripts/restore-drill.mjs --dry-run          # show plan only
  node scripts/restore-drill.mjs --help             # this message

Env vars:
  DATABASE_URL              Source DB (default: postgresql://mtt:mtt@localhost:5432/mtt)
  DRILL_DATABASE_URL        Override drill target DB (default: derived from DATABASE_URL)
  BACKUP_DIR                Backup directory (default: ./backups)
  DRILL_ALLOW_PRODUCTION    Set YES to allow production drill
  USE_DOCKER                1 = force docker, 0 = host, auto = detect (default)

Steps:
  1. Backup current DB
  2. Create temp DB (${DRILL_DB_NAME})
  3. Restore backup into temp DB
  4. Verify temp DB (schema + critical tables)
  5. Cleanup temp DB
  6. Output drill report
`);
  process.exit(0);
}

// --- Main ---
async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    databaseUrl: maskUrl(DATABASE_URL),
    drillDbName: DRILL_DB_NAME,
    steps: [],
    overallPass: true,
  };

  function addStep(name, ok, durationMs, detail = '') {
    report.steps.push({ name, ok, durationMs: Math.round(durationMs), detail });
    if (!ok) report.overallPass = false;
  }

  // Production guard
  if (NODE_ENV === 'production' && DRILL_ALLOW_PRODUCTION !== 'YES') {
    log('[restore-drill] BLOCKED: NODE_ENV=production and DRILL_ALLOW_PRODUCTION != YES');
    log('[restore-drill] Set DRILL_ALLOW_PRODUCTION=YES to allow production drill.');
    process.exit(9);
  }

  // Derive admin URL for CREATE/DROP DATABASE
  const dbPath = DATABASE_URL.split('/').pop();
  const dbName = dbPath.split('?')[0];
  const adminUrl = DATABASE_URL.replace(`/${dbName}`, '/postgres');

  log('========================================');
  log('  Restore Drill — Xuân Tôi');
  log('========================================');
  log(`[restore-drill] Source DB: ${maskUrl(DATABASE_URL)}`);
  log(`[restore-drill] Drill DB: ${DRILL_DB_NAME}`);
  log(`[restore-drill] Strategy: ${USE_DOCKER === '1' ? 'docker exec' : USE_DOCKER === '0' ? 'host psql' : 'auto-detect'}`);
  log(`[restore-drill] Mode: ${isDryRun ? 'DRY RUN' : 'FULL DRILL'}`);
  log('');

  if (isDryRun) {
    log('[restore-drill] DRY RUN — would execute:');
    log(`  1. bash ${BACKUP_SCRIPT}  (backup current DB)`);
    log(`  2. psql ${maskUrl(adminUrl)} -c "CREATE DATABASE ${DRILL_DB_NAME}"`);
    log(`  3. bash ${resolve(REPO_ROOT, 'scripts', 'restore-db.sh')} <backup-file>  (restore into ${DRILL_DB_NAME})`);
    log(`  4. bash ${VERIFY_SCRIPT}  (verify ${DRILL_DB_NAME})`);
    log(`  5. psql ${maskUrl(adminUrl)} -c "DROP DATABASE IF EXISTS ${DRILL_DB_NAME}"`);
    log('');
    log('[restore-drill] No changes made. Exit 0.');
    process.exit(0);
  }

  // Step 1: Backup
  logStep(1, 'Creating backup...');
  let t0 = Date.now();
  const backupResult = await runScript(BACKUP_SCRIPT, {
    BACKUP_DIR,
    BACKUP_RETENTION_DAYS: '0',
  });
  let dt = Date.now() - t0;
  addStep('backup', backupResult.exitCode === 0, dt,
    backupResult.exitCode === 0 ? 'backup created' : `exit=${backupResult.exitCode}`);

  if (backupResult.exitCode !== 0) {
    log(backupResult.stderr || backupResult.stdout);
    log('[restore-drill] ABORT: backup failed, cannot proceed with drill.');
    printReport(report);
    process.exit(1);
  }

  // Extract backup file path from output
  const doneMatch = backupResult.stdout.match(/\[backup-db\] Done: (\S+)/);
  const backupFile = doneMatch ? doneMatch[1] : null;
  if (!backupFile) {
    log('[restore-drill] WARN: could not parse backup file path from output');
    log(backupResult.stdout);
    addStep('parse-backup-path', false, 0, 'could not extract file path');
    printReport(report);
    process.exit(1);
  }
  log(`[restore-drill] Backup file: ${backupFile}`);

  // Step 2: Create temp database
  logStep(2, `Creating temp database "${DRILL_DB_NAME}"...`);
  t0 = Date.now();
  const createResult = await runPsql(`CREATE DATABASE "${DRILL_DB_NAME}";`, adminUrl);
  dt = Date.now() - t0;
  addStep('create-temp-db', createResult.exitCode === 0, dt,
    createResult.exitCode === 0 ? `created ${DRILL_DB_NAME}` : createResult.stderr);

  if (createResult.exitCode !== 0) {
    log(createResult.stderr);
    log('[restore-drill] ABORT: cannot create temp DB.');
    printReport(report);
    process.exit(1);
  }

  // Step 3: Restore backup into temp DB
  logStep(3, `Restoring backup into "${DRILL_DB_NAME}"...`);
  t0 = Date.now();
  const tempDbUrl = DATABASE_URL.replace(`/${dbName}`, `/${DRILL_DB_NAME}`);
  const restoreResult = await new Promise((resolve) => {
    const child = spawn('bash', ['-c', `gunzip -c "${backupFile}" | psql "${tempDbUrl}" --quiet`], {
      env: {
        ...process.env,
        DATABASE_URL: tempDbUrl,
        CONFIRM_RESTORE: 'YES',
        ALLOW_PRODUCTION_RESTORE: 'YES',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
    child.on('error', (err) => resolve({ exitCode: -1, stdout, stderr: err.message }));
  });
  dt = Date.now() - t0;
  addStep('restore', restoreResult.exitCode === 0, dt,
    restoreResult.exitCode === 0 ? 'restore complete' : `exit=${restoreResult.exitCode}`);

  if (restoreResult.exitCode !== 0) {
    log(restoreResult.stderr || restoreResult.stdout);
    log('[restore-drill] WARN: restore failed. Will still attempt verify + cleanup.');
  }

  // Step 4: Verify
  logStep(4, `Verifying "${DRILL_DB_NAME}"...`);
  t0 = Date.now();
  const verifyResult = await runScript(VERIFY_SCRIPT, {
    DATABASE_URL: tempDbUrl,
    USE_DOCKER,
    STRICT: '0',
  });
  dt = Date.now() - t0;
  addStep('verify', verifyResult.exitCode === 0, dt,
    verifyResult.exitCode === 0 ? 'schema + tables OK' : `exit=${verifyResult.exitCode}`);

  if (verifyResult.exitCode !== 0) {
    log(verifyResult.stderr || verifyResult.stdout);
  }

  // Step 5: Cleanup temp DB
  logStep(5, `Dropping temp database "${DRILL_DB_NAME}"...`);
  t0 = Date.now();
  // Terminate any lingering connections first
  await runPsql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DRILL_DB_NAME}' AND pid <> pg_backend_pid();`,
    adminUrl,
  );
  const dropResult = await runPsql(`DROP DATABASE IF EXISTS "${DRILL_DB_NAME}";`, adminUrl);
  dt = Date.now() - t0;
  addStep('cleanup', dropResult.exitCode === 0, dt,
    dropResult.exitCode === 0 ? `dropped ${DRILL_DB_NAME}` : dropResult.stderr);

  // Report
  log('');
  printReport(report);
  process.exit(report.overallPass ? 0 : 1);
}

function printReport(report) {
  log('========================================');
  log('  Restore Drill Report');
  log('========================================');
  log(`  Timestamp:  ${report.timestamp}`);
  log(`  Source DB:  ${report.databaseUrl}`);
  log(`  Drill DB:   ${report.drillDbName}`);
  log('');
  for (const step of report.steps) {
    const mark = step.ok ? 'PASS' : 'FAIL';
    const dur = step.durationMs > 0 ? ` (${(step.durationMs / 1000).toFixed(1)}s)` : '';
    log(`  [${mark}] ${step.name}${dur}${step.detail ? ' — ' + step.detail : ''}`);
  }
  log('');
  const totalMs = report.steps.reduce((s, r) => s + r.durationMs, 0);
  log(`  Overall: ${report.overallPass ? 'PASS' : 'FAIL'} (${(totalMs / 1000).toFixed(1)}s total)`);
  log('========================================');
}

main().catch((err) => {
  console.error('[restore-drill] Unexpected error:', err);
  process.exit(1);
});
