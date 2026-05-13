# Phase 31 + 33 Manual QA Test Plan (PR B)

## What changed (in user-visible terms)
- **Phase 31 Social/Retention** (PR #561): new `/social` (friends/private chat/group/party/coop), `/mentor` (register mentor + request/accept), `/returner` (inactive-day state + claim), `/admin/mail` (send-one/bulk/global + audit log).
- **Phase 33 Story Quyển II–IV** (PR #564): expand story catalog with chapters 9–27 in 3 volumes (Tiên Giới Tù Thiên, Thánh Đạo Vấn Thiên, Bản Nguyên Vĩnh Hằng). New shared `story-chapters-quyen-ii-iv.ts` + `story-quest-expansion.ts`.

## Constraints (dev env)
- Only admin bootstrap user exists. Cannot grind to tier ≥9 for full mentor accept flow → mentor flow tested at **registration + gating** level, not full accept handshake.
- Cannot fast-forward 8 inactive days → returner claim tested at **state read + button gating** level.
- Single-machine, single browser → cannot test concurrent CAS race.

## Primary flow (recorded end-to-end)

### Test 1 — Register fresh player + Social view loads
**Steps**: Navigate `http://localhost:5174/auth` → click "Đăng ký" → enter `qaplayer1@test.local` / password → submit → land on home → click sidebar "Social" link.

**Pass criteria**:
- Auth flow returns 200, no console error.
- `/social` URL stays, H1 reads "Cộng Đồng" (or i18n VI key, NOT raw `social.viewTitle`).
- 7 tabs render: Bạn bè / Riêng tư / Nhóm / Tổ đội / Phụ bản tổ đội / Coop Boss / BXH Coop.
- Default tab "Bạn bè" panel loads (empty state shown for new player).
- No `[Object object]` or untranslated `{{ t(...) }}` keys visible.

**Fail signature if broken**: raw key like `social.viewTitle` appearing as label, missing tabs, 500 error toast on panel mount.

### Test 2 — Mentor page gating for low-tier player
**Steps**: As `qaplayer1` (tier 0 fresh), navigate `/mentor`.

**Pass criteria**:
- Page renders (no 500 / no infinite loading).
- "Đăng ký làm sư phụ" form is **either visible with a disabled tier-gate notice** OR **the register button submits and returns an error code like `MENTOR_TIER_TOO_LOW`** (mentor needs tier ≥9; fresh player tier 0 must be rejected).
- "Tìm sư phụ" search input is present.
- "Sư phụ hiện tại của tôi" panel shows empty state.

**Fail signature if broken**: tier-0 player CAN register as mentor (broken), or page crashes on mount.

### Test 3 — Returner page state
**Steps**: As `qaplayer1` just registered, navigate `/returner`.

**Pass criteria**:
- Page renders.
- Shows `inactiveDays: 0` or current value > 0 (depending on `lastSeenAt` heuristic).
- "Kiểm tra phần thưởng quay lại" button is present.
- Click button → either `RETURNER_NOT_ELIGIBLE` toast (correct, since just logged in) OR no-op info toast.

**Fail signature if broken**: returner immediately grants reward to active player (broken cap), or page crashes.

### Test 4 — Admin Mail send-one (admin perspective)
**Steps**: Logout → login as `admin@example.com` → navigate `/admin/mail` → on `sendOne` tab, paste `qaplayer1`'s user id (visible from previous step or via admin /users panel) → fill subject `[QA] Phase 31 Test Mail` + body `Hello qaplayer1, this is a test mail from QA.` → click Send.

**Pass criteria**:
- Send completes, success toast shown.
- Switch to "Audit Logs" tab → newest row shows `SEND_ONE` kind, subject matches, recipient = qaplayer1 user id, sender = admin user id.
- No `INTERNAL_ERROR` toast.

**Fail signature if broken**: send returns 500, or audit log doesn't show the new entry, or `recipientsSnapshot` cap leak.

### Test 5 — Player receives admin mail
**Steps**: Logout → re-login as `qaplayer1` → navigate `/mail`.

**Pass criteria**:
- 1 unread mail visible with subject `[QA] Phase 31 Test Mail`.
- Click mail → body matches, attachments section empty (since admin send-one without rewards).
- "Đánh dấu đã đọc" button works (mail moves from unread → read).

**Fail signature if broken**: mail not delivered, or wrong sender/subject, or body corrupted.

### Test 6 — Story Dungeon catalog includes Phase 33 Quyển II–IV
**Steps**: As `qaplayer1`, navigate `/story-dungeons`.

**Pass criteria**:
- Catalog list renders.
- Counter shows total ≥ N entries (where N includes Phase 21 ch1–8 + Phase 33 ch9–27).
- Filter to "locked" → at least one Quyển II/III/IV chapter card shows with status `LOCKED` + recommended realm gate (high tier).
- Card labels show Vietnamese chapter names (not raw key like `chapter_9` or `quyen_ii_tien_gioi`).

**Fail signature if broken**: only ch1–8 visible (Phase 33 not wired into catalog), or labels show raw keys.

### Test 7 — Mobile 360px responsive sweep
**Steps**: Open Chrome DevTools → Device Mode → set viewport 360×800 → navigate `/social`, `/mentor`, `/returner`, `/mail`, `/admin/mail`, `/story-dungeons`.

**Pass criteria** (per view):
- No horizontal scrollbar on `<body>` (page does not "tràn ngang").
- Sidebar collapses into hamburger or top nav (sidebar text labels not overflowing).
- Primary CTAs (Send, Register, Check, Mark Read) remain tappable (≥44px touch target).
- Text legible, no overlapping elements.

**Fail signature if broken**: horizontal scrollbar appears, sidebar still expanded at 360px, CTAs cropped.

### Test 8 — i18n VI↔EN toggle
**Steps**: At top-right language switcher → toggle to EN → revisit `/social`, `/mentor`, `/returner`, `/admin/mail`.

**Pass criteria**:
- All visible labels swap to English (e.g., "Cộng Đồng" → "Community"; "Đăng ký làm sư phụ" → "Register as Mentor").
- Zero raw i18n keys (`social.tabs.friends`, `mentor.title`) leaking through.
- Toggle back to VI restores Vietnamese.

**Fail signature if broken**: untranslated keys appear in EN mode, or only partial translation.

## Out of scope (cannot test in dev env)
- Full Mentor accept handshake (need tier-9 mentor + tier-6 student).
- Returner claim reward grant (need 8-day inactive period).
- Phase 33 actual chapter playthrough (need tier ≥4 to enter Quyển II).
- SystemGift 50k fan-out (need 50k+ users).
- CAS race-safety (need concurrent clients).

## Evidence collection
- One continuous screen recording covering Tests 1–8.
- Annotations at each test boundary (test_start + assertion result).
- Final report at `docs/phase-31-33-manual-qa-test-report.md`.
- PR comment on PR B with collapsed details + recording link.
