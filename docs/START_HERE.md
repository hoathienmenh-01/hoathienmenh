# START HERE — Cổng vào docs Xuân Tôi

> AI/dev mới: **đọc file này TRƯỚC** mọi file khác. Hơn 20 file `.md` trong `docs/` — đọc đúng thứ tự để không ngợp và không hiểu nhầm.

---

## Always read first (mỗi session)

**Token Budget Mode** — đọc snapshot files trước (30-80 dòng mỗi file):

1. [`docs/AI_QUICK_START.md`](./AI_QUICK_START.md) — quick startup guide với minimal token usage
2. [`docs/AI_HANDOFF_SNAPSHOT.md`](./AI_HANDOFF_SNAPSHOT.md) — current state snapshot (50-80 dòng)
3. [`docs/ai-memory/00_current_context.md`](./ai-memory/00_current_context.md) — current context
4. [`docs/ai-memory/11_next_tasks.md`](./ai-memory/11_next_tasks.md) — next task recommendation
5. [`docs/TASK_CONTEXT_MAP.md`](./TASK_CONTEXT_MAP.md) — task type → docs mapping

**Standard Mode** — 4 file bắt buộc đọc khi bắt đầu phiên làm việc mới:

1. [`AGENTS.md`](../AGENTS.md) — universal AI agent instructions: read order, token-saving rules, next-task tracker, progress update rule, test fast path.
2. [`docs/START_HERE.md`](./START_HERE.md) ← **bạn đang ở đây** — bản đồ điều hướng docs.
3. [`docs/AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) — Fast but Safe Delivery Mode + 8 luật delivery (UI Module / Docs Update / Handoff Structure / Test Fast Path / Batching / Safety Correction / Speed Target / Next Task Auto-Selection).
4. [`docs/AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) — snapshot trạng thái live (≤ **250 dòng**): Executive Summary + Recent Changes 10 PR + Phase Status + Known Issues + Tests/CI/Smoke + Recommended Next Roadmap. **Đầu file = mới nhất.**

## Do not read every session

Đọc CHỈ KHI cần tra cứu lịch sử / lore chi tiết — KHÔNG load mỗi session vì tốn token/quota:

- [`docs/ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) — lịch sử PR cũ (#33→#396), Completed Features snapshot, Project Reference đầy đủ (Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules), Phase Summary Migrated, Smoke Detail Migrated. Tra cứu khi debug PR cũ hoặc audit history.
- [`docs/archive/original-docx/`](./archive/original-docx/) — DOCX gốc archive (story bible, design docs). **KHÔNG đọc DOCX gốc mỗi session** — markdown design source ở [`docs/story/`](./story/) đã chứa đủ.
- [`docs/04_TECH_STACK_VA_DATA_MODEL.md`](./04_TECH_STACK_VA_DATA_MODEL.md) phần Phase 0..8 — historical blueprint, code thật trên `main` ưu tiên hơn (chỉ §P9 cuối là long-term blueprint mới đáng đọc).
- [`docs/05_KICH_BAN_BUILD_VA_PROMPT_AI.md`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md) phần Phase 0..8 — historical pointer (chỉ §P9 đáng đọc).

## Read by task type

| Task | Đọc |
|---|---|
| **Story / NPC / Quest / Phase 12 Story** | [`docs/story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md) **trước** (progress source of truth), sau đó [`docs/story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) nếu cần lore chi tiết (28 cảnh giới, 9 NPC, 27 quest chain). **KHÔNG đọc DOCX gốc.** |
| **Economy / currency / market / reward / ledger / mail reward / giftcode / topup** | [`docs/ECONOMY_MODEL.md`](./ECONOMY_MODEL.md) — 5 hard invariants + anti-abuse playbook. Vi phạm = data corruption. |
| **Item / skill / monster / boss / dungeon / mission / quest / event / title / achievement (catalog)** | [`docs/CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md) + [`docs/BALANCE_MODEL.md`](./BALANCE_MODEL.md) — process step-by-step + naming convention + balance gate + curve + dial registry + decision log. Achievement/title/reputation foundation cụ thể → [`docs/ACHIEVEMENT_TITLE_REPUTATION.md`](./ACHIEVEMENT_TITLE_REPUTATION.md). |
| **Test / smoke / E2E** | [`docs/QA_CHECKLIST.md`](./QA_CHECKLIST.md) — test scope + smoke pattern + E2E gate. Smoke detail per module → [`docs/ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Smoke Detail. |
| **Beta readiness** | [`docs/BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) — checklist Phase 9.A→9.E sub-phases. |
| **Feature audit / roadmap / next PR queue** | [`docs/FEATURE_AUDIT_AND_ROADMAP.md`](./FEATURE_AUDIT_AND_ROADMAP.md) + [`docs/FEATURE_PROGRESS_TRACKER.md`](./FEATURE_PROGRESS_TRACKER.md) — current feature status, polish gaps, recommended next PR, and living task queue. |
| **Live ops / event / admin / feature flag / maintenance** | [`docs/LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md) + [`docs/ADMIN_GUIDE.md`](./ADMIN_GUIDE.md) — EventConfig/Announcement/MaintenanceWindow/FeatureFlag/ConfigVersion lifecycle + permission matrix + admin panel. |
| **Roadmap / phase planning / dependency rule** | [`docs/LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) — Phase 9 → 17 với DO-NOT-BUILD-YET list. |
| **Game design / vision / core loop / 13 system** | [`docs/GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md) — vision + core loop + 13 system + product principles. |
| **Run/setup local** | [`docs/RUN_LOCAL.md`](./RUN_LOCAL.md) + [`docs/SEEDING.md`](./SEEDING.md) + [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md). |
| **Deploy / release / security** | [`docs/DEPLOY.md`](./DEPLOY.md) + [`docs/RELEASE_NOTES.md`](./RELEASE_NOTES.md) + [`docs/SECURITY.md`](./SECURITY.md) + [`docs/BACKUP_RESTORE.md`](./BACKUP_RESTORE.md). |
| **API endpoint reference (REST + WS)** | [`docs/API.md`](./API.md). |

> §1 Decision Table bên dưới là phiên bản chi tiết của bảng này (cộng thêm column "Vì sao đọc"). Nếu chỉ cần routing nhanh thì đọc bảng trên là đủ.

---

## 0. NGUYÊN TẮC NGUỒN SỰ THẬT (MUST READ)

> **Fast but Safe Delivery Mode** — AI/dev mới phải tuân thủ [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) (8 luật: UI Module / Docs Update / Handoff Structure / Test Fast Path / Batching / Safety Correction / Speed Target / Next Task Auto-Selection). Mục tiêu: làm nhanh hơn nhưng vẫn đúng — KHÔNG ép minimum 100 dòng diff, KHÔNG fake green, KHÔNG tắt CI.

Khi tài liệu xung đột nhau, ưu tiên theo thứ tự sau:

1. **Code hiện tại trên `main`** — luôn là nguồn sự thật cuối cùng.
2. **`docs/AI_HANDOFF_REPORT.md`** — snapshot trạng thái thật mỗi PR. Phần đầu file là mới nhất.
3. **Long-term design docs** (xem §1) — kịch bản dài hạn, viết sau code.
4. **`docs/04_TECH_STACK_VA_DATA_MODEL.md` + `docs/05_KICH_BAN_BUILD_VA_PROMPT_AI.md`** — **historical blueprint**, phần Phase 0..8 viết trước khi build, KHÔNG phải trạng thái hiện tại tuyệt đối. Phần `P9.x` ở cuối là long-term blueprint mới.

**Nếu 04/05 (phần Phase 0..8) khác code:** tin code, KHÔNG rollback code theo 04/05.

---

## 1. ĐỌC THEO MỤC ĐÍCH (DECISION TABLE)

| Bạn muốn... | Đọc file | Vì sao |
|---|---|---|
| **Biết luật delivery / scope khi viết PR** (Fast but Safe Delivery Mode: UI Module / Docs Update / Handoff Structure / Test Fast Path / Batching / Safety Correction / Speed Target / Next Task Auto-Selection) | [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) | **MUST READ trước PR đầu tiên.** 8 luật để làm nhanh nhưng vẫn đúng (không ép minimum 100 dòng, không fake green, không tắt CI). |
| **Biết trạng thái thật hiện tại của repo** (đã làm gì, baseline test, model nào đã có, PR nào vừa merge) | [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) — đọc **`## Current Executive Summary`** (30 dòng đầu) là đủ; muốn chi tiết theo session đọc tiếp `## Snapshots`. | Cập nhật mỗi PR. Đây là nguồn sự thật về "hôm nay đang ở đâu". |
| **Biết game sẽ đi đâu, fantasy là gì, core loop, 13 gameplay system, product principles** | [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md) | Vision + thiết kế dài hạn. Đọc xong hiểu "Xuân Tôi muốn trở thành cái gì". |
| **Biết phase nào nên làm tiếp, entry/exit criteria, module nào bị cấm chưa được build** | [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) | Phase 9 → 17 với dependency rule + DO-NOT-BUILD-YET list. |
| **Sẽ đụng tiền/item/reward** (linh thạch, tiên ngọc, mail reward, giftcode, market, daily login, topup, ledger) | [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md) | 5 hard invariants + anti-abuse playbook. **Vi phạm = data corruption.** |
| **Task liên quan cốt truyện / NPC / quest / Phase 12 Story** | [`story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md) **trước**, sau đó [`story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) nếu cần lore chi tiết. | Progress tracker là source of truth cho phần đã code; story bible là design source. **KHÔNG đọc DOCX gốc** ([`archive/original-docx/TuTienLo_Story_Bible.docx`](./archive/original-docx/TuTienLo_Story_Bible.docx)) mỗi session — DOCX chỉ là archive/source reference. |
| **Thêm content** (item, skill, monster, dungeon, mission, boss, quest, event, title, achievement) | [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md) | Process step-by-step + naming convention + balance gate + i18n parity. |
| **Chỉnh số/curve** (EXP, power, drop weight, boss HP, mission reward, item budget) | [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) | Curve + dial registry + test invariant + decision log. **Đừng đổi số bừa.** |
| **Vận hành event/live ops** (chạy event Tết, thông báo, maintenance, feature flag, rollback config) | [`LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md) | EventConfig/Announcement/MaintenanceWindow/FeatureFlag/ConfigVersion lifecycle + permission matrix. |
| **Biết Prisma model dài hạn dự kiến, API/WS roadmap, migration safety** | [`04_TECH_STACK_VA_DATA_MODEL.md`](./04_TECH_STACK_VA_DATA_MODEL.md) §P9 | ~60 model proposal qua phase 11-16, không migration ngay. |
| **Biết build/PR scripts dài hạn pointer** | [`05_KICH_BAN_BUILD_VA_PROMPT_AI.md`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md) §P9 | Pointer tới `LONG_TERM_ROADMAP.md` + dependency rule tóm tắt. |

---

## 2. ĐỌC THEO ROLE

### 2.1 AI/dev sắp viết PR feature mới

Đọc đủ **để không phá hệ thống**:

1. [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) — **MUST READ.** Fast but Safe Delivery Mode (8 luật): UI Module Rule, Docs Update Rule, Handoff Report Structure Rule, Test Fast Path Rule, Batching Rule, Safety Correction Rule, Speed Target, Next Task Auto-Selection.
2. [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) — snapshot trên cùng. Biết hôm nay ở đâu. **Để tiết kiệm token/quota: chỉ đọc Executive Summary (30 dòng đầu) là đủ. KHÔNG đọc [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) (lịch sử PR cũ #33→#396) mỗi session — chỉ tra cứu khi cần.**
3. [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0 + phase tương ứng. Confirm dependency rule + entry criteria phase đó đã đạt.
4. Doc chuyên biệt theo nội dung PR (xem §1).
5. [`API.md`](./API.md) nếu touch route.
6. `apps/api/prisma/schema.prisma` — schema thật.
7. `packages/shared/src/*.ts` nếu thêm catalog content.

### 2.2 AI/dev review PR

1. [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) — Fast but Safe Delivery Mode. Reject PR nếu: UI module bị chia thành micro-PR pagination/filter/stats riêng (UI MODULE RULE); docs handoff bị tách PR riêng (DOCS UPDATE RULE); test fake green / skip test cũ / tắt CI (SAFETY CORRECTION); gom scope không liên quan (BATCHING RULE).
2. [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) snapshot mới nhất — biết baseline.
3. [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md) §K (Module dependency rule) — confirm PR không lấn sân phase chưa tới.
4. [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md) §3 (Invariants) — nếu PR đụng currency/item, mọi mutation phải qua CurrencyService/ItemService và có ledger row.
5. [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) — nếu PR đổi số, confirm còn nằm trong band và có dial registry.

### 2.3 PM/admin/ops

1. [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) snapshot — biết đã ship gì.
2. [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md) §A-§B — biết vision + core loop.
3. [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) — biết phase tiếp theo.
4. [`LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md) — biết tool admin và lifecycle event.
5. [`ADMIN_GUIDE.md`](./ADMIN_GUIDE.md) — biết panel admin hiện có.

### 2.4 Người setup repo lần đầu

1. [`README.md`](../README.md) ở repo root.
2. [`RUN_LOCAL.md`](./RUN_LOCAL.md) — chạy local.
3. [`SEEDING.md`](./SEEDING.md) — seed DB.
4. [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — lỗi phổ biến.
5. [`API.md`](./API.md) — danh sách endpoint.

### 2.5 Người release/deploy

1. [`DEPLOY.md`](./DEPLOY.md) — quy trình deploy.
2. [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — backup/restore DB.
3. [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) — version log.
4. [`CHANGELOG.md`](./CHANGELOG.md) — changelog tổng.
5. [`SECURITY.md`](./SECURITY.md) — policy.
6. [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §Release Track — version roadmap v0.1 → v1.0.

---

## 3. BẢN ĐỒ DOCS (TẤT CẢ FILE TRONG `docs/`)

### 3.1 Long-term design (mới — 2026-04, đọc đầu tiên)

- [`START_HERE.md`](./START_HERE.md) ← **bạn đang ở đây**.
- [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) — Fast but Safe Delivery Mode (8 luật delivery/scope). **MUST READ trước PR đầu tiên.**
- [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md) — vision + core loop + 13 system + principles.
- [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) — Phase 9 → 17.
- [`FEATURE_AUDIT_AND_ROADMAP.md`](./FEATURE_AUDIT_AND_ROADMAP.md) — feature status matrix, top recommended PRs, beta readiness score.
- [`FEATURE_PROGRESS_TRACKER.md`](./FEATURE_PROGRESS_TRACKER.md) — living task queue. Read this before choosing the next autonomous PR.
- [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md) — currency invariants + anti-abuse.
- [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md) — process thêm content.
- [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) — curve + dial + decision log.
- [`LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md) — event scheduler + FF + maintenance.

### 3.2 Trạng thái + lịch sử

- [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md) — snapshot live (~200 dòng): Executive Summary + 5 section live. **Đầu file = mới nhất. AI chỉ cần đọc file này mỗi session.**
- [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) — **lịch sử PR cũ (#33→#396) + Project Reference đầy đủ (Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules) — KHÔNG cần đọc mỗi session, chỉ tra cứu khi cần** (vd debug PR cũ, audit cleanup, tìm chi tiết phase context).
- [`CHANGELOG.md`](./CHANGELOG.md) — changelog tổng.
- [`RELEASE_NOTES.md`](./RELEASE_NOTES.md) — version note.

### 3.2.1 Story / NPC / Quest design (Phase 12)

- [`story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md) — **progress source of truth** cho phần story implementation. Cập nhật mỗi PR story/quest/NPC. AI đọc TRƯỚC story bible.
- [`story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) — design source: 28 cảnh giới, 9 NPC trụ cột, 27 quest chain, world map, lore. Markdown chuyển hoá từ DOCX gốc.
- [`archive/original-docx/TuTienLo_Story_Bible.docx`](./archive/original-docx/TuTienLo_Story_Bible.docx) — DOCX gốc. **Archive only.** KHÔNG đọc mỗi session — markdown bible đã chứa đủ.

### 3.3 Historical blueprint (đọc sau khi đã đọc long-term)

- [`04_TECH_STACK_VA_DATA_MODEL.md`](./04_TECH_STACK_VA_DATA_MODEL.md) — phần Phase 0..8 historical, phần §P9 long-term.
- [`05_KICH_BAN_BUILD_VA_PROMPT_AI.md`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md) — phần Phase 0..8 historical, phần §P9 pointer.

### 3.4 Operational / runtime

- [`API.md`](./API.md) — danh sách REST + WS event hiện có.
- [`ADMIN_GUIDE.md`](./ADMIN_GUIDE.md) — admin panel.
- [`DEPLOY.md`](./DEPLOY.md) — deploy.
- [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) — DB backup.
- [`RUN_LOCAL.md`](./RUN_LOCAL.md) — chạy local.
- [`SEEDING.md`](./SEEDING.md) — seed.
- [`SECURITY.md`](./SECURITY.md) — security policy.
- [`PRIVACY.md`](./PRIVACY.md) — privacy.
- [`TOS.md`](./TOS.md) — terms of service.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — lỗi phổ biến.

### 3.5 QA / smoke

- [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md) — beta checklist.
- [`QA_CHECKLIST.md`](./QA_CHECKLIST.md) — QA checklist.
- [`RUNTIME_SMOKE_9G.md`](./RUNTIME_SMOKE_9G.md) — runtime smoke note.
- [`BALANCE.md`](./BALANCE.md) — balance note cũ (xem `BALANCE_MODEL.md` cho long-term).

---

## 4. TIPS QUAN TRỌNG (DO/DON'T)

### DO

- **Luôn đọc snapshot mới nhất của `AI_HANDOFF_REPORT.md`** trước khi viết PR.
- **Confirm phase entry criteria** đã đạt trước khi build phase tiếp theo.
- **Kiểm tra DO-NOT-BUILD-YET list** trong `LONG_TERM_ROADMAP.md` cuối file.
- **Mọi currency/item mutation đi qua `CurrencyService`/`ItemService`** + ledger row (xem `ECONOMY_MODEL.md` §3).
- **Mọi reward source có idempotency key** (`(characterId, sourceType, sourceKey)` unique).
- **Mọi admin action ghi `AdminAuditLog`**.
- **Update `AI_HANDOFF_REPORT.md`** sau mỗi PR (snapshot mới ở đầu file).
- **Task story / NPC / quest / Phase 12 Story**: đọc [`story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md) trước, sau đó [`story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) nếu cần lore chi tiết. Cập nhật progress tracker trong cùng PR (DOCS UPDATE RULE).

### DON'T

- ❌ KHÔNG sửa code để giống Phase 0..8 trong 04/05. **04/05 là historical.**
- ❌ KHÔNG cộng EXP/tiền/item từ frontend. **Backend là nguồn sự thật.**
- ❌ KHÔNG build module trong DO-NOT-BUILD-YET list (NFT/blockchain, real-money trade, voice chat, real-time PvP trước async PvP, gacha trước policy review).
- ❌ KHÔNG nhảy phase. Phase N+1 yêu cầu exit criteria phase N đã đạt.
- ❌ KHÔNG đụng Prisma migration mà không có rollback note + backup.
- ❌ KHÔNG xoá field Prisma — chỉ deprecate (xem `04` §P9.9).
- ❌ KHÔNG modify static catalog (`packages/shared/src/*.ts`) mà không qua `CONTENT_PIPELINE.md`.
- ❌ KHÔNG đổi số balance mà không update `BALANCE_MODEL.md` decision log.
- ❌ KHÔNG đọc DOCX gốc [`archive/original-docx/TuTienLo_Story_Bible.docx`](./archive/original-docx/TuTienLo_Story_Bible.docx) mỗi session. Markdown bible [`story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) đã chứa đủ design; DOCX chỉ là archive/source reference.

---

## 5. NHANH NHẤT 3 PHÚT (TL;DR)

Nếu chỉ có 3 phút:

1. Mở [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md). Lướt 8 section heading — biết Fast but Safe Delivery Mode để không tách micro-PR / không quên handoff / không fake green.
2. Mở [`AI_HANDOFF_REPORT.md`](./AI_HANDOFF_REPORT.md). Đọc Executive Summary trên cùng → biết baseline + đã ship gì.
3. Mở [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0.2 (dependency rule) + DO-NOT-BUILD-YET list cuối file.
4. Quay lại §1 file này, đọc 1 doc tương ứng với task.

Còn lại đọc khi cần.

---

## 6. CHANGELOG

- **2026-05-05 (PR docs(ai): compact handoff and add task-based docs navigation)** — Compact `AI_HANDOFF_REPORT.md` từ 217 dòng xuống ~160 dòng (cap mới ≤ 250 dòng theo HANDOFF REPORT STRUCTURE RULE). Migrate phase summary table (PR #33→#396) + smoke detail per-module table sang [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Phase Summary Migrated 2026-05-05 + § Smoke Detail Migrated 2026-05-05. ARCHIVE header chuẩn hoá (`Archive — AI Handoff Report History` + note bắt buộc). Thêm 3 section đầu file `START_HERE.md`: **Always read first** (3 file), **Do not read every session** (ARCHIVE + DOCX + 04/05 historical), **Read by task type** (10-row task → docs map). Thêm rule trong [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md): cap 250 dòng cho `AI_HANDOFF_REPORT.md` + Docs-Only PR Exception clause (chỉ mở docs-only PR khi handoff lệch nặng / file vượt cap / dọn trạng thái đầu session / setup bộ docs mới). Runtime impact: NONE (no Prisma, no runtime code, no test changes). Author: Devin AI session 5/5.
- **2026-05-05 (PR docs(story): add Tu Tien Lo story bible)** — Thêm [`story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) (markdown chuyển hoá từ DOCX) + [`story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md) (progress tracker) + archive [`archive/original-docx/TuTienLo_Story_Bible.docx`](./archive/original-docx/TuTienLo_Story_Bible.docx). Cập nhật §1 decision table (thêm dòng story/NPC/quest), §3.2.1 (entry story docs), §4 DO/DON'T. Rule mới: task Phase 12 Story đọc progress tracker trước, không đọc DOCX gốc mỗi session. Runtime story/quest/NPC chưa implemented.
- **2026-05-05 (PR docs(handoff): split archive)** — Tách `## 7. Archive` của `AI_HANDOFF_REPORT.md` thành file riêng [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) (~4900 dòng lịch sử PR #33→#396 + Project Reference). `AI_HANDOFF_REPORT.md` còn ~200 dòng (Executive Summary + 5 section live). Cập nhật §2.1 (note chỉ đọc Executive Summary) + §3.2 (thêm entry ARCHIVE_HANDOFF.md). Lý do: AI session tiêu tốn ít token/quota hơn khi đọc context handoff. Author: Devin AI session 5/5.
- **2026-05-03 (PR Fast-but-Safe Delivery Mode)** — Mở rộng `AI_WORKFLOW_RULES.md` thành 8 luật: UI Module Rule (giữ), Docs Update Rule, Handoff Report Structure Rule, Test Fast Path Rule, Batching Rule, Safety Correction Rule, Speed Target, Next Task Auto-Selection. Cập nhật §0 (Fast-but-Safe banner), §1 decision table, §2.1 + §2.2 role guides, §3.1 docs map, §5 TL;DR.
- **2026-05-03 (PR UI Module Rule)** — Add `AI_WORKFLOW_RULES.md` to required reading (§1 decision table, §2.1 + §2.2 role guides, §3.1 docs map). Lý do: tránh chia một màn hình UI thành 4-5 micro-PR (UI Module Rule).
- **2026-04-30** — Tạo file. Author: Devin AI session 9q (sau khi `docs/` đạt 25 file, AI mới dễ ngợp).
