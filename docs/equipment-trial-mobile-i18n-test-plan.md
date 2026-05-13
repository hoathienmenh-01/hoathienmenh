# PR C — Equipment / Trial Tower / Mobile / i18n Manual QA Test Plan

**Date**: 2026-05-13
**Repo state**: `main` @ `4d07336` (post-merge: #571 Phase 31/33 manual QA)
**Branch**: `test/equipment-trial-mobile-i18n`
**Tester**: Devin
**Session**: https://app.devin.ai/sessions/a92b9681f3db401d9a3ca573628e4c5b

> Mục tiêu: thực thi P1.2 + P1.3 + P1.4 + P1.5 trong `docs/testing-backlog-report.md` (Equipment / Pháp Bảo, Trial Tower, mobile sweep, i18n EN audit). Recording đầy đủ làm proof. Mỗi test có pass/fail criteria CỤ THỂ.

---

## Test Environment

- API: `http://localhost:3000`
- Web: `http://localhost:5174`
- Bootstrap admin: `admin@example.com` / `change-me-bootstrap-pass`
- Test player (existing from PR B): `qaplayer2@test.local` / `QaPlayer1Pass!2024`
- DB: postgres `xuantoi-pg` (database `mtt`)
- Redis: `xuantoi-redis`
- Display: `:0`, Chrome maximized via `wmctrl`

---

## Out of scope (clearly stated)

Các flow đòi hỏi grind hoặc seed account đặc biệt mà dev env hiện không có:
- **Cường hóa material consume real-loop**: cần seed inventory với strengthen material catalog → out of scope, test chỉ visual UI (slot, button enabled state, error toast khi thiếu material).
- **Set bonus 4-piece / 6-piece**: cần seed full set inventory → out of scope, test chỉ verify slot mapping + UI label hiển thị.
- **Pháp Bảo star-up + awaken end-to-end**: cần fragment/crystal item grind → out of scope, test chỉ verify UI render + gating message khi không đủ material.
- **Trial Tower floor 5+ first-clear reward**: cần tier ≥ trial tower entry → out of scope nếu tier 0 fresh player chưa unlock; sẽ test với admin grant nếu route mở.

---

## Test 1 (P1.2-a) — Inventory + Equipment slot mapping

**Goal**: Verify `/inventory` page renders, slot panel có đủ slot type, equip/unequip lifecycle.

**Precondition**: Login `qaplayer2`.

**Steps**:
1. Navigate `/inventory`.
2. Verify slot panel hiện ít nhất các slot: WEAPON, HEAD, CHEST, LEG, BOOT, NECKLACE, RING, BRACELET, BELT (hoặc tương ứng tên VI).
3. Verify mỗi slot có placeholder/empty state hoặc item icon.
4. Verify quality tag visible nếu có item.

**Pass criteria**:
- Page render không 500, không layout vỡ.
- Có panel slot hoặc tab "Trang bị" / "Pháp Bảo".
- Không có raw i18n key (vd `equipment.slot.weapon`).
- Console không có Vue warning hoặc network 500.

**Fail criteria**: page trắng, missing slot definitions, raw i18n key leak, console error.

---

## Test 2 (P1.2-b) — Pháp Bảo V2 view (`/artifact-v2`)

**Goal**: Verify Pháp Bảo V2 view renders với catalog đủ.

**Precondition**: Login `qaplayer2`.

**Steps**:
1. Navigate `/artifact-v2`.
2. Verify page có tab/section liệt kê pháp bảo theo tier/realm.
3. Click vào 1 entry → expand detail (stat, requirement, craft material).
4. Verify gating message nếu chưa đủ realm/material (`Yêu cầu cảnh giới`, `Thiếu vật liệu`).

**Pass criteria**:
- Page render, catalog hiển thị ≥ 1 pháp bảo entry.
- Detail panel hoạt động.
- Gating message rõ ràng (không error 500).
- Không leak raw i18n key.

---

## Test 3 (P1.3) — Trial Tower view (`/world/towers`)

**Goal**: Verify Trial Tower view renders, có entry list, không 500.

**Precondition**: Login `qaplayer2`.

**Steps**:
1. Navigate `/world/towers`.
2. Verify page render với tower list hoặc gating message ("Yêu cầu cảnh giới X").
3. Nếu có "Bắt đầu" CTA → click → verify next-step UX (challenge confirmation, deduct attempt, etc.).
4. Nếu locked → verify message rõ ràng.

**Pass criteria**:
- Page render đúng.
- Tower entries hoặc gating message hiển thị.
- Không 500, không layout vỡ.

---

## Test 4 (P1.4) — Mobile 360px sweep (10 priority views)

**Goal**: Verify responsive layout không tràn ngang ở 360×800 viewport trên 10 view trọng yếu (giảm từ 30+ → focus core).

**Precondition**: DevTools Device toolbar set 360×800.

**Views (10)**:
1. `/home`
2. `/inventory`
3. `/artifact-v2`
4. `/world/towers`
5. `/cultivation-method-v2`
6. `/quests`
7. `/monetization-shop`
8. `/social`
9. `/mail`
10. `/admin/control-center` (login admin)

**Pass criteria per view**:
- Không horizontal scrollbar trên `body` (overflow-x: hidden hoặc layout fluid).
- Sidebar → collapsed hamburger.
- CTA button kích thước ≥ 44×44 px (touch target).
- Text không bị clip / overflow.
- Image (avatar, icon) không tràn container.

**Evidence**: screenshot mỗi view.

---

## Test 5 (P1.4-extra) — Mobile 390px + 414px sweep (3 priority views)

**Goal**: Verify layout responsive ở 390px (iPhone 14) và 414px (iPhone Plus).

**Views (3)**:
1. `/inventory`
2. `/social`
3. `/world/towers`

**Pass criteria**: same as Test 4, no horizontal scroll, all CTAs touchable.

---

## Test 6 (P1.5-a) — i18n EN toggle on Phase 31 + 33 views

**Goal**: Verify EN toggle swaps tất cả label sang English, không raw key leak.

**Precondition**: Settings → Language → English.

**Views (5)**:
1. `/home` — sidebar 30+ items đều EN.
2. `/social` — 7 tab titles, action buttons.
3. `/mentor` — page H1, register button.
4. `/returner` — page H1, check button.
5. `/admin/mail` — admin send form labels.

**Pass criteria**:
- All visible label English (không còn Vietnamese leak).
- 0 raw i18n key (vd `social.tab.friend`).
- Toggle back to VI → Vietnamese restored.

---

## Test 7 (P1.5-b) — i18n EN audit on Phase 30/32/41 + Equipment + Trial Tower

**Goal**: Verify EN cho các phase mới hơn + equipment views.

**Views (5)**:
1. `/market-v2` (Phase 30 Market V2).
2. `/codex` (Phase 30 Codex).
3. `/inventory` (equipment).
4. `/artifact-v2` (Pháp Bảo).
5. `/world/towers` (Trial Tower).

**Pass criteria**: all labels EN, 0 raw key, toggle back VI works.

---

## Test 8 (P1.5-c) — i18n EN gap report

**Goal**: Document any raw key leak / missing translation found in Tests 6+7.

**Format**: bảng `view | path | raw key found | suggested EN`.

**Action if leak found**: list in test report (NO fix in this PR; suggest follow-up).

---

## Recording

- Continuous recording across all 8 tests.
- Annotations:
  - `setup`: stack boot, login admin, login player.
  - `test_start`: per test (1–8).
  - `assertion`: per test, with `test_result` (passed/failed/untested) + concise text.

---

## Deliverables

1. This test plan (`docs/equipment-trial-mobile-i18n-test-plan.md`).
2. Test report (`docs/equipment-trial-mobile-i18n-test-report.md`) — populated after execution.
3. Recording attached to PR comment.
4. Screenshots per view (mobile sweep).
5. PR comment with attached recording URL.

---

## Done criteria

- [ ] All 8 tests executed with concrete evidence.
- [ ] Pass/fail/untested marked for each.
- [ ] Recording uploaded + linked.
- [ ] Test report committed.
- [ ] Draft PR opened with skeleton then finalized.
- [ ] CI green on PR.
