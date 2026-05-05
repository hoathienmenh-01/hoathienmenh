# AI Workflow Rules — Xuân Tôi

> AI/dev mới: file này định nghĩa **các luật bắt buộc** khi viết PR cho Xuân Tôi. Đọc cùng với [`START_HERE.md`](./START_HERE.md) trước khi viết PR đầu tiên. Nếu luật ở đây mâu thuẫn với hướng dẫn cũ trong các doc khác, file này thắng.

Các luật chung (server-authoritative gameplay, ledger, idempotency, không push thẳng main, không merge khi CI đỏ, etc.) đã có ở các doc khác (`GAME_DESIGN_BIBLE.md`, `ECONOMY_MODEL.md`, `AI_HANDOFF_REPORT.md`). File này tập trung vào **delivery / scope rules** — cách chia PR, cách gom việc, cách không tạo micro-PR vô nghĩa.

**Mode**: Fast but Safe Delivery Mode. Các luật workflow bên dưới là một bộ nhất quán và phải được áp dụng cùng nhau.

---

## UI MODULE RULE

Một UI page/view/module phải làm trọn trong 1 PR nếu cùng một chức năng.

Một UI PR nên bao gồm:

- API client nếu cần.
- Store/state nếu cần.
- View/component.
- Loading state.
- Empty state.
- Error state.
- Filter/search nếu thuộc cùng view.
- Pagination nếu thuộc cùng view.
- Stats/summary card nếu thuộc cùng view.
- i18n key.
- Unit/render test hoặc Playwright smoke nếu phù hợp.
- Cập nhật `docs/AI_HANDOFF_REPORT.md` trong cùng PR.

Không tách riêng pagination/filter/stats thành nhiều PR nếu chúng thuộc cùng một màn hình.

### Ví dụ đúng

- `feat(tribulation): complete history UI`
  gồm list + filter + pagination + stats + loading/empty/error + i18n + tests + docs.

### Ví dụ sai

- PR 1: add pagination
- PR 2: add filter
- PR 3: add stats
- PR 4: docs sync

### Ngoại lệ hợp lệ

- Backend endpoint phụ trợ (ví dụ `GET /character/tribulation/log` trước khi UI consume) **được phép** tách thành PR backend riêng nếu UI chưa tồn tại — đây không phải micro-PR cùng màn hình, mà là chia tầng API ↔ UI.
- Refactor/rewrite một view có sẵn vì lý do kỹ thuật (vd thay framework component, tách layout) cũng được phép tách khỏi feature mới.
- Nếu một UI module quá lớn (> ~600 dòng diff thực sự, không tính generated/i18n/test fixture), được phép chia theo tầng (vd PR 1 = list + loading/empty/error baseline; PR 2 = filter + pagination + stats). Trong trường hợp này, PR đầu phải ghi rõ trong body **roadmap PR tiếp theo** + **TODO marker trong code** để không bị quên.
- Hotfix sau khi UI đã merge (vd a11y label thiếu, lỗi i18n) đương nhiên là PR riêng — đây không phải micro-feature, là bug fix.

### Khi review PR UI

Reviewer (AI hoặc người) phải reject PR nếu:

- Một view chỉ thêm pagination, không có loading state / empty state / error state đi kèm (trừ khi pagination là enhancement của view đã có sẵn loading/empty/error).
- PR title gợi ý micro-scope kiểu `feat(view): add pagination only` mà view đó còn thiếu filter/stats trong cùng phase và phase đó đã có endpoint backend support.
- Filter/pagination/stats được tách thành nhiều PR liên tiếp cùng touch một file `*View.vue` / một Pinia store.

---

## DOCS UPDATE RULE

Mọi task/feature/bugfix phải cập nhật `docs/AI_HANDOFF_REPORT.md` **trong cùng PR với code**. Không mở PR riêng chỉ để sync docs.

### Bắt buộc trong cùng PR

- `docs/AI_HANDOFF_REPORT.md` — Executive Summary (main commit, this-PR description) + snapshot mới ở đầu `## Snapshots` + Recent Changes block.
- Doc chuyên biệt nếu task đụng phạm vi tương ứng:
  - `docs/CONTENT_PIPELINE.md` — khi thêm content (item / skill / monster / dungeon / mission / boss / quest / event / title / achievement).
  - `docs/BALANCE_MODEL.md` — khi đổi số (curve / drop weight / stat budget / cost).
  - `docs/ECONOMY_MODEL.md` — khi đụng currency / item / reward / ledger / idempotency.
  - `docs/LIVE_OPS_MODEL.md` — khi đụng event / season / feature flag / maintenance.
  - `docs/QA_CHECKLIST.md` — khi thêm flow QA cần manual smoke trước release.
  - `docs/RUN_LOCAL.md` — khi đổi local setup, env var, port, infra.
  - `docs/API.md` — khi thêm/đổi route REST hoặc WS event.
  - `docs/CHANGELOG.md` — khi PR đáng vào version note (catch-up có thể batch nhiều PR).

### Ngoại lệ hợp lệ (PR docs riêng)

- **Audit lệch main**: handoff report nói "Pending merge" nhưng đã merged, hoặc nói "Done" nhưng chưa vào main → cần audit cleanup.
- **PR/branch merge nhầm/obsolete**: cần ghi rõ trạng thái thật, không chuyển task khi handoff sai.
- **Docs conflict lớn** sau rebase nhiều PR cùng đụng `AI_HANDOFF_REPORT.md` → resolve trong PR docs riêng cho rõ.
- **Workflow rules update** (file này, START_HERE, QA_CHECKLIST, CONTENT_PIPELINE) — không gắn với code task cụ thể.
- **CHANGELOG catch-up** batch nhiều PR đã merge — không gắn với code.

### Anti-pattern bị reject

- Mở `docs(audit): sync handoff` ngay sau mỗi `feat(...)` PR. Sync handoff phải nằm trong cùng PR feat.
- Quên handoff trong PR feat rồi báo "sẽ sync sau" → reviewer phải reject hoặc force update trước khi merge.

---

## HANDOFF REPORT STRUCTURE RULE

`docs/AI_HANDOFF_REPORT.md` là snapshot trạng thái thật. AI mới phải đọc `## Current Executive Summary` (30 dòng đầu) là đủ context. **Nếu Executive Summary > 30 dòng, AI tiếp theo bị nghẽn.**

### Executive Summary (~30 dòng tối đa)

Bắt buộc có (theo thứ tự):

1. **Current `main` commit** + tên PR cuối cùng đã merge.
2. **Current phase** (vd `Phase 11.10 Achievement runtime`, `Phase 11.6 Tribulation runtime`).
3. **Test baseline** (vd `2973 vitest: 1431 api + 954 shared + 588 web; 16 Playwright golden path; CI 5/5 GREEN`).
4. **Open PR / pending branch** (1-2 dòng mỗi cái: số PR, scope, blocker nếu có).
5. **3-5 task tiếp theo** ngắn gọn (link `Recommended Next Roadmap` để chi tiết).
6. **Critical/High issues** nếu có (P0/P1 bug, regression, blocker production-readiness).
7. **Blocker** nếu có (vd thiếu credential, infra fail, quyết định thiết kế cần user).

KHÔNG nhồi mọi thứ vào dòng đầu tiên. KHÔNG paste 2000-char block "this PR is in-flight" nhiều layer lồng nhau.

### Recent Changes (5-10 PR gần nhất)

Giữ tối đa 5-10 PR gần nhất. Mỗi entry:

- PR number + link.
- Branch.
- Phase / scope.
- Files chính.
- CI status.
- Risk note 1 dòng.

PR cũ hơn 10 (hoặc cũ hơn 1 phase) → đưa xuống `## Recent Changes — Archive` hoặc tóm tắt theo phase trong `## Snapshots`.

### Snapshots (chi tiết theo session)

Vẫn append mới ở đầu. Mỗi snapshot ~5-15 dòng cho 1 PR. Snapshot cho PR > 1 tháng tuổi nên được đẩy xuống `## Snapshots — Archive` (hoặc tóm tắt theo phase) khi handoff bị quá dài.

### Khi nào compact

Compact **bắt buộc** khi bất kỳ điều kiện nào dưới đây xảy ra:

- Executive Summary > 30 dòng.
- Recent Changes > 10 entries.
- **Total `AI_HANDOFF_REPORT.md` > 250 dòng** (cap cứng — siết từ 3000 dòng xuống 250 dòng từ 2026-05-05 sau audit thấy file 217 dòng đã chật + AI session đọc chậm). Đẩy entry cũ + section archive-worthy (phase summary table, smoke per-module detail, completed feature snapshot) sang [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) ngay.

`AI_HANDOFF_REPORT.md` chỉ chứa **trạng thái live hiện tại**:

1. Current Executive Summary (≤ 30 dòng).
2. Recent Changes (5–10 PR gần nhất).
3. Current Phase Status.
4. Open PR / pending branch (nếu có).
5. Known Issues / Risks (live only — Resolved cũ → archive).
6. Tests / CI / Smoke / E2E status hiện tại.
7. Recommended Next Roadmap.
8. Link tới `ARCHIVE_HANDOFF.md`.

Compact KHÔNG xóa thông tin quan trọng. Phải:

- Tóm tắt theo phase (vd "Phase 11.10.A→G: AchievementService runtime + 4 catalog achievement BREAKTHROUGH track wired qua CharacterService/TribulationService/CultivationProcessor — PR #320..#339").
- Giữ link tới PR cụ thể nếu có thông tin riêng (vd DI cycle fix PR #339).
- Đẩy xuống [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md), không xóa.

### Archive phải nằm file riêng

**Archive section PHẢI nằm trong file riêng [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md), KHÔNG inline trong `AI_HANDOFF_REPORT.md`.** Tách từ 2026-05-05. Lý do: AI session tiêu tốn ít token/quota hơn khi chỉ đọc file live `AI_HANDOFF_REPORT.md` (≤ 250 dòng) thay vì phải load toàn bộ file gộp (~5000+ dòng). Khi compact:

- Move mọi snapshot/PR/section lịch sử sang `ARCHIVE_HANDOFF.md`.
- Trong `AI_HANDOFF_REPORT.md` chỉ giữ placeholder `## 7. Archive (đã tách file riêng)` + 1 dòng link tham chiếu tới `ARCHIVE_HANDOFF.md`.
- KHÔNG dump lại Archive content vào `<details>` collapsibles inline file live.

ARCHIVE header bắt buộc (xem `ARCHIVE_HANDOFF.md` line 1-9):

```
# Archive — AI Handoff Report History

> File này chứa lịch sử PR cũ. AI KHÔNG cần đọc file này mỗi session — chỉ tra cứu khi cần điều tra PR/history cụ thể.
```

### Docs-only PR — khi nào hợp lệ

Docs-only PR (không kèm code change) **chỉ được mở khi**:

- Handoff lệch nặng so với code trên `main` (vd snapshot bị stale 2-3 phase, PR đã merged nhưng chưa note).
- File `AI_HANDOFF_REPORT.md` vượt cap 250 dòng → phải compact ngay.
- Đầu session cần dọn trạng thái nhưng task chính chưa rõ scope.
- Setup bộ docs mới (vd story bible, beta checklist, balance model setup) không gắn được với feature PR cụ thể.
- Compact docs (chia file dài thành ARCHIVE, refactor START_HERE thành task-based nav, etc.).

**Mọi docs sync bình thường** (cập nhật handoff sau khi merge feat/fix, cập nhật PHASE12_STORY_PROGRESS sau merge story PR, cập nhật CHANGELOG/RELEASE_NOTES) PHẢI nằm trong cùng PR feature — KHÔNG tách thành docs-only PR sync. Đây là một phần của DOCS UPDATE RULE: handoff sync = mandatory deliverable của mỗi PR feat/fix.

---

## TEST FAST PATH RULE

Test theo **scope**. Không chạy thừa, nhưng không fake green.

### Docs-only

- Lint markdown nếu repo có `.markdownlint*` config (hiện tại repo KHÔNG có → skip).
- KHÔNG cần `pnpm test` / `pnpm build` local nếu không đụng code.
- KHÔNG tắt CI. Dù docs-only, CI `build` + `e2e-smoke` vẫn chạy (vì `ci.yml` không có path filter) — phải chờ xanh trước khi báo Done.

### FE-only (apps/web/)

```bash
pnpm --filter @xuantoi/web test       # vitest (web 588+ baseline)
pnpm --filter @xuantoi/web build      # vue-tsc + vite build
```

E2E nếu đụng flow quan trọng (`/auth`, `/onboarding`, `/home`, `/missions`, `/inventory`, `/dungeon`, `/mail`, `/settings`):

```bash
pnpm --filter @xuantoi/web e2e        # Playwright smoke (vite preview)
# E2E_FULL=1 pnpm --filter @xuantoi/web e2e   # full-stack 16 spec, cần api+pg+redis up
```

### Shared catalog-only (packages/shared/)

```bash
pnpm --filter @xuantoi/shared test    # vitest (954+ baseline)
pnpm --filter @xuantoi/shared build   # tsup
```

### API runtime (apps/api/)

```bash
pnpm --filter @xuantoi/api test       # vitest --passWithNoTests (1431+ baseline)
pnpm --filter @xuantoi/api build      # nest build
```

### Prisma / economy / inventory / reward / ledger / cross-module

```bash
pnpm typecheck      # cả 3 package
pnpm lint           # cả 3 package, max-warnings 0
pnpm test           # cả 3 package
pnpm build          # cả 3 package
# + smoke nếu task đụng:
pnpm smoke:economy
pnpm smoke:ws
pnpm smoke:admin
pnpm smoke:combat
pnpm smoke:beta
```

Nếu task đụng schema Prisma: BẮT BUỘC chạy migration test (`pnpm --filter @xuantoi/api prisma migrate dev --name <desc>` local rồi rollback) + verify CI `Apply migrations` step pass.

### Quy tắc chung

- KHÔNG tắt test cũ.
- KHÔNG skip test cũ.
- KHÔNG fake green (vd dùng `it.skip`, `expect.assertions(0)` để bypass).
- CI đỏ thì KHÔNG báo Done; phải debug trong cùng PR cho đến xanh, hoặc revert nếu blocker > 3 lần fix.

---

## BATCHING RULE

Có thể gom task nhỏ độc lập, rủi ro thấp, cùng loại để tiết kiệm CI round + review attention.

### Được gom

- 2-3 FE-only polish task (vd thêm i18n key cho 3 view không liên quan trực tiếp).
- Một view hoàn chỉnh gồm list + filter + pagination + stats (đây là UI MODULE RULE).
- Catalog content cùng loại (vd 5 item tier `huyen` Mộc element).
- Tests cùng module (vd thêm 4 vitest fixtures cho `mission.service.test.ts`).
- Docs catch-up multiple PR cũ vào CHANGELOG.

### KHÔNG được gom

- Prisma migration + UI lớn + economy thay đổi trong cùng PR.
- Combat runtime + payment/topup + refactor.
- Nhiều module không liên quan (vd `feat(combat,topup,mail,gem,refine,gacha): misc fixes` — reject).
- Bug fix critical + feature mới (bug fix phải merge nhanh, không chờ feature review).

### PR size khuyến nghị

| Mode | Files | LOC diff | Ví dụ |
|---|---|---|---|
| **Hotfix** | 1-5 | < 200 | bug fix, security, CI red, regression revert. |
| **Medium** | 5-20 | 200-1200 | 1 view UI hoàn chỉnh, 1 service runtime + tests, 1 catalog pack. |
| **Large** | 20-35 | tối đa 1800 | chỉ khi cùng module + có test rõ + có justify trong PR body. |

> Đừng cố ép PR ≥ 200 dòng để được "Medium". Hotfix 30 dòng mà fix CI đỏ là hợp lệ và quý hơn 1 Medium giả tạo.

---

## SAFETY CORRECTION RULE

Đây là layer chống diễn dịch sai các luật bên trên.

### Không ép cứng minimum 100 dòng diff

- Hotfix nhỏ 10-100 dòng vẫn hợp lệ nếu sửa bug / CI / security / regression / docs sai nghiêm trọng.
- Đừng nhồi diff giả (refactor không cần thiết, comment thừa, đổi tên biến) chỉ để PR "trông to hơn".

### Docs-only KHÔNG cần full test local

- Nhưng KHÔNG được tắt CI. CI sẽ chạy `build` + `e2e-smoke` dù docs-only — phải chờ xanh.
- Nếu CI fail vì lý do flaky không liên quan docs → restart job, không skip.

### Phạm vi test phải tương xứng risk

- Shared / API / Prisma / economy / inventory / reward → test kỹ hơn (full `pnpm test` + smoke).
- Docs / FE polish → test fast path là đủ.
- Đụng ledger / idempotency / authority server → BẮT BUỘC unit test mới + integration test pass + smoke pass + manual verify nếu khả thi.

### Trước khi báo Done

- CI xanh hoặc Pending CI rõ ràng (đã push, chưa polled).
- Nếu CI chưa xanh, KHÔNG chuyển task khác.
- Nếu CI đỏ > 3 lần fix → block trên user, không tự ép merge.

### Không bao giờ làm

- KHÔNG push thẳng main.
- KHÔNG force push vào branch của session khác đang làm việc.
- KHÔNG xóa data thật, không reset DB production.
- KHÔNG commit secret / token / `.env` thật.
- KHÔNG tắt test/CI để qua phase.
- KHÔNG fake test pass (`expect(true).toBe(true)` hoặc `it.skip` cho test cũ).
- KHÔNG `--no-verify` skip hook.
- KHÔNG amend commit cũ trên branch đã share (push commit mới).

---

## SPEED TARGET

Mỗi session cố gắng hoàn thành **một trong các đầu ra** sau:

- 1 Medium Feature PR xanh (5-20 file, 200-1200 dòng), HOẶC
- 2-3 Hotfix / Test PR xanh (mỗi cái 1-5 file), HOẶC
- 1 audit cleanup PR + 1 feature PR nếu handoff bị lệch.

Nếu một session **chỉ làm docs sync** mà không có blocker thật (ie. handoff không lệch), coi là chưa đạt mục tiêu tốc độ — phải rút ngắn docs sync và pickup task code/feature/test thực sự.

> Speed target không phải KPI cứng. Là mục tiêu định hướng. Session nhỏ, blocker nhiều, hoặc credit ít → vẫn hợp lệ nếu PR nào cũng xanh và an toàn. Đừng đánh đổi an toàn lấy tốc độ.

---

## SESSION PR LIMIT

Mỗi session ưu tiên **1–3 PR chất lượng cao**, không phải tối đa hoá số PR. Mục tiêu: giảm micro-PR spam, giảm CI overhead, giữ review attention tập trung vào diff có giá trị.

### Quota mặc định mỗi session

- **Tối đa 3 PR** nếu không có lý do rõ ràng. Chia điển hình:
  - **1 Medium feature/runtime PR** (5-20 file, 200-1200 LOC) — đầu ra chính của session.
  - **1 Medium test/smoke batch PR** nếu có nhiều test cùng loại đang chờ (vd 3-5 smoke script gameplay module, 3-5 vitest cùng service). Gom vào 1 PR thay vì mở từng PR riêng.
  - **1 Hotfix PR** chỉ khi có lý do thật: CI đỏ trên main / bug critical / security / regression / docs sai nghiêm trọng. KHÔNG dùng slot Hotfix cho enhancement nhỏ.
- **Nếu task còn lại đều cùng loại** (vd còn 5 smoke script chưa cover module nhỏ, hoặc 4 i18n key cùng view), **gom hết vào 1 PR**, không tách 5 PR.
- **Nếu cần PR thứ 4 trở lên**, BẮT BUỘC giải thích trong PR body lý do vì sao không gom được vào 3 PR trước đó (vd: blocker cross-module bắt buộc tách, đụng Prisma migration phải tách layer, hotfix CI đỏ phải merge nhanh trước feature).

### Anti-pattern bị reject

- Mở 14 PR liên tiếp, mỗi PR 1 smoke script cùng pattern (vd PR #371..#385 mỗi PR cover 1 module gameplay) → đáng lẽ gom 3-5 module / batch.
- Mở 3-4 PR cùng kiểu "thêm 1 i18n key" / "thêm 1 stats card" / "thêm 1 filter" cho nhiều view khác nhau → batch theo BATCHING RULE.
- Mở PR thứ 4-5 trong cùng session mà không có 1 dòng justification trong PR body.

### Khi 1 PR là đủ

Nếu trong 1 session bạn chỉ kịp 1 Medium PR xanh, **đó là kết quả hợp lệ và tốt** — không cần ép thêm Hotfix giả tạo cho đủ quota. Quota là **giới hạn trên**, không phải target.

---

## NEXT TASK AUTO-SELECTION

Sau khi PR hiện tại CI xanh và an toàn:

1. **KHÔNG hỏi user** nếu còn task an toàn (trừ khi user đã ra lệnh "đợi tôi" — explicit instruction overrides).
2. Đọc `docs/AI_HANDOFF_REPORT.md` `## Current Executive Summary` + `## 20. Recommended Next Roadmap`.
3. Chọn task **giá trị cao nhất** + **an toàn** tiếp theo:
   - CI/test đỏ trên main → ưu tiên cao nhất.
   - Critical/High bug trong handoff → ưu tiên thứ hai.
   - Open PR/pending branch cần fix → take-over.
   - Task phase hiện tại trong roadmap → pick.
4. **Ưu tiên Medium PR thay vì micro-PR** khi có thể gom (xem BATCHING RULE).
4b. **GOM TRƯỚC KHI TÁCH** — sau khi xong 1 task, TRƯỚC khi mở PR mới, kiểm tra task tiếp theo có **cùng loại** với PR hiện tại không.
   - Nếu **có**, thêm commit vào PR hiện tại. **KHÔNG mở PR mới.**
   - **KHÔNG mở PR mới** cho từng smoke script, từng i18n key nhỏ, từng pagination/filter/stats nhỏ — gom vào PR hiện tại.
   - Chỉ tách PR mới khi: (a) đổi loại task (vd smoke → feature runtime), (b) đụng rủi ro cao (Prisma migration / economy / cross-module), hoặc (c) PR hiện tại đã gần ngưỡng tối đa khoảng **1200 LOC** (Medium ceiling per BATCHING RULE).
   - **KHÔNG ép PR phải đạt 1200 LOC** — đó là ngưỡng tối đa, không phải target. Một Medium PR 400 LOC xanh + an toàn hợp lệ hơn 1200 LOC nhồi diff giả.
   - **Cùng loại** (gom được): smoke + smoke, catalog + catalog, i18n + i18n, balance test + balance test, UI polish + UI polish.
   - **Khác loại** (phải tách): smoke → feature runtime, catalog → Prisma migration, test → service refactor, FE polish → backend endpoint mới.
5. Tiếp tục đến khi:
   - Hết credit/session/tool timeout.
   - Không còn task an toàn.
   - User ra lệnh dừng.
   - Repo bị blocker hệ thống không tự xử lý được.
6. Trước khi pick task, **kiểm tra anti-duplicate**:
   - `git fetch origin main && git log --oneline -10` đối chiếu task định pick.
   - Nếu commit gần đây có keyword task đó (vd "Phase 11.6.B Tribulation"), STOP và pick task khác.
   - Lý do: parallel session khác có thể đã merge cùng scope (xem snapshot lịch sử PR #313 closed do duplicate).

---

## PROMPT TEMPLATE

Bộ template ngắn để paste vào prompt khi giao task cho AI/dev. Mục tiêu: ép batching ngay từ prompt, tránh AI tự tách micro-PR.

### Template A — Feature/module batch

> **Nhấn mạnh: 1 PR duy nhất nếu cùng module.** Không tách pagination/filter/stats/loading/empty/error/i18n/test thành nhiều PR.

````markdown
Task: <feature ngắn gọn, vd "Phase 11.X Tribulation history view">.

Scope (1 PR duy nhất nếu cùng module — UI MODULE RULE):
- API client + Pinia store + View/component.
- Loading + empty + error state.
- Filter + pagination + stats card (nếu thuộc cùng view).
- i18n vi/en parity.
- Unit/render test hoặc Playwright smoke.
- Update docs/AI_HANDOFF_REPORT.md trong cùng PR.

Không được:
- Tách pagination/filter/stats thành PR riêng.
- Mở PR docs(audit) sync handoff sau PR feat.
- Tắt CI hoặc skip test cũ.

Done = CI xanh + handoff cập nhật.
````

### Template B — Smoke test batch

> **Nhấn mạnh: gom N smoke script vào 1 PR.** Không mở 1 PR / 1 script.

````markdown
Task: smoke HTTP cho <list module: vd shop + boss + chat>.

Scope (1 PR duy nhất gom N smoke — BATCHING RULE):
- Mỗi script: scripts/smoke-<module>.mjs (Node 20 native fetch, zero-install).
- Cover auth gate + zod negative + service negative + 1-2 positive path nếu admin seed có sẵn.
- Thêm pnpm script entry alphabet order trong package.json.
- Update docs/AI_HANDOFF_REPORT.md (Recent Changes 1 entry chung cho batch).

Không được:
- Mở 1 PR / 1 smoke script.
- Trộn smoke với feature runtime hoặc Prisma migration.

Done = tất cả script chạy local OK 2 lần liên tiếp deterministic + CI xanh.
````

### Template C — Catalog content batch

> **Nhấn mạnh: catalog + balance test + i18n trong 1 PR.** Không tách content khỏi balance/i18n.

````markdown
Task: thêm catalog <loại: vd 5 item tier huyen Mộc element>.

Scope (1 PR duy nhất — CONTENT_PIPELINE):
- packages/shared catalog entry mới + type tightening nếu cần.
- Balance vitest cover stat budget + drop weight + cost (theo BALANCE_MODEL.md).
- i18n vi/en key parity (tên + mô tả).
- Update docs/CONTENT_PIPELINE.md + docs/BALANCE_MODEL.md + docs/AI_HANDOFF_REPORT.md.

Không được:
- Tách "add catalog" / "add balance test" / "add i18n" thành 3 PR.
- Đổi runtime service trong cùng PR (tách layer nếu cần Prisma migration).

Done = balance test xanh + i18n parity check pass + CI xanh.
````

---

## Lịch sử

- **2026-05-05 (PR docs(ai): compact handoff and add task-based docs navigation)** — Siết HANDOFF REPORT STRUCTURE RULE: (1) compact cap **giảm từ 3000 → 250 dòng** cho `AI_HANDOFF_REPORT.md` sau audit thấy 217 dòng đã chật + AI session đọc chậm; (2) liệt kê 8 section bắt buộc (Executive Summary ≤30, Recent Changes 5–10, Phase Status, Open PR, Known Issues live-only, Tests/CI/Smoke, Next Roadmap, link Archive); (3) thêm ARCHIVE header bắt buộc (`# Archive — AI Handoff Report History` + note "AI KHÔNG cần đọc mỗi session"); (4) thêm **DOCS-ONLY PR EXCEPTION** clause — docs-only PR chỉ hợp lệ khi handoff lệch nặng / file vượt cap / dọn trạng thái đầu session / setup bộ docs mới / compact docs; mọi docs sync bình thường PHẢI gắn với PR feature. Migrate phase summary table (PR #33→#396) + smoke per-module detail sang `ARCHIVE_HANDOFF.md`. Author: Devin AI session 5/5.
- **2026-05-05** — Cập nhật **HANDOFF REPORT STRUCTURE RULE**: (1) compact threshold giảm từ 4000 dòng xuống **3000 dòng** sau khi tách Archive ra file riêng; (2) thêm rule **"Archive phải nằm file riêng"** — Archive section PHẢI ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md), KHÔNG inline trong `AI_HANDOFF_REPORT.md`. Lý do: AI session tiêu tốn ít token/quota hơn khi chỉ đọc file live (~200-3000 dòng) thay vì file gộp (~10000+ dòng). Author: Devin AI session 5/5.
- **2026-05-04** — Thêm **SESSION PR LIMIT** (giới hạn 1–3 PR/session, breakdown 1 Medium feature + 1 Medium test batch + 1 Hotfix khi cần, PR thứ 4 phải justify), **GOM TRƯỚC KHI TÁCH** (mục 4b trong NEXT TASK AUTO-SELECTION — kiểm tra cùng loại trước khi mở PR mới, ngưỡng tách 1200 LOC là max chứ không phải target), và **PROMPT TEMPLATE** (3 template A/B/C ép batching từ prompt). Cập nhật mode description thành "Fast but Safe Delivery Mode. Các luật workflow bên dưới là một bộ nhất quán và phải được áp dụng cùng nhau." Lý do: session 4/5 vừa rồi tạo 14 smoke PR liên tiếp #371..#385 mỗi PR 1 module gameplay — đáng lẽ gom batch 3-5 module/PR. Mục tiêu: giảm micro-PR, giảm CI overhead, gom task cùng loại vào Medium PR. Author: Devin AI session 9r-26 follow-up.
- **2026-05-03** — Tạo file. Author: Devin AI session 9r-26 take-over. Lý do: trong loop autonomous trước đó, một số UI module bị chia thành 4-5 micro-PR (vd Phase 11.6 Tribulation history split: PR #329 list view, #330 pagination, #332 filter, #333 stats summary, #334 docs sync), tốn CI thời gian + tốn review attention. Luật UI Module Rule giờ là gate.
- **2026-05-03** — Mở rộng thành **Fast but Safe Delivery Mode**: thêm DOCS UPDATE RULE, HANDOFF REPORT STRUCTURE RULE, TEST FAST PATH RULE, BATCHING RULE, SAFETY CORRECTION RULE, SPEED TARGET, NEXT TASK AUTO-SELECTION. Mục tiêu: AI/dev sau làm nhanh hơn nhưng vẫn đúng (không ép minimum 100 dòng, không fake green, không tắt CI). Author: Devin AI session 9r-26.
