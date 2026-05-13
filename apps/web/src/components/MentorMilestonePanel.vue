<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  claimMentorMilestone,
  listMentorMilestones,
  type MentorMilestoneListResponse,
  type MentorMilestoneProgressRow,
} from '@/api/mentor';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const toast = useToastStore();
const { t, locale } = useI18n();

const data = ref<MentorMilestoneListResponse | null>(null);
const loading = ref(false);
const claimingKey = ref<string | null>(null);
const error = ref<string | null>(null);

const isVi = computed(() => locale.value === 'vi');

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await listMentorMilestones();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
  } finally {
    loading.value = false;
  }
}

function titleOf(p: MentorMilestoneProgressRow): string {
  return isVi.value ? p.titleVi : p.titleEn;
}

async function onClaim(milestoneKey: string): Promise<void> {
  if (claimingKey.value) return;
  claimingKey.value = milestoneKey;
  try {
    const r = await claimMentorMilestone(milestoneKey);
    toast.push({
      type: 'success',
      text: t('mentorMilestone.toast.claimed', {
        amount: r.rewardLinhThach,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`mentorMilestone.error.${code}`, code),
    });
  } finally {
    claimingKey.value = null;
  }
}

const hasAnyRelation = computed(() => {
  if (!data.value) return false;
  return data.value.asMentor.length > 0 || !!data.value.asDisciple;
});
</script>

<template>
  <section class="mentor-milestone-panel" data-testid="mentor-milestone-panel">
    <header>
      <h2>{{ t('mentorMilestone.title') }}</h2>
      <p class="muted">{{ t('mentorMilestone.subtitle') }}</p>
    </header>

    <div v-if="loading" class="state-loading" data-testid="milestone-loading">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="error" class="state-error" data-testid="milestone-error">
      {{ t(`mentorMilestone.error.${error}`, error ?? 'UNKNOWN') }}
      <MButton size="sm" @click="refresh">{{ t('common.retry') }}</MButton>
    </div>

    <div
      v-else-if="!hasAnyRelation"
      class="state-empty"
      data-testid="milestone-empty"
    >
      {{ t('mentorMilestone.empty') }}
    </div>

    <div v-else class="milestone-content">
      <!-- Mentor view: list of disciples + their progress -->
      <article
        v-for="r in data?.asMentor ?? []"
        :key="`mentor-${r.relationId}`"
        class="relation-card"
        data-testid="milestone-mentor-card"
      >
        <h3>
          {{
            t('mentorMilestone.mentorView.heading', {
              name: r.studentDisplayName ?? r.studentUserId,
            })
          }}
        </h3>
        <p class="muted">
          {{
            t('mentorMilestone.mentorView.realm', {
              order: r.studentRealmOrder,
            })
          }}
        </p>
        <ul class="milestone-list">
          <li
            v-for="p in r.progress"
            :key="`${r.relationId}-${p.milestoneKey}`"
            class="milestone-row"
            :data-status="p.status"
            :data-claimed="p.viewerClaimed ? 'yes' : 'no'"
          >
            <span class="title">{{ titleOf(p) }}</span>
            <span class="status-badge" :data-status="p.status">{{
              t(`mentorMilestone.status.${p.status}`)
            }}</span>
            <span class="reward">
              {{
                t('mentorMilestone.rewardLinhThach', {
                  amount: p.viewerRewardLinhThach,
                })
              }}
            </span>
            <MButton
              v-if="p.status !== 'LOCKED' && !p.viewerClaimed"
              size="sm"
              :disabled="claimingKey === p.milestoneKey"
              :data-testid="`milestone-claim-${p.milestoneKey}`"
              @click="onClaim(p.milestoneKey)"
            >
              {{ t('mentorMilestone.action.claim') }}
            </MButton>
            <span
              v-else-if="p.viewerClaimed"
              class="muted"
              data-testid="milestone-claimed-marker"
            >
              {{ t('mentorMilestone.action.claimedAlready') }}
            </span>
          </li>
        </ul>
      </article>

      <!-- Disciple view -->
      <article
        v-if="data?.asDisciple"
        class="relation-card"
        data-testid="milestone-disciple-card"
      >
        <h3>
          {{
            t('mentorMilestone.discipleView.heading', {
              name:
                data.asDisciple.mentorDisplayName ??
                data.asDisciple.mentorUserId,
            })
          }}
        </h3>
        <p class="muted">
          {{
            t('mentorMilestone.discipleView.realm', {
              order: data.asDisciple.selfRealmOrder,
            })
          }}
        </p>
        <ul class="milestone-list">
          <li
            v-for="p in data.asDisciple.progress"
            :key="`disciple-${p.milestoneKey}`"
            class="milestone-row"
            :data-status="p.status"
            :data-claimed="p.viewerClaimed ? 'yes' : 'no'"
          >
            <span class="title">{{ titleOf(p) }}</span>
            <span class="status-badge" :data-status="p.status">{{
              t(`mentorMilestone.status.${p.status}`)
            }}</span>
            <span class="reward">
              {{
                t('mentorMilestone.rewardLinhThach', {
                  amount: p.viewerRewardLinhThach,
                })
              }}
            </span>
            <MButton
              v-if="p.status !== 'LOCKED' && !p.viewerClaimed"
              size="sm"
              :disabled="claimingKey === p.milestoneKey"
              :data-testid="`milestone-claim-${p.milestoneKey}`"
              @click="onClaim(p.milestoneKey)"
            >
              {{ t('mentorMilestone.action.claim') }}
            </MButton>
            <span
              v-else-if="p.viewerClaimed"
              class="muted"
              data-testid="milestone-claimed-marker"
            >
              {{ t('mentorMilestone.action.claimedAlready') }}
            </span>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.mentor-milestone-panel {
  padding: 1rem 0;
}
header h2 {
  margin: 0 0 0.25rem;
}
.muted {
  opacity: 0.7;
}
.state-loading,
.state-error,
.state-empty {
  padding: 1rem;
  border: 1px dashed var(--border-color, #444);
  border-radius: 8px;
  margin-top: 0.5rem;
}
.relation-card {
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-top: 0.75rem;
}
.milestone-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.milestone-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-color, #333);
}
.milestone-row:last-child {
  border-bottom: none;
}
.title {
  font-weight: 600;
}
.status-badge {
  font-size: 0.8em;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  border: 1px solid currentColor;
  opacity: 0.85;
}
.status-badge[data-status='LOCKED'] {
  color: #888;
}
.status-badge[data-status='AVAILABLE'] {
  color: #facc15;
}
.status-badge[data-status='CLAIMED'] {
  color: #34d399;
}
.reward {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
@media (max-width: 640px) {
  .milestone-row {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
  }
  .reward {
    grid-column: 1 / 2;
  }
}
</style>
