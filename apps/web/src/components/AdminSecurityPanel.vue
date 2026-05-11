<script setup lang="ts">
/**
 * Phase 18.1 — Admin Security & Abuse panel.
 *
 * Cho admin xem:
 *   - Active temporary blocks (IP/USER) + nút "Lift" (kèm confirm modal).
 *   - Recent security events (RATE_LIMIT_VIOLATION, LOGIN_FAILED, BLOCK_LIFTED, ...)
 *     với filter severity/type/limit.
 *
 * Privacy: chỉ render `ipHash`/`subjectHash` (sha256 hex 64 ký tự), KHÔNG
 * raw IP. BE hash bằng `SECURITY_IP_HASH_SALT` env, FE chỉ hiển thị
 * prefix 12 ký tự + tooltip full để tránh leak khi screenshot.
 *
 * Loading/empty/error UI riêng cho từng section để admin biết section nào
 * lỗi mà không che mất toàn bộ panel. i18n parity qua `adminSecurity.*`.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  adminLiftSecurityBlock,
  adminListSecurityBlocks,
  adminListSecurityEvents,
  type AdminSecurityBlockRow,
  type AdminSecurityEventRow,
  type SecurityBlockType,
  type SecurityEventSeverity,
} from '@/api/adminSecurity';

const { t } = useI18n();
const toast = useToastStore();

const blocks = ref<AdminSecurityBlockRow[]>([]);
const blocksLoading = ref(true);
const blocksError = ref<string | null>(null);

const events = ref<AdminSecurityEventRow[]>([]);
const eventsLoading = ref(true);
const eventsError = ref<string | null>(null);

const filterBlockType = ref<SecurityBlockType | 'ALL'>('ALL');
const filterSeverity = ref<SecurityEventSeverity | 'ALL'>('ALL');
const filterEventType = ref<string>('');
const filterLimit = ref(50);

const pendingLift = ref<AdminSecurityBlockRow | null>(null);
const liftingId = ref<string | null>(null);

async function refreshBlocks(): Promise<void> {
  blocksLoading.value = true;
  blocksError.value = null;
  try {
    blocks.value = await adminListSecurityBlocks({
      type: filterBlockType.value === 'ALL' ? undefined : filterBlockType.value,
      limit: filterLimit.value,
    });
  } catch (e) {
    blocksError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    blocksLoading.value = false;
  }
}

async function refreshEvents(): Promise<void> {
  eventsLoading.value = true;
  eventsError.value = null;
  try {
    events.value = await adminListSecurityEvents({
      severity:
        filterSeverity.value === 'ALL' ? undefined : filterSeverity.value,
      type: filterEventType.value.trim() || undefined,
      limit: filterLimit.value,
    });
  } catch (e) {
    eventsError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    eventsLoading.value = false;
  }
}

async function applyFilters(): Promise<void> {
  await Promise.all([refreshBlocks(), refreshEvents()]);
}

function openLiftConfirm(block: AdminSecurityBlockRow): void {
  pendingLift.value = block;
}

async function doLift(): Promise<void> {
  const block = pendingLift.value;
  if (!block) return;
  liftingId.value = block.id;
  try {
    await adminLiftSecurityBlock(block.id);
    blocks.value = blocks.value.filter((b) => b.id !== block.id);
    toast.push({
      type: 'success',
      text: t('adminSecurity.blocks.liftSuccess', { id: block.id }),
    });
    // Refresh events: liftBlock tạo SecurityEvent BLOCK_LIFTED.
    void refreshEvents();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminSecurity.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminSecurity.errors.UNKNOWN')
          : t(`adminSecurity.errors.${code}`),
    });
  } finally {
    liftingId.value = null;
    pendingLift.value = null;
  }
}

function fmtHash(h: string | null | undefined): string {
  if (!h) return '—';
  return h.length > 12 ? `${h.slice(0, 12)}…` : h;
}

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const blocksErrorText = computed(() =>
  blocksError.value
    ? t(`adminSecurity.errors.${blocksError.value}`, '__missing__') !==
      '__missing__'
      ? t(`adminSecurity.errors.${blocksError.value}`)
      : t('adminSecurity.errors.UNKNOWN')
    : '',
);

const eventsErrorText = computed(() =>
  eventsError.value
    ? t(`adminSecurity.errors.${eventsError.value}`, '__missing__') !==
      '__missing__'
      ? t(`adminSecurity.errors.${eventsError.value}`)
      : t('adminSecurity.errors.UNKNOWN')
    : '',
);

onMounted(() => {
  void refreshBlocks();
  void refreshEvents();
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-security-panel">
    <header class="space-y-1">
      <h2 class="text-lg text-amber-200">{{ t('adminSecurity.title') }}</h2>
      <p class="text-xs text-ink-300">{{ t('adminSecurity.subtitle') }}</p>
    </header>

    <!-- FILTERS -->
    <section
      class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm flex flex-wrap items-end gap-3"
      data-testid="admin-security-filters"
    >
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurity.filters.type')
        }}</span>
        <select
          v-model="filterBlockType"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-block-type"
        >
          <option value="ALL">
            {{ t('adminSecurity.filters.typeAll') }}
          </option>
          <option value="IP">{{ t('adminSecurity.filters.typeIp') }}</option>
          <option value="USER">{{ t('adminSecurity.filters.typeUser') }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurity.filters.severity')
        }}</span>
        <select
          v-model="filterSeverity"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-severity"
        >
          <option value="ALL">
            {{ t('adminSecurity.filters.severityAll') }}
          </option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurity.filters.eventType')
        }}</span>
        <input
          v-model="filterEventType"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          placeholder="RATE_LIMIT_VIOLATION"
          data-testid="filter-event-type"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurity.filters.limit')
        }}</span>
        <input
          v-model.number="filterLimit"
          type="number"
          min="1"
          max="200"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 w-24"
          data-testid="filter-limit"
        />
      </label>
      <MButton
        data-testid="filter-apply"
        :disabled="blocksLoading || eventsLoading"
        @click="applyFilters"
      >
        {{ t('adminSecurity.filters.apply') }}
      </MButton>
    </section>

    <!-- BLOCKS SECTION -->
    <section
      class="space-y-2"
      data-testid="admin-security-blocks-section"
    >
      <h3 class="text-base text-amber-200">
        {{ t('adminSecurity.sections.blocks') }}
      </h3>
      <div
        v-if="blocksLoading"
        class="text-xs text-ink-300"
        data-testid="blocks-loading"
      >
        {{ t('adminSecurity.blocks.loading') }}
      </div>
      <div
        v-else-if="blocksError"
        class="text-xs text-rose-300"
        data-testid="blocks-error"
      >
        {{ blocksErrorText }}
      </div>
      <div
        v-else-if="blocks.length === 0"
        class="text-xs text-ink-300"
        data-testid="blocks-empty"
      >
        {{ t('adminSecurity.blocks.empty') }}
      </div>
      <table
        v-else
        class="w-full text-xs bg-ink-700/20 border border-ink-300/20 rounded"
      >
        <thead class="text-ink-300">
          <tr>
            <th class="text-left p-2">{{ t('adminSecurity.blocks.type') }}</th>
            <th class="text-left p-2">
              {{ t('adminSecurity.blocks.subjectHash') }}
            </th>
            <th class="text-left p-2">{{ t('adminSecurity.blocks.reason') }}</th>
            <th class="text-left p-2">
              {{ t('adminSecurity.blocks.createdAt') }}
            </th>
            <th class="text-left p-2">
              {{ t('adminSecurity.blocks.expiresAt') }}
            </th>
            <th class="text-left p-2">{{ t('adminSecurity.blocks.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in blocks"
            :key="b.id"
            class="border-t border-ink-300/20"
            data-testid="block-row"
          >
            <td class="p-2 text-amber-200">{{ b.type }}</td>
            <td class="p-2 font-mono" :title="b.subjectHash">
              {{ fmtHash(b.subjectHash) }}
            </td>
            <td class="p-2">{{ b.reason }}</td>
            <td class="p-2 text-ink-300">{{ fmtDate(b.createdAt) }}</td>
            <td class="p-2 text-ink-300">{{ fmtDate(b.expiresAt) }}</td>
            <td class="p-2">
              <MButton
                :disabled="liftingId === b.id"
                data-testid="block-lift-btn"
                @click="openLiftConfirm(b)"
              >
                {{
                  liftingId === b.id
                    ? t('adminSecurity.blocks.lifting')
                    : t('adminSecurity.blocks.lift')
                }}
              </MButton>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- EVENTS SECTION -->
    <section
      class="space-y-2"
      data-testid="admin-security-events-section"
    >
      <h3 class="text-base text-amber-200">
        {{ t('adminSecurity.sections.events') }}
      </h3>
      <div
        v-if="eventsLoading"
        class="text-xs text-ink-300"
        data-testid="events-loading"
      >
        {{ t('adminSecurity.events.loading') }}
      </div>
      <div
        v-else-if="eventsError"
        class="text-xs text-rose-300"
        data-testid="events-error"
      >
        {{ eventsErrorText }}
      </div>
      <div
        v-else-if="events.length === 0"
        class="text-xs text-ink-300"
        data-testid="events-empty"
      >
        {{ t('adminSecurity.events.empty') }}
      </div>
      <table
        v-else
        class="w-full text-xs bg-ink-700/20 border border-ink-300/20 rounded"
      >
        <thead class="text-ink-300">
          <tr>
            <th class="text-left p-2">{{ t('adminSecurity.events.type') }}</th>
            <th class="text-left p-2">
              {{ t('adminSecurity.events.severity') }}
            </th>
            <th class="text-left p-2">{{ t('adminSecurity.events.policy') }}</th>
            <th class="text-left p-2">{{ t('adminSecurity.events.ipHash') }}</th>
            <th class="text-left p-2">{{ t('adminSecurity.events.userId') }}</th>
            <th class="text-left p-2">
              {{ t('adminSecurity.events.createdAt') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in events"
            :key="e.id"
            class="border-t border-ink-300/20"
            data-testid="event-row"
          >
            <td class="p-2 text-amber-200">{{ e.type }}</td>
            <td
              class="p-2"
              :class="{
                'text-rose-300': e.severity === 'CRITICAL',
                'text-amber-300': e.severity === 'WARN',
              }"
            >
              {{ e.severity }}
            </td>
            <td class="p-2">{{ e.policy ?? '—' }}</td>
            <td class="p-2 font-mono" :title="e.ipHash ?? ''">
              {{ fmtHash(e.ipHash) }}
            </td>
            <td class="p-2 font-mono">{{ e.userId ?? '—' }}</td>
            <td class="p-2 text-ink-300">{{ fmtDate(e.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ConfirmModal
      :open="pendingLift !== null"
      :title="t('adminSecurity.blocks.confirmLiftTitle')"
      :message="
        pendingLift
          ? t('adminSecurity.blocks.confirmLiftBody', { type: pendingLift.type })
          : ''
      "
      :loading="liftingId !== null"
      danger
      test-id="lift-confirm-modal"
      @cancel="pendingLift = null"
      @confirm="doLift"
    />
  </div>
</template>
