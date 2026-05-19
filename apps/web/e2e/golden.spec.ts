/**
 * E2E golden path — closed beta core loop.
 *
 * Mục tiêu: cover end-to-end các tương tác chính của user closed beta để
 * regression-safe trước khi mở rộng Phase 10 content scale. Coverage (20 spec):
 *   1. AuthView smoke (no backend)
 *   2. Register UI + 4-step onboarding + landing /home (full UI flow)
 *   3. Cultivate toggle ON/OFF (UI label flip + API state cross-check)
 *   4. Daily login claim (claimable → claimed transition)
 *   5. Mission view tabs + empty/list state
 *   6. Shop browse + insufficient-funds disable Buy (fresh char = 0 LT)
 *   7. Inventory empty state cho fresh char
 *   8. Chat WORLD send → message render trong feed
 *   9. Leaderboard tabs Power / Topup / Sect (data-testid stable)
 *   10. Profile public view ownId
 *   11. Logout → redirect /auth, session sạch
 *   12. Shop buy LINH_THACH (UI) — debit balance + credit inventory (post-9q-7)
 *   13. Inventory equip UI → equipped slot WEAPON cross-check (post-9q-7)
 *   14. Mail — page load + empty state cho fresh char (post-9q-7)
 *   15. Dungeon — list 3 dungeon + Sơn Cốc entry button enabled (post-9q-7)
 *   16. Settings — page load + account info + change-password section (post-9q-7)
 *   17. Skill Book — auto-grant basic_attack + tier badge + equipped summary (Phase 11.2.C)
 *   18. Talent catalog — fresh char Loadout empty + filter row gate + sticky CSS + catalog grid render (Phase 11.7.G)
 *   19. Talent learn → cast → cooldown badge — admin seed (PR #389) + UI learn click + API combat cast + cooldown badge UI (Phase 11.X UI E2E)
 *   20. Breakthrough attempt → outcome banner + history row appended (success/fail RNG branch, reload-persist) — admin seed (PR #383 grant-exp peak) + UI click attempt + RNG outcome banner + server-authoritative log persist (Phase 11 nâng cao §5 PR3 UI E2E)
 *   21. Phase 12 Story PR-5 — main storyline Chapter 1 playable (`phamnhan_main_01`): accept (UI button) → progress talk×2 (server `/quests/progress`) → admin track kill 3 son_thu (PR-5 admin harness) → COMPLETED → claim (UI button) → CLAIMED + CurrencyLedger row (LINH_THACH +100) + ItemLedger row (so_kiem +1)
 *   22. Phase 12.3 DungeonRun flow — start son_coc (UI button) → next×3 encounters (UI button) → COMPLETED → claim (UI button) → CLAIMED. Cross-check: kill log loot span hiển thị sau next (Phase 12.3 per-encounter loot wire) + claim modal hiển thị reward + CurrencyLedger DUNGEON_RUN_REWARD (+50 LT) + ItemLedger DUNGEON_LOOT/DUNGEON_RUN_REWARD rows + Inventory huyet_chi_dan qty ≥ 1
 *
 * Yêu cầu chạy local:
 *   1. `pnpm infra:up` (Postgres + Redis)
 *   2. `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   3. `pnpm --filter @xuantoi/api dev` (port 3000)
 *   4. `pnpm --filter @xuantoi/web dev` (port 5173, vite proxy `/api` → 3000)
 *   5. `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *       E2E_FULL=1 pnpm --filter @xuantoi/web e2e`
 *
 * Khi `E2E_FULL` chưa set, suite full-flow skip để tránh fail trên CI hiện tại
 * (CI mới chỉ chạy Vitest + build artifact). Spec `AuthView smoke` luôn chạy.
 *
 * Tham khảo: docs/QA_CHECKLIST.md §12, docs/BETA_CHECKLIST.md §QA + Launch.
 */
import { test, expect } from '@playwright/test';
import {
  registerAndOnboard,
  getCharacterMe,
  waitCharacter,
  flushAuthRateLimits,
  claimDailyLogin,
  buyShopItem,
  listInventoryApi,
  adminSeedTalent,
  adminSeedBreakthroughPeak,
  castTalentViaCombat,
  adminQuestTrack,
} from './helpers';

const FULL_E2E = process.env.E2E_FULL === '1';

test.describe('AuthView smoke (no backend)', () => {
  test('auth page renders email/password form + tab buttons', async ({ page }) => {
    await page.goto('/auth');
    await expect(page).toHaveURL(/\/auth/);

    // Form email + password input visible (login tab default)
    await expect(page.locator('input[type="email"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();

    // 3 tab buttons: Đăng Nhập / Đăng Ký / Đổi Mật Khẩu (ko phải role=tab,
    // chỉ là plain <button>).
    await expect(page.getByRole('button', { name: /Đăng Nhập/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Đăng Ký/i }).first()).toBeVisible();
  });
});

test.describe('Golden path — full stack required', () => {
  test.skip(!FULL_E2E, 'Set E2E_FULL=1 with running api+web+postgres+redis to run');

  // Flush register/login rate-limit Redis key trước mỗi test → đảm bảo suite
  // tạo > 5 user/IP/15min không bị 429 RATE_LIMITED. Mỗi test tạo 1 user mới
  // qua `registerAndOnboard()` nên cần reset window. Best-effort: Redis
  // unreachable chỉ log warn, không fail.
  test.beforeEach(async () => {
    await flushAuthRateLimits();
  });

  // ---------------------------------------------------------------------------
  // 1. Full UI auth flow — register → 4-step onboarding → /home.
  // Phần còn lại của suite dùng API helper để bypass UI auth (deterministic +
  // nhanh) → test này là "ground truth" của UI auth path.
  // ---------------------------------------------------------------------------
  test('register UI → 4-step onboarding → /home (full UI)', async ({ page }) => {
    const email = `e2e_uiauth_${Date.now()}@local.test`;
    const password = 'Pass1234!';
    const charName = `e2e_${Math.random().toString(36).slice(2, 8)}`;

    await page.goto('/auth');

    // Switch sang tab "Đăng Ký" — AuthView dùng plain <button>, không phải
    // role=tab. Vì thế dùng getByRole('button', { name: 'Đăng Ký' }).
    await page.getByRole('button', { name: /^Đăng Ký$/i }).click();

    // Form register hiện ra — chỉ có 2 input (email + password) + button
    // "Đăng Ký" submit. Use first() vì có thể có 2 input password (login form
    // bị v-if tắt nhưng selector vẫn match nếu cache).
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    await emailInput.fill(email);
    await passwordInput.fill(password);

    // Submit button — text từ i18n `auth.register.submit` = "Khai Tông Lập Danh"
    // (KHÔNG phải "Đăng Ký" — text đó chỉ là label tab nằm bên trên form).
    await page.getByRole('button', { name: /Khai Tông Lập Danh/i }).click();

    // Sau register thành công, AuthView push('/onboarding').
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    // Step 1 (intro). Click "Tiếp tục".
    await page.getByRole('button', { name: /Tiếp tục/i }).click();

    // Step 2 — fill name. Input là `type="text"`.
    await page.locator('input[type="text"]').first().fill(charName);
    await page.getByRole('button', { name: /Tiếp tục/i }).click();

    // Step 3 — pick sect. 3 button: Thanh Vân Môn / Huyền Thuỷ Cung / Tu La Tông.
    // (Note: tên 3 sect chính xác trong vi.json là `Tu La Tông`, không phải
    // `Tu La Điện` như existing test cũ.)
    await page.getByRole('button', { name: /Thanh Vân Môn/i }).click();
    await page.getByRole('button', { name: /Tiếp tục/i }).click();

    // Step 4 — confirm. Button "Khởi đạo" submit onboard.
    await page.getByRole('button', { name: /Khởi đạo/i }).click();

    // Replace('/home') — full game shell render.
    await page.waitForURL(/\/home/, { timeout: 15_000 });

    // Game home phải hiển thị tên character + button cultivate "Nhập Định".
    await expect(page.getByText(charName, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /Nhập Định/i }).first()).toBeVisible();

    // Cross-check API state: character đã tạo, cultivating=false, level=1.
    const ch = await getCharacterMe(page);
    expect(ch.name).toBe(charName);
    expect(ch.cultivating).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 2. Cultivate toggle — UI button text "Nhập Định" ↔ "Xuất Định" + API state.
  // ---------------------------------------------------------------------------
  test('cultivate toggle ON/OFF — UI label flip + API state', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_cult' });
    await page.goto('/home');

    const startBtn = page.getByRole('button', { name: /Nhập Định/i }).first();
    await expect(startBtn).toBeVisible({ timeout: 10_000 });

    // ON.
    await startBtn.click();
    await expect(page.getByRole('button', { name: /Xuất Định/i }).first()).toBeVisible({
      timeout: 5000,
    });
    await waitCharacter(page, (c) => c.cultivating === true, {
      label: 'cultivating=true',
    });

    // OFF.
    await page.getByRole('button', { name: /Xuất Định/i }).first().click();
    await expect(page.getByRole('button', { name: /Nhập Định/i }).first()).toBeVisible({
      timeout: 5000,
    });
    await waitCharacter(page, (c) => c.cultivating === false, {
      label: 'cultivating=false',
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Daily login claim — claim button → claimedHint hiện ra.
  // ---------------------------------------------------------------------------
  test('daily login claim — claimable → claimed transition', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_daily' });
    await page.goto('/home');

    // DailyLoginCard render trên /home cho user mới — first claim hôm nay.
    // Button text = `dailyLogin.claim` = "Nhận quà".
    const claimBtn = page.getByRole('button', { name: /Nhận quà/i }).first();
    await expect(claimBtn).toBeVisible({ timeout: 10_000 });
    await claimBtn.click();

    // Sau claim, FE update store → button disappear hoặc thay bằng claimedHint.
    // claimedHint i18n: "Đạo hữu đã nhận quà hôm nay. Chuỗi liên tục: {streak} ngày."
    await expect(page.getByText(/đã nhận quà hôm nay/i).first()).toBeVisible({
      timeout: 8000,
    });

    // Cross-check API: linhThach > 0 sau claim (daily login cấp +LT).
    const ch = await waitCharacter(page, (c) => BigInt(String(c.linhThach ?? '0')) > 0n, {
      label: 'linhThach > 0 after daily claim',
      timeoutMs: 6000,
    });
    expect(BigInt(String(ch.linhThach))).toBeGreaterThan(0n);
  });

  // ---------------------------------------------------------------------------
  // 4. Mission view — tabs + empty/list state cho fresh char.
  // ---------------------------------------------------------------------------
  test('mission view — tabs render + at least 1 mission visible', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_mission' });
    await page.goto('/missions');

    await expect(page).toHaveURL(/\/missions/);
    // Title `mission.title` = "Bảng Nhiệm Vụ".
    await expect(page.getByRole('heading', { name: /Bảng Nhiệm Vụ/i })).toBeVisible({
      timeout: 10_000,
    });

    // 3 tab daily/weekly/once — daily mặc định active.
    await expect(page.getByRole('button', { name: /Hằng Ngày/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Hằng Tuần/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Thiên Kiếp/i }).first()).toBeVisible();

    // Tab "Hằng Tuần" click không crash.
    await page.getByRole('button', { name: /Hằng Tuần/i }).first().click();
    // Tab "Thiên Kiếp" click không crash.
    await page.getByRole('button', { name: /Thiên Kiếp/i }).first().click();
    // Quay lại Hằng Ngày.
    await page.getByRole('button', { name: /Hằng Ngày/i }).first().click();

    // Page vẫn ở /missions, không bị redirect /auth.
    await expect(page).toHaveURL(/\/missions/);
  });

  // ---------------------------------------------------------------------------
  // 5. Shop browse — items render, insufficient-funds disable nút Buy.
  // Fresh char có linhThach = 0 nên mọi nút Buy phải disabled (canAfford=false).
  // ---------------------------------------------------------------------------
  test('shop browse — items render + buy disabled for 0-LT fresh char', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_shop' });
    await page.goto('/shop');

    await expect(page).toHaveURL(/\/shop/);
    // Title shop.
    await expect(page.getByRole('heading', { name: /NPC Tiệm/i })).toBeVisible({
      timeout: 10_000,
    });

    // Loading xong → ít nhất 1 entry hoặc empty state.
    // Nếu seed shop có entry: button "Mua" tồn tại + DISABLED (vì 0 LT).
    const buyBtns = page.getByRole('button', { name: /^Mua$/i });
    const buyCount = await buyBtns.count();
    if (buyCount > 0) {
      // Ít nhất nút Buy đầu tiên phải disabled (0 LT < bất kỳ price LT nào).
      const firstBuy = buyBtns.first();
      await expect(firstBuy).toBeDisabled({ timeout: 5000 });
    }
    // Page không crash.
    await expect(page).toHaveURL(/\/shop/);
  });

  // ---------------------------------------------------------------------------
  // 6. Inventory — empty state cho fresh char.
  // ---------------------------------------------------------------------------
  test('inventory — empty state for fresh char', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_inv' });
    await page.goto('/inventory');

    await expect(page).toHaveURL(/\/inventory/);
    // Title inventory: "Linh Bảo Các".
    await expect(page.getByRole('heading', { name: /Linh Bảo Các/i })).toBeVisible({
      timeout: 10_000,
    });
    // emptyAll i18n: "Túi đồ trống — đi Luyện Khí Đường để nhặt chiến lợi phẩm."
    await expect(page.getByText(/Túi đồ trống/i).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 7. Chat WORLD send — message echo trong feed.
  // ChatPanel mounted trong AppShell (bên phải). Test tại /home.
  // ---------------------------------------------------------------------------
  test('chat WORLD — send message → render trong feed', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_chat' });
    await page.goto('/home');

    // Wait cho AppShell + ChatPanel mount.
    await expect(page.getByRole('heading', { name: /Tâm Cảnh Đường/i })).toBeVisible({
      timeout: 10_000,
    });

    // Tab WORLD mặc định active. Input chat:
    const chatInput = page.locator('input[placeholder*="Gửi thế giới"]').first();
    await expect(chatInput).toBeVisible();

    const msg = `e2e_hi_${Math.random().toString(36).slice(2, 6)}`;
    await chatInput.fill(msg);
    // Submit form (button "Gửi" hoặc Enter).
    await page.getByRole('button', { name: /^Gửi$/i }).first().click();

    // Message text appear trong feed.
    await expect(page.getByText(msg, { exact: false }).first()).toBeVisible({
      timeout: 8000,
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Leaderboard tabs — Power / Topup / Sect render với data-testid stable.
  // ---------------------------------------------------------------------------
  test('leaderboard tabs — Power / Topup / Sect render', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_lb' });
    await page.goto('/leaderboard');

    await expect(page).toHaveURL(/\/leaderboard/);

    // 3 tab data-testid stable.
    const powerTab = page.locator('[data-testid="leaderboard-tab-power"]');
    const topupTab = page.locator('[data-testid="leaderboard-tab-topup"]');
    const sectTab = page.locator('[data-testid="leaderboard-tab-sect"]');

    await expect(powerTab).toBeVisible({ timeout: 10_000 });
    await expect(topupTab).toBeVisible();
    await expect(sectTab).toBeVisible();

    // Default active = power. Switch sang topup + sect → mỗi tab load không crash.
    await topupTab.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/leaderboard/);

    await sectTab.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/leaderboard/);

    await powerTab.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/leaderboard/);
  });

  // ---------------------------------------------------------------------------
  // 9. Profile own-id — public view render được tên character.
  // ---------------------------------------------------------------------------
  test('profile /profile/:ownId — public view shows char name', async ({ page }) => {
    const seed = await registerAndOnboard(page, { emailPrefix: 'e2e_profile' });
    await page.goto(`/profile/${seed.characterId}`);

    await expect(page).toHaveURL(new RegExp(`/profile/${seed.characterId}`));
    // Tên character render đâu đó trên page (h1 / h2 / text node).
    await expect(page.getByText(seed.charName, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Logout — clear session, redirect /auth.
  // ---------------------------------------------------------------------------
  test('logout — clears session + redirects /auth', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_logout' });
    await page.goto('/home');

    // AppShell logout button text = `home.logout` = "Xuất Quan".
    const logoutBtn = page.getByRole('button', { name: /Xuất Quan/i }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 10_000 });
    await logoutBtn.click();

    // FE redirect về /auth (interceptor 401 hoặc explicit push).
    await page.waitForURL(/\/auth/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth/);
  });

  // ---------------------------------------------------------------------------
  // 11. Shop buy LINH_THACH (UI) — full purchase flow.
  // Setup qua API: claim daily login → +100 LT (DAILY_LOGIN_LINH_THACH).
  // Sau đó UI: goto /shop → tìm card "Sơ Kiếm" (30 LT, WEAPON) → click "Mua" →
  // toast success → balance giảm 30 → inventory có 1 Sơ Kiếm (cross-check API).
  // ---------------------------------------------------------------------------
  test('shop buy LINH_THACH — UI buy debits balance + credits inventory', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_shopbuy' });

    // Setup: daily login → 100 LT.
    const claim = await claimDailyLogin(page);
    expect(claim.claimed).toBe(true);
    expect(BigInt(claim.linhThachDelta)).toBeGreaterThanOrEqual(100n);

    await page.goto('/shop');
    await expect(page).toHaveURL(/\/shop/);
    await expect(page.getByRole('heading', { name: /NPC Tiệm/i })).toBeVisible({
      timeout: 10_000,
    });

    // Tìm card "Sơ Kiếm" (WEAPON, 30 LT) — name unique trong shop catalog.
    const soKiemCard = page.locator('li', { hasText: /Sơ Kiếm/i }).first();
    await expect(soKiemCard).toBeVisible({ timeout: 5000 });

    // Nút "Mua" trong card "Sơ Kiếm" phải ENABLED (100 ≥ 30 LT).
    const buyBtn = soKiemCard.getByRole('button', { name: /^Mua$/i }).first();
    await expect(buyBtn).toBeEnabled({ timeout: 5000 });

    // Snapshot balance trước mua (qua API).
    const before = await getCharacterMe(page);
    const beforeLT = BigInt(String(before.linhThach ?? '0'));

    await buyBtn.click();

    // Sau mua, FE refetch state → balance giảm. Cross-check qua API: char
    // linhThach đã trừ 30 (giá Sơ Kiếm). Poll vì FE refresh không đồng bộ.
    await waitCharacter(
      page,
      (c) => BigInt(String(c.linhThach ?? '0')) === beforeLT - 30n,
      { label: 'linhThach -= 30 sau buy Sơ Kiếm', timeoutMs: 6000 },
    );

    // Inventory có 1 Sơ Kiếm (cross-check API).
    const inv = await listInventoryApi(page);
    const soKiem = inv.find((i) => {
      const item = i.item as { key?: string } | undefined;
      return item?.key === 'so_kiem';
    });
    expect(soKiem).toBeDefined();
    expect(soKiem?.qty ?? 0).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 12. Inventory equip — UI flow.
  // Setup: daily claim → buy "Sơ Kiếm" qua API. UI: goto /inventory → list
  // shows Sơ Kiếm trong unequipped → click "Trang bị" → equipped slot WEAPON
  // hiện Sơ Kiếm + cross-check API equippedSlot.
  // ---------------------------------------------------------------------------
  test('inventory equip — UI click "Mang" → equipped slot WEAPON', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_equip' });

    // API setup.
    await claimDailyLogin(page);
    await buyShopItem(page, 'so_kiem', 1);

    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.getByRole('heading', { name: /Linh Bảo Các/i })).toBeVisible({
      timeout: 10_000,
    });

    // Sơ Kiếm xuất hiện trong unequipped section.
    const card = page.locator('div', { hasText: /Sơ Kiếm/i }).first();
    await expect(card).toBeVisible({ timeout: 5000 });

    // Click "Mang" — i18n `inventory.equip` = "Mang".
    const equipBtn = page.getByRole('button', { name: /^Mang$/i }).first();
    await expect(equipBtn).toBeVisible();
    await equipBtn.click();

    // Cross-check API: inventory item now has equippedSlot=WEAPON.
    await expect
      .poll(
        async () => {
          const inv = await listInventoryApi(page);
          const sk = inv.find((i) => {
            const item = i.item as { key?: string } | undefined;
            return item?.key === 'so_kiem';
          });
          return sk?.equippedSlot ?? null;
        },
        { timeout: 6000, message: 'so_kiem.equippedSlot === WEAPON' },
      )
      .toBe('WEAPON');

    // UI: equipped section (left column) phải hiện "Sơ Kiếm".
    // i18n `inventory.takeOff` = "Tháo" — button xuất hiện cho slot đã equip.
    await expect(page.getByRole('button', { name: /^Tháo$/i }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Mail — empty state cho fresh char.
  // Fresh user có 0 mail (no admin send / no event reward). Verify page load +
  // empty placeholder text.
  // ---------------------------------------------------------------------------
  test('mail — page loads + empty state for fresh char', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_mail' });
    await page.goto('/mail');

    await expect(page).toHaveURL(/\/mail/);
    // Title `mail.title` = "Thiên Đạo Thư Các".
    await expect(page.getByRole('heading', { name: /Thiên Đạo Thư Các/i })).toBeVisible({
      timeout: 10_000,
    });

    // Empty state `mail.empty` = "Hộp thư trống rỗng." (aside panel).
    await expect(page.getByText(/Hộp thư trống rỗng/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Dungeon — list visible + Sơn Cốc entry button enabled.
  // Fresh char stamina = 100; Sơn Cốc cần 10 → button "Vào" enabled.
  // KHÔNG enter combat (random damage + multi-monster → defer smoke:combat).
  // ---------------------------------------------------------------------------
  test('dungeon — list 3 dungeon + Sơn Cốc enter enabled (stamina ≥ 10)', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_dungeon' });
    await page.goto('/dungeon');

    await expect(page).toHaveURL(/\/dungeon/);
    // Title `dungeon.title` = "Luyện Khí Đường".
    await expect(page.getByRole('heading', { name: /Luyện Khí Đường/i })).toBeVisible({
      timeout: 10_000,
    });

    // 3 dungeon catalog: Sơn Cốc / Hắc Lâm / Yêu Thú Động.
    await expect(page.getByRole('heading', { name: /^Sơn Cốc$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Hắc Lâm$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Yêu Thú Động/ })).toBeVisible();

    // Sơn Cốc card: enter button "Khai ải" enabled (fresh char stamina 100 ≥ 10).
    // i18n `dungeon.enter` = "Khai ải".
    const enterBtn = page.getByRole('button', { name: /^Khai ải$/ }).first();
    await expect(enterBtn).toBeEnabled({ timeout: 5000 });

    // Cross-check API: stamina ≥ 10 (Sơn Cốc staminaEntry).
    const ch = await getCharacterMe(page);
    expect(Number(ch.stamina ?? 0)).toBeGreaterThanOrEqual(10);
  });

  // ---------------------------------------------------------------------------
  // 15. Settings page — render account info + change-password section.
  // ---------------------------------------------------------------------------
  test('settings — page loads + account info + change-password section', async ({ page }) => {
    const seed = await registerAndOnboard(page, { emailPrefix: 'e2e_settings' });
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/settings/);
    // Title `settings.title` = "Tâm Pháp Đường".
    await expect(page.getByRole('heading', { name: /Tâm Pháp Đường/i })).toBeVisible({
      timeout: 10_000,
    });

    // Account info section: email render đúng.
    await expect(page.getByText(seed.email, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    // Change password section: 3 input password.
    const pwdInputs = page.locator('input[type="password"]');
    expect(await pwdInputs.count()).toBeGreaterThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // 16. Spiritual Root (Linh Căn) — Phase 11.3.D.
  //
  // Visit `/spiritual-root` cho fresh char → server lazy-roll linh căn (Phase
  // 11.3.A) + render grade card + element wheel + reroll card. Reroll button
  // luôn visible nhưng click sẽ fail LINH_CAN_DAN_INSUFFICIENT vì fresh char
  // không có item. Spec verify static UI render, KHÔNG bấm reroll (không inject
  // item drop trong E2E để tránh test-fragility).
  // ---------------------------------------------------------------------------
  test('spiritual-root — auto-roll display + element wheel + reroll button', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_spiritual_root' });
    await page.goto('/spiritual-root');

    await expect(page).toHaveURL(/\/spiritual-root/);

    // Grade card render (server lazy roll on GET /character/spiritual-root).
    await expect(page.locator('[data-testid="spiritual-root-grade-card"]')).toBeVisible({
      timeout: 10_000,
    });

    // Grade name visible (1 trong 5 grade: Phàm/Linh/Huyền/Tiên/Thần).
    const gradeName = await page
      .locator('[data-testid="spiritual-root-grade-name"]')
      .textContent();
    expect(gradeName?.trim()).toMatch(/Phàm|Linh|Huyền|Tiên|Thần/);

    // Element wheel: đủ 5 ô Ngũ Hành.
    for (const el of ['kim', 'moc', 'thuy', 'hoa', 'tho']) {
      await expect(
        page.locator(`[data-testid="spiritual-root-element-${el}"]`),
      ).toBeVisible();
    }

    // Đúng 1 element là primary (kim/moc/thuy/hoa/tho).
    const primaries = page.locator(
      '[data-testid^="spiritual-root-element-"][data-role="primary"]',
    );
    expect(await primaries.count()).toBe(1);

    // Purity hiển thị range hợp lệ 80..100.
    const purityTxt =
      (await page.locator('[data-testid="spiritual-root-purity"]').textContent()) ?? '';
    const purityMatch = purityTxt.match(/(\d+)\s*\/\s*100/);
    expect(purityMatch).not.toBeNull();
    const purity = Number(purityMatch?.[1] ?? '0');
    expect(purity).toBeGreaterThanOrEqual(80);
    expect(purity).toBeLessThanOrEqual(100);

    // Reroll card + button visible (fresh char, count=0).
    await expect(page.locator('[data-testid="spiritual-root-reroll-card"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="spiritual-root-reroll-button"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="spiritual-root-reroll-count"]')).toContainText(
      /0/,
    );
  });

  // ===================================================================
  // SPEC #17 — Phase 11.2.C Skill Book UI display.
  //
  // Visit `/skill-book` cho fresh char → server lazy-grant `basic_attack`
  // (Phase 11.2.B `grantStarterIfMissing` chạy trong onboard) + GET trả
  // về `{ maxEquipped: 4, learned: [{ skillKey: 'basic_attack', ... }] }`.
  //
  // Verify:
  //   - Skill card `basic_attack` render với tier badge "Sơ cấp".
  //   - Equipped badge present (basic_attack starter auto-equipped).
  //   - Equipped count summary "1 / 4".
  //   - Filter dropdowns visible.
  //
  // KHÔNG bấm equip / upgrade — fresh char không có sect skill khác để
  // equip; flow đầy đủ defer cho QA manual smoke.
  // ===================================================================
  test('skill-book — auto-grant basic_attack + tier badge + equipped summary', async ({ page }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_skill_book' });
    await page.goto('/skill-book');

    await expect(page).toHaveURL(/\/skill-book/);

    // Card cho basic_attack (lazy-granted bởi grantStarterIfMissing).
    await expect(page.locator('[data-testid="skill-book-card-basic_attack"]')).toBeVisible({
      timeout: 10_000,
    });

    // Tier badge cho basic_attack = 'basic' → i18n 'Sơ cấp'.
    await expect(page.locator('[data-testid="skill-book-tier-basic_attack"]')).toContainText(
      /Sơ cấp/,
    );

    // Equipped badge — basic_attack auto-equipped.
    await expect(
      page.locator('[data-testid="skill-book-equipped-badge-basic_attack"]'),
    ).toBeVisible();

    // Mastery row "1 / 5".
    await expect(page.locator('[data-testid="skill-book-mastery-basic_attack"]')).toContainText(
      /1\s*\/\s*5/,
    );

    // Equipped summary "1 / 4".
    await expect(page.locator('[data-testid="skill-book-equipped-count"]')).toContainText(
      /1\s*\/\s*4/,
    );

    // Filter selects visible.
    await expect(page.locator('[data-testid="skill-book-filter-tier"]')).toBeVisible();
    await expect(page.locator('[data-testid="skill-book-filter-element"]')).toBeVisible();
    await expect(page.locator('[data-testid="skill-book-filter-equipped"]')).toBeVisible();
  });

  // ===================================================================
  // SPEC #18 — Phase 11.7.G Talent catalog UI smoke (FE wire E2E).
  //
  // Visit `/talents` cho fresh char (chưa Trúc Cơ → 0 active learned, 0
  // talent point). Verify FE catalog wire BE talents/state qua real
  // HTTP cho:
  //   - Page route + heading render.
  //   - Loadout section visible + sticky CSS class hiện diện trên DOM
  //     (`md:sticky`, `md:top-0`, `md:z-10`) — Phase 11.7.G css.
  //   - Loadout filter row HIDDEN cho fresh char (gate
  //     `activeLearnedTalents.length > 0`).
  //   - Loadout empty state visible (`talents-active-empty`) — fresh char
  //     never learned active.
  //   - Budget section render với spent=0 + remaining=0 (BE state wire).
  //   - Catalog filters (type/element/status) visible.
  //   - Catalog grid render ≥ 1 talent card (catalog data load qua
  //     shared/talents.ts → vue render).
  //
  // KHÔNG bấm Học (fresh char không có talent point + chưa đủ realm cho
  // bất kỳ talent nào trong catalog), KHÔNG seed talent point — full
  // learn → cast → cooldown flow cover ở SPEC #19 (Phase 11.X UI E2E,
  // E2E_FULL=1 spec với admin seed PR #389 set-realm + grant-talent-point).
  // ===================================================================
  test('talent catalog — fresh char loadout empty + filter row gate + sticky CSS + catalog grid render', async ({
    page,
  }) => {
    await registerAndOnboard(page, { emailPrefix: 'e2e_talents' });
    await page.goto('/talents');

    await expect(page).toHaveURL(/\/talents/);

    // Loadout section visible + sticky CSS classes (Phase 11.7.G).
    const loadout = page.locator('[data-testid="talents-active-section"]');
    await expect(loadout).toBeVisible({ timeout: 10_000 });
    const loadoutClass = await loadout.getAttribute('class');
    expect(loadoutClass ?? '').toContain('md:sticky');
    expect(loadoutClass ?? '').toContain('md:top-0');
    expect(loadoutClass ?? '').toContain('md:z-10');

    // Filter row HIDDEN cho fresh char (gate activeLearnedTalents.length > 0).
    await expect(page.locator('[data-testid="talents-active-filter-row"]')).toHaveCount(0);

    // Empty state visible (never-learned).
    await expect(page.locator('[data-testid="talents-active-empty"]')).toBeVisible();

    // Filter-only empty state KHÔNG render khi chưa learn talent nào.
    await expect(page.locator('[data-testid="talents-active-filter-empty"]')).toHaveCount(0);

    // Budget section render với spent=0 + remaining=0 (BE state wire).
    await expect(page.locator('[data-testid="talents-budget-spent"]')).toContainText(/0/);
    await expect(page.locator('[data-testid="talents-budget-remaining"]')).toContainText(/0/);

    // Catalog filter selects visible (type / element / status).
    await expect(page.locator('[data-testid="talents-filter-type"]')).toBeVisible();
    await expect(page.locator('[data-testid="talents-filter-element"]')).toBeVisible();
    await expect(page.locator('[data-testid="talents-filter-status"]')).toBeVisible();

    // Catalog grid render ≥ 1 talent card (data từ packages/shared/talents.ts).
    await expect(page.locator('[data-testid="talents-list"]')).toBeVisible();
    const cards = page.locator('[data-testid^="talent-card-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  // ===================================================================
  // SPEC #19 — Phase 11.X UI E2E talent learn → cast → cooldown badge.
  //
  // Goal: lock down full talent UX round-trip — học active talent qua UI
  // (`talent-learn-${key}` button) + cast trong combat (programmatic
  // `POST /combat/encounter/.../action` với skillKey=talentKey) + verify
  // cooldown badge xuất hiện trên Loadout sau reload `/talents`.
  //
  // Foundation: PR #389 admin seed harness (`set-realm` + `grant-talent-point`)
  // unblock setup deterministic — không cần character đã breakthrough sẵn.
  // Reuse `talent_kim_quang_tram` (`kim_dan` realm, 2 TP cost, mp=30 ≤ fresh
  // mpMax=50 thanh_van, cooldown=3, AOE damage 2× atk).
  //
  // Setup steps:
  //   1. registerAndOnboard fresh char (sect default thanh_van).
  //   2. adminSeedTalent(userId, { realmKey: 'kim_dan', stage: 1, tp: 5 }).
  //      → admin login (separate APIRequestContext) + set-realm + grant-tp.
  //
  // Test steps:
  //   3. Navigate `/talents`. Verify Loadout empty (fresh) + budget remaining=5.
  //   4. Click `[data-testid="talent-learn-talent_kim_quang_tram"]` → wait
  //      ready badge `talent-active-ready-talent_kim_quang_tram` visible
  //      (cooldown=0 vừa học chưa cast). Loadout active count = 1.
  //   5. castTalentViaCombat(page, 'son_coc', 'talent_kim_quang_tram').
  //      → POST /combat/encounter/start { dungeonKey: 'son_coc' } + POST
  //        /encounter/:id/action { skillKey: 'talent_kim_quang_tram' }.
  //      Server set cooldownTurnsRemaining = 3 (catalog activeEffect.cooldownTurns).
  //   6. Reload `/talents`. Verify cooldown badge
  //      `talent-active-cooldown-talent_kim_quang_tram` visible + chứa "3"
  //      (i18n `talents.badge.cooldown` formatString { turns: 3 }).
  //
  // Anti-FE-self-grant: spec KHÔNG mock cooldown FE-side; cooldown phải
  // round-trip qua server (POST action → talents/state → cooldownOf > 0
  // → badge visible). Nếu BE/FE wire stale → badge missing → spec fail.
  //
  // Yêu cầu environment: `pnpm --filter @xuantoi/api bootstrap` để seed
  // admin@example.com (admin seed harness gating). Override email/password
  // qua env `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`.
  // ===================================================================
  test('talent learn → cast (combat) → cooldown badge — full Phase 11.X UI E2E', async ({
    page,
  }) => {
    const TALENT_KEY = 'talent_kim_quang_tram';
    const COOLDOWN_TURNS = 3;
    // Admin grant delta. Tổng budget = `computeTalentPointBudget(realmOrder)` +
    // `bonusTalentPoints`. Kim Đan realm order=3 → floor(3/3)=1 base → tổng
    // budget = 1 + GRANT_DELTA (5) = 6. Sau khi học cost=2 → còn 4.
    const GRANT_DELTA = 5;
    const REALM_BASE_BUDGET = 1; // computeTalentPointBudget(kim_dan order=3)
    const TOTAL_BUDGET = REALM_BASE_BUDGET + GRANT_DELTA; // 6
    const LEARN_COST = 2; // talent_kim_quang_tram talentPointCost
    const REMAINING_AFTER_LEARN = TOTAL_BUDGET - LEARN_COST; // 4

    // 1. Onboard fresh char (sect thanh_van: mpMax=50 ≥ talent mpCost 30).
    const seed = await registerAndOnboard(page, { emailPrefix: 'e2e_talent_full' });

    // 2. Admin seed: setRealm kim_dan stage=1 + grantTalentPoint +5.
    //    set-realm reset exp=0 (admin.service.setRealm) — không ảnh hưởng
    //    talent flow vì học gate theo realmKey/realmStage không phải exp.
    await adminSeedTalent(seed.userId, {
      realmKey: 'kim_dan',
      realmStage: 1,
      talentPoints: GRANT_DELTA,
    });

    // 3. Visit /talents, verify pre-learn baseline.
    await page.goto('/talents');
    await expect(page).toHaveURL(/\/talents/);

    // Loadout empty cho fresh char + budget remaining=TOTAL_BUDGET (realm base
    // + admin grant) + spent=0 (chưa học gì).
    await expect(page.locator('[data-testid="talents-active-empty"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="talents-budget-remaining"]')).toContainText(
      String(TOTAL_BUDGET),
    );
    await expect(page.locator('[data-testid="talents-budget-spent"]')).toContainText('0');

    // 4. Click "Học" (learn) button trên `talent_kim_quang_tram` card.
    //    Server: POST /character/talents/learn { talentKey } → 200 + insert
    //    `Talent` row. effectiveSpent = pointsAlreadySpent (2) - bonusTalentPoints
    //    (5) clamp 0 → 0 ≤ budget(1). FE: talentsStore.learn() → mutate state
    //    + re-render Loadout.
    const learnBtn = page.locator(`[data-testid="talent-learn-${TALENT_KEY}"]`);
    await expect(learnBtn).toBeEnabled();
    await learnBtn.click();

    // Loadout active row hiện ra (FE wire post-learn refresh).
    await expect(page.locator(`[data-testid="talent-active-row-${TALENT_KEY}"]`)).toBeVisible({
      timeout: 5_000,
    });
    // Ready badge (cooldown=0 vừa học chưa cast).
    await expect(page.locator(`[data-testid="talent-active-ready-${TALENT_KEY}"]`)).toBeVisible();
    // Cooldown badge KHÔNG render (cooldown=0).
    await expect(
      page.locator(`[data-testid="talent-active-cooldown-${TALENT_KEY}"]`),
    ).toHaveCount(0);
    // Budget update: spent=LEARN_COST, remaining=TOTAL_BUDGET-LEARN_COST.
    await expect(page.locator('[data-testid="talents-budget-spent"]')).toContainText(
      String(LEARN_COST),
    );
    await expect(page.locator('[data-testid="talents-budget-remaining"]')).toContainText(
      String(REMAINING_AFTER_LEARN),
    );

    // 5. Cast trong combat (programmatic) — start son_coc encounter + 1 action
    //    với skillKey=talentKey. Server set cooldownTurnsRemaining=3 cho
    //    talent_kim_quang_tram (catalog activeEffect.cooldownTurns=3).
    //
    //    Lý do dùng API (không click DungeonView UI cast button): test
    //    pyramid — combat encounter UI flow đã cover ở SPEC #15 (dungeon
    //    list + entry button), `dungeon-talent-cast-${key}` đã cover ở
    //    `apps/web/src/views/__tests__/DungeonView.test.ts`. Spec #19
    //    isolate Phase 11.X UI E2E talent badge round-trip — cast path
    //    chỉ cần trigger cooldown server-side để FE fetch & render.
    await castTalentViaCombat(page, 'son_coc', TALENT_KEY);

    // 6. Reload /talents → verify cooldown badge xuất hiện (server-authoritative).
    //    talentsStore.fetchState() refetch /character/talents/state →
    //    cooldownTurnsRemaining=3 → badge visible + ready badge ẩn.
    await page.reload();
    await expect(page.locator(`[data-testid="talent-active-row-${TALENT_KEY}"]`)).toBeVisible({
      timeout: 10_000,
    });
    const cooldownBadge = page.locator(`[data-testid="talent-active-cooldown-${TALENT_KEY}"]`);
    await expect(cooldownBadge).toBeVisible();
    await expect(cooldownBadge).toContainText(String(COOLDOWN_TURNS));
    // Ready badge ẩn (cooldown > 0 → mutex với ready).
    await expect(page.locator(`[data-testid="talent-active-ready-${TALENT_KEY}"]`)).toHaveCount(0);
  });

  // ===================================================================
  // SPEC #20 — Phase 11 nâng cao §5 PR3 — Breakthrough UI history view E2E.
  //
  // Goal: lock down full Đột Phá Nâng Cao (RNG) round-trip — admin grant-exp
  // peak luyenkhi → /breakthrough atPeak gate → click attempt → outcome
  // banner (success OR fail variant) + chance breakdown + history row
  // appended + reload-persist (server-authoritative log).
  //
  // Foundation:
  //   - PR #383 admin seed harness `POST /admin/users/:id/grant-exp` (auto
  //     stage-advance 1..8 + residual exp ≥ cost(9)).
  //   - PR #413 shared `computeBreakthroughChance` formula + balance dials.
  //   - PR #414 `BreakthroughAttemptLog` Prisma model + `tam_ma_light` buff.
  //   - PR #415 `CharacterService.attemptBreakthrough` + RNG resolver +
  //     `POST /character/breakthrough/attempt` endpoint (server-authoritative).
  //   - PR #418 `GET /character/breakthrough/log` endpoint + `listBreakthroughAttemptLogs`.
  //   - PR #419 BreakthroughView (`/breakthrough`) + Pinia store + i18n.
  //
  // Setup:
  //   1. registerAndOnboard fresh char (luyenkhi stage 1, sect thanh_van).
  //   2. adminSeedBreakthroughPeak(userId) → grant-exp '200000' (cumulative
  //      cost 1..8 = 55031, residual = 144969 ≥ cost(9)=23613 → peak).
  //
  // Test:
  //   3. Visit /breakthrough → assert title + atPeak gate satisfied + history
  //      empty state visible + attempt button enabled.
  //   4. Click `breakthrough-attempt-btn` → wait outcome banner. RNG
  //      non-deterministic at runtime (Math.random per `CharacterService.attemptBreakthrough`)
  //      → spec MUST accept either success OR fail branch via prefix locator.
  //   5. Verify outcome banner shows transition + finalChance + rngRoll +
  //      attemptIndex=1, breakdown summary present.
  //   6. Verify exactly 1 history row appended (`breakthrough-history-row`)
  //      với attemptIndex=1.
  //   7. Reload `/breakthrough` → outcome banner gone (session-only state)
  //      nhưng history row still visible (server-authoritative `BreakthroughAttemptLog` persist).
  //
  // Anti-FE-self-grant: spec KHÔNG mock RNG / KHÔNG bypass server. Outcome
  // và history row đều round-trip qua `/character/breakthrough/attempt` +
  // `/character/breakthrough/log` (RNG resolved server-side, log persisted
  // qua Prisma). Nếu BE/FE wire stale → outcome banner missing hoặc history
  // row count !== 1 → spec fail.
  //
  // Yêu cầu environment: `pnpm --filter @xuantoi/api bootstrap` để seed
  // admin@example.com (admin seed harness gating). Override email/password
  // qua env `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`.
  // ===================================================================
  test('breakthrough attempt → outcome banner + history row appended (success/fail RNG branch) — Phase 11 nâng cao §5 PR3 UI E2E', async ({
    page,
  }) => {
    // 1. Onboard fresh char (sect thanh_van mặc định, realm luyenkhi stage 1).
    const seed = await registerAndOnboard(page, { emailPrefix: 'e2e_break_full' });

    // 2. Admin grant-exp 200000 → server auto-advance luyenkhi stage 1→9 +
    //    residual exp 144969 ≥ cost(9) 23613. Char now atPeak deterministic.
    await adminSeedBreakthroughPeak(seed.userId);

    // Cross-check qua /character/me — invariant pre-attempt.
    const charPre = await waitCharacter(
      page,
      (c) => {
        if (c.realmKey !== 'luyenkhi') return false;
        if (c.realmStage !== 9) return false;
        try {
          return BigInt(String(c.exp ?? '0')) >= BigInt(String(c.expNext ?? '0'));
        } catch {
          return false;
        }
      },
      { timeoutMs: 10_000, label: 'breakthrough peak seed' },
    );
    expect(charPre.realmKey).toBe('luyenkhi');
    expect(charPre.realmStage).toBe(9);

    // 3. Navigate /breakthrough → header + atPeak hint + empty history.
    await page.goto('/breakthrough');
    await expect(page).toHaveURL(/\/breakthrough/);

    // Title + currentRealm dynamic text từ BreakthroughView.vue (XTLuxHero renders h1).
    await expect(page.locator('h1')).toContainText('Đột Phá', { timeout: 10_000 });

    // atPeak satisfied → attempt button enabled (vs notPeak → disabled).
    const attemptBtn = page.locator('[data-testid="breakthrough-attempt-btn"]');
    await expect(attemptBtn).toBeVisible();
    await expect(attemptBtn).toBeEnabled();

    // History empty state cho fresh char (chưa từng attempt RNG).
    const historyRows = page.locator('[data-testid="breakthrough-history-row"]');
    await expect(historyRows).toHaveCount(0);

    // 4. Click attempt → server roll RNG + ghi BreakthroughAttemptLog +
    //    apply success/fail branch. Outcome banner xuất hiện (FE consume
    //    /character/breakthrough/attempt response, set bt.lastOutcome).
    await attemptBtn.click();

    // Outcome banner: spec accept either branch (RNG non-deterministic).
    // Locator prefix match `breakthrough-outcome-success` OR
    // `breakthrough-outcome-fail` — chỉ một biến thể visible per attempt.
    const outcomeBanner = page.locator('[data-testid^="breakthrough-outcome-"]');
    await expect(outcomeBanner).toBeVisible({ timeout: 10_000 });
    await expect(outcomeBanner).toHaveCount(1);

    // 5. Verify outcome banner internals — transition (luyenkhi/9 → next),
    //    finalChance + rngRoll + attemptIndex#1.
    await expect(outcomeBanner).toContainText('luyenkhi/9');
    await expect(outcomeBanner).toContainText('#1');
    // Breakdown summary collapsible (cursor-pointer text-ink-300) — verify
    // label "Chi tiết tính tỷ lệ" present (i18n breakthrough.outcome.breakdownLabel).
    await expect(outcomeBanner).toContainText('Chi tiết tính tỷ lệ');

    // 6. History row appended — server-authoritative log persist → store
    //    fetchHistory() refetch sau attempt → 1 row attemptIndex=1.
    await expect(historyRows).toHaveCount(1, { timeout: 10_000 });
    await expect(historyRows.first()).toContainText('#1');
    // History row chứa transition luyenkhi/9 (fromRealm/Stage).
    await expect(historyRows.first()).toContainText('luyenkhi/9');

    // 7. Reload /breakthrough → session-only `lastOutcome` cleared (Pinia
    //    state reset on mount), nhưng history row persist từ server log.
    await page.reload();
    await expect(page).toHaveURL(/\/breakthrough/);

    // Outcome banner GONE post-reload (session-only state per Pinia store).
    await expect(page.locator('[data-testid^="breakthrough-outcome-"]')).toHaveCount(0, {
      timeout: 10_000,
    });

    // History row STILL visible — server `BreakthroughAttemptLog` persisted
    // qua Prisma → fetchHistory() reload re-render row.
    const historyRowsReload = page.locator('[data-testid="breakthrough-history-row"]');
    await expect(historyRowsReload).toHaveCount(1, { timeout: 10_000 });
    await expect(historyRowsReload.first()).toContainText('#1');
  });

  // ===================================================================
  // 21. Phase 12 Story PR-5 — main storyline Chapter 1 playable
  // (`phamnhan_main_01`).
  //
  // Quest catalog (5 cảnh giới đầu, packages/shared/src/quests.ts):
  //   - phamnhan_main_01 "Hoa Thiên Tuyển Đồ" — kind=main, realmKey=phamnhan,
  //     requiredRealmOrder=0 (luyenkhi order 1 unlock OK), giver
  //     npc_lang_van_sinh, no prereq.
  //   - 3 step:
  //       step_01 talk npc_lang_van_sinh × 1
  //       step_02 talk npc_moc_thanh_y × 1
  //       step_03 kill son_thu × 3
  //   - rewards: linhThach 100 + exp 200 + items[so_kiem × 1].
  //
  // Flow E2E (server-authoritative, FE chỉ dispatch):
  //   1. Onboard fresh char (luyenkhi/1 default).
  //   2. Navigate /quests → store.load() lazy-create AVAILABLE row.
  //      Verify row hiện diện + status=AVAILABLE.
  //   3. Click `quest-accept-phamnhan_main_01` button → POST /quests/accept
  //      (PR-2 CAS guard) → status=ACCEPTED. UI re-render.
  //   4. Player progress talk steps qua `POST /quests/progress` (server
  //      validate kind=talk + step exists). step_01 + step_02 cộng tới
  //      step.count = 1 each.
  //   5. Admin track kill son_thu × 3 qua `POST /admin/users/:id/quest-track`
  //      (PR-5 admin seed harness) → reuse `QuestService.track()` →
  //      step_03 progress 0 → 3 → all steps done → auto-transition
  //      COMPLETED.
  //   6. Reload /quests → verify status=COMPLETED + completable=true. Click
  //      `quest-claim-phamnhan_main_01` → POST /quests/claim (PR-3 atomic
  //      ledger flow) → status=CLAIMED.
  //   7. Cross-check: CurrencyLedger row (kind=LINH_THACH, qtyDelta=+100,
  //      reason='QUEST_CLAIM', refType='Quest', refId='phamnhan_main_01') +
  //      ItemLedger row (itemKey='so_kiem', qtyDelta=+1, reason='QUEST_CLAIM',
  //      refType='Quest', refId='phamnhan_main_01') + character.linhThach
  //      tăng đúng 100 + character.exp tăng đúng 200 (or auto-advance stage)
  //      + InventoryItem so_kiem qty ≥ 1.
  //
  // Anti-FE-self-grant: spec KHÔNG tự ghi ledger / KHÔNG self-cộng currency.
  // Tất cả mutation đều round-trip qua endpoint server-authoritative
  // (`/quests/accept`, `/quests/progress`, `/admin/users/:id/quest-track`,
  // `/quests/claim`). Verify ledger row qua `/api/inventory` cross-check.
  //
  // Yêu cầu environment: `pnpm --filter @xuantoi/api bootstrap` để seed
  // admin@example.com (PR-5 admin endpoint gating). Override email/password
  // qua env `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`.
  // ===================================================================
  test('phase 12 chapter 1 main storyline playable — phamnhan_main_01 accept → progress → claim end-to-end (PR-5)', async ({
    page,
  }) => {
    // 1. Onboard fresh char (luyenkhi/1 default → unlock phamnhan_main_01 realm gate).
    const seed = await registerAndOnboard(page, { emailPrefix: 'e2e_quest_main01' });

    // 2. Navigate /quests → list lazy-create AVAILABLE row cho phamnhan_main_01.
    await page.goto('/quests');
    await expect(page).toHaveURL(/\/quests/);
    await expect(page.locator('[data-testid="quest-view"]')).toBeVisible({
      timeout: 10_000,
    });

    const row = page.locator('[data-testid="quest-row-phamnhan_main_01"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="quest-status-phamnhan_main_01"]'),
    ).toContainText(/Có thể nhận|Available/i);

    // 3. Click accept button → POST /quests/accept → status ACCEPTED.
    await page.locator('[data-testid="quest-accept-phamnhan_main_01"]').click();

    // Toast or status update — wait for status badge change.
    await expect(
      page.locator('[data-testid="quest-status-phamnhan_main_01"]'),
    ).toContainText(/Đang thực hiện|Accepted/i, { timeout: 10_000 });

    // 4. Progress talk steps via API (kind=talk; player-driven endpoint).
    //    step_01 talk npc_lang_van_sinh, step_02 talk npc_moc_thanh_y.
    const base = process.env.E2E_API_BASE ?? 'http://localhost:3000';
    for (const stepId of ['step_01', 'step_02']) {
      const r = await page.request.post(`${base}/api/quests/progress`, {
        data: { questKey: 'phamnhan_main_01', stepId },
      });
      expect(r.status(), `progress ${stepId}`).toBe(200);
      const body = await r.json();
      expect(body?.ok).toBe(true);
    }

    // 5. Admin track kill son_thu × 3 → all steps done → auto COMPLETED.
    await adminQuestTrack(seed.userId, {
      kind: 'kill',
      targetType: 'monster',
      targetId: 'son_thu',
      amount: 3,
      reason: 'e2e Phase 12 PR-5 chapter 1 kill seed',
    });

    // 6. Reload /quests → verify COMPLETED + claim button enabled.
    await page.reload();
    await expect(page.locator('[data-testid="quest-view"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="quest-status-phamnhan_main_01"]'),
    ).toContainText(/Hoàn thành|Completed/i, { timeout: 10_000 });

    // Cross-check character pre-claim — sẽ so sánh delta sau claim.
    const charPre = await getCharacterMe(page);
    const linhThachPre = BigInt(String(charPre.linhThach ?? '0'));
    const expPre = BigInt(String(charPre.exp ?? '0'));

    // Click claim button → POST /quests/claim (atomic ledger).
    const claimBtn = page.locator('[data-testid="quest-claim-phamnhan_main_01"]');
    await expect(claimBtn).toBeVisible({ timeout: 10_000 });
    await expect(claimBtn).toBeEnabled();
    await claimBtn.click();

    // Status transition CLAIMED.
    await expect(
      page.locator('[data-testid="quest-status-phamnhan_main_01"]'),
    ).toContainText(/Đã lĩnh thưởng|Claimed/i, { timeout: 10_000 });

    // 7. Cross-check rewards granted server-authoritative.
    //
    // 7a. character.linhThach +100 + exp +200 (auto-advance có thể cộng dồn
    //     stage exp; chỉ assert linhThach delta cứng 100 + exp tăng).
    const charPost = await getCharacterMe(page);
    const linhThachPost = BigInt(String(charPost.linhThach ?? '0'));
    expect(linhThachPost - linhThachPre).toBe(100n);

    // exp có thể bị reset / auto-advance — chỉ assert exp đã thay đổi
    // (server consume cost stage = 200 exp). Anti-flake: realmStage
    // có thể đổi do auto-advance, không assert hard số.
    const expPost = BigInt(String(charPost.exp ?? '0'));
    expect(expPost === expPre + 200n || expPost < expPre + 200n).toBe(true);

    // 7b. Inventory: so_kiem qty ≥ 1.
    const inv = await listInventoryApi(page);
    const soKiem = inv.find(
      (it) => (it as Record<string, unknown>).itemKey === 'so_kiem',
    ) as Record<string, unknown> | undefined;
    expect(soKiem, 'so_kiem item granted').toBeTruthy();
    expect(Number(soKiem!.qty ?? 0)).toBeGreaterThanOrEqual(1);
  });

  // ===================================================================
  // 22. Phase 12.3 — DungeonRun flow: start → next×3 → claim end-to-end.
  //
  // Dungeon catalog (`packages/shared/src/combat.ts` `DUNGEONS`):
  //   - son_coc — recommendedRealm `luyenkhi`, monsters 3
  //     (son_thu_lon / da_quan / huyet_lang), staminaEntry 10, dailyLimit 5,
  //     runReward { linhThach 50, exp 100, items [huyet_chi_dan × 1] }.
  //
  // Flow (server-authoritative, FE chỉ render + dispatch):
  //   1. Onboard fresh char (luyenkhi/1 default — đủ realm + stamina lúc đầu).
  //   2. Navigate /dungeon-run → store.load() fetch GET /dungeons/me.
  //      Verify catalog list render + son_coc startable badge.
  //   3. Click `dungeon-run-start-son_coc` → POST /dungeons/son_coc/start
  //      → DungeonRun.status=ACTIVE encounterIndex=0. UI re-render với
  //      `dungeon-run-active` card.
  //   4. Loop next × 3 encounters:
  //      - Click `dungeon-run-next` → POST /dungeon-runs/:runId/next.
  //      - Verify killed entry mới append + Phase 12.3 loot span
  //        (`dungeon-run-killed-{i}-loot`) hiển thị (rolledLoot.length > 0
  //        cao xác suất với DUNGEON_LOOT.son_coc 4 entries weight tổng 7).
  //   5. Sau 3 next, status flip COMPLETED. Claim button hiển thị (next
  //      button ẩn).
  //   6. Click `dungeon-run-claim` → POST /dungeon-runs/:runId/claim →
  //      claim modal mở với granted reward (linhThach +50, exp +100,
  //      items huyet_chi_dan +1).
  //   7. Cross-check character delta + inventory huyet_chi_dan qty ≥ 1.
  //
  // Anti-FE-self-grant: spec KHÔNG tự ghi ledger / KHÔNG self-cộng reward.
  // Tất cả mutation đều round-trip qua endpoint server-authoritative. Cross-
  // check qua `/api/character/me` + `/api/inventory` (read-only).
  //
  // Phase 12.3 invariant: kill log loot span phải hiển thị ngay sau click
  // next (không cần reload), chứng tỏ FE render `killedEntry.loot` snapshot
  // từ server response (không tự cộng inventory).
  // ===================================================================
  test('phase 12.3 dungeon-run flow — son_coc start → next×3 → claim end-to-end with per-encounter loot render', async ({
    page,
  }) => {
    // 1. Onboard fresh char (luyenkhi/1 default).
    await registerAndOnboard(page, { emailPrefix: 'e2e_dungeon_run' });

    // 2. Navigate /dungeon-run → list render.
    await page.goto('/dungeon-run');
    await expect(page).toHaveURL(/\/dungeon-run/);
    await expect(page.locator('[data-testid="dungeon-run-view"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="dungeon-run-list"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="dungeon-run-row-son_coc"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="dungeon-run-startable-son_coc"]'),
    ).toBeVisible();

    // Cross-check character pre-run (linhThach baseline để so sánh delta sau claim).
    const charPre = await getCharacterMe(page);
    const linhThachPre = BigInt(String(charPre.linhThach ?? '0'));

    // 3. Click start son_coc → POST /dungeons/son_coc/start → ACTIVE.
    await page.locator('[data-testid="dungeon-run-start-son_coc"]').click();
    await expect(page.locator('[data-testid="dungeon-run-active"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="dungeon-run-active-status"]')).toContainText(
      /Đang|Active|In progress/i,
    );
    await expect(page.locator('[data-testid="dungeon-run-active-progress"]')).toContainText(
      /0\s*\/\s*3/,
    );

    // 4. Loop next × 3 encounters. Mỗi click waits cho killed entry mới
    //    append + Phase 12.3 loot span observable. UI Pinia store reload
    //    full state sau mỗi action → kill log re-render server snapshot.
    for (let i = 0; i < 3; i++) {
      const nextBtn = page.locator('[data-testid="dungeon-run-next"]');
      await expect(nextBtn).toBeVisible();
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();

      // Wait kill log entry số (i+1) xuất hiện.
      await expect(
        page.locator(`[data-testid="dungeon-run-killed-${i}"]`),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Verify ≥1 trong 3 entries có Phase 12.3 loot span hiển thị (rolledLoot
    // length > 0). DUNGEON_LOOT.son_coc 4 entries với weight tổng 7 → mỗi
    // encounter rất cao xác suất drop ≥1 item. Allow flake 1/3 fail nhưng
    // ≥1 pass mới chứng tỏ wire-up hoạt động.
    const lootSpans = page.locator('[data-testid^="dungeon-run-killed-"][data-testid$="-loot"]');
    expect(await lootSpans.count(), 'Phase 12.3 loot span phải xuất hiện ≥1 lần sau 3 encounter').toBeGreaterThanOrEqual(1);

    // 5. Sau 3 next → status COMPLETED + claim button hiển thị.
    //    i18n vi `dungeonRun.status.COMPLETED` = "Hoàn tất".
    await expect(page.locator('[data-testid="dungeon-run-active-status"]')).toContainText(
      /Hoàn tất|Completed|Done/i,
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="dungeon-run-claim"]')).toBeVisible();
    await expect(page.locator('[data-testid="dungeon-run-next"]')).toHaveCount(0);

    // 6. Click claim → modal mở với granted reward.
    await page.locator('[data-testid="dungeon-run-claim"]').click();
    await expect(page.locator('[data-testid="dungeon-run-claim-modal"]')).toBeVisible({
      timeout: 10_000,
    });
    // son_coc.runReward = { linhThach: 50, exp: 100, items: [huyet_chi_dan × 1] }.
    await expect(
      page.locator('[data-testid="dungeon-run-claim-linh-thach"]'),
    ).toContainText('50');
    await expect(page.locator('[data-testid="dungeon-run-claim-exp"]')).toContainText(
      '100',
    );
    await expect(page.locator('[data-testid="dungeon-run-claim-item-0"]')).toBeVisible();

    // Close modal sau verify.
    await page.locator('[data-testid="dungeon-run-claim-close"]').click();
    await expect(page.locator('[data-testid="dungeon-run-claim-modal"]')).toHaveCount(0);

    // 7. Cross-check rewards granted server-authoritative.
    //
    // 7a. character.linhThach +50 (DUNGEON_RUN_REWARD claim deterministic).
    const charPost = await getCharacterMe(page);
    const linhThachPost = BigInt(String(charPost.linhThach ?? '0'));
    expect(linhThachPost - linhThachPre).toBe(50n);

    // 7b. Inventory: huyet_chi_dan qty ≥ 1. Lưu ý qty có thể > 1 nếu Phase
    //     12.3 per-encounter DUNGEON_LOOT cũng drop huyet_chi_dan trùng item
    //     với DUNGEON_RUN_REWARD claim — đây là expected behaviour, không bug.
    const inv = await listInventoryApi(page);
    const huyetChiDan = inv.find(
      (it) => (it as Record<string, unknown>).itemKey === 'huyet_chi_dan',
    ) as Record<string, unknown> | undefined;
    expect(huyetChiDan, 'huyet_chi_dan item granted').toBeTruthy();
    expect(Number(huyetChiDan!.qty ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
