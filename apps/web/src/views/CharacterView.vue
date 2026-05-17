<script setup lang="ts">
/**
 * CharacterView — `/character` real player profile.
 *
 * Replaces the legacy `redirect: '/dashboard'` route with a deep, live
 * character profile page. All data comes from real stores / API:
 *   - `useGameStore()`        — `character` (CharacterStatePayload), `currentSect`,
 *                               computed `realmFullName` / `expProgress`,
 *                               and fail-soft hydrators (`hydrateCurrentSect`).
 *   - `useSpiritualRootStore()` — lazy `fetchState()` for /character/spiritual-root.
 *   - `useCultivationMethodStore()` — lazy `fetchState()` for
 *                                     /character/cultivation-method.
 *
 * Empty-state policy: when `game.character` is null after hydrate, render a
 * friendly "no character" empty state with a CTA to /onboarding — never fall
 * back to mock VIP data. Mirrors the policy enforced in `XTHomeDashboard`
 * (Phase 15.10) and HomeView (Phase 15.12).
 *
 * Read-only by design: cultivate / breakthrough / equip method live on
 * dedicated routes already (/cultivation-method-v2, /breakthrough,
 * /body-cultivation, /spiritual-root, /skill-book). This view exposes
 * shortcut buttons rather than duplicating those flows.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { ELEMENT_NAME_VI, type ElementKey } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useSpiritualRootStore } from '@/stores/spiritualRoot';
import { useCultivationMethodStore } from '@/stores/cultivationMethod';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTLuxSection from '@/components/xianxia/XTLuxSection.vue';
import XTStatTile from '@/components/xianxia/XTStatTile.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const spiritualRoot = useSpiritualRootStore();
const cultivationMethod = useCultivationMethodStore();
const router = useRouter();
const { t } = useI18n();

const ELEMENT_KEYS: readonly ElementKey[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];
const ROOT_GRADE_KEYS = ['pham', 'linh', 'huyen', 'tien', 'than'] as const;

/** Safe BigInt-aware EXP / EXP_NEXT formatter — falls back to raw string. */
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
    return t(`characterView.elementName.${key}`, ELEMENT_NAME_VI[key as ElementKey]);
  }
  return key;
}

function rootGradeName(grade: string | null): string {
  if (!grade) return t('characterView.spiritualRoot.noRoot');
  if ((ROOT_GRADE_KEYS as readonly string[]).includes(grade)) {
    return t(`characterView.rootGrade.${grade}`, grade);
  }
  return grade;
}

const character = computed(() => game.character);

const heroTitle = computed(() => character.value?.name ?? '—');
const heroSubtitle = computed(() => {
  const c = character.value;
  if (!c) return t('characterView.noCharacter.title');
  const realm = game.realmFullName || c.realmKey;
  return `${realm} · ${t('characterView.stats.level')} ${c.level}`;
});

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

const bodyExpText = computed(() => {
  const c = character.value;
  if (!c) return '0 / 0';
  return `${fmtExp(c.bodyExp)} / ${fmtExp(c.bodyExpNext)}`;
});

const bodyInjuryText = computed(() => {
  const c = character.value;
  if (!c?.bodyInjuryUntil) return null;
  try {
    return new Date(c.bodyInjuryUntil).toLocaleString('vi-VN');
  } catch {
    return c.bodyInjuryUntil;
  }
});

/* ───────────── Spiritual Root (lazy hydrate fail-soft) ───────────── */

const rootGrade = computed(
  () => spiritualRoot.state?.grade ?? character.value?.spiritualRootGrade ?? null,
);
const rootPrimary = computed(
  () => spiritualRoot.state?.primaryElement ?? character.value?.primaryElement ?? null,
);
const rootSecondary = computed(() => {
  if (spiritualRoot.state?.secondaryElements) {
    return spiritualRoot.state.secondaryElements;
  }
  return character.value?.secondaryElements ?? [];
});
const rootPurity = computed(
  () => spiritualRoot.state?.purity ?? character.value?.rootPurity ?? null,
);
const rootRerollCount = computed(() => spiritualRoot.state?.rerollCount ?? null);

/* ─────────── Cultivation Method (lazy hydrate fail-soft) ─────────── */

const equippedMethodKey = computed(() => cultivationMethod.equippedMethodKey);
const methodAffinityLabel = computed(() => cultivationMethod.affinityPercentLabel);
const learnedMethodCount = computed(() => cultivationMethod.learned.length);

/* ───────────────────────── Sect summary ──────────────────────────── */

const sect = computed(() => game.currentSect);
const hasSect = computed(() => Boolean(character.value?.sectId && sect.value));

/* ───────────────────────────── Routing ───────────────────────────── */

function go(path: string): void {
  router.push(path).catch(() => null);
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  // Always try to refresh character state first; fail-soft so rest of page
  // can still render an empty state.
  await game.fetchState().catch(() => null);
  game.bindSocket();
  // Lazy hydrate the deeper character-profile data. All fail-soft: if any
  // endpoint is down, the corresponding panel falls back to the field on
  // CharacterStatePayload (or a "not loaded" empty state) instead of crashing.
  game.hydrateCurrentSect().catch(() => null);
  if (!spiritualRoot.loaded) {
    spiritualRoot.fetchState().catch(() => null);
  }
  if (!cultivationMethod.loaded) {
    cultivationMethod.fetchState().catch(() => null);
  }
});
</script>

<template>
  <AppShell>
    <div
      class="max-w-5xl mx-auto space-y-4"
      data-testid="character-view"
    >
      <XTLuxHero
        :eyebrow="t('characterView.eyebrow')"
        :label="t('characterView.label')"
        :title="heroTitle"
        :subtitle="heroSubtitle"
        :breadcrumb="t('characterView.breadcrumb')"
        tone="gold"
        watermark-letter="C"
        test-id="character-view-hero"
      >
        <template v-if="character" #meta>
          <span
            v-if="character.title"
            class="px-2 py-0.5 rounded text-xs bg-amber-700/30 text-amber-100 border border-amber-700/40"
            data-testid="character-view-title-chip"
          >
            {{ character.title }}
          </span>
          <span
            v-if="character.role !== 'PLAYER'"
            class="px-2 py-0.5 rounded text-xs"
            :class="
              character.role === 'ADMIN'
                ? 'bg-amber-700/40 text-amber-200'
                : 'bg-blue-700/40 text-blue-200'
            "
          >
            {{ character.role }}
          </span>
        </template>
      </XTLuxHero>

      <!-- Empty state — no character yet. Never fall back to mock VIP. -->
      <section
        v-if="!character"
        class="rounded-xl border border-amber-700/30 bg-[rgba(14,19,24,0.55)] p-6 text-center space-y-3"
        data-testid="character-view-empty"
      >
        <XTPageEyebrow :label="t('characterView.noCharacter.title')" class="justify-center" />
        <p class="text-sm text-ink-300">
          {{ t('characterView.noCharacter.hint') }}
        </p>
        <div class="flex justify-center">
          <MButton @click="go('/onboarding')">
            {{ t('characterView.noCharacter.cta') }}
          </MButton>
        </div>
      </section>

      <template v-else>
        <!-- Core stats -->
        <XTLuxSection
          :eyebrow="t('characterView.stats.section')"
          tone="jade"
          padding="tight"
          test-id="character-view-stats-section"
        >
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <XTStatTile
              :label="t('characterView.stats.power')"
              :value="fmtNumber(character.power)"
              tone="seal"
              icon="combat"
              test-id="character-view-stat-power"
            />
            <XTStatTile
              :label="t('characterView.stats.spirit')"
              :value="fmtNumber(character.spirit)"
              tone="jade"
              icon="cultivation"
              test-id="character-view-stat-spirit"
            />
            <XTStatTile
              :label="t('characterView.stats.speed')"
              :value="fmtNumber(character.speed)"
              tone="mist"
              icon="quest"
              test-id="character-view-stat-speed"
            />
            <XTStatTile
              :label="t('characterView.stats.luck')"
              :value="fmtNumber(character.luck)"
              tone="gold"
              icon="gift"
              test-id="character-view-stat-luck"
            />
          </div>
        </XTLuxSection>

        <!-- Resources -->
        <XTLuxSection
          :eyebrow="t('characterView.resources.section')"
          tone="gold"
          padding="tight"
          test-id="character-view-resources-section"
        >
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <XTStatTile
              :label="t('characterView.resources.linhThach')"
              :value="fmtNumber(character.linhThach)"
              tone="jade"
              icon="cultivation"
              test-id="character-view-res-linh-thach"
            />
            <XTStatTile
              :label="t('characterView.resources.tienNgoc')"
              :value="fmtNumber(character.tienNgoc)"
              tone="gold"
              icon="gift"
              test-id="character-view-res-tien-ngoc"
            />
            <XTStatTile
              v-if="character.tienNgocKhoa !== undefined"
              :label="t('characterView.resources.tienNgocKhoa')"
              :value="fmtNumber(character.tienNgocKhoa)"
              tone="smoke"
              icon="gift"
              test-id="character-view-res-tien-ngoc-khoa"
            />
            <XTStatTile
              :label="t('characterView.resources.stamina')"
              :value="`${character.stamina} / ${character.staminaMax}`"
              tone="mist"
              icon="quest"
              test-id="character-view-res-stamina"
            />
          </div>
        </XTLuxSection>

        <!-- Cultivation -->
        <XTLuxSection
          :eyebrow="t('characterView.cultivation.section')"
          tone="jade"
          padding="tight"
          test-id="character-view-cultivation-section"
        >
          <div class="space-y-3">
            <div>
              <div class="flex justify-between text-xs text-ink-300">
                <span>{{ t('characterView.cultivation.realm') }}</span>
                <span>{{ game.realmFullName || character.realmKey }}</span>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs text-ink-300">
                <span>{{ t('characterView.cultivation.exp') }}</span>
                <span>{{ expText }}</span>
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
                  :data-testid="`character-view-exp-bar`"
                />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-ink-300 flex justify-between">
                  <span>HP</span>
                  <span>{{ character.hp }} / {{ character.hpMax }}</span>
                </div>
                <div class="h-2 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-rose-400"
                    :style="{ width: (character.hp / Math.max(1, character.hpMax)) * 100 + '%' }"
                  />
                </div>
              </div>
              <div>
                <div class="text-xs text-ink-300 flex justify-between">
                  <span>MP</span>
                  <span>{{ character.mp }} / {{ character.mpMax }}</span>
                </div>
                <div class="h-2 mt-1 rounded-full bg-ink-900/60 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-sky-400"
                    :style="{ width: (character.mp / Math.max(1, character.mpMax)) * 100 + '%' }"
                  />
                </div>
              </div>
            </div>
            <p v-if="atPeak" class="text-xs text-amber-200">
              {{ t('characterView.cultivation.atPeak') }}
            </p>
            <p class="text-xs text-ink-300">
              {{
                character.cultivating
                  ? t('characterView.cultivation.cultivating')
                  : t('characterView.cultivation.idle')
              }}
            </p>
            <div class="flex flex-wrap gap-2 pt-1">
              <MButton @click="go('/cultivation-method-v2')">
                {{ t('characterView.cultivation.goCultivate') }}
              </MButton>
              <MButton @click="go('/breakthrough')">
                {{ t('characterView.cultivation.goBreakthrough') }}
              </MButton>
              <MButton @click="go('/skill-book')">
                {{ t('characterView.cultivation.goSkillBook') }}
              </MButton>
            </div>
          </div>
        </XTLuxSection>

        <!-- Body cultivation -->
        <XTLuxSection
          :eyebrow="t('characterView.body.section')"
          tone="seal"
          padding="tight"
          test-id="character-view-body-section"
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.body.realm') }}</span>
              <span class="text-ink-100">{{ character.bodyRealmName || character.bodyRealmKey }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.body.stage') }}</span>
              <span class="text-ink-100">{{ character.bodyStage }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.body.exp') }}</span>
              <span class="text-ink-100">{{ bodyExpText }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.body.rate') }}</span>
              <span class="text-ink-100">{{ character.bodyRate }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.body.physique') }}</span>
              <span class="text-ink-100">{{
                character.physiqueKey || t('characterView.body.noPhysique')
              }}</span>
            </div>
            <p v-if="bodyInjuryText" class="text-xs text-rose-300">
              {{ t('characterView.body.injuryUntil') }}: {{ bodyInjuryText }}
            </p>
            <p class="text-xs text-ink-300">
              {{
                character.bodyCultivating
                  ? t('characterView.body.cultivating')
                  : t('characterView.body.idle')
              }}
            </p>
            <div class="pt-1">
              <MButton @click="go('/body-cultivation')">
                {{ t('characterView.body.go') }}
              </MButton>
            </div>
          </div>
        </XTLuxSection>

        <!-- Spiritual Root -->
        <XTLuxSection
          :eyebrow="t('characterView.spiritualRoot.section')"
          tone="mist"
          padding="tight"
          test-id="character-view-root-section"
        >
          <div v-if="!rootGrade" class="text-sm text-ink-300">
            {{ t('characterView.spiritualRoot.noRoot') }}
          </div>
          <div v-else class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.spiritualRoot.grade') }}</span>
              <span class="text-amber-100" data-testid="character-view-root-grade">
                {{ rootGradeName(rootGrade) }}
              </span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.spiritualRoot.primary') }}</span>
              <span class="text-ink-100" data-testid="character-view-root-primary">
                {{ rootPrimary ? elementName(rootPrimary) : '—' }}
              </span>
            </div>
            <div v-if="rootSecondary.length" class="flex justify-between text-ink-300">
              <span>{{ t('characterView.spiritualRoot.secondary') }}</span>
              <span class="text-ink-100" data-testid="character-view-root-secondary">
                {{ rootSecondary.map(elementName).join(' · ') }}
              </span>
            </div>
            <div v-if="rootPurity !== null" class="flex justify-between text-ink-300">
              <span>{{ t('characterView.spiritualRoot.purity') }}</span>
              <span class="text-ink-100">{{ rootPurity }}</span>
            </div>
            <div v-if="rootRerollCount !== null" class="flex justify-between text-ink-300">
              <span>{{ t('characterView.spiritualRoot.rerollCount') }}</span>
              <span class="text-ink-100">{{ rootRerollCount }}</span>
            </div>
          </div>
          <div class="pt-2">
            <MButton @click="go('/spiritual-root')">
              {{ t('characterView.spiritualRoot.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Cultivation method -->
        <XTLuxSection
          :eyebrow="t('characterView.method.section')"
          tone="gold"
          padding="tight"
          test-id="character-view-method-section"
        >
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.method.equipped') }}</span>
              <span class="text-ink-100" data-testid="character-view-method-equipped">
                {{ equippedMethodKey || t('characterView.method.none') }}
              </span>
            </div>
            <div v-if="methodAffinityLabel" class="flex justify-between text-ink-300">
              <span>{{ t('characterView.method.affinity') }}</span>
              <span class="text-emerald-300">{{ methodAffinityLabel }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>—</span>
              <span class="text-ink-100">
                {{ t('characterView.method.learnedCount', { count: learnedMethodCount }) }}
              </span>
            </div>
          </div>
          <div class="pt-2">
            <MButton @click="go('/cultivation-method-v2')">
              {{ t('characterView.method.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Sect summary -->
        <XTLuxSection
          :eyebrow="t('characterView.sect.section')"
          tone="jade"
          padding="tight"
          test-id="character-view-sect-section"
        >
          <div v-if="!hasSect" class="space-y-2 text-sm">
            <p class="text-ink-300">{{ t('characterView.sect.none') }}</p>
            <p class="text-xs text-ink-300">{{ t('characterView.sect.joinHint') }}</p>
          </div>
          <div v-else-if="sect" class="space-y-2 text-sm">
            <div class="flex justify-between text-ink-300">
              <span>{{ t('profile.sect') }}</span>
              <span class="text-amber-100" data-testid="character-view-sect-name">
                {{ sect.name }}
              </span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.sect.level') }}</span>
              <span class="text-ink-100">{{ sect.level }}</span>
            </div>
            <div class="flex justify-between text-ink-300">
              <span>{{ t('characterView.sect.members') }}</span>
              <span class="text-ink-100">{{ sect.memberCount }}</span>
            </div>
          </div>
          <div class="pt-2">
            <MButton @click="go('/sect')">
              {{ t('characterView.sect.go') }}
            </MButton>
          </div>
        </XTLuxSection>

        <!-- Shortcuts -->
        <XTLuxSection
          :eyebrow="t('characterView.shortcuts.section')"
          tone="smoke"
          padding="tight"
          test-id="character-view-shortcuts-section"
        >
          <div class="flex flex-wrap gap-2">
            <MButton @click="go('/equipment')">
              {{ t('characterView.shortcuts.equipment') }}
            </MButton>
            <MButton @click="go('/loadouts')">
              {{ t('characterView.shortcuts.loadouts') }}
            </MButton>
            <MButton @click="go('/achievements')">
              {{ t('characterView.shortcuts.achievements') }}
            </MButton>
            <MButton @click="go('/title')">
              {{ t('characterView.shortcuts.title') }}
            </MButton>
            <MButton @click="go('/skill-book')">
              {{ t('characterView.shortcuts.skill') }}
            </MButton>
            <MButton @click="go('/tribulation')">
              {{ t('characterView.shortcuts.tribulation') }}
            </MButton>
          </div>
        </XTLuxSection>
      </template>
    </div>
  </AppShell>
</template>
