<script setup lang="ts">
/**
 * Phase 11.6.D — Tribulation (Thiên Kiếp) view.
 *
 * Hiển thị kiếp sắp tới (nếu có) cho character đang ở peak realm + cho phép
 * trigger `POST /character/tribulation` (Phase 11.6.B server endpoint).
 * Server-authoritative: client chỉ gửi POST không body, server resolve
 * `c.realmKey → nextRealm()` + simulate kiếp deterministic + ghi
 * `TribulationAttemptLog` + atomic update character/currency/buff.
 *
 * Layout:
 *   - Header: title + character realm + stage.
 *   - Cooldown banner (nếu `tribulationCooldownAt` còn hiệu lực): live
 *     countdown đến lúc retry được. Phase 11.6.E.
 *   - Tâm Ma banner (nếu `taoMaUntil` còn hiệu lực): countdown debuff. Phase 11.6.E.
 *   - Upcoming tribulation card (nếu có def cho transition):
 *       - Tên + severity badge + type badge.
 *       - Description (lore).
 *       - Stat: số đợt (waves), reward preview (linhThach + expBonus +
 *         titleKey), failure penalty preview (expLossRatio + cooldownMinutes
 *         + taoMaDebuffChance).
 *       - Button "Vượt kiếp" — disable nếu inFlight, not at peak, no def,
 *         hoặc cooldown active. Phase 11.6.E pre-check tránh spam server reject.
 *   - Empty state (nếu không có def): hiển thị msg "low-tier transition,
 *     dùng Đột phá thông thường" hoặc "no next realm".
 *   - Last outcome banner (nếu vừa attempt phiên này):
 *       - Success: "Vượt kiếp thành công" + reward detail.
 *       - Fail: "Thất bại" + penalty detail (expLoss + cooldownAt +
 *         taoMa nếu có).
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 1 endpoint Phase 11.6.B
 * + 2 field expose Phase 11.6.E (`tribulationCooldownAt`/`taoMaUntil`).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  getTribulationForBreakthrough,
  nextRealm,
  realmByKey,
  type TribulationDef,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTribulationStore } from '@/stores/tribulation';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import TribulationMiniBattlePanel from '@/components/TribulationMiniBattlePanel.vue';

const auth = useAuthStore();
const game = useGameStore();
const tribulation = useTribulationStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

/**
 * Live ticker — re-evaluate computed `cooldownActive`/`cooldownRemainingText`/
 * `taoMaActive`/`taoMaRemainingText` mỗi giây để countdown chạy mượt mà
 * không cần fetchState lặp lại.
 */
const nowMs = ref<number>(Date.now());
let tickerHandle: ReturnType<typeof setInterval> | null = null;

/** Current peak detection: stage 9 + character exists. */
const atPeak = computed<boolean>(() => {
  const c = game.character;
  if (!c) return false;
  return c.realmStage >= 9;
});

/** Phase 11.6.E — cooldown active flag (server-side persisted timestamp). */
const cooldownActive = computed<boolean>(() => {
  const ts = game.character?.tribulationCooldownAt;
  if (!ts) return false;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return false;
  return ms > nowMs.value;
});

/** Phase 11.6.E — Tâm Ma debuff active flag. */
const taoMaActive = computed<boolean>(() => {
  const ts = game.character?.taoMaUntil;
  if (!ts) return false;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return false;
  return ms > nowMs.value;
});

function fmtRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const cooldownRemainingText = computed<string>(() => {
  const ts = game.character?.tribulationCooldownAt;
  if (!ts) return '';
  const ms = Date.parse(ts) - nowMs.value;
  return fmtRemaining(ms);
});

const taoMaRemainingText = computed<string>(() => {
  const ts = game.character?.taoMaUntil;
  if (!ts) return '';
  const ms = Date.parse(ts) - nowMs.value;
  return fmtRemaining(ms);
});

/** Realm name + stage display (e.g. "Kim Đan Cửu Trọng"). */
const currentRealmFull = computed<string>(() => game.realmFullName);

/** Next realm name nếu có (e.g. "Nguyên Anh"). */
const nextRealmName = computed<string | null>(() => {
  const c = game.character;
  if (!c) return null;
  const next = nextRealm(c.realmKey);
  return next ? next.name : null;
});

/** Tribulation def matches `(currentRealm, nextRealm)` transition. */
const upcomingDef = computed<TribulationDef | null>(() => {
  const c = game.character;
  if (!c) return null;
  const next = nextRealm(c.realmKey);
  if (!next) return null;
  return getTribulationForBreakthrough(c.realmKey, next.key) ?? null;
});

/**
 * Empty state reason:
 *   - 'no_character': chưa onboard.
 *   - 'no_next_realm': đã ở cảnh giới đỉnh (Hư Không Chí Tôn).
 *   - 'low_tier': transition không cần kiếp (e.g. phamnhan→luyenkhi) — caller
 *     dùng Đột phá thông thường.
 *   - null: có def, hiển thị tribulation card.
 */
const emptyReason = computed<'no_character' | 'no_next_realm' | 'low_tier' | null>(() => {
  const c = game.character;
  if (!c) return 'no_character';
  const next = nextRealm(c.realmKey);
  if (!next) return 'no_next_realm';
  if (!upcomingDef.value) return 'low_tier';
  return null;
});

const buttonDisabled = computed<boolean>(() => {
  if (tribulation.inFlight) return true;
  if (!upcomingDef.value) return true;
  if (!atPeak.value) return true;
  if (cooldownActive.value) return true;
  return false;
});

const buttonLabel = computed<string>(() => {
  if (tribulation.inFlight) return t('tribulation.button.attempting');
  if (!upcomingDef.value) return t('tribulation.button.unavailable');
  if (!atPeak.value) return t('tribulation.button.notAtPeak');
  if (cooldownActive.value) {
    return t('tribulation.button.cooldown', { remaining: cooldownRemainingText.value });
  }
  return t('tribulation.button.attempt');
});

function severityClass(s: TribulationDef['severity']): string {
  switch (s) {
    case 'minor':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'major':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'heavenly':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    case 'saint':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function typeClass(ty: TribulationDef['type']): string {
  switch (ty) {
    case 'lei':
      return 'bg-yellow-700/40 text-yellow-200 border-yellow-500/40';
    case 'hoa':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    case 'bang':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'phong':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'tam':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function realmName(key: string): string {
  return realmByKey(key)?.name ?? key;
}

/** Formatted reward — int format Vietnamese-friendly. */
function fmtNum(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString('vi-VN');
}

async function onAttempt(): Promise<void> {
  if (buttonDisabled.value) return;
  // Phase 14.3.C — gửi selected support item keys; server consume in tx +
  // recalc bonus server-side (FE chỉ là UI hint, KHÔNG authority).
  const selected = [...selectedSupportItemKeys.value];
  const errCode = await tribulation.attempt(selected);
  if (errCode === null) {
    // attempt accepted — outcome populated in store
    const outcome = tribulation.lastOutcome;
    if (outcome?.success) {
      toast.push({
        type: 'success',
        text: t('tribulation.attempt.successToast', {
          to: realmName(outcome.toRealmKey),
        }),
      });
    } else {
      toast.push({
        type: 'warning',
        text: t('tribulation.attempt.failToast'),
      });
    }
    // Phase 14.3.C — clear selection sau attempt (items đã consumed; preview
    // sẽ refetch sang availableSupportItems mới).
    selectedSupportItemKeys.value = [];
    // refetch state để cập nhật realmKey/realmStage/exp/linhThach
    await game.fetchState().catch(() => null);
    // Phase 11.6.G — refetch history sau khi attempt accept (1 row mới được ghi).
    await tribulation.fetchHistory().catch(() => null);
    // Phase 14.3.C — refetch preview để availableSupportItems sync với inventory mới.
    await tribulation.fetchPreview().catch(() => null);
  } else {
    const key = `tribulation.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('tribulation.errors.UNKNOWN') : text,
    });
  }
}

/** Phase 11.6.G — format ISO date sang format ngắn human-readable. */
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function reloadHistory(): Promise<void> {
  await tribulation.fetchHistory().catch(() => null);
}

/**
 * Phase 11.6.H — load more history button handler. Store đã clamp +
 * race-protect; chỉ cần forward error code sang toast nếu fail (KHÔNG
 * 'IN_FLIGHT'/'MAX_REACHED' — UI ngăn click trước khi phát sinh).
 */
async function onLoadMore(): Promise<void> {
  const errCode = await tribulation.loadMoreHistory();
  if (errCode && errCode !== 'IN_FLIGHT' && errCode !== 'MAX_REACHED') {
    toast.push({
      type: 'error',
      text: t('tribulation.history.loadError'),
    });
  }
}

/**
 * Phase 11.6.J — set client-side history filter. Pure presentation, không
 * trigger API call. Store đã validate input.
 */
function onHistoryFilter(filter: 'all' | 'success' | 'fail'): void {
  tribulation.setHistoryFilter(filter);
}

const showOutcome = ref<boolean>(false);
function dismissOutcome(): void {
  showOutcome.value = false;
  tribulation.clearLastOutcome();
}

/**
 * Phase 14.3.C — selected support item keys (≤ N=preview.maxSelectedSupportItems).
 * Reset khi rời page hoặc dismissOutcome (sau attempt thì server đã consume,
 * stale selection KHÔNG còn hợp lệ).
 */
const selectedSupportItemKeys = ref<string[]>([]);

const maxSelectedSupportItems = computed<number>(() => {
  return tribulation.preview?.maxSelectedSupportItems ?? 3;
});

const availableSupportItems = computed(() => {
  return tribulation.preview?.availableSupportItems ?? [];
});

const selectionLimitReached = computed<boolean>(() => {
  return (
    selectedSupportItemKeys.value.length >= maxSelectedSupportItems.value
  );
});

/**
 * Phase 14.3.C — predicted bonus tổng từ selected items (additive sum, KHÔNG
 * apply per-entry/total cap ở client side — server có authority cap; đây
 * chỉ là estimate visual).
 */
const predictedSupportItemBonus = computed<number>(() => {
  let sum = 0;
  for (const key of selectedSupportItemKeys.value) {
    const entry = availableSupportItems.value.find((e) => e.itemKey === key);
    if (entry) sum += entry.bonus;
  }
  return sum;
});

function isSupportSelected(itemKey: string): boolean {
  return selectedSupportItemKeys.value.includes(itemKey);
}

function toggleSupportItem(itemKey: string): void {
  const idx = selectedSupportItemKeys.value.indexOf(itemKey);
  if (idx >= 0) {
    selectedSupportItemKeys.value.splice(idx, 1);
    return;
  }
  if (selectedSupportItemKeys.value.length >= maxSelectedSupportItems.value) {
    toast.push({
      type: 'warning',
      text: t('tribulation.field.selectionLimitReached', {
        max: maxSelectedSupportItems.value,
      }),
    });
    return;
  }
  selectedSupportItemKeys.value.push(itemKey);
}

// ── Phase 14.3.D — Encounter mode handlers ─────────────────────────────────

/**
 * Encounter element advantage label key — UI gameplay-relevant text:
 *   +2/+1 → 'advantage', 0 → 'neutral', -1/-2 → 'disadvantage'.
 */
function encounterAdvantageLabel(adv: number): string {
  if (adv >= 2) return 'sameElement';
  if (adv === 1) return 'advantage';
  if (adv === 0) return 'neutral';
  if (adv === -1) return 'disadvantageMild';
  return 'disadvantageSevere';
}

function encounterAdvantageClass(adv: number): string {
  if (adv > 0) return 'text-emerald-200 bg-emerald-700/40 border-emerald-500/40';
  if (adv < 0) return 'text-rose-200 bg-rose-700/40 border-rose-500/40';
  return 'text-ink-200 bg-ink-700/40 border-ink-300/30';
}

const encounterStartDisabled = computed<boolean>(() => {
  if (!atPeak.value) return true;
  if (cooldownActive.value) return true;
  if (tribulation.encounterStarting) return true;
  if (tribulation.encounterResolving) return true;
  if (tribulation.encounterPending) return true;
  return false;
});

const encounterResolveDisabled = computed<boolean>(() => {
  if (!tribulation.encounterPending) return true;
  if (tribulation.encounterStarting) return true;
  if (tribulation.encounterResolving) return true;
  return false;
});

async function onEncounterStart(): Promise<void> {
  if (encounterStartDisabled.value) return;
  const selected = [...selectedSupportItemKeys.value];
  const errCode = await tribulation.startEncounter(selected);
  if (errCode === null) {
    toast.push({
      type: 'success',
      text: t('tribulation.encounter.startedToast'),
    });
  } else {
    const key = `tribulation.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('tribulation.errors.UNKNOWN') : text,
    });
  }
}

async function onEncounterResolve(): Promise<void> {
  if (encounterResolveDisabled.value) return;
  const errCode = await tribulation.resolveEncounter();
  if (errCode === null) {
    const outcome = tribulation.lastOutcome;
    if (outcome?.success) {
      toast.push({
        type: 'success',
        text: t('tribulation.attempt.successToast', {
          to: realmName(outcome.toRealmKey),
        }),
      });
    } else {
      toast.push({
        type: 'warning',
        text: t('tribulation.attempt.failToast'),
      });
    }
    selectedSupportItemKeys.value = [];
    await game.fetchState().catch(() => null);
    await tribulation.fetchHistory().catch(() => null);
    await tribulation.fetchPreview().catch(() => null);
  } else {
    const key = `tribulation.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('tribulation.errors.UNKNOWN') : text,
    });
  }
}

/** Phase 14.3.D — CTA after successful encounter resolve → cultivation. */
function onReturnToCultivation(): void {
  router.push('/cultivation');
}

/**
 * Phase 14.3.E.2 — mini-battle panel toggle gate.
 *
 * Show panel khi:
 *   - Feature flag bật (server response chưa từng trả 501) — `miniBattleAvailable`
 *     null/true.
 *   - User at peak + có upcoming encounter (or pending row).
 *
 * Khi `miniBattleAvailable === false` → hide panel, fallback hoàn toàn về
 * Phase 14.3.D encounter resolve flow (server quyết định).
 */
const miniBattlePanelVisible = computed<boolean>(() => {
  // Backward compat: chỉ render mini-battle panel khi backend xác nhận
  // feature flag bật (`miniBattleAvailable === true`). State `null` (initial,
  // chưa fetch) hoặc `false` (501 disabled) → giữ encounter resolve flow
  // Phase 14.3.D không đổi.
  if (tribulation.miniBattleAvailable !== true) return false;
  if (!atPeak.value) return false;
  if (tribulation.miniBattle) return true;
  if (tribulation.encounter && tribulation.encounterPending) return true;
  if (tribulation.encounter) return true;
  return false;
});

/** Phase 14.3.E.2 — Disable Start nút khi cooldown active. */
const miniBattleStartDisabled = computed<boolean>(() => {
  if (cooldownActive.value) return true;
  if (tribulation.miniBattleStarting) return true;
  return false;
});

function onMiniBattleErrored(code: string): void {
  const key = `tribulation.errors.${code}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t('tribulation.errors.UNKNOWN') : text,
  });
}

async function onMiniBattleReturnCultivation(): Promise<void> {
  // Refresh game/preview/history sau khi mini-battle resolved (state đã đổi).
  await game.fetchState().catch(() => null);
  await tribulation.fetchHistory().catch(() => null);
  await tribulation.fetchPreview().catch(() => null);
  await tribulation.fetchEncounter().catch(() => null);
  router.push('/cultivation');
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  // Phase 11.6.G — fetch tribulation history (idempotent GET).
  tribulation.fetchHistory().catch(() => null);
  // Phase 14.3.A — fetch preview snapshot song song (read-only deterministic
  // estimate, không trigger RNG/log).
  tribulation.fetchPreview().catch(() => null);
  // Phase 14.3.D — fetch encounter snapshot (current pending row + spec).
  tribulation.fetchEncounter().catch(() => null);
  // Phase 14.3.E.2 — fetch current mini-battle. Idempotent. Server trả null
  // nếu chưa start; trả 501 nếu feature flag tắt → store set
  // miniBattleAvailable=false → fallback flow.
  tribulation.fetchCurrentBattle().catch(() => null);
  // Phase 11.6.E — live countdown ticker (1 Hz), đủ smooth + đủ rẻ.
  tickerHandle = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (tickerHandle !== null) {
    clearInterval(tickerHandle);
    tickerHandle = null;
  }
});
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-4">
      <XTLuxHero
        eyebrow="THIÊN KIẾP GIÁNG THẾ"
        label="Thiên Kiếp Giáng Thế"
        :title="t('tribulation.title')"
        :subtitle="t('tribulation.subtitle')"
        tone="seal"
        watermark-letter="T"
        breadcrumb="Chiến Đạo · Vượt Kiếp"
        test-id="tribulation-view-hero"
      >
        <XTPageEyebrow caps="THIÊN KIẾP GIÁNG THẾ" label="Thiên Kiếp Giáng Thế" class="sr-only" />
        <header class="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p class="text-xs text-ink-300 mt-1">
              {{ t('tribulation.subtitle') }}
            </p>
          </div>
          <div
            v-if="game.character"
            class="text-xs text-ink-300"
            data-testid="tribulation-current-realm"
          >
            {{ t('tribulation.currentRealm', { name: currentRealmFull }) }}
          </div>
        </header>
      </XTLuxHero>

      <!-- Phase 11.6.E — cooldown banner (live countdown) -->
      <section
        v-if="cooldownActive"
        class="rounded p-3 border bg-amber-900/30 border-amber-500/40 text-amber-100 text-xs"
        data-testid="tribulation-cooldown-banner"
      >
        <div class="font-semibold mb-0.5">{{ t('tribulation.cooldown.title') }}</div>
        <div data-testid="tribulation-cooldown-remaining">
          {{ t('tribulation.cooldown.remaining', { remaining: cooldownRemainingText }) }}
        </div>
      </section>

      <!-- Phase 11.6.E — Tâm Ma debuff banner -->
      <section
        v-if="taoMaActive"
        class="rounded p-3 border bg-violet-900/30 border-violet-500/40 text-violet-100 text-xs"
        data-testid="tribulation-taoma-banner"
      >
        <div class="font-semibold mb-0.5">{{ t('tribulation.taoMa.title') }}</div>
        <div data-testid="tribulation-taoma-remaining">
          {{ t('tribulation.taoMa.remaining', { remaining: taoMaRemainingText }) }}
        </div>
      </section>

      <!-- Last outcome banner (success or fail) -->
      <section
        v-if="tribulation.lastOutcome"
        :class="[
          'rounded p-4 border',
          tribulation.lastOutcome.success
            ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-100'
            : 'bg-rose-900/30 border-rose-500/40 text-rose-100',
        ]"
        data-testid="tribulation-last-outcome"
      >
        <header class="flex items-center justify-between mb-2">
          <h2 class="text-base font-semibold">
            <template v-if="tribulation.lastOutcome.success">
              {{ t('tribulation.outcome.successTitle') }}
            </template>
            <template v-else>
              {{ t('tribulation.outcome.failTitle') }}
            </template>
          </h2>
          <button
            type="button"
            class="text-xs text-ink-300 hover:text-ink-50"
            data-testid="tribulation-outcome-dismiss"
            @click="dismissOutcome"
          >
            {{ t('tribulation.outcome.dismiss') }}
          </button>
        </header>

        <div class="text-xs space-y-1">
          <div data-testid="tribulation-outcome-transition">
            {{
              t('tribulation.outcome.transition', {
                from: realmName(tribulation.lastOutcome.fromRealmKey),
                to: realmName(tribulation.lastOutcome.toRealmKey),
              })
            }}
          </div>
          <div data-testid="tribulation-outcome-waves">
            {{
              t('tribulation.outcome.wavesCompleted', {
                count: tribulation.lastOutcome.wavesCompleted,
              })
            }}
            ·
            {{
              t('tribulation.outcome.totalDamage', {
                dmg: fmtNum(tribulation.lastOutcome.totalDamage),
              })
            }}
            · HP {{ fmtNum(tribulation.lastOutcome.finalHp) }}
          </div>

          <div
            v-if="tribulation.lastOutcome.success && tribulation.lastOutcome.reward"
            class="mt-2 space-y-0.5"
            data-testid="tribulation-outcome-reward"
          >
            <div>
              {{
                t('tribulation.outcome.rewardLinhThach', {
                  amount: fmtNum(tribulation.lastOutcome.reward.linhThach),
                })
              }}
            </div>
            <div>
              {{
                t('tribulation.outcome.rewardExpBonus', {
                  amount: fmtNum(tribulation.lastOutcome.reward.expBonus),
                })
              }}
            </div>
            <div v-if="tribulation.lastOutcome.reward.titleKey">
              {{
                t('tribulation.outcome.rewardTitle', {
                  key: tribulation.lastOutcome.reward.titleKey,
                })
              }}
            </div>
          </div>

          <div
            v-if="!tribulation.lastOutcome.success && tribulation.lastOutcome.penalty"
            class="mt-2 space-y-0.5"
            data-testid="tribulation-outcome-penalty"
          >
            <div>
              {{
                t('tribulation.outcome.penaltyExpLoss', {
                  amount: fmtNum(tribulation.lastOutcome.penalty.expLoss),
                })
              }}
            </div>
            <div>
              {{
                t('tribulation.outcome.penaltyCooldown', {
                  ts: tribulation.lastOutcome.penalty.cooldownAt,
                })
              }}
            </div>
            <div v-if="tribulation.lastOutcome.penalty.taoMaActive">
              {{
                t('tribulation.outcome.penaltyTaoMa', {
                  ts: tribulation.lastOutcome.penalty.taoMaExpiresAt ?? '',
                })
              }}
            </div>
          </div>

          <!--
            Phase 14.3.C — consumed support items display (success + fail
            paths). Server resolve labels từ catalog. Empty render hint
            "no items used" để rõ ràng UX.
          -->
          <div class="mt-2 space-y-0.5" data-testid="tribulation-outcome-consumed">
            <div class="text-ink-300 text-[11px]">
              {{ t('tribulation.field.consumedTitle') }}:
            </div>
            <ul
              v-if="tribulation.lastOutcome.consumedSupportItems.length > 0"
              class="pl-2 space-y-0.5"
            >
              <li
                v-for="(item, idx) in tribulation.lastOutcome.consumedSupportItems"
                :key="`${item.itemKey}-${idx}`"
                class="text-amber-200 text-[11px]"
                :data-testid="`tribulation-outcome-consumed-${idx}`"
              >
                {{ t('tribulation.field.consumedItem', { label: item.label }) }}
                <span class="text-ink-300 ml-1">
                  (+{{ Math.round(item.bonus * 100) }}%)
                </span>
              </li>
            </ul>
            <p
              v-else
              class="text-ink-300/70 text-[11px]"
              data-testid="tribulation-outcome-consumed-empty"
            >
              {{ t('tribulation.field.consumedNone') }}
            </p>
          </div>
        </div>
      </section>

      <!-- Empty state -->
      <section
        v-if="emptyReason"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="tribulation-empty"
      >
        <template v-if="emptyReason === 'no_character'">
          {{ t('tribulation.empty.noCharacter') }}
        </template>
        <template v-else-if="emptyReason === 'no_next_realm'">
          {{ t('tribulation.empty.noNextRealm') }}
        </template>
        <template v-else-if="emptyReason === 'low_tier'">
          {{
            t('tribulation.empty.lowTier', {
              from: currentRealmFull,
              to: nextRealmName ?? '',
            })
          }}
        </template>
      </section>

      <!-- Phase 14.3.D — Tribulation Encounter panel.
           Server-authoritative encounter spec (element / effectType /
           difficulty / phase count / advantage). Cho phép user start →
           resolve theo flow 2 phase. Idempotent server-side: re-call start
           với cùng tribulationKey trả pending row hiện có; re-call resolve
           sau resolved trả cached outcome (no double breakthrough/consume). -->
      <section
        v-if="tribulation.encounter"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
        data-testid="tribulation-encounter-panel"
      >
        <header class="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 class="text-amber-200 text-lg font-semibold">
            {{ t(`tribulation.encounter.name.${tribulation.encounter.encounter.element}`) }}
          </h2>
          <div class="flex items-center gap-1 flex-wrap">
            <span
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded border',
                typeClass(tribulation.encounter.encounter.element as TribulationDef['type']),
              ]"
              data-testid="tribulation-encounter-element-badge"
            >
              {{ t(`tribulation.encounter.element.${tribulation.encounter.encounter.element}`) }}
            </span>
            <span
              class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
              data-testid="tribulation-encounter-effect-badge"
            >
              {{ t(`tribulation.encounter.effectType.${tribulation.encounter.encounter.effectType}`) }}
            </span>
            <span
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded border',
                encounterAdvantageClass(tribulation.encounter.encounter.elementAdvantage),
              ]"
              data-testid="tribulation-encounter-advantage-badge"
            >
              {{
                t(
                  `tribulation.encounter.advantage.${encounterAdvantageLabel(tribulation.encounter.encounter.elementAdvantage)}`,
                )
              }}
            </span>
            <span
              v-if="tribulation.encounterPending"
              class="text-[10px] px-1.5 py-0.5 rounded border bg-amber-700/40 text-amber-100 border-amber-500/40"
              data-testid="tribulation-encounter-pending-badge"
            >
              {{ t('tribulation.encounter.statePending') }}
            </span>
          </div>
        </header>

        <p
          class="text-sm text-ink-300"
          data-testid="tribulation-encounter-description"
        >
          {{ tribulation.encounter.encounter.description }}
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div data-testid="tribulation-encounter-phase-count">
            <span class="text-ink-300">{{ t('tribulation.encounter.field.phaseCount') }}:</span>
            <span class="text-ink-100 ml-1">{{ tribulation.encounter.encounter.phaseCount }}</span>
          </div>
          <div data-testid="tribulation-encounter-difficulty">
            <span class="text-ink-300">{{ t('tribulation.encounter.field.difficulty') }}:</span>
            <span class="text-ink-100 ml-1">
              {{ t(`tribulation.severity.${tribulation.encounter.encounter.difficulty}`) }}
            </span>
          </div>
          <div data-testid="tribulation-encounter-power-hint">
            <span class="text-ink-300">{{ t('tribulation.encounter.field.powerHint') }}:</span>
            <span class="text-ink-100 ml-1">{{ fmtNum(tribulation.encounter.encounter.requiredPowerHint) }}</span>
          </div>
          <div
            v-if="tribulation.encounter.successChance"
            data-testid="tribulation-encounter-success-chance"
          >
            <span class="text-ink-300">{{ t('tribulation.field.successChance') }}:</span>
            <span class="text-amber-200 ml-1 font-semibold">
              {{ Math.round(tribulation.encounter.successChance.final * 100) }}%
            </span>
          </div>
        </div>

        <!-- Phase 14.3.E.2 — Mini-battle panel (turn-based UI). Render khi
             feature flag bật + có encounter; fallback sang encounter
             start/resolve buttons khi flag tắt (miniBattleAvailable=false). -->
        <TribulationMiniBattlePanel
          v-if="miniBattlePanelVisible"
          data-testid="tribulation-mini-battle-panel-mount"
          :selected-support-item-keys="selectedSupportItemKeys"
          :start-disabled="miniBattleStartDisabled"
          @errored="onMiniBattleErrored"
          @return-cultivation="onMiniBattleReturnCultivation"
        />

        <div
          v-else
          class="flex flex-col sm:flex-row gap-2"
        >
          <button
            v-if="!tribulation.encounterPending"
            type="button"
            :disabled="encounterStartDisabled"
            data-testid="tribulation-encounter-start-button"
            class="flex-1 px-3 py-2 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onEncounterStart"
          >
            {{
              tribulation.encounterStarting
                ? t('tribulation.encounter.button.starting')
                : t('tribulation.encounter.button.start')
            }}
          </button>
          <button
            v-else
            type="button"
            :disabled="encounterResolveDisabled"
            data-testid="tribulation-encounter-resolve-button"
            class="flex-1 px-3 py-2 text-sm rounded bg-rose-700 text-rose-50 hover:bg-rose-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onEncounterResolve"
          >
            {{
              tribulation.encounterResolving
                ? t('tribulation.encounter.button.resolving')
                : t('tribulation.encounter.button.resolve')
            }}
          </button>
        </div>

        <!-- Phase 14.3.D — CTA về cultivation sau khi success encounter. -->
        <div
          v-if="tribulation.lastOutcome && tribulation.lastOutcome.success"
          data-testid="tribulation-encounter-cta-cultivation"
          class="border-t border-ink-300/20 pt-2"
        >
          <button
            type="button"
            class="w-full px-3 py-2 text-sm rounded bg-emerald-700 text-emerald-50 hover:bg-emerald-600"
            data-testid="tribulation-encounter-return-cultivation"
            @click="onReturnToCultivation"
          >
            {{ t('tribulation.encounter.cta.returnCultivation') }}
          </button>
        </div>

        <div
          v-if="tribulation.encounterError"
          class="text-xs text-rose-300"
          data-testid="tribulation-encounter-error"
        >
          {{
            (() => {
              const code = tribulation.encounterError;
              const key = `tribulation.errors.${code}`;
              const text = t(key);
              return text === key ? t('tribulation.errors.UNKNOWN') : text;
            })()
          }}
        </div>
      </section>

      <!-- Upcoming tribulation card -->
      <section
        v-else-if="upcomingDef"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
        :data-testid="`tribulation-card-${upcomingDef.key}`"
      >
        <header class="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 class="text-amber-200 text-lg font-semibold">{{ upcomingDef.name }}</h2>
          <div class="flex items-center gap-1">
            <span
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded border',
                severityClass(upcomingDef.severity),
              ]"
              data-testid="tribulation-severity-badge"
            >
              {{ t(`tribulation.severity.${upcomingDef.severity}`) }}
            </span>
            <span
              :class="[
                'text-[10px] px-1.5 py-0.5 rounded border',
                typeClass(upcomingDef.type),
              ]"
              data-testid="tribulation-type-badge"
            >
              {{ t(`tribulation.type.${upcomingDef.type}`) }}
            </span>
          </div>
        </header>

        <p class="text-sm text-ink-300" data-testid="tribulation-description">
          {{ upcomingDef.description }}
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div data-testid="tribulation-transition">
            <span class="text-ink-300">{{ t('tribulation.field.transition') }}:</span>
            <span class="text-ink-100 ml-1">
              {{ realmName(upcomingDef.fromRealmKey) }} → {{ realmName(upcomingDef.toRealmKey) }}
            </span>
          </div>
          <div data-testid="tribulation-waves">
            <span class="text-ink-300">{{ t('tribulation.field.waves') }}:</span>
            <span class="text-ink-100 ml-1">{{ upcomingDef.waves.length }}</span>
          </div>
        </div>

        <!--
          Phase 14.3.A/B — preview panel (success chance + supports).
          Server-authoritative deterministic estimate (không roll RNG, không
          ghi log). Hiển thị final %, breakdown base/elementAdjustment/
          supportBonus, danh sách supports với label + element badge,
          và cap warnings (per-entry / total) khi server clamp.
        -->
        <div
          v-if="tribulation.preview"
          class="border-t border-ink-300/20 pt-2 space-y-1 text-xs"
          data-testid="tribulation-preview-panel"
        >
          <h3 class="text-ink-300 mb-1">{{ t('tribulation.field.previewTitle') }}</h3>
          <div data-testid="tribulation-preview-success-chance">
            <span class="text-ink-300">{{ t('tribulation.field.successChance') }}:</span>
            <span class="text-amber-200 ml-1 font-semibold">
              {{ Math.round(tribulation.preview.successChance.final * 100) }}%
            </span>
          </div>
          <div
            v-if="tribulation.preview.successChance.elementAdjustment !== 0"
            data-testid="tribulation-preview-affinity"
          >
            <span class="text-ink-300">{{ t('tribulation.field.affinity') }}:</span>
            <span
              :class="[
                'ml-1',
                tribulation.preview.successChance.elementAdjustment > 0
                  ? 'text-emerald-200'
                  : 'text-rose-200',
              ]"
            >
              {{ tribulation.preview.successChance.elementAdjustment > 0 ? '+' : '' }}{{
                Math.round(tribulation.preview.successChance.elementAdjustment * 100)
              }}%
            </span>
          </div>
          <div
            v-if="tribulation.preview.successChance.supportBonus !== 0"
            data-testid="tribulation-preview-support-bonus"
          >
            <span class="text-ink-300">{{ t('tribulation.field.supportBonus') }}:</span>
            <span
              :class="[
                'ml-1',
                tribulation.preview.successChance.supportBonus > 0
                  ? 'text-emerald-200'
                  : 'text-rose-200',
              ]"
            >
              {{ tribulation.preview.successChance.supportBonus > 0 ? '+' : '' }}{{
                Math.round(tribulation.preview.successChance.supportBonus * 100)
              }}%
            </span>
          </div>
          <div
            v-if="tribulation.preview.supports.length > 0"
            class="space-y-0.5"
            data-testid="tribulation-preview-supports"
          >
            <div class="text-ink-300">{{ t('tribulation.field.supports') }}:</div>
            <ul class="pl-2 space-y-0.5">
              <li
                v-for="(s, idx) in tribulation.preview.supports"
                :key="`${s.source}-${s.key}-${idx}`"
                class="text-emerald-200"
                :data-testid="`tribulation-preview-support-${idx}`"
              >
                <span
                  class="inline-block px-1 mr-1 rounded bg-ink-700/40 text-ink-200 uppercase text-[10px]"
                  :data-testid="`tribulation-preview-support-${idx}-source`"
                >
                  {{ t(`tribulation.supportSource.${s.source}`) }}
                </span>
                <span
                  class="text-ink-100"
                  :data-testid="`tribulation-preview-support-${idx}-label`"
                >{{ s.label || s.key }}</span>
                <span
                  v-if="s.element"
                  class="ml-1 text-[10px] text-amber-200"
                  :data-testid="`tribulation-preview-support-${idx}-element`"
                >({{ t(`tribulation.element.${s.element}`) }})</span>
                <span class="ml-1">+{{ Math.round(s.bonus * 100) }}%</span>
              </li>
            </ul>
          </div>
          <div
            v-else
            class="text-ink-300/70"
            data-testid="tribulation-preview-supports-empty"
          >
            {{ t('tribulation.field.supportsEmpty') }}
          </div>
          <div
            v-if="tribulation.preview.successChance.ceilHit"
            class="text-amber-300 text-[11px]"
            data-testid="tribulation-preview-cap-warning"
          >
            {{ t('tribulation.field.capWarningCeil') }}
          </div>
          <div
            v-else-if="tribulation.preview.successChance.floorHit"
            class="text-rose-300 text-[11px]"
            data-testid="tribulation-preview-floor-warning"
          >
            {{ t('tribulation.field.capWarningFloor') }}
          </div>
        </div>

        <div class="border-t border-ink-300/20 pt-2 space-y-1 text-xs">
          <h3 class="text-ink-300 mb-1">{{ t('tribulation.field.rewardPreview') }}</h3>
          <div data-testid="tribulation-reward-linhThach">
            <span class="text-ink-300">{{ t('tribulation.field.rewardLinhThach') }}:</span>
            <span class="text-emerald-200 ml-1">
              {{ fmtNum(upcomingDef.reward.linhThach) }}
            </span>
          </div>
          <div data-testid="tribulation-reward-expBonus">
            <span class="text-ink-300">{{ t('tribulation.field.rewardExpBonus') }}:</span>
            <span class="text-emerald-200 ml-1">
              {{ fmtNum(upcomingDef.reward.expBonus.toString()) }}
            </span>
          </div>
          <div v-if="upcomingDef.reward.titleKey" data-testid="tribulation-reward-title">
            <span class="text-ink-300">{{ t('tribulation.field.rewardTitle') }}:</span>
            <span class="text-amber-200 ml-1">{{ upcomingDef.reward.titleKey }}</span>
          </div>
        </div>

        <div class="border-t border-ink-300/20 pt-2 space-y-1 text-xs">
          <h3 class="text-ink-300 mb-1">{{ t('tribulation.field.penaltyPreview') }}</h3>
          <div data-testid="tribulation-penalty-expLoss">
            <span class="text-ink-300">{{ t('tribulation.field.penaltyExpLoss') }}:</span>
            <span class="text-rose-200 ml-1">
              {{ Math.round(upcomingDef.failurePenalty.expLossRatio * 100) }}%
            </span>
          </div>
          <div data-testid="tribulation-penalty-cooldown">
            <span class="text-ink-300">{{ t('tribulation.field.penaltyCooldown') }}:</span>
            <span class="text-rose-200 ml-1">
              {{ upcomingDef.failurePenalty.cooldownMinutes }} {{ t('tribulation.unit.minutes') }}
            </span>
          </div>
          <div data-testid="tribulation-penalty-taoMa">
            <span class="text-ink-300">{{ t('tribulation.field.penaltyTaoMa') }}:</span>
            <span class="text-rose-200 ml-1">
              {{ Math.round(upcomingDef.failurePenalty.taoMaDebuffChance * 100) }}%
              ·
              {{ upcomingDef.failurePenalty.taoMaDebuffDurationMinutes }} {{ t('tribulation.unit.minutes') }}
            </span>
          </div>
        </div>

        <!--
          Phase 14.3.C — support item selection panel.
          - Hiển thị `availableSupportItems` từ preview (qty>0, consumable
            kind theo shared validator).
          - Checkbox multi-select; cap = `maxSelectedSupportItems` (3).
          - Predicted bonus tổng (additive sum, KHÔNG cap client-side; server
            có authority cap khi attempt).
          - Tooltip ghi rõ "selected items consumed regardless of outcome".
        -->
        <div
          v-if="tribulation.preview"
          class="border-t border-ink-300/20 pt-2 space-y-1 text-xs"
          data-testid="tribulation-selection-panel"
        >
          <h3 class="text-ink-300 mb-1">
            {{ t('tribulation.field.selectionTitle') }}
          </h3>
          <p
            class="text-[11px] text-ink-300/80"
            data-testid="tribulation-selection-hint"
          >
            {{
              t('tribulation.field.selectionHint', {
                max: maxSelectedSupportItems,
              })
            }}
          </p>
          <ul
            v-if="availableSupportItems.length > 0"
            class="space-y-1 mt-1"
            data-testid="tribulation-selection-list"
          >
            <li
              v-for="entry in availableSupportItems"
              :key="entry.itemKey"
              :data-testid="`tribulation-selection-item-${entry.itemKey}`"
              class="flex items-center gap-2"
            >
              <label
                class="flex items-center gap-2 cursor-pointer flex-1"
                :class="{
                  'opacity-50 cursor-not-allowed':
                    !isSupportSelected(entry.itemKey) && selectionLimitReached,
                }"
              >
                <input
                  type="checkbox"
                  :checked="isSupportSelected(entry.itemKey)"
                  :disabled="
                    !isSupportSelected(entry.itemKey) && selectionLimitReached
                  "
                  :data-testid="`tribulation-selection-checkbox-${entry.itemKey}`"
                  class="accent-emerald-500"
                  @change="toggleSupportItem(entry.itemKey)"
                />
                <span
                  class="text-ink-100"
                  :data-testid="`tribulation-selection-label-${entry.itemKey}`"
                >{{ entry.label }}</span>
                <span
                  class="text-[10px] text-ink-300"
                  :data-testid="`tribulation-selection-qty-${entry.itemKey}`"
                >
                  {{ t('tribulation.field.selectionItemQty', { qty: entry.qty }) }}
                </span>
                <span
                  class="text-emerald-200 ml-auto"
                  :data-testid="`tribulation-selection-bonus-${entry.itemKey}`"
                >
                  {{
                    t('tribulation.field.selectionItemBonus', {
                      bonus: Math.round(entry.bonus * 100),
                    })
                  }}
                </span>
              </label>
            </li>
          </ul>
          <p
            v-else
            class="text-ink-300/70 text-[11px]"
            data-testid="tribulation-selection-empty"
          >
            {{ t('tribulation.field.selectionEmpty') }}
          </p>
          <div
            v-if="selectedSupportItemKeys.length > 0"
            class="mt-1 text-emerald-200 text-[11px]"
            data-testid="tribulation-selection-predicted"
          >
            {{ t('tribulation.field.selectionPredictedTotal') }}:
            +{{ Math.round(predictedSupportItemBonus * 100) }}%
          </div>
        </div>

        <button
          type="button"
          :disabled="buttonDisabled"
          data-testid="tribulation-attempt-button"
          class="w-full mt-2 px-3 py-2 text-sm rounded bg-rose-700 text-rose-50 hover:bg-rose-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
          @click="onAttempt"
        >
          {{ buttonLabel }}
        </button>

        <p
          v-if="!atPeak && game.character"
          class="text-[10px] text-ink-300 text-center"
          data-testid="tribulation-not-at-peak-hint"
        >
          {{ t('tribulation.notAtPeakHint') }}
        </p>
      </section>

      <!-- Phase 11.6.G — Tribulation history (past attempts) -->
      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
        data-testid="tribulation-history"
      >
        <header class="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 class="text-base font-semibold text-ink-100">
            {{ t('tribulation.history.title') }}
          </h2>
          <button
            v-if="!tribulation.historyLoading"
            type="button"
            class="text-[11px] text-ink-300 hover:text-ink-50 underline-offset-2 hover:underline"
            data-testid="tribulation-history-reload"
            @click="reloadHistory"
          >
            {{ t('tribulation.history.retry') }}
          </button>
        </header>

        <div
          v-if="tribulation.historyLoading"
          class="text-xs text-ink-300"
          data-testid="tribulation-history-loading"
        >
          {{ t('tribulation.history.loading') }}
        </div>

        <div
          v-else-if="tribulation.historyError"
          class="text-xs text-rose-300"
          data-testid="tribulation-history-error"
        >
          {{ t('tribulation.history.loadError') }}
        </div>

        <div
          v-else-if="tribulation.history && tribulation.history.length === 0"
          class="text-xs text-ink-300"
          data-testid="tribulation-history-empty"
        >
          {{ t('tribulation.history.empty') }}
        </div>

        <!--
          Phase 11.6.J — filter segmented control + filtered list.
          Render khi có rows (sau khi loading/error/empty resolved trên).
        -->
        <template v-else-if="tribulation.history && tribulation.history.length > 0">
          <!--
            Phase 11.6.K — stats summary tính trên FULL history. Counts không
            đổi khi user toggle filter (filter chỉ ảnh hưởng list bên dưới).
          -->
          <div
            class="flex items-center gap-2 flex-wrap text-xs"
            data-testid="tribulation-history-stats"
          >
            <span class="text-ink-300">{{ t('tribulation.history.stats.label') }}</span>
            <span
              class="px-2 py-0.5 rounded border bg-ink-700/30 border-ink-300/30 text-ink-100"
              data-testid="tribulation-history-stats-total"
            >
              {{ t('tribulation.history.stats.total', { count: tribulation.historyTotalCount }) }}
            </span>
            <span
              class="px-2 py-0.5 rounded border bg-emerald-700/30 border-emerald-500/40 text-emerald-100"
              data-testid="tribulation-history-stats-success"
            >
              {{ t('tribulation.history.stats.success', { count: tribulation.historySuccessCount }) }}
            </span>
            <span
              class="px-2 py-0.5 rounded border bg-rose-700/30 border-rose-500/40 text-rose-100"
              data-testid="tribulation-history-stats-fail"
            >
              {{ t('tribulation.history.stats.fail', { count: tribulation.historyFailCount }) }}
            </span>
          </div>

          <div
            class="flex items-center gap-2 flex-wrap text-xs"
            data-testid="tribulation-history-filter"
          >
            <span class="text-ink-300">{{ t('tribulation.history.filter.label') }}</span>
            <div class="inline-flex rounded border border-ink-300/30 overflow-hidden">
              <button
                v-for="opt in (['all', 'success', 'fail'] as const)"
                :key="opt"
                type="button"
                :class="[
                  'px-2 py-1 transition-colors',
                  tribulation.historyFilter === opt
                    ? 'bg-ink-700/80 text-ink-50'
                    : 'bg-ink-700/20 text-ink-300 hover:bg-ink-700/40',
                ]"
                :data-testid="`tribulation-history-filter-${opt}`"
                :aria-pressed="tribulation.historyFilter === opt"
                @click="onHistoryFilter(opt)"
              >
                {{ t(`tribulation.history.filter.${opt}`) }}
              </button>
            </div>
          </div>

          <div
            v-if="!tribulation.filteredHistory || tribulation.filteredHistory.length === 0"
            class="text-xs text-ink-300"
            data-testid="tribulation-history-filter-empty"
          >
            {{ t('tribulation.history.filter.emptyAfterFilter') }}
          </div>

          <ul
            v-else
            class="space-y-2"
            data-testid="tribulation-history-list"
          >
            <li
              v-for="row in tribulation.filteredHistory"
              :key="row.id"
              :class="[
                'rounded p-3 border text-xs space-y-1',
                row.success
                  ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-100'
                  : 'bg-rose-900/20 border-rose-500/30 text-rose-100',
              ]"
              :data-testid="`tribulation-history-row-${row.id}`"
            >
              <header class="flex items-baseline justify-between gap-2 flex-wrap">
                <div class="flex items-baseline gap-2">
                  <span
                    :class="[
                      'text-[10px] px-1.5 py-0.5 rounded border',
                      row.success
                        ? 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40'
                        : 'bg-rose-700/40 text-rose-200 border-rose-500/40',
                    ]"
                    :data-testid="`tribulation-history-badge-${row.id}`"
                  >
                    {{
                      row.success
                        ? t('tribulation.history.successBadge')
                        : t('tribulation.history.failBadge')
                    }}
                  </span>
                  <span class="text-ink-300">
                    {{ t('tribulation.history.attemptIndex', { index: row.attemptIndex }) }}
                  </span>
                </div>
                <span class="text-[10px] text-ink-300">
                  {{ t('tribulation.history.createdAt', { ts: fmtDate(row.createdAt) }) }}
                </span>
              </header>

              <div>
                {{
                  t('tribulation.history.transition', {
                    from: realmName(row.fromRealmKey),
                    to: realmName(row.toRealmKey),
                  })
                }}
                ·
                {{ t('tribulation.history.waves', { count: row.wavesCompleted }) }}
                ·
                {{ t('tribulation.history.damage', { dmg: fmtNum(row.totalDamage) }) }}
              </div>

              <div v-if="row.success" class="space-y-0.5">
                <div v-if="row.linhThachReward > 0">
                  {{
                    t('tribulation.history.rewardLinhThach', {
                      amount: fmtNum(row.linhThachReward),
                    })
                  }}
                </div>
                <div v-if="row.expBonusReward !== '0'">
                  {{
                    t('tribulation.history.rewardExpBonus', {
                      amount: fmtNum(row.expBonusReward),
                    })
                  }}
                </div>
                <div v-if="row.titleKeyReward">
                  {{
                    t('tribulation.history.rewardTitle', {
                      key: row.titleKeyReward,
                    })
                  }}
                </div>
              </div>

              <div v-else class="space-y-0.5">
                <div>
                  {{
                    t('tribulation.history.expLoss', {
                      amount: fmtNum(row.expLoss),
                    })
                  }}
                </div>
                <div v-if="row.cooldownAt">
                  {{
                    t('tribulation.history.cooldownAt', {
                      ts: fmtDate(row.cooldownAt),
                    })
                  }}
                </div>
                <div v-if="row.taoMaActive && row.taoMaExpiresAt">
                  {{
                    t('tribulation.history.taoMa', {
                      ts: fmtDate(row.taoMaExpiresAt),
                    })
                  }}
                </div>
              </div>
            </li>
          </ul>
        </template>

        <!-- Phase 11.6.H — Load more button + max-reached hint -->
        <div
          v-if="tribulation.history && tribulation.history.length > 0"
          class="pt-1 text-center"
        >
          <button
            v-if="tribulation.historyHasMore"
            type="button"
            :disabled="tribulation.historyLoading"
            data-testid="tribulation-history-load-more"
            class="text-xs px-3 py-1.5 rounded border border-ink-300/30 bg-ink-700/40 text-ink-100 hover:bg-ink-700/60 disabled:bg-ink-700/20 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onLoadMore"
          >
            {{
              tribulation.historyLoading
                ? t('tribulation.history.loadMoreLoading')
                : t('tribulation.history.loadMore')
            }}
          </button>
          <p
            v-else-if="tribulation.historyMaxReached"
            class="text-[10px] text-ink-300"
            data-testid="tribulation-history-max-reached"
          >
            {{
              t('tribulation.history.maxReached', {
                limit: tribulation.historyLimit,
              })
            }}
          </p>
        </div>
      </section>
    </div>
  </AppShell>
</template>
