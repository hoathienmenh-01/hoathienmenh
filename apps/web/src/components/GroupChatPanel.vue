<script setup lang="ts">
/**
 * Phase 19.1 — Group chat panel.
 *
 * Render:
 *   - List groups caller đang là member.
 *   - Form tạo group mới (owner = caller; tự động là member).
 *   - Group đang select: list message + member list + form gửi.
 *   - Owner: add/remove member (cap GROUP_MEMBER_MAX).
 *
 * Server-authoritative invariants enforce (ChatGroupService):
 *   - Non-member → 404 mask cả khi GET/POST messages.
 *   - Block 2 chiều → reject BLOCKED khi add member.
 *   - GROUP_MEMBER_MAX = 30.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  addGroupMember,
  createGroup,
  listGroupMessages,
  listGroups,
  removeGroupMember,
  sendGroupMessage,
} from '@/api/chatGroup';
import type {
  GroupChatMemberRow,
  GroupChatMessageRow,
  GroupChatRow,
} from '@xuantoi/shared';
import { SOCIAL_LIMITS } from '@xuantoi/shared';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import ChatReportModal from './ChatReportModal.vue';
import PublicPlayerProfileModal from './PublicPlayerProfileModal.vue';

const { t } = useI18n();
const toast = useToastStore();

const groups = ref<GroupChatRow[]>([]);
const messagesByGroup = ref<Record<string, GroupChatMessageRow[]>>({});
const membersByGroup = ref<Record<string, GroupChatMemberRow[]>>({});
const activeGroupId = ref<string | null>(null);

const loadingGroups = ref(true);
const loadingMessages = ref(false);
const error = ref<string>('');

const createName = ref('');
const creating = ref(false);

const addUserId = ref('');
const addingMember = ref(false);

const draft = ref('');
const sending = ref(false);

const busyMemberUserId = ref<string | null>(null);

// Phase 19.2 — report modal state cho group message.
const reportTargetId = ref<string | null>(null);
const reportPreview = ref<string | null>(null);
const reportOpen = computed(() => reportTargetId.value !== null);

function openReport(msg: GroupChatMessageRow): void {
  reportTargetId.value = msg.id;
  reportPreview.value = msg.isHidden ? null : msg.body;
}

function closeReport(): void {
  reportTargetId.value = null;
  reportPreview.value = null;
}

// Phase 19.1.C — public profile modal state. `profileTargetId` =
// userId target khi viewer click vào tên member hoặc author message.
const profileTargetId = ref<string | null>(null);
const profileOpen = computed(() => profileTargetId.value !== null);

function openProfile(userId: string): void {
  profileTargetId.value = userId;
}

function closeProfile(): void {
  profileTargetId.value = null;
}

async function onProfileChanged(): Promise<void> {
  // Block/unblock từ modal có thể ảnh hưởng member visibility (BLOCKED
  // reject sendGroupMessage). Refresh active group state.
  const id = activeGroupId.value;
  if (id) await loadGroup(id);
}

const activeGroup = computed<GroupChatRow | null>(() =>
  activeGroupId.value
    ? groups.value.find((g) => g.id === activeGroupId.value) ?? null
    : null,
);

const activeMessages = computed<GroupChatMessageRow[]>(() => {
  const id = activeGroupId.value;
  if (!id) return [];
  return messagesByGroup.value[id] ?? [];
});

const activeMembers = computed<GroupChatMemberRow[]>(() => {
  const id = activeGroupId.value;
  if (!id) return [];
  return membersByGroup.value[id] ?? [];
});

const draftLength = computed(() => draft.value.trim().length);
const draftOverLimit = computed(
  () => draftLength.value > SOCIAL_LIMITS.GROUP_MESSAGE_MAX,
);
const canSend = computed(
  () =>
    !!activeGroupId.value &&
    !sending.value &&
    draftLength.value > 0 &&
    !draftOverLimit.value,
);

defineExpose({ refresh: refreshGroups });

onMounted(refreshGroups);

watch(activeGroupId, (id) => {
  if (id) void loadGroup(id);
});

function tShortError(code: string): string {
  const key = `chatGroup.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__' ? t('chatGroup.errors.UNKNOWN') : v;
}

async function refreshGroups(): Promise<void> {
  loadingGroups.value = true;
  error.value = '';
  try {
    const res = await listGroups();
    groups.value = [...res.groups];
    if (
      activeGroupId.value &&
      !groups.value.some((g) => g.id === activeGroupId.value)
    ) {
      activeGroupId.value = null;
    }
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingGroups.value = false;
  }
}

async function loadGroup(id: string): Promise<void> {
  loadingMessages.value = true;
  try {
    const res = await listGroupMessages(id, 50);
    // Server trả messages desc theo createdAt → đảo asc cho UI.
    messagesByGroup.value[id] = [...res.messages].reverse();
    membersByGroup.value[id] = [...res.members];
    await nextTick();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    loadingMessages.value = false;
  }
}

async function onCreate(): Promise<void> {
  const name = createName.value.trim();
  if (!name) return;
  creating.value = true;
  try {
    const g = await createGroup(name);
    groups.value = [g, ...groups.value];
    activeGroupId.value = g.id;
    createName.value = '';
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    creating.value = false;
  }
}

async function onAddMember(): Promise<void> {
  const id = activeGroupId.value;
  if (!id) return;
  const uid = addUserId.value.trim();
  if (!uid) return;
  addingMember.value = true;
  try {
    const m = await addGroupMember(id, uid);
    const arr = membersByGroup.value[id] ?? [];
    membersByGroup.value[id] = [...arr, m];
    // bump memberCount snapshot
    groups.value = groups.value.map((g) =>
      g.id === id ? { ...g, memberCount: g.memberCount + 1 } : g,
    );
    addUserId.value = '';
    toast.push({ type: 'success', text: t('chatGroup.toast.memberAdded') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    addingMember.value = false;
  }
}

async function onRemoveMember(member: GroupChatMemberRow): Promise<void> {
  const id = activeGroupId.value;
  if (!id) return;
  busyMemberUserId.value = member.userId;
  try {
    await removeGroupMember(id, member.userId);
    const arr = membersByGroup.value[id] ?? [];
    membersByGroup.value[id] = arr.filter((m) => m.userId !== member.userId);
    groups.value = groups.value.map((g) =>
      g.id === id
        ? { ...g, memberCount: Math.max(0, g.memberCount - 1) }
        : g,
    );
    toast.push({ type: 'success', text: t('chatGroup.toast.memberRemoved') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    busyMemberUserId.value = null;
  }
}

async function onSend(): Promise<void> {
  const id = activeGroupId.value;
  if (!id) return;
  const body = draft.value.trim();
  if (!body || draftOverLimit.value) return;
  sending.value = true;
  try {
    const msg = await sendGroupMessage(id, body);
    const arr = messagesByGroup.value[id] ?? [];
    messagesByGroup.value[id] = [...arr, msg];
    draft.value = '';
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    sending.value = false;
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <section
    class="border border-ink-300/40 rounded grid md:grid-cols-[240px_1fr] gap-0"
    data-testid="group-chat-panel"
  >
    <aside class="border-r border-ink-300/30 flex flex-col">
      <div
        class="px-3 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
      >
        {{ t('chatGroup.groups.header') }}
      </div>
      <form
        class="p-2 flex flex-col gap-1"
        data-testid="group-chat-create-form"
        @submit.prevent="onCreate"
      >
        <input
          v-model="createName"
          type="text"
          :maxlength="SOCIAL_LIMITS.GROUP_NAME_MAX + 10"
          class="w-full rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
          :placeholder="t('chatGroup.groups.createPlaceholder')"
          data-testid="group-chat-create-name"
        />
        <button
          type="submit"
          class="rounded border border-amber-400/60 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          :disabled="creating || createName.trim().length < SOCIAL_LIMITS.GROUP_NAME_MIN"
          data-testid="group-chat-create-submit"
        >
          {{ t('chatGroup.groups.createSubmit') }}
        </button>
      </form>
      <div v-if="loadingGroups" class="p-2 text-xs text-ink-300" data-testid="group-chat-groups-loading">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="error" class="p-2 text-xs text-rose-300" data-testid="group-chat-groups-error">
        {{ tShortError(error) }}
      </div>
      <div
        v-else-if="groups.length === 0"
        class="p-2 text-xs text-ink-300/70"
        data-testid="group-chat-groups-empty"
      >
        {{ t('chatGroup.groups.empty') }}
      </div>
      <ul v-else class="divide-y divide-ink-300/20" data-testid="group-chat-groups-list">
        <li
          v-for="g in groups"
          :key="g.id"
          class="px-3 py-2 cursor-pointer text-xs hover:bg-ink-300/10"
          :class="g.id === activeGroupId ? 'bg-ink-300/15' : ''"
          data-testid="group-chat-group-row"
          @click="activeGroupId = g.id"
        >
          <div class="truncate font-medium">{{ g.name }}</div>
          <div class="text-[10px] text-ink-300/60">
            {{ t('chatGroup.groups.memberCount', { n: g.memberCount }) }}
          </div>
        </li>
      </ul>
    </aside>

    <div class="flex flex-col min-h-[300px]">
      <div
        v-if="!activeGroup"
        class="flex-1 flex items-center justify-center text-sm text-ink-300/70"
        data-testid="group-chat-none"
      >
        {{ t('chatGroup.group.none') }}
      </div>
      <template v-else>
        <div class="px-3 py-2 border-b border-ink-300/30 text-sm">
          <div class="font-medium">{{ activeGroup.name }}</div>
          <div class="text-[10px] text-ink-300/60">
            {{ t('chatGroup.groups.memberCount', { n: activeGroup.memberCount }) }}
            · {{ t('chatGroup.group.owner', { id: activeGroup.ownerUserId }) }}
          </div>
        </div>

        <div class="grid md:grid-cols-[1fr_180px]">
          <div class="flex flex-col">
            <div
              class="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-sm min-h-[200px]"
              data-testid="group-chat-messages"
            >
              <div
                v-if="loadingMessages"
                class="text-xs text-ink-300"
                data-testid="group-chat-messages-loading"
              >
                {{ t('common.loading') }}
              </div>
              <div
                v-else-if="activeMessages.length === 0"
                class="text-xs text-ink-300/70"
                data-testid="group-chat-messages-empty"
              >
                {{ t('chatGroup.group.empty') }}
              </div>
              <div
                v-for="msg in activeMessages"
                v-else
                :key="msg.id"
                class="flex flex-col group"
                data-testid="group-chat-message-row"
              >
                <div class="text-[10px] text-ink-300/60 flex items-center gap-2">
                  <button
                    type="button"
                    class="hover:underline focus:underline outline-none"
                    :title="t('publicProfile.viewProfile')"
                    data-testid="group-chat-message-author"
                    @click="openProfile(msg.senderUserId)"
                  >{{ msg.senderDisplayName ?? msg.senderUserId }}</button>
                  <span>· {{ fmtTime(msg.createdAt) }}</span>
                  <button
                    type="button"
                    class="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] uppercase tracking-widest text-rose-300 hover:text-rose-200"
                    data-testid="group-chat-report-btn"
                    :title="t('chatReport.action.report')"
                    @click="openReport(msg)"
                  >
                    {{ t('chatReport.action.report') }}
                  </button>
                </div>
                <div
                  v-if="msg.isHidden"
                  class="break-words whitespace-pre-wrap italic text-ink-300/70"
                  data-testid="group-chat-message-hidden"
                >
                  {{ t('chatModeration.hiddenMessage') }}
                </div>
                <div
                  v-else
                  class="break-words whitespace-pre-wrap"
                >{{ msg.body }}</div>
              </div>
            </div>
            <form
              class="border-t border-ink-300/30 p-2 flex gap-2"
              data-testid="group-chat-send-form"
              @submit.prevent="onSend"
            >
              <input
                v-model="draft"
                type="text"
                :maxlength="SOCIAL_LIMITS.GROUP_MESSAGE_MAX + 50"
                class="flex-1 rounded border border-ink-300/40 bg-ink-800/60 px-3 py-2 text-sm"
                :placeholder="t('chatGroup.group.placeholder')"
                data-testid="group-chat-send-body"
              />
              <button
                type="submit"
                class="rounded border border-amber-400/60 px-4 py-2 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                :disabled="!canSend"
                data-testid="group-chat-send-submit"
              >
                {{ t('chatGroup.group.send') }}
              </button>
            </form>
          </div>

          <aside class="border-l border-ink-300/30">
            <div
              class="px-3 py-2 text-[10px] uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
            >
              {{ t('chatGroup.members.header') }}
            </div>
            <ul class="divide-y divide-ink-300/20" data-testid="group-chat-members-list">
              <li
                v-for="m in activeMembers"
                :key="m.id"
                class="px-3 py-2 text-xs flex items-center justify-between"
                data-testid="group-chat-member-row"
              >
                <div class="min-w-0">
                  <button
                    type="button"
                    class="truncate text-left hover:underline focus:underline outline-none"
                    :title="t('publicProfile.viewProfile')"
                    data-testid="group-chat-member-name"
                    @click="openProfile(m.userId)"
                  >{{ m.displayName ?? m.userId }}</button>
                  <div
                    v-if="m.userId === activeGroup.ownerUserId"
                    class="text-[10px] text-amber-300"
                  >
                    {{ t('chatGroup.members.owner') }}
                  </div>
                </div>
                <button
                  v-if="
                    activeGroup.ownerUserId !== m.userId
                  "
                  type="button"
                  class="rounded border border-ink-300/40 px-2 py-1 text-[10px] hover:bg-ink-300/10 disabled:opacity-50"
                  :disabled="busyMemberUserId === m.userId"
                  data-testid="group-chat-member-remove"
                  @click="onRemoveMember(m)"
                >
                  {{ t('chatGroup.members.remove') }}
                </button>
              </li>
            </ul>
            <form
              class="p-2 border-t border-ink-300/30 flex flex-col gap-1"
              data-testid="group-chat-add-form"
              @submit.prevent="onAddMember"
            >
              <input
                v-model="addUserId"
                type="text"
                maxlength="64"
                class="w-full rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
                :placeholder="t('chatGroup.members.addPlaceholder')"
                data-testid="group-chat-add-userId"
              />
              <button
                type="submit"
                class="rounded border border-amber-400/60 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                :disabled="addingMember || !addUserId.trim()"
                data-testid="group-chat-add-submit"
              >
                {{ t('chatGroup.members.addSubmit') }}
              </button>
            </form>
          </aside>
        </div>
      </template>
    </div>

    <ChatReportModal
      :open="reportOpen"
      message-type="GROUP"
      :group-message-id="reportTargetId"
      :message-preview="reportPreview"
      @submitted="closeReport"
      @cancel="closeReport"
    />

    <PublicPlayerProfileModal
      :open="profileOpen"
      :user-id="profileTargetId"
      @close="closeProfile"
      @changed="onProfileChanged"
    />
  </section>
</template>
