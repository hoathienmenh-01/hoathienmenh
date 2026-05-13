<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  EQUIP_SLOTS,
  QUALITY_COLOR,
  REALMS,
  REFINE_MAX_LEVEL,
  SORT_PRESETS,
  canEquipItemAtRealm,
  combineGems as catalogCombineGems,
  filterInventory,
  getEquipmentQualityVisual,
  getGemDef,
  getRefineAttemptCost,
  isSortPresetKey,
  itemWithProgression,
  itemByKey,
  skillByKey,
  socketCapacityForQuality,
  sortInventory,
  type EquipSlot,
  type GemCompatibleSlot,
  type GemDef,
  type ItemDef,
  type SortPresetKey,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  combineGemsApi,
  equipItem,
  listInventory,
  lockInventoryItem,
  refineEquipment,
  socketGem,
  unequipItem,
  unlockInventoryItem,
  unsocketGem,
  useItem,
  type InventoryView,
  type RefineResult,
} from '@/api/inventory';
import { learnSkillFromBook } from '@/api/skill';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import EquipmentUpgradePanel from '@/components/EquipmentUpgradePanel.vue';
import EquipmentEconomyPanel from '@/components/EquipmentEconomyPanel.vue';
import EquipmentBuildPanel from '@/components/EquipmentBuildPanel.vue';
import PhapBaoPanel from '@/components/PhapBaoPanel.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const items = ref<InventoryView[]>([]);
const submitting = ref(false);
/** Phase 23.3 — bump khi equip/unequip/refine/socket/reforge xong để build panel refetch. */
const buildRefreshKey = ref(0);
/** Phase 23.5 — bump để Pháp Bảo panel refetch sau khi equip/unequip/refine. */
const phapBaoRefreshKey = ref(0);
/** Phase 11.5.C — per-row protection toggle (key = inventoryItemId). */
const protectionFlags = ref<Record<string, boolean>>({});
/** Phase 11.4.C — per-equipment-row gem-key selection (key = equipment inventoryItemId). */
const gemSelections = ref<Record<string, string>>({});

/**
 * Phase 11.4.C — row đại diện một gem trong inventory. Backend `inventory.list()`
 * fallback `getGemDef` nên gem rô  hiện thành `InventoryView` với `item.kind='MISC'`
 * + `item.slot===undefined`. UI xác định gem rô = `getGemDef(itemKey)` truthy.
 */
function isGemRow(it: InventoryView): boolean {
  return getGemDef(it.itemKey) !== undefined;
}

/** Phase 11.4.C — owned unequipped gems with qty > 0, indexed by gemKey. */
const ownedGemQty = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {};
  for (const it of items.value) {
    if (it.equippedSlot) continue;
    if (!isGemRow(it)) continue;
    map[it.itemKey] = (map[it.itemKey] ?? 0) + it.qty;
  }
  return map;
});

/** Phase 11.4.C — gems có thể khảm vào equipment slot, owned + qty > 0. */
function compatibleGems(equipment: InventoryView): GemDef[] {
  if (!equipment.item.slot) return [];
  const slot = equipment.item.slot as GemCompatibleSlot;
  const out: GemDef[] = [];
  for (const [gemKey, qty] of Object.entries(ownedGemQty.value)) {
    if (qty <= 0) continue;
    const gem = getGemDef(gemKey);
    if (!gem) continue;
    if (gem.compatibleSlots.includes('ANY') || gem.compatibleSlots.includes(slot)) {
      out.push(gem);
    }
  }
  return out;
}

/** Phase 11.4.C — socket capacity cho equipment dựa vào quality. */
function capacityFor(equipment: InventoryView): number {
  return equipment.item.maxSocketCount ?? socketCapacityForQuality(equipment.item.quality);
}

function gemBonusText(gem: GemDef): string {
  const parts: string[] = [];
  if (gem.bonus.atk) parts.push(t('inventory.bonus.atk', { v: gem.bonus.atk }));
  if (gem.bonus.def) parts.push(t('inventory.bonus.def', { v: gem.bonus.def }));
  if (gem.bonus.hpMax) parts.push(t('inventory.bonus.hpMax', { v: gem.bonus.hpMax }));
  if (gem.bonus.mpMax) parts.push(t('inventory.bonus.mpMax', { v: gem.bonus.mpMax }));
  if (gem.bonus.spirit) parts.push(t('inventory.bonus.spirit', { v: gem.bonus.spirit }));
  return parts.join(' · ');
}

function gemElementLabel(gem: GemDef): string {
  if (!gem.element) return t('inventory.gem.anyElement');
  return t('inventory.gem.elementLabel', { element: t(`element.${gem.element}`, gem.element) });
}

/** Phase 11.4.C — catalog có rề gem có thể combine (qty ≥3 + nextTierKey ≡ có). */
function canCombine(it: InventoryView): boolean {
  if (!isGemRow(it)) return false;
  if (it.qty < 3) return false;
  return catalogCombineGems(it.itemKey) !== null;
}

function slotLabel(slot: EquipSlot): string {
  return t(`equipSlot.${slot}`);
}

function equipmentQualityClass(item: ItemDef): string {
  return item.slot ? getEquipmentQualityVisual(item.quality).textClass : QUALITY_COLOR[item.quality];
}

function characterRealmOrder(): number {
  const key = game.character?.realmKey;
  const realm = key ? REALMS.find((r) => r.key === key) : undefined;
  return realm?.order ?? 0;
}

const equipped = computed(() => {
  const map = new Map<EquipSlot, InventoryView>();
  for (const it of items.value) {
    if (it.equippedSlot) map.set(it.equippedSlot, it);
  }
  return map;
});

/**
 * Phase QOL-1 — sort preset (persist localStorage). Default = `default`
 * preset (locked desc → kind asc → quality desc → tier desc → level desc →
 * acquiredAt desc). User có thể đổi: newest / quality / tier / level / element.
 */
const SORT_STORAGE_KEY = 'xt:inventory-sort-preset-v1';
const SHOW_LOCKED_ONLY_KEY = 'xt:inventory-show-locked-only-v1';

function loadSortPreset(): SortPresetKey {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    return isSortPresetKey(v) ? v : 'default';
  } catch {
    return 'default';
  }
}

function loadShowLockedOnly(): boolean {
  try {
    return localStorage.getItem(SHOW_LOCKED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

const sortPreset = ref<SortPresetKey>(loadSortPreset());
const showLockedOnly = ref<boolean>(loadShowLockedOnly());

function onSortPresetChange(v: SortPresetKey): void {
  sortPreset.value = v;
  try {
    localStorage.setItem(SORT_STORAGE_KEY, v);
  } catch {
    // ignore
  }
}

function onShowLockedOnlyChange(v: boolean): void {
  showLockedOnly.value = v;
  try {
    localStorage.setItem(SHOW_LOCKED_ONLY_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

const SORT_PRESET_KEYS: SortPresetKey[] = [
  'default',
  'newest',
  'quality',
  'tier',
  'level',
  'element',
];

const unequipped = computed(() => {
  const raw = items.value.filter((i) => !i.equippedSlot);
  const filtered = showLockedOnly.value
    ? filterInventory(raw, { locked: true })
    : raw;
  return sortInventory(filtered, SORT_PRESETS[sortPreset.value].slice());
});

function bonusText(item: ItemDef): string {
  if (!item.bonuses) return '';
  const parts: string[] = [];
  if (item.bonuses.atk) parts.push(t('inventory.bonus.atk', { v: item.bonuses.atk }));
  if (item.bonuses.def) parts.push(t('inventory.bonus.def', { v: item.bonuses.def }));
  if (item.bonuses.hpMax) parts.push(t('inventory.bonus.hpMax', { v: item.bonuses.hpMax }));
  if (item.bonuses.mpMax) parts.push(t('inventory.bonus.mpMax', { v: item.bonuses.mpMax }));
  if (item.bonuses.spirit) parts.push(t('inventory.bonus.spirit', { v: item.bonuses.spirit }));
  // Phase 11.6.E — render equipment elementResist tooltip. value < 1 (e.g.
  // 0.95 = giảm 5% sát thương). pct hiển thị = round((1 - value) * 100).
  // Element name reuse `talents.element.<elem>` (cùng pattern PR #409).
  if (item.bonuses.elementResist) {
    for (const [elem, value] of Object.entries(item.bonuses.elementResist)) {
      if (typeof value !== 'number' || value <= 0 || value >= 1) continue;
      const pct = Math.round((1 - value) * 100);
      parts.push(
        t('inventory.bonus.elementResist', {
          pct,
          element: t(`talents.element.${elem}`, elem),
        }),
      );
    }
  }
  // Phase 14.2.B — render equipment elementalAtkBonus tooltip. value > 0
  // (e.g. 0.05 = +5% damage skill cùng hệ). pct hiển thị = round(value*100).
  // Element name reuse `talents.element.<elem>` (cùng pattern elementResist).
  if (item.bonuses.elementalAtkBonus) {
    for (const [elem, value] of Object.entries(item.bonuses.elementalAtkBonus)) {
      if (typeof value !== 'number' || value <= 0) continue;
      const pct = Math.round(value * 100);
      parts.push(
        t('inventory.bonus.elementalAtkBonus', {
          pct,
          element: t(`talents.element.${elem}`, elem),
        }),
      );
    }
  }
  return parts.join(' · ');
}

function progressionItem(it: InventoryView): ItemDef {
  return itemWithProgression(it.item);
}

function equipmentProgressionText(it: InventoryView): string {
  const item = progressionItem(it);
  if (!item.slot || !item.equipmentTier || !item.requiredRealmOrder) return '';
  const grade = item.equipmentGradeWithinTier
    ? t('inventory.progression.gradeLabel', { grade: item.equipmentGradeWithinTier })
    : t('inventory.progression.finalGrade');
  const power = item.computedPowerScore ?? item.powerBudget ?? 0;
  const parts = [
    t('inventory.progression.tierLabel', {
      tier: item.equipmentTier,
      name: item.equipmentTierName ?? '',
      grade,
    }),
    t('inventory.progression.quality', { quality: t('quality.' + item.quality) }),
    t('inventory.progression.requiredRealm', { order: item.requiredRealmOrder }),
    t('inventory.progression.power', { power }),
    t('inventory.progression.caps', {
      enhance: item.maxEnhanceLevel ?? 0,
      sockets: item.maxSocketCount ?? 0,
    }),
    t('inventory.progression.qualityMeaning'),
  ];
  return parts.join(' · ');
}

function equipmentLockText(it: InventoryView): string {
  const item = progressionItem(it);
  if (!item.slot || !item.requiredRealmOrder) return '';
  return canEquipItemAtRealm(item, characterRealmOrder())
    ? ''
    : t('inventory.progression.lockHint', { order: item.requiredRealmOrder });
}

function effectText(item: ItemDef): string {
  if (!item.effect) return '';
  const parts: string[] = [];
  if (item.effect.hp) parts.push(`+${item.effect.hp} HP`);
  if (item.effect.mp) parts.push(`+${item.effect.mp} MP`);
  if (item.effect.exp) parts.push(`+${item.effect.exp} EXP`);
  return parts.join(' · ');
}

/**
 * Phase 11.5.C — luyện khí cost preview cho UI. Server-authoritative,
 * frontend chỉ hiển thị để user biết trước; cost thật resolve qua API.
 */
function refineCostText(it: InventoryView): string {
  if (it.refineLevel >= REFINE_MAX_LEVEL) return '';
  const cost = getRefineAttemptCost(it.refineLevel);
  const matDef = itemByKey(cost.materialKey);
  const matName = matDef?.name ?? cost.materialKey;
  return t('inventory.refine.costLabel', {
    linhThach: cost.linhThachCost,
    qty: cost.materialQty,
    material: matName,
  });
}

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
    toast.push({ type: 'error', text: t('inventory.loadFailToast') });
  }
});

async function refreshInventory(): Promise<void> {
  try {
    items.value = await listInventory();
  } catch {
    toast.push({ type: 'error', text: t('inventory.loadFailToast') });
  }
  buildRefreshKey.value += 1;
}

async function onEquip(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    items.value = await equipItem(it.id);
    toast.push({ type: 'success', text: t('inventory.equipToast', { name: it.item.name }) });
    buildRefreshKey.value += 1;
    phapBaoRefreshKey.value += 1;
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onUnequip(slot: EquipSlot): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    items.value = await unequipItem(slot);
    toast.push({ type: 'system', text: t('inventory.unequipToast', { slot: slotLabel(slot) }) });
    buildRefreshKey.value += 1;
    phapBaoRefreshKey.value += 1;
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

/** Phase 23.5 — Pháp Bảo panel dùng `/inventory/equip` (realm gate đã có). */
async function onPhapBaoEquip(inventoryItemId: string): Promise<void> {
  const it = items.value.find((row) => row.id === inventoryItemId);
  if (!it) return;
  await onEquip(it);
}

/** Phase 23.5 — Pháp Bảo panel emit unequip với slot string → cast về EquipSlot. */
async function onPhapBaoUnequip(slot: string): Promise<void> {
  await onUnequip(slot as EquipSlot);
}

/** Phase 23.5 — Pháp Bảo panel dùng `/character/refine` (cost progression riu00eang tính server-side). */
async function onPhapBaoUpgraded(): Promise<void> {
  items.value = await listInventory();
  buildRefreshKey.value += 1;
  phapBaoRefreshKey.value += 1;
}

async function onUse(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    items.value = await useItem(it.id);
    toast.push({ type: 'success', text: t('inventory.useToast', { name: it.item.name }) });
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

/**
 * Phase QOL-1 — toggle lock state. Optimistic: replace item in list ngay,
 * sau đó reconcile khi server reply. Nếu server reject, revert.
 */
async function onToggleLock(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  const idx = items.value.findIndex((x) => x.id === it.id);
  const original = idx >= 0 ? items.value[idx] : null;
  // Optimistic update.
  if (idx >= 0 && original) {
    items.value = items.value.map((x, i) =>
      i === idx ? { ...x, locked: !x.locked } : x,
    );
  }
  try {
    const updated = it.locked
      ? await unlockInventoryItem(it.id)
      : await lockInventoryItem(it.id);
    items.value = items.value.map((x) => (x.id === updated.id ? updated : x));
    toast.push({
      type: 'success',
      text: updated.locked
        ? t('inventory.lock.lockedToast', { name: it.item.name })
        : t('inventory.lock.unlockedToast', { name: it.item.name }),
    });
  } catch (e) {
    // Revert optimistic update.
    if (idx >= 0 && original) {
      items.value = items.value.map((x, i) => (i === idx ? original : x));
    }
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

/**
 * Phase 11.2.D — Render skill book consume button. Wire `POST
 * /character/skill/learn-from-book` server-authoritative endpoint.
 *
 * Flow: button "Học" (gated bởi `kind==='SKILL_BOOK'` + có `skillBook.skillKey`
 * + skill catalog tồn tại) → confirm dialog (mô tả tên skill + cảnh báo consume
 * vĩnh viễn) → call `learnSkillFromBook(it.id)` → toast success / error map.
 *
 * Sau success, refresh inventory list từ `listInventory()` để đồng bộ qty thật
 * (server có thể delete row khi qty=0).
 */
function skillBookSkillName(it: InventoryView): string | null {
  if (it.item.kind !== 'SKILL_BOOK') return null;
  const skillKey = it.item.skillBook?.skillKey;
  if (!skillKey) return null;
  return skillByKey(skillKey)?.name ?? null;
}

async function onLearnFromBook(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  const skillName = skillBookSkillName(it);
  if (!skillName) return;
  const confirmed = window.confirm(
    t('inventory.learnConfirm', { skill: skillName, book: it.item.name }),
  );
  if (!confirmed) return;
  submitting.value = true;
  try {
    await learnSkillFromBook(it.id);
    toast.push({
      type: 'success',
      text: t('inventory.learnToast', { skill: skillName }),
    });
    items.value = await listInventory();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onRefine(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  if (it.refineLevel >= REFINE_MAX_LEVEL) return;
  submitting.value = true;
  const useProtection = protectionFlags.value[it.id] === true;
  try {
    const result = await refineEquipment(it.id, useProtection);
    pushRefineToast(result);
    items.value = await listInventory();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onSocketGem(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  const gemKey = gemSelections.value[it.id];
  if (!gemKey) return;
  submitting.value = true;
  try {
    await socketGem(it.id, gemKey);
    const gemDef = getGemDef(gemKey);
    toast.push({
      type: 'success',
      text: t('inventory.gem.socketSuccessToast', {
        gem: gemDef?.name ?? gemKey,
        equipment: it.item.name,
      }),
    });
    items.value = await listInventory();
    gemSelections.value[it.id] = '';
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onUnsocketGem(it: InventoryView, slotIndex: number): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const result = await unsocketGem(it.id, slotIndex);
    const gemDef = getGemDef(result.gemKey);
    toast.push({
      type: 'system',
      text: result.gemReturned
        ? t('inventory.gem.unsocketSuccessToast', {
            gem: gemDef?.name ?? result.gemKey,
            equipment: it.item.name,
          })
        : t('inventory.gem.unsocketDriftToast', { slot: slotIndex }),
    });
    items.value = await listInventory();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onCombineGem(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  if (!canCombine(it)) return;
  submitting.value = true;
  try {
    const result = await combineGemsApi(it.itemKey);
    const srcDef = getGemDef(result.srcGemKey);
    const resultDef = getGemDef(result.resultGemKey);
    toast.push({
      type: 'success',
      text: t('inventory.gem.combineSuccessToast', {
        src: srcDef?.name ?? result.srcGemKey,
        result: resultDef?.name ?? result.resultGemKey,
      }),
    });
    items.value = await listInventory();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

function pushRefineToast(result: RefineResult): void {
  if (result.broken) {
    toast.push({ type: 'error', text: t('inventory.refine.brokenToast') });
    return;
  }
  if (result.result.success) {
    toast.push({
      type: 'success',
      text: t('inventory.refine.successToast', { nextLevel: result.result.nextLevel }),
    });
    return;
  }
  if (result.protectionConsumed) {
    toast.push({
      type: 'system',
      text: t('inventory.refine.failProtectedToast', { finalLevel: result.finalLevel ?? 0 }),
    });
    return;
  }
  // Fail no level loss (safe stage) when finalLevel === attemptLevel - 1.
  if (result.finalLevel === result.attemptLevel - 1) {
    toast.push({ type: 'system', text: t('inventory.refine.failNoLossToast') });
    return;
  }
  toast.push({
    type: 'system',
    text: t('inventory.refine.failLossToast', { finalLevel: result.finalLevel ?? 0 }),
  });
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`inventory.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('inventory.errors.UNKNOWN') : text,
  });
}
</script>

<template>
  <AppShell>
    <h2 class="text-xl tracking-widest mb-4">{{ t('inventory.title') }}</h2>

    <div class="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <!-- Bộ trang bị + Phase 23.3 Build summary -->
      <section class="rounded border border-ink-300/40 bg-ink-700/30 p-4 space-y-2">
        <h3 class="text-base font-bold mb-2">{{ t('inventory.gearTitle') }}</h3>
        <div
          v-for="slot in EQUIP_SLOTS"
          :key="slot"
          class="flex items-center justify-between text-sm border-b border-ink-300/20 last:border-0 py-2"
        >
          <span class="text-ink-300 w-24">{{ slotLabel(slot) }}</span>
          <span v-if="equipped.get(slot)" :class="equipmentQualityClass(equipped.get(slot)!.item)">
            {{ equipped.get(slot)!.item.name }}
            <span class="text-[10px] text-cyan-200 font-normal ml-1">
              {{ equipmentProgressionText(equipped.get(slot)!) }}
            </span>
            <span
              v-if="equipped.get(slot)!.refineLevel > 0"
              class="text-[10px] text-amber-300 font-bold ml-1"
              data-testid="refine-badge"
            >{{ t('inventory.refine.levelLabel', { lvl: equipped.get(slot)!.refineLevel }) }}</span>
            <span
              v-if="equipped.get(slot)!.enchantElement && equipped.get(slot)!.enchantLevel > 0"
              class="text-[10px] text-cyan-300 font-bold ml-1"
              data-testid="enchant-badge"
            >{{
              t('inventory.upgrade.enchant.badgeLabel', {
                element: t('elementBadge.element.' + equipped.get(slot)!.enchantElement),
                level: equipped.get(slot)!.enchantLevel,
              })
            }}</span>
            <span
              v-if="equipped.get(slot)!.substats.length > 0"
              class="text-[10px] text-emerald-300 font-bold ml-1"
              data-testid="substats-badge"
            >{{
              t('inventory.upgrade.reforge.badgeLabel', {
                count: equipped.get(slot)!.substats.length,
              })
            }}</span>
          </span>
          <span v-else class="italic text-ink-300/60">{{ t('inventory.empty') }}</span>
          <MButton
            v-if="equipped.get(slot)"
            class="ml-auto !px-2 !py-0.5 text-xs"
            @click="onUnequip(slot)"
          >
            {{ t('inventory.takeOff') }}
          </MButton>
        </div>
        <EquipmentBuildPanel :refresh-key="buildRefreshKey" class="mt-4" />
        <PhapBaoPanel
          :refresh-key="phapBaoRefreshKey"
          class="mt-4"
          @equip="onPhapBaoEquip"
          @unequip="onPhapBaoUnequip"
          @upgraded="onPhapBaoUpgraded"
        />
      </section>

      <!-- Danh sách item chưa đeo -->
      <section class="space-y-3">
        <!-- Phase QOL-1 — sort preset + show-locked filter (persisted localStorage). -->
        <div
          class="flex flex-wrap items-center gap-3 rounded border border-ink-300/30 bg-ink-700/20 p-2"
          data-testid="inventory-sort-controls"
        >
          <label class="flex items-center gap-2 text-xs text-ink-200">
            <span>{{ t('inventory.sort.label') }}</span>
            <select
              :value="sortPreset"
              data-testid="inventory-sort-preset"
              class="rounded bg-ink-700 px-2 py-1 text-xs text-ink-100 border border-ink-300/40 focus:outline-none focus:ring-1 focus:ring-amber-400/60"
              @change="onSortPresetChange(($event.target as HTMLSelectElement).value as SortPresetKey)"
            >
              <option v-for="k in SORT_PRESET_KEYS" :key="k" :value="k">
                {{ t(`inventory.sort.preset.${k}`) }}
              </option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-xs text-ink-200 cursor-pointer">
            <input
              type="checkbox"
              :checked="showLockedOnly"
              data-testid="inventory-show-locked-only"
              class="h-3 w-3 accent-amber-400"
              @change="onShowLockedOnlyChange(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t('inventory.lock.showLockedOnly') }}</span>
          </label>
        </div>
        <div v-if="unequipped.length === 0" class="text-ink-300 italic">
          {{ t('inventory.emptyAll') }}
        </div>
        <div
          v-for="it in unequipped"
          :key="it.id"
          class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex flex-col gap-3"
        >
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  :title="
                    it.locked
                      ? t('inventory.lock.unlockTooltip')
                      : t('inventory.lock.lockTooltip')
                  "
                  :aria-label="
                    it.locked
                      ? t('inventory.lock.unlockTooltip')
                      : t('inventory.lock.lockTooltip')
                  "
                  :aria-pressed="it.locked"
                  data-testid="inventory-lock-toggle"
                  :data-locked="it.locked ? 'true' : 'false'"
                  class="text-base leading-none rounded px-1 py-0.5 transition-colors focus:outline-none focus:ring-1 focus:ring-amber-400/60"
                  :class="
                    it.locked
                      ? 'text-amber-300 hover:bg-amber-300/10'
                      : 'text-ink-300 hover:bg-ink-300/10 hover:text-ink-100'
                  "
                  :disabled="submitting"
                  @click="onToggleLock(it)"
                >
                  <span aria-hidden="true">{{ it.locked ? '🔒' : '🔓' }}</span>
                </button>
                <span class="font-bold" :class="equipmentQualityClass(it.item)">
                  {{ it.item.name }}
                </span>
                <span
                  v-if="it.refineLevel > 0"
                  class="text-[10px] text-amber-300 font-bold"
                  data-testid="refine-badge"
                >{{ t('inventory.refine.levelLabel', { lvl: it.refineLevel }) }}</span>
                <span class="text-[10px] text-ink-300">
                  {{ t('quality.' + it.item.quality) }} ·
                  {{ it.item.kind }} ·
                  ×{{ it.qty }}
                </span>
              </div>
              <p class="text-xs text-ink-300 mt-0.5">{{ it.item.description }}</p>
              <p v-if="it.item.bonuses" class="text-xs text-emerald-300">
                {{ bonusText(it.item) }}
              </p>
              <p
                v-if="it.item.slot"
                class="text-[10px] text-cyan-200"
                data-testid="equipment-progression-meta"
              >
                {{ equipmentProgressionText(it) }}
              </p>
              <p
                v-if="it.item.slot"
                class="text-[10px] text-amber-200"
                data-testid="equipment-realm-lock-hint"
              >
                {{ equipmentLockText(it) }}
              </p>
              <p v-else-if="it.item.effect" class="text-xs text-amber-200">
                {{ effectText(it.item) }}
              </p>
              <!-- Phase 11.4.C — Gem row metadata (element, compatible slots, bonus). -->
              <div v-if="isGemRow(it)" class="space-y-0.5">
                <p
                  class="text-[10px] text-cyan-200"
                  data-testid="gem-meta"
                >
                  {{ gemElementLabel(getGemDef(it.itemKey)!) }} ·
                  {{
                    t('inventory.gem.compatibleSlotsLabel', {
                      slots: getGemDef(it.itemKey)!.compatibleSlots.join(', '),
                    })
                  }}
                </p>
                <p
                  class="text-[10px] text-emerald-300"
                  data-testid="gem-bonus"
                >{{ gemBonusText(getGemDef(it.itemKey)!) }}</p>
              </div>
              <!-- Phase 11.4.C — Equipment socket inventory (read-only badges). -->
              <div
                v-if="it.item.slot && capacityFor(it) > 0"
                class="text-[10px] text-cyan-200 mt-0.5"
                data-testid="equip-sockets"
              >
                {{
                  t('inventory.gem.socketsLabel', {
                    filled: it.sockets.length,
                    max: capacityFor(it),
                  })
                }}
                <span
                  v-for="(socketGemKey, idx) in it.sockets"
                  :key="`${it.id}-socket-${idx}`"
                  class="ml-1 inline-flex items-center gap-1 rounded bg-cyan-900/40 px-1 py-[1px]"
                >
                  {{ getGemDef(socketGemKey)?.name ?? socketGemKey }}
                  <button
                    type="button"
                    class="text-[10px] text-rose-300 hover:text-rose-200"
                    data-testid="gem-unsocket-button"
                    :disabled="submitting"
                    @click="onUnsocketGem(it, idx)"
                  >{{ t('inventory.gem.unsocketButton') }}</button>
                </span>
              </div>
            </div>
            <div class="flex flex-col gap-1 items-stretch">
              <MButton v-if="it.item.slot" :loading="submitting" @click="onEquip(it)">
                {{ t('inventory.equip') }}
              </MButton>
              <MButton v-if="it.item.effect" :loading="submitting" @click="onUse(it)">
                {{ t('inventory.use') }}
              </MButton>
              <!-- Phase 11.2.D — Skill book consume button. Gate bởi kind==='SKILL_BOOK' + catalog tồn tại. -->
              <template v-if="it.item.kind === 'SKILL_BOOK' && skillBookSkillName(it)">
                <p
                  class="text-[10px] text-violet-200 text-right"
                  data-testid="skill-book-target"
                >{{ t('inventory.learnTarget', { skill: skillBookSkillName(it) }) }}</p>
                <MButton
                  :loading="submitting"
                  data-testid="skill-book-learn-button"
                  @click="onLearnFromBook(it)"
                >
                  {{ t('inventory.learn') }}
                </MButton>
              </template>
              <!-- Phase 11.5.C — Refine block (chỉ hiển cho equipment slot, không cho consumable). -->
              <template v-if="it.item.slot">
                <p
                  v-if="it.refineLevel < REFINE_MAX_LEVEL"
                  class="text-[10px] text-ink-300/80 text-right"
                  data-testid="refine-cost"
                >{{ refineCostText(it) }}</p>
                <label
                  v-if="it.refineLevel < REFINE_MAX_LEVEL"
                  class="text-[10px] flex items-center gap-1 justify-end text-ink-300"
                >
                  <input
                    v-model="protectionFlags[it.id]"
                    type="checkbox"
                    data-testid="refine-protection"
                  />
                  {{ t('inventory.refine.protection') }}
                </label>
                <MButton
                  :loading="submitting"
                  :disabled="it.refineLevel >= REFINE_MAX_LEVEL"
                  data-testid="refine-button"
                  @click="onRefine(it)"
                >
                  {{
                    it.refineLevel >= REFINE_MAX_LEVEL
                      ? t('inventory.refine.buttonMaxed')
                      : t('inventory.refine.button')
                  }}
                </MButton>
              </template>
              <!-- Phase 11.4.C — Gem socket UI cho equipment có capacity > 0 + slot trống. -->
              <div
                v-if="it.item.slot && capacityFor(it) > 0 && it.sockets.length < capacityFor(it)"
                class="flex flex-col gap-1"
              >
                <select
                  v-model="gemSelections[it.id]"
                  class="text-[10px] bg-ink-900 border border-ink-300/40 px-1 py-0.5 text-ink-100"
                  data-testid="gem-select"
                >
                  <option value="">{{ t('inventory.gem.selectPlaceholder') }}</option>
                  <option
                    v-for="g in compatibleGems(it)"
                    :key="`${it.id}-opt-${g.key}`"
                    :value="g.key"
                  >
                    {{ g.name }} (×{{ ownedGemQty[g.key] ?? 0 }})
                  </option>
                </select>
                <p
                  v-if="compatibleGems(it).length === 0"
                  class="text-[10px] text-ink-300/80 italic text-right"
                  data-testid="gem-no-compat"
                >{{ t('inventory.gem.noOwnedGems') }}</p>
                <MButton
                  :loading="submitting"
                  :disabled="!gemSelections[it.id]"
                  data-testid="gem-socket-button"
                  @click="onSocketGem(it)"
                >
                  {{ t('inventory.gem.socketButton') }}
                </MButton>
              </div>
              <!-- Phase 11.4.C — Gem row Hợp 3→1 button. -->
              <MButton
                v-if="canCombine(it)"
                :loading="submitting"
                data-testid="gem-combine-button"
                @click="onCombineGem(it)"
              >
                {{ t('inventory.gem.combineButton') }}
              </MButton>
            </div>
          </div>
          <!-- Phase 15.0.A — Equipment Reforge / Enchant Foundation panel. -->
          <EquipmentUpgradePanel
            v-if="it.item.slot"
            :equipment="it"
            @changed="refreshInventory"
          />
          <!-- Phase 23.4 — Equipment Upgrade Economy / Resource Sink panel. -->
          <EquipmentEconomyPanel
            v-if="it.item.slot"
            :equipment="it"
            :inventory="items"
            @changed="refreshInventory"
          />
        </div>
      </section>
    </div>
  </AppShell>
</template>
