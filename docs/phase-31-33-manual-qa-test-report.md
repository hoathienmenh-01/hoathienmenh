# Phase 31 Social/Retention + Phase 33 Story — Manual E2E QA Test Report

## Test Target

- **Repo**: `hoathienmenh-01/xuantoi`
- **Base branch**: `main` @ `062b0cd` (post Phase 30/31/32/33/41 merge)
- **Tested branch**: `test/phase-31-33-manual-qa` (cut from same `062b0cd`)
- **PRs covered**: #561 (Phase 31 Social/Retention), #564 (Phase 33 Story Quyển II–IV)
- **Date**: 2026-05-13
- **Environment**: local dev (docker postgres `mtt` / redis / minio / mailhog, API `localhost:3000`, web `localhost:5174`)
- **Tester**: Devin (autonomous QA)
- **Evidence**: continuous screen recording with `annotate_recording` overlays + inline screenshots below

## Summary

| Result | Count |
|---|---|
| PASS | 7 |
| FAIL | 0 |
| UNTESTED (out of scope / reclassified) | 1 |
| Total | 8 |

**TL;DR**: All Phase 31 Social/Retention runtime flows render correctly. Admin Mail send-one + audit log + player receive round-trip works. Mentor + Returner gating works for tier-0 fresh players. Mobile 360px and i18n VI↔EN swap both clean. **Test 6 reclassified from FAIL to UNTESTED** after deeper inspection (see Test 6 details + Section "Reclassification Notes").

No P0/P1 bugs found in tested flows.

## Test Results

### Test 1 — Register fresh player + Social view loads — PASS

**Steps executed**:
1. Navigated `http://localhost:5174/auth` → registered `qaplayer2@test.local` / `QaPlayer1Pass!2024`.
2. Completed onboarding (4 steps: character name, sect selection, breakthrough confirmation, mail check).
3. Clicked sidebar `友 Xã Giao` link.

**Pass criteria verified**:
- ✓ URL settles at `/social`, H1 reads **"Xã Giao"** (proper i18n VI label, no raw `social.viewTitle` key).
- ✓ **7 tabs render**: `Bằng Hữu` / `Mật Đàm` / `Đạo Bạn` / `Tổ Đội` / `Phụ Bản Tổ Đội` / `Boss Tổ Đội` / `Phần thưởng tuần Tổ Đội`.
- ✓ Default tab `Bằng Hữu` shows empty-state friend list with `Gửi lời mời` form.
- ✓ No console errors, no `{{ t(...) }}` leak, no untranslated keys.

### Test 2 — Mentor gating for tier-0 player — PASS

**Steps executed**:
1. As `qaplayer2` (realm `Luyện Khí Nhất Trọng`, tier 0), navigated `/mentor`.
2. Clicked `Đăng ký làm sư phụ` button without filling tier-9 prerequisites.

**Pass criteria verified**:
- ✓ Page renders both `Hồ sơ sư phụ` + `Tìm sư phụ` cards.
- ✓ Server rejects tier-0 register with error toast → mentor tier-gate enforced.
- ✓ `Tìm sư phụ` form present, `User ID sư phụ` + `Lời nhắn` inputs visible.
- ✓ Sub-tier-9 guard rail intact.

### Test 3 — Returner page state — PASS

**Steps executed**:
1. Navigated `/returner` as fresh `qaplayer2`.
2. Inspected `Đã rời tu luyện` counter + `Kiểm tra phần thưởng quay lại` button.
3. Clicked check button.

**Pass criteria verified**:
- ✓ Page renders without 500.
- ✓ Shows `Đã rời tu luyện: 0 ngày` (correct — fresh active player).
- ✓ Check button returns info-state `Chưa cần kích hoạt` (no reward grant for active player — correct cap behavior).
- ✓ No infinite spinner, no console error.

### Test 4 — Admin Mail send-one + audit log — PASS

**Steps executed**:
1. Logged out → logged in as `admin@example.com` / `change-me-bootstrap-pass`.
2. Navigated `/admin/mail` → `Gửi 1 người` tab.
3. Filled form: Loại thư `ADMIN`, Tiêu đề `[QA] Phase 31 Test Mail`, Nội dung `Hello QaPlayer2, this is a test mail sent from admin /admin/mail for Phase 31 QA verification.`, Lý do `QA Phase 31 manual test`, Linh Thạch `0`, Hết hạn default `2026-12-31T23:59:59Z`, Character ID `cmp4igv7v000ko3dvm74brdmz` (QaPlayer2's character id).
4. Clicked `Gửi` → switched to `Audit log` tab.

**Pass criteria verified**:
- ✓ Success toast `Thành công Đã gửi 1 thư.` appeared.
- ✓ `Audit log` tab newest row: kind `SEND_ONE`, subject matches `[QA] Phase 31 Test Mail`, count `1`, reason `QA Phase 31 manual test`, timestamp `2026-05-13T20:30:05.033Z`.
- ✓ No `INTERNAL_ERROR` toast.
- ✓ Server-side `AdminMailService.sendOne` + audit ledger working end-to-end.

### Test 5 — Player receives admin mail — PASS

**Steps executed**:
1. Logged out → re-logged in as `qaplayer2@test.local`.
2. Sidebar showed `書 Thư Sứ 1` badge (1 unread).
3. Navigated `/mail` → clicked the unread mail.

**Pass criteria verified**:
- ✓ Mail list shows 1 entry: subject `[QA] Phase 31 Test Mail`, sender `Thiên Đạo Sứ Giả`, timestamp matches send time `5/13/2026, 8:30:05 PM`.
- ✓ Click opens mail body: full sent text matches exactly: `Hello QaPlayer2, this is a test mail sent from admin /admin/mail for Phase 31 QA verification.`
- ✓ Mail auto-marked as read (unread badge cleared).
- ✓ Round-trip Admin → DB → WebSocket/poll → Player inbox successful.

**Evidence**:

![Test 5 — Player mail body](https://app.devin.ai/attachments/f8f729eb-7045-43b2-9a3f-3a8bc15b71e6/screenshot_a2978897bdcc48bdb28c3f455314e505.png)

### Test 6 — Story Dungeon catalog includes Phase 33 Quyển II–IV — UNTESTED (test plan reclassification)

**Steps executed**:
1. As `qaplayer2`, navigated `/story-dungeons`.
2. Inspected catalog list + counter.

**Observed state**:
- Catalog header: `Bí cảnh: 4` / `Có thể vào: 0` / `Đã thông quan: 0`.
- Cards rendered: `Hậu Sơn Linh Tuyền Động` (Phàm Nhân, locked), `Hắc Lâm Tâm Thử` (Luyện Khí, locked), `Mộc Huyền Lâm — Ký Ức Cổ Thụ` (Trúc Cơ, locked), `Kim Sơn Thiên Lò Lệnh` (Kim Đan, locked).
- All cards show Vietnamese chapter names + recommended realm gate.

![Test 6 — Story dungeons catalog](https://app.devin.ai/attachments/3413489b-07fb-4470-8a34-299695380c67/screenshot_1aa33b519ba045ec9a3b0cc8cac84d86.png)

**Reclassification rationale** — initial FAIL flag was retracted after source inspection:
- `packages/shared/src/story-dungeons.ts` declares exactly **4 `STORY_DUNGEONS` entries** (one per major realm tier: Phàm Nhân → Luyện Khí → Trúc Cơ → Kim Đan). These are the canonical story-dungeon zones, NOT 1-per-chapter.
- `packages/shared/src/story-quest-expansion.ts` (Phase 33 PR #564) introduces **209 new quests across chapters 9–27** (95 main + 57 side + 19 hidden + 19 daily + 19 weekly), gated by `Phase33RewardPolicyKey` realm tiers (Quyển II = tier ≥4, Quyển III = tier ≥6, Quyển IV = tier ≥8).
- Phase 33 quests have **0 `targetType: 'dungeon'`** references — they reference NPCs, monsters, regions, choices, flags. They do NOT add new story-dungeon entries.
- The test plan's pass criterion ("Phase 33 ch9–27 chapter cards on /story-dungeons") was **over-specified** — Phase 33 expansion is QUEST content, not DUNGEON content. The 4 dungeons shown are the correct full catalog.

**To properly test Phase 33 chapter visibility** (UNTESTED here):
- Would need a player at realm tier ≥4 (Quyển II = Kim Đan) to see Phase 33 quests in `/quests` page.
- Dev env has only tier-0 fresh player + admin → no shortcut to grind to tier 4+ in a single QA session.
- Test 6 should be **moved to Phase 33 quest acceptance suite** with a seeded high-tier test account, not the dungeon catalog.

**Not a runtime bug** — Phase 33 quest expansion is correctly compiled into `packages/shared` (covered by `story-quest-expansion.test.ts` invariant — 30 vitest cases enforcing 209-quest catalog, key uniqueness, NPC/monster/region/boss resolution, reward cap, daily/weekly cap).

### Test 7 — Mobile 360px responsive sweep — PASS

**Steps executed**:
1. Opened Chrome DevTools → Device Mode → set viewport `360 × 982`.
2. Visited `/story-dungeons`, `/social`, `/mentor`, `/mail`.

**Pass criteria verified per view**:
- ✓ Top bar collapses, hamburger menu button `☰` replaces full sidebar.
- ✓ Sidebar opens as overlay drawer when hamburger clicked.
- ✓ Card grid reflows to single column (story dungeons cards stack vertically).
- ✓ No horizontal scroll on `<body>` — content fits 360px width.
- ✓ Tab buttons (Social: 7 tabs) wrap to 2-row layout without clipping.
- ✓ CTAs remain tappable (≥44px touch target).

**Evidence**:

![Test 7 — Mobile 360px story dungeons](https://app.devin.ai/attachments/8e878066-378d-4360-83d8-d6e743da4ff3/screenshot_b143840b1126498fa6d341eccc9e7b39.png)

### Test 8 — i18n VI↔EN toggle — PASS

**Steps executed**:
1. From desktop viewport, clicked top-right language switcher `VI` → toggled to `EN`.
2. Revisited `/home`, `/social`, `/mentor`, `/admin/mail`.
3. Toggled back to `VI` → verified Vietnamese labels restored.

**Pass criteria verified**:
- ✓ Header app title `Đạo Môn` → `Dao Mon`, subtitle `Trải nghiệm tu tiên MUD - Cổ phong` → `Text-based cultivation MUD – Xianxia`.
- ✓ Sidebar all 30+ nav items translate: `Đạo Tràng` → `Home`, `Bảng Đk` → `Dashboard`, `Luyện Khí Đường` → `Sparring Hall`, `Bí Cảnh Hành` → `Dungeon Run`, `Bí Cảnh Cốt Truyện` → `Story Dungeons`, `Linh Bảo Các` → `Inventory`, `Tâm Cảnh Đường` → `Chat`, `Xuất Quan` → `Leave`, etc.
- ✓ /social page: H1 `Xã Giao` → `Social`, all 7 tab labels swap (`Bằng Hữu` → `Friends`, `Mật Đàm` → `Private chat`, `Đạo Bạn` → `Group chat`, `Tổ Đội` → `Party`, `Phụ Bản Tổ Đội` → `Party Dungeon`, `Boss Tổ Đội` → `Co-op Boss`, `Phần thưởng tuần Tổ Đội` → `Co-op Weekly Rewards`).
- ✓ /mentor page: H1 `Sư Đồ` → `Mentor & Disciple`, both cards translate (`Hồ sơ sư phụ` → `Mentor Profile`, `Tìm sư phụ` → `Find a mentor`, `Đăng ký làm sư phụ` → `Register as mentor`).
- ✓ /admin/mail page: H1 `Quản trị thư` → `Admin Mail`, 4 tabs translate (`Gửi 1 người` → `Send one`, `Gửi nhiều người` → `Send bulk`, `Gửi toàn server` → `Send global`, `Audit log` stays bilingual). Note: `Linh Thạch` is a domain-specific game term kept in Vietnamese in both modes (acceptable cosmetic, not a missing key).
- ✓ Zero raw i18n key leaks (no `{{ social.viewTitle }}`, `mentor.title`, etc).
- ✓ Toggle EN→VI restores all Vietnamese cleanly.

**Evidence**:

![Test 8 — EN mode /social view](https://app.devin.ai/attachments/2485c02c-5f38-4fb9-b5af-43aff891c35d/screenshot_959cfebd45014d43ab2993003ea511da.png)

![Test 8 — EN mode /home view](https://app.devin.ai/attachments/cdcaffef-4d43-469e-a55b-6eea0bafc9c7/screenshot_267fd078970c46fc876ddfbbbaf4b691.png)

![Test 8 — Toggle back to VI /admin/mail](https://app.devin.ai/attachments/7b5cb2aa-52e2-4a8c-bf35-0e1f0539d405/screenshot_87d41f9c51d449a89f0249cb9f8b6c99.png)

## Reclassification Notes

**Test 6 initially marked FAIL → reclassified UNTESTED** after deeper source inspection. The test plan's expectation ("Phase 33 chapters 9–27 visible on `/story-dungeons` catalog") was incorrect — Phase 33 PR #564 added quest content (`story-chapters-quyen-ii-iv.ts` + `story-quest-expansion.ts`), not new story-dungeon entries. The 4 dungeons currently rendered ARE the canonical catalog. To properly verify Phase 33 catalog visibility, a tier ≥4 player and the `/quests` page would be needed — out of scope for this dev-env session.

This is documented as a **test-plan defect**, not a code defect.

## Out of Scope

The following Phase 31/33 paths could not be exercised in single-machine, single-admin dev env (documented as out-of-scope, not failures):

| Path | Reason | Recommended follow-up |
|---|---|---|
| Mentor accept handshake | Needs tier ≥9 mentor + tier ≤6 disciple, both seeded | Phase 31.x manual session with seeded fixtures |
| Returner 8-day claim | Cannot fast-forward time without admin shortcut | Test with `lastSeenAt = now - 8d` DB seed |
| Phase 33 chapter quest catalog `/quests` visibility | Needs tier ≥4 (Quyển II) player | Seed tier-9 test account + revisit `/quests` |
| SystemGift 50k fan-out | Needs 50k+ player population | Load-test environment |
| Coop boss / party dungeon multi-player race | Needs 2+ concurrent clients | Multi-machine E2E suite |
| `/admin/mail` access from non-admin (regression for QA-004 sibling guards) | Out of plan scope (already covered by unit tests in `AdminControlCenterView.test.ts`) | Already covered |

## Bugs Found

**None in tested flows.**

| Bug ID | Severity | Status | Notes |
|---|---|---|---|
| (none new) | — | — | All 7 PASS tests had no failures; Test 6 was a test-plan defect not a code defect |

## CI Status

Code untouched on this branch (test-doc-only PR). CI should run cleanly — only changes are:
- `docs/phase-31-33-manual-qa-test-plan.md` (new — committed in this branch)
- `docs/phase-31-33-manual-qa-test-report.md` (new — this file)

## Final Recommendation

- **Phase 31 (Social/Retention)**: Production-ready for closed beta. Runtime flows render correctly, admin mail round-trip works, mentor/returner gating intact, mobile + i18n clean.
- **Phase 33 (Story Quyển II–IV)**: Cannot be fully verified in this session due to tier-gating. Server-side catalog invariants are covered by `story-quest-expansion.test.ts` (30 vitest passing). Recommend follow-up QA session with seeded tier-9 account for `/quests` visibility check.
- **Test plan**: Test 6 spec should be revised — Phase 33 chapter visibility belongs in quest catalog test, not dungeon catalog test.

## Evidence Attachments

- Screen recording: `rec-bbb469b3-fb3c-40d1-a09f-494c64c0f7aa-edited.mp4` (continuous, with 8 `test_start` + 9 `assertion` annotations).
- Inline screenshots: above per test.
- Recording will be attached to the PR comment.
