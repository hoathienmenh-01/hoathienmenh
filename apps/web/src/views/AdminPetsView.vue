<script setup lang="ts">
/**
 * Phase 35.0 — Admin Pet / Linh Thú View.
 *
 * Tabs:
 *   - Audit catalog: list issues from catalog/boxes/sources validators.
 *   - Character: load pets + shards by characterId.
 *   - Logs: load box open logs by characterId.
 *   - Grant: grant pet/shard, adjust, revoke, pity reset.
 *
 * Mọi mutation cần lý do (reason ≥ 5 ký tự) và đi qua AdminAuditWriter.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  adminListCatalogAudit,
  adminListBoxesAudit,
  adminListSourcesAudit,
  adminGetCharacterPets,
  adminGetCharacterShards,
  adminGetBoxLogs,
  adminGrantPet,
  adminGrantShard,
  adminRevokePet,
  adminAdjustPet,
  adminPityReset,
  type CharacterPetView,
  type PetBoxLogRow,
} from '@/api/pet';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const tab = ref<'audit' | 'character' | 'logs' | 'grant'>('audit');

const catalogIssues = ref<Array<{ code: string; message: string; petKey?: string }>>([]);
const boxIssues = ref<Array<{ boxKey: string; code: string; message: string }>>([]);
const sourceIssues = ref<Array<{ code: string; message: string; petKey?: string }>>([]);

const characterId = ref('');
const characterPets = ref<CharacterPetView[]>([]);
const characterShards = ref<Array<{ petKey: string; amount: number }>>([]);
const logRows = ref<PetBoxLogRow[]>([]);

const grantForm = ref({ characterId: '', petKey: '', reason: '' });
const shardForm = ref({ characterId: '', petKey: '', amount: 1, reason: '' });
const adjustForm = ref({
  characterPetId: '',
  level: undefined as number | undefined,
  star: undefined as number | undefined,
  evolutionStage: undefined as number | undefined,
  reason: '',
});
const revokeForm = ref({ characterPetId: '', reason: '' });
const pityResetForm = ref({ characterId: '', boxKey: '', poolKey: '', reason: '' });

async function loadAudit(): Promise<void> {
  try {
    const [cat, bx, src] = await Promise.all([
      adminListCatalogAudit(),
      adminListBoxesAudit(),
      adminListSourcesAudit(),
    ]);
    catalogIssues.value = cat;
    boxIssues.value = bx;
    sourceIssues.value = src;
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function loadCharacter(): Promise<void> {
  if (!characterId.value) return;
  try {
    const [pets, sh] = await Promise.all([
      adminGetCharacterPets(characterId.value),
      adminGetCharacterShards(characterId.value),
    ]);
    characterPets.value = pets;
    characterShards.value = sh;
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function loadLogs(): Promise<void> {
  if (!characterId.value) return;
  try {
    logRows.value = await adminGetBoxLogs(characterId.value, { limit: 100 });
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doGrant(): Promise<void> {
  try {
    await adminGrantPet({ ...grantForm.value });
    toast.push({ type: 'success', text: t('adminPets.actions.grant') });
    grantForm.value = { characterId: '', petKey: '', reason: '' };
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doShardGrant(): Promise<void> {
  try {
    await adminGrantShard({ ...shardForm.value });
    toast.push({ type: 'success', text: t('adminPets.actions.shardGrant') });
    shardForm.value = { characterId: '', petKey: '', amount: 1, reason: '' };
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doAdjust(): Promise<void> {
  try {
    await adminAdjustPet({ ...adjustForm.value });
    toast.push({ type: 'success', text: t('adminPets.actions.adjust') });
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doRevoke(): Promise<void> {
  try {
    await adminRevokePet({ ...revokeForm.value });
    toast.push({ type: 'success', text: t('adminPets.actions.revoke') });
    revokeForm.value = { characterPetId: '', reason: '' };
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

async function doPityReset(): Promise<void> {
  try {
    await adminPityReset({
      characterId: pityResetForm.value.characterId,
      boxKey: pityResetForm.value.boxKey,
      poolKey: pityResetForm.value.poolKey || undefined,
      reason: pityResetForm.value.reason,
    });
    toast.push({ type: 'success', text: t('adminPets.actions.pityReset') });
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, t('common.error.UNKNOWN')),
    });
  }
}

onMounted(async () => {
  await auth.hydrate();
  void loadAudit();
});
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <XTPageEyebrow caps="LINH THÚ PHỔ LỤC" label="Linh Thú Phổ Lục" />
      <h1 class="text-xl font-bold mt-1">{{ t('adminPets.title') }}</h1>

      <div class="flex gap-2 flex-wrap">
        <button
          v-for="ty in (['audit','character','logs','grant'] as const)"
          :key="ty"
          class="px-2 py-1 rounded text-sm"
          :class="tab === ty ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
          @click="tab = ty"
        >
          {{ t(`adminPets.tabs.${ty}`) }}
        </button>
      </div>

      <!-- Audit -->
      <div v-if="tab === 'audit'" class="space-y-3">
        <button
          class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
          @click="loadAudit"
        >
          {{ t('adminPets.actions.audit') }}
        </button>
        <div class="bg-gray-800 rounded p-3">
          <h3 class="font-semibold mb-2">Catalog</h3>
          <div
            v-if="catalogIssues.length === 0"
            class="text-gray-500 text-sm"
          >
            {{ t('adminPets.noIssues') }}
          </div>
          <div
            v-for="(i, idx) in catalogIssues"
            :key="idx"
            class="text-xs text-red-300 py-0.5"
          >
            [{{ i.code }}] {{ i.petKey ?? '-' }} - {{ i.message }}
          </div>
        </div>
        <div class="bg-gray-800 rounded p-3">
          <h3 class="font-semibold mb-2">Boxes</h3>
          <div
            v-if="boxIssues.length === 0"
            class="text-gray-500 text-sm"
          >
            {{ t('adminPets.noIssues') }}
          </div>
          <div
            v-for="(i, idx) in boxIssues"
            :key="idx"
            class="text-xs text-red-300 py-0.5"
          >
            [{{ i.code }}] {{ i.boxKey }} - {{ i.message }}
          </div>
        </div>
        <div class="bg-gray-800 rounded p-3">
          <h3 class="font-semibold mb-2">Sources</h3>
          <div
            v-if="sourceIssues.length === 0"
            class="text-gray-500 text-sm"
          >
            {{ t('adminPets.noIssues') }}
          </div>
          <div
            v-for="(i, idx) in sourceIssues"
            :key="idx"
            class="text-xs text-red-300 py-0.5"
          >
            [{{ i.code }}] {{ i.petKey ?? '-' }} - {{ i.message }}
          </div>
        </div>
      </div>

      <!-- Character -->
      <div v-if="tab === 'character'" class="space-y-3">
        <div class="flex gap-2">
          <input
            v-model="characterId"
            class="px-2 py-1 rounded bg-gray-700 flex-1 text-sm"
            :placeholder="t('adminPets.characterIdPlaceholder')"
          />
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            @click="loadCharacter"
          >
            {{ t('adminPets.actions.load') }}
          </button>
        </div>
        <div class="bg-gray-800 rounded p-3">
          <h3 class="font-semibold mb-2">Pets</h3>
          <div
            v-for="p in characterPets"
            :key="p.id"
            class="text-xs py-0.5"
          >
            {{ p.id }} · {{ p.petKey }} · Lv{{ p.level }} ·
            <span :class="p.isEquipped ? 'text-amber-300' : ''">
              {{ p.isEquipped ? 'EQUIPPED' : '' }}
            </span>
          </div>
        </div>
        <div class="bg-gray-800 rounded p-3">
          <h3 class="font-semibold mb-2">Shards</h3>
          <div
            v-for="(s, idx) in characterShards"
            :key="idx"
            class="text-xs py-0.5"
          >
            {{ s.petKey }}: {{ s.amount }}
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div v-if="tab === 'logs'" class="space-y-3">
        <div class="flex gap-2">
          <input
            v-model="characterId"
            class="px-2 py-1 rounded bg-gray-700 flex-1 text-sm"
            :placeholder="t('adminPets.characterIdPlaceholder')"
          />
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            @click="loadLogs"
          >
            {{ t('adminPets.actions.load') }}
          </button>
        </div>
        <div
          v-for="l in logRows"
          :key="l.id"
          class="bg-gray-800 rounded p-2 text-xs"
        >
          {{ new Date(l.createdAt).toLocaleString() }} · {{ l.boxKey }} →
          {{ l.resultType }} {{ l.resultKey }} x{{ l.resultAmount }} ·
          {{ l.resultRarity }}
          <span v-if="l.pityTriggered" class="text-amber-300">[pity]</span>
        </div>
      </div>

      <!-- Grant -->
      <div v-if="tab === 'grant'" class="space-y-4">
        <div class="bg-gray-800 rounded p-3 space-y-2">
          <h3 class="font-semibold">{{ t('adminPets.actions.grant') }}</h3>
          <input v-model="grantForm.characterId" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.characterIdPlaceholder')" />
          <input v-model="grantForm.petKey" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.petKey')" />
          <input v-model="grantForm.reason" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.reason')" />
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            @click="doGrant"
          >
            {{ t('adminPets.actions.grant') }}
          </button>
        </div>
        <div class="bg-gray-800 rounded p-3 space-y-2">
          <h3 class="font-semibold">{{ t('adminPets.actions.shardGrant') }}</h3>
          <input v-model="shardForm.characterId" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.characterIdPlaceholder')" />
          <input v-model="shardForm.petKey" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.petKey')" />
          <input v-model.number="shardForm.amount" type="number" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.amount')" />
          <input v-model="shardForm.reason" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.reason')" />
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            @click="doShardGrant"
          >
            {{ t('adminPets.actions.shardGrant') }}
          </button>
        </div>
        <div class="bg-gray-800 rounded p-3 space-y-2">
          <h3 class="font-semibold">{{ t('adminPets.actions.adjust') }}</h3>
          <input v-model="adjustForm.characterPetId" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" placeholder="characterPetId" />
          <input v-model.number="adjustForm.level" type="number" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.level')" />
          <input v-model.number="adjustForm.star" type="number" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.star')" />
          <input v-model.number="adjustForm.evolutionStage" type="number" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.evolution')" />
          <input v-model="adjustForm.reason" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.reason')" />
          <button
            class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            @click="doAdjust"
          >
            {{ t('adminPets.actions.adjust') }}
          </button>
        </div>
        <div class="bg-gray-800 rounded p-3 space-y-2">
          <h3 class="font-semibold">{{ t('adminPets.actions.revoke') }}</h3>
          <input v-model="revokeForm.characterPetId" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" placeholder="characterPetId" />
          <input v-model="revokeForm.reason" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.reason')" />
          <button
            class="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-sm"
            @click="doRevoke"
          >
            {{ t('adminPets.actions.revoke') }}
          </button>
        </div>
        <div class="bg-gray-800 rounded p-3 space-y-2">
          <h3 class="font-semibold">{{ t('adminPets.actions.pityReset') }}</h3>
          <input v-model="pityResetForm.characterId" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.characterIdPlaceholder')" />
          <input v-model="pityResetForm.boxKey" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.boxKey')" />
          <input v-model="pityResetForm.poolKey" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.poolKey')" />
          <input v-model="pityResetForm.reason" class="w-full px-2 py-1 rounded bg-gray-700 text-sm" :placeholder="t('adminPets.form.reason')" />
          <button
            class="px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-sm"
            @click="doPityReset"
          >
            {{ t('adminPets.actions.pityReset') }}
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>
