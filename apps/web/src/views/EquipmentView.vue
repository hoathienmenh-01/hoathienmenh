<script setup lang="ts">
/**
 * EquipmentView — `/equipment` dedicated equipped-gear overview (PR #629).
 *
 * Shows the player's currently equipped gear across all 9 slots, stat
 * bonuses per slot, total equipment power, and deep links to /inventory,
 * /loadouts, and enhancement paths.
 *
 * All data sourced from real `listInventory()` API — no fake gear.
 * Empty slots render a safe empty state with a CTA to /inventory.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  EQUIP_SLOTS,
  REFINE_MAX_LEVEL,
  getRefineAttemptCost,
  type EquipSlot,
  type ItemDef,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  equipItem,
  unequipItem,
  listInventory,
  refineEquipment,
  type InventoryView as InvItem,
  type RefineResult,
} from '@/api/inventory';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import EquipmentArtCell from '@/components/xianxia/EquipmentArtCell.vue';
import EquipmentUpgradePanel from '@/components/EquipmentUpgradePanel.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const items = ref<InvItem[]>([]);
const loading = ref(true);
const actionInFlight = ref(false);
const equipModalSlot = ref<EquipSlot | null>(null);

// Upgrade hub state
const selectedSlot = ref<EquipSlot | null>(null);
const upgradeTab = ref<'refine' | 'reforge' | 'enchant'>('refine');
const refineProtection = ref(false);
const submitting = ref(false);

const selectedItem = computed<InvItem | null>(() => {
  if (!selectedSlot.value) return null;
  return equipped.value.get(selectedSlot.value) ?? null;
});

const equipped = computed(() => {
  const map = new Map<EquipSlot, InvItem>();
  for (const it of items.value) {
    if (it.equippedSlot) map.set(it.equippedSlot, it);
  }
  return map;
});

const equippedCount = computed(() => equipped.value.size);

function slotLabel(slot: EquipSlot): string {
  return t(`equipSlot.${slot}`, slot);
}

function bonusText(item: ItemDef): string {
  if (!item.bonuses) return '';
  const parts: string[] = [];
  if (item.bonuses.atk) parts.push(`ATK +${item.bonuses.atk}`);
  if (item.bonuses.def) parts.push(`DEF +${item.bonuses.def}`);
  if (item.bonuses.hpMax) parts.push(`HP +${item.bonuses.hpMax}`);
  if (item.bonuses.mpMax) parts.push(`MP +${item.bonuses.mpMax}`);
  if (item.bonuses.spirit) parts.push(`Spirit +${item.bonuses.spirit}`);
  return parts.join(' · ');
}

const totalPower = computed(() => {
  let power = 0;
  for (const it of equipped.value.values()) {
    power += it.item.computedPowerScore ?? it.item.powerBudget ?? 0;
  }
  return power;
});

const totalStats = computed(() => {
  let atk = 0;
  let def = 0;
  let hpMax = 0;
  let mpMax = 0;
  let spirit = 0;
  for (const it of equipped.value.values()) {
    const b = it.item.bonuses;
    if (!b) continue;
    atk += b.atk ?? 0;
    def += b.def ?? 0;
    hpMax += b.hpMax ?? 0;
    mpMax += b.mpMax ?? 0;
    spirit += b.spirit ?? 0;
  }
  return { atk, def, hpMax, mpMax, spirit };
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  try {
    items.value = await listInventory();
  } catch {
    toast.push({ type: 'error', text: t('equipment.loadFail', 'Failed to load equipment') });
  } finally {
    loading.value = false;
  }
});

function goToInventory(): void {
  router.push('/inventory');
}
function goToLoadouts(): void {
  router.push('/loadouts');
}

// ---------------------------------------------------------------------------
// Equip / Unequip actions
// ---------------------------------------------------------------------------

/** Items in inventory that can be equipped to the given slot. */
const availableForSlot = computed(() => {
  return (slot: EquipSlot): InvItem[] => {
    return items.value.filter(
      (it) => !it.equippedSlot && it.item.slot === slot && !it.locked,
    );
  };
});

async function onUnequip(slot: EquipSlot): Promise<void> {
  if (actionInFlight.value) return;
  actionInFlight.value = true;
  try {
    items.value = await unequipItem(slot);
    toast.push({
      type: 'success',
      text: t('equipment.unequipSuccess', { slot: slotLabel(slot) }),
    });
  } catch {
    toast.push({ type: 'error', text: t('equipment.unequipFail') });
  } finally {
    actionInFlight.value = false;
  }
}

function openEquipModal(slot: EquipSlot): void {
  equipModalSlot.value = slot;
}

function closeEquipModal(): void {
  equipModalSlot.value = null;
}

async function onEquip(inventoryItemId: string): Promise<void> {
  if (actionInFlight.value) return;
  actionInFlight.value = true;
  try {
    items.value = await equipItem(inventoryItemId);
    equipModalSlot.value = null;
    toast.push({ type: 'success', text: t('equipment.equipSuccess') });
  } catch {
    toast.push({ type: 'error', text: t('equipment.equipFail') });
  } finally {
    actionInFlight.value = false;
  }
}

// ---------------------------------------------------------------------------
// Upgrade hub
// ---------------------------------------------------------------------------

function selectSlotForUpgrade(slot: EquipSlot): void {
  if (selectedSlot.value === slot) {
    selectedSlot.value = null;
  } else {
    selectedSlot.value = slot;
    upgradeTab.value = 'refine';
    refineProtection.value = false;
  }
}

function closeUpgrade(): void {
  selectedSlot.value = null;
}

function refreshInventory(): void {
  void listInventory().then((r) => { items.value = r; });
}

function refineCostText(it: InvItem): string {
  if (it.refineLevel >= REFINE_MAX_LEVEL) return '';
  const cost = getRefineAttemptCost(it.refineLevel);
  return t('equipment.upgradeHub.refineCost', {
    linhThach: cost.linhThachCost,
    materialQty: cost.materialQty,
  });
}

async function onRefine(): Promise<void> {
  const it = selectedItem.value;
  if (!it || submitting.value || it.refineLevel >= REFINE_MAX_LEVEL) return;
  submitting.value = true;
  try {
    const result: RefineResult = await refineEquipment(it.id, refineProtection.value);
    if (result.broken) {
      toast.push({ type: 'error', text: t('equipment.upgradeHub.refineBroken') });
    } else if (result.result.success) {
      toast.push({ type: 'success', text: t('equipment.upgradeHub.refineSuccess', { level: result.result.nextLevel }) });
    } else {
      toast.push({ type: 'warning', text: t('equipment.upgradeHub.refineFail') });
    }
    refreshInventory();
  } catch {
    toast.push({ type: 'error', text: t('equipment.upgradeHub.refineError') });
  } finally {
    submitting.value = false;
  }
}


</script>

<template>
  <AppShell>
    <XTLuxHero
      eyebrow="TRANG BỊ"
      label="Trang Bị"
      :title="t('equipment.title', 'Trang Bị Hiện Tại')"
      :subtitle="t('equipment.subtitle', 'Tổng quan bộ trang bị đang đeo')"
      tone="gold"
      watermark-letter="T"
      breadcrumb="Equipment"
      test-id="equipment-view-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="TRANG BỊ" label="Equipment" class="sr-only" />
      <template #meta>
        <XTGlyphBadge tone="gold" size="sm" glyph="⚔">
          {{ equippedCount }} / {{ EQUIP_SLOTS.length }}
        </XTGlyphBadge>
      </template>
    </XTLuxHero>

    <!-- Role hint -->
    <p class="text-sm text-gray-400 px-1" data-testid="equipment-role-hint">
      {{ t('equipment.roleHint') }}
    </p>

    <!-- Cross-navigation -->
    <nav class="flex gap-2 text-xs mb-2" data-testid="equipment-cross-nav">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-inventory"
        @click="$router.push('/inventory')"
      >
        <span>{{ t('equipment.crossNav.inventory') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('equipment.crossNav.inventoryDesc') }}</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-loadout"
        @click="$router.push('/loadout')"
      >
        <span>{{ t('equipment.crossNav.loadout') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('equipment.crossNav.loadoutDesc') }}</span>
      </button>
    </nav>

    <!-- Total Power + Stats Summary -->
    <section
      v-if="!loading"
      class="rounded border border-amber-400/30 bg-ink-700/40 p-4 mb-4 space-y-2"
      data-testid="equipment-stats-summary"
    >
      <h3 class="text-base font-bold text-amber-200">
        {{ t('equipment.totalPower', 'Tổng Chiến Lực') }}:
        <span class="text-amber-100 text-lg" data-testid="equipment-total-power">{{ totalPower }}</span>
      </h3>
      <div class="flex flex-wrap gap-3 text-sm text-ink-200" data-testid="equipment-total-stats">
        <span v-if="totalStats.atk">ATK +{{ totalStats.atk }}</span>
        <span v-if="totalStats.def">DEF +{{ totalStats.def }}</span>
        <span v-if="totalStats.hpMax">HP +{{ totalStats.hpMax }}</span>
        <span v-if="totalStats.mpMax">MP +{{ totalStats.mpMax }}</span>
        <span v-if="totalStats.spirit">Spirit +{{ totalStats.spirit }}</span>
        <span
          v-if="!totalStats.atk && !totalStats.def && !totalStats.hpMax && !totalStats.mpMax && !totalStats.spirit"
          class="italic text-ink-400"
        >
          {{ t('equipment.noStats', 'Chưa có bonus nào') }}
        </span>
      </div>
    </section>

    <!-- Gear Slots Grid -->
    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6" data-testid="equipment-slots-grid">
      <div
        v-for="slot in EQUIP_SLOTS"
        :key="slot"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex items-start gap-3"
        :data-testid="`equipment-slot-${slot}`"
      >
        <EquipmentArtCell
          :equip-slot="slot"
          :tier="equipped.get(slot)?.item?.equipmentTier ?? null"
          :equipped="!!equipped.get(slot)"
          :alt="equipped.get(slot)?.item?.name ?? slotLabel(slot)"
          size="md"
          show-tier
        />
        <div class="flex-1 min-w-0">
          <p class="text-xs text-ink-400 uppercase tracking-wide">{{ slotLabel(slot) }}</p>
          <template v-if="equipped.get(slot)">
            <p class="font-bold text-ink-100 text-sm">
              {{ equipped.get(slot)!.item.name }}
            </p>
            <div class="flex flex-wrap gap-1.5 mt-0.5">
              <span
                v-if="equipped.get(slot)!.refineLevel > 0"
                class="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 font-bold"
                data-testid="equipment-refine-badge"
              >
                +{{ equipped.get(slot)!.refineLevel }}
              </span>
              <span
                v-if="equipped.get(slot)!.enchantElement && equipped.get(slot)!.enchantLevel > 0"
                class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/40 text-cyan-300 font-bold"
                data-testid="equipment-enchant-badge"
              >
                {{ t(`elementBadge.element.${equipped.get(slot)!.enchantElement}`) }} +{{ equipped.get(slot)!.enchantLevel }}
              </span>
              <span
                v-if="equipped.get(slot)!.substats.length > 0"
                class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-bold"
                data-testid="equipment-substats-badge"
              >
                {{ equipped.get(slot)!.substats.length }} {{ t('equipment.substats', 'phụ') }}
              </span>
            </div>
            <p class="text-xs text-emerald-300">
              {{ bonusText(equipped.get(slot)!.item) }}
            </p>
            <div class="flex gap-2 mt-2">
              <button
                type="button"
                class="text-[10px] px-2 py-0.5 rounded border border-amber-500/40 text-amber-200 hover:bg-amber-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="actionInFlight"
                :data-testid="`equipment-unequip-${slot}`"
                @click="onUnequip(slot)"
              >
                {{ t('equipment.unequip', 'Tháo') }}
              </button>
              <button
                type="button"
                class="text-[10px] px-2 py-0.5 rounded border border-sky-500/40 text-sky-200 hover:bg-sky-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="actionInFlight"
                :data-testid="`equipment-swap-${slot}`"
                @click="openEquipModal(slot)"
              >
                {{ t('equipment.swap', 'Đổi') }}
              </button>
              <button
                type="button"
                class="text-[10px] px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-200 hover:bg-emerald-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="actionInFlight"
                :data-testid="`equipment-upgrade-${slot}`"
                @click="selectSlotForUpgrade(slot)"
              >
                {{ t('equipment.upgrade', 'Nâng cấp') }}
              </button>
            </div>
          </template>
          <template v-else>
            <p class="text-sm italic text-ink-400" data-testid="equipment-empty-slot">
              {{ t('equipment.emptySlot', 'Trống') }}
            </p>
            <button
              type="button"
              class="text-[10px] px-2 py-0.5 mt-2 rounded border border-emerald-500/40 text-emerald-200 hover:bg-emerald-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="actionInFlight"
              :data-testid="`equipment-equip-${slot}`"
              @click="openEquipModal(slot)"
            >
              {{ t('equipment.equip', 'Trang bị') }}
            </button>
          </template>
        </div>
      </div>
    </section>

    <!-- Upgrade Hub -->
    <section
      v-if="selectedSlot && selectedItem"
      class="rounded border border-emerald-400/30 bg-ink-700/40 p-4 mb-6 space-y-3"
      data-testid="equipment-upgrade-hub"
    >
      <header class="flex items-center justify-between">
        <div>
          <h3 class="text-base font-bold text-emerald-200">
            {{ t('equipment.upgradeHub.title', 'Nâng Cấp Trang Bị') }}
          </h3>
          <p class="text-xs text-ink-400">
            {{ selectedItem.item.name }}
            <span v-if="selectedItem.refineLevel > 0" class="text-amber-300">+{{ selectedItem.refineLevel }}</span>
            — {{ slotLabel(selectedSlot!) }}
          </p>
        </div>
        <button
          type="button"
          class="text-ink-400 hover:text-ink-200 text-lg"
          data-testid="equipment-upgrade-close"
          @click="closeUpgrade"
        >
          &times;
        </button>
      </header>

      <!-- Tab bar -->
      <div class="flex gap-1 text-xs" data-testid="equipment-upgrade-tabs">
        <button
          type="button"
          class="px-3 py-1.5 rounded-t"
          :class="upgradeTab === 'refine' ? 'bg-emerald-800/60 text-emerald-200 font-bold' : 'text-ink-400 hover:text-ink-200'"
          data-testid="equipment-upgrade-tab-refine"
          @click="upgradeTab = 'refine'"
        >
          {{ t('equipment.upgradeHub.tab.refine', 'Luyện') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-t"
          :class="upgradeTab === 'reforge' ? 'bg-emerald-800/60 text-emerald-200 font-bold' : 'text-ink-400 hover:text-ink-200'"
          data-testid="equipment-upgrade-tab-reforge"
          @click="upgradeTab = 'reforge'"
        >
          {{ t('equipment.upgradeHub.tab.reforge', 'Rèn') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-t"
          :class="upgradeTab === 'enchant' ? 'bg-emerald-800/60 text-emerald-200 font-bold' : 'text-ink-400 hover:text-ink-200'"
          data-testid="equipment-upgrade-tab-enchant"
          @click="upgradeTab = 'enchant'"
        >
          {{ t('equipment.upgradeHub.tab.enchant', 'Phù') }}
        </button>
      </div>

      <!-- Refine tab -->
      <div v-if="upgradeTab === 'refine'" class="space-y-2" data-testid="equipment-upgrade-refine">
        <div v-if="selectedItem.refineLevel >= REFINE_MAX_LEVEL" class="text-sm text-amber-300" data-testid="equipment-refine-max">
          {{ t('equipment.upgradeHub.refineMax', 'Đã đạt cấp tối đa') }}
        </div>
        <template v-else>
          <p class="text-sm text-ink-300" data-testid="equipment-refine-cost">
            {{ refineCostText(selectedItem) }}
          </p>
          <label class="flex items-center gap-2 text-xs text-ink-400 cursor-pointer">
            <input
              v-model="refineProtection"
              type="checkbox"
              class="accent-emerald-500"
              data-testid="equipment-refine-protection"
            />
            {{ t('equipment.upgradeHub.refineProtection', 'Dùng hộ phù') }}
          </label>
          <button
            type="button"
            class="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-200 hover:bg-emerald-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="submitting"
            data-testid="equipment-refine-btn"
            @click="onRefine"
          >
            {{ submitting ? t('equipment.upgradeHub.refining', 'Đang luyện…') : t('equipment.upgradeHub.refine', 'Luyện') }}
          </button>
        </template>
      </div>

      <!-- Reforge / Enchant tab — reuse existing component -->
      <EquipmentUpgradePanel
        v-if="upgradeTab === 'reforge' || upgradeTab === 'enchant'"
        :equipment="selectedItem"
        :initial-tab="upgradeTab"
        data-testid="equipment-upgrade-panel"
        @changed="refreshInventory"
      />
    </section>

    <!-- Equip Modal -->
    <div
      v-if="equipModalSlot"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      data-testid="equipment-equip-modal"
      role="dialog"
      aria-modal="true"
      @click.self="closeEquipModal"
    >
      <div class="bg-ink-900 border border-ink-300/30 rounded p-4 space-y-3 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <header class="flex items-center justify-between">
          <h3 class="text-base font-semibold text-amber-200">
            {{ t('equipment.modalTitle', { slot: slotLabel(equipModalSlot) }) }}
          </h3>
          <button
            type="button"
            class="text-ink-400 hover:text-ink-200 text-lg"
            data-testid="equipment-modal-close"
            @click="closeEquipModal"
          >
            &times;
          </button>
        </header>

        <div
          v-if="availableForSlot(equipModalSlot).length === 0"
          class="text-center py-6 text-ink-400 text-sm"
          data-testid="equipment-modal-empty"
        >
          {{ t('equipment.modalEmpty', 'Không có vật phẩm phù hợp trong kho đồ') }}
        </div>

        <ul v-else class="space-y-2" data-testid="equipment-modal-list">
          <li
            v-for="it in availableForSlot(equipModalSlot)"
            :key="it.id"
            class="flex items-center gap-3 rounded border border-ink-300/20 bg-ink-800/40 p-2 hover:border-amber-500/40 cursor-pointer transition-colors"
            :data-testid="`equipment-modal-item-${it.id}`"
            @click="onEquip(it.id)"
          >
            <EquipmentArtCell
              :equip-slot="equipModalSlot"
              :tier="it.item.equipmentTier ?? null"
              :equipped="false"
              :alt="it.item.name"
              size="sm"
              show-tier
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-ink-100 truncate">{{ it.item.name }}</p>
              <p class="text-xs text-emerald-300">{{ bonusText(it.item) }}</p>
            </div>
            <span
              v-if="it.refineLevel > 0"
              class="text-[10px] text-amber-300 font-bold"
            >
              +{{ it.refineLevel }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Empty state when no gear at all -->
    <div
      v-if="!loading && equippedCount === 0"
      class="text-center py-8 space-y-3"
      data-testid="equipment-empty-state"
    >
      <p class="text-ink-300 text-lg">{{ t('equipment.emptyAll', 'Chưa đeo trang bị nào') }}</p>
      <p class="text-ink-400 text-sm">{{ t('equipment.emptyHint', 'Mở Kho Đồ để chọn trang bị và trang bị cho nhân vật.') }}</p>
      <MButton data-testid="equipment-go-inventory" @click="goToInventory">
        {{ t('equipment.goInventory', 'Mở Kho Đồ') }}
      </MButton>
    </div>

    <!-- Actions / Links -->
    <section class="flex flex-wrap gap-3" data-testid="equipment-actions">
      <MButton data-testid="equipment-link-inventory" @click="goToInventory">
        {{ t('equipment.linkInventory', 'Kho Đồ') }}
      </MButton>
      <MButton data-testid="equipment-link-loadouts" @click="goToLoadouts">
        {{ t('equipment.linkLoadouts', 'Bộ Trang Bị') }}
      </MButton>
    </section>
  </AppShell>
</template>
