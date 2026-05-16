<script setup lang="ts">
/**
 * Phase 11.9.C — Title (Danh hiệu) view.
 *
 * Hiển thị toàn bộ catalog title — server trả về qua
 * `GET /character/titles` — kèm trạng thái owned/equipped + cho phép equip
 * single-slot qua `POST /character/title/equip` và unequip qua
 * `POST /character/title/unequip`.
 *
 * Server-authoritative:
 *   - Server validate ownership (`CharacterTitleUnlock` row tồn tại) trước
 *     khi cập nhật `Character.title` (Phase 11.9.B service đã merge).
 *   - Re-equip cùng key idempotent. Unequip clear `Character.title = null`.
 *
 * Filters:
 *   - Source: all | realm_milestone | element_mastery | achievement |
 *     sect_rank | event | donation
 *   - Rarity: all | common | rare | epic | legendary | mythic
 *   - Status: all | owned | locked | equipped
 *
 * Mỗi card hiển thị: tên + rarity badge + source badge + element badge (nếu
 * có) + status (Đã trang bị / Đã mở / Chưa mở) + description + nút equip/
 * unequip (3 trạng thái).
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 3 endpoint backend.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type {
  TitleDef,
  TitleRarity,
  TitleSource,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTitlesStore } from '@/stores/titles';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

type SourceFilter = 'all' | TitleSource;
type RarityFilter = 'all' | TitleRarity;
type StatusFilter = 'all' | 'owned' | 'locked' | 'equipped';

const auth = useAuthStore();
const game = useGameStore();
const titles = useTitlesStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const sourceFilter = ref<SourceFilter>('all');
const rarityFilter = ref<RarityFilter>('all');
const statusFilter = ref<StatusFilter>('all');

const filtered = computed<TitleDef[]>(() => {
  return titles.catalog.filter((def) => {
    if (sourceFilter.value !== 'all' && def.source !== sourceFilter.value) {
      return false;
    }
    if (rarityFilter.value !== 'all' && def.rarity !== rarityFilter.value) {
      return false;
    }
    if (statusFilter.value === 'owned' && !titles.isOwned(def.key)) return false;
    if (statusFilter.value === 'locked' && titles.isOwned(def.key)) return false;
    if (statusFilter.value === 'equipped' && !titles.isEquipped(def.key)) {
      return false;
    }
    return true;
  });
});

const counts = computed(() => ({
  shown: filtered.value.length,
  owned: titles.ownedCount,
  total: titles.totalCount,
}));

function rarityClass(rarity: TitleRarity): string {
  switch (rarity) {
    case 'common':
      return 'bg-stone-600/40 text-stone-100 border-stone-400/40';
    case 'rare':
      return 'bg-sky-600/40 text-sky-100 border-sky-400/40';
    case 'epic':
      return 'bg-violet-600/40 text-violet-100 border-violet-400/40';
    case 'legendary':
      return 'bg-amber-600/40 text-amber-100 border-amber-400/40';
    case 'mythic':
      return 'bg-rose-600/40 text-rose-100 border-rose-400/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function rowStatus(def: TitleDef): 'equipped' | 'owned' | 'locked' {
  if (titles.isEquipped(def.key)) return 'equipped';
  if (titles.isOwned(def.key)) return 'owned';
  return 'locked';
}

function statusClass(s: 'equipped' | 'owned' | 'locked'): string {
  switch (s) {
    case 'equipped':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'owned':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    default:
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
  }
}

function actionLabel(def: TitleDef): string {
  const s = rowStatus(def);
  if (titles.inFlight) return t('titles.button.working');
  if (s === 'equipped') return t('titles.button.unequip');
  if (s === 'owned') return t('titles.button.equip');
  return t('titles.button.locked');
}

function actionDisabled(def: TitleDef): boolean {
  const s = rowStatus(def);
  if (titles.inFlight) return true;
  return s === 'locked';
}

async function onAction(def: TitleDef): Promise<void> {
  if (actionDisabled(def)) return;
  const s = rowStatus(def);
  const errCode =
    s === 'equipped' ? await titles.unequip() : await titles.equip(def.key);
  if (errCode === null) {
    const key = s === 'equipped' ? 'titles.toast.unequipped' : 'titles.toast.equipped';
    toast.push({
      type: 'success',
      text: t(key, { name: def.nameVi }),
    });
  } else {
    const key = `titles.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('titles.errors.UNKNOWN') : text,
    });
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await titles.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <XTLuxHero
        :eyebrow="t('luxHero.title.eyebrow')"
        :label="t('luxHero.title.label')"
        :title="t('titles.title')"
        :subtitle="t('titles.subtitle')"
        tone="gold"
        watermark-letter="H"
        :breadcrumb="t('luxHero.title.breadcrumb')"
        test-id="title-view-hero"
      >
        <XTPageEyebrow caps="HIỂN DANH HỘ HỘ" label="Hiển Danh Hộ Hộ" class="sr-only" />
        <header class="flex items-baseline justify-end gap-3 flex-wrap">
          <div
            class="text-xs text-ink-300"
            data-testid="titles-summary"
          >
            {{
              t('titles.summary', {
                owned: counts.owned,
                total: counts.total,
              })
            }}
          </div>
        </header>
      </XTLuxHero>

      <section
        v-if="titles.equipped"
        class="bg-ink-700/40 border border-amber-500/40 rounded p-3 flex items-baseline gap-3 flex-wrap"
        data-testid="titles-equipped-banner"
      >
        <span class="text-xs text-ink-300">{{ t('titles.equippedLabel') }}</span>
        <span
          class="text-amber-200 font-semibold"
          data-testid="titles-equipped-name"
        >
          {{ titles.equipped.def.nameVi }}
        </span>
        <span
          :class="[
            'text-[10px] px-1.5 py-0.5 rounded border',
            rarityClass(titles.equipped.def.rarity),
          ]"
        >
          {{ t(`titles.rarity.${titles.equipped.def.rarity}`) }}
        </span>
        <button
          class="ml-auto text-xs px-2 py-1 rounded border border-ink-300/30 hover:bg-ink-700/60 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="titles.inFlight"
          data-testid="titles-quick-unequip"
          @click="onAction(titles.equipped.def)"
        >
          {{ titles.inFlight ? t('titles.button.working') : t('titles.button.unequip') }}
        </button>
      </section>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('titles.filter.source') }}</label>
          <select
            v-model="sourceFilter"
            data-testid="titles-filter-source"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('titles.filter.all') }}</option>
            <option value="realm_milestone">{{ t('titles.source.realm_milestone') }}</option>
            <option value="element_mastery">{{ t('titles.source.element_mastery') }}</option>
            <option value="achievement">{{ t('titles.source.achievement') }}</option>
            <option value="sect_rank">{{ t('titles.source.sect_rank') }}</option>
            <option value="event">{{ t('titles.source.event') }}</option>
            <option value="donation">{{ t('titles.source.donation') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('titles.filter.rarity') }}</label>
          <select
            v-model="rarityFilter"
            data-testid="titles-filter-rarity"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('titles.filter.all') }}</option>
            <option value="common">{{ t('titles.rarity.common') }}</option>
            <option value="rare">{{ t('titles.rarity.rare') }}</option>
            <option value="epic">{{ t('titles.rarity.epic') }}</option>
            <option value="legendary">{{ t('titles.rarity.legendary') }}</option>
            <option value="mythic">{{ t('titles.rarity.mythic') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('titles.filter.status') }}</label>
          <select
            v-model="statusFilter"
            data-testid="titles-filter-status"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('titles.filter.all') }}</option>
            <option value="owned">{{ t('titles.status.owned') }}</option>
            <option value="locked">{{ t('titles.status.locked') }}</option>
            <option value="equipped">{{ t('titles.status.equipped') }}</option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="titles-count">
          {{
            t('titles.filter.shown', {
              shown: counts.shown,
              total: counts.total,
            })
          }}
        </span>
      </section>

      <section
        v-if="!titles.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="titles-loading"
      >
        {{ t('titles.loading') }}
      </section>

      <section
        v-else-if="counts.shown === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="titles-empty"
      >
        {{ t('titles.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="titles-list"
      >
        <article
          v-for="def in filtered"
          :key="def.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`titles-card-${def.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ def.nameVi }}</h2>
            <div class="flex items-center gap-1 flex-wrap">
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  rarityClass(def.rarity),
                ]"
                :data-testid="`titles-rarity-${def.key}`"
              >
                {{ t(`titles.rarity.${def.rarity}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`titles-source-${def.key}`"
              >
                {{ t(`titles.source.${def.source}`) }}
              </span>
              <span
                v-if="def.element"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`titles-element-${def.key}`"
              >
                {{ t(`titles.element.${def.element}`) }}
              </span>
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  statusClass(rowStatus(def)),
                ]"
                :data-testid="`titles-status-${def.key}`"
              >
                {{ t(`titles.status.${rowStatus(def)}`) }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ def.description }}</p>

          <div class="flex items-center justify-between gap-2 pt-1">
            <span
              v-if="def.flavorStatBonus"
              class="text-[10px] text-ink-300"
              :data-testid="`titles-flavor-${def.key}`"
            >
              {{
                t('titles.flavor.bonus', {
                  stat: t(`titles.stat.${def.flavorStatBonus.statTarget}`),
                  pct: Math.round((def.flavorStatBonus.value - 1) * 100),
                })
              }}
            </span>
            <span v-else class="text-[10px] text-ink-500">
              {{ t('titles.flavor.none') }}
            </span>
            <button
              class="text-xs px-2 py-1 rounded border border-ink-300/30 hover:bg-ink-700/60 disabled:opacity-50 disabled:cursor-not-allowed"
              :class="
                rowStatus(def) === 'equipped'
                  ? 'bg-rose-700/40 text-rose-100 border-rose-500/40'
                  : rowStatus(def) === 'owned'
                    ? 'bg-amber-700/40 text-amber-100 border-amber-500/40'
                    : ''
              "
              :disabled="actionDisabled(def)"
              :data-testid="`titles-action-${def.key}`"
              @click="onAction(def)"
            >
              {{ actionLabel(def) }}
            </button>
          </div>
        </article>
      </section>
    </div>
  </AppShell>
</template>
