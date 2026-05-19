<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  getMentorProfile,
  getStudentMentorContext,
  listMentorStudents,
  registerMentor,
  respondMentorRequest,
  sendMentorRequest,
  type MentorProfileRow,
  type MentorRelationRow,
} from '@/api/mentor';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import MButton from '@/components/ui/MButton.vue';
import MentorMilestonePanel from '@/components/MentorMilestonePanel.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const profile = ref<MentorProfileRow | null>(null);
const students = ref<MentorRelationRow[]>([]);
const pendingForMentor = ref<MentorRelationRow[]>([]);
const myMentor = ref<MentorRelationRow | null>(null);
const myPending = ref<MentorRelationRow[]>([]);
const loading = ref(false);
const intro = ref('');
const acceptingStudents = ref(true);
const requestMentorId = ref('');
const requestMessage = ref('');
const busy = ref(false);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    profile.value = await getMentorProfile();
    intro.value = profile.value?.intro ?? '';
    acceptingStudents.value = profile.value?.acceptingStudents ?? true;
    if (profile.value) {
      const list = await listMentorStudents();
      students.value = list.students;
      pendingForMentor.value = list.pending;
    } else {
      students.value = [];
      pendingForMentor.value = [];
    }
    const ctx = await getStudentMentorContext();
    myMentor.value = ctx.mentor;
    myPending.value = ctx.pending;
  } catch (e) {
    handleErr(e);
  } finally {
    loading.value = false;
  }
}

async function onRegister(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    profile.value = await registerMentor({
      intro: intro.value || null,
      acceptingStudents: acceptingStudents.value,
    });
    toast.push({ type: 'success', text: t('mentor.registerToast') });
    await refresh();
  } catch (e) {
    handleErr(e);
  } finally {
    busy.value = false;
  }
}

async function onSendRequest(): Promise<void> {
  if (busy.value || !requestMentorId.value.trim()) return;
  busy.value = true;
  try {
    await sendMentorRequest({
      mentorUserId: requestMentorId.value.trim(),
      message: requestMessage.value || null,
    });
    toast.push({ type: 'success', text: t('mentor.requestSent') });
    requestMentorId.value = '';
    requestMessage.value = '';
    await refresh();
  } catch (e) {
    handleErr(e);
  } finally {
    busy.value = false;
  }
}

async function onRespond(rel: MentorRelationRow, accept: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await respondMentorRequest(rel.id, accept);
    toast.push({
      type: 'success',
      text: accept ? t('mentor.acceptedToast') : t('mentor.declinedToast'),
    });
    await refresh();
  } catch (e) {
    handleErr(e);
  } finally {
    busy.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  toast.push({ type: 'error', text: t(`mentor.error.${code}`, code) });
}

const isMentor = computed(() => !!profile.value);
</script>

<template>
  <AppShell>
    <section class="mentor-view" data-testid="mentor-view">
      <XTLuxHero
        :eyebrow="t('luxHero.mentor.eyebrow')"
        :label="t('luxHero.mentor.label')"
        :title="t('mentor.title')"
        :subtitle="t('mentor.subtitle')"
        tone="jade"
        watermark-letter="S"
        :breadcrumb="t('luxHero.mentor.breadcrumb')"
        test-id="mentor-view-hero"
      >
        <XTPageEyebrow caps="SƯ MÔN TRUYỀN ĐẠO" label="Sư Môn Truyền Đạo" class="sr-only" />
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="mentor-role-hint">
        {{ t('mentor.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-2" data-testid="mentor-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-social"
          @click="$router.push('/social')"
        >
          <span>{{ t('mentor.crossNav.social') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('mentor.crossNav.socialDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-cultivation"
          @click="$router.push('/cultivation')"
        >
          <span>{{ t('mentor.crossNav.cultivation') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('mentor.crossNav.cultivationDesc') }}</span>
        </button>
      </nav>

      <div v-if="loading" data-testid="mentor-loading">{{ t('common.loading') }}</div>

      <div v-else class="mentor-panels">
        <article class="panel">
          <h2>{{ t('mentor.profile.title') }}</h2>
          <p v-if="!isMentor" class="muted">{{ t('mentor.profile.notRegistered') }}</p>
          <p v-else>
            {{ t('mentor.profile.tier', { tier: profile?.realmTier }) }} —
            {{ t('mentor.profile.studentCount', { count: profile?.activeStudentCount ?? 0 }) }}
          </p>
          <label class="field">
            <span>{{ t('mentor.profile.intro') }}</span>
            <textarea
              v-model="intro"
              maxlength="280"
              :placeholder="t('mentor.profile.introPlaceholder')"
              data-testid="mentor-intro"
            />
          </label>
          <label class="field-row">
            <input v-model="acceptingStudents" type="checkbox" data-testid="mentor-accepting" />
            <span>{{ t('mentor.profile.accepting') }}</span>
          </label>
          <MButton
            :disabled="busy"
            data-testid="mentor-register-btn"
            @click="onRegister"
          >
            {{ isMentor ? t('mentor.profile.update') : t('mentor.profile.register') }}
          </MButton>
        </article>

        <article v-if="isMentor" class="panel" data-testid="mentor-students-panel">
          <h2>{{ t('mentor.students.title') }}</h2>
          <p v-if="students.length === 0" class="muted">{{ t('mentor.students.empty') }}</p>
          <ul v-else>
            <li v-for="s in students" :key="s.id">
              {{ s.studentDisplayName ?? s.studentUserId }}
              <span class="badge">{{ s.status }}</span>
            </li>
          </ul>
          <h3>{{ t('mentor.students.pending') }}</h3>
          <p v-if="pendingForMentor.length === 0" class="muted">
            {{ t('mentor.students.noPending') }}
          </p>
          <ul v-else>
            <li v-for="p in pendingForMentor" :key="p.id">
              {{ p.studentDisplayName ?? p.studentUserId }}
              <span class="muted">{{ p.message }}</span>
              <MButton size="sm" @click="onRespond(p, true)">{{ t('common.accept') }}</MButton>
              <MButton size="sm" variant="ghost" @click="onRespond(p, false)">
                {{ t('common.decline') }}
              </MButton>
            </li>
          </ul>
        </article>

        <article class="panel" data-testid="mentor-student-panel">
          <h2>{{ t('mentor.student.title') }}</h2>
          <p v-if="myMentor" class="muted">
            {{ t('mentor.student.current', { name: myMentor.mentorDisplayName ?? myMentor.mentorUserId }) }}
          </p>
          <p v-else class="muted">{{ t('mentor.student.noMentor') }}</p>
          <label class="field">
            <span>{{ t('mentor.student.mentorIdLabel') }}</span>
            <input v-model="requestMentorId" data-testid="mentor-target-id" />
          </label>
          <label class="field">
            <span>{{ t('mentor.student.messageLabel') }}</span>
            <textarea v-model="requestMessage" maxlength="240" data-testid="mentor-target-msg" />
          </label>
          <MButton :disabled="busy || !requestMentorId" @click="onSendRequest">
            {{ t('mentor.student.send') }}
          </MButton>
          <h3>{{ t('mentor.student.pendingTitle') }}</h3>
          <p v-if="myPending.length === 0" class="muted">{{ t('mentor.student.noPending') }}</p>
          <ul v-else>
            <li v-for="p in myPending" :key="p.id">
              → {{ p.mentorDisplayName ?? p.mentorUserId }} ({{ p.status }})
            </li>
          </ul>
        </article>
      </div>

      <MentorMilestonePanel />
    </section>
  </AppShell>
</template>

<style scoped>
.mentor-view {
  padding: 1rem;
}
.mentor-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}
.panel {
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 1rem;
}
.field,
.field-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.5rem 0;
}
.field-row {
  flex-direction: row;
  align-items: center;
}
textarea,
input[type='text'],
input:not([type]) {
  background: var(--bg-input, #222);
  color: var(--text-primary, #eee);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
}
textarea {
  min-height: 60px;
  resize: vertical;
}
.muted {
  opacity: 0.7;
}
.badge {
  margin-left: 0.5rem;
  font-size: 0.85em;
  opacity: 0.7;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border-color, #333);
}
</style>
