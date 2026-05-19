<script setup lang="ts">
/**
 * CultivationHubView — `/cultivation` real cultivation overview hub
 * (PR #625 — Phase 15.15).
 *
 * Replaces the legacy `redirect: '/cultivation-method-v2'` route with a
 * read-only hub that aggregates the player's cultivation progression
 * across the existing dedicated views. The hub does **not** duplicate
 * any gameplay action — it only summarises live store state and
 * surfaces deep links to:
 *
 *   - `/cultivation-method-v2` (Cultivation Method V2 — equip/upgrade)
 *   - `/breakthrough`          (Breakthrough RNG attempts)
 *   - `/body-cultivation`      (Body cultivation start/stop/breakthrough)
 *   - `/spiritual-root`        (Spiritual root reroll)
 *   - `/skill-book`            (Skill book / Pháp quyết)
 *   - `/tribulation`           (Heaven Tribulation)
 *
 * All data comes from real stores / API:
 *   - `useGameStore()`               — `character` (CharacterStatePayload),
 *                                      computed `realmFullName` /
 *                                      `expProgress`, fail-soft hydrators.
 *   - `useCultivationMethodStore()`  — `equippedMethodKey`,
 *                                      `affinityPercentLabel`,
 *                                      `learned` (legacy method registry).
 *   - `useCultivationMethodV2Store()` — V2 catalog + aggregated bonuses
 *                                      + `cultivationRateMul` /
 *                                      `bodyRateMul` for "rate" tile.
 *   - `useSpiritualRootStore()`      — root grade / elements / purity.
 *   - `useBodyCultivationStore()`    — body realm / stage / progress /
 *                                      breakthrough readiness.
 *
 * Empty-state policy: when `game.character` is null after hydrate, render
 * a friendly "no character" empty state with a CTA to `/onboarding` —
 * never fall back to mock VIP data. Mirrors policy enforced in
 * `CharacterView` (Phase 15.14) and `XTHomeDashboard` (Phase 15.10).
 *
 * Read-only by design: cultivate / breakthrough / equip method live on
 * the dedicated routes already. This hub exposes shortcut buttons rather
 * than duplicating those flows.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ELEMENT_NAME_VI, type ElementKey } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useCultivationMethodStore } from '@/stores/cultivationMethod';
import { useCultivationMethodV2Store } from '@/stores/cultivationMethodV2';
import { useSpiritualRootStore } from '@/stores/spiritualRoot';
import { useBodyCultivationStore } from '@/stores/bodyCultivation';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTLuxSection from '@/components/xianxia/XTLuxSection.vue';
import XTStatTile from '@/components/xianxia/XTStatTile.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const cultivationMethod = useCultivationMethodStore();
const cultivationMethodV2 = useCultivationMethodV2Store();
const spiritualRoot = useSpiritualRootStore();
const bodyCultivation = useBodyCultivationStore();
const router = useRouter();
const { t } = useI18n();

const ELEMENT_KEYS: readonly ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
const ROOT_GRADE_KEYS = ['pham', 'linh', 'huyen', 'tien', 'than'] as const;

/** Safe BigInt-aware EXP formatter — falls back to raw string. */
function fmtExp(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  try {
    const n = BigInt(String(value));
    return n.toLocaleString('vi-VN');
  } catch {
    return String(value);
  }
}

function fmtNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('vi-VN');
}

function elementName(key: string): string {
  if (ELEMENT_KEYS.includes(key as ElementKey)) {
    return t(
      `cultivationHub.elementName.${key}`,
      ELEMENT_NAME_VI[key as ElementKey],
    );
  }
  return key;
}

function rootGradeName(grade: string | null): string {
  if (!grade) return t('cultivationHub.spiritualRoot.noRoot');
  if ((ROOT_GRADE_KEYS as readonly string[]).includes(grade)) {
    return t(`cultivationHub.rootGrade.${grade}`, grade);
  }
  return grade;
}

const character = computed(() => game.character);

/* ───────────────────────────── Hero ──────────────────────────────── */

const heroTitle = computed(() => {
  const c = character.value;
  if (!c) return t('cultivationHub.title');
  return game.realmFullName || c.realmKey;
});

const heroSubtitle = computed(() => {
  const c = character.value;
  if (!c) return t('cultivationHub.noCharacter.title');
  return t('cultivationHub.subtitle', { name: c.name });
});

/* ─────────────────────────── Cultivation ─────────────────────────── */

const expProgressPct = computed(() =>
  Math.round(Math.min(Math.max(game.expProgress, 0), 1) * 100),
);

const expText = computed(() => {
  const c = character.value;
  if (!c) return '0 / 0';
  return `${fmtExp(c.exp)} / ${fmtExp(c.expNext)}`;
});

const atPeak = computed(() => {
  const c = character.value;
  if (!c) return false;
  try {
    return c.realmStage === 9 && BigInt(String(c.exp)) >= BigInt(String(c.expNext));
  } catch {
    return false;
  }
});

/**
 * Cultivation rate multiplier surfaced from V2 store — `1` is baseline.
 * `cultivationRateMul` reflects equipped V2 methods + aggregated bonuses;
 * we display only when the V2 store has loaded so we don't show a
 * misleading "+0%" before hydrate.
 */
const cultivationRateLabel = computed<string | null>(() => {
  if (!cultivationMethodV2.loaded) return null;
  const mul = cultivationMethodV2.cultivationRateMul ?? 1;
  if (!Number.isFinite(mul) || mul <= 0) return null;
  const pct = Math.round((mul - 1) * 100);
  if (pct === 0) return '×1.00';
  const sign = pct > 0 ? '+' : '−';
  return `×${mul.toFixed(2)} (${sign}${Math.abs(pct)}%)`;
});

const bodyRateLabel = computed<string | null>(() => {
  if (!cultivationMethodV2.loaded) return null;
  const mul = cultivationMethodV2.bodyRateMul ?? 1;
  if (!Number.isFinite(mul) || mul <= 0) return null;
  const pct = Math.round((mul - 1) * 100);
  if (pct === 0) return '×1.00';
  const sign = pct > 0 ? '+' : '−';
  return `×${mul.toFixed(2)} (${sign}${Math.abs(pct)}%)`;
});

/* ─────────────────────────── Method (V1 + V2) ─────────────────────── */

const equippedMethodKey = computed(
  () => cultivationMethod.equippedMethodKey,
);
const methodAffinityLabel = computed(
  () => cultivationMethod.affinityPercentLabel,
);
const learnedMethodCount = computed(
  () => cultivationMethod.learned.length,
);
const equippedV2Count = computed(
  () => cultivationMethodV2.equippedSlots.length,
);

/* ─────────────────────────── Spiritual Root ──────────────────────── */

const rootGrade = computed(
  () => spiritualRoot.state?.grade ?? character.value?.spiritualRootGrade ?? null,
);
const rootPrimary = computed(
  () => spiritualRoot.state?.primaryElement ?? character.value?.primaryElement ?? null,
);
const rootSecondary = computed<string[]>(() => {
  if (spiritualRoot.state?.secondaryElements) {
    return spiritualRoot.state.secondaryElements;
  }
  return character.value?.secondaryElements ?? [];
});
const rootPurity = computed(
  () => spiritualRoot.state?.purity ?? character.value?.rootPurity ?? null,
);

/* ─────────────────────────── Body cultivation ────────────────────── */

const bodyStatus = computed(() => bodyCultivation.status);

const bodyExpText = computed(() => {
  const s = bodyStatus.value;
  const c = character.value;
  if (s) return `${fmtExp(s.bodyExp)} / ${fmtExp(s.bodyExpNext)}`;
  if (c) return `${fmtExp(c.bodyExp)} / ${fmtExp(c.bodyExpNext)}`;
  return '0 / 0';
});

const bodyProgressPct = computed(() => {
  const s = bodyStatus.value;
  if (s) {
    return Math.round(Math.min(Math.max(bodyCultivation.progress, 0), 1) * 100);
  }
  const c = character.value;
  if (!c) return 0;
  try {
    const exp = BigInt(String(c.bodyExp));
    const next = BigInt(String(c.bodyExpNext));
    if (next === 0n) return 100;
    const ratio = Number((exp * 10000n) / next) / 10000;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  } catch {
    return 0;
  }
});

const bodyRealmName = computed(() => {
  return bodyStatus.value?.bodyRealmName ?? character.value?.bodyRealmName ?? null;
});

const bodyStage = computed(() => {
  return bodyStatus.value?.bodyStage ?? character.value?.bodyStage ?? null;
});

const bodyInjuryText = computed(() => {
  const until = bodyStatus.value?.bodyInjuryUntil ?? character.value?.bodyInjuryUntil ?? null;
  if (!until) return null;
  try {
    return new Date(until).toLocaleString('vi-VN');
  } catch {
    return until;
  }
});

const bodyCanBreakthrough = computed(() => bodyStatus.value?.canBreakthrough ?? false);

/* ─────────────────────────── Breakthrough readiness ──────────────── */

/**
 * Composite "next action" hint — picks the most actionable surface for
 * the player. Order of priority:
 *   1. atPeak             → go to /breakthrough (qi cultivation peak)
 *   2. bodyCanBreakthrough → go to /body-cultivation
 *   3. !cultivating        → go to /cultivation-method-v2 to start
 *   4. !equippedMethodKey  → go to /cultivation-method-v2 to equip
 *   5. !rootGrade          → go to /spiritual-root to awaken root
 *   6. default             → keep cultivating (no urgent action)
 */
const recommendation = computed<{ key: string; path: string } | null>(() => {
  const c = character.value;
  if (!c) return null;
  if (atPeak.value) {
    return { key: 'cultivationHub.recommend.breakthrough', path: '/breakthrough' };
  }
  if (bodyCanBreakthrough.value) {
    return { key: 'cultivationHub.recommend.bodyBreakthrough', path: '/body-cultivation' };
  }
  if (!c.cultivating) {
    return { key: 'cultivationHub.recommend.startCultivating', path: '/cultivation-method-v2' };
  }
  if (!equippedMethodKey.value && !equippedV2Count.value) {
    return { key: 'cultivationHub.recommend.equipMethod', path: '/cultivation-method-v2' };
  }
  if (!rootGrade.value) {
    return { key: 'cultivationHub.recommend.awakenRoot', path: '/spiritual-root' };
  }
  return { key: 'cultivationHub.recommend.keepCultivating', path: '/cultivation-method-v2' };
});

/* ─────────────────────────── Routing helpers ─────────────────────── */

function go(path: string): void {
  router.push(path).catch(() => null);
}

const DEEP_LINKS: ReadonlyArray<{ path: string; key: string; testId: string }> = [
  { path: '/cultivation-method-v2', key: 'cultivationHub.deepLinks.method', testId: 'cultivation-hub-link-method' },
  { path: '/breakthrough', key: 'cultivationHub.deepLinks.breakthrough', testId: 'cultivation-hub-link-breakthrough' },
  { path: '/body-cultivation', key: 'cultivationHub.deepLinks.body', testId: 'cultivation-hub-link-body' },
  { path: '/spiritual-root', key: 'cultivationHub.deepLinks.root', testId: 'cultivation-hub-link-root' },
  { path: '/skill-book', key: 'cultivationHub.deepLinks.skill', testId: 'cultivation-hub-link-skill' },
  { path: '/tribulation', key: 'cultivationHub.deepLinks.tribulation', testId: 'cultivation-hub-link-tribulation' },
];

/* ─────────────────────────── Lifecycle ───────────────────────────── */

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  // Always try to refresh character state first; fail-soft so the rest of
  // the page can still render an empty state when the API is down.
  await game.fetchState().catch(() => null);
  game.bindSocket();
  // Lazy-hydrate deeper progression stores. All fail-soft: if any
  // endpoint is down, the corresponding panel falls back to the field on
  // CharacterStatePayload (or a "not loaded" empty state) instead of
  // crashing.
  if (!spiritualRoot.loaded) {
    spiritualRoot.fetchState().catch(() => null);
  }
  if (!cultivationMethod.loaded) {
    cultivationMethod.fetchState().catch(() => null);
  }
  if (!cultivationMethodV2.loaded) {
    cultivationMethodV2.fetchState().catch(() => null);
  }
  if (!bodyCultivation.loaded) {
    bodyCultivation.fetchState().catch(() => null);
  }
});
</script>

<template>
  <AppShell>
    <div
      class="max-w-5xl mx-auto space-y-4"
      data-testid="cultivation-hub-view"
    >
      <XTLuxHero
        :eyebrow="t('cultivationHub.eyebrow')"
        :label="t('cultivationHub.label')"
        :title="heroTitle"
        :subtitle="heroSubtitle"
        :breadcrumb="t('cultivationHub.breadcrumb')"
        tone="jade"
        watermark-letter="T"
        test-id="cultivation-hub-hero"
      />

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="cultivation-hub-role-hint">
        {{ t('cultivationHub.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-2" data-testid="cultivation-hub-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-skillBook"
          @click="$router.push('/skill-book')"
        >
          <span>{{ t('cultivationHub.crossNav.skillBook') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('cultivationHub.crossNav.skillBookDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-equipment"
          @click="$router.push('/equipment')"
        >
          <span>{{ t('cultivationHub.crossNav.equipment') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('cultivationHub.crossNav.equipmentDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-breakthrough"
          @click="$router.push('/breakthrough')"
        >
          <span>{{ t('cultivationHub.crossNav.breakthrough') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('cultivationHub.crossNav.breakthroughDesc') }}</span>
        </button>
      </nav>

      <!-- Empty state — no character yet. Never fall back to mock VIP. -->
      <section
        v-if="!character"
        class="rounded-xl border border-amber-700/30 bg-[rgba(14,19,24,0.55)] p-6 text-center space-y-3"
        data-testid="cultivation-hub-empty"
      >
        <XTPageEyebrow
          :label="t('cultivationHub.noCharacter.title')"
          class="justify-center"
        />
        <p class="text-sm text-ink-300">
          {{ t('cultivationHub.noCharacter.hint') }}
        </p>
        <div class="flex justify-center">
          <MButton @click="go('/onboarding')">
            {{ t('cultivationHub.noCharacter.cta') }}
          </MButton>
        </div>
      </section>

      <template v-else>
        <!-- Recommended next action -->
        <section
          v-if="recommendation"
          class="rounded-xl border border-emerald-700/30 bg-[rgba(14,24,21,0.55)] p-4 flex flex-wrap items-center justify-between gap-3"
          data-testid="cultivation-hub-recommend"
        >
          <div class="space-y-1">
            <XTPageEyebrow :label="t('cultivationHub.recommend.eyebrow')" />
            <p class="text-sm text-emerald-100">
              {{ t(recommendation.key) }}
            </p>
          </div>
          <MButton
            data-testid="cultivation-hub-recommend-cta"
            @click="go(recommendation.path)"
          >
            {{ t('cultivationHub.recommend.cta') }}
          </MButton>
        </section>

        <!-- Realm + EXP overview -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.cultivation.section')"
          tone="jade"
          padding="tight"
          test-id="cultivation-hub-cultivation-section"
        >
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <XTStatTile
              :label="t('cultivationHub.cultivation.realm')"
              :value="game.realmFullName || character.realmKey"
              tone="gold"
              icon="cultivation"
              test-id="cultivation-hub-stat-realm"
            />
            <XTStatTile
              :label="t('cultivationHub.cultivation.level')"
              :value="fmtNumber(character.level)"
              tone="jade"
              icon="cultivation"
              test-id="cultivation-hub-stat-level"
            />
            <XTStatTile
              :label="t('cultivationHub.cultivation.power')"
              :value="fmtNumber(character.power)"
              tone="seal"
              icon="combat"
              test-id="cultivation-hub-stat-power"
            />
            <XTStatTile
              v-if="cultivationRateLabel"
              :label="t('cultivationHub.cultivation.rate')"
              :value="cultivationRateLabel"
              tone="mist"
              icon="cultivation"
              test-id="cultivation-hub-stat-rate"
            />
          </div>

          <div>
            <div class="flex justify-between text-xs text-ink-300">
              <span>{{ t('cultivationHub.cultivation.exp') }}</span>
              <span data-testid="cultivation-hub-exp-text">{{ expText }}</span>
            </div>
            <div class="h-2.5 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                :class="
                  character.cultivating
                    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(95,227,198,0.6)]'
                    : 'bg-ink-300'
                "
                :style="{ width: expProgressPct + '%' }"
                data-testid="cultivation-hub-exp-bar"
              />
            </div>
          </div>

          <p
            v-if="atPeak"
            class="text-xs text-amber-200 pt-2"
            data-testid="cultivation-hub-at-peak"
          >
            {{ t('cultivationHub.cultivation.atPeak') }}
          </p>
          <p class="text-xs text-ink-300 pt-1">
            {{
              character.cultivating
                ? t('cultivationHub.cultivation.cultivating')
                : t('cultivationHub.cultivation.idle')
            }}
          </p>
        </XTLuxSection>

        <!-- Cultivation method (V1 + V2 summary) -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.method.section')"
          tone="gold"
          padding="tight"
          test-id="cultivation-hub-method-section"
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.method.equipped') }}</span>
              <span class="text-ink-100" data-testid="cultivation-hub-method-equipped">
                {{ equippedMethodKey || t('cultivationHub.method.none') }}
              </span>
            </div>
            <div v-if="methodAffinityLabel" class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.method.affinity') }}</span>
              <span class="text-emerald-300">{{ methodAffinityLabel }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.method.learnedCount') }}</span>
              <span class="text-ink-100" data-testid="cultivation-hub-method-learned-count">
                {{ fmtNumber(learnedMethodCount) }}
              </span>
            </div>
            <div v-if="cultivationMethodV2.loaded" class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.method.v2Equipped') }}</span>
              <span class="text-ink-100" data-testid="cultivation-hub-method-v2-count">
                {{ fmtNumber(equippedV2Count) }} / 5
              </span>
            </div>
          </div>
          <div class="pt-3">
            <MButton
              data-testid="cultivation-hub-method-go"
              @click="go('/cultivation-method-v2')"
            >
              {{ t('cultivationHub.method.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Spiritual Root summary -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.spiritualRoot.section')"
          tone="mist"
          padding="tight"
          test-id="cultivation-hub-root-section"
        >
          <div v-if="!rootGrade" class="text-sm text-ink-300">
            {{ t('cultivationHub.spiritualRoot.noRoot') }}
          </div>
          <div v-else class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.spiritualRoot.grade') }}</span>
              <span
                class="text-amber-100"
                data-testid="cultivation-hub-root-grade"
              >
                {{ rootGradeName(rootGrade) }}
              </span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.spiritualRoot.primary') }}</span>
              <span
                class="text-ink-100"
                data-testid="cultivation-hub-root-primary"
              >
                {{ rootPrimary ? elementName(rootPrimary) : '—' }}
              </span>
            </div>
            <div v-if="rootSecondary.length" class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.spiritualRoot.secondary') }}</span>
              <span class="text-ink-100">
                {{ rootSecondary.map(elementName).join(' · ') }}
              </span>
            </div>
            <div v-if="rootPurity !== null" class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.spiritualRoot.purity') }}</span>
              <span class="text-ink-100">{{ rootPurity }}</span>
            </div>
          </div>
          <div class="pt-3">
            <MButton
              data-testid="cultivation-hub-root-go"
              @click="go('/spiritual-root')"
            >
              {{ t('cultivationHub.spiritualRoot.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Body Cultivation summary -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.body.section')"
          tone="seal"
          padding="tight"
          test-id="cultivation-hub-body-section"
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.body.realm') }}</span>
              <span
                class="text-ink-100"
                data-testid="cultivation-hub-body-realm"
              >
                {{ bodyRealmName ?? '—' }}
              </span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.body.stage') }}</span>
              <span class="text-ink-100">{{ bodyStage ?? '—' }}</span>
            </div>
            <div>
              <div class="flex justify-between text-xs text-ink-300">
                <span>{{ t('cultivationHub.body.exp') }}</span>
                <span data-testid="cultivation-hub-body-exp">{{ bodyExpText }}</span>
              </div>
              <div class="h-2 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
                <div
                  class="h-full rounded-full bg-amber-400"
                  :style="{ width: bodyProgressPct + '%' }"
                  data-testid="cultivation-hub-body-bar"
                />
              </div>
            </div>
            <div v-if="bodyRateLabel" class="flex justify-between text-ink-300">
              <span>{{ t('cultivationHub.body.rate') }}</span>
              <span class="text-ink-100">{{ bodyRateLabel }}</span>
            </div>
            <p
              v-if="bodyCanBreakthrough"
              class="text-xs text-amber-200"
              data-testid="cultivation-hub-body-ready"
            >
              {{ t('cultivationHub.body.ready') }}
            </p>
            <p v-if="bodyInjuryText" class="text-xs text-rose-300">
              {{ t('cultivationHub.body.injuryUntil') }}: {{ bodyInjuryText }}
            </p>
          </div>
          <div class="pt-3">
            <MButton
              data-testid="cultivation-hub-body-go"
              @click="go('/body-cultivation')"
            >
              {{ t('cultivationHub.body.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Breakthrough readiness -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.breakthrough.section')"
          tone="gold"
          padding="tight"
          test-id="cultivation-hub-breakthrough-section"
        >
          <div class="space-y-2 text-sm">
            <p
              v-if="atPeak"
              class="text-amber-200"
              data-testid="cultivation-hub-breakthrough-ready"
            >
              {{ t('cultivationHub.breakthrough.ready') }}
            </p>
            <p v-else class="text-ink-300">
              {{ t('cultivationHub.breakthrough.notReady') }}
            </p>
          </div>
          <div class="pt-3 flex flex-wrap gap-2">
            <MButton
              data-testid="cultivation-hub-breakthrough-go"
              @click="go('/breakthrough')"
            >
              {{ t('cultivationHub.breakthrough.go') }}
            </MButton>
            <MButton
              data-testid="cultivation-hub-tribulation-go"
              @click="go('/tribulation')"
            >
              {{ t('cultivationHub.breakthrough.goTribulation') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Deep links / shortcuts -->
        <XTLuxSection
          :eyebrow="t('cultivationHub.deepLinks.section')"
          tone="smoke"
          padding="tight"
          test-id="cultivation-hub-deep-links-section"
        >
          <div class="flex flex-wrap gap-2">
            <MButton
              v-for="link in DEEP_LINKS"
              :key="link.path"
              :data-testid="link.testId"
              @click="go(link.path)"
            >
              {{ t(link.key) }}
            </MButton>
          </div>
        </XTLuxSection>
      </template>
    </div>
  </AppShell>
</template>
