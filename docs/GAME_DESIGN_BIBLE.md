# Xuân Tôi — Game Design Bible

> **Status**: Long-term design blueprint. **Source of truth for *intent***, not for runtime behavior.
> Code on `main` + `docs/AI_HANDOFF_REPORT.md` is the source of truth for *current behavior*.
> When this file conflicts with code: trust code, then update this file.
> Sister docs: [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md), [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md), [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md), [`BALANCE_MODEL.md`](./BALANCE_MODEL.md), [`LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md). Historical blueprint: [`04`](./04_TECH_STACK_VA_DATA_MODEL.md), [`05`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md).

Mục tiêu file này: cho AI/dev tiếp theo hiểu **Xuân Tôi muốn trở thành cái gì** trong 12-24 tháng tới, để mọi PR mới cân nhắc xem có lệch trục cảm xúc / progression / economy hay không.

---

## A. TẦM NHÌN GAME

### A.1 Một câu giới thiệu

> Xuân Tôi là **MUD tu tiên web/PWA** phong cách cổ phong thủy mặc — chơi nhẹ, dài hạn, đọc nhiều văn bản, ít nút bấm; trục cảm xúc đi từ **phàm nhân lạc lõng → tu sĩ chân tu → cao nhân lập tông → chiến trường cảnh giới → chí tôn vĩnh hằng**.

### A.2 Người chơi vào game để làm gì?

| Lát cắt | Cảm xúc cốt lõi | Hoạt động chính |
|---|---|---|
| **Phàm nhân (5 phút đầu)** | Tò mò, định hình "tôi là ai trong giới này" | Onboarding (A Linh), tạo nhân vật, chọn tông môn, tu luyện thử, đọc câu thiền mở đầu |
| **Tu sĩ sơ kỳ (1-7 ngày đầu)** | Nuôi dưỡng nhịp "đi làm, về nhà cày tu luyện, đọc log đột phá" | Daily login, daily mission, dungeon thường, đột phá Luyện Khí → Trúc Cơ |
| **Tu sĩ trung kỳ (7-30 ngày)** | Cảm giác trở thành "người của tông môn", có vai trò xã hội | Sect quest, sect chat, world boss đầu tiên, đột phá Kim Đan |
| **Cao nhân (30-90 ngày)** | Có quyền lực, có tài sản, có tiếng nói | Phường Thị, sect treasury, leaderboard, đột phá Nguyên Anh / Hoá Thần |
| **Tông môn / chiến trường (90 ngày+)** | Tham gia mục tiêu lớn hơn bản thân | Sect war (async), arena season, world boss elite, raid bí cảnh |
| **Late-game / tiên giới (6 tháng+)** | Đua đỉnh, để lại dấu ấn | Đột phá tier `nhan_tien` → `tien_gioi` → `hon_nguyen` → `vinh_hang`, achievement title, season legacy |

### A.3 Fantasy chính

Người chơi **không** kỳ vọng combat skill cao (đây không phải MMORPG action). Người chơi muốn:

1. **Cảm giác tích lũy có thật** — mỗi tick tu luyện cộng EXP do server tính, log đột phá có timestamp, ledger đầy đủ. Không "fake number".
2. **Cảm giác cổ phong** — câu thiền random, tên cảnh giới Hán Việt, không icon hoa hoè, không số liệu Tây phương quá lộ liễu.
3. **Cảm giác xã hội nhẹ nhàng** — tông môn chat, world chat, mail từ Thiên Đạo Sứ Giả, chứ không phải party voice chat real-time.
4. **Cảm giác công bằng** — server là nguồn sự thật, không P2W ngoài tiện ích, top leaderboard là người thật chơi đều.

### A.4 Điểm khác biệt so với game tu tiên thông thường

| Game tu tiên web phổ biến | Xuân Tôi |
|---|---|
| Combat real-time, click-spam, auto-AFK | Tu luyện passive tick (30s), combat lượt, không AFK farm fake |
| P2W mạnh, gacha cốt lõi, hệ thống vợ/pet quay xác suất | **Chưa có gacha** ở MVP. Topup chỉ đổi `tienNgoc` (premium currency) cho tiện ích/cosmetic; reward có ledger, admin approve thủ công |
| Quá nhiều tab, quá nhiều icon | UI 3 cột tối giản, mỗi view có 1 mục tiêu rõ ràng |
| Reset server liên tục để hút nạp | Live-service dài hạn. Có season nhưng **không reset progression** — chỉ reset leaderboard / event |
| Closed source, cheat tràn lan | Backend authoritative, mọi mutation tiền/vật phẩm có ledger, anti-cheat dựa trên invariant |

### A.5 Phong cách trình bày

- **Ngôn ngữ**: VI mặc định + EN qua `vue-i18n`. Từ vựng tu tiên: **Hán Việt thuần** (Luyện Khí, Trúc Cơ, Kim Đan, Hoá Thần, Linh Thạch, Tiên Ngọc, Tông Môn, Phường Thị). Tránh dịch sang tiếng Anh giữa câu (e.g. không viết "boss spawn" trong text gameplay; viết "Yêu Vương xuất thế").
- **Color palette**: thuỷ mặc — đen, trắng ngà, xanh lục đạm, vàng kim cho cao cấp.
- **Sound**: optional, không bắt buộc. Future phase có thể thêm chuông gõ tu luyện.
- **Asset**: tự vẽ / mua bản quyền. Không dùng asset Mộng Tu Tiên gốc (đã đổi tên/logo cho hợp pháp lý — xem `README.md`).

---

## B. CORE LOOP

### B.0 Phase 21 story retention layer

Phase 21 extends the core loop into a chapter-gated story layer: quest progress → cultivation/gear/dungeon/boss growth → realm/battle-power/story gate → next chapter. The first 30–60 minutes should teach character creation, A Linh/Hoa Thiên onboarding, first cultivation, spiritual-root discovery, first main quest, first dungeon/skill, sect identity, and light social/party hooks without requiring docs reading.


### B.1 Vòng lặp cốt lõi (server-authoritative)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│   │ TU LUYỆN     │ →  │ NHIỆM VỤ /   │ →  │ DUNGEON /    │              │
│   │ (EXP tick)   │    │ SECT QUEST   │    │ BOSS / EVENT │              │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│          ↓                   ↓                   ↓                       │
│   ┌──────────────────────────────────────────────────────┐              │
│   │  REWARD: linhThach / tienNgoc / item / congHien      │              │
│   │  (mọi grant đi qua CurrencyService + Ledger)         │              │
│   └──────────────────────────┬───────────────────────────┘              │
│                              ↓                                           │
│                ┌──────────────────────────┐                              │
│                │ SPEND: equip / pill /    │                              │
│                │ market / sect contribute │                              │
│                └──────────────┬───────────┘                              │
│                               ↓                                          │
│                ┌──────────────────────────┐                              │
│                │ POWER UP → ĐỘT PHÁ →     │                              │
│                │ MỞ DUNGEON / EVENT MỚI   │                              │
│                └──────────────────────────┘                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Mọi mũi tên trong loop trên **bắt buộc đi qua server**. FE chỉ render. Vi phạm = bug critical.

### B.1.1 Phase 21 chapter gate loop

Phase 21 story chapters follow a stricter gate loop than early placeholder catalogs:

```text
quest/story beat → tu luyện → nâng trang bị → story dungeon/boss →
đạt realm/cultivation/battle-power gate → mở chapter kế tiếp
```

Chapter unlock is not “claim previous quest only”. Each chapter catalog entry must combine:

- story prerequisite (`requiredMainQuestKey`, `previousChapterKey`, story flag),
- strength prerequisite (`requiredRealmKey`, optional cultivation stage, optional battle power),
- system prerequisite when relevant (dungeon clear, boss defeated, sect rank, elemental affinity).

Current Phase 21 implementation is allowed to seed gates statically first. Any gate not enforceable by existing runtime must be marked as a runtime follow-up, but it still belongs in catalog tests so future UI/API work cannot silently remove it.

### B.2 Loop theo thời gian thực của người chơi

#### B.2.1 5 phút đầu (first-time user experience)

Mục tiêu: người chơi hiểu "tôi là tu sĩ, tôi đang tu luyện, tôi sẽ mạnh lên".

1. `/auth` — đăng ký bằng email + password. Random câu thiền welcome (`packages/shared/src/proverbs.ts`).
2. `/onboarding` — A Linh NPC dẫn dắt:
   - Tạo nhân vật (`name` unique, chọn `realmKey = phamnhan` mặc định).
   - Chọn 1 trong 3 tông môn mặc định (Thanh Vân / Huyền Thuỷ / Tu La — bootstrap idempotent từ `apps/api/src/bootstrap.ts`).
3. `/home` — GameHome shell 3 cột:
   - Hero card: tên, cảnh giới `phamnhan-1`, EXP/cap, 5 chỉ số (power/spirit/speed/luck/daoVan).
   - Bấm "Nhập Định" → set `cultivating = true` → cron `cultivation-tick` (BullMQ, 30s/tick) cộng EXP.
   - Sau ~3 phút → tự đột phá `phamnhan` → `luyenkhi-1` (vì `phamnhan` chỉ 1 trọng, ngưỡng EXP thấp).
4. NextActionPanel gợi ý:
   - "Vào Luyện Khí Đường (`/dungeon`) đánh Sơn Cốc."
   - "Nhận quà đăng nhập (`/home` DailyLoginCard)."

**Exit criteria 5p**: người chơi đã thấy ít nhất 1 lần đột phá + ít nhất 1 lần claim reward + biết `/dungeon` ở đâu.

#### B.2.2 1 ngày đầu (D1)

Mục tiêu: hoàn thành 1 chu kỳ daily.

1. **Daily Login** claim 1 lần, ghi `DailyLoginClaim` (idempotent theo `Asia/Ho_Chi_Minh`).
2. **Daily mission** (5 mission) — gain EXP / cultivate seconds / kill monster / clear dungeon / chat.
3. **Dungeon** (`son_coc` → `hac_lam`) đánh tích trữ `linhThach` + drop item.
4. **Inventory**: equip item phẩm `LINH` đầu tiên → power tăng → cảm xúc "tôi mạnh lên".
5. **Sect chat / World chat**: gõ 1 dòng "Hảo!" để hoàn thành mission CHAT_MESSAGE.
6. **Đột phá** xong `luyenkhi` 1-9 → claim mission BREAKTHROUGH.

**Exit criteria D1**: claim ít nhất 3/5 daily, đạt `truc_co-1`, có ít nhất 1 trang bị `LINH`.

#### B.2.3 7 ngày đầu (D7)

Mục tiêu: gắn kết với tông môn + đạt vùng late-pham trung kỳ.

1. **Sect contribution** đầu tiên (donate `linhThach` vào sect treasury, hoặc complete sect mission trong phase 13).
2. **World boss** đánh ít nhất 1 lần, được chia reward theo `BossDamage.totalDamage`.
3. **Phường Thị (market)** — list 1 item đầu tiên hoặc mua 1 item từ player khác (kiểm chứng escrow + 5% fee).
4. **GiftCode** — claim ít nhất 1 mã do admin phát.
5. **Topup** — (tuỳ chọn) test flow nạp `tienNgoc` (manual approval qua admin).
6. **Đột phá** đạt `kim_dan` hoặc `nguyen_anh` (tuỳ activeness).

**Exit criteria D7**: đạt ít nhất `kim_dan-3`, có ≥1 tương tác sect, ≥1 tương tác market, đã chạm vào ít nhất 5/13 view.

#### B.2.4 30 ngày đầu (D30)

Mục tiêu: trở thành "regular", bắt đầu đua leaderboard.

1. **Leaderboard top-50 power** — người chơi đã thấy mình ở vị trí nào.
2. **Achievement / title** đầu tiên (phase 11+).
3. **Equipment refine / công pháp** lần đầu (phase 11+).
4. **Sect role** (đệ tử → trưởng lão — phase 13).
5. **Đột phá** `hoa_than` → `luyen_hu`.

**Exit criteria D30**: ở top-50 power hoặc top-50 contribution, có ≥1 title, ≥1 trang bị refine.

#### B.2.5 Late-game (D90+)

Mục tiêu: đua đỉnh + để lại dấu ấn.

1. **Sect war season** — phase 13.
2. **Arena season** — phase 14.
3. **Bí cảnh / raid** — phase 12.
4. **Battle pass / season legacy** — phase 15.
5. **Đột phá** `nhan_tien` → `tien_gioi` → `hon_nguyen` → late `vinh_hang`.

**Exit criteria** (target, not enforced): retention D90 ≥ 25% trong số người vượt D7.

---

## C. PROGRESSION DESIGN

### C.1 Cảnh giới (Realm)

Catalog: `packages/shared/src/realms.ts`. **28 đại cảnh giới**, mỗi cảnh giới 9 trọng (trừ `phamnhan` 1 trọng + `hu_khong_chi_ton` 1 trọng).

**4 tier lớn**:

| Tier | Cảnh giới | Đặc điểm gameplay |
|---|---|---|
| `pham` | phamnhan → do_kiep (10 realm) | Tu luyện cơ bản, dungeon thường, drop item phẩm `PHAM`/`LINH`/`HUYEN` |
| `nhan_tien` | nhan_tien → thien_tien (3 realm) | Mở khoá bí cảnh trung cấp, sect war, item phẩm `TIEN` bắt đầu xuất hiện |
| `tien_gioi` | huyen_tien → chuan_thanh (5 realm) | Mở elite raid, arena season, item phẩm `TIEN`/`THAN` |
| `hon_nguyen` | thanh_nhan → thien_dao (3 realm) | Late-game, drop `THAN` thường, season legendary |
| `ban_nguyen` | ban_nguyen → vo_thuy (3 realm) | Endgame |
| `vinh_hang` | vo_chung → hu_khong_chi_ton (3 realm) | Đỉnh, dành cho người đua season dài |

(Chi tiết tier-name xem `packages/shared/src/enums.ts` `RealmTier`.)

### C.2 EXP curve & power curve

Hiện trạng (xem `docs/BALANCE.md` chi tiết):

- **Tu luyện**: cron `cultivation-tick` 30s/tick. EXP/tick = `cultivationRateForRealm(realm, base=5) + floor(spirit/4)`. Rate scale theo `1.45^order`.
- **EXP cost stage 1**: `expCost(order) = round(1000 * 1.6^order)`. Stage tiếp theo `× 1.4`.
- **Stage 1..8**: auto-break trong cùng realm khi EXP vượt cap.
- **Stage 9**: KHÔNG auto-break. Cần `POST /api/character/breakthrough` để qua realm kế.

**Long-term tuning rules** (xem `docs/BALANCE_MODEL.md`):

- Time-to-`luyenkhi-9` (D1 active): ~2-3h tu luyện thuần (chấp nhận được).
- Time-to-`kim_dan-1` (D7 active 1-2h/ngày): hợp lý.
- Time-to-`hoa_than` cho người không nạp: ~30-45 ngày active.
- Top tier cảnh giới (`vinh_hang`+) chỉ đạt được sau ≥6 tháng + season buff.

### C.3 Breakthrough cost & flavor

Hiện trạng: stage 9 break sang realm kế chỉ check EXP. Không có thiên kiếp/tâm ma.

**Long-term (phase 11)**:

| Mechanic | Mô tả | Khi nào thêm |
|---|---|---|
| **Thiên Kiếp** | Khi break tier (e.g. pham → nhan_tien), trigger combat 1 lượt với "Thiên Kiếp Lôi" — fail thì rớt EXP về stage 9 + cooldown 1h. | Phase 11 |
| **Tâm Ma** | Khi break realm `nhan_tien+`, có % (3-10%) trigger debuff `cultivating: false` 30 phút + đòi hỏi pill `TAM_MA_DAN` để clear. | Phase 11 |
| **Ngộ Đạo** | Mỗi 3 realm có 1 lần "ngộ đạo" tự động grant 1 talent point (xem C.5). | Phase 11 |

### C.4 Linh căn & Thể chất

**Phase 11.0 catalog foundation đã có (session 9r-8 PR — `packages/shared/src/spiritual-root.ts`)**: 5 grade `pham/linh/huyen/tien/than` + helper `elementMultiplier`/`elementGenerates`/`elementOvercomes`/`characterSkillElementBonus`/`validateSpiritualRootState`. Runtime (schema migration + onboarding roll service + cultivation/combat wire) defer Phase 11.1+ runtime PR.

**Phase 22.1 Ngũ Hành Build Depth**: Ngũ Hành is now a build meta layer rather than only skill flavor. Shared helpers expose the full tương sinh/tương khắc matrix, build recommendations combine primary/secondary linh căn with target weakness/resistance, skill combo rules reward same-element/generating/counter/hybrid chains modestly, boss/dungeon profiles surface weakness/resist/cap hints, and equipment exposes an optional `equipmentElement` affinity hook for Phase 23.1 gear depth. This phase deliberately does **not** add Book II–V story content.

- **Linh căn** (`spiritualRoot`): roll 1 lần khi tạo character, 5 grade (`pham`, `linh`, `huyen`, `tien`, `than`). Ảnh hưởng `cultivationMultiplier` (1.0× phàm → 1.8× thần) + `statBonusPercent` (+0% phàm → +30% thần) + `secondaryElementCount` (0 phàm → 4 thần — toàn linh căn). Re-roll bằng item `linh_can_dan` (cost cao, drop hiếm endgame). Roll RNG distribution: pham 60% / linh 25% / huyen 10% / tien 4% / than 1% (`SPIRITUAL_ROOT_GRADE_DEFS[].rollWeight`). Re-roll chỉ TĂNG grade, không giảm (server-authoritative anti-cheese).
- **Element multiplier** Ngũ Hành (catalog-level wired phase 11.0):
  - Tương khắc 1.30 (Kim → Mộc → Thổ → Thuỷ → Hoả → Kim).
  - Tương sinh 1.20 (Kim → Thuỷ → Mộc → Hoả → Thổ → Kim).
  - Bị khắc 0.70 / Bị sinh 0.85 / Cùng hệ 0.90 / Vô hệ 1.00.
  - Bonus character: +0.10 nếu skill cùng `primaryElement`, +0.05 nếu skill ∈ `secondaryElements`.
- **Thể chất** (`physique`): static, gain qua quest milestone. Ảnh hưởng `hpMax`, `staminaMax`, `def` base. Phase 11+ TBD.

Lý do tách 2 cái: **linh căn = lottery** (RNG khi tạo), **thể chất = grindable** (quest milestone) → tránh gating người không may mắn.

### C.5 Công pháp / Skill / Thần thông

Hiện trạng (`packages/shared/src/combat.ts`):

- 10 skill: `basic_attack` + 3 skill × 3 sect (Thanh Vân kiếm, Huyền Thuỷ thuỷ trị, Tu La huyết tế).
- Mỗi character chọn skill theo `sectId`.

**Phase 11.1.A catalog foundation đã có (session 9r-9 PR — `packages/shared/src/cultivation-methods.ts`)**: 12 method baseline (1 pham starter + 5 huyen Ngũ Hành + 3 tien sect-locked + 3 than endgame) với fields `grade/element/expMultiplier/statBonus/unlockRealm/requiredSect/source/passiveSkillKeys/forbiddenElements`. Runtime (Prisma model + service + UI) defer Phase 11.1.B PR sau.

**Phase 11.2.A catalog foundation đã có (session 9r-10 PR — `packages/shared/src/skill-templates.ts`)**: 26 SkillTemplate 1-1 với `SKILLS` (combat.ts) — 5 tier `basic/intermediate/advanced/master/legendary` với mastery curve generator (level 1..maxMastery), `SkillUnlockRequirement` 6-kind (`realm/sect/method/item/quest/event`), `SkillEvolutionBranch` cho legendary endgame customization, helper `applyMasteryEffect(template, masteryLevel, baseSkill)` → effective skill (atkScale/mpCost/cooldownTurns post-mastery). Runtime (Prisma `CharacterSkill` + service learn/upgradeMastery/equipSkill + UI mastery panel + wire vào CombatService) defer Phase 11.2.B PR sau.

**Long-term (phase 11+)**:

- **CultivationMethod** (DB model mới): công pháp người chơi đang luyện. Multiplier `cultivationRate` (1.0 pham → 1.8 than) + statBonus baseline (% hp/mp/atk/def). Phải drop từ dungeon/boss/event hoặc sect-shop để có. Sect-locked tier `tien` chỉ học khi cùng sect; `forbiddenElements` chống xung khắc Ngũ Hành.
- **CharacterSkill** (DB model mới): skill đã unlock + masteryLevel (1..maxMastery theo tier). Upgrade qua linhThach + skillShard (drop từ `skill_book` item consume → ItemLedger). Wire `applyMasteryEffect` vào `CombatService.computeSkillDamage` để post-mastery atkScale/mpCost effective.
- **Talent / Thần thông**: 5-7 cái grand passive, unlock qua "ngộ đạo" milestone hoặc raid drop.

### C.6 Trang bị / Đan dược / Luyện khí / Phù lục

| Hệ thống | Hiện trạng | Long-term |
|---|---|---|
| **Trang bị** | 9 slot, 5 quality, +bonuses. **Phase 23.2** thêm progression metadata derive cho equipment: 28 cảnh giới → 10 tầng trang bị, grade I/II/III trong tier, `requiredRealmOrder` server-authoritative khi equip, `powerBudget/computedPowerScore`, cap cường hóa/socket theo tier+quality. Quality chỉ là độ hiếm trong cùng tier, không phải cấp sức mạnh toàn game. **Phase 23.3** layer Set Bonus 2/4/6 + 5-kind Gear Resonance (same-tier/enhance/quality/elemental/hybrid) capped tổng ≤30%. **Phase 23.4** chốt economy/resource sink: ghép phẩm 3 món cùng tier/slot/quality/family → 1 món quality cao hơn (PHAM→LINH→…→THAN, THAN không ghép tiếp, không ghép khác tier hoặc lên tier cao), phân giải đồ cũ lấy material + linh thạch (yield strictly < merge cost — anti-infinite-sink), cường hóa/khảm/tháo gem/reforge có cost curve + cap đồng nhất, bảo hộ phù là monetization-safe hook cho Phase 25.1. | Phase 25.1 wire `refine_protection_charm` vào Battle Pass / Monthly Card; Phase 23.5 (optional) Pháp Bảo / Advanced Artifact System; gem/refine/reforge/enchant/Ngũ Hành vẫn là build depth trong tier, không thay thế cảnh giới. |
| **Linh thạch (gem)** | Phase 11.4.A catalog đã có (`packages/shared/src/gems.ts`) — 25 gem 5 element × 5 grade `PHAM..THAN` + helpers `composeSocketBonus/combineGems/canSocketGem/gemUpgradePathCost` | Phase 11.4.B: `Equipment.sockets[]` Json + service `socketGem/unsocketGem/combineGems` qua ItemLedger; wire `composeSocketBonus` vào `CharacterStatService.computeStats` |
| **Đan dược** | `PILL_HP/MP/EXP` consume one-shot. Phase 11.X.A catalog luyện đan đã có (`packages/shared/src/alchemy.ts`) — 13 recipe baseline cover toàn bộ pill HP/MP/EXP × PHAM..THAN; helpers `simulateAlchemyAttempt/simulateAlchemyBulk` deterministic | Phase 11.X.B: module `apps/api/src/modules/alchemy/` + `Character.alchemyFurnaceLevel` + `AlchemyAttempt` Prisma model + service `attemptAlchemy` qua ItemLedger atomic + idempotency qua attemptId |
| **Luyện khí (refine)** | Phase 11.5.A catalog đã có (`packages/shared/src/refine.ts`) — 15 cấp 3 stage `safe/risky/extreme` × 5 level + helpers `getRefineLevelDef/getRefineAttemptCost/getRefineStatMultiplier/refineLevelsByStage/getRefinePathCostMin/simulateRefineAttempt` deterministic | Phase 11.5.B: `Equipment.refineLevel Int @default(0)` + `Equipment.refineHistory Json?` + service `refineEquipment` qua ItemLedger atomic + wire `getRefineStatMultiplier` vào `CharacterStatService.computeStats` |
| **Phù lục / Trận pháp** | Không có | Phase 12: phù lục consumable single-use, trận pháp deploy ở dungeon |
| **Thiên Kiếp / Tâm Ma** | Phase 11.6.A catalog đã có (`packages/shared/src/tribulation.ts`) — 8 kiếp baseline 5 type (`lei/phong/bang/hoa/tam`) × 4 severity (`minor/major/heavenly/saint`) cover realm threshold `kim_dan→thanh_nhan`; helpers `simulateTribulation/computeTribulationReward/computeTribulationFailurePenalty` deterministic | Phase 11.6.B: Prisma `Tribulation { id, characterId, status, attemptCount, cooldownAt, taoMaActive }` + service `attemptTribulation` hook vào BreakthroughService + Tâm Ma debuff modifier (-10% atk + block tu luyện) vào CombatService + cooldown enforcement |
| **Tài năng / Thần Thông** | Phase 11.7.A catalog đã có (`packages/shared/src/talents.ts`) — 14 talent baseline = 7 passive (atk/hp/regen/def/drop/exp/anti-counter) + 7 active "thần thông" (AOE damage / single CC / heal / DOT / true damage / utility) cover 5 element + neutral; helpers `talentsAvailableAtRealm/computeTalentPointBudget (mỗi 3 realm = 1 point) /canCharacterLearnTalent/composePassiveTalentMods/simulateActiveTalent` deterministic | Phase 11.7.B: Prisma `CharacterTalent { id, characterId, talentKey, learnedAt, mpCooldownUntil }` UNIQUE `(characterId, talentKey)` + service `learnTalent (validate qua canCharacterLearnTalent + persist + giảm point budget)` + `useActiveTalent (check cd + mp + simulateActiveTalent + apply combat hook + atomic mp consume)` + wire `composePassiveTalentMods` vào `CharacterStatService.computeStats` last layer + REST `GET /talent/available, POST /talent/learn, POST /talent/use, GET /talent/points` |

### C.7 Achievement / Title

Hiện trạng: `Character.title` field (string) nhưng chưa có catalog. Phase 11+ thêm:

- **TitleDef** (static catalog). Unlock condition (e.g. "Đạt Kim Đan", "Top 10 boss"). Cosmetic only — không buff stat.
- **AchievementDef** (static catalog). Unlock progress lưu DB (`AchievementProgress`).

---

## D. GAMEPLAY SYSTEMS

Mỗi system dưới đây có 1 mục: **Hiện trạng** (code đã có gì) + **Long-term** (phase nào, deps).

### D.1 Character system

**Hiện trạng** (`apps/api/src/modules/character/`, `prisma/schema.prisma:Character`):

- 5 chỉ số chính: `power`, `spirit`, `speed`, `luck`, `daoVan` (đạo vận).
- 3 chỉ số tài nguyên: `hp/hpMax`, `mp/mpMax`, `stamina/staminaMax`.
- 5 currency: `linhThach` (BigInt), `tienNgoc` (Int), `tienNgocKhoa` (Int — locked premium), `tienTe` (Int), `nguyenThach` (Int), `congHien` (Int — sect contrib), `congDuc`, `chienCongTongMon`.
- `realmKey` + `realmStage` (1..9). Auto-break stage 1-8.
- `cultivating: Boolean` toggle.
- `sectId: String?` reference.

**Power calculation** (hiện trạng):

```
power = base.power + sum(equippedItems.bonuses.atk)  // gần đúng
```

Đề xuất **chuẩn hoá** (phase 11):

```
power = base.power
       + spirit * 0.5
       + sum(equip.atk)
       + cultivationMethod.atkBonus
       + skill.atkBonus
       + title.atkBonus           // sẽ là 0 vì title cosmetic-only
realmTierMultiplier = 1.0 + (RealmTier index) * 0.15
finalPower = round(power * realmTierMultiplier)
```

Lý do chuẩn hoá: leaderboard & arena cần 1 hàm `computePower(char)` deterministic, dễ unit test.

### D.2 Cultivation system

**Hiện trạng**:

- 1 mode: bấm "Nhập Định" → server tick. Không có offline cultivation.
- Stamina regen `+3 / tick` cho mọi character (kể cả không Nhập Định).

**Long-term**:

- **Phase 11 — Động phủ**: nhân vật vào "động phủ" (cave) → buff `cultivationRate × 1.3` nhưng không thể combat trong khi đang ở đó. Cooldown 6h.
- **Phase 11 — Offline cultivation**: gain EXP cap trong 8h offline đầu (theo realm); sau 8h tốc độ giảm 50%. Tránh AFK 24/7 OP nhưng thưởng người không chơi liên tục.
- **Phase 11 — Buff/debuff stack**: model `CharacterBuff` (key, expiresAt, source) — nguồn buff: pill, sect aura, event, world boss kill bonus.
- **Phase 11 — Thiên kiếp/Tâm ma**: xem C.3.

### D.3 Combat system

**Hiện trạng** (`apps/api/src/modules/combat/`):

- PvE turn-based vs monster trong dungeon.
- Encounter state lưu DB (`Encounter` model, JSON state + log).
- Skill active 1-shot, không cooldown.
- Damage formula: `max(1, atk * (1 + skillBonus) - def * 0.5) * (rand 0.85..1.15)`.

**Long-term**:

- **Phase 11 — Skill cooldown + MP cost**: đã có `mpCost` field. Cần thêm `cooldownTurns`.
- **Phase 11 — Active vs passive split**: passive skill apply lên power computation, active skill chọn trong combat.
- **Phase 12 — Boss elite mechanic**: HP shield phase, AOE attack (đánh nhiều người cùng lúc), enrage timer.
- **Phase 14 — Async PvP (Arena)**: snapshot `CharacterCombatSnapshot` (power/skills/equip ở thời điểm join arena queue) → đánh deterministic vs snapshot khác. Không real-time. Defensive snapshot tránh ghost-fight.
- **NEVER (chưa lập kế hoạch)**: real-time PvP, party combat, dungeon co-op (cần infra real-time + tooling chống cheat — quá đắt cho ROI hiện tại).

### D.4 Inventory / Equipment

**Hiện trạng** (`InventoryItem` + `ItemLedger`):

- 9 equip slot (`EquipSlot` enum).
- `qty: Int` cho stackable item.
- `equippedSlot: EquipSlot?` — unique constraint `(characterId, equippedSlot)` đảm bảo 1 slot 1 item.
- Mọi mutation qty ghi `ItemLedger` (Phase 9 đã có).

**Long-term**:

- **Phase 11 — Refine & Enchant**: thêm field `refineLevel: Int @default(0)`, `enchantSuffixKey: String?`. Refine consume `nguyenThach` + `linhThach`. Có % fail (broken → -1 level).
- **Phase 11 — Soul-bind**: equip 1 lần → bind, không list market. Optional unbind item.
- **Phase 12 — Durability**: thêm `durability: Int @default(100)`. Combat tiêu hao 1/lượt. Repair tốn `linhThach`.
- **Phase 12 — Item set bonus**: 4-6 item cùng `setKey` → buff bonus. Catalog static.

### D.5 Mission / Quest / Story

**Hiện trạng** (`packages/shared/src/missions.ts`):

- 12 mission static (5 DAILY + 4 WEEKLY + 3 ONCE).
- 10 `goalKind` (GAIN_EXP, CULTIVATE_SECONDS, KILL_MONSTER, …).
- Reset cron theo TZ `Asia/Ho_Chi_Minh`.

**Long-term**:

- **Phase 10 — Mission scale**: nâng catalog lên 30+ daily, 15+ weekly, 20+ once.
- **Phase 11 — Quest chain**: model mới `Quest` + `QuestStep` + `QuestProgress`. Chain step có thứ tự, branching theo lựa chọn.
- **Phase 11 — Story chapter**: model `StoryChapter` + `NpcDialogue`. NPC dialogue text VI/EN, có branching chọn lời thoại (không ảnh hưởng mạnh stat — chỉ flavor + 1-2 reward khác nhau).
- **Phase 13 — Sect mission**: model `SectMission`, contribution gain `congHien`.
- **Phase 15 — Event mission**: tạm thời, expire theo `EventConfig`.

### D.6 Map / Dungeon / World

**Hiện trạng** (`packages/shared/src/combat.ts`):

- 3 dungeon (`son_coc`, `hac_lam`, `yeu_thu_dong`) chia theo realm gợi ý.
- Không có concept "map region" rõ ràng. Drop từ `DUNGEON_LOOT[<dungeon-key>]`.

**Long-term**:

- **Phase 12 — MapRegion**: 8-12 vùng (Sơn Cốc, Hắc Lâm, Yêu Thú Động, Phù Đồ Thành, Bắc Cực Băng Vực, Linh Sơn, Cực Tây Sa Mạc, Đông Hải, Hồng Hoang Tuyệt Địa, …). Mỗi region có:
  - `unlockRealmKey`: realm tối thiểu để vào.
  - `dungeons[]`: list `DungeonTemplate`.
  - `bossKeys[]`: world boss xuất hiện ở vùng này.
  - `flavor`: text flavor + background image.
- **Phase 12 — DungeonTemplate** (DB): khác với `DungeonDef` static — template generate `DungeonRun` per character, có seed RNG, độ khó scale theo party size (future).
- **Phase 12 — DungeonRun**: instance — character X vào template Y → tạo `DungeonRun` lưu state. Re-enter cho phép nếu chưa thua/bỏ.
- **Phase 12 — Encounter** (đã có): mở rộng để 1 dungeon-run = nhiều encounter.
- **Phase 12 — DropTable** (DB): hiện đang static. Move dần sang DB để admin tune mà không cần redeploy. Ledger drop ghi `LootRoll`.

### D.7 Sect / Tông môn

**Hiện trạng** (`Sect` model):

- 1 character thuộc 1 sect.
- Field: `name`, `description`, `level`, `treasuryLinhThach`, `leaderId`.
- 3 sect bootstrap: Thanh Vân / Huyền Thuỷ / Tu La.
- KHÔNG có role/permission trong sect, KHÔNG có sect mission, KHÔNG có sect war.

**Long-term — "Sect 2.0" (phase 13)**:

| Concept | Mô tả | Model mới |
|---|---|---|
| **Role** | LEADER / ELDER / CORE / DISCIPLE | `SectMember.role` field |
| **Contribution ledger** | mọi gain/spend `congHien` đều ghi log | `SectContributionLedger` |
| **Sect treasury ledger** | mọi gain/spend `treasuryLinhThach` ghi log | `SectTreasuryLedger` |
| **Sect mission** | leader assign cho member | `SectMission` |
| **Sect shop** | dùng `congHien` mua item exclusive | static catalog `SECT_SHOP` |
| **Sect boss** | boss riêng cho sect, member nào trong sect đều thấy chung HP | reuse `WorldBoss` với `scopeKey = sectId` |
| **Sect war (async)** | season-based, sect vs sect | `SectWar`, `SectWarMatch` |
| **Permission audit** | mọi action cấp role / kick / promote ghi audit | reuse `AdminAuditLog` với `actor = sect leader` hoặc thêm `SectAuditLog` riêng |

### D.8 Boss / World event

**Hiện trạng** (`WorldBoss` + `BossDamage`):

- Boss spawn admin manual (PR #36).
- HP shared. Damage attribution per character.
- Reward distribute theo `% damage` qua `distributeRewards` helper.
- Status: `ACTIVE` / `DEFEATED` / `EXPIRED`.

**Long-term**:

- **Phase 12 — Auto-spawn schedule**: BullMQ repeatable job spawn boss theo region + thời gian (e.g. Huyết Ma Chúa mỗi 3h ở Hắc Lâm).
- **Phase 12 — Reward idempotency**: thêm model `BossRewardClaim(bossId, characterId, claimedAt)` unique → tránh double-claim khi user retry.
- **Phase 12 — Anti-abuse**: damage cap per hit (ngăn injection), ledger reward, smart alert nếu 1 character damage > X% trong 1 boss.
- **Phase 14 — Boss ranking**: leaderboard theo `BossDamage.totalDamage` per season.

### D.9 Market / Economy

**Hiện trạng** (`Listing` model):

- P2P listing item: seller list giá `linhThach`/unit, buyer mua → escrow.
- Tax/fee: 5% (PR earlier).
- Status: `ACTIVE` / `SOLD` / `CANCELLED`.
- KHÔNG có price floor/ceiling, KHÔNG có anomaly detection.

**Long-term**:

- **Phase 16 — Price guard**: dynamic price floor/ceiling theo `itemKey` (catalog `MARKET_PRICE_BAND`). List ngoài band → reject.
- **Phase 16 — Daily listing cap**: 1 character ≤ N listing/day để chống wash trade.
- **Phase 16 — Tax dial**: tax 5% có thể override theo event (e.g. event tax 0% trong 24h).
- **Phase 16 — Anomaly detection**: cron `economy-anomaly-scanner` quét `CurrencyLedger + ItemLedger` tìm pattern lạ (e.g. 1 character +10M `linhThach` từ 1 listing duy nhất, market wash với 2 alt account, …).

Chi tiết: xem [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md).

### D.10 Mail / Gift code / Topup / Admin

**Hiện trạng**:

- `Mail` model: admin gửi, claim reward (linhThach + tienNgoc + exp + items JSON), expire.
- `GiftCode` + `GiftCodeRedemption`: unique per (code, user).
- `TopupOrder` PENDING → admin approve / reject → grant tienNgoc.
- `AdminAuditLog`: mọi admin action ghi.
- `@RequireAdmin()` decorator + role split MOD vs ADMIN.

**Long-term**:

- **Phase 15 — Mail batch send**: admin gửi mail batch theo filter user (e.g. "all kim_dan+ realm"). Hiện tại 1-by-1.
- **Phase 15 — Auto mail triggers**: ledger anomaly → auto mail admin alert.
- **Phase 16 — Topup payment integration**: hiện manual VietQR. Future tích hợp Stripe / VNPAY / MoMo (cần legal review trước, không tự ý làm).
- **Phase 17 — Admin dashboard 2.0**: realtime metric (online concurrent, ledger flow, listing volume), không chỉ filter list.

### D.11 Social / Realtime

**Hiện trạng**:

- WS gateway `/ws` cookie auth.
- Channel: WORLD (rate-limit 8/30s qua Redis), SECT (sectId scope).
- ChatMessage history.

**Long-term**:

- **Phase 11 — Personal channel (whisper)**: 1-1 chat. Persist 7 ngày.
- **Phase 11 — Player report / block**: model `PlayerReport(reporterId, targetId, reason, evidence, status)`. Mod review.
- **Phase 11 — ChatModerationLog**: 1 message bị flagged → log → mod queue.
- **Phase 11 — Auto-mod bộ từ cấm**: đơn giản regex blacklist + warning (không claim 100% chính xác). Cần i18n.

### D.12 Leaderboard / Season

**Hiện trạng**:

- `/leaderboard/power` top-50 by power.
- `/profile/:id` public.
- KHÔNG có season concept.

**Long-term**:

- **Phase 14 — Season**: model `Season(key, startsAt, endsAt, status)`. Mỗi season có:
  - `SeasonProgress(seasonId, characterId, progressJson)`.
  - `SeasonRewardClaim(seasonId, characterId, tier, claimedAt)` — idempotent claim cuối season.
- **Phase 14 — Multiple leaderboard tracks**: power, sect-contribution, boss-damage, arena-rating, market-volume.
- **Phase 14 — Reset rules**: progression KHÔNG reset. Chỉ leaderboard + reward + arena rating reset.
- **Phase 14 — Anti-cheat**: ledger phân tích theo season window.

### D.13 Live ops

Xem [`LIVE_OPS_MODEL.md`](./LIVE_OPS_MODEL.md). Tóm tắt:

- **EventConfig** model: định nghĩa event live (Halloween, Lễ hội Trung Thu, Tết, …).
- **Announcement**: marquee real-time qua WS.
- **MaintenanceWindow**: maintenance mode banner + 503 từ `/api/*`.
- **FeatureFlag**: bật/tắt module mà không deploy.
- **ConfigVersion**: snapshot config từng version để rollback.
- **Admin dashboard**: scheduler cho event + announcement.

---

## E. ECONOMY MODEL (tóm tắt)

Chi tiết: [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md).

### E.1 Currency types

| Currency | Đơn vị | Source chính | Sink chính | Premium? |
|---|---|---|---|---|
| `linhThach` (BigInt) | Đồng tiền chính | tu luyện reward, dungeon drop, mission, mail | market buy, equip refine, sect donate | No (soft) |
| `tienNgoc` (Int) | Premium | topup admin approve, gift code | shop premium item, refine speed, cosmetic | Yes (hard) |
| `tienNgocKhoa` (Int) | Locked premium | event/login reward — không trade | sub-set sink của tienNgoc | Yes (locked) |
| `tienTe` (Int) | Reserved | (chưa dùng) | (chưa dùng) | TBD |
| `nguyenThach` (Int) | Refine material | dungeon drop, refine result | refine, alchemy | No |
| `congHien` (Int) | Sect contribution | sect mission, sect donate | sect shop | No |
| `congDuc` (Int) | Reserved (đạo đức) | (chưa dùng) | (chưa dùng) | TBD |
| `chienCongTongMon` (Int) | Sect war point | sect war kill | season reward | No |

**Long-term thêm**:

- `eventToken_{eventKey}` (dynamic) — event-scoped consumable currency. Reset cuối event.

### E.2 Invariants (bắt buộc, không bao giờ vi phạm)

1. **Backend authoritative**: FE KHÔNG bao giờ tự cộng/trừ currency hoặc EXP. Mọi grant/consume gọi `CurrencyService` server-side.
2. **Mọi mutation có ledger**: `CurrencyLedger` cho currency, `ItemLedger` cho item. `delta` có dấu (âm = trừ).
3. **Reward idempotent**: claim reward 2 lần phải = claim 1 lần. Dùng:
   - `MissionProgress.claimed` boolean.
   - `DailyLoginClaim` unique `(characterId, claimDateLocal)`.
   - `GiftCodeRedemption` unique `(giftCodeId, userId)`.
   - **Future**: `RewardClaimLog(characterId, sourceType, sourceKey, claimedAt)` unique — single source of truth.
4. **Admin grant ghi `actorUserId`**: phân biệt grant tự nhiên vs admin grant.
5. **No silent failure**: nếu service fail giữa chừng, transaction rollback, KHÔNG để ledger lệch state.

### E.3 Anti-abuse

- **Daily reward cap** (phase 16): 1 character/ngày tối đa nhận X linhThach từ "soft source" (cultivation+dungeon+mission). Vượt → log + alert.
- **Market wash detection** (phase 16): cron quét `Listing` cùng `(itemKey, sellerId, buyerId)` xuất hiện > 3 lần/ngày → flag.
- **Topup velocity** (phase 16): 1 user nạp > X VND/ngày → manual review.

---

## F. CONTENT PIPELINE (tóm tắt)

Chi tiết: [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md).

### F.1 Content type & catalog location

| Content | Location | Loại |
|---|---|---|
| Item | `packages/shared/src/items.ts` | Static |
| Skill | `packages/shared/src/combat.ts` `SKILLS` | Static |
| Monster | `packages/shared/src/combat.ts` `MONSTERS` | Static |
| Dungeon | `packages/shared/src/combat.ts` `DUNGEONS` + `DUNGEON_LOOT` | Static |
| Mission | `packages/shared/src/missions.ts` | Static |
| Boss | `packages/shared/src/boss.ts` | Static |
| Realm | `packages/shared/src/realms.ts` | Static |
| Proverb | `packages/shared/src/proverbs.ts` | Static |
| **Quest** | (future) DB `Quest` + `QuestStep` | DB (phase 11) |
| **Story chapter** | (future) DB `StoryChapter` + `NpcDialogue` | DB (phase 11) |
| **Map region** | (future) DB `MapRegion` | DB (phase 12) |
| **DungeonTemplate** | (future) DB | DB (phase 12) |
| **Title** | (future) static `TITLES` | Static (phase 11) |
| **Achievement** | (future) static `ACHIEVEMENTS` | Static (phase 11) |
| **EventConfig** | (future) DB | DB (phase 15) |

### F.2 Mỗi content cần

- `key` snake_case unique (immutable sau ngày phát hành đầu tiên).
- `name` VI + `nameEn` EN (i18n compatible).
- `description` VI + `descriptionEn`.
- `unlockCondition` (e.g. `requiredRealm`, `requiredQuestKey`).
- `tier` / `quality` (PHAM..THAN).
- `source` (drop / craft / event / shop).
- `sink` (consume / equip / sell-vendor).
- `balanceNote` (math reasoning, link sang BALANCE_MODEL.md).
- **Test catalog integrity**: `pnpm test` ở `@xuantoi/shared` đã có `catalog.test.ts` — bắt key duplicate, slot coverage, etc.
- **Seed idempotent**: nếu là DB content, seed phải re-runnable.

---

## G. KIẾN TRÚC LIÊN KẾT (tổng quan)

Để AI sau hiểu **tại sao** các module này phụ thuộc nhau:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   AUTH      │ →   │  CHARACTER  │ ←   │   SECT      │
│ (User+JWT)  │     │ (state core)│     │ (sectId fk) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ↓                   ↓                   ↓
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ CULTIVATION │     │ COMBAT/     │     │  MISSION    │
│ (cron tick) │     │ DUNGEON/    │     │ (progress + │
│             │     │ BOSS        │     │  reward)    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └─────────┬─────────┴─────────┬─────────┘
                 ↓                   ↓
         ┌──────────────────────────────────┐
         │    CURRENCY SERVICE              │
         │    (single source of mutation)   │
         │      ↓ writes to                 │
         │    CurrencyLedger / ItemLedger   │
         └──────────────────────────────────┘
                 ↑                   ↑
       ┌─────────┴─────────┐ ┌──────┴──────────────┐
       │ MARKET / SHOP     │ │ MAIL / GIFT / TOPUP │
       └───────────────────┘ └─────────────────────┘
                 ↑
       ┌─────────┴─────────┐
       │ ADMIN (audit log) │
       └───────────────────┘

       (REALTIME WS — orthogonal: emit cultivate:tick,
        chat:msg, mission:progress, boss update, mail unread)
```

**Quy tắc bất khả xâm phạm**:

1. KHÔNG có module nào ngoài `CurrencyService` được phép update `Character.linhThach/tienNgoc/...` trực tiếp.
2. KHÔNG có module nào ngoài `InventoryService` được phép update `InventoryItem.qty` trực tiếp.
3. KHÔNG có endpoint nào public (non-admin) được phép pass `actorUserId` từ FE — luôn server-side.
4. WS event chỉ dùng để **đẩy** state đã commit — không phải để **gây ra** mutation.

---

## H. MODULE DEPENDENCY RULE

> **AI/dev sau ĐỌC KỸ phần này. Nhiều bug nghiêm trọng đến từ làm module C khi B chưa xong.**

| Module muốn build | Phải có trước (hard prerequisite) |
|---|---|
| **Arena Season (phase 14)** | Combat snapshot deterministic (D.3), leaderboard infra, RewardClaimLog idempotent, anti-cheat alert |
| **Event (phase 15)** | EventConfig model, RewardClaimLog, admin scheduler UI, FeatureFlag |
| **Marketplace nâng cao (phase 16)** | Ledger consistency 100% (CurrencyLedger + ItemLedger phủ mọi path), price band catalog, anomaly cron |
| **Pet / Wife / Gacha** | Drop table DB-backed, RewardClaimLog, balance policy approved (P2W cap), legal review (loot box) |
| **Real-money payment** | Security/legal/payment policy approved, PCI compliance, fraud detection. **Không AI tự ý** |
| **PvP real-time** | Async PvP (arena season) đã ra trước. Nếu chưa có async → KHÔNG bắt đầu real-time |
| **Sect war (phase 13)** | Sect 2.0 role + treasury ledger + sect mission, world boss reward idempotency |
| **Quest chain (phase 11)** | StoryChapter + NpcDialogue model, mission system stable |
| **Refine/enchant (phase 11)** | ItemLedger 100%, refine material drop, balance curve approved |
| **Bí cảnh / DungeonRun (phase 12)** | MapRegion + DungeonTemplate model, Encounter mở rộng |

**Anti-patterns bị cấm**:

- Thêm currency mới mà chưa có `CurrencyKind` enum + ledger path.
- Thêm reward source mới mà chưa idempotent (e.g. claim 2 lần → 2× reward).
- Thêm admin action mà không ghi `AdminAuditLog`.
- Thêm WS event mà chưa có server-side authority check.
- Refactor schema lớn mà không có migration plan + rollback.

---

## I. TEST STRATEGY (high-level)

Chi tiết test plan per module: xem `LONG_TERM_ROADMAP.md` mỗi phase + `BALANCE_MODEL.md`.

| Layer | Tool | Coverage target |
|---|---|---|
| Shared catalog | vitest | 100% key uniqueness, slot coverage, math invariants |
| API service (pure unit) | vitest (mock Prisma) | mọi service ≥ 70% line, mọi error code path |
| API controller (route) | vitest (NestJS testing module) | mọi endpoint ≥ 1 test happy + 1 test auth/permission + 1 test invalid input |
| API integration | vitest + real Postgres + real Redis (CI services) | smoke flow đầu cuối (auth → character → cultivation → dungeon → claim) |
| WS | vitest + socket.io-client real | reconnect, room scope, rate limit |
| Web component | vitest + @testing-library/vue | render + click + i18n |
| E2E | Playwright | golden path (đăng ký → tạo char → tu luyện 1 tick → đột phá) |
| Catalog test | vitest | content tests trong `pnpm test:catalog` (future) |
| Balance test | vitest | curve invariants trong `pnpm test:balance` (future) |
| Smoke beta | `scripts/smoke-beta.mjs` | đầu cuối qua HTTP, dùng trước release |

**Reward / ledger test bắt buộc**:

- Mọi reward source: test `claim → claim again` không double-grant.
- Mọi consume: test `consume more than have` reject.
- Mọi admin action: test audit log row tạo ra với `actorUserId`.

---

## J. PRODUCT PRINCIPLES (immutable)

> **Mọi PR mới BẮT BUỘC đọc và tôn trọng các nguyên tắc dưới. Vi phạm = revert.**

1. **Backend là nguồn sự thật**. FE chỉ render state server emit.
2. **Frontend không tự cộng EXP / tiền / item / cảnh giới**. Optimistic update OK nếu reconcile lại sau ack từ server, nhưng **không** tự tạo state mới.
3. **Reward phải idempotent**. Mọi reward source có 1 cách "claim chỉ 1 lần".
4. **Currency / item thay đổi phải có ledger**. Không có ledger = bug.
5. **Admin action phải có audit log**. `AdminAuditLog` ghi `actor + action + meta + createdAt`.
6. **Route nhạy cảm phải có guard + rate limit**. Auth, admin, market list, chat → guard rõ ràng.
7. **Feature lớn chia thành PR nhỏ**. PR > 500 line phải tách trừ khi không thể.
8. **CI xanh mới qua task khác**. Không merge với CI đỏ trừ khi flake confirmed + retry.
9. **AI_HANDOFF_REPORT luôn cập nhật**. Mỗi PR major append snapshot.
10. **Không AI tự ý làm payment thật / loot box / gacha** — gating bằng legal/policy review.
11. **i18n mọi text production** (VI + EN). Hardcode VI trong template = bug.
12. **Migration phải có rollback note**. Migration chỉ chạy khi DB đã backup.

---

## K. ROADMAP TIẾP THEO (tóm tắt)

Chi tiết: [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md).

| Phase | Tên | Mục tiêu | Status |
|---|---|---|---|
| 0-8 | MVP build | (Historical) | Done — xem [`05`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md) |
| 9 | Closed beta stabilization | Audit + smoke + Playwright + i18n + bug triage | In progress (audit) |
| 10 | Content Scale 1 | Item/skill/monster/dungeon/mission/boss × 2-3× | Next |
| 11 | Progression Depth | Công pháp + skill upgrade + linh căn + thiên kiếp + alchemy + refinery | Next-next |
| 12 | Dungeon & World Map | MapRegion + DungeonRun + bí cảnh + boss by region | Future |
| 13 | Sect 2.0 | Role + mission + shop + treasury ledger + sect war async | Future |
| 14 | Arena Season | Async PvP + ranking + season reward | Future |
| 15 | Live Ops / Event | Scheduler + announcement + battle pass | Future |
| 16 | Economy & Anti-cheat | Ledger checker + anomaly + market guard | Future |
| 17 | Production Operations | Deploy + backup + monitor + runbook + release | Future |

Chiến lược: **không đốt cháy giai đoạn**. Nếu beta phase 9 chưa stable thì KHÔNG nhảy sang phase 11.

---

## L. CHANGELOG OF THIS DOC

- **2026-04-30** — Initial creation. Audit-based, dựa trên code @ `21c06ba`. Author: Devin AI session 9q (docs blueprint refresh PR).
