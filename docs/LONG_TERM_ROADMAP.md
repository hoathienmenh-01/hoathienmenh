# Xuân Tôi — Long-Term Roadmap (Phase 9 → Phase 17)

> **Status**: Long-term roadmap. Source of truth cho **thứ tự build** sau MVP.
> Phase 0..8 (historical MVP roadmap) — xem [`05_KICH_BAN_BUILD_VA_PROMPT_AI.md`](./05_KICH_BAN_BUILD_VA_PROMPT_AI.md).
> Bối cảnh sản phẩm: [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md).

Mục tiêu: AI/dev tiếp theo đọc xong biết **next PR nên làm gì**, **không nên làm gì**, và **làm gì trước khi unlock phase tiếp theo**.

---

## 0. NGUYÊN TẮC ROADMAP

### 0.1 Cách đọc

Mỗi phase có:

1. **Goal**: 1-2 câu mục tiêu.
2. **Entry criteria**: cái gì PHẢI có trước.
3. **Scope**: PR/module trong phase này.
4. **Exit criteria**: bằng chứng phase này đã xong.
5. **Risks**: rủi ro thường gặp.

### 0.2 Quy tắc nhảy phase

- **KHÔNG** mở phase N+1 nếu phase N chưa đủ exit criteria.
- **OK** chạy song song nếu 2 phase độc lập (e.g. phase 10 content scale + phase 11 progression depth có thể parallel nếu giữ data model orthogonal).
- **PR docs / audit / typo fix** lúc nào cũng OK, không phụ thuộc phase.

### 0.3 Quy tắc chia PR

- 1 PR = 1 module / 1 endpoint / 1 mục tiêu rõ ràng.
- PR vượt 500 dòng diff phải có lý do (rare).
- PR tạo Prisma migration phải đi kèm `migration note` (xem section M trong `GAME_DESIGN_BIBLE.md`).
- PR thêm currency/reward path phải đi kèm test idempotency.

---

## Phase 9 — Closed Beta Stabilization

### Goal

Đưa repo từ "chạy được, có test" thành "sẵn sàng mời 50-100 người closed beta thử dài 1-2 tuần mà không vỡ".

### Entry criteria

- ✅ Phase 0-8 done (đã, theo `BETA_CHECKLIST.md`).
- ✅ CI xanh ổn định ≥ 1 tuần.

### Scope

#### 9.1 Audit refresh (recurring)

- Mỗi session đầu phải đọc `AI_HANDOFF_REPORT.md` + `git log` + open PRs.
- Cập nhật snapshot ở đầu `AI_HANDOFF_REPORT.md`.

#### 9.2 Smoke checklist

- `pnpm smoke:beta` — script ở `scripts/smoke-beta.mjs`. Chạy trước mỗi promote release.
- **Mở rộng**: thêm `pnpm smoke:economy` (verify ledger consistency của 1 luồng đầu cuối: cultivate → boss → mail claim → ledger total = 0 ở phía debit-credit).
- **Mở rộng**: thêm `pnpm smoke:admin` (admin grant, mail send, gift code create — tất cả ghi audit).
- **Mở rộng**: thêm `pnpm smoke:ws` (connect WS, nhận tick, reconnect).

#### 9.3 Playwright golden path

- File hiện có: `e2e/golden.spec.ts`.
- Mở rộng: full path từ register → onboarding → home → cultivate 1 tick → đột phá phamnhan → dungeon son_coc → loot → equip → leaderboard.
- Yêu cầu API+Web+Postgres+Redis chạy (E2E_FULL=1 trong CI).

#### 9.4 Bug triage

- Mỗi tuần review issue tracker (GitHub Issues).
- Severity: P0 (block beta) → P3 (cosmetic). P0/P1 fix trong cùng release cycle.

#### 9.5 Mobile/i18n polish

- Test PWA install trên iOS Safari + Android Chrome.
- Verify i18n VI + EN coverage ≥ 95% strings.
- Test dark/light mode (nếu có).
- Test offline fallback (Workbox cache).

#### 9.6 Release checklist

- Cập nhật `docs/QA_CHECKLIST.md` per release.
- Cập nhật `docs/RELEASE_NOTES.md` per release.
- Cập nhật `docs/CHANGELOG.md` per release.

### Exit criteria

- [ ] `pnpm smoke:beta` pass đầu cuối.
- [ ] `pnpm smoke:economy` pass.
- [ ] Playwright golden path pass trên CI (real DB+Redis).
- [ ] Backlog P0 = 0, P1 ≤ 3.
- [ ] CI xanh 14 ngày liên tục.
- [ ] `BETA_CHECKLIST.md` ≥ 95% tick.

### Risks

- **Flaky test** kéo dài → mất tin tưởng. Fix root cause, không retry blindly.
- **i18n drift** — VI thêm key mới mà quên EN. Cần lint script verify parity.
- **Real DB integration test slow** — cân nhắc dùng pg-mem cho unit, postgres real cho integration.

---

## Phase 10 — Content Scale 1

### Goal

Nâng catalog item / skill / monster / dungeon / mission / boss lên 2-3× để người chơi không cảm thấy "chỉ có 3 dungeon".

### Entry criteria

- Phase 9 exit criteria.
- `CONTENT_PIPELINE.md` approved.

### Scope

| Hiện trạng | Target phase 10 |
|---|---|
| 30 item | 80-100 item (phủ 28 realm × 9 slot + pill/ore/artifact mở rộng) |
| 10 skill | 25-30 skill (phủ 3 sect × 8 skill + universal + passive) |
| 9 monster | 30 monster (phủ realm pham → late pham) |
| 3 dungeon | 8-10 dungeon (phủ realm pham → nhan_tien sơ kỳ) |
| 12 mission | 30+ daily, 15+ weekly, 20+ once |
| 0 named boss catalog | 10 named boss (Huyết Ma Chúa, Thiên Ma, Yêu Long Vương, …) |

#### 10.1 PR: items pack 1

- File: `packages/shared/src/items.ts`.
- Thêm 50 item mới (50% PHAM, 25% LINH, 15% HUYEN, 8% TIEN, 2% THAN).
- Mỗi item có VI/EN name + balance note.
- Test catalog update.

#### 10.2 PR: skills pack 1

- File: `packages/shared/src/combat.ts`.
- Thêm 15 skill (5 per sect).
- Phải có `mpCost`, `cooldownTurns` (nếu phase 11 schema cooldown đã merge).

#### 10.3 PR: monsters & dungeons pack 1

- 20 monster mới + 6 dungeon mới.
- `DUNGEON_LOOT` cập nhật weight.

#### 10.4 PR: missions pack 1

- 30+ mission mới.
- Phải tham chiếu tới item/dungeon đã catalog.

#### 10.5 PR: boss catalog

- File mới: `packages/shared/src/boss-catalog.ts` (hoặc mở rộng `boss.ts`).
- 10 named boss với HP curve, drop table, spawn rule (admin manual ở phase 10, auto ở phase 12).

#### 10.6 PR: catalog test consolidation

- `pnpm test:catalog` script tổng (alias `pnpm --filter @xuantoi/shared test`).

### Exit criteria

- [ ] Catalog ≥ 80 item, ≥ 25 skill, ≥ 30 monster, ≥ 8 dungeon, ≥ 65 mission, ≥ 10 boss.
- [ ] Catalog test pass 100%.
- [ ] Power curve tự động compute power_at_realm(realm) từ best-equip available không break BALANCE_MODEL.
- [ ] Drop table balance test (xem `BALANCE_MODEL.md` §3).

### Risks

- **Power inflation**: thêm item mạnh phá curve. Mitigation: balance note + curve test.
- **i18n debt**: chỉ thêm VI mà quên EN. Mitigation: i18n parity test.

### Module phụ thuộc cần xong trước phase 10

- Không có phụ thuộc cứng. Phase 10 chỉ thêm data, không thêm logic mới.

---

## Phase 11 — Progression Depth

### Goal

Thêm depth cho progression: công pháp, skill upgrade, linh căn, thể chất, alchemy, refinery, thiên kiếp/tâm ma, talent.

### Entry criteria

- Phase 9 exit criteria.
- Phase 10 exit criteria (cần data depth trước khi thêm logic depth).

### Scope

#### 11.0 PR: Spiritual Root catalog foundation **(DONE — merged via PR #221, session 9r-8)**

- `packages/shared/src/spiritual-root.ts` NEW — 5-grade tier (`pham/linh/huyen/tien/than`) + helper `elementMultiplier`/`elementGenerates`/`elementOvercomes`/`characterSkillElementBonus`/`validateSpiritualRootState`.
- 43 vitest cover Ngũ Hành cycle (sinh/khắc), grade tier monotonic, multiplier bounds [0.7, 1.3], state validation.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.3 runtime).

#### 11.1.A PR: CultivationMethod catalog foundation **(DONE — session 9r-9, PR #222)**

- `packages/shared/src/cultivation-methods.ts` NEW — 4-grade tier (`pham/huyen/tien/than`) + 12 method baseline (1 starter + 5 huyen Ngũ Hành + 3 tien sect-locked + 3 than endgame).
- Helper: `getCultivationMethodDef(key)`, `methodsByElement(element)`, `methodsForSect(sect)`, `canLearnMethod(method, primaryElement)`.
- 35 vitest cover catalog shape, balance (expMultiplier per grade, statBonus bounds), coverage (5 element + 3 sect + 4 grade), forbiddenElements safety.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.1.B runtime).

#### 11.1.B PR: CultivationMethod runtime **(this PR open — session 9r-12 part 4)**

- `apps/api/prisma/schema.prisma` add `Character.equippedCultivationMethodKey String?` (nullable cho legacy) + new model `CharacterCultivationMethod { id, characterId, methodKey, source, learnedAt }` với `@@unique([characterId, methodKey])` (idempotent learn) + `@@index([characterId])`. Migration `20260502000000_phase_11_1_cultivation_method`.
- `apps/api/src/modules/character/cultivation-method.service.ts` (NEW): `CultivationMethodService` 4 method:
  - `learn(charId, methodKey, source)` validate `realmByKey(c.realmKey).order ≥ realmByKey(method.unlockRealm).order` + sect lock match (qua `SECT_NAME_TO_KEY`) + `forbiddenElements ∌ c.primaryElement`. Idempotent qua P2002 catch.
  - `equip(charId, methodKey)` re-validate + check learned → set `Character.equippedCultivationMethodKey`. Throw `NOT_LEARNED` nếu chưa học.
  - `getState(charId)` list learned + return equipped key. Lazy-grant starter cho legacy character.
  - `grantStarterIfMissing(charId)` idempotent auto-grant + auto-equip `khai_thien_quyet`.
- Pure helper `methodExpMultiplierFor(equippedMethodKey | null): number`.
- Wire vào `CultivationProcessor.process()`: `gain = max(1, round(baseGain × cultivationMul × methodMul))`. Legacy null → methodMul 1.0.
- Wire vào `CharacterService.onboard()`: `await this.cultivationMethod?.grantStarterIfMissing(c.id)` sau khi tạo character (idempotent).
- Controller endpoints `GET /character/cultivation-method` + `POST /character/cultivation-method/equip`.
- 29 vitest mới (23 service + 4 processor compose + 2 onboard hook).

#### 11.1.C PR: CultivationMethod UI display + equip switcher (Pending)

- UI character profile page: equipped method icon + grade + expMultiplier display + tooltip statBonus.
- Modal "Công pháp" list learned methods (có badge tier, source, learnedAt) + button equip → call `POST /character/cultivation-method/equip`.
- Optional 24h cooldown anti-spam re-equip (server-side check `lastEquippedAt`).
- E2E test golden: onboard → expect starter equipped → switch sang method khác (sau khi học).

#### 11.2.A PR: SkillTemplate catalog foundation **(this PR — session 9r-10)**

- `packages/shared/src/skill-templates.ts` NEW (~470 lines) — progression catalog 26 template 1-1 với `SKILLS` (combat.ts).
- 5-tier `SkillTier` (`basic/intermediate/advanced/master/legendary`) với `SKILL_TIER_DEFS` table monotonic (maxMastery 5..10, atkScaleBonusPerLevel 0.05..0.07, mpCostReductionPerLevel 0.04..0.05, baseLinhThachCost 100..2000, hasEvolution chỉ legendary).
- `SkillUnlockRequirement` 6-kind (`realm/sect/method/item/quest/event`) AND-condition + `SkillEvolutionBranch` cho legendary endgame customization.
- 26 template baseline: 12 basic + 10 intermediate + 1 advanced + 1 master + 2 legendary với 4 evolution branches.
- Helper: `getSkillTemplate(key)`, `templatesByTier(tier)`, `templatesByUnlock(kind, ref)`, `applyMasteryEffect(template, masteryLevel, baseSkill)` → `EffectiveSkill`, `masteryUpgradeCost(template, fromLevel, toLevel)`, `findOrphanSkills/findOrphanTemplates/findTierMismatches` integrity checks.
- 63 vitest cover tier shape monotonic + power-creep cap, mastery curve generator, catalog coverage 1-1 với SKILLS, applyMasteryEffect (clamp/throw/monotonic), masteryUpgradeCost, balance global stack rule (atk +100% cap, mp 60% cap).
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.2.B runtime).

#### 11.2.B PR: SkillTemplate runtime **(session 9r-12 part 5, this PR open)**

- Prisma model mới `CharacterSkill { id, characterId, skillKey, masteryLevel (default 1), isEquipped (default false), source, learnedAt }` (composite unique `(characterId, skillKey)`). Migration `20260503000000_phase_11_2_b_character_skill`.
- `CharacterSkillService` (NestJS, 534 LOC) — server-authoritative 7 method: `learn(charId, skillKey, source)` validate `SkillTemplate.unlocks[]` AND-condition (kind='realm'/'sect'/'method'; item/quest/event deferred 11.2.C), idempotent qua P2002 catch. `upgradeMastery(charId, skillKey)` atomic transaction: validate `< maxMastery` + deduct `linhThachCost` qua `CurrencyService.applyTx({reason:'SKILL_UPGRADE'})` + increment `masteryLevel`. `equip(charId, skillKey)` cap `MAX_EQUIPPED_SKILLS=4` (basic_attack exempt). `unequip(charId, skillKey)` idempotent. `getState(charId)` return effective view với `applyMasteryEffect` adjusted (lazy-grant `basic_attack` cho legacy). `grantStarterIfMissing(charId)` idempotent auto-grant + auto-equip. `getEffectiveSkillFor(charId, baseSkill)` helper cho CombatService.
- Wire `applyMasteryEffect` vào `CombatService.action()`: inject `@Optional() CharacterSkillService` → replace direct `skill.atkScale`/`skill.mpCost` đọc baseline → `effective = await characterSkill.getEffectiveSkillFor(char.id, baseSkill)` (fallback `baselineEffective(baseSkill)` khi service không inject).
- `CharacterService.onboard()` gọi `characterSkill.grantStarterIfMissing(c.id)` sau `cultivationMethod.grantStarterIfMissing` — character mới luôn có `basic_attack` mastery=1 equipped.
- Controller endpoints `GET /character/skill` + `POST /character/skill/equip` + `POST /character/skill/unequip` + `POST /character/skill/upgrade-mastery` (Zod validation, error mapping `mapSkillErrorStatus`).
- `+34 vitest` (27 service + 4 combat mastery wire + 3 onboard hook). Skill book drop/consume via `ItemLedger` deferred Phase 11.2.D.

#### 11.2.C PR: Skill Book UI display + equip/unequip/upgrade-mastery wire **(this PR open — Phase 11.2.C UI Skill Book, branch `devin/1777832336-phase-11-2-c-skill-book-ui`)**

- `apps/web/src/api/skill.ts` (NEW, +104) — 4 envelope wrapper `getSkillState() / equipSkill(skillKey) / unequipSkill(skillKey) / upgradeSkillMastery(skillKey)` với type `SkillView/SkillState/SkillUpgradeOut/SkillTier`.
- `apps/web/src/stores/skill.ts` (NEW, +124) — Pinia composition store: state `maxEquipped/learned/loaded/inFlight` + computed `equippedCount` + race-protect via `inFlight: Set<string>` (mỗi skillKey lock riêng) + helper `extractCode(e)` để map `{ code, error.code, response.data.error.code }` → string code.
- `apps/web/src/views/SkillBookView.vue` (NEW, +~420) — auth guard + hydrate; 3 filter dropdown (tier `all|basic|intermediate|advanced|master|legendary`, element `all|kim|moc|thuy|hoa|tho|none`, equipped `all|equipped|unequipped`); skill card grid với tier badge i18n + element badge i18n + equipped badge + mastery row "L/max" + effective ATK scale / MP cost / cooldown turns + 3 button equip/unequip/upgrade với i18n cost label "Thăng (-{cost} LT)" + disabled state khi `inFlight`/mastery=max + toast push success/error mapping `errors.<CODE>` → i18n string.
- `apps/web/src/router/index.ts` (+5) — route `/skill-book` lazy `SkillBookView.vue`.
- `apps/web/src/components/shell/AppShell.vue` (+7) — nav link "術 Pháp Quyển" → `/skill-book`.
- `apps/web/src/i18n/{vi,en}.json` (+~85 keys mỗi locale): `apiFallback.skillState/skillEquip/skillUnequip/skillUpgrade`, `shell.nav.skillBook`, `skillBook.{title,subtitle,loading,empty,equippedSummary,filter,tier,element,equipFilter,field,badge,button,equip,unequip,upgrade,errors}` 13 error code (NOT_LEARNED/ALREADY_EQUIPPED/TOO_MANY_EQUIPPED/INSUFFICIENT_FUNDS/MASTERY_MAX/REALM_NOT_FOUND/REALM_TOO_LOW/WRONG_SECT/METHOD_NOT_LEARNED/CHARACTER_SKILL_UNAVAILABLE/NO_CHARACTER/INVALID_INPUT/UNAUTHENTICATED/IN_FLIGHT/UNKNOWN).
- Tests: 8 vitest api `skill.test.ts` (envelope GET / POST × 3 + error code TOO_MANY_EQUIPPED / INSUFFICIENT_FUNDS / NO_CHARACTER) + 11 vitest stores `skill.test.ts` (initial / fetchState hydrate + equippedCount derive / equip success-error-IN_FLIGHT-race / unequip / upgrade success + INSUFFICIENT_FUNDS no re-fetch / reset) + 14 vitest view `SkillBookView.test.ts` (loading + empty / render cards + tier badge + mastery / equipped badge / counts header / filter tier-equipped / equip-unequip-upgrade success + error toast / button disabled mastery=max + inFlight) + Playwright spec #17 (onboard → goto /skill-book → verify card `basic_attack` + tier "Sơ cấp" + equipped badge + mastery 1/5 + summary 1/4 + filter selects).
- Server-authoritative: zero backend delta — store dispatch sang 4 endpoint Phase 11.2.B (`GET /character/skill` + `POST /character/skill/equip|unequip|upgrade-mastery`), server validate `MAX_EQUIPPED_SKILLS=4` cap (basic_attack exempt), atomic `CurrencyService.applyTx({reason:'SKILL_UPGRADE'})` cho upgrade, error code chuẩn hóa qua `mapSkillErrorStatus`.
- Rate limit + skill book item drop/consume + element multiplier breakdown UI: defer Phase 11.2.D (item ledger SKILL_LEARN) / Phase 11.2.C++ (controller `@Throttle`).

#### 11.3.A PR: Linh căn / Spiritual Root runtime FOUNDATION **(session 9r-12, this PR open — Phase 11.3 first runtime PR)**

- `apps/api/prisma/schema.prisma` thêm 5 field vào `Character`: `spiritualRootGrade String?`, `primaryElement String?`, `secondaryElements String[] @default([])`, `rootPurity Int @default(100)`, `rootRerollCount Int @default(0)`.
- Model mới `SpiritualRootRollLog` audit + idempotency (index `[characterId, source]`).
- Migration `20260501000000_phase_11_3_spiritual_root` safe: `ALTER ADD COLUMN ... DEFAULT ...` + `CREATE TABLE` + 2 INDEX + FK CASCADE. Nullable + default → backward-compat với character pre-Phase 11.3.
- `SpiritualRootService` server-authoritative: `rollOnboard(characterId, rng?)` idempotent (kiểm tra existing log `source='onboard'` trước, nếu có → return state hiện tại không roll lại); `getState(characterId, rng?)` lazy-roll cho character legacy. RNG inject `() => number` cho test deterministic, default `Math.random` runtime.
- Pure helper `rollRandomState(rng)`: weighted grade pick (60/25/10/4/1) + uniform element + Fisher-Yates secondary elements (no duplicate, count match `getSpiritualRootGradeDef(grade).secondaryElementCount`) + purity uniform [80,100].
- `CharacterService.onboard` auto-call `rollOnboard(c.id)` sau khi tạo character (idempotent retry-safe). `CharacterController` thêm endpoint `GET /character/spiritual-root` auth required.
- 14 vitest API: 11 service test (idempotency + seeded determinism + lazy-roll + concurrent race + grade distribution 10000 sample bám sát weight ±5 percentage point + element distribution uniform 5000 sample) + 2 onboard integration test + 1 backward-compat test.
- KHÔNG runtime wire combat/cultivation/UI — đó là Phase 11.3.B.

#### 11.3.B PR: Linh căn element multiplier wire vào Combat **(MERGED #233)**

- `apps/api/src/modules/combat/combat.service.ts` import `characterSkillElementBonus + elementMultiplier + ElementKey` từ `@xuantoi/shared`.
- Trong `action()`: player attack `dmgBase = rollDamage(...)`, multiply by `playerElementMul = characterSkillElementBonus(charElementState, skill.element, monster.element)` — `charElementState=null` cho legacy character → bypass bonus, chỉ áp Ngũ Hành base. `Math.max(1, round(dmgBase * mul))` clamp.
- Monster counter: `replyBase = rollDamage(...)`, multiply by `elementMultiplier(monster.element, char.primaryElement)`.
- Add log line "Ngũ Hành tương khắc/sinh — sát thương khuếch đại ×N.NN" nếu `mul ≥ 1.15`, hoặc "lệch hệ — sát thương suy giảm ×N.NN" nếu `mul ≤ 0.90`.
- 5 vitest mới với `vi.spyOn(Math, 'random').mockReturnValue(0.5)` → variance = 1.0 deterministic: kim>moc primary kim → ×1.40 log; moc primary skill kim vs moc → ×1.30 (no character bonus); legacy null → ×1.30; basic_attack vô hệ → no log; kim vs kim cùng hệ → ×0.90 "lệch hệ".

#### 11.3.C PR: Linh căn cultivation + stat bonus wire **(session 9r-12 part 3, this PR open)**

- `apps/api/src/modules/cultivation/cultivation.processor.ts` import `SPIRITUAL_ROOT_GRADES + getSpiritualRootGradeDef + SpiritualRootGrade` + helper `isValidSpiritualRootGrade`. Trong tick: `select` thêm `spiritualRootGrade: true`, `cultivationMul = def.cultivationMultiplier ?? 1.0`, `gain = BigInt(max(1, round(baseGain * cultivationMul)))`.
- `apps/api/src/modules/combat/combat.service.ts` import same helper. Trong `action()`: `statMul = 1 + def.statBonusPercent / 100`, `effPower = (char.power + equip.atk) * statMul`, `effDef = equip.def * statMul`.
- Curve cultivation: pham 1.0 / linh 1.15 / huyen 1.30 / tien 1.50 / than 1.80.
- Curve statBonus: pham +0% / linh +5% / huyen +10% / tien +18% / than +30%.
- 5 vitest: 3 cultivation processor (than 1.80 vs legacy 1.0; pham 1.0; huyen 1.30) + 2 combat statBonus (than 30% > pham; legacy 1.0 → dmg=99 deterministic).

#### 11.3.D PR: Linh căn UI display + reroll service **(this PR open — Phase 11.3.D Linh căn UI + reroll, branch `devin/1777830894-phase-11-3-d-spiritual-root-ui-reroll`)**

- `packages/shared/src/items.ts` thêm catalog entry `linh_can_dan` (MISC TIEN, stackable, price 5000 LT) — drop tuning (boss tier ≥ THẦN, dungeon hậu kỳ) defer 11.3.D++.
- `apps/api/src/modules/inventory/inventory.service.ts` mở rộng `ItemLedgerReason` union với `SPIRITUAL_ROOT_REROLL`.
- `apps/api/src/modules/character/spiritual-root.service.ts` thêm `REROLL_ITEM_KEY='linh_can_dan'` + `SpiritualRootError(code: 'CHARACTER_NOT_FOUND' | 'NOT_INITIALIZED' | 'LINH_CAN_DAN_INSUFFICIENT')` class + `async reroll(characterId, rng?)`. Atomic flow: pre-check inventory aggregate → `prisma.$transaction` re-check + non-equipped row first delete/decrement + `ItemLedger.create({reason:'SPIRITUAL_ROOT_REROLL', qtyDelta:-1, refType:'Character'})` + `Character.update({grade,primaryElement,secondaryElements,rootPurity,rootRerollCount++})` + `SpiritualRootRollLog.create({source:'reroll', previous*, new*})`.
- `apps/api/src/modules/character/character.controller.ts` thêm `@Post('spiritual-root/reroll') @HttpCode(200)` endpoint mapping error code → HTTP (LINH_CAN_DAN_INSUFFICIENT/NOT_INITIALIZED 409 CONFLICT, NO_CHARACTER 404, SPIRITUAL_ROOT_UNAVAILABLE 501).
- `apps/web/src/api/spiritualRoot.ts` (NEW) — `getSpiritualRootState/rerollSpiritualRoot` envelope client.
- `apps/web/src/stores/spiritualRoot.ts` (NEW) — Pinia store với `state/loaded/rerolling/fetchState/reroll/reset` race-protect.
- `apps/web/src/views/SpiritualRootView.vue` (NEW) — grade card (name + tier + description + cultivationMultiplier + statBonus + secondaryCount + purity), element wheel 5 ô Ngũ Hành (data-role primary/secondary/inactive), secondary list, reroll card + confirm dialog modal.
- `apps/web/src/router/index.ts` route `/spiritual-root` + `apps/web/src/components/shell/AppShell.vue` nav 根 Linh Căn + i18n keys (en + vi: title/subtitle/loading/empty/rerollCount/field/grade/element/elements/reroll.{title,description,warning,success,button,confirm,errors}).
- Tests: 7 vitest cho `SpiritualRootService.reroll` (NOT_INITIALIZED/INSUFFICIENT/NOT_FOUND/happy path inventory consume + ledger + log + state, qty=1 row delete edge, 3-reroll lifecycle rerollCount=3, error class instanceof) + 11 controller test + 6 api/spiritualRoot + 8 stores/spiritualRoot + 14 SpiritualRootView + Playwright spec #16 (register fresh char → goto /spiritual-root → verify grade card + element wheel 5 ô + 1 primary role + purity range 80..100 + reroll card visible).
- Rate limit: defer Phase 11.3.D++ (controller-level @Throttle(...) optional follow-up — không block UI display + reroll core flow).

#### 11.4.A PR: Gem catalog foundation **(this PR — session 9r-10, P11-4 Gem MVP catalog half)**

- `packages/shared/src/gems.ts` NEW (~310 lines) — 25 gem baseline (5 Ngũ Hành × 5 grade `PHAM/LINH/HUYEN/TIEN/THAN`) deterministic generated.
- Schema `GemDef { key, name, description, element, grade, bonus, compatibleSlots, nextTierKey, price, source }` + `GemBonus` 5-stat + `GemSource` 6-type + `GemCompatibleSlot` 7-slot + 'ANY'.
- Element-stat mapping: Kim → atk + spirit; Mộc → hpMax + spirit; Thuỷ → mpMax + spirit; Hoả → atk - def trade-off; Thổ → def + hpMax.
- Combine recipe: 3× cùng key → 1× next-tier (THAN → nextTierKey null); combine sink rule `3× bonus_low > bonus_high_grade`.
- Helper: `getGemDef`, `gemsByElement`, `gemsByGrade`, `composeSocketBonus(gemKeys[])`, `combineGems(srcKey)`, `canSocketGem(gemKey, slot)`, `gemUpgradePathCost(fromKey, toKey)` (geometric `3^N`).
- 39 vitest cover catalog shape, 5×5 element×grade matrix, balance (price + bonus monotonic + Hoả def trade-off + combine sink rule), helpers (compose/combine/canSocket/upgradePath happy + error paths).
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.4.B runtime).

#### 11.4.B PR: Gem runtime (Pending)

- Prisma migration: `Equipment.sockets Json?` (list `{ slotIndex: int, gemKey: string | null }`) với default empty `[]`. Backfill nullable cho character cũ.
- Service: `socketGem(characterId, equipmentId, slotIndex, gemKey)` deduct gem qty từ `ItemLedger`, push vào `equipment.sockets`. `unsocketGem` return gem (cost linhThach), push qty back.
- Service: `combineGems(characterId, srcGemKey)` consume 3× gem cùng key → 1× gem next-tier theo `combineGems` catalog helper deterministic, qua `ItemLedger` atomic.
- Wire `composeSocketBonus(equipment.sockets[].gemKey)` vào `CharacterStatService.computeStats` cho tổng equipment bonus + socket bonus.
- Migration + rollback note + idempotency cho socketGem/combineGems.

#### 11.5.A PR: Refine catalog foundation **(this PR — session 9r-10, P11-5 Refine MVP catalog half)**

- `packages/shared/src/refine.ts` NEW (~340 lines) — 15 level baseline 3 stage `safe/risky/extreme` × 5 level.
- Schema `RefineLevelDef { level, stage, successRate, linhThachCost, materialKey, materialQty, statMultiplier, failureBehavior, extremeBreakChance }`.
- Curve: success rate `safe 0.95→0.75 / risky 0.60→0.30 / extreme 0.20→0.05`; linhThach geometric `100 × 1.6^(level-1)`; statMultiplier cumulative L0=1.0 → L15=3.25; material per stage (`tinh_thiet/yeu_dan/han_ngoc` qty 1/2/3); extremeBreakChance L11=10% → L15=40%.
- Failure path: `no_loss` (safe), `level_minus_one` (risky), `level_minus_one_or_break` (extreme); protection charm cứu level-loss nhưng KHÔNG cứu break.
- Helper: `getRefineLevelDef`, `getRefineAttemptCost`, `getRefineStatMultiplier`, `refineLevelsByStage`, `getRefinePathCostMin`, `simulateRefineAttempt(currentLevel, rng, opts)` deterministic server-authoritative simulation.
- Protection charm key reserved `refine_protection_charm` (Phase 11.5.B add vào ITEMS).
- 56 vitest cover catalog shape, material curve (ref ITEMS valid), balance, helpers happy + error paths, simulateRefineAttempt 12 scenario (safe/risky/extreme × success/fail/protection × break/no-break) + replay determinism.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.5.B runtime).

#### 11.5.B PR: Refine runtime (Pending)

- Prisma migration: `Equipment.refineLevel Int @default(0)` + optional `Equipment.refineHistory Json?` (audit log per attempt).
- Add item `refine_protection_charm` (HUYEN MISC consumable) vào `packages/shared/src/items.ts` + drop table dungeon HUYEN+.
- Service: `refineEquipment(characterId, equipmentId, useProtection)` → consume linhThach + material qua `CurrencyLedger` + `ItemLedger`, optional consume protection, call `simulateRefineAttempt(currentLevel, seedrandom(attemptId))` deterministic, write equipment.refineLevel + audit log.
- Service: handle `broken` case — equipment break = soft delete (set `isBroken: true`) hoặc full delete (configurable feature flag).
- Wire `getRefineStatMultiplier(equipment.refineLevel)` vào `CharacterStatService.computeStats` cho atk/def/hpMax/mpMax/spirit scaling.
- Idempotency cho `refineEquipment` qua `attemptId` UUID per call.
- Migration + rollback note.

#### 11.6.A PR: Tribulation catalog foundation **(this PR — session 9r-10, P11-6 Thiên Kiếp + Tâm Ma MVP catalog half)**

- `packages/shared/src/tribulation.ts` NEW (~480 lines) — 8 kiếp baseline cover realm threshold quan trọng (`kim_dan→nguyen_anh` minor lei → `chuan_thanh→thanh_nhan` saint lei).
- Schema `TribulationDef { key, name, fromRealmKey, toRealmKey, type, severity, waves[], reward, failurePenalty }` + `TribulationType` 5-type (`lei/phong/bang/hoa/tam`) + `TribulationSeverity` 4-tier (`minor/major/heavenly/saint`).
- Wave count theo severity (3/5/7/9), baseDamage geometric `severityBase × 1.35^waveIdx`, element rotation theo type (lei = hoa+kim alternating, tam = null inner-demon).
- Reward base linhThach `5k/25k/150k/1M` per severity + expBonus BigInt + titleKey cosmetic + uniqueDropItemKey (null cho minor/major, `kiep_van_thach`/`thanh_kiep_tinh` cho heavenly/saint).
- Failure penalty: expLossRatio `10%/20%/35%/50%` + cooldown `30/60/120/240 min` + taoMaDebuffChance `5%/10%/20%/30%` + taoMaDebuffDurationMinutes.
- Tâm Ma kiếp (`tam` type) = `do_kiep → nhan_tien` cross-tier; element=null force player tự thắng nội tâm (no element resist).
- Helper: `getTribulationDef`, `getTribulationForBreakthrough`, `tribulationsByType/Severity`, `simulateTribulationWave` (deterministic damage), `simulateTribulation` full-fight chain wave-by-wave, `computeTribulationReward`, `computeTribulationFailurePenalty` BigInt-safe.
- 52 vitest cover catalog shape + ref REALMS valid + waves balance + reward/failure monotonic theo severity + helpers happy + error paths + sim deterministic replay.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.6.B runtime).

#### 11.6.B PR: Tribulation runtime **(MERGED — PR #242 `a2721b1`)**

- Prisma migration: `TribulationAttemptLog` model + Character fields `tribulationCooldownAt: DateTime?` + `taoMaUntil: DateTime?` (Tâm Ma debuff window).
- Service `TribulationService.attemptTribulation(characterId)` → detect via `getTribulationForBreakthrough`, run `simulateTribulation(def, character.hpMax, computeElementResist)` deterministic seeded RNG, on success: grant reward qua CurrencyLedger + ItemLedger + bump realm/stage; on fail: apply `computeTribulationFailurePenalty`, set `tribulationCooldownAt` + `taoMaUntil` window.
- Hook vào breakthrough flow → realm transition cần kiếp dispatch sang tribulation route.
- Cooldown enforcement: server reject `TRIBULATION_COOLDOWN` nếu `tribulationCooldownAt > now`.
- Idempotency cho ledger ops + audit log.
- Subsequent extensions: PR #281 Phase 11.9.C-2 Title milestone wire SUCCESS path, PR #286 Phase 11.8.D-2 BuffService.applyBuffTx debuff_taoma vào FAIL path. **Strictly superior so với 216-dòng MVP của PR #313** (closed as duplicate).

#### 11.6.C PR: Tribulation HTTP wire **(MERGED)**

- `POST /character/tribulation/attempt` (server-authoritative, idempotent) expose `TribulationService.attemptTribulation`.
- DTO + Zod validation + `mapTribulationErrorStatus` (NO_CHARACTER 404, NOT_AT_PEAK 422, COOLDOWN 429, TAO_MA_ACTIVE 409, NO_DEFINITION 501).
- Vitest controller + service integration + cookie auth.

#### 11.6.D PR: Tribulation UI **(MERGED PR #326)**

- `apps/web/src/views/TribulationView.vue` + `apps/web/src/stores/tribulation.ts` + `apps/web/src/api/tribulation.ts`.
- Upcoming card render với severity/type badge + reward preview + penalty preview + "Vượt kiếp" attempt button.
- Last outcome banner (success reward chi tiết / fail penalty + Tâm Ma chance).
- Route `/tribulation` + sidebar nav.

#### 11.6.E PR: Tribulation state expose **(MERGED PR #327)**

- `CharacterStatePayload` + `tribulationCooldownAt` + `taoMaUntil` (ISO string nullable) → `CharacterService.toState()` mapping.
- View live cooldown banner countdown `m:ss` / `h:mm:ss` (>1h) + Tâm Ma debuff banner.
- Pre-check button disable theo cooldown countdown.

#### 11.6.F PR: Tribulation log endpoint **(MERGED PR #328)**

- `GET /character/tribulation/log?limit=N` (default 20, max 100) expose `TribulationAttemptLog` table DESC by `createdAt`.
- `TribulationService.listAttemptLogs(charId, limit?)` query + cast BigInt → string + DateTime → ISO.
- 14 vitest mới (8 controller + 6 service).

#### 11.6.G PR: Tribulation history view **(MERGED PR #329)**

- FE consume Phase 11.6.F endpoint → render history list dưới `TribulationView.vue`.
- API client `fetchAttemptLog(limit?)` + `TribulationAttemptLogView` interface + `TRIBULATION_LOG_DEFAULT_LIMIT/MAX_LIMIT` constants (mirror server).
- Pinia store extend `history`/`historyLoading`/`historyError` + `fetchHistory(limit?)` race-protected action.
- View append `<section>` với loading/empty/error/list states + reload button + auto-refetch sau attempt.
- 27 vitest mới (web 817 → 844).

#### 11.6.H PR: Tribulation history pagination "Load more" **(MERGED PR #330)**

- FE-only mở rộng Phase 11.6.G với pagination button (consume cùng endpoint, no backend changes).
- Approach: expanding-limit re-fetch (`?limit=N+20`) clamp tới MAX 100 thay vì offset/cursor.
- Store: `historyLimit: ref<number>` + `historyHasMore: computed` + `historyMaxReached: computed` + `loadMoreHistory(): Promise<string|null>` action (race-safe + IN_FLIGHT/MAX_REACHED short-circuit).
- View: "Load more" button conditional + max-reached hint + `onLoadMore()` toast on real errors.
- i18n vi/en: `tribulation.history.{loadMore,loadMoreLoading,maxReached}`.
- 24 vitest mới (web 844 → 868). Limitation: chỉ pagination tới 100 entries do server cap; future Phase 11.6.I cần real cursor cho >100.

#### 11.6.J PR: Tribulation history client-side filter **(MERGED PR #332)**

- FE-only mở rộng Phase 11.6.G/H với segmented control filter (success/fail/all) trên rows đã loaded — pure presentation, no backend touch.
- Why client-side: server endpoint không có `success` query param; thêm server filter sẽ phá invariant pagination Phase 11.6.H (`historyHasMore` tính trên full list). Approach client-side giữ load-more logic nguyên vẹn.
- Store: `HistoryFilter = 'all'|'success'|'fail'` type export + `historyFilter: ref<HistoryFilter>` state + `filteredHistory: computed<rows[]|null>` (preserve null sentinel) + `setHistoryFilter(filter)` action với input validation. `reset()` clear filter về `'all'`.
- View: 3-button segmented control phía trên list với `aria-pressed` reflect active filter; `<v-for>` đổi từ `history` → `filteredHistory`; empty-after-filter hint khi filter loại hết rows.
- i18n vi/en: `tribulation.history.filter.{label,all,success,fail,emptyAfterFilter}`.
- 22 vitest mới (web 868 → 890): 11 store + 11 view. View test stub `filteredHistory` getter mirror Pinia computed → existing Phase 11.6.G tests vẫn pass mà không cần set 2 field.

#### 11.6.K PR: Tribulation history stats summary **(MERGED PR #333)**

- FE-only mở rộng Phase 11.6.G/H/J với 3 stats badge (total/success/fail counts) phía trên filter control. Counts tính trên FULL `history.value` (KHÔNG `filteredHistory`) → user toggle filter UI thì counts không đổi.
- Store: 3 computed mới `historyTotalCount`/`historySuccessCount`/`historyFailCount` — null history (chưa fetch) → counts = 0; empty array → counts = 0.
- View: stats line 3 badge (ink-700 total + emerald-700 success + rose-700 fail) phía trên filter control, conditional render cùng `history && history.length > 0`.
- i18n vi/en: `tribulation.history.stats.{label,total,success,fail}` với placeholder `{count}`.
- 15 vitest mới (web 890 → 905): 8 store + 7 view (bao gồm DOM position assertion stats trước filter via `Node.DOCUMENT_POSITION_FOLLOWING`).

#### 11.X.A PR: Alchemy catalog foundation **(this PR — session 9r-10, P11-X Luyện Đan MVP catalog half)**

- `packages/shared/src/alchemy.ts` NEW (~340 lines) — 13 recipe baseline cover toàn bộ pill HP/MP/EXP × 5 quality tier (PHAM..THAN) hiện có trong ITEMS.
- Schema `AlchemyRecipeDef { key, name, description, outputItem, outputQty, outputQuality, inputs[{ itemKey, qty }], furnaceLevel, realmRequirement, linhThachCost, successRate }`.
- Curve: PHAM (5 recipe) furnace L1 success 0.90–0.95 cost 50–180 LinhThach + LINH (2) furnace L3 success 0.80–0.85 cost 400–500 + HUYEN (2) furnace L5 success 0.65 cost 1500 + TIEN (3) furnace L7 success 0.35–0.40 cost 8000–12000 + THAN (1) furnace L9 success 0.20 cost 30000.
- Input nguyên liệu tham chiếu material existing trong ITEMS: `linh_thao` (LINH herb-ish ore) + `huyet_tinh` (LINH yêu thú blood) + `tinh_thiet` (LINH metal) + `yeu_dan` (HUYEN yêu dan) + `han_ngoc` (TIEN cold ore) + `tien_kim_sa` (TIEN gold sand).
- Convention: input + linhThach LUÔN bị consume dù fail (intent: balance không cho free retry).
- Helper: `getAlchemyRecipeDef`, `alchemyRecipesByQuality/OutputItem`, `alchemyRecipesAvailableAtFurnace`, `getAlchemyIngredientTotal`, `getExpectedAlchemyAttempts` = 1/successRate, `simulateAlchemyAttempt(recipe, rng)` deterministic, `simulateAlchemyBulk(recipe, rngArray)` aggregated stats.
- 55 vitest cover catalog shape + ref ITEMS/REALMS valid + curve sanity (success monotonic giảm + cost monotonic tăng theo tier + cover ≥ 3 pill mỗi kind HP/MP/EXP) + helpers happy + error paths + sim deterministic replay.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.X.B runtime).

#### 11.X.B PR: Alchemy runtime (Pending)

- Module mới `apps/api/src/modules/alchemy/` (controller + service + DTO).
- Prisma migration: `Character.alchemyFurnaceLevel Int @default(1)` + `AlchemyAttempt { id, characterId, recipeKey, attemptId UNIQUE, success, rollValue, createdAt }` model cho audit.
- Service `AlchemyService.attemptAlchemy(characterId, recipeKey, attemptId)` → resolve recipe via `getAlchemyRecipeDef`, check furnaceLevel + realmRequirement gating, sample rollValue via `seedrandom(attemptId)` deterministic, call `simulateAlchemyAttempt(recipe, rollValue)`, atomic transaction qua `ItemLedger.consume(input)` + `CurrencyLedger.consume(linhThach)` + nếu success → `ItemLedger.grant(output)`, persist `AlchemyAttempt` row.
- Idempotency cho `attemptAlchemy` qua `attemptId` UUID per call (constraint UNIQUE).
- REST `POST /alchemy/recipes` (list available) + `POST /alchemy/attempt` + `GET /alchemy/history`.
- Migration + rollback note + audit log.

#### 11.7.A PR: Talent / Thần Thông catalog foundation **(this PR — session 9r-10)**

- `packages/shared/src/talents.ts` NEW (~440 lines) — 14 talent baseline = 7 passive + 7 active "Thần Thông".
- Schema `TalentDef { key, name, description, type, element, realmRequirement, talentPointCost, passiveEffect xor activeEffect }` + sub-types `TalentType/PassiveTalentKind/ActiveTalentKind/StatTarget`.
- Passive (7): Kim Thiên Cơ atk +10%, Thuỷ Long Ấn hpMax +10%, Mộc Linh Quy hp regen +5/tick, Hoả Tâm Đạo damage_bonus vs Kim +15%, Thổ Sơn Tướng def +10%, Thiên Di drop +20%, Ngộ Đạo exp +15%.
- Active (7): Kim Quang Trảm AOE 2× atk, Thuỷ Yên Ngục root 3 turns, Mộc Chu Lâm heal 30%, Hoả Long Phún DOT 5 turns, Thổ Địa Chấn AOE stun 1 turn, Thiên Lôi Trừng Trị true damage 3× spirit, Phong Lui Pháp Tướng escape utility.
- Realm gating: truc_co/kim_dan/nguyen_anh/hoa_than/luyen_hu cover early-mid-late.
- Cost gating: 1/2/3 talent points per talent.
- Talent point budget: mỗi 3 realm threshold trigger 1 ngộ-đạo point (`computeTalentPointBudget(order) = floor(order/3)`).
- Helper: `getTalentDef`, `talentsByType/Element`, `talentsAvailableAtRealm`, `computeTalentPointBudget`, `canCharacterLearnTalent`, `composePassiveTalentMods` (multiplicative stat + additive regen + per-element damage_bonus map), `simulateActiveTalent` deterministic.
- 70 vitest cover catalog shape + ref REALMS valid + curve sanity + helpers + sim deterministic + error paths.
- KHÔNG schema migration, KHÔNG runtime hook (catalog-only foundation cho 11.7.B runtime).

#### 11.7.B PR: Talent / Thần Thông runtime — DONE ✅ (PR #244 merged)

- Module `apps/api/src/modules/character/talent.service.ts` + `apps/api/src/modules/character/character.controller.ts` (talent endpoints).
- Prisma model `CharacterTalent { id, characterId, talentKey, learnedAt }` (cooldown defer Phase 11.7.E).
- Service `TalentService.learnTalent(characterId, talentKey)` validate qua `canCharacterLearnTalent` + persist + giảm talent point budget.
- Service `TalentService.listLearned` + `getMods` (passive compose) — dùng cho stat compose runtime.
- Wire `composePassiveTalentMods(character.learnedTalentKeys)` vào `CombatService.action` (atk/def/element bonus apply on damage compose).
- REST `GET /character/talent/list` + `POST /character/talent/learn` + `GET /character/talent/points`.
- 70+ vitest service + controller cover học/refund/passive compose + reject paths.

#### 11.7.D PR: Talent active wire vào CombatService — DONE ✅ (this PR / merge target)

- `apps/api/src/modules/combat/combat.service.ts` — extend `CombatError` union với `TALENT_NOT_LEARNED` + `TALENT_NOT_ACTIVE`. `action(skillKey)` lookup `skillByKey` null → fallback `getTalentDef(skillKey)` → route sang `actionViaActiveTalent` flow nếu `type='active'`.
- `actionViaActiveTalent` server-authoritative: validate ownership qua `TalentService.listLearned` + MP cost từ `activeEffect.mpCost` + buff control gate (`controlTurnsMax > 0` → reject CONTROLLED) + execute deterministic via `simulateActiveTalent(def, atk, spirit)` + element multipliers (`playerElementMul × talentElementMul × buffElementMul` cho damage kind).
- Effect mapping: `damage` → monster HP -= `result.damage × elementMuls`; `heal` → restore HP clamp `hpMax` + skip monster reply; `cc` (root/stun) → log + skip monster reply; `dot` (burn) → log + skip monster reply (DOT cumulative cross-turn defer Phase 11.X.M); `utility` (escape `talent_phong_lui`) → encounter ABANDONED + early return.
- Persist via `prisma.$transaction` cùng `currency.applyTx` (`COMBAT_LOOT` reason) + `inventory.grant` (loot khi WON) + mission/achievement track (`KILL_MONSTER` / `CLEAR_DUNGEON` fail-soft).
- 10 vitest mới cover full effect path + 3 reject path (TALENT_NOT_LEARNED, MP_LOW, TALENT_NOT_ACTIVE, TalentService không inject reject).
- KHÔNG schema migration, KHÔNG breaking change cho skill flow legacy.

#### 11.7.E PR: Talent active cooldown schema persist — DONE ✅ (this PR / merge target)

- Migration `20260512000000_phase_11_7_e_character_talent_cooldown` — `ALTER TABLE "CharacterTalent" ADD COLUMN "cooldownTurnsRemaining" INTEGER NOT NULL DEFAULT 0`. Backfill safe: existing rows pre-cooldown treated như "ready to cast" (default 0).
- `apps/api/src/modules/character/talent.service.ts` thêm 3 method: `getCooldownRemaining(charId, key) → number` đọc, `setCooldown(tx, charId, key, turns)` set inside tx clamp `Math.max(0, floor(turns))`, `decrementAllCooldowns(tx, charId)` `updateMany WHERE > 0 decrement -1` idempotent.
- `apps/api/src/modules/combat/combat.service.ts` extend `CombatError` union `TALENT_ON_COOLDOWN`. `actionViaActiveTalent` reject EARLY (trước stamina/HP/MP mutation, ledger row, encounter status update) khi `getCooldownRemaining > 0`. Skill flow `action()` tx: `decrementAllCooldowns(tx, char.id)` sau `currency.applyTx` để talent active KHÔNG cast turn này vẫn tick down. Active talent flow (utility escape + main damage/heal/cc/dot tx): order `decrementAllCooldowns` → `setCooldown(activeEffect.cooldownTurns)` để talent vừa cast nhận đủ cooldown (không bị tick same turn).
- `apps/api/src/modules/combat/combat.controller.ts` `handleErr` map `TALENT_ON_COOLDOWN` (+ existing `CONTROLLED` / `TALENT_NOT_LEARNED` / `TALENT_NOT_ACTIVE` consolidated) → HTTP 409 CONFLICT (mirror `MP_LOW`).
- 12 vitest mới: 7 trong `talent.service.test.ts` (lifecycle, isolation, clamp, idempotent), 5 trong `combat.service.test.ts` (TALENT_ON_COOLDOWN reject, cooldown set on cast, skill flow tick, persist cross-encounter, MP_LOW reject không set cooldown).
- Defer: UI cooldown badge (Phase 11.7.E++ FE), rate limiter `@Throttle` (Phase 11.7.E++), WebSocket realtime emit cooldown state (không cần — client probe khi mở Talent panel).

#### 11.7.F PR: DungeonView talent cast buttons + pre-select highlight — DONE ✅ (PR #355 merged)

- `apps/web/src/views/DungeonView.vue` — `learnedActiveTalents` computed (filter learned active, sort cooldown asc + key tiebreak); cast buttons trong action panel cùng `POST /combat/action` path skill (BE Phase 11.7.D đã accept talent.key); cooldown gate FE-side qua `talentsStore.cooldownOf > 0` (server vẫn re-validate); MP cost label + amber ring highlight cho preselect.
- `route.query.talent` onMounted → `preselectedTalentKey` ref + auto `talentsStore.fetchState()` để sync cooldown trước khi render highlight; `TalentCatalogView.onCast` push `{ path: '/dungeon', query: { talent: talent.key } }` để continuity Loadout → action panel.
- `apps/web/src/i18n/{vi,en}.json` thêm `dungeon.talents.{title,cooldownLabel,preselected}` + 3 error key (TALENT_NOT_LEARNED, TALENT_NOT_ACTIVE, TALENT_ON_COOLDOWN).
- 9 vitest mới trong `DungeonView.test.ts` cover section gate, button label cd vs name, cd > 0 disabled, click cast performAction, WON toast, route query highlight, cd > 0 KHÔNG highlight, no query KHÔNG fetchState, cast reset preselect.
- KHÔNG schema migration, KHÔNG BE change — pure FE UI continuity addition.

#### 11.7.G PR: TalentView Loadout sticky positioning + per-loadout element filter — PENDING MERGE (PR #356, CI 5/5 GREEN first run)

- `apps/web/src/views/TalentCatalogView.vue` — Loadout section thêm class `bg-ink-900/95 backdrop-blur md:sticky md:top-0 md:z-10` để bám đỉnh `<main>` scroll container (AppShell `<main>` `overflow-y-auto`) khi user scroll qua catalog grid 54-talent. Per-loadout element filter mới (independent với catalog filter ở section bên dưới): `loadoutElementFilter` ref + `filteredActiveLearnedTalents` computed (apply hệ filter trên `activeLearnedTalents`, giữ sort ready/cd/key) + `clearLoadoutElementFilter()` reset.
- Filter row chỉ render khi `activeLearnedTalents.length > 0` (empty state vẫn clean). Filter-empty state riêng `talents-active-filter-empty` khi filter loại trừ tất cả learned (phân biệt với `talents-active-empty` khi user chưa học active nào). Reset button visible chỉ khi filter ≠ 'all'. Count text dùng `filteredActiveLearnedTalents.length`.
- `apps/web/src/i18n/{vi,en}.json` thêm `talents.activeSection.elementFilter.{label,all,empty,reset}` (4 key × 2 locale).
- 8 vitest mới trong `TalentCatalogView.test.ts` cover sticky CSS class, filter row gate empty/learned, default all → đủ active, filter=kim → chỉ kim, filter=neutral → chỉ neutral, filter loại trừ tất cả → filter-empty render, reset button toggle, sort order ready/cd asc giữa cùng hệ.
- KHÔNG schema migration, KHÔNG BE change, KHÔNG ledger, KHÔNG store contract change — pure FE UI polish per UI MODULE RULE.
- Defer: realtime cooldown countdown WS push (Phase 11.7.H), TalentView E2E smoke với `E2E_FULL=1` cho cast → DungeonView highlight → cast in combat → cooldown badge update (Phase 11.X UI E2E smoke gap).

#### 11.8.A PR: Buff/Debuff catalog foundation — DONE ✅ (this branch / merge target)

- `packages/shared/src/buffs.ts` NEW catalog 18 buff/debuff baseline (10 buff + 8 debuff).
  - Buff (10): pill (4 atk/def/regen/spirit), sect_aura (3 kim/thuy/hoa), event (2 double_exp/double_drop), talent (1 shield_phong).
  - Debuff (8): skill control (4 root_thuy/stun_tho/silence_kim/taunt_moc), skill DOT (2 burn_hoa/poison_moc stackable×3), boss_skill (1 atk_down), tribulation (1 taoma cultivation_block).
  - Schema: `BuffDef { key, polarity, element, source, durationSec, stackable, maxStacks, dispellable, effects[] }`.
  - 10 effect kind: `stat_mod` / `regen` / `damage_bonus` / `damage_reduction` / `control` / `dot` / `shield` / `taunt` / `invuln` / `cultivation_block`.
  - 8 source: `pill` / `skill` / `sect_aura` / `event` / `gear` / `talent` / `boss_skill` / `tribulation`.
  - 5 element coverage `kim/moc/thuy/hoa/tho` + 8 neutral.
  - Helper deterministic: `getBuffDef`, `buffsByPolarity/Element/Source/EffectKind`, `composeBuffMods(activeBuffs)`, `computeBuffExpiresAt`, `isBuffExpired`.
- 56 vitest (catalog shape + curve coverage + helper + compose + expire).
- KHÔNG runtime / schema / Prisma migration trong PR này.

#### 11.8.B PR: Buff/Debuff runtime (Pending)

- Model `CharacterBuff(id, characterId, buffKey, stacks, source, expiresAt, createdAt)` Prisma migration.
- Service `applyBuff` (idempotent on key+source for non-stackable, increment stacks for stackable up to maxStacks, refresh expiresAt).
- Service `removeBuff` / `pruneBuffs` (cron decay).
- Wire `composeBuffMods(activeBuffs)` vào `CharacterStatService.computeStats` (multiplicative atk/def/hpMax/mpMax/spirit, element damage_bonus/reduction).
- DOT tick task (combat turn or 1s schedule).
- Control flag enforce vào CombatService (block action if root/stun/silence/taunt, prefer target if taunt).
- `cultivation_block` flag enforce vào CultivationService (Tâm Ma block tu luyện).
- REST `GET /buff/active` + `POST /buff/dispel` (cleanse skill).
- Apply trigger qua: pill consume (existing), sect aura join (existing), event opt-in, talent active utility, boss skill, tribulation fail.

#### 11.9.A PR: Title (Danh hiệu) catalog foundation — DONE ✅ (this branch / merge target)

- `packages/shared/src/titles.ts` NEW catalog 24 title baseline.
  - 9 realm milestone (luyenkhi → hu_khong_chi_ton spread, common → mythic).
  - 5 element mastery (kim/moc/thuy/hoa/tho — all epic).
  - 4 achievement (first kill / first dungeon / first boss / first breakthrough).
  - 3 sect rank (initiate / inner / elder).
  - 2 event seasonal placeholder.
  - 1 donation tier placeholder.
- Schema: `TitleDef { key, nameVi, nameEn, description, rarity, source, element, unlockRealmKey?, unlockAchievementKey?, unlockSectRole?, flavorStatBonus? }`.
- 5 rarity tier: `common` / `rare` / `epic` / `legendary` / `mythic`.
- 6 source: `realm_milestone` / `element_mastery` / `achievement` / `sect_rank` / `event` / `donation`.
- Balance cap per rarity: common ≤ +2%, rare ≤ +3%, epic ≤ +5%, legendary ≤ +10%, mythic ≤ +15% (vitest enforce).
- Helpers deterministic: `getTitleDef`, `titlesByRarity/Source/Element`, `titleForRealmMilestone/Achievement/SectRole`, `composeTitleMods(equippedTitleKeys[])`.
- 51 vitest (catalog shape + curve coverage + balance cap + helper + compose + REALMS integration).
- KHÔNG runtime / schema / Prisma migration trong PR này (`Character.title String?` đã tồn tại từ phase 0).

#### 11.10.A PR: Achievement (Thành tựu) catalog foundation — DONE ✅ (this branch / merge target)

- `packages/shared/src/achievements.ts` NEW catalog 32 achievement baseline.
  - 8 combat (first kill / 100 / 1000 + 4 element-specialist 50 + first boss).
  - 6 cultivation (first breakthrough + 3 realm milestone + 2 cultivation seconds).
  - 5 exploration (first dungeon / 10 / 100 / kim element / endgame hidden).
  - 4 social (sect join / first chat / sect donate 1k / 10k).
  - 4 economy (first buy / first sell / 100 buy / 100 sell).
  - 3 milestone (1k exp / 100k exp / 10M exp).
  - 2 collection (50 buy / 500 buy).
- Schema: `AchievementDef { key, nameVi, nameEn, description, category, tier, goalKind, goalAmount, element, rewardTitleKey, reward, hidden }`.
- 5 tier: `bronze` / `silver` / `gold` / `platinum` / `diamond`.
- 7 category: `combat` / `cultivation` / `exploration` / `social` / `economy` / `milestone` / `collection`.
- Reuse `MissionGoalKind` enum (KILL_MONSTER/CLEAR_DUNGEON/BOSS_HIT/BREAKTHROUGH/GAIN_EXP/CULTIVATE_SECONDS/BUY_LISTING/SELL_LISTING/CHAT_MESSAGE/SECT_CONTRIBUTE) cho Phase 11.10.B service share event listener với mission service.
- Title link: `rewardTitleKey` non-null cho 4 achievement (first_monster_kill / first_dungeon_clear / first_boss_kill / first_breakthrough) khớp với `titles.ts` `titleForAchievement` lookup → Phase 11.10.B + 11.9.B service auto-grant title trên achievement complete.
- Balance cap per tier (vitest enforce): bronze ≤ 200 linhThach, silver ≤ 3000, gold ≤ 20_000, platinum ≤ 50_000, diamond ≤ 100_000.
- Helpers deterministic: `getAchievementDef`, `achievementsByCategory/Tier/GoalKind/Element`, `visibleAchievements`.
- 45 vitest (catalog shape + curve + balance + title link integration + helpers).
- KHÔNG runtime / schema / Prisma migration trong PR này.

#### 11.10.B PR: Achievement runtime (Pending)

- Model `CharacterAchievement(id, characterId, achievementKey, progress, completedAt?)` Prisma migration (idempotent unique on `[characterId, achievementKey]`).
- Service `incrementAchievement(characterId, achievementKey, delta)` (idempotent — nếu progress đã ≥ goalAmount thì set `completedAt` chỉ nếu null).
- Service `claimAchievement(characterId, achievementKey)` validate `completedAt!=null` + grant reward via Currency/Item Ledger + auto-`unlockTitle(achievementKey → rewardTitleKey)` qua Phase 11.9.B service.
- Event listener route mỗi `goalKind`:
  - `KILL_MONSTER` → on monster killed event → increment all `KILL_MONSTER` achievements (filter by element nếu có).
  - `CLEAR_DUNGEON` → on dungeon cleared event.
  - `BOSS_HIT` → on boss killed event.
  - `BREAKTHROUGH` → on realm breakthrough event (also trigger Phase 11.9.B `titleForRealmMilestone`).
  - `GAIN_EXP` → on exp gained event.
  - `CULTIVATE_SECONDS` → on cultivation tick event.
  - `BUY_LISTING` / `SELL_LISTING` → on market transaction.
  - `CHAT_MESSAGE` → on world chat sent.
  - `SECT_CONTRIBUTE` → on sect donation.
- Share event-listener với existing mission service (refactor `MissionTrackerService` → generic `GoalTrackerService` cover both mission + achievement).
- REST `GET /achievement/list` + `GET /achievement/progress` + `POST /achievement/claim`.
- UI achievement page với category tab + tier badge + progress bar + claim button + title preview.

#### 11.9.B PR: Title runtime (Pending)

- Model `CharacterTitleUnlock(id, characterId, titleKey, unlockedAt, source)` Prisma migration (idempotent unique on `[characterId, titleKey]`).
- Service `unlockTitle(characterId, titleKey, source)` (idempotent).
- Service `equipTitle(characterId, titleKey)` (validate ownership, set `Character.title`).
- Service `getOwnedTitles(characterId)`.
- Auto-grant trigger:
  - On `BreakthroughEvent` complete → `titleForRealmMilestone(newRealmKey)` → `unlockTitle`.
  - On `AchievementCompleteEvent` (Phase 11.10) → `titleForAchievement(achievementKey)` → `unlockTitle`.
  - On `SectRoleChangeEvent` → `titleForSectRole(role)` → `unlockTitle`.
- Wire `composeTitleMods([Character.title])` vào `CharacterStatService.computeStats` (multi-stack ready, single-slot hiện tại).
- REST `GET /title/owned` + `POST /title/equip` + `GET /title/available`.
- UI character profile title selector + achievement/realm preview "next title to unlock".

### Exit criteria

- [ ] Tất cả 8 sub-PR merged + CI xanh.
- [ ] Test idempotency cho mọi reward path mới (alchemy result, talent unlock, …).
- [ ] BALANCE_MODEL.md cập nhật curve.
- [ ] Migration đã chạy thử rollback.

### Risks

- **Migration data loss** — schema mở rộng có default value, không xoá field cũ. Backup DB trước khi deploy.
- **Power explosion** — refine + talent + cultivation method chồng nhau → power × 5-10. Mitigation: cap formula + curve test.
- **Cheat surface tăng** — alchemy/refine RNG có thể bị manipulate. Mitigation: server RNG, log mọi roll.

### Module phụ thuộc cần xong trước phase 11

- ItemLedger 100% coverage (đã có cơ bản từ Phase 9, cần verify mọi consume path đã ghi).
- Migration tooling tested với rollback.
- Time-to-power curve baseline đã document trong `BALANCE.md`.

---

## Phase 12 — Dungeon & World Map

### Goal

Mở rộng từ "3 dungeon flat" sang "8-12 region với dungeon, encounter, boss riêng".

### Entry criteria

- Phase 9 + 10. (Phase 11 không bắt buộc nhưng khuyến nghị).

### Scope

#### 12.1 PR: MapRegion model

- DB model `MapRegion(key, nameVi, nameEn, unlockRealmKey, flavor, sortOrder)`.
- Seed 8-12 region.

#### 12.2 PR: DungeonTemplate + DungeonRun

- DB model `DungeonTemplate(key, regionId, recommendedRealm, encounterCount, lootTableKey)`.
- DB model `DungeonRun(characterId, templateKey, status, seed, currentEncounterIndex)`.
- Service: `startRun(characterId, templateKey)`, `nextEncounter(runId)`, `claimRun(runId)`.

#### 12.3 PR: Encounter mở rộng

- Encounter hiện đã có. Mở rộng để link tới `DungeonRun` (1 run = 1-N encounter sequential).
- Encounter có boss-encounter type cho boss-of-region.

#### 12.4 PR: MonsterTemplate (optional move static → DB)

- Cân nhắc: giữ static (`MONSTERS` array) hay move sang DB? Quyết định theo content cadence — nếu admin cần tune monster mà không deploy → move sang DB.
- **Default decision**: giữ static phase 12; chỉ move sang DB nếu phase 15 cần admin tune live.

#### 12.5 PR: DropTable + LootRoll (DB)

- DB model `DropTable(key, entries Json)` thay thế `DUNGEON_LOOT` static (hoặc co-exist).
- DB model `LootRoll(characterId, sourceType, sourceKey, itemKey, qty, rolledAt)` — audit trail mọi loot.

#### 12.6 PR: Boss-by-region auto-spawn

- BullMQ repeatable job `bossSpawnJob` per region.
- Schedule: e.g. Hắc Lâm Huyết Ma Chúa mỗi 3h.
- Idempotent: nếu region đã có boss ACTIVE thì skip spawn.

#### 12.7 PR: Bí cảnh (Secret realm — endgame dungeon)

- Special dungeon-template type `BI_CANH`. Yêu cầu `secret_key` item để vào.
- Drop tier `TIEN`/`THAN`.

### Exit criteria

- [ ] 10+ region seeded.
- [ ] 20+ dungeon template.
- [ ] Auto-spawn boss working with idempotency test.
- [ ] LootRoll audit query working.

### Risks

- **DB scale**: `LootRoll` có thể phình to. Cần partition theo `createdAt` (postgres declarative partition) hoặc archive cron.
- **Region unlock UX**: phải onboard rõ "vùng này yêu cầu Kim Đan" nếu không người mới confused.

---

## Phase 13 — Sect 2.0

### Goal

Chuyển sect từ "1 model rỗng" sang "ecosystem có role, mission, shop, treasury, war".

### Entry criteria

- Phase 9 + 10.
- World boss reward idempotency confirmed (phase 12 task 12.6 hoặc earlier).

### Scope

#### 13.1 PR: SectMember + Role

- Tách `Character.sectId` sang model `SectMember(sectId, characterId, role: SectRole, joinedAt)`.
- `SectRole` enum: `LEADER`, `ELDER`, `CORE`, `DISCIPLE`.
- Migration: backfill từ `Character.sectId` + `Sect.leaderId`.

#### 13.2 PR: SectContributionLedger

- DB model audit mọi gain/spend `congHien`.
- Reuse pattern từ `CurrencyLedger`.

#### 13.3 PR: SectTreasuryLedger

- DB model audit mọi gain/spend `Sect.treasuryLinhThach`.

#### 13.4 PR: SectMission

- Static catalog `SECT_MISSIONS` (`packages/shared/src/sect-missions.ts`).
- DB `SectMissionProgress(sectMemberId, missionKey, ...)`.
- Reset cron tương tự daily/weekly.

#### 13.5 PR: SectShop

- Catalog `SECT_SHOP` static.
- Endpoint `POST /api/sect/shop/buy` consume `congHien`.
- Ledger `SectContributionLedger` ghi spend.

#### 13.6 PR: SectBoss

- Reuse `WorldBoss` schema with `scopeKey` field. `WORLD` boss = `scopeKey: 'world'`. `SECT` boss = `scopeKey: sectId`.
- Migration: thêm `scopeKey` field default `'world'`.

#### 13.7 PR: SectWar (async, season-based)

- DB model `SectWar(seasonId, status, startsAt, endsAt)`.
- DB model `SectWarMatch(warId, sectAId, sectBId, scoreA, scoreB, status)`.
- Người chơi attack sect war qua "tấn công đại trận" — deterministic combat dùng character snapshot.
- Reward season: top sect → mail + title.

#### 13.8 PR: Permission audit

- Mọi action role/promote/demote/kick → ghi `AdminAuditLog` với `actor = leader characterId` (cần extend audit log để hỗ trợ non-admin actor, hoặc tạo `SectAuditLog` riêng).

### Exit criteria

- [ ] 4 role split working.
- [ ] Sect mission claim idempotent.
- [ ] Sect treasury chỉ leader/elder spend được, có log.
- [ ] Sect war season chạy 1 vòng end-to-end (test environment).

### Risks

- **Permission bug** = critical. Test mọi guard.
- **Sect war balance** = khó tune. Plan: cho 1 season test trước khi public.

---

## Phase 14 — Arena Season

### Goal

Async PvP có thể chơi "fair" với người không chơi cùng giờ.

### Entry criteria

- Phase 11 (cần combat snapshot deterministic).
- Phase 13 (không hard, nhưng arena dùng cùng infra `Season`).

### Scope

#### 14.1 PR: CombatSnapshot

- Khi character submit defensive snapshot → save `CharacterCombatSnapshot(characterId, seasonId, snapshotJson, createdAt)`.
- Snapshot lock state: power, equip bonuses, skills, talents tại thời điểm submit.

#### 14.2 PR: Arena queue + match

- Service `ArenaService.findOpponent(characterId)` — tìm 5 opponent theo ELO close.
- DB `ArenaMatch(seasonId, attackerId, defenderId, snapshotA, snapshotB, result, createdAt)`.
- Combat: deterministic turn-based dùng 2 snapshot.

#### 14.3 PR: Season + ELO

- Model `Season(key, kind, status, startsAt, endsAt)`.
- Model `SeasonProgress(seasonId, characterId, eloRating, wins, losses)`.
- Reset season → ELO reset về 1500, không reset progression.

#### 14.4 PR: Arena reward

- DB `SeasonRewardClaim(seasonId, characterId, tier, claimedAt)` unique.
- End-of-season cron: tính tier per character (top 10 / top 100 / others) → mail reward.

#### 14.5 PR: Anti-wintrade

- Rule: 1 cặp `(attacker, defender)` trong cùng season, sau 3 trận liên tiếp → no ELO change.
- Detection: cron quét same-pair frequency.

### Exit criteria

- [ ] 1 season test 1 tuần end-to-end.
- [ ] Combat deterministic verified (re-run cùng snapshot → cùng kết quả).
- [ ] No double-claim reward.

### Risks

- **Snapshot drift**: nếu schema char thay đổi giữa season → snapshot không decode. Mitigation: version snapshot.
- **ELO meta**: dễ bị hard counter. Mitigation: tier reward không quá chênh lệch.

---

## Phase 15 — Live Ops / Event

### Goal

Admin có thể schedule event mà không deploy code.

### Entry criteria

- Phase 9.
- RewardClaimLog universal (xem ECONOMY_MODEL.md).

### Scope

#### 15.1 PR: EventConfig + EventProgress

- DB `EventConfig(key, kind, configJson, status, startsAt, endsAt, createdByAdminId)`.
- DB `EventProgress(eventId, characterId, progressJson)`.
- DB `EventRewardClaim(eventId, characterId, tier, claimedAt)` unique.

#### 15.2 PR: Event scheduler UI (admin)

- Trang admin tạo / chỉnh / kết thúc event.
- Validation: không 2 event cùng kind overlap.

#### 15.3 PR: Announcement

- DB `Announcement(message, level, startsAt, endsAt)`.
- WS broadcast tới online users.
- Marquee FE.

#### 15.4 PR: FeatureFlag

- DB `FeatureFlag(key, value: bool, scope: 'global'|'role'|'user')`.
- Service `FeatureFlagService.isEnabled(key, context)`.
- Cache Redis 30s TTL.

#### 15.5 PR: MaintenanceWindow

- DB `MaintenanceWindow(startsAt, endsAt, message)`.
- Middleware: nếu trong window → 503 trừ `/api/healthz` + admin route.

#### 15.6 PR: ConfigVersion (snapshot)

- Mọi thay đổi config (FeatureFlag, EventConfig, balance dial) snapshot lưu `ConfigVersion(key, payloadJson, createdAt, createdBy)`.
- Rollback bằng cách revert tới version cũ.

#### 15.7 PR: Battle pass (optional, evaluate gating)

- **Gated**: chỉ build sau khi `FeatureFlag` + `EventConfig` stable + monetization policy approved.
- Catalog tier 1..30 reward. Gain XP qua daily mission + event.

### Exit criteria

- [ ] Admin có thể schedule 1 event end-to-end (create → start → progress → claim → end).
- [ ] Maintenance mode tested.
- [ ] FeatureFlag rollout 1 module thử.

### Risks

- **Config drift**: prod config khác staging. Mitigation: ConfigVersion + diff tool.
- **Battle pass = monetization**: cần policy review trước.

---

## Phase 16 — Economy & Anti-cheat

### Goal

Phát hiện + phản ứng economy abuse, không để vỡ market hoặc inflation runaway.

### Entry criteria

- Phase 9.
- Ledger 100% (mọi mutation đều ghi).

### Scope

#### 16.1 PR: Ledger checker (CLI + cron)

- Mở rộng `apps/api/scripts/audit-ledger.ts` (đã có).
- CLI: `pnpm audit:ledger --json` để CI consume.
- Cron daily: chạy + alert qua admin email/mail nếu có lệch.

#### 16.2 PR: Economy report

- Endpoint admin `GET /api/admin/economy-report?from&to`.
- Trả về: tổng linhThach in/out theo source, top 10 character với delta lớn nhất, market volume.

#### 16.3 PR: Anomaly detection

- DB model `EconomyAnomaly(kind, evidence Json, severity, status, detectedAt)`.
- Cron `economy-anomaly-scanner` scan ledger 24h, flag pattern:
  - 1 character +>X linhThach từ 1 source duy nhất.
  - 1 cặp seller-buyer wash trade > N lần.
  - Topup velocity bất thường.

#### 16.4 PR: Market price band

- Catalog `MARKET_PRICE_BAND[itemKey]` (min, max).
- List ngoài band → reject với error code `PRICE_OUT_OF_BAND`.

#### 16.5 PR: Daily reward cap

- Per character: tối đa X linhThach/day từ "soft source" (cultivation+dungeon+mission).
- Vượt → log + cap (không grant thêm).

#### 16.6 PR: Admin suspicious action alert

- Khi admin grant > X linhThach hoặc tienNgoc trong 1 lần → alert mail tới super-admin (ngăn admin compromised).

### Exit criteria

- [ ] Cron scanner chạy daily, output stored DB.
- [ ] Admin dashboard tab "Economy" hiển thị anomaly.
- [ ] Test inject 1 anomaly giả → bị flag đúng.

### Risks

- **False positive**: scanner bắt nhầm → admin mất tin tưởng. Mitigation: threshold tunable + manual review.
- **Performance**: scan 24h ledger có thể chậm. Mitigation: index `(reason, createdAt)` đã có; cân nhắc partition.

---

## Phase 17 — Production Operations

### Goal

Vận hành prod ổn định: deploy, backup, monitor, runbook, release process.

### Entry criteria

- Phase 9 (closed beta stable ≥ 1 tháng).

### Scope

#### 17.1 PR: Deploy script consolidation

- `docs/DEPLOY.md` đã có. Mở rộng script `scripts/deploy-prod.sh` với verify step (smoke + ledger check post-deploy).

#### 17.2 PR: Backup/Restore verify

- `pnpm backup:db` + `pnpm restore:db` đã có.
- Cron weekly: backup → restore vào staging → run smoke → verify.

#### 17.3 PR: Monitoring (Sentry / Pino + Loki)

- `apps/api` integrate Sentry (error tracking).
- Pino → Loki (or Datadog Logs).
- Alert rule: error rate > X/min.

#### 17.4 PR: Runbook

- File mới `docs/RUNBOOK.md`:
  - Postgres down → step gì.
  - Redis down → step gì.
  - WS gateway crash → step gì.
  - Topup payment provider down → step gì.
  - Economy anomaly P0 alert → step gì.

#### 17.5 PR: Release process (semver + tagging)

- File mới hoặc cập nhật `docs/RELEASE_NOTES.md`:
  - v0.x for closed beta.
  - v1.0 for public launch.
  - Mỗi release: migration note, seed note, rollback plan, smoke pass, known risks, balance change.

### Exit criteria

- [ ] Sentry capturing errors prod.
- [ ] Backup-restore verified weekly.
- [ ] Runbook reviewed by ≥ 2 maintainer.
- [ ] v0.6 → v1.0 release plan approved.

---

## RELEASE TRACK (semver)

| Version | Phase tracker | Mục tiêu | ETA (rough) |
|---|---|---|---|
| **v0.1** closed beta launch | Phase 9 done | First 50-100 player feedback | T0 |
| **v0.2** content scale | Phase 10 done | 80+ item, 8+ dungeon | T0+1 month |
| **v0.3** progression depth | Phase 11 done | Công pháp + alchemy + refinery | T0+2-3 months |
| **v0.4** sect 2.0 + map | Phase 12 + 13 done | Region + sect war | T0+4-5 months |
| **v0.5** arena season | Phase 14 done | First arena season run | T0+6 months |
| **v0.6** live ops | Phase 15 done | Event scheduler + battle pass evaluation | T0+7-8 months |
| **v1.0** public launch | Phase 16 + 17 done | Anti-cheat + ops + payment integration | T0+9-12 months |

**Release checklist mỗi version** (xem `docs/RELEASE_NOTES.md`):

- Migration note (nếu có).
- Seed note (nếu có).
- Rollback plan (mọi migration phải có).
- Smoke pass (smoke:beta + smoke:economy + smoke:admin).
- Known risks.
- Balance change summary.
- Admin guide update (nếu có).
- AI_HANDOFF_REPORT update.

---

## DO-NOT-BUILD-YET LIST (anti-feature-creep)

> AI/dev sau ĐỪNG build các thứ dưới đây trừ khi có user/PM yêu cầu rõ ràng + dependency đã sẵn.

| Feature | Lý do hoãn | Khi nào unlock |
|---|---|---|
| **Real-time PvP** | Tốn infra, async chưa xong | Sau Phase 14 + 1 season validation |
| **Party / co-op dungeon** | Tốn infra, async PvE đủ dùng | Sau Phase 12 + người chơi yêu cầu mạnh |
| **Pet / Wife / Companion gacha** | Loot box, legal risk | Sau Phase 16 + monetization policy + drop table DB-backed |
| **Voice chat** | Out of scope | Có thể không bao giờ |
| **Mobile native app** | PWA đủ, native = tốn rebuild | v1.0 + sau khi PWA stable |
| **NFT / blockchain** | KHÔNG | Không bao giờ |
| **Real-money market** | Legal pháp lý VN không cho | Không bao giờ |
| **Real-money trade item** | Legal | Không bao giờ |
| **Multi-region (server) sharding** | Quá đắt cho ROI | Sau v1.0 + DAU > 10k |

---

## CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q (docs blueprint refresh).
