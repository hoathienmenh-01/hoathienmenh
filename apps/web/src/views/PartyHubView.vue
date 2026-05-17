<script setup lang="ts">
/**
 * PartyHubView — `/party` player-facing party hub (PR #629).
 *
 * Hub-style view that shows the player's current party state and
 * surfaces entry points for Party Dungeon and Co-op Boss. Uses the
 * real `party.ts` / `partyDungeon.ts` / `coopBoss.ts` APIs.
 *
 * If the player is not in a party, shows an empty state with a
 * "Create Party" CTA. Does NOT rewrite the party system — just
 * surfaces what already exists.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { PARTY_LIMITS, type MyPartyResponse, type PartyDto, type PartyMemberDto } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  getMyParty,
  createParty,
  leaveParty,
} from '@/api/party';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const loading = ref(true);
const party = ref<PartyDto | null>(null);
const members = ref<PartyMemberDto[]>([]);
const submitting = ref(false);

async function fetchPartyState(): Promise<void> {
  try {
    const res: MyPartyResponse = await getMyParty();
    party.value = res.party;
    members.value = res.members;
  } catch {
    // No party or error — show empty state
    party.value = null;
    members.value = [];
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
  await fetchPartyState();
  loading.value = false;
});

async function onCreateParty(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const res = await createParty(null);
    party.value = res.party;
    members.value = res.members;
    toast.push({ type: 'success', text: t('party.createdToast', 'Party created!') });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    toast.push({ type: 'error', text: t(`party.errors.${code}`, 'Failed to create party') });
  } finally {
    submitting.value = false;
  }
}

async function onLeaveParty(): Promise<void> {
  if (submitting.value) return;
  if (!window.confirm(t('party.leaveConfirm', 'Leave party?'))) return;
  submitting.value = true;
  try {
    await leaveParty();
    party.value = null;
    members.value = [];
    toast.push({ type: 'system', text: t('party.leftToast', 'Left the party') });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    toast.push({ type: 'error', text: t(`party.errors.${code}`, 'Failed to leave') });
  } finally {
    submitting.value = false;
  }
}

function goToPartyDungeon(): void {
  router.push('/party/dungeon');
}

function goToCoopBoss(): void {
  router.push('/party/coop-boss');
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      eyebrow="TỔ ĐỘI"
      label="Tổ Đội"
      :title="t('party.title', 'Tổ Đội')"
      :subtitle="t('party.subtitle', 'Quản lý tổ đội & hoạt động nhóm')"
      tone="jade"
      watermark-letter="Đ"
      breadcrumb="Party"
      test-id="party-hub-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="TỔ ĐỘI" label="Party Hub" class="sr-only" />
      <template #meta>
        <XTGlyphBadge tone="jade" size="sm" glyph="👥">
          {{ members.length }} / {{ PARTY_LIMITS.maxMembers }}
        </XTGlyphBadge>
      </template>
    </XTLuxHero>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8 text-ink-400" data-testid="party-hub-loading">
      {{ t('common.loading', 'Loading...') }}
    </div>

    <!-- No party — empty state -->
    <section
      v-else-if="!party"
      class="text-center py-8 space-y-4"
      data-testid="party-hub-empty"
    >
      <p class="text-ink-300 text-lg">{{ t('party.noParty', 'Bạn chưa có tổ đội') }}</p>
      <MButton
        data-testid="party-create-btn"
        :disabled="submitting"
        @click="onCreateParty"
      >
        {{ t('party.createBtn', 'Tạo Tổ Đội') }}
      </MButton>
    </section>

    <!-- Party active -->
    <template v-else>
      <!-- Party Info -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4 space-y-3"
        data-testid="party-hub-info"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-base font-bold text-jade-200">
            {{ party.name ?? t('party.unnamed', 'Tổ Đội Không Tên') }}
          </h3>
          <span class="text-xs text-ink-400">ID: {{ party.id.slice(0, 8) }}...</span>
        </div>
        <p class="text-sm text-ink-300">
          {{ t('party.memberCount', 'Members') }}: {{ members.length }} / {{ party.maxMembers }}
        </p>
      </section>

      <!-- Members List -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4 space-y-2"
        data-testid="party-hub-members"
      >
        <h4 class="text-sm font-semibold text-ink-200 mb-2">
          {{ t('party.membersTitle', 'Thành Viên') }}
        </h4>
        <div
          v-for="m in members"
          :key="m.id"
          class="flex items-center gap-2 text-sm py-1 border-b border-ink-300/20 last:border-0"
        >
          <span
            :class="m.online ? 'text-emerald-400' : 'text-ink-500'"
            aria-hidden="true"
          >●</span>
          <span class="flex-1">{{ m.displayName ?? m.userId.slice(0, 8) }}</span>
          <span class="text-[10px] uppercase px-1.5 py-0.5 rounded bg-ink-700/60 text-ink-300">
            {{ m.role }}
          </span>
        </div>
      </section>

      <!-- Co-op Activities Hub -->
      <section class="space-y-3 mb-6" data-testid="party-hub-activities">
        <h4 class="text-sm font-semibold text-ink-200">
          {{ t('party.activitiesTitle', 'Hoạt Động Nhóm') }}
        </h4>
        <div class="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            class="rounded border border-ink-300/40 bg-ink-700/30 p-4 text-left hover:border-jade-400/60 transition-colors"
            data-testid="party-hub-dungeon-entry"
            @click="goToPartyDungeon"
          >
            <p class="font-bold text-ink-100">{{ t('party.dungeonEntry', 'Party Dungeon') }}</p>
            <p class="text-xs text-ink-400 mt-1">
              {{ t('party.dungeonDesc', 'Cùng tổ đội khám phá dungeon co-op PvE') }}
            </p>
          </button>
          <button
            type="button"
            class="rounded border border-ink-300/40 bg-ink-700/30 p-4 text-left hover:border-jade-400/60 transition-colors"
            data-testid="party-hub-coop-boss-entry"
            @click="goToCoopBoss"
          >
            <p class="font-bold text-ink-100">{{ t('party.coopBossEntry', 'Co-op Boss') }}</p>
            <p class="text-xs text-ink-400 mt-1">
              {{ t('party.coopBossDesc', 'Hợp lực đánh boss thế giới cùng tổ đội') }}
            </p>
          </button>
        </div>
      </section>

      <!-- Actions -->
      <section class="flex flex-wrap gap-3" data-testid="party-hub-actions">
        <MButton
          data-testid="party-leave-btn"
          :disabled="submitting"
          @click="onLeaveParty"
        >
          {{ t('party.leaveBtn', 'Rời Tổ Đội') }}
        </MButton>
      </section>
    </template>
  </AppShell>
</template>
