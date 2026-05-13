#!/usr/bin/env node
/**
 * Phase 43 — Health endpoints smoke test.
 *
 * Verify production-readiness của Health module (Phase 18.1 + Phase 43
 * alias):
 *
 *   1. `GET /api/healthz`         — legacy liveness; trả 200 + ok=true.
 *   2. `GET /api/readyz`          — legacy readiness; trả 200 + ok=true.
 *   3. `GET /api/version`         — legacy version; trả name=@xuantoi/api.
 *   4. `GET /api/health`          — Phase 43 light alias; status=ok.
 *   5. `GET /api/health/db`       — DB probe; status=ok|degraded.
 *   6. `GET /api/health/redis`    — Redis probe; status=ok|degraded.
 *   7. `GET /api/health/version`  — alias /version; name=@xuantoi/api.
 *   8. `GET /api/health/full`     — aggregated; status=ok khi DB+Redis ok.
 *
 * Pattern theo `scripts/smoke-auth.mjs`:
 *   - BASE qua `SMOKE_API_BASE` (default http://localhost:3000).
 *   - Hard cap timeout `SMOKE_TIMEOUT_MS` (default 10s) cho mỗi call.
 *   - Exit code 0 = pass, 1 = fail (assertion / network / timeout).
 *
 * KHÔNG cần auth — health endpoints public + `@SkipRateLimit()`.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';

let failures = 0;
let total = 0;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function verbose(msg) {
  if (VERBOSE) log(msg);
}

async function fetchJson(path, expectedStatuses = [200]) {
  total += 1;
  const url = `${BASE}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ok = expectedStatuses.includes(res.status);
    let body = null;
    try {
      body = await res.json();
    } catch {
      // ignore: not JSON
    }
    verbose(`[smoke:health] ${path} → ${res.status} ${JSON.stringify(body)}`);
    if (!ok) {
      failures += 1;
      log(
        `[smoke:health] FAIL ${path} expected ${expectedStatuses.join('|')} got ${res.status}`,
      );
      return { res, body, ok: false };
    }
    return { res, body, ok: true };
  } catch (e) {
    failures += 1;
    log(
      `[smoke:health] FAIL ${path} network/timeout: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { res: null, body: null, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function assert(cond, msg) {
  total += 1;
  if (!cond) {
    failures += 1;
    log(`[smoke:health] FAIL ${msg}`);
  } else {
    verbose(`[smoke:health] PASS ${msg}`);
  }
}

async function main() {
  log(`[smoke:health] BASE=${BASE} TIMEOUT_MS=${TIMEOUT_MS}`);

  // 1. /api/healthz (legacy liveness)
  {
    const { body, ok } = await fetchJson('/api/healthz');
    if (ok) assert(body?.ok === true, 'healthz body.ok=true');
  }

  // 2. /api/readyz — DB+Redis must be reachable in CI / dev infra.
  //    Accept 200 (ok) hoặc 503 (degraded) cho dev local không có DB.
  {
    const { body, ok } = await fetchJson('/api/readyz', [200, 503]);
    if (ok) {
      assert(typeof body?.checks === 'object', 'readyz body.checks present');
      assert('db' in (body?.checks ?? {}), 'readyz body.checks.db present');
      assert('redis' in (body?.checks ?? {}), 'readyz body.checks.redis present');
    }
  }

  // 3. /api/version
  {
    const { body, ok } = await fetchJson('/api/version');
    if (ok) {
      assert(body?.name === '@xuantoi/api', 'version body.name=@xuantoi/api');
      assert(typeof body?.node === 'string', 'version body.node present');
      // Security: KHÔNG được lộ env / secret string nào.
      const raw = JSON.stringify(body ?? {});
      assert(!/secret/i.test(raw), 'version không leak chuỗi "secret"');
      assert(!/password/i.test(raw), 'version không leak chuỗi "password"');
    }
  }

  // 4. /api/health (Phase 43 light alias)
  {
    const { body, ok } = await fetchJson('/api/health');
    if (ok) {
      assert(body?.status === 'ok', 'health body.status=ok');
      assert(
        body?.serviceName === 'xuantoi-api',
        'health body.serviceName=xuantoi-api',
      );
      assert(
        typeof body?.uptimeSeconds === 'number',
        'health body.uptimeSeconds is number',
      );
    }
  }

  // 5. /api/health/db
  {
    const { body, ok } = await fetchJson('/api/health/db', [200, 503]);
    if (ok) {
      assert(
        ['ok', 'degraded', 'down'].includes(body?.status),
        'health/db status in {ok,degraded,down}',
      );
    }
  }

  // 6. /api/health/redis
  {
    const { body, ok } = await fetchJson('/api/health/redis', [200, 503]);
    if (ok) {
      assert(
        ['ok', 'degraded', 'down'].includes(body?.status),
        'health/redis status in {ok,degraded,down}',
      );
    }
  }

  // 7. /api/health/version
  {
    const { body, ok } = await fetchJson('/api/health/version');
    if (ok) {
      assert(
        body?.name === '@xuantoi/api',
        'health/version body.name=@xuantoi/api',
      );
    }
  }

  // 8. /api/health/full
  {
    const { body, ok } = await fetchJson('/api/health/full', [200, 503]);
    if (ok) {
      assert(
        ['ok', 'degraded', 'down'].includes(body?.status),
        'health/full status in {ok,degraded,down}',
      );
      assert(
        body?.checks?.db && body?.checks?.redis,
        'health/full checks.db + checks.redis present',
      );
      // Security: KHÔNG lộ secret/env.
      const raw = JSON.stringify(body ?? {});
      assert(!/postgresql:\/\//i.test(raw), 'health/full không leak postgresql://');
      assert(!/JWT_/i.test(raw), 'health/full không leak JWT_*');
    }
  }

  log(`[smoke:health] DONE total=${total} failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[smoke:health] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
