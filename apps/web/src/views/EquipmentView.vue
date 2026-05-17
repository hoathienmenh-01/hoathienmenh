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
  type EquipSlot,
  type ItemDef,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  listInventory,
  type InventoryView as InvItem,
} from '@/api/inventory';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import EquipmentArtCell from '@/components/xianxia/EquipmentArtCell.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const items = ref<InvItem[]>([]);
const loading = ref(true);

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
            <p v-if="equipped.get(slot)!.refineLevel > 0" class="text-[10px] text-amber-300 font-bold">
              +{{ equipped.get(slot)!.refineLevel }}
            </p>
            <p class="text-xs text-emerald-300">
              {{ bonusText(equipped.get(slot)!.item) }}
            </p>
          </template>
          <template v-else>
            <p class="text-sm italic text-ink-400" data-testid="equipment-empty-slot">
              {{ t('equipment.emptySlot', 'Trống') }}
            </p>
          </template>
        </div>
      </div>
    </section>

    <!-- Empty state when no gear at all -->
    <div
      v-if="!loading && equippedCount === 0"
      class="text-center py-8 space-y-3"
      data-testid="equipment-empty-state"
    >
      <p class="text-ink-300 text-lg">{{ t('equipment.emptyAll', 'Chưa đeo trang bị nào') }}</p>
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
