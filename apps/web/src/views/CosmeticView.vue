<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  COSMETIC_TYPES,
  loadoutFieldForType,
  type CosmeticType,
  type CosmeticView,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useCosmeticsStore } from '@/stores/cosmetics';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import MButton from '@/components/ui/MButton.vue';

type TypeFilter = 'all' | CosmeticType;
type OwnedFilter = 'all' | 'owned' | 'locked';

const auth = useAuthStore();
const cosmetics = useCosmeticsStore();
const toast = useToastStore();
const router = useRouter();
const { locale, t } = useI18n();

const typeFilter = ref<TypeFilter>('all');
const ownedFilter = ref<OwnedFilter>('all');

const typeFilters: TypeFilter[] = ['all', ...COSMETIC_TYPES];
const ownedFilters: OwnedFilter[] = ['all', 'owned', 'locked'];

const filteredCatalog = computed<CosmeticView[]>(() => {
  return cosmetics.catalog.filter((c) => {
    if (typeFilter.value !== 'all' && c.type !== typeFilter.value) return false;
    if (ownedFilter.value === 'owned' && !c.owned) return false;
    if (ownedFilter.value === 'locked' && c.owned) return false;
    return true;
  });
});

function cosmeticName(c: CosmeticView): string {
  return locale.value === 'en' ? c.nameEn : c.nameVi;
}

function cosmeticDesc(c: CosmeticView): string {
  return locale.value === 'en' ? c.descriptionEn : c.descriptionVi;
}

function typeLabel(typeKey: TypeFilter): string {
  if (typeKey === 'all') return t('common.all');
  return t(`cosmetics.types.${typeKey}`);
}

function ownedLabel(key: OwnedFilter): string {
  return t(`cosmetics.ownedFilter.${key}`);
}

function rarityLabel(rarity: string): string {
  return t(`cosmetics.rarity.${rarity}`);
}

function sourceLabel(source: string): string {
  return t(`cosmetics.source.${source}`);
}

async function onEquip(c: CosmeticView) {
  if (!c.owned) return;
  const code = await cosmetics.equip(c.cosmeticId);
  if (code) {
    toast.push({
      type: 'error',
      text: t(`cosmetics.errors.${code}`, t('cosmetics.equipFail')),
    });
    return;
  }
  toast.push({ type: 'success', text: t('cosmetics.equipSuccess') });
}

async function onUnequip(typeKey: CosmeticType) {
  const code = await cosmetics.unequip(typeKey);
  if (code) {
    toast.push({
      type: 'error',
      text: t(`cosmetics.errors.${code}`, t('cosmetics.unequipFail')),
    });
    return;
  }
  toast.push({ type: 'success', text: t('cosmetics.unequipSuccess') });
}

function isEquippedSlot(c: CosmeticView): boolean {
  const field = loadoutFieldForType(c.type);
  return cosmetics.loadout[field] === c.cosmeticId;
}

function previewLabel(c: CosmeticView): string {
  // Single Latin glyph (no asset). Picks based on type.
  switch (c.type) {
    case 'TITLE':
      return 'T';
    case 'CHAT_BADGE':
      return 'B';
    case 'AVATAR_FRAME':
      return 'F';
    case 'PROFILE_DECORATION':
      return 'P';
    case 'ELEMENT_AURA':
    case 'AURA':
    default:
      return 'A';
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await cosmetics.fetchMe();
});
</script>

<template>
  <AppShell :title="t('cosmetics.title')">
    <XTLuxHero
      :eyebrow="t('luxHero.cosmetic.eyebrow')"
      :label="t('luxHero.cosmetic.label')"
      :title="t('cosmetics.title')"
      :subtitle="t('cosmetics.subtitle')"
      tone="gold"
      watermark-letter="Y"
      :breadcrumb="t('luxHero.cosmetic.breadcrumb')"
      test-id="cosmetic-view-hero"
    >
      <XTPageEyebrow caps="Y BÀO TRANG SỨC" label="Y Bào Trang Sức" class="sr-only" />
    </XTLuxHero>

    <!-- Role hint -->
    <p class="text-sm text-gray-400 px-1" data-testid="cosmetic-role-hint">
      {{ t('cosmetics.roleHint') }}
    </p>

    <!-- Cross-navigation -->
    <nav class="flex gap-2 text-xs mb-2" data-testid="cosmetic-cross-nav">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-character"
        @click="$router.push('/character')"
      >
        <span>{{ t('cosmetics.crossNav.character') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('cosmetics.crossNav.characterDesc') }}</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-inventory"
        @click="$router.push('/inventory')"
      >
        <span>{{ t('cosmetics.crossNav.inventory') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('cosmetics.crossNav.inventoryDesc') }}</span>
      </button>
    </nav>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="typeKey in typeFilters"
          :key="typeKey"
          class="px-3 py-1 rounded-full text-sm border transition-colors"
          :class="typeFilter === typeKey
            ? 'bg-amber-600 text-white border-amber-600'
            : 'bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-amber-500'"
          @click="typeFilter = typeKey"
        >
          {{ typeLabel(typeKey) }}
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="key in ownedFilters"
          :key="key"
          class="px-3 py-1 rounded-full text-sm border transition-colors"
          :class="ownedFilter === key
            ? 'bg-emerald-600 text-white border-emerald-600'
            : 'bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-emerald-500'"
          @click="ownedFilter = key"
        >
          {{ ownedLabel(key) }}
        </button>
      </div>
    </div>

    <!-- Loadout summary -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6 text-xs">
      <div
        v-for="typeKey in COSMETIC_TYPES"
        :key="typeKey"
        class="rounded border border-zinc-700 bg-zinc-900/50 p-2 flex flex-col gap-1"
      >
        <span class="text-zinc-400">{{ typeLabel(typeKey) }}</span>
        <span class="text-zinc-100 font-mono break-all">
          {{ cosmetics.loadout[loadoutFieldForType(typeKey)] ?? t('cosmetics.empty') }}
        </span>
        <MButton
          v-if="cosmetics.loadout[loadoutFieldForType(typeKey)]"
          class="text-xs"
          :disabled="cosmetics.mutating"
          @click="onUnequip(typeKey)"
        >
          {{ t('cosmetics.unequip') }}
        </MButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="cosmetics.loading && cosmetics.catalog.length === 0" class="text-center text-zinc-400 py-8">
      {{ t('common.loading') }}
    </div>

    <!-- Empty -->
    <div v-else-if="filteredCatalog.length === 0" class="text-center text-zinc-400 py-8">
      {{ t('cosmetics.emptyFiltered') }}
    </div>

    <!-- List -->
    <div
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      <div
        v-for="c in filteredCatalog"
        :key="c.cosmeticId"
        class="rounded-lg border bg-zinc-900/40 p-3 flex flex-col gap-2"
        :class="c.owned ? 'border-emerald-600/60' : 'border-zinc-700'"
        :data-cosmetic-id="c.cosmeticId"
        :data-equipped="isEquippedSlot(c) ? 'true' : 'false'"
        :data-owned="c.owned ? 'true' : 'false'"
      >
        <div class="flex items-center gap-3">
          <div class="cosmetic-preview-tile" :class="c.previewClass">
            <span v-if="c.type === 'AURA' || c.type === 'ELEMENT_AURA'" class="text-zinc-200">{{ previewLabel(c) }}</span>
            <span v-else-if="c.type === 'TITLE'" :class="c.cssClass">{{ previewLabel(c) }}</span>
            <span v-else>{{ previewLabel(c) }}</span>
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-semibold text-zinc-100 truncate" :class="c.type === 'TITLE' ? c.cssClass : ''">
              {{ cosmeticName(c) }}
            </span>
            <span class="text-xs text-zinc-400">
              {{ t(`cosmetics.types.${c.type}`) }} · {{ rarityLabel(c.rarity) }}
            </span>
          </div>
        </div>

        <p class="text-xs text-zinc-400 leading-relaxed">
          {{ cosmeticDesc(c) }}
        </p>

        <div class="flex flex-wrap gap-2 text-[11px]">
          <span class="px-2 py-0.5 rounded-full border border-zinc-600 bg-zinc-800/60 text-zinc-300">
            {{ t('cosmetics.sourceLabel') }}: {{ sourceLabel(c.source) }}
          </span>
          <span
            v-if="c.elementAffinity && c.elementAffinity !== 'NEUTRAL'"
            class="px-2 py-0.5 rounded-full border border-zinc-600 bg-zinc-800/60 text-zinc-300"
          >
            {{ t('cosmetics.elementLabel') }}: {{ t(`cosmetics.element.${c.elementAffinity}`) }}
          </span>
          <span
            v-if="c.durationDays"
            class="px-2 py-0.5 rounded-full border border-zinc-600 bg-zinc-800/60 text-zinc-300"
          >
            {{ t('cosmetics.durationLabel', { days: c.durationDays }) }}
          </span>
        </div>

        <div v-if="c.owned" class="flex items-center justify-between">
          <span
            v-if="isEquippedSlot(c)"
            class="text-xs text-emerald-400 font-semibold"
          >{{ t('cosmetics.equipped') }}</span>
          <span v-else class="text-xs text-emerald-300">{{ t('cosmetics.owned') }}</span>
          <MButton
            v-if="!isEquippedSlot(c)"
            :disabled="cosmetics.mutating"
            @click="onEquip(c)"
          >
            {{ t('cosmetics.equip') }}
          </MButton>
        </div>
        <div v-else>
          <span class="text-xs text-zinc-500">{{ t('cosmetics.locked') }}</span>
        </div>
      </div>
    </div>
  </AppShell>
</template>
