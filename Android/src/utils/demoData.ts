import { DEMO_RUNNERS, DEMO_ME } from './demoTerritory';
import {
  ChatMessage,
  InstitutionStanding,
  MyInstitution,
  ProfileStats,
  Run,
  Season,
  SeasonEntry,
  SeasonGroup,
  SeasonGroupMember,
  SocialAccount,
  TerritoryCell,
} from '../types';

/**
 * Demo data for the screens `territoryStore.demoMode` does not already cover —
 * chat, the season screen, and the parts of the profile that are not rank or
 * influence. Same rule as demoTerritory.ts: nothing here touches the server,
 * everything is deterministic, and the roster is the same ten rivals plus
 * 'You' so a runner who turns on the demo sees one consistent cast everywhere
 * in the app rather than a different set of strangers per tab.
 */

const DEMO_THREAD_ID = 'demo-thread';

// ─── Chat ────────────────────────────────────────────────────────────────────

export function demoChatMessages(): ChatMessage[] {
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
  const runner = (i: number) => DEMO_RUNNERS[i];

  return [
    {
      id: 'demo-msg-1',
      threadId: DEMO_THREAD_ID,
      senderId: 'system',
      senderName: 'Runturfing',
      type: 'system',
      text: 'Season Group formed. 6 runners, 14 days on the clock.',
      reactions: [],
      createdAt: ago(60 * 26),
    },
    {
      id: 'demo-msg-2',
      threadId: DEMO_THREAD_ID,
      senderId: runner(4).userId,
      senderName: runner(4).name,
      type: 'territory_event',
      eventType: 'defended_loop',
      text: `${runner(4).name} held the loop around Jurong Lake Gardens for a third night running.`,
      reactions: [{ emoji: '🔥', count: 3, userReacted: false }],
      createdAt: ago(60 * 20),
    },
    {
      id: 'demo-msg-3',
      threadId: DEMO_THREAD_ID,
      senderId: runner(3).userId,
      senderName: runner(3).name,
      type: 'text',
      text: 'anyone running the west loop tonight? cutting it close on my threshold',
      reactions: [],
      createdAt: ago(60 * 18),
    },
    {
      id: 'demo-msg-4',
      threadId: DEMO_THREAD_ID,
      senderId: DEMO_ME.userId,
      senderName: DEMO_ME.name,
      type: 'text',
      text: "I'll be out around 7, can swing past there",
      reactions: [{ emoji: '💪', count: 1, userReacted: true }],
      createdAt: ago(60 * 17),
    },
    {
      id: 'demo-msg-5',
      threadId: DEMO_THREAD_ID,
      senderId: runner(5).userId,
      senderName: runner(5).name,
      type: 'territory_event',
      eventType: 'lost_corridor',
      text: `${runner(5).name} lost the corridor along Boon Lay Way overnight.`,
      reactions: [],
      createdAt: ago(60 * 9),
    },
    {
      id: 'demo-msg-6',
      threadId: DEMO_THREAD_ID,
      senderId: runner(2).userId,
      senderName: runner(2).name,
      type: 'text',
      text: 'rip. contested corridors decay fast, need two of us on it',
      reactions: [],
      createdAt: ago(60 * 8),
    },
    {
      id: 'demo-msg-7',
      threadId: DEMO_THREAD_ID,
      senderId: DEMO_ME.userId,
      senderName: DEMO_ME.name,
      type: 'territory_event',
      eventType: 'new_claim',
      text: 'You claimed 4 new cells near the centre.',
      reactions: [{ emoji: '🎯', count: 2, userReacted: false }],
      createdAt: ago(5),
    },
    {
      id: 'demo-msg-8',
      threadId: DEMO_THREAD_ID,
      senderId: runner(1).userId,
      senderName: runner(1).name,
      type: 'text',
      text: 'nice pace on that one 👀',
      reactions: [],
      createdAt: ago(3),
    },
  ];
}

// ─── Profile: stats, recent runs, social accounts ───────────────────────────

/**
 * The parts of `UserProfile` that rank/influence (from `demoProfile` in
 * demoTerritory.ts) do not cover. `cells` keeps "Cells Owned" consistent with
 * whatever the demo territory actually shows on the map, rather than a
 * separately hardcoded number that could disagree with it.
 */
export function demoProfileExtras(cells: TerritoryCell[]): {
  stats: ProfileStats;
  recentRuns: Run[];
  socialAccounts: SocialAccount[];
} {
  const mine = cells.filter((c) => c.isYours);
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);

  const stats: ProfileStats = {
    totalRuns: 34,
    totalKm: 148.6,
    totalCells: mine.length,
    currentStreak: 6,
    longestStreak: 14,
    seasonsCompleted: 2,
    payoutsReceived: 1,
  };

  // Newest first, matching what listRuns/recentRuns render as.
  const runs: Array<[daysAgo: number, km: number, minPerKm: number, claimed: number, defended: number, lost: number]> = [
    [0, 5.8, 5.6, 4, 1, 0],
    [1, 3.2, 6.1, 2, 0, 0],
    [2, 8.4, 5.9, 6, 2, 1],
    [4, 4.6, 6.4, 1, 3, 0],
    [5, 6.1, 5.7, 3, 0, 0],
    [7, 9.9, 6.0, 7, 1, 2],
  ];

  const recentRuns: Run[] = runs.map(([d, km, pace, claimed, defended, lost], i) => {
    const distanceMeters = Math.round(km * 1000);
    const durationSeconds = Math.round(km * pace * 60);
    const started = daysAgo(d);
    const ended = new Date(started.getTime() + durationSeconds * 1000);
    return {
      id: `demo-run-${i + 1}`,
      userId: DEMO_ME.userId,
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      distanceMeters,
      durationSeconds,
      cellsUpdated: claimed + defended,
      newCellsClaimed: claimed,
      cellsDefended: defended,
      cellsLost: lost,
    };
  });

  const socialAccounts: SocialAccount[] = [
    {
      platform: 'strava',
      handle: 'cpt.you',
      verified: true,
      linkedAt: daysAgo(40).toISOString(),
    },
  ];

  return { stats, recentRuns, socialAccounts };
}

// ─── Season, entry, group ────────────────────────────────────────────────────

const DEMO_SEASON_ID = 'demo-season-1';
const DEMO_GROUP_ID = 'demo-group-1';

export function demoSeason(): Season {
  const now = Date.now();
  return {
    id: DEMO_SEASON_ID,
    number: 7,
    status: 'active',
    startsAt: new Date(now - 4 * 86_400_000).toISOString(),
    endsAt: new Date(now + 10 * 86_400_000).toISOString(),
    poolAmount: 84_000, // cents; renders as $840.00
    currency: 'sgd',
    kind: 'standard',
    name: null,
    entryFeeCents: 0, // entry is free
  };
}

export function demoSeasonEntry(): SeasonEntry {
  return {
    id: 'demo-entry-1',
    seasonId: DEMO_SEASON_ID,
    userId: DEMO_ME.userId,
    groupId: DEMO_GROUP_ID,
    status: 'active',
    bidAmount: 2_000,
    thresholdProgress: {
      runsCompleted: 3,
      runsRequired: 4,
      kmCompleted: 14.2,
      kmRequired: 20,
      activeDays: 2,
      activeDaysRequired: 3,
      isMet: false,
    },
  };
}

export function demoSeasonGroup(): SeasonGroup {
  const members: SeasonGroupMember[] = DEMO_RUNNERS.slice(0, 5).map((r, i) => ({
    userId: r.userId,
    displayName: r.name,
    gender: i % 2 === 0 ? 'male' : 'female',
    runsCompleted: 3 + i,
    totalKm: Math.round((12 + i * 3.4) * 10) / 10,
    activeDays: 2 + (i % 3),
    thresholdMet: i % 2 === 0,
    isEligibleForPayout: i % 3 !== 0,
    socialLinked: i % 2 === 1,
  }));

  members.push({
    userId: DEMO_ME.userId,
    displayName: DEMO_ME.name,
    gender: 'male',
    runsCompleted: 3,
    totalKm: 14.2,
    activeDays: 2,
    thresholdMet: false,
    isEligibleForPayout: false,
    socialLinked: true,
  });

  return {
    id: DEMO_GROUP_ID,
    seasonId: DEMO_SEASON_ID,
    members,
    totalMileage: Math.round(members.reduce((s, m) => s + m.totalKm, 0) * 10) / 10,
    rank: 2,
  };
}

// ─── Runfluence referrals ────────────────────────────────────────────────────

export function demoReferrals() {
  return {
    code: 'CPT4R7', // avoids 0/O/1/I/L, same alphabet the backend issues from
    signedUp: 5,
    paidEntries: 2,
    paidWomen: 1,
    multiplier: 1.15,
    maxMultiplier: 2,
    perReferralBonus: 0.05,
    perWomanBonus: 0.05,
    atCap: false,
    referredBy: null as string | null,
  };
}

// ─── Orientation: institution standings ─────────────────────────────────────

const DEMO_SCHOOLS: Array<Pick<InstitutionStanding, 'slug' | 'name' | 'shortName' | 'kind' | 'color'> & {
  turfCells: number;
  totalKm: number;
  runners: number;
  activeRunners: number;
}> = [
  { slug: 'nus', name: 'National University of Singapore', shortName: 'NUS', kind: 'university', color: '#003D7C', turfCells: 812, totalKm: 3410, runners: 96, activeRunners: 41 },
  { slug: 'ntu', name: 'Nanyang Technological University', shortName: 'NTU', kind: 'university', color: '#8B1D41', turfCells: 754, totalKm: 3120, runners: 88, activeRunners: 37 },
  { slug: 'smu', name: 'Singapore Management University', shortName: 'SMU', kind: 'university', color: '#8A1538', turfCells: 401, totalKm: 1680, runners: 44, activeRunners: 19 },
  { slug: 'np', name: 'Ngee Ann Polytechnic', shortName: 'NP', kind: 'polytechnic', color: '#00539B', turfCells: 366, totalKm: 1502, runners: 51, activeRunners: 22 },
  { slug: 'tp', name: 'Temasek Polytechnic', shortName: 'TP', kind: 'polytechnic', color: '#004B87', turfCells: 298, totalKm: 1190, runners: 39, activeRunners: 16 },
  { slug: 'sp', name: 'Singapore Polytechnic', shortName: 'SP', kind: 'polytechnic', color: '#7A1F2B', turfCells: 244, totalKm: 980, runners: 33, activeRunners: 12 },
  { slug: 'sutd', name: 'Singapore University of Technology and Design', shortName: 'SUTD', kind: 'university', color: '#EE7203', turfCells: 187, totalKm: 760, runners: 21, activeRunners: 9 },
  { slug: 'rp', name: 'Republic Polytechnic', shortName: 'RP', kind: 'polytechnic', color: '#00A0DF', turfCells: 129, totalKm: 540, runners: 18, activeRunners: 7 },
];

export function demoInstitutionStandings(): { standings: InstitutionStanding[]; rankedBy: string } {
  const standings: InstitutionStanding[] = DEMO_SCHOOLS.map((s, i) => ({
    id: `demo-inst-${s.slug}`,
    slug: s.slug,
    name: s.name,
    shortName: s.shortName,
    kind: s.kind,
    color: s.color,
    rank: i + 1,
    runners: s.runners,
    activeRunners: s.activeRunners,
    turfCells: s.turfCells,
    totalKm: s.totalKm,
  }));
  return { standings, rankedBy: 'turfCells' };
}

/** No school opted in by default — same "invite is what's missing" state a fresh account is in. */
export function demoMyInstitution(): MyInstitution {
  return {
    institution: null,
    setAt: null,
    locked: false,
    contribution: null,
  };
}
