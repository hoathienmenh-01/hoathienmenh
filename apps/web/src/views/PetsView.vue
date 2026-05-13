<script setup lang="ts">
/**
 * Phase 35.0 — Player Pet / Linh Thú View.
 *
 * Tabs:
 *   - Collection: pet sở hữu + equip/unequip/lock/rename.
 *   - Catalog: 35+ pet bách khoa (filter type/element).
 *   - Boxes: 5 hộp + rates + pity counter + open 1x.
 *   - Upgrade: feed/star-up/breakthrough/evolve + skill upgrade.
 *   - Sources: nguồn nhận miễn phí/event/dungeon cho pet đã chọn.
 *   - Logs: 50 lần mở hộp gần nhất.
 *
 * Snapshot panel hiển thị effective stats theo context (PVE/PVP/BOSS/...).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  listPetCatalog,
  listPetCollection,
  listPetShards,
  listPetBoxes,
  listPetBoxLogs,
  getPetBoxPity,
  openPetBox,
  equipPet,
  unequipPet,
  lockPet,
  unlockPet,
  renamePet,
  starUpPet,
  breakthroughPet,
  evolvePet,
  getEquippedSnapshot,
  getPetSources,
  feedPet,
  upgradePetSkill,
  type PetCatalogEntry,
  type CharacterPetView,
  type PetBoxDef,
  type PetBoxLogRow,
  type PetPityCounter,
  type PetSnapshotOutput,
  type PetSourceEntry,
} from '@/api/pet';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';

const { t } = useI18n();
const toast = useToastStore();

const tab = ref<'collection' | 'catalog' | 'boxes' | 'upgrade' | 'sources' | 'logs'>(
  'collection',
);

const loading = ref(false);
const catalog = ref<PetCatalogEntry[]>([]);
const collection = ref<CharacterPetView[]>([]);
const shards = ref<Array<{ petKey: string; amount: number }>>([]);
const boxes = ref<PetBoxDef[]>([]);
const logs = ref<PetBoxLogRow[]>([]);
const selectedPet = ref<CharacterPetView | null>(null);
const selectedSources = ref<PetSourceEntry[]>([]);
const snapshot = ref<PetSnapshotOutput | null>(null);
const snapshotContext = ref<'PVE' | 'PVP' | 'BOSS' | 'DUNGEON' | 'SECRET_REALM'>('PVE');
const pityMap = ref<Record<string, PetPityCounter | null>>({});

const filterType = ref<'' | 'PET' | 'LINH_THU'>('');

const filteredCatalog = computed(() => {
  if (!filterType.value) return catalog.value;
  return catalog.value.filter((p) => p.type === filterType.value);
});

const catalogByKey = computed(() => {
  const m = new Map<string, PetCatalogEntry>();
  for (const p of catalog.value) m.set(p.petKey, p);
  return m;
});

function petDisplayName(p: CharacterPetView): string {
  if (p.customName) return p.customName;
  const def = catalogByKey.value.get(p.petKey);
  return def?.nameVi ?? p.petKey;
}

async function refreshAll(): Promise<void> {
  loading.value = true;
  try {
    const [cat, col, sh, bx, lg] = await Promise.all([
      listPetCatalog(),
      listPetCollection(),
      listPetShards(),
      listPetBoxes(),
      listPetBoxLogs({ limit: 50 }),
    ]);
    catalog.value = cat;
    collection.value = col;
    shards.value = sh;
    boxes.value = bx;
    logs.value = lg;
    if (collection.value.find((p) => p.isEquipped)) {
      await refreshSnapshot();
    }
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  } finally {
    loading.value = false;
  }
}

async function refreshSnapshot(): Promise<void> {
  try {
    snapshot.value = await getEquippedSnapshot(snapshotContext.value);
  } catch {
    snapshot.value = null;
  }
}

async function refreshPity(boxKey: string): Promise<void> {
  try {
    pityMap.value[boxKey] = await getPetBoxPity(boxKey);
  } catch {
    pityMap.value[boxKey] = null;
  }
}

async function doEquip(p: CharacterPetView): Promise<void> {
  try {
    await equipPet(p.id);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doUnequip(p: CharacterPetView): Promise<void> {
  try {
    await unequipPet(p.id);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doToggleLock(p: CharacterPetView): Promise<void> {
  try {
    if (p.isLocked) await unlockPet(p.id);
    else await lockPet(p.id);
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doRename(p: CharacterPetView): Promise<void> {
  const newName = window.prompt(t('pets.renamePrompt'), p.customName ?? '');
  if (!newName) return;
  try {
    await renamePet(p.id, newName);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doStarUp(p: CharacterPetView): Promise<void> {
  try {
    await starUpPet(p.id);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doBreakthrough(p: CharacterPetView): Promise<void> {
  try {
    await breakthroughPet(p.id);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doEvolve(p: CharacterPetView): Promise<void> {
  try {
    await evolvePet(p.id);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doUpgradeSkill(p: CharacterPetView, skillKey: string): Promise<void> {
  try {
    await upgradePetSkill(p.id, skillKey);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

const feedItemKey = ref('pet_mat_linh_thao');
const feedQty = ref(1);

async function doFeed(p: CharacterPetView): Promise<void> {
  try {
    await feedPet(p.id, feedItemKey.value, feedQty.value);
    toast.push({ type: 'success', text: t('pets.title') });
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doOpenBox(box: PetBoxDef): Promise<void> {
  if (!window.confirm(t('pets.actions.openConfirm'))) return;
  try {
    const reqId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await openPetBox(box.boxKey, reqId);
    toast.push({
      type: 'success',
      text: `${t('pets.boxes.openResult')}: ${r.resultType} - ${r.resultKey} x${r.resultAmount}`,
    });
    await refreshPity(box.boxKey);
    await refreshAll();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function selectPet(p: CharacterPetView): Promise<void> {
  selectedPet.value = p;
  try {
    selectedSources.value = await getPetSources(p.petKey);
  } catch {
    selectedSources.value = [];
  }
}

function rarityClass(r: string): string {
  switch (r) {
    case 'COMMON':
      return 'text-gray-300';
    case 'UNCOMMON':
      return 'text-green-300';
    case 'RARE':
      return 'text-blue-300';
    case 'EPIC':
      return 'text-purple-300';
    case 'LEGENDARY':
      return 'text-yellow-300';
    case 'MYTHIC':
      return 'text-red-300';
    default:
      return 'text-gray-300';
  }
}

onMounted(async () => {
  await refreshAll();
  for (const b of boxes.value) {
    void refreshPity(b.boxKey);
  }
});
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <div class="flex justify-between items-center">
        <h1 class="text-xl font-bold">{{ t('pets.title') }}</h1>
        <div v-if="snapshot" class="text-xs text-gray-400">
          {{ t('pets.snapshot.title') }} ({{ t(`pets.snapshotContexts.${snapshotContext}`) }})
          — {{ t('pets.snapshot.capPercent') }}:
          <span class="text-amber-300">{{ snapshot.contributionCapPercent }}%</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-2 flex-wrap">
        <button
          v-for="ty in (['collection','catalog','boxes','upgrade','sources','logs'] as const)"
          :key="ty"
          class="px-2 py-1 rounded text-sm"
          :class="tab === ty ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
          @click="tab = ty"
        >
          {{ t(`pets.tabs.${ty}`) }}
        </button>
      </div>

      <!-- Collection -->
      <div v-if="tab === 'collection'" class="space-y-3">
        <div v-if="loading" class="text-gray-400">{{ t('common.loading') }}</div>
        <div v-else-if="collection.length === 0" class="text-gray-500">
          {{ t('pets.empty') }}
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div
            v-for="p in collection"
            :key="p.id"
            class="bg-gray-800 rounded p-3 hover:bg-gray-700 cursor-pointer"
            :class="p.isEquipped ? 'border border-amber-500' : ''"
            @click="selectPet(p)"
          >
            <div class="flex justify-between items-center">
              <div class="font-semibold" :class="rarityClass(p.rarity)">
                {{ petDisplayName(p) }}
                <span v-if="p.isLocked" class="text-xs text-gray-400">🔒</span>
              </div>
              <span v-if="p.isEquipped" class="text-xs text-amber-300">
                {{ t('pets.equipped') }}
              </span>
            </div>
            <div class="text-xs text-gray-400">
              {{ t('pets.level') }} {{ p.level }} · {{ t('pets.star') }} {{ p.star }} ·
              {{ p.element }} · {{ p.quality }}
            </div>
            <div class="flex gap-1 mt-2 flex-wrap">
              <button
                class="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500"
                @click.stop="p.isEquipped ? doUnequip(p) : doEquip(p)"
              >
                {{ p.isEquipped ? t('pets.actions.unequip') : t('pets.actions.equip') }}
              </button>
              <button
                class="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-500"
                @click.stop="doToggleLock(p)"
              >
                {{ p.isLocked ? t('pets.actions.unlock') : t('pets.actions.lock') }}
              </button>
              <button
                v-if="!p.isLocked"
                class="text-xs px-2 py-1 rounded bg-gray-600 hover:bg-gray-500"
                @click.stop="doRename(p)"
              >
                {{ t('pets.actions.rename') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Catalog -->
      <div v-if="tab === 'catalog'" class="space-y-3">
        <div class="flex gap-2 flex-wrap">
          <button
            class="px-2 py-1 rounded text-sm"
            :class="filterType === '' ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
            @click="filterType = ''"
          >
            {{ t('common.all') }}
          </button>
          <button
            class="px-2 py-1 rounded text-sm"
            :class="filterType === 'PET' ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
            @click="filterType = 'PET'"
          >
            PET
          </button>
          <button
            class="px-2 py-1 rounded text-sm"
            :class="filterType === 'LINH_THU' ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
            @click="filterType = 'LINH_THU'"
          >
            LINH_THU
          </button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div
            v-for="p in filteredCatalog"
            :key="p.petKey"
            class="bg-gray-800 rounded p-3"
          >
            <div class="font-semibold" :class="rarityClass(p.rarity)">
              {{ p.nameVi }} <span class="text-xs text-gray-500">({{ p.nameEn }})</span>
            </div>
            <div class="text-xs text-gray-400">
              {{ p.type }} · {{ p.element }} · {{ p.quality }} · {{ p.rarity }} · {{ p.role }}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ t('pets.skills') }}: {{ p.skillKeys.join(', ') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Boxes -->
      <div v-if="tab === 'boxes'" class="space-y-3">
        <div v-if="boxes.length === 0" class="text-gray-500">{{ t('common.empty.description') }}</div>
        <div
          v-for="b in boxes"
          :key="b.boxKey"
          class="bg-gray-800 rounded p-3 space-y-2"
        >
          <div class="flex justify-between items-center">
            <div class="font-semibold">{{ b.nameVi }}</div>
            <div class="flex gap-1">
              <span
                v-if="b.isPremium"
                class="text-xs px-2 py-0.5 rounded bg-purple-700"
              >{{ t('pets.boxes.premium') }}</span>
              <span
                v-if="b.isEventLimited"
                class="text-xs px-2 py-0.5 rounded bg-blue-700"
              >{{ t('pets.boxes.eventLimited') }}</span>
            </div>
          </div>
          <div class="text-xs text-gray-400">{{ b.description }}</div>
          <div class="text-xs">
            {{ t('pets.boxes.cost') }}: {{ b.costPerOpen.amount }}
            {{ b.costPerOpen.costType }}
            <span v-if="b.costPerOpen.itemKey">({{ b.costPerOpen.itemKey }})</span>
          </div>
          <div class="text-xs">
            {{ t('pets.boxes.rates') }}:
            <span v-for="(rate, key) in b.rarityRates" :key="key" class="ml-2">
              {{ key }}={{ rate }}%
            </span>
          </div>
          <div v-if="pityMap[b.boxKey]" class="text-xs text-gray-400">
            {{ t('pets.boxes.totalOpens') }}: {{ pityMap[b.boxKey]?.totalOpens }} ·
            {{ t('pets.boxes.sinceEpic') }}: {{ pityMap[b.boxKey]?.opensSinceEpic }} ·
            {{ t('pets.boxes.sinceLegendary') }}: {{ pityMap[b.boxKey]?.opensSinceLegendary }}
          </div>
          <div class="flex gap-2">
            <button
              class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-sm"
              @click="doOpenBox(b)"
            >
              {{ t('pets.actions.open') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Upgrade -->
      <div v-if="tab === 'upgrade'" class="space-y-3">
        <div v-if="!selectedPet" class="text-gray-500">
          {{ t('pets.empty') }} - {{ t('pets.tabs.collection') }}
        </div>
        <div v-else class="bg-gray-800 rounded p-3 space-y-2">
          <div class="font-semibold" :class="rarityClass(selectedPet.rarity)">
            {{ petDisplayName(selectedPet) }}
          </div>
          <div class="text-xs text-gray-400">
            {{ t('pets.level') }} {{ selectedPet.level }} ·
            {{ t('pets.star') }} {{ selectedPet.star }} ·
            {{ t('pets.stage') }} {{ selectedPet.evolutionStage }}
          </div>
          <div class="flex gap-2 flex-wrap">
            <input
              v-model="feedItemKey"
              class="px-2 py-1 rounded bg-gray-700 text-sm"
              placeholder="itemKey"
            />
            <input
              v-model.number="feedQty"
              type="number"
              min="1"
              class="px-2 py-1 rounded bg-gray-700 text-sm w-20"
            />
            <button
              class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
              @click="doFeed(selectedPet)"
            >
              {{ t('pets.actions.feed') }}
            </button>
            <button
              class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
              @click="doStarUp(selectedPet)"
            >
              {{ t('pets.actions.starUp') }}
            </button>
            <button
              class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
              @click="doBreakthrough(selectedPet)"
            >
              {{ t('pets.actions.breakthrough') }}
            </button>
            <button
              class="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-sm"
              @click="doEvolve(selectedPet)"
            >
              {{ t('pets.actions.evolve') }}
            </button>
          </div>
          <div>
            <div class="text-xs font-semibold mt-2">{{ t('pets.skills') }}:</div>
            <div
              v-for="(lv, sk) in selectedPet.skillLevelsJson"
              :key="sk"
              class="text-xs flex justify-between gap-2 items-center"
            >
              <span>{{ sk }} · Lv {{ lv }}</span>
              <button
                class="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500"
                @click="doUpgradeSkill(selectedPet!, String(sk))"
              >
                {{ t('pets.actions.upgradeSkill') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Sources -->
      <div v-if="tab === 'sources'" class="space-y-3">
        <div v-if="!selectedPet" class="text-gray-500">
          {{ t('pets.empty') }} - {{ t('pets.tabs.collection') }}
        </div>
        <div v-else>
          <div class="text-sm mb-2 font-semibold">
            {{ t('pets.sourceList') }}: {{ petDisplayName(selectedPet) }}
          </div>
          <div v-if="selectedSources.length === 0" class="text-gray-500">
            {{ t('common.empty.description') }}
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="(s, i) in selectedSources"
              :key="i"
              class="bg-gray-800 rounded p-2 text-xs"
            >
              <div class="font-semibold">{{ s.kind }} · {{ s.sourceTag }}</div>
              <div class="text-gray-400">
                refKey={{ s.refKey ?? '-' }} · weight={{ s.weight }}
              </div>
              <div v-if="s.notes" class="text-gray-500">{{ s.notes }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div v-if="tab === 'logs'" class="space-y-2">
        <div v-if="logs.length === 0" class="text-gray-500">{{ t('pets.logs.empty') }}</div>
        <div
          v-for="l in logs"
          :key="l.id"
          class="bg-gray-800 rounded p-2 text-xs"
        >
          <div class="flex justify-between">
            <span>{{ new Date(l.createdAt).toLocaleString() }}</span>
            <span :class="l.pityTriggered ? 'text-amber-300' : 'text-gray-500'">
              {{ l.pityTriggered ? t('pets.logs.pity') : '' }}
            </span>
          </div>
          <div>
            {{ l.boxKey }} → {{ l.resultType }} · {{ l.resultKey }} x{{ l.resultAmount }} ·
            <span :class="rarityClass(l.resultRarity)">{{ l.resultRarity }}</span>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
