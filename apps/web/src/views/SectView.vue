<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { realmByKey, fullRealmName } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  contributeSect,
  createSect,
  joinSect,
  leaveSect,
  listSects,
  mySect,
  type SectDetailView,
  type SectListView,
} from '@/api/sect';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const tab = ref<'mine' | 'all' | 'create'>('mine');
const submitting = ref(false);
const sects = ref<SectListView[]>([]);
const me = ref<SectDetailView | null>(null);

// Form tạo
const newName = ref('');
const newDesc = ref('');

// Form đóng góp
const contribAmount = ref('100');

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refreshAll();
});

async function refreshAll(): Promise<void> {
  try {
    const [s, m] = await Promise.all([listSects(), mySect()]);
    sects.value = s;
    me.value = m;
    if (!m) tab.value = 'all';
  } catch (e) {
    handleErr(e);
  }
}

async function onJoin(s: SectListView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    me.value = await joinSect(s.id);
    toast.push({ type: 'success', text: t('sect.joinToast', { name: s.name }) });
    tab.value = 'mine';
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onLeave(): Promise<void> {
  if (submitting.value || !me.value) return;
  if (!confirm(t('sect.leaveConfirm', { name: me.value.name }))) return;
  submitting.value = true;
  try {
    await leaveSect();
    toast.push({ type: 'system', text: t('sect.leaveToast') });
    me.value = null;
    tab.value = 'all';
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onCreate(): Promise<void> {
  if (submitting.value) return;
  if (!/^[\p{L}\p{N} _-]{2,16}$/u.test(newName.value)) {
    toast.push({ type: 'error', text: t('sect.invalidNameToast') });
    return;
  }
  submitting.value = true;
  try {
    me.value = await createSect(newName.value, newDesc.value);
    toast.push({ type: 'success', text: t('sect.createToast') });
    newName.value = '';
    newDesc.value = '';
    tab.value = 'mine';
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onContribute(): Promise<void> {
  if (submitting.value || !me.value) return;
  submitting.value = true;
  try {
    me.value = await contributeSect(contribAmount.value);
    toast.push({ type: 'success', text: t('sect.contributeToast') });
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

function realmText(key: string, stage: number): string {
  const r = realmByKey(key);
  if (!r) return key;
  return fullRealmName(r, stage);
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`sect.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('sect.errors.UNKNOWN') : text,
  });
}

const myStash = computed(() => game.character?.linhThach ?? '0');
</script>

<template>
  <AppShell>
    <XTPageEyebrow label="Tông Môn Điện" />
    <h2 class="text-xl tracking-widest mb-4 mt-1">{{ t('sect.title') }}</h2>

    <!-- Phase 13.1.B — Sect War CTA. -->
    <section
      class="mb-4 rounded border border-amber-300/30 bg-ink-700/30 p-3 flex items-center justify-between gap-3"
      data-test="sect-war-cta"
    >
      <div class="min-w-0">
        <div class="text-sm text-amber-200">{{ t('sectCta.warTitle') }}</div>
        <div class="text-xs text-ink-300/80 truncate">{{ t('sectCta.warDesc') }}</div>
      </div>
      <MButton @click="router.push('/sect-war')">{{ t('sectCta.warBtn') }}</MButton>
    </section>

    <div class="flex gap-2 mb-4">
      <MButton
        :class="tab === 'mine' ? '!bg-ink-50 !text-ink-900' : ''"
        :disabled="!me"
        @click="tab = 'mine'"
      >
        {{ t('sect.tab.mine') }}
      </MButton>
      <MButton
        :class="tab === 'all' ? '!bg-ink-50 !text-ink-900' : ''"
        @click="tab = 'all'"
      >
        {{ t('sect.tab.all') }}
      </MButton>
      <MButton
        :class="tab === 'create' ? '!bg-ink-50 !text-ink-900' : ''"
        :disabled="!!me"
        @click="tab = 'create'"
      >
        {{ t('sect.tab.create') }}
      </MButton>
      <span class="ml-auto text-xs text-ink-300 self-center">
        {{ t('sect.myStash', { n: myStash }) }}
      </span>
    </div>

    <!-- TÔNG CỦA TÔI -->
    <section v-if="tab === 'mine' && me" class="space-y-4">
      <div class="border border-ink-300/40 rounded p-4 bg-ink-700/30">
        <div class="flex items-start gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <div class="text-lg text-ink-50">{{ me.name }}</div>
            <div class="text-xs text-ink-300">
              {{ t('sect.level', { lv: me.level }) }} · {{ t('sect.members', { n: me.memberCount }) }}
              <span v-if="me.leaderName"> · {{ t('sect.leader', { name: me.leaderName }) }}</span>
            </div>
            <p v-if="me.description" class="text-sm text-ink-200 mt-2 whitespace-pre-line">
              {{ me.description }}
            </p>
          </div>
          <div class="text-xs text-right">
            <div class="text-ink-300">{{ t('sect.treasury') }}</div>
            <div class="text-amber-300 text-base">⛀ {{ me.treasuryLinhThach }}</div>
          </div>
        </div>
        <div class="mt-3 flex gap-2 items-end">
          <div class="flex-1">
            <label class="block text-xs text-ink-300 mb-1">
              {{ t('sect.contribLabel') }}
            </label>
            <input
              v-model="contribAmount"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              class="w-40 bg-ink-900/70 border border-ink-300/30 rounded px-2 py-1 text-sm"
            />
            <span class="text-xs text-ink-300 ml-2">{{ t('sect.contribHint', { n: contribAmount }) }}</span>
          </div>
          <MButton :loading="submitting" @click="onContribute">{{ t('sect.contribute') }}</MButton>
          <MButton
            class="!bg-red-900/40 !border-red-400/40"
            :loading="submitting"
            @click="onLeave"
          >
            {{ t('sect.leave') }}
          </MButton>
        </div>
      </div>

      <div class="border border-ink-300/40 rounded">
        <div class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30">
          {{ t('sect.disciplesTitle', { n: me.members.length }) }}
        </div>
        <table class="w-full text-sm">
          <thead class="text-xs text-ink-300/70">
            <tr>
              <th class="text-left px-3 py-1">{{ t('sect.col.name') }}</th>
              <th class="text-left px-3 py-1">{{ t('sect.col.realm') }}</th>
              <th class="text-right px-3 py-1">{{ t('sect.col.contrib') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in me.members"
              :key="m.id"
              :class="m.isMe ? 'bg-ink-700/30' : ''"
            >
              <td class="px-3 py-1">
                <span :class="m.isLeader ? 'text-amber-300 font-bold' : ''">
                  {{ m.name }}
                </span>
                <span v-if="m.isLeader" class="ml-1 text-xs text-amber-300/70">{{ t('sect.leaderTag') }}</span>
                <span v-if="m.isMe" class="ml-1 text-xs text-ink-300/70">{{ t('sect.you') }}</span>
              </td>
              <td class="px-3 py-1 text-ink-300">{{ realmText(m.realmKey, m.realmStage) }}</td>
              <td class="px-3 py-1 text-right text-amber-300">{{ m.congHien }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- DANH SÁCH -->
    <section v-else-if="tab === 'all'">
      <div v-if="sects.length === 0" class="text-ink-300 text-sm">
        {{ t('sect.noneList') }}
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="s in sects"
          :key="s.id"
          class="border border-ink-300/40 rounded p-3 bg-ink-700/20"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-base text-ink-50">{{ s.name }}</div>
              <div class="text-xs text-ink-300">
                {{ t('sect.level', { lv: s.level }) }} · {{ t('sect.disciples', { n: s.memberCount }) }}
                <span v-if="s.leaderName"> · {{ t('sect.leader', { name: s.leaderName }) }}</span>
              </div>
              <p v-if="s.description" class="text-xs text-ink-200/80 mt-1 line-clamp-2">
                {{ s.description }}
              </p>
            </div>
            <div class="text-right text-xs">
              <div class="text-ink-300">{{ t('sect.treasury') }}</div>
              <div class="text-amber-300">⛀ {{ s.treasuryLinhThach }}</div>
            </div>
          </div>
          <div class="mt-2 flex justify-end">
            <MButton
              :disabled="!!me || submitting"
              :title="me ? t('sect.alreadyInOther') : ''"
              @click="onJoin(s)"
            >
              {{ t('sect.join') }}
            </MButton>
          </div>
        </div>
      </div>
    </section>

    <!-- LẬP TÔNG -->
    <section v-else-if="tab === 'create'">
      <div v-if="me" class="text-ink-300 text-sm">
        {{ t('sect.inOtherSect', { name: me.name }) }}
      </div>
      <form v-else class="max-w-lg space-y-3" @submit.prevent="onCreate">
        <div>
          <label class="block text-xs text-ink-300 mb-1">{{ t('sect.form.name') }}</label>
          <input
            v-model="newName"
            type="text"
            maxlength="16"
            class="w-full bg-ink-900/70 border border-ink-300/30 rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label class="block text-xs text-ink-300 mb-1">{{ t('sect.form.desc') }}</label>
          <textarea
            v-model="newDesc"
            maxlength="200"
            rows="3"
            class="w-full bg-ink-900/70 border border-ink-300/30 rounded px-2 py-1 text-sm"
          />
        </div>
        <MButton type="submit" :loading="submitting">{{ t('sect.create') }}</MButton>
      </form>
    </section>
  </AppShell>
</template>
