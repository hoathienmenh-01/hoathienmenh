/**
 * Phase 35.2 — MentorMilestonePanel smoke tests.
 *
 * Verify:
 *   - Mount fetches milestones.
 *   - Empty (no relations) → empty state visible.
 *   - Disciple view với AVAILABLE milestone → claim button visible, click
 *     calls API + refreshes.
 *   - LOCKED milestone → no claim button.
 *   - Already-claimed milestone → "claimedAlready" marker, no claim button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const listMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/mentor', () => ({
  listMentorMilestones: (...a: unknown[]) => listMock(...a),
  claimMentorMilestone: (...a: unknown[]) => claimMock(...a),
}));

import MentorMilestonePanel from '@/components/MentorMilestonePanel.vue';
import { useAuthStore } from '@/stores/auth';

const messages = {
  vi: {
    common: { loading: 'L', retry: 'R' },
    toast: {
      title: { info: 'i', warning: 'w', error: 'e', success: 's' },
    },
    mentorMilestone: {
      title: 'T',
      subtitle: 'S',
      empty: 'EMPTY',
      rewardLinhThach: '{amount} LT',
      status: {
        LOCKED: 'LOCK',
        AVAILABLE: 'AVAIL',
        CLAIMED: 'CLAIMED',
      },
      action: { claim: 'CLAIM', claimedAlready: 'DONE' },
      mentorView: { heading: 'Disciple {name}', realm: 'r {order}' },
      discipleView: { heading: 'Mentor {name}', realm: 'r {order}' },
      toast: { claimed: 'sent {amount}' },
      error: {
        MILESTONE_LOCKED: 'LOCKED_ERR',
        MILESTONE_ALREADY_CLAIMED: 'DUP_ERR',
        MILESTONE_NOT_FOUND: 'NF',
        NOT_IN_ACTIVE_RELATION: 'NAR',
        NO_CHARACTER: 'NC',
        NOT_FOUND: 'NF',
        NOT_AUTHORIZED: 'NA',
        UNKNOWN: 'UNK',
      },
    },
  },
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'u-me',
    email: 'me@test',
    role: 'PLAYER',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
});

describe('MentorMilestonePanel', () => {
  it('empty state when no relations', async () => {
    listMock.mockResolvedValue({ asMentor: [], asDisciple: null });
    const wrapper = mount(MentorMilestonePanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="milestone-empty"]').text()).toContain(
      'EMPTY',
    );
  });

  it('disciple view renders progress rows + claim button for AVAILABLE', async () => {
    listMock.mockResolvedValue({
      asMentor: [],
      asDisciple: {
        relationId: 'rel1',
        mentorUserId: 'mentor1',
        mentorDisplayName: 'Master',
        selfRealmKey: 'truc_co',
        selfRealmOrder: 2,
        progress: [
          {
            milestoneKey: 'mentor_milestone_truc_co',
            status: 'AVAILABLE',
            reachedAt: '2025-01-01T00:00:00Z',
            titleVi: 'Trúc Cơ',
            titleEn: 'Foundation',
            viewerRewardLinhThach: '8000',
            viewerClaimed: false,
          },
          {
            milestoneKey: 'mentor_milestone_kim_dan',
            status: 'LOCKED',
            reachedAt: null,
            titleVi: 'Kim Đan',
            titleEn: 'Golden Core',
            viewerRewardLinhThach: '15000',
            viewerClaimed: false,
          },
        ],
      },
    });
    const wrapper = mount(MentorMilestonePanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    const card = wrapper.find('[data-testid="milestone-disciple-card"]');
    expect(card.exists()).toBe(true);
    const claimBtn = card.find(
      '[data-testid="milestone-claim-mentor_milestone_truc_co"]',
    );
    expect(claimBtn.exists()).toBe(true);
    // LOCKED row → no claim btn
    expect(
      card
        .find('[data-testid="milestone-claim-mentor_milestone_kim_dan"]')
        .exists(),
    ).toBe(false);
  });

  it('claim AVAILABLE milestone calls API + refreshes', async () => {
    listMock.mockResolvedValue({
      asMentor: [],
      asDisciple: {
        relationId: 'rel1',
        mentorUserId: 'mentor1',
        mentorDisplayName: 'Master',
        selfRealmKey: 'truc_co',
        selfRealmOrder: 2,
        progress: [
          {
            milestoneKey: 'mentor_milestone_truc_co',
            status: 'AVAILABLE',
            reachedAt: '2025-01-01T00:00:00Z',
            titleVi: 'Trúc Cơ',
            titleEn: 'Foundation',
            viewerRewardLinhThach: '8000',
            viewerClaimed: false,
          },
        ],
      },
    });
    claimMock.mockResolvedValue({
      role: 'DISCIPLE',
      rewardLinhThach: '8000',
      mailId: 'm1',
    });
    const wrapper = mount(MentorMilestonePanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    const btn = wrapper.find(
      '[data-testid="milestone-claim-mentor_milestone_truc_co"]',
    );
    await btn.trigger('click');
    await flushPromises();
    expect(claimMock).toHaveBeenCalledWith('mentor_milestone_truc_co');
    // refresh after claim → list called twice (mount + after-claim)
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('already-claimed milestone shows claimedAlready marker, no claim btn', async () => {
    listMock.mockResolvedValue({
      asMentor: [],
      asDisciple: {
        relationId: 'rel1',
        mentorUserId: 'mentor1',
        mentorDisplayName: 'Master',
        selfRealmKey: 'truc_co',
        selfRealmOrder: 2,
        progress: [
          {
            milestoneKey: 'mentor_milestone_truc_co',
            status: 'AVAILABLE',
            reachedAt: '2025-01-01T00:00:00Z',
            titleVi: 'Trúc Cơ',
            titleEn: 'Foundation',
            viewerRewardLinhThach: '8000',
            viewerClaimed: true,
          },
        ],
      },
    });
    const wrapper = mount(MentorMilestonePanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    expect(
      wrapper
        .find('[data-testid="milestone-claim-mentor_milestone_truc_co"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="milestone-claimed-marker"]').exists(),
    ).toBe(true);
  });

  it('mentor view renders disciple card with reward correctly', async () => {
    listMock.mockResolvedValue({
      asMentor: [
        {
          relationId: 'rel1',
          studentUserId: 'student1',
          studentDisplayName: 'Disciple',
          studentRealmKey: 'kim_dan',
          studentRealmOrder: 3,
          progress: [
            {
              milestoneKey: 'mentor_milestone_kim_dan',
              status: 'AVAILABLE',
              reachedAt: '2025-01-01T00:00:00Z',
              titleVi: 'Kim Đan',
              titleEn: 'Golden Core',
              viewerRewardLinhThach: '10000',
              viewerClaimed: false,
            },
          ],
        },
      ],
      asDisciple: null,
    });
    const wrapper = mount(MentorMilestonePanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    const card = wrapper.find('[data-testid="milestone-mentor-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('10000 LT');
  });
});
