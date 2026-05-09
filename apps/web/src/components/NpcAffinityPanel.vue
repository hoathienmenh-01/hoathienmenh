<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNpcAffinityStore } from '@/stores/npcAffinity';
import type { NpcAffinityView } from '@/api/npcAffinity';
import {
  NPC_GIFT_PREFERENCES,
  npcGiftPreferenceForKey,
  itemByKey,
  type NpcAcceptedGiftItem,
  type NpcGiftPreferenceDef,
} from '@xuantoi/shared';

/**
 * Phase 12.10.A — NPC Relationship panel.
 *
 * Renders read-only list of all NPC affinities for the current character.
 * Server-authoritative — mutations happen via dialogue choice / quest reward;
 * panel reloads after `StoryDialogueModal` applies effects (parent refresh
 * via store).
 *
 * Phase 12.10.B — gift action:
 *   - Mỗi NPC có gift preference (lookup `npcGiftPreferenceForKey`) hiển thị
 *     dropdown các item NPC chấp nhận + button "Tặng".
 *   - Click → `store.giftNpc(npcKey, itemKey)` → toast "+N affinity".
 *   - Khi `dailyFor(npc).remainingToday === 0` → button locked với label
 *     "Hết lượt hôm nay (5/5)".
 *   - Inline error khi gift fail (ITEM_NOT_IN_INVENTORY, DAILY_LIMIT_REACHED…).
 */

const props = withDefaults(
  defineProps<{
    /** True = auto-load on mount. Default true. Set false in tests / manual control. */
    autoLoad?: boolean;
  }>(),
  { autoLoad: true },
);

const store = useNpcAffinityStore();
const { t, locale } = useI18n();

const loading = computed(() => store.loading);
const error = computed(() => store.error);
const affinities = computed(() => store.affinities);

function tierLabel(view: NpcAffinityView): string {
  return locale.value === 'en' && view.currentTier.labelEn
    ? view.currentTier.labelEn
    : view.currentTier.label;
}

function nextTierLabel(view: NpcAffinityView): string {
  if (!view.nextTier) return '';
  return locale.value === 'en' && view.nextTier.labelEn
    ? view.nextTier.labelEn
    : view.nextTier.label;
}

function unlockDescription(unlock: NpcAffinityView['unlocks'][number]): string {
  return locale.value === 'en' && unlock.descriptionEn
    ? unlock.descriptionEn
    : unlock.description;
}

function progressPercent(view: NpcAffinityView): number {
  // Score from minScore..maxScore mapped to 0..100.
  const range = view.maxScore - view.minScore;
  if (range <= 0) return 0;
  const offset = view.score - view.minScore;
  return Math.max(0, Math.min(100, Math.round((offset / range) * 100)));
}

// Phase 12.10.B — gift selection state, keyed by npcKey.
const selectedItemFor = ref<Record<string, string>>({});
const giftToast = ref<{
  npcKey: string;
  delta: number;
  newTier: string | null;
} | null>(null);

function giftPrefFor(npcKey: string): NpcGiftPreferenceDef | undefined {
  return npcGiftPreferenceForKey(npcKey);
}

function defaultItemFor(pref: NpcGiftPreferenceDef): string {
  return pref.acceptedItems[0]?.itemKey ?? '';
}

function selectedItemKey(pref: NpcGiftPreferenceDef): string {
  return selectedItemFor.value[pref.npcKey] ?? defaultItemFor(pref);
}

function itemFlavor(item: NpcAcceptedGiftItem): string {
  return locale.value === 'en' && item.flavorEn ? item.flavorEn : item.flavor;
}

function itemLabel(itemKey: string): string {
  const def = itemByKey(itemKey);
  return def?.name ?? itemKey;
}

function loreNote(pref: NpcGiftPreferenceDef): string {
  return locale.value === 'en' && pref.loreNoteEn
    ? pref.loreNoteEn
    : pref.loreNote;
}

function dailyState(pref: NpcGiftPreferenceDef): {
  used: number;
  remaining: number;
  limit: number;
  locked: boolean;
} {
  const c = store.dailyFor(pref.npcKey, pref.dailyLimit);
  return {
    used: c.usedToday,
    remaining: c.remainingToday,
    limit: c.dailyLimit,
    locked: c.remainingToday <= 0,
  };
}

async function onGift(npcKey: string): Promise<void> {
  const pref = giftPrefFor(npcKey);
  if (!pref) return;
  const itemKey = selectedItemKey(pref);
  const result = await store.giftNpc(npcKey, itemKey);
  if (result) {
    const aff = store.findByNpcKey(npcKey);
    giftToast.value = {
      npcKey,
      delta: result.affinityDelta,
      newTier: result.tierChanged && aff ? tierLabel(aff) : null,
    };
    // auto-clear sau ~3.5s — không cần lib toast bên ngoài.
    window.setTimeout(() => {
      if (giftToast.value && giftToast.value.npcKey === npcKey) {
        giftToast.value = null;
      }
    }, 3500);
  }
}

function dismissToast(): void {
  giftToast.value = null;
}

function giftErrorLabel(): string {
  if (!store.giftError) return '';
  return t(`npcAffinity.giftErrors.${store.giftError}`, t('npcAffinity.giftErrors.UNKNOWN'));
}

// Phase 12.10.B — debug invariant: catalog xuất `NPC_GIFT_PREFERENCES` chỉ
// dùng làm reference khi map view; không nối với `affinities` ngược lại.
void NPC_GIFT_PREFERENCES;

// ====================================================================
// Phase 12.10.C — Shop + Hidden Unlocks
// ====================================================================

const expandedShop = ref<Record<string, boolean>>({});

function isShopOpen(npcKey: string): boolean {
  return expandedShop.value[npcKey] === true;
}

async function toggleShop(npcKey: string): Promise<void> {
  const wasOpen = isShopOpen(npcKey);
  expandedShop.value = { ...expandedShop.value, [npcKey]: !wasOpen };
  if (!wasOpen) {
    if (!store.shops[npcKey]) await store.loadShop(npcKey);
    if (!store.unlocks[npcKey]) await store.loadUnlocks(npcKey);
  }
}

function shopFor(npcKey: string) {
  return store.shops[npcKey];
}

function unlocksFor(npcKey: string) {
  return store.unlocks[npcKey];
}

function shopHint(entry: { unlockHint: string; unlockHintEn: string }): string {
  return locale.value === 'en' && entry.unlockHintEn
    ? entry.unlockHintEn
    : entry.unlockHint;
}

function unlockReasonText(entry: {
  unlockReason: string;
  unlockReasonEn: string;
}): string {
  return locale.value === 'en' && entry.unlockReasonEn
    ? entry.unlockReasonEn
    : entry.unlockReason;
}

function shopTierLabel(entry: {
  requiredTierLabel: string;
  requiredTierLabelEn: string;
}): string {
  return locale.value === 'en' && entry.requiredTierLabelEn
    ? entry.requiredTierLabelEn
    : entry.requiredTierLabel;
}

function shopErrorLabel(): string {
  if (!store.buyError) return '';
  return t(
    `npcAffinity.shopErrors.${store.buyError}`,
    t('npcAffinity.shopErrors.UNKNOWN'),
  );
}

async function onBuyShopItem(
  npcKey: string,
  itemKey: string,
): Promise<void> {
  await store.buyShopItem(npcKey, itemKey, 1);
}

onMounted(() => {
  if (props.autoLoad && !store.loaded) {
    void store.load();
  }
  if (props.autoLoad && !store.dailyLoaded) {
    void store.loadDaily();
  }
});

watch(
  () => props.autoLoad,
  (v) => {
    if (v && !store.loaded && !store.loading) void store.load();
    if (v && !store.dailyLoaded) void store.loadDaily();
  },
);
</script>

<template>
  <section
    class="bg-ink-700/40 border border-ink-300/20 rounded-lg p-4 space-y-3"
    data-testid="npc-affinity-panel"
  >
    <header class="flex items-baseline justify-between">
      <h3 class="text-base font-semibold text-amber-100">
        {{ t('npcAffinity.title') }}
      </h3>
      <button
        type="button"
        class="text-xs text-ink-300 hover:text-ink-50 underline"
        :disabled="loading"
        data-testid="npc-affinity-refresh"
        @click="store.refresh()"
      >
        {{ t('common.refresh') }}
      </button>
    </header>

    <p class="text-xs text-ink-300 italic">{{ t('npcAffinity.subtitle') }}</p>

    <div
      v-if="loading"
      class="text-sm text-ink-300 py-4 text-center"
      data-testid="npc-affinity-loading"
    >
      {{ t('common.loadingData') }}
    </div>

    <div
      v-else-if="error"
      class="text-sm text-rose-300 py-4 text-center"
      data-testid="npc-affinity-error"
    >
      {{ t(`npcAffinity.errors.${error}`, t('npcAffinity.errors.UNKNOWN')) }}
    </div>

    <div
      v-else-if="affinities.length === 0"
      class="text-sm text-ink-300 py-4 text-center"
      data-testid="npc-affinity-empty"
    >
      {{ t('npcAffinity.empty') }}
    </div>

    <ul v-else class="space-y-3" data-testid="npc-affinity-list">
      <li
        v-for="aff in affinities"
        :key="aff.npcKey"
        class="bg-ink-800/40 border border-ink-300/15 rounded p-3 space-y-2"
        :data-testid="`npc-affinity-item-${aff.npcKey}`"
      >
        <div class="flex items-baseline justify-between gap-3">
          <h4
            class="text-sm font-semibold text-ink-50"
            :data-testid="`npc-affinity-name-${aff.npcKey}`"
          >
            {{ aff.npcName }}
          </h4>
          <span
            class="text-xs text-amber-300 font-medium"
            :data-testid="`npc-affinity-tier-${aff.npcKey}`"
          >
            {{ tierLabel(aff) }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-ink-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-300/70 transition-all"
              :style="{ width: `${progressPercent(aff)}%` }"
              :data-testid="`npc-affinity-bar-${aff.npcKey}`"
            />
          </div>
          <span
            class="text-xs text-ink-300 tabular-nums"
            :data-testid="`npc-affinity-score-${aff.npcKey}`"
          >
            {{ aff.score }}/{{ aff.maxScore }}
          </span>
        </div>

        <p
          v-if="aff.nextTier"
          class="text-xs text-ink-300"
          :data-testid="`npc-affinity-next-${aff.npcKey}`"
        >
          {{
            t('npcAffinity.nextTierHint', {
              tier: nextTierLabel(aff),
              points: aff.nextTier.pointsToReach,
            })
          }}
        </p>
        <p v-else class="text-xs text-emerald-300 italic">
          {{ t('npcAffinity.maxTierReached') }}
        </p>

        <ul
          v-if="aff.unlocks.length > 0"
          class="text-xs space-y-1 pt-1 border-t border-ink-300/10"
          :data-testid="`npc-affinity-unlocks-${aff.npcKey}`"
        >
          <li
            v-for="u in aff.unlocks"
            :key="u.tierKey"
            class="flex items-baseline gap-2"
            :class="u.reached ? 'text-emerald-200' : 'text-ink-400'"
          >
            <span class="font-medium">
              {{
                locale === 'en' && u.tierLabelEn ? u.tierLabelEn : u.tierLabel
              }}
            </span>
            <span class="text-ink-300">·</span>
            <span class="flex-1">{{ unlockDescription(u) }}</span>
            <span v-if="u.reached" class="text-[10px]">✓</span>
          </li>
        </ul>

        <!-- Phase 12.10.B — gift action -->
        <div
          v-if="giftPrefFor(aff.npcKey)"
          class="pt-2 border-t border-ink-300/10 space-y-2"
          :data-testid="`npc-affinity-gift-${aff.npcKey}`"
        >
          <p class="text-[11px] text-ink-300 italic">
            {{ loreNote(giftPrefFor(aff.npcKey)!) }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <label
              class="text-xs text-ink-200 flex items-center gap-2 flex-1 min-w-[160px]"
              :for="`gift-select-${aff.npcKey}`"
            >
              <span class="shrink-0">{{ t('npcAffinity.giftLabel') }}</span>
              <select
                :id="`gift-select-${aff.npcKey}`"
                v-model="selectedItemFor[aff.npcKey]"
                class="flex-1 bg-ink-700 border border-ink-300/20 rounded px-2 py-1 text-xs text-ink-50"
                :disabled="
                  store.giftLoading === aff.npcKey ||
                    dailyState(giftPrefFor(aff.npcKey)!).locked
                "
                :data-testid="`npc-affinity-gift-select-${aff.npcKey}`"
              >
                <option
                  v-for="item in giftPrefFor(aff.npcKey)!.acceptedItems"
                  :key="item.itemKey"
                  :value="item.itemKey"
                >
                  {{ itemLabel(item.itemKey) }}
                  ({{ item.affinityMin }}–{{ item.affinityMax }})
                </option>
              </select>
            </label>
            <button
              type="button"
              class="text-xs px-3 py-1 rounded bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="
                store.giftLoading === aff.npcKey ||
                  dailyState(giftPrefFor(aff.npcKey)!).locked
              "
              :data-testid="`npc-affinity-gift-button-${aff.npcKey}`"
              @click="onGift(aff.npcKey)"
            >
              <span v-if="store.giftLoading === aff.npcKey">
                {{ t('common.loading') }}
              </span>
              <span v-else-if="dailyState(giftPrefFor(aff.npcKey)!).locked">
                {{
                  t('npcAffinity.giftLocked', {
                    used: dailyState(giftPrefFor(aff.npcKey)!).used,
                    limit: dailyState(giftPrefFor(aff.npcKey)!).limit,
                  })
                }}
              </span>
              <span v-else>
                {{ t('npcAffinity.giftButton') }}
              </span>
            </button>
            <span
              class="text-[11px] text-ink-300 tabular-nums"
              :data-testid="`npc-affinity-gift-daily-${aff.npcKey}`"
            >
              {{
                t('npcAffinity.giftDaily', {
                  used: dailyState(giftPrefFor(aff.npcKey)!).used,
                  limit: dailyState(giftPrefFor(aff.npcKey)!).limit,
                })
              }}
            </span>
          </div>
          <p
            v-for="item in giftPrefFor(aff.npcKey)!.acceptedItems.filter(
              (i) => i.itemKey === selectedItemKey(giftPrefFor(aff.npcKey)!),
            )"
            :key="item.itemKey"
            class="text-[11px] text-ink-400 italic"
            :data-testid="`npc-affinity-gift-flavor-${aff.npcKey}`"
          >
            {{ itemFlavor(item) }}
          </p>
          <div
            v-if="
              giftToast &&
                giftToast.npcKey === aff.npcKey
            "
            class="text-xs text-emerald-300 flex items-center gap-2"
            :data-testid="`npc-affinity-gift-toast-${aff.npcKey}`"
          >
            <span>
              {{
                t('npcAffinity.giftSuccess', { delta: giftToast.delta })
              }}
            </span>
            <span v-if="giftToast.newTier" class="text-amber-200">
              {{ t('npcAffinity.giftTierUp', { tier: giftToast.newTier }) }}
            </span>
            <button
              type="button"
              class="text-ink-300 hover:text-ink-50"
              :data-testid="`npc-affinity-gift-toast-dismiss-${aff.npcKey}`"
              @click="dismissToast"
            >
              ×
            </button>
          </div>
          <p
            v-if="
              store.giftError &&
                store.giftLoading === null &&
                dailyState(giftPrefFor(aff.npcKey)!).locked === false
            "
            class="text-xs text-rose-300"
            :data-testid="`npc-affinity-gift-error-${aff.npcKey}`"
          >
            {{ giftErrorLabel() }}
          </p>
        </div>

        <!-- Phase 12.10.C — Shop + Hidden Unlocks toggle -->
        <div
          class="pt-2 border-t border-ink-300/10"
          :data-testid="`npc-affinity-shop-section-${aff.npcKey}`"
        >
          <button
            type="button"
            class="text-xs text-ink-200 hover:text-amber-200 underline w-full text-left flex items-center justify-between"
            :data-testid="`npc-affinity-shop-toggle-${aff.npcKey}`"
            @click="toggleShop(aff.npcKey)"
          >
            <span>{{ t('npcAffinity.shopToggle') }}</span>
            <span class="text-[10px]">{{ isShopOpen(aff.npcKey) ? '▼' : '▶' }}</span>
          </button>

          <div
            v-if="isShopOpen(aff.npcKey)"
            class="mt-2 space-y-3"
            :data-testid="`npc-affinity-shop-${aff.npcKey}`"
          >
            <div
              v-if="store.shopLoading === aff.npcKey"
              class="text-xs text-ink-300 italic"
              :data-testid="`npc-affinity-shop-loading-${aff.npcKey}`"
            >
              {{ t('common.loadingData') }}
            </div>

            <div
              v-else-if="!shopFor(aff.npcKey)"
              class="text-xs text-rose-300"
              :data-testid="`npc-affinity-shop-error-${aff.npcKey}`"
            >
              {{
                t(
                  `npcAffinity.shopErrors.${store.shopError ?? 'UNKNOWN'}`,
                  t('npcAffinity.shopErrors.UNKNOWN'),
                )
              }}
            </div>

            <ul
              v-else-if="shopFor(aff.npcKey)!.entries.length > 0"
              class="space-y-2"
              :data-testid="`npc-affinity-shop-list-${aff.npcKey}`"
            >
              <li
                v-for="entry in shopFor(aff.npcKey)!.entries"
                :key="entry.itemKey"
                class="bg-ink-700/40 border border-ink-300/10 rounded p-2 text-xs space-y-1"
                :class="{ 'opacity-60': !entry.unlocked }"
                :data-testid="`npc-affinity-shop-item-${aff.npcKey}-${entry.itemKey}`"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-semibold text-ink-50">
                    {{ entry.item.name }}
                  </span>
                  <span class="tabular-nums text-amber-200">
                    {{ entry.cost }}
                    {{
                      entry.currency === 'TIEN_NGOC'
                        ? t('npcAffinity.shop.tienNgoc')
                        : t('npcAffinity.shop.linhThach')
                    }}
                  </span>
                </div>
                <p class="text-[11px] text-ink-300">
                  {{ entry.item.description }}
                </p>
                <p
                  v-if="!entry.unlocked"
                  class="text-[11px] text-rose-300 italic"
                  :data-testid="`npc-affinity-shop-locked-${aff.npcKey}-${entry.itemKey}`"
                >
                  {{
                    t('npcAffinity.shop.locked', {
                      tier: shopTierLabel(entry),
                    })
                  }}
                  ·
                  <span class="text-ink-400">{{ shopHint(entry) }}</span>
                </p>
                <p
                  v-else
                  class="text-[11px] text-emerald-200 italic"
                >
                  {{ shopHint(entry) }}
                </p>
                <div class="flex items-center justify-between gap-2 pt-1">
                  <span
                    v-if="entry.stockType === 'daily'"
                    class="text-[10px] text-ink-300 tabular-nums"
                    :data-testid="`npc-affinity-shop-stock-${aff.npcKey}-${entry.itemKey}`"
                  >
                    {{
                      t('npcAffinity.shop.dailyStock', {
                        used: entry.purchased,
                        limit: entry.dailyLimit ?? 0,
                      })
                    }}
                  </span>
                  <span
                    v-else-if="entry.stockType === 'weekly'"
                    class="text-[10px] text-ink-300 tabular-nums"
                    :data-testid="`npc-affinity-shop-stock-${aff.npcKey}-${entry.itemKey}`"
                  >
                    {{
                      t('npcAffinity.shop.weeklyStock', {
                        used: entry.purchased,
                        limit: entry.weeklyLimit ?? 0,
                      })
                    }}
                  </span>
                  <span
                    v-else
                    class="text-[10px] text-ink-300"
                    :data-testid="`npc-affinity-shop-stock-${aff.npcKey}-${entry.itemKey}`"
                  >
                    {{ t('npcAffinity.shop.unlimitedStock') }}
                  </span>
                  <button
                    type="button"
                    class="text-[11px] px-2 py-0.5 rounded bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="
                      !entry.unlocked ||
                        entry.limitReached ||
                        store.buyLoading ===
                        `${aff.npcKey}:${entry.itemKey}`
                    "
                    :data-testid="`npc-affinity-shop-buy-${aff.npcKey}-${entry.itemKey}`"
                    @click="onBuyShopItem(aff.npcKey, entry.itemKey)"
                  >
                    <span
                      v-if="
                        store.buyLoading ===
                          `${aff.npcKey}:${entry.itemKey}`
                      "
                    >
                      {{ t('common.loading') }}
                    </span>
                    <span v-else-if="!entry.unlocked">
                      {{ t('npcAffinity.shop.lockedShort') }}
                    </span>
                    <span v-else-if="entry.limitReached">
                      {{ t('npcAffinity.shop.limitReached') }}
                    </span>
                    <span v-else>
                      {{ t('npcAffinity.shop.buy') }}
                    </span>
                  </button>
                </div>
              </li>
            </ul>

            <p
              v-if="
                store.buyError &&
                  store.buyLoading === null
              "
              class="text-xs text-rose-300"
              :data-testid="`npc-affinity-shop-buy-error-${aff.npcKey}`"
            >
              {{ shopErrorLabel() }}
            </p>

            <!-- Hidden unlocks list -->
            <div
              v-if="
                unlocksFor(aff.npcKey) &&
                  unlocksFor(aff.npcKey)!.unlocks.length > 0
              "
              class="pt-1 border-t border-ink-300/10"
              :data-testid="`npc-affinity-unlocks-list-${aff.npcKey}`"
            >
              <h5 class="text-[11px] text-ink-300 uppercase tracking-wider pb-1">
                {{ t('npcAffinity.unlocks.title') }}
              </h5>
              <ul class="space-y-1">
                <li
                  v-for="u in unlocksFor(aff.npcKey)!.unlocks"
                  :key="`${u.kind}:${u.refKey}`"
                  class="text-[11px] flex items-baseline gap-2"
                  :class="
                    u.unlocked
                      ? 'text-emerald-200'
                      : 'text-ink-400'
                  "
                  :data-testid="`npc-affinity-unlock-${aff.npcKey}-${u.refKey}`"
                >
                  <span class="font-medium">
                    {{
                      u.kind === 'dialogue'
                        ? t('npcAffinity.unlocks.dialogueLabel')
                        : t('npcAffinity.unlocks.questLabel')
                    }}
                  </span>
                  <span class="text-ink-300">·</span>
                  <span>{{ shopTierLabel(u) }}</span>
                  <span class="text-ink-300">·</span>
                  <span class="flex-1">{{ unlockReasonText(u) }}</span>
                  <span v-if="u.unlocked" class="text-[10px]">✓</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
