// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  gender?: 'male' | 'female' | 'other';
  city?: string;
  metro?: string;
  createdAt: string;
  isVerified: boolean;
  isBanned: boolean;
  ageVerified: boolean;
}

// ─── Territory ───────────────────────────────────────────────────────────────

export type CellState =
  | 'neutral'
  | 'visited'
  | 'familiar'
  | 'claimed'
  | 'defended'
  | 'contested'
  | 'decaying';

export interface TerritoryCell {
  h3Index: string;
  lat: number;
  lng: number;
  /** Real H3 hex outline as [lat, lng] pairs, computed server-side. */
  boundary?: Array<[number, number]>;
  state: CellState;
  ownerUserId?: string;
  ownerDisplayName?: string;
  /** The holder's picture, drawn on the cell. Falls back to their initial. */
  ownerAvatarUrl?: string;
  score: number;
  lifetimeMeters: number;
  thirtyDayMeters: number;
  uniqueActiveDays: number;
  lastSeen: string;
  isContested: boolean;
  /** Your own score in this cell, 0 if you have never run it. */
  yourScore?: number;
  yourState?: CellState;
  /** True when you are the leader here. */
  isYours?: boolean;
  /** Points between you and the leader. 0 when it is already yours. */
  pointsBehind?: number;
  /**
   * How much of the ring around this cell the same leader also holds, 0..1.
   * Drives the fill weight, so a stronghold paints as one dense region rather
   * than a scattering of equally-coloured tiles.
   */
  leaderDensity?: number;
  /** Cells the same leader holds within two steps, this one included. */
  strongholdSize?: number;
  /** The densest cell of this leader's patch — where the label is drawn. */
  isStrongholdCore?: boolean;
}

export interface ZoneSummary {
  id: string;
  name: string;
  cellCount: number;
  totalMeters: number;
  state: CellState;
  centroidLat: number;
  centroidLng: number;
}

export interface TerritoryViewport {
  cells: TerritoryCell[];
  zones: ZoneSummary[];
  userStats: {
    totalCells: number;
    claimedCells: number;
    contestedCells: number;
    totalMeters: number;
  };
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export interface Run {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  durationSeconds: number;
  routeEncoded?: string; // polyline
  cellsUpdated: number;
  newCellsClaimed: number;
  cellsDefended: number;
  cellsLost: number;
}

export interface LiveTrackingPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

/**
 * `group` narrows the individual board to the six a runner was matched with.
 * It is a lens on the open board, not a separate competition — the rank a
 * runner is actually competing for is the unscoped one. 'friends' is the old
 * name for the same filter and the backend still answers it.
 */
export type LeaderboardScope = 'global' | 'city' | 'group' | 'friends';

/**
 * Three boards, and they measure different things.
 *
 *   perpetual  every runner, all time. Never scoped to a season.
 *   seasonal   every runner IN the season, ranked against each other. Open,
 *              not per group — a runner's season standing is their place among
 *              everyone who entered, not their place among their own six.
 *   groups     the intergroup board. Groups of six ranked against each other on
 *              the season total. This is the competition the season is built
 *              on; the seasonal board is the individual one running alongside.
 */
export type LeaderboardType = 'perpetual' | 'seasonal';
export type LeaderboardBoard = LeaderboardType | 'groups';
export type PerpetualMetric =
  | 'alltime_mileage'
  | 'mileage_90d'
  | 'territory_held'
  // The moving average of cells you have any live score in. Every other
  // territory metric is winner-takes-all, so being narrowly second across a
  // neighbourhood scores nothing; this one counts that ground.
  | 'influence_ma'
  | 'cells_led'
  | 'rank'
  | 'streak';
export type SeasonalMetric = 'season_mileage' | 'territory_control' | 'defense_consistency' | 'threshold_progress';

/** What the intergroup board can sort on. A subset of the seasonal metrics. */
export type GroupMetric = 'season_mileage' | 'territory_control' | 'defense_consistency';

export interface GroupStanding {
  rank: number;
  groupId: string;
  /** Matched groups are usually unnamed, so the server falls back to a number. */
  groupName: string;
  seasonId: string;
  /** Counted, not assumed to be six: a group mid-match has fewer. */
  members: number;
  value: number;
  unit: string;
  isMyGroup: boolean;
}

export interface GroupLeaderboardPage {
  entries: GroupStanding[];
  /** The caller's own group, present only when it fell outside the page. */
  myGroup: GroupStanding | null;
  metric: GroupMetric;
  unit: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  city?: string;
  value: number;
  unit: string;
  delta?: number; // rank change
  isCurrentUser: boolean;
  /** SAF ladder standing, carried on every row whatever the sort metric is. */
  rankTrack?: RankTrack;
  rankCode?: string;
  rankIndex?: number;
  influenceCells?: number;
  influenceMa7?: number;
  influenceMa30?: number;
  cellsLed?: number;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  currentUserEntry?: LeaderboardEntry;
  totalCount: number;
  page: number;
  pageSize: number;
}

// ─── Institutions ────────────────────────────────────────────────────────────

export type InstitutionKind = 'university' | 'polytechnic' | 'ite' | 'arts';

export interface Institution {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  kind: InstitutionKind;
  color: string;
}

/**
 * A school's row on the orientation table, sorted on `turfCells` with `totalKm`
 * breaking ties. `runners` and `activeRunners` are context, not part of the
 * score: dividing by them would mean each extra entrant could only drag a
 * school down, which is the wrong incentive for a season built on invites.
 */
export interface InstitutionStanding extends Institution {
  rank: number;
  runners: number;
  activeRunners: number;
  turfCells: number;
  totalKm: number;
}

export interface MyInstitution {
  institution: Institution | null;
  setAt?: string | null;
  /** True once the season starts. Switching schools mid-season is not allowed. */
  locked: boolean;
  teammates?: number;
  contribution: { turfCells: number; km: number } | null;
}

// ─── Season ──────────────────────────────────────────────────────────────────

export type SeasonStatus = 'upcoming' | 'active' | 'ended' | 'settling';

/** Standard seasons are the paid groups-of-6. Orientation seasons score schools. */
export type SeasonKind = 'standard' | 'orientation';

export interface Season {
  id: string;
  number: number;
  status: SeasonStatus;
  startsAt: string;
  endsAt: string;
  poolAmount: number;
  currency: string;
  kind?: SeasonKind;
  name?: string | null;
  entryFeeCents?: number;
}

export interface SeasonGroup {
  id: string;
  seasonId: string;
  chatThreadId?: string;
  members: SeasonGroupMember[];
  totalMileage: number;
  rank: number;
}

export interface SeasonGroupMember {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  gender: 'male' | 'female' | 'other';
  runsCompleted: number;
  totalKm: number;
  activeDays: number;
  thresholdMet: boolean;
  isEligibleForPayout: boolean;
  socialLinked: boolean;
}

export interface SeasonEntry {
  id: string;
  seasonId: string;
  userId: string;
  groupId?: string;
  status: 'pending' | 'matched' | 'active' | 'completed' | 'refunded';
  bidAmount: number;
  payoutAmount?: number;
  refundAmount?: number;
  thresholdProgress: ThresholdProgress;
}

export interface ThresholdProgress {
  runsCompleted: number;
  runsRequired: number;
  kmCompleted: number;
  kmRequired: number;
  activeDays: number;
  activeDaysRequired: number;
  isMet: boolean;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'territory_event' | 'system';

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  type: MessageType;
  text: string;
  eventType?: TerritoryEventType;
  eventData?: Record<string, unknown>;
  reactions: MessageReaction[];
  createdAt: string;
}

export type TerritoryEventType =
  | 'defended_loop'
  | 'lost_corridor'
  | 'reclaimed_zone'
  | 'group_milestone'
  | 'new_claim'
  | 'season_start'
  | 'season_end';

export interface MessageReaction {
  emoji: string;
  count: number;
  userReacted: boolean;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface UserProfile {
  user: User;
  stats: ProfileStats;
  socialAccounts: SocialAccount[];
  recentRuns: Run[];
  territoryHistory: TerritoryHistoryEntry[];
  rank?: Rank;
  influence?: Influence;
}

// ─── Rank (SAF ladder) ───────────────────────────────────────────────────────

/**
 * A runner sits on exactly one track. 'officer' is earned by distance and speed
 * compounding; 'specialist' is earned by regularity. Clearing the officer gate
 * moves you across, because that is the only ladder that reaches the stars.
 */
export type RankTrack = 'officer' | 'specialist';

export interface Rank {
  track: RankTrack;
  code: string;
  name: string;
  index: number;
  stars: number;
  points: number;
  nextCode: string | null;
  nextName: string | null;
  pointsToNext: number | null;
  /** 0..1 through the current rung. */
  progress: number;
  officerEligible: boolean;
}

export interface RankLadderRung {
  code: string;
  name: string;
  stars: number;
  points: number;
}

export interface RankLadders {
  officer: RankLadderRung[];
  specialist: RankLadderRung[];
  gate: { minKm: number; minSpeedKmh: number };
}

export interface Influence {
  cellsNow: number;
  cellsAtLastSnapshot: number;
  movingAverage7: number;
  movingAverage30: number;
  cellsLed: number;
  series: Array<{ date: string; cells: number }>;
}

export interface ProfileStats {
  totalRuns: number;
  totalKm: number;
  totalCells: number;
  currentStreak: number;
  longestStreak: number;
  seasonsCompleted: number;
  payoutsReceived: number;
}

export interface SocialAccount {
  platform: 'instagram' | 'tiktok' | 'twitter' | 'strava';
  handle: string;
  verified: boolean;
  linkedAt: string;
}

export interface TerritoryHistoryEntry {
  date: string;
  cellsClaimed: number;
  cellsLost: number;
  cellsDefended: number;
  kmRun: number;
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

export interface WalletTransaction {
  id: string;
  type: 'bid' | 'payout' | 'refund' | 'credit';
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  description: string;
  createdAt: string;
}
