/**
 * Phase 14.1.B — ArenaView tests.
 *
 * Bao phủ:
 *   - Loading state khi store chưa có profile.
 *   - Error state khi profileError set.
 *   - Render profile data (rating, wins, losses, attacks today).
 *   - Render opponents list + click challenge → store.challenge gọi đúng id.
 *   - Render lastResult banner (win/lose/draw + log).
 *   - Render history list + outcome highlight.
 *   - Empty state cho opponents + history.
 *   - Error state cho opponents + history.
 *   - Toast push khi challenge success / fail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

interface ProfileStub {
  characterId: string;
  characterName: string;
  rating: number;
  tier: string;
  wins: number;
  losses: number;
  draws: number;
  attacksToday: number;
  attacksRemaining: number;
  todayBucket: string;
  createdAt: string;
  updatedAt: string;
}

interface OpponentStub {
  characterId: string;
  characterName: string;
  realmKey: string;
  realmStage: number;
  rating: number;
  tier: string;
  wins: number;
  losses: number;
  sectName: string | null;
}

interface MatchStub {
  matchId: string;
  status: string;
  outcome: 'ATTACKER_WIN' | 'DEFENDER_WIN' | 'DRAW';
  attackerCharacterId: string;
  attackerName: string;
  defenderCharacterId: string;
  defenderName: string;
  seed: number;
  ratingDelta: { attacker: number; defender: number };
  attackerRatingAfter: number;
  defenderRatingAfter: number;
  totalAttackerDamage: number;
  totalDefenderDamage: number;
  rounds: number;
  battleLog: Array<{
    round: number;
    attackerSide: 'attacker' | 'defender';
    attackerName: string;
    defenderName: string;
    finalDamage: number;
    attackerHp: number;
    defenderHp: number;
  }>;
  createdAt: string;
  resolvedAt: string | null;
}

interface SeasonStub {
  seasonKey: string;
  status: 'ACTIVE' | 'SETTLED' | 'ARCHIVED';
  startsAtIso: string;
  endsAtIso: string;
  settledAtIso: string | null;
  cadence: 'weekly';
  timezone: string;
}

interface MyStandingStub {
  seasonKey: string;
  characterId: string;
  rating: number;
  tier: string;
  wins: number;
  losses: number;
  rank: number | null;
}

interface LeaderboardStub {
  seasonKey: string;
  total: number;
  entries: Array<{
    rank: number;
    characterId: string;
    characterName: string;
    rating: number;
    tier: string;
    wins: number;
    losses: number;
    sectName: string | null;
  }>;
}

interface RewardPreviewStub {
  seasonKey: string;
  tiers: Array<{
    tier: string;
    reward: {
      linhThach: number;
      tienNgoc: number;
      exp: number;
      items: Array<{ itemKey: string; qty: number }>;
    };
    labelI18nKey: string;
    descriptionI18nKey: string;
  }>;
}

interface ArenaStoreStub {
  profile: ProfileStub | null;
  profileLoading: boolean;
  profileError: string | null;
  opponents: OpponentStub[] | null;
  opponentsLoading: boolean;
  opponentsError: string | null;
  lastResult: MatchStub | null;
  challengeInFlight: boolean;
  challengeError: string | null;
  history: MatchStub[] | null;
  historyLoading: boolean;
  historyError: string | null;
  totalAttacks: number;
  fetchProfile: ReturnType<typeof vi.fn>;
  fetchOpponents: ReturnType<typeof vi.fn>;
  challenge: ReturnType<typeof vi.fn>;
  fetchHistory: ReturnType<typeof vi.fn>;
  clearLastResult: () => void;
  // Phase 14.1.C
  season: SeasonStub | null;
  seasonLoading: boolean;
  seasonError: string | null;
  myStanding: MyStandingStub | null;
  myStandingLoading: boolean;
  myStandingError: string | null;
  leaderboard: LeaderboardStub | null;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  rewardPreview: RewardPreviewStub | null;
  rewardPreviewLoading: boolean;
  rewardPreviewError: string | null;
  fetchSeason: ReturnType<typeof vi.fn>;
  fetchMyStanding: ReturnType<typeof vi.fn>;
  fetchLeaderboard: ReturnType<typeof vi.fn>;
  fetchRewardPreview: ReturnType<typeof vi.fn>;
}

const arenaState: ArenaStoreStub = {
  profile: null,
  profileLoading: false,
  profileError: null,
  opponents: null,
  opponentsLoading: false,
  opponentsError: null,
  lastResult: null,
  challengeInFlight: false,
  challengeError: null,
  history: null,
  historyLoading: false,
  historyError: null,
  totalAttacks: 0,
  fetchProfile: vi.fn(),
  fetchOpponents: vi.fn(),
  challenge: vi.fn(),
  fetchHistory: vi.fn(),
  clearLastResult: vi.fn(() => {
    arenaState.lastResult = null;
  }),
  // Phase 14.1.C — season slice.
  season: null,
  seasonLoading: false,
  seasonError: null,
  myStanding: null,
  myStandingLoading: false,
  myStandingError: null,
  leaderboard: null,
  leaderboardLoading: false,
  leaderboardError: null,
  rewardPreview: null,
  rewardPreviewLoading: false,
  rewardPreviewError: null,
  fetchSeason: vi.fn(),
  fetchMyStanding: vi.fn(),
  fetchLeaderboard: vi.fn(),
  fetchRewardPreview: vi.fn(),
};

const toastPushMock = vi.fn();

vi.mock('@/stores/arena', () => ({
  useArenaStore: () => arenaState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    props: ['type', 'loading', 'disabled'],
    template:
      '<button :disabled="disabled || loading"><slot /></button>',
  },
}));

import ArenaView from '@/views/ArenaView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: {
        loading: 'Loading…',
        dismiss: 'Dismiss',
      },
      arena: {
        title: 'Đấu Đài',
        subtitle: 'sub',
        profile: {
          rating: 'Rating',
          tier: 'Tier',
          wins: 'Wins',
          losses: 'Losses',
          draws: 'Draws',
          attacksToday: 'Today',
          unlimited: '∞',
        },
        opponents: {
          title: 'Opps',
          refresh: 'Refresh',
          empty: 'no opp',
          rating: 'R{r}',
          realm: '{realm} {stage}',
        },
        challenge: { button: 'Challenge', inFlight: 'Resolving' },
        result: {
          win: 'WIN',
          lose: 'LOSE',
          draw: 'DRAW',
          vs: 'vs {name}',
          damageAttacker: 'A:{d}',
          damageDefender: 'D:{d}',
          rounds: '{n}r',
          logLine: 'r{r} {side} {d}',
          side: { attacker: 'A', defender: 'D' },
        },
        history: { title: 'Hist', empty: 'no hist', rounds: '{n}r' },
        toast: { challengeSuccess: 'success' },
        errors: {
          UNKNOWN: 'unknown err',
          PROFILE_FETCH_FAILED: 'p err',
          OPPONENTS_FETCH_FAILED: 'o err',
          HISTORY_FETCH_FAILED: 'h err',
          DAILY_LIMIT_REACHED: 'limit',
          CANNOT_ATTACK_SELF: 'self',
          SEASON_FETCH_FAILED: 's err',
          STANDING_FETCH_FAILED: 'st err',
          LEADERBOARD_FETCH_FAILED: 'l err',
          REWARDS_FETCH_FAILED: 'r err',
        },
        season: {
          title: 'Season',
          status: { ACTIVE: 'Active', SETTLED: 'Settled', ARCHIVED: 'Archived' },
          starts: 'Start',
          ends: 'End',
          settledAt: 'SettledAt',
          cadence: { weekly: 'Weekly' },
          ratingDelta: 'Δ',
          myStanding: {
            title: 'My',
            rating: 'R',
            tier: 'T',
            rank: 'Rk',
            wins: 'W',
            losses: 'L',
            noRank: '—',
          },
          tier: {
            BRONZE: 'Bronze',
            SILVER: 'Silver',
            GOLD: 'Gold',
            DIAMOND: 'Diamond',
            IMMORTAL: 'Immortal',
          },
        },
        leaderboard: {
          title: 'LB',
          rank: '#',
          name: 'Name',
          rating: 'Rating',
          tier: 'Tier',
          wins: 'W',
          losses: 'L',
          sect: 'Sect',
          empty: 'no lb',
          totalCount: 'Total: {n}',
          loadMore: 'More',
        },
        rewardPreview: {
          title: 'Rewards',
          linhThach: 'LT',
          tienNgoc: 'TN',
          exp: 'EXP',
          items: 'Items',
          tier: 'Tier',
          reward: 'Reward',
          noReward: 'None',
        },
      },
    },
  },
});

function mountView() {
  return mount(ArenaView, { global: { plugins: [i18n] } });
}

function resetState() {
  arenaState.profile = null;
  arenaState.profileLoading = false;
  arenaState.profileError = null;
  arenaState.opponents = null;
  arenaState.opponentsLoading = false;
  arenaState.opponentsError = null;
  arenaState.lastResult = null;
  arenaState.challengeInFlight = false;
  arenaState.challengeError = null;
  arenaState.history = null;
  arenaState.historyLoading = false;
  arenaState.historyError = null;
  arenaState.totalAttacks = 0;
  arenaState.fetchProfile.mockReset();
  arenaState.fetchOpponents.mockReset();
  arenaState.challenge.mockReset();
  arenaState.fetchHistory.mockReset();
  // Phase 14.1.C
  arenaState.season = null;
  arenaState.seasonLoading = false;
  arenaState.seasonError = null;
  arenaState.myStanding = null;
  arenaState.myStandingLoading = false;
  arenaState.myStandingError = null;
  arenaState.leaderboard = null;
  arenaState.leaderboardLoading = false;
  arenaState.leaderboardError = null;
  arenaState.rewardPreview = null;
  arenaState.rewardPreviewLoading = false;
  arenaState.rewardPreviewError = null;
  arenaState.fetchSeason.mockReset();
  arenaState.fetchMyStanding.mockReset();
  arenaState.fetchLeaderboard.mockReset();
  arenaState.fetchRewardPreview.mockReset();
  toastPushMock.mockClear();
}

const PROFILE_A: ProfileStub = {
  characterId: 'me-id',
  characterName: 'Me',
  rating: 1023,
  tier: 'unranked',
  wins: 5,
  losses: 2,
  draws: 1,
  attacksToday: 3,
  attacksRemaining: 7,
  todayBucket: '2026-05-10',
  createdAt: '2026-05-10T00:00:00.000Z',
  updatedAt: '2026-05-10T00:00:00.000Z',
};

const OPPONENT_B: OpponentStub = {
  characterId: 'opp-id',
  characterName: 'Foe',
  realmKey: 'truc_co',
  realmStage: 3,
  rating: 1010,
  tier: 'unranked',
  wins: 1,
  losses: 0,
  sectName: 'Sect Y',
};

function makeMatch(overrides: Partial<MatchStub> = {}): MatchStub {
  return {
    matchId: 'm1',
    status: 'RESOLVED',
    outcome: 'ATTACKER_WIN',
    attackerCharacterId: 'me-id',
    attackerName: 'Me',
    defenderCharacterId: 'opp-id',
    defenderName: 'Foe',
    seed: 1,
    ratingDelta: { attacker: 10, defender: -5 },
    attackerRatingAfter: 1010,
    defenderRatingAfter: 995,
    totalAttackerDamage: 100,
    totalDefenderDamage: 30,
    rounds: 3,
    battleLog: [
      {
        round: 1,
        attackerSide: 'attacker',
        attackerName: 'Me',
        defenderName: 'Foe',
        finalDamage: 50,
        attackerHp: 100,
        defenderHp: 50,
      },
    ],
    createdAt: '2026-05-10T00:00:00.000Z',
    resolvedAt: '2026-05-10T00:00:01.000Z',
    ...overrides,
  };
}

describe('ArenaView — profile panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
  });

  it('renders loading state when profile is null + loading', () => {
    arenaState.profileLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-profile-loading"]').exists()).toBe(true);
  });

  it('renders error state when profileError set', () => {
    arenaState.profileError = 'PROFILE_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-profile-error"]').exists()).toBe(true);
  });

  it('renders rating/wins/losses/attacksToday', () => {
    arenaState.profile = PROFILE_A;
    const w = mountView();
    expect(w.find('[data-testid="arena-profile-rating"]').text()).toBe('1023');
    expect(w.find('[data-testid="arena-profile-wins"]').text()).toBe('5');
    expect(w.find('[data-testid="arena-profile-losses"]').text()).toBe('2');
    expect(w.find('[data-testid="arena-profile-attacks"]').text()).toContain('3');
    expect(w.find('[data-testid="arena-profile-attacks"]').text()).toContain('7');
  });

  it('shows ∞ when attacksRemaining is -1 (unlimited)', () => {
    arenaState.profile = { ...PROFILE_A, attacksRemaining: -1 };
    const w = mountView();
    expect(w.find('[data-testid="arena-profile-attacks"]').text()).toContain('∞');
  });
});

describe('ArenaView — opponents panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
    arenaState.profile = PROFILE_A;
  });

  it('renders loading state when opponents null + loading', () => {
    arenaState.opponentsLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-opponents-loading"]').exists()).toBe(true);
  });

  it('renders error state when opponentsError set', () => {
    arenaState.opponentsError = 'OPPONENTS_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-opponents-error"]').exists()).toBe(true);
  });

  it('renders empty state when opponents list is empty', () => {
    arenaState.opponents = [];
    const w = mountView();
    expect(w.find('[data-testid="arena-opponents-empty"]').exists()).toBe(true);
  });

  it('renders opponent rows', () => {
    arenaState.opponents = [OPPONENT_B];
    const w = mountView();
    expect(w.find('[data-testid="arena-opponent-opp-id"]').exists()).toBe(true);
    expect(w.find('[data-testid="arena-opponent-opp-id"]').text()).toContain(
      'Foe',
    );
  });

  it('challenge button calls store.challenge with opponent id (success → toast)', async () => {
    arenaState.opponents = [OPPONENT_B];
    arenaState.challenge.mockResolvedValue(null);
    const w = mountView();
    await w.find('[data-testid="arena-challenge-opp-id"]').trigger('click');
    await flushPromises();
    expect(arenaState.challenge).toHaveBeenCalledWith('opp-id');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('challenge fail → toast error with localized code', async () => {
    arenaState.opponents = [OPPONENT_B];
    arenaState.challenge.mockResolvedValue('CANNOT_ATTACK_SELF');
    const w = mountView();
    await w.find('[data-testid="arena-challenge-opp-id"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'self' }),
    );
  });

  it('challenge fail unknown code → unknown error toast', async () => {
    arenaState.opponents = [OPPONENT_B];
    arenaState.challenge.mockResolvedValue('SOME_NEW_CODE');
    const w = mountView();
    await w.find('[data-testid="arena-challenge-opp-id"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'unknown err' }),
    );
  });
});

describe('ArenaView — last result banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
    arenaState.profile = PROFILE_A;
  });

  it('renders win banner when outcome=ATTACKER_WIN and player is attacker', () => {
    arenaState.lastResult = makeMatch();
    const w = mountView();
    expect(w.find('[data-testid="arena-last-result"]').exists()).toBe(true);
    expect(w.find('[data-testid="arena-last-result-outcome"]').text()).toContain(
      'WIN',
    );
  });

  it('renders lose banner when outcome=DEFENDER_WIN and player is attacker', () => {
    arenaState.lastResult = makeMatch({ outcome: 'DEFENDER_WIN' });
    const w = mountView();
    expect(w.find('[data-testid="arena-last-result-outcome"]').text()).toContain(
      'LOSE',
    );
  });

  it('renders draw banner', () => {
    arenaState.lastResult = makeMatch({ outcome: 'DRAW' });
    const w = mountView();
    expect(w.find('[data-testid="arena-last-result-outcome"]').text()).toContain(
      'DRAW',
    );
  });

  it('renders damage summary + battle log entries', () => {
    arenaState.lastResult = makeMatch();
    const w = mountView();
    const dmg = w.find('[data-testid="arena-last-result-damage"]').text();
    expect(dmg).toContain('100');
    expect(dmg).toContain('30');
    expect(w.find('[data-testid="arena-last-result-log"]').exists()).toBe(true);
  });

  it('dismiss clears banner', async () => {
    arenaState.lastResult = makeMatch();
    const w = mountView();
    await w.find('[data-testid="arena-last-result-dismiss"]').trigger('click');
    expect(arenaState.clearLastResult).toBeDefined();
    expect(arenaState.lastResult).toBeNull();
  });
});

describe('ArenaView — history panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
    arenaState.profile = PROFILE_A;
  });

  it('renders loading state when history null + loading', () => {
    arenaState.historyLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-history-loading"]').exists()).toBe(true);
  });

  it('renders error state when historyError set', () => {
    arenaState.historyError = 'HISTORY_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-history-error"]').exists()).toBe(true);
  });

  it('renders empty state when history is empty', () => {
    arenaState.history = [];
    const w = mountView();
    expect(w.find('[data-testid="arena-history-empty"]').exists()).toBe(true);
  });

  it('renders history rows', () => {
    arenaState.history = [makeMatch(), makeMatch({ matchId: 'm2', outcome: 'DEFENDER_WIN' })];
    const w = mountView();
    const list = w.find('[data-testid="arena-history-list"]');
    expect(list.exists()).toBe(true);
    expect(list.findAll('li').length).toBe(2);
  });
});

describe('ArenaView — mount triggers fetches', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
  });

  it('calls fetchProfile + fetchOpponents + fetchHistory on mount', () => {
    mountView();
    expect(arenaState.fetchProfile).toHaveBeenCalledTimes(1);
    expect(arenaState.fetchOpponents).toHaveBeenCalledTimes(1);
    expect(arenaState.fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('also calls Phase 14.1.C season fetches on mount', () => {
    mountView();
    expect(arenaState.fetchSeason).toHaveBeenCalledTimes(1);
    expect(arenaState.fetchMyStanding).toHaveBeenCalledTimes(1);
    expect(arenaState.fetchLeaderboard).toHaveBeenCalledTimes(1);
    expect(arenaState.fetchRewardPreview).toHaveBeenCalledTimes(1);
  });

  it('refresh button re-triggers fetches', async () => {
    arenaState.profile = PROFILE_A;
    arenaState.opponents = [];
    const w = mountView();
    arenaState.fetchProfile.mockClear();
    arenaState.fetchOpponents.mockClear();
    arenaState.fetchHistory.mockClear();
    arenaState.fetchSeason.mockClear();
    arenaState.fetchMyStanding.mockClear();
    arenaState.fetchLeaderboard.mockClear();
    arenaState.fetchRewardPreview.mockClear();
    await w.find('[data-testid="arena-refresh"]').trigger('click');
    expect(arenaState.fetchProfile).toHaveBeenCalled();
    expect(arenaState.fetchOpponents).toHaveBeenCalled();
    expect(arenaState.fetchHistory).toHaveBeenCalled();
    expect(arenaState.fetchSeason).toHaveBeenCalled();
    expect(arenaState.fetchMyStanding).toHaveBeenCalled();
    expect(arenaState.fetchLeaderboard).toHaveBeenCalled();
    expect(arenaState.fetchRewardPreview).toHaveBeenCalled();
  });
});

// Phase 14.1.C — season banner / leaderboard / reward preview / rating delta.
describe('ArenaView — season banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
  });

  it('renders loading state when season null + loading', () => {
    arenaState.seasonLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-season-loading"]').exists()).toBe(true);
  });

  it('renders error state when seasonError set', () => {
    arenaState.seasonError = 'SEASON_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-season-error"]').exists()).toBe(true);
  });

  it('renders seasonKey + status from season view', () => {
    arenaState.season = {
      seasonKey: 'arena_2026-W19',
      status: 'ACTIVE',
      startsAtIso: '2026-05-04T17:00:00.000Z',
      endsAtIso: '2026-05-11T17:00:00.000Z',
      settledAtIso: null,
      cadence: 'weekly',
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const w = mountView();
    expect(w.find('[data-testid="arena-season-key"]').text()).toBe(
      'arena_2026-W19',
    );
    expect(w.find('[data-testid="arena-season"]').text()).toContain('Active');
  });

  it('renders my standing card with rating + tier + rank', () => {
    arenaState.season = {
      seasonKey: 'arena_2026-W19',
      status: 'ACTIVE',
      startsAtIso: '2026-05-04T17:00:00.000Z',
      endsAtIso: '2026-05-11T17:00:00.000Z',
      settledAtIso: null,
      cadence: 'weekly',
      timezone: 'Asia/Ho_Chi_Minh',
    };
    arenaState.myStanding = {
      seasonKey: 'arena_2026-W19',
      characterId: 'me-id',
      rating: 1234,
      tier: 'GOLD',
      wins: 7,
      losses: 3,
      rank: 4,
    };
    const w = mountView();
    const card = w.find('[data-testid="arena-season-standing"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('1234');
    expect(card.text()).toContain('Gold');
    expect(card.text()).toContain('4');
    expect(card.text()).toContain('7');
    expect(card.text()).toContain('3');
  });

  it('renders dash when rank is null', () => {
    arenaState.season = {
      seasonKey: 'arena_2026-W19',
      status: 'ACTIVE',
      startsAtIso: '2026-05-04T17:00:00.000Z',
      endsAtIso: '2026-05-11T17:00:00.000Z',
      settledAtIso: null,
      cadence: 'weekly',
      timezone: 'Asia/Ho_Chi_Minh',
    };
    arenaState.myStanding = {
      seasonKey: 'arena_2026-W19',
      characterId: 'me-id',
      rating: 1000,
      tier: 'SILVER',
      wins: 0,
      losses: 0,
      rank: null,
    };
    const w = mountView();
    const card = w.find('[data-testid="arena-season-standing"]');
    expect(card.text()).toContain('—');
  });
});

describe('ArenaView — leaderboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
  });

  it('renders loading state', () => {
    arenaState.leaderboardLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-leaderboard-loading"]').exists()).toBe(
      true,
    );
  });

  it('renders error state', () => {
    arenaState.leaderboardError = 'LEADERBOARD_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-leaderboard-error"]').exists()).toBe(
      true,
    );
  });

  it('renders empty state when no entries', () => {
    arenaState.leaderboard = {
      seasonKey: 'arena_2026-W19',
      total: 0,
      entries: [],
    };
    const w = mountView();
    expect(w.find('[data-testid="arena-leaderboard-empty"]').exists()).toBe(
      true,
    );
  });

  it('renders rows in given order with rank/name/tier/rating', () => {
    arenaState.leaderboard = {
      seasonKey: 'arena_2026-W19',
      total: 2,
      entries: [
        {
          rank: 1,
          characterId: 'a',
          characterName: 'Alpha',
          rating: 1500,
          tier: 'DIAMOND',
          wins: 5,
          losses: 1,
          sectName: 'Sect A',
        },
        {
          rank: 2,
          characterId: 'b',
          characterName: 'Beta',
          rating: 1100,
          tier: 'SILVER',
          wins: 2,
          losses: 3,
          sectName: null,
        },
      ],
    };
    const w = mountView();
    const table = w.find('[data-testid="arena-leaderboard-table"]');
    expect(table.exists()).toBe(true);
    const rowA = w.find('[data-testid="arena-leaderboard-row-a"]');
    expect(rowA.text()).toContain('Alpha');
    expect(rowA.text()).toContain('Diamond');
    expect(rowA.text()).toContain('1500');
    expect(rowA.text()).toContain('Sect A');
    const rowB = w.find('[data-testid="arena-leaderboard-row-b"]');
    expect(rowB.text()).toContain('Beta');
    expect(rowB.text()).toContain('Silver');
  });
});

describe('ArenaView — reward preview', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
  });

  it('renders loading state', () => {
    arenaState.rewardPreviewLoading = true;
    const w = mountView();
    expect(w.find('[data-testid="arena-rewards-loading"]').exists()).toBe(
      true,
    );
  });

  it('renders error state', () => {
    arenaState.rewardPreviewError = 'REWARDS_FETCH_FAILED';
    const w = mountView();
    expect(w.find('[data-testid="arena-rewards-error"]').exists()).toBe(true);
  });

  it('renders 5 reward tiles for 5 tiers', () => {
    arenaState.rewardPreview = {
      seasonKey: 'arena_2026-W19',
      tiers: [
        {
          tier: 'BRONZE',
          reward: { linhThach: 200, tienNgoc: 0, exp: 0, items: [] },
          labelI18nKey: 'arenaSeason.tier.BRONZE',
          descriptionI18nKey: 'arenaSeason.reward.BRONZE.desc',
        },
        {
          tier: 'SILVER',
          reward: {
            linhThach: 500,
            tienNgoc: 0,
            exp: 0,
            items: [{ itemKey: 'huyet_chi_dan', qty: 5 }],
          },
          labelI18nKey: 'arenaSeason.tier.SILVER',
          descriptionI18nKey: 'arenaSeason.reward.SILVER.desc',
        },
        {
          tier: 'GOLD',
          reward: {
            linhThach: 1000,
            tienNgoc: 0,
            exp: 0,
            items: [{ itemKey: 'huyet_chi_dan', qty: 10 }],
          },
          labelI18nKey: 'arenaSeason.tier.GOLD',
          descriptionI18nKey: 'arenaSeason.reward.GOLD.desc',
        },
        {
          tier: 'DIAMOND',
          reward: {
            linhThach: 2000,
            tienNgoc: 20,
            exp: 0,
            items: [{ itemKey: 'linh_lo_dan', qty: 5 }],
          },
          labelI18nKey: 'arenaSeason.tier.DIAMOND',
          descriptionI18nKey: 'arenaSeason.reward.DIAMOND.desc',
        },
        {
          tier: 'IMMORTAL',
          reward: {
            linhThach: 5000,
            tienNgoc: 50,
            exp: 0,
            items: [{ itemKey: 'linh_lo_dan', qty: 10 }],
          },
          labelI18nKey: 'arenaSeason.tier.IMMORTAL',
          descriptionI18nKey: 'arenaSeason.reward.IMMORTAL.desc',
        },
      ],
    };
    const w = mountView();
    expect(w.find('[data-testid="arena-rewards-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="arena-reward-BRONZE"]').text()).toContain(
      '200',
    );
    expect(w.find('[data-testid="arena-reward-DIAMOND"]').text()).toContain(
      '2000',
    );
    expect(w.find('[data-testid="arena-reward-IMMORTAL"]').text()).toContain(
      '5000',
    );
  });
});

describe('ArenaView — history rating delta', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetState();
    arenaState.profile = PROFILE_A;
  });

  it('renders +delta when player wins as attacker', () => {
    arenaState.history = [makeMatch({ matchId: 'mwin' })];
    const w = mountView();
    const delta = w.find('[data-testid="arena-history-delta-mwin"]');
    expect(delta.exists()).toBe(true);
    expect(delta.text()).toContain('+10');
  });

  it('renders negative delta when player loses as defender', () => {
    arenaState.history = [
      makeMatch({
        matchId: 'mlose',
        attackerCharacterId: 'opp-id',
        defenderCharacterId: 'me-id',
        outcome: 'ATTACKER_WIN',
        ratingDelta: { attacker: 12, defender: -8 },
      }),
    ];
    const w = mountView();
    const delta = w.find('[data-testid="arena-history-delta-mlose"]');
    expect(delta.exists()).toBe(true);
    expect(delta.text()).toContain('-8');
  });
});
