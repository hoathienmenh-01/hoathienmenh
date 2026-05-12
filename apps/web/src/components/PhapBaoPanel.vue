<!--
  Phase 23.5 — Pháp Bảo Advanced Artifact System (foundation panel).
  Hiển thị danh sách pháp bảo sở hữu + chi tiết passive/active/cost.
  Refine reuse `/character/refine` (panel ngoài đã handle). Equip/unequip dùng
  /inventory/equip (parent InventoryView). Star-up / awaken DEFER → disabled.
  Mobile-responsive grid, i18n vi/en parity, loading/empty/error states.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getEquipmentQualityVisual, type Quality } from '@xuantoi/shared';
import MButton from '@/components/ui/MButton.vue';
import {
  listPhapBao,
  previewPhapBao,
  type PhapBaoDefView,
  type PhapBaoPreview,
  type PhapBaoView,
} from '@/api/phapBao';

const props = defineProps<{
  /** Refresh trigger từ parent (sau khi refine / equip / unequip). */
  refreshKey?: number;
}>();

const emit = defineEmits<{
  /** Phát khi user muốn equip một pháp bảo — parent handle qua /inventory/equip. */
  (e: 'equip', inventoryItemId: string): void;
  /** Phát khi user muốn refine một pháp bảo — parent reuse /character/refine UI. */
  (e: 'refine', inventoryItemId: string): void;
  /** Phát khi user muốn tháo pháp bảo khỏi slot — parent handle qua /inventory/unequip. */
  (e: 'unequip', slot: string): void;
}>();

const { t } = useI18n();

const items = ref<PhapBaoView[]>([]);
const catalog = ref<PhapBaoDefView[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const selected = ref<PhapBaoView | null>(null);
const preview = ref<PhapBaoPreview | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await listPhapBao();
    items.value = res.items;
    catalog.value = res.catalog;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'LOAD_FAIL';
  } finally {
    loading.value = false;
  }
}

async function openDetail(item: PhapBaoView) {
  selected.value = item;
  preview.value = null;
  previewError.value = null;
  previewLoading.value = true;
  try {
    preview.value = await previewPhapBao(item.inventoryItemId);
  } catch (e) {
    previewError.value = e instanceof Error ? e.message : 'PREVIEW_FAIL';
  } finally {
    previewLoading.value = false;
  }
}

function closeDetail() {
  selected.value = null;
  preview.value = null;
  previewError.value = null;
}

onMounted(load);
watch(
  () => props.refreshKey,
  () => load(),
);

const ownedKeys = computed(
  () => new Set(items.value.map((it) => it.def.artifactKey)),
);

// Pháp bảo trong catalog chưa sở hữu (hiển thị mờ).
const locked = computed(() =>
  catalog.value.filter((d) => !ownedKeys.value.has(d.artifactKey)),
);

function elementLabel(k: string): string {
  return t(`inventory.phapBao.element_value.${k}`, k);
}
function roleLabel(r: string): string {
  return t(`inventory.phapBao.role_value.${r}`, r);
}
function sourceLabel(s: string): string {
  return t(`inventory.phapBao.source_value.${s}`, s);
}

function qualityClass(q: Quality): string {
  return getEquipmentQualityVisual(q).textClass;
}

function localizedName(def: PhapBaoDefView): string {
  return t('inventory.phapBao.detailTitle', { name: def.nameVi });
}

function qualityLabel(q: Quality): string {
  return t('quality.' + q);
}
</script>

<template>
  <section
    class="rounded border border-amber-300/40 bg-ink-700/40 p-4 space-y-3"
    data-testid="phap-bao-panel"
  >
    <header class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h3 class="text-base font-bold tracking-wider">
          {{ t('inventory.phapBao.title') }}
        </h3>
        <p class="text-xs text-ink-300 mt-0.5">
          {{ t('inventory.phapBao.subtitle') }}
        </p>
      </div>
      <span
        class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-200"
      >
        {{ t('inventory.phapBao.phaseBadge') }}
      </span>
    </header>

    <div
      v-if="loading"
      class="text-sm text-ink-300 italic"
      data-testid="phap-bao-loading"
    >
      {{ t('inventory.phapBao.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-sm text-red-300"
      data-testid="phap-bao-error"
    >
      {{ t('inventory.phapBao.loadFail') }}
    </div>
    <div
      v-else-if="items.length === 0"
      class="text-sm text-ink-300 italic"
      data-testid="phap-bao-empty"
    >
      {{ t('inventory.phapBao.empty') }}
    </div>
    <div v-else class="space-y-4" data-testid="phap-bao-content">
      <h4 class="text-sm font-bold text-amber-200">
        {{ t('inventory.phapBao.sectionOwned') }}
      </h4>
      <ul
        class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
        data-testid="phap-bao-owned-list"
      >
        <li
          v-for="it in items"
          :key="it.inventoryItemId"
          class="rounded border border-amber-300/30 bg-ink-800/60 p-3 space-y-1"
          :class="{ 'opacity-60': !it.canEquip }"
          :data-testid="`phap-bao-item-${it.def.artifactKey}`"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold" :class="qualityClass(it.def.quality)">
              {{ it.def.nameVi }}
            </span>
            <span
              class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200"
            >
              {{ t('inventory.phapBao.tierLabel', { tier: it.def.artifactTier }) }}
            </span>
          </div>
          <p class="text-[11px] text-ink-300">
            {{ t('inventory.phapBao.qualityLabel', { quality: qualityLabel(it.def.quality) }) }} ·
            {{ elementLabel(it.def.elementAffinity) }} ·
            {{ roleLabel(it.def.role) }}
          </p>
          <p
            class="text-[11px]"
            :class="it.canEquip ? 'text-emerald-300' : 'text-red-300'"
            :data-testid="`phap-bao-realm-${it.def.artifactKey}`"
          >
            {{
              it.canEquip
                ? t('inventory.phapBao.realmReady')
                : t('inventory.phapBao.lockHint')
            }}
          </p>
          <p class="text-[11px] text-ink-300" data-testid="phap-bao-quality-meaning">
            {{ t('inventory.phapBao.qualityMeaning') }}
          </p>
          <p class="text-[11px] text-cyan-300">
            {{ t('inventory.phapBao.refineLevel', { lvl: it.refineLevel }) }} ·
            {{ t('inventory.phapBao.starLevel', { stars: it.starLevel }) }} ·
            {{ t('inventory.phapBao.awakenStage', { stage: it.awakenStage }) }}
          </p>
          <p class="text-[11px] text-amber-200">
            {{ t('inventory.phapBao.powerScore', { power: it.powerScore }) }}
          </p>
          <div class="flex items-center gap-2 flex-wrap pt-1">
            <MButton
              class="!px-2 !py-0.5 text-xs"
              :data-testid="`phap-bao-detail-${it.def.artifactKey}`"
              @click="openDetail(it)"
            >
              {{ t('inventory.phapBao.detailButton') }}
            </MButton>
            <MButton
              v-if="it.canEquip && !it.equippedSlot"
              class="!px-2 !py-0.5 text-xs"
              :data-testid="`phap-bao-equip-${it.def.artifactKey}`"
              @click="emit('equip', it.inventoryItemId)"
            >
              {{ t('inventory.phapBao.equipButton') }}
            </MButton>
            <MButton
              v-if="it.equippedSlot"
              class="!px-2 !py-0.5 text-xs"
              :data-testid="`phap-bao-unequip-${it.def.artifactKey}`"
              @click="emit('unequip', it.equippedSlot!)"
            >
              {{ t('inventory.phapBao.unequipButton') }}
            </MButton>
          </div>
        </li>
      </ul>

      <div v-if="locked.length > 0">
        <h4 class="text-sm font-bold text-ink-300">
          {{ t('inventory.phapBao.sectionCatalog') }}
        </h4>
        <ul
          class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 mt-2"
          data-testid="phap-bao-catalog-list"
        >
          <li
            v-for="d in locked"
            :key="d.artifactKey"
            class="rounded border border-ink-300/30 bg-ink-800/40 p-2 opacity-70"
            :data-testid="`phap-bao-locked-${d.artifactKey}`"
          >
            <p class="text-xs font-bold" :class="qualityClass(d.quality)">
              {{ d.nameVi }}
            </p>
            <p class="text-[10px] text-ink-300">
              {{
                t('inventory.phapBao.tierLabel', { tier: d.artifactTier })
              }} ·
              {{ t('inventory.phapBao.qualityLabel', { quality: qualityLabel(d.quality) }) }} ·
              {{ elementLabel(d.elementAffinity) }}
            </p>
            <p class="text-[10px] text-ink-300">
              {{ t('inventory.phapBao.source', { source: sourceLabel(d.source) }) }}
            </p>
          </li>
        </ul>
      </div>
    </div>

    <!-- Detail modal -->
    <Teleport to="body">
      <div
        v-if="selected"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        data-testid="phap-bao-detail-modal"
        @click.self="closeDetail"
      >
        <div
          class="rounded border border-amber-300/60 bg-ink-800 p-4 max-w-md w-full space-y-3 max-h-[90vh] overflow-y-auto"
        >
          <header class="flex items-center justify-between gap-2">
            <h3
              class="text-base font-bold"
              :class="qualityClass(selected.def.quality)"
            >
              {{ localizedName(selected.def) }}
            </h3>
            <MButton class="!px-2 !py-0.5 text-xs" @click="closeDetail">
              {{ t('inventory.phapBao.closeButton') }}
            </MButton>
          </header>
          <p class="text-xs text-ink-300">{{ selected.def.descriptionVi }}</p>
          <p class="text-[11px] text-cyan-200">
            {{ t('inventory.phapBao.tierLabel', { tier: selected.def.artifactTier }) }} ·
            {{ t('inventory.phapBao.qualityLabel', { quality: qualityLabel(selected.def.quality) }) }} ·
            {{ elementLabel(selected.def.elementAffinity) }} ·
            {{ roleLabel(selected.def.role) }}
          </p>
          <p class="text-[11px] text-ink-300" data-testid="phap-bao-detail-quality-meaning">
            {{ t('inventory.phapBao.qualityMeaning') }}
          </p>
          <p
            v-if="!selected.canEquip"
            class="text-[11px] text-red-300"
            data-testid="phap-bao-detail-lock-hint"
          >
            {{ t('inventory.phapBao.lockHint') }}
          </p>
          <p class="text-[11px] text-amber-200">
            {{ t('inventory.phapBao.source', { source: sourceLabel(selected.def.source) }) }}
          </p>

          <div
            v-if="previewLoading"
            class="text-sm text-ink-300 italic"
            data-testid="phap-bao-preview-loading"
          >
            {{ t('inventory.phapBao.loadingDetail') }}
          </div>
          <div
            v-else-if="previewError"
            class="text-sm text-red-300"
            data-testid="phap-bao-preview-error"
          >
            {{ t('inventory.phapBao.loadFail') }}
          </div>
          <div v-else-if="preview" class="space-y-3" data-testid="phap-bao-preview-content">
            <!-- Passive bonus -->
            <section>
              <h4 class="text-sm font-bold text-emerald-200">
                {{ t('inventory.phapBao.passiveTitle') }}
              </h4>
              <ul class="text-[11px] text-emerald-200 mt-1 space-y-0.5">
                <li v-if="preview.passiveBonus.atk">ATK +{{ preview.passiveBonus.atk }}</li>
                <li v-if="preview.passiveBonus.def">DEF +{{ preview.passiveBonus.def }}</li>
                <li v-if="preview.passiveBonus.hpMax">HP +{{ preview.passiveBonus.hpMax }}</li>
                <li v-if="preview.passiveBonus.mpMax">MP +{{ preview.passiveBonus.mpMax }}</li>
                <li v-if="preview.passiveBonus.spirit">SPI +{{ preview.passiveBonus.spirit }}</li>
              </ul>
            </section>

            <!-- Active skill -->
            <section v-if="preview.def.activeSkill">
              <h4 class="text-sm font-bold text-cyan-200">
                {{ t('inventory.phapBao.activeTitle') }}
              </h4>
              <p class="text-xs text-ink-200" data-testid="phap-bao-active-name">
                {{ preview.def.activeSkill.nameVi }}
              </p>
              <p class="text-[11px] text-ink-300">
                {{ preview.def.activeSkill.descriptionVi }}
              </p>
              <p class="text-[11px] text-amber-200" data-testid="phap-bao-active-state">
                <template v-if="preview.activeSkill.unlocked">
                  {{ t('inventory.phapBao.activeUnlocked') }} ·
                  {{ t('inventory.phapBao.cooldown', { sec: preview.activeSkill.cooldownSec }) }}
                </template>
                <template v-else>
                  {{
                    t('inventory.phapBao.activeLocked', {
                      stars: preview.def.activeSkill.unlockStar,
                    })
                  }}
                </template>
              </p>
            </section>
            <section v-else>
              <h4 class="text-sm font-bold text-cyan-200">
                {{ t('inventory.phapBao.activeTitle') }}
              </h4>
              <p class="text-[11px] text-ink-300">
                {{ t('inventory.phapBao.activeNone') }}
              </p>
            </section>

            <!-- Cost preview -->
            <section>
              <h4 class="text-sm font-bold text-amber-200">
                {{ t('inventory.phapBao.costTitle') }}
              </h4>
              <p
                v-if="preview.refineCost"
                class="text-[11px] text-amber-200"
                data-testid="phap-bao-refine-cost"
              >
                {{
                  t('inventory.phapBao.refineCost', {
                    linhThach: preview.refineCost.linhThachCost,
                    qty: preview.refineCost.materialQty,
                    material: preview.refineCost.materialKey,
                  })
                }}
              </p>
              <p v-else class="text-[11px] text-ink-300">
                {{ t('inventory.phapBao.refineMax') }}
              </p>
              <p
                v-if="preview.starCost"
                class="text-[11px] text-ink-300"
                data-testid="phap-bao-star-cost"
              >
                {{
                  t('inventory.phapBao.starCost', {
                    linhThach: preview.starCost.linhThachCost,
                    qty: preview.starCost.materialQty,
                    material: preview.starCost.materialKey,
                  })
                }}
                ·
                <span class="text-amber-200">
                  {{ t('inventory.phapBao.starUpcoming') }}
                </span>
              </p>
              <p
                v-if="preview.awakenCost"
                class="text-[11px] text-ink-300"
                data-testid="phap-bao-awaken-cost"
              >
                {{
                  t('inventory.phapBao.awakenCost', {
                    linhThach: preview.awakenCost.linhThachCost,
                    qty: preview.awakenCost.materialQty,
                    material: preview.awakenCost.materialKey,
                  })
                }}
              </p>
              <p
                v-else
                class="text-[11px] text-ink-300"
                data-testid="phap-bao-awaken-upcoming"
              >
                {{ t('inventory.phapBao.awakenUpcoming') }}
              </p>
            </section>

            <!-- Actions -->
            <footer class="flex items-center gap-2 flex-wrap pt-2">
              <MButton
                v-if="preview.refineCost"
                class="!px-2 !py-0.5 text-xs"
                data-testid="phap-bao-refine-action"
                @click="emit('refine', selected.inventoryItemId); closeDetail()"
              >
                {{ t('inventory.phapBao.refineButton') }}
              </MButton>
              <MButton
                disabled
                class="!px-2 !py-0.5 text-xs opacity-60"
                data-testid="phap-bao-star-action"
                :title="t('inventory.phapBao.comingSoon')"
              >
                {{ t('inventory.phapBao.starButton') }}
              </MButton>
              <MButton
                disabled
                class="!px-2 !py-0.5 text-xs opacity-60"
                data-testid="phap-bao-awaken-action"
                :title="t('inventory.phapBao.comingSoon')"
              >
                {{ t('inventory.phapBao.awakenButton') }}
              </MButton>
            </footer>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
