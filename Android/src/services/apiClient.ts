import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {
  AuthTokens,
  TerritoryViewport,
  GroupLeaderboardPage,
  GroupMetric,
  LeaderboardPage,
  LeaderboardScope,
  LeaderboardType,
  PerpetualMetric,
  SeasonalMetric,
  Season,
  SeasonEntry,
  SeasonGroup,
  ChatMessage,
  UserProfile,
  WalletTransaction,
  Run,
  Rank,
  RankLadders,
  Institution,
  InstitutionStanding,
  MyInstitution,
} from '../types';

const BASE_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://your-backend.railway.app';

// The backend mounts all routers under /v1 (see Backend/api/main.py).
const API_ROOT = `${BASE_URL}/v1`;

const TOKEN_KEY = 'runfluence_access_token';
const REFRESH_KEY = 'runfluence_refresh_token';

// Backend returns snake_case auth payloads; map them to our camelCase tokens.
interface BackendAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user?: Record<string, unknown>;
}

export function normalizeAuthResponse(raw: BackendAuthResponse): AuthTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_at ? new Date(raw.expires_at).getTime() : 0,
  };
}

// ─── Axios instance ──────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: API_ROOT,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refresh) throw new Error('no refresh token');
        const { data } = await axios.post<BackendAuthResponse>(`${API_ROOT}/auth/refresh`, {
          refresh_token: refresh,
        });
        const tokens = normalizeAuthResponse(data);
        await saveTokens(tokens);
        original.headers = {
          ...original.headers,
          Authorization: `Bearer ${tokens.accessToken}`,
        };
        return api(original);
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(REFRESH_KEY);
        // "Let the auth store handle redirect" was the old comment here, and
        // nothing did. The app sat on the map with a dead session while every
        // request 401'd, and the only symptom was a generic "could not save"
        // toast — which is exactly how a recorded run got lost.
        onSessionExpired?.();
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Called once when a session is unrecoverable. Set by the auth store, which
 * owns sign-out and navigation; keeping the reference here avoids importing
 * the store into the client and creating a cycle.
 */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

// ─── Token helpers ───────────────────────────────────────────────────────────

export async function saveTokens(tokens: AuthTokens) {
  await SecureStore.setItemAsync(TOKEN_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  signInWithApple: (identityToken: string, fullName?: string) =>
    api.post<BackendAuthResponse>('/auth/apple', { identity_token: identityToken, full_name: fullName }),

  signInWithEmail: (email: string, password: string) =>
    api.post<BackendAuthResponse>('/auth/login', { email, password }),

  registerWithEmail: (email: string, password: string, displayName: string, gender: string, dob: string) =>
    api.post<BackendAuthResponse>('/auth/register', { email, password, display_name: displayName, gender, date_of_birth: dob }),

  refresh: (refreshToken: string) =>
    api.post<BackendAuthResponse>('/auth/refresh', { refresh_token: refreshToken }),

  registerPushToken: (expoPushToken: string) =>
    api.post('/auth/push-token', { token: expoPushToken, platform: 'android' }),

  logout: () => api.post('/auth/logout'),
};

// ─── Runs ────────────────────────────────────────────────────────────────────

// Import bodies are snake_case because that is what the backend model expects
// (Backend/api/routes/runs.py RunImportRequest); responses come back camelCase.
// 'healthkit' rather than 'health_connect' — the runs.source CHECK constraint
// in migration 001 allows healthkit, manual and live_tracking only.
export const runsApi = {
  importRun: (run: {
    source: 'healthkit' | 'live_tracking' | 'manual';
    started_at: string;
    ended_at: string;
    distance_meters: number;
    duration_seconds: number;
    encoded_polyline: string;
    elevation_gain_meters?: number;
    healthkit_workout_id?: string;
  }) => api.post<Run & { status: string }>('/runs/import', run),

  listRuns: (page = 1, pageSize = 20) =>
    api.get<{ runs: Run[]; total: number }>('/runs', { params: { page, page_size: pageSize } }),

  getRun: (runId: string) => api.get<Run>(`/runs/${runId}`),
};

// ─── Territory ───────────────────────────────────────────────────────────────

export const territoryApi = {
  getViewport: (params: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
    userId?: string;
  }) => api.get<TerritoryViewport>('/territory/viewport', { params }),

  getUserCells: (userId: string) =>
    api.get<TerritoryViewport>(`/territory/user/${userId}`),

  getCellDetail: (h3Index: string) =>
    api.get(`/territory/cell/${h3Index}`),
};

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export const leaderboardApi = {
  get: (params: {
    type: LeaderboardType;
    metric: PerpetualMetric | SeasonalMetric;
    scope: LeaderboardScope;
    page?: number;
    pageSize?: number;
    seasonId?: string;
  }) => api.get<LeaderboardPage>('/leaderboard', { params }),

  /**
   * The intergroup board: groups of six ranked against each other. A different
   * board from `get` above, which ranks individuals openly across the season.
   */
  getGroups: (params: { metric?: GroupMetric; seasonId?: string; page?: number; pageSize?: number }) =>
    api.get<GroupLeaderboardPage>('/leaderboard/groups', { params }),
};

// ─── Institutions ────────────────────────────────────────────────────────────

export const institutionsApi = {
  // The list and the standings are unauthenticated on the backend, so both work
  // during onboarding before a token exists.
  list: () => api.get<Institution[]>('/institutions'),

  getStandings: () =>
    api.get<{ standings: InstitutionStanding[]; rankedBy: string }>(
      '/institutions/standings'
    ),

  getMine: () => api.get<MyInstitution>('/institutions/me'),

  // Slug, matching the /join/<slug> share links. Pass null to clear the opt-in.
  setMine: (slug: string | null) =>
    api.put<{ institution: Institution | null; locked: boolean }>(
      '/institutions/me', { slug }
    ),
};

// ─── Seasons ─────────────────────────────────────────────────────────────────

// Backend/api/routes/seasons.py's GET /{season_id}/my-group returns snake_case
// fields that don't line up with SeasonGroup's camelCase shape (and doesn't
// echo season_id at all), so the response is remapped here the same way
// normalizeAuthResponse remaps the auth payload.
function normalizeSeasonGroup(raw: any, seasonId: string): SeasonGroup {
  return {
    id: raw.id,
    seasonId,
    chatThreadId: raw.chat_thread_id ?? undefined,
    totalMileage: raw.total_mileage_km ?? 0,
    rank: 0,
    members: (raw.members ?? []).map((m: any) => ({
      userId: m.user_id,
      displayName: m.display_name,
      avatarUrl: m.avatar_url ?? undefined,
      gender: m.gender ?? 'other',
      runsCompleted: m.runs_completed ?? 0,
      totalKm: m.mileage ?? 0,
      activeDays: m.active_days ?? 0,
      thresholdMet: m.threshold_met ?? false,
      isEligibleForPayout: m.is_eligible_for_payout ?? false,
      socialLinked: m.social_linked ?? false,
    })),
  };
}

export const seasonsApi = {
  getCurrent: () => api.get<Season>('/seasons/current'),

  getMyEntry: () => api.get<SeasonEntry>('/seasons/my-entry'),

  // The backend route takes season_id in the path (there is no bare
  // /seasons/my-group) — see Backend/api/routes/seasons.py:69.
  getMyGroup: (seasonId: string) =>
    api.get(`/seasons/${seasonId}/my-group`).then((r) => ({
      ...r,
      data: normalizeSeasonGroup(r.data, seasonId),
    })),

  // Entering is free, so this only names which season. Safe to call twice:
  // the server returns the existing entry with already_entered set rather than
  // failing, which matters because a run inside the season window enters the
  // runner without anyone pressing anything. entry_fee_cents is always 0 and
  // paid is always true; both are kept so older builds keep parsing.
  join: (seasonId: string) =>
    api.post<SeasonEntry & { entry_fee_cents: number; paid: boolean; already_entered: boolean }>(
      '/seasons/join',
      { season_id: seasonId },
    ),

  bid: (seasonId: string, targetUserId: string, amount: number) =>
    api.post('/seasons/bid', { season_id: seasonId, target_user_id: targetUserId, amount }),

  listPast: () => api.get<Season[]>('/seasons/past'),
};

// ─── Chat ────────────────────────────────────────────────────────────────────

// Backend/api/routes/chat.py's GET /{thread_id}/messages returns a bare array
// of snake_case rows (not {messages, hasMore}), each reaction is one row per
// user (not pre-aggregated), and POST expects {body} not {text}. All of that
// is remapped here so the screen can work in ChatMessage/MessageReaction shape.
const CHAT_PAGE_SIZE = 50; // matches the LIMIT hardcoded in chat.py — the API
// doesn't yet take a limit param, so this is what "more may exist" is judged against.

function normalizeChatMessage(raw: any, currentUserId: string): ChatMessage {
  const isEvent = raw.message_type === 'territory_event';
  const reactionsByEmoji = new Map<string, { count: number; userReacted: boolean }>();
  for (const rx of raw.reactions ?? []) {
    const entry = reactionsByEmoji.get(rx.emoji) ?? { count: 0, userReacted: false };
    entry.count += 1;
    if (String(rx.user_id) === String(currentUserId)) entry.userReacted = true;
    reactionsByEmoji.set(rx.emoji, entry);
  }

  return {
    id: raw.id,
    threadId: raw.thread_id,
    senderId: raw.sender_id ?? '',
    senderName: raw.sender_name ?? 'System',
    type: raw.message_type,
    text: raw.body,
    eventType: isEvent ? raw.event_payload?.event_type : undefined,
    eventData: raw.event_payload ?? undefined,
    reactions: Array.from(reactionsByEmoji.entries()).map(([emoji, r]) => ({ emoji, ...r })),
    createdAt: raw.sent_at,
  };
}

export const chatApi = {
  getMessages: (threadId: string, currentUserId: string, before?: string) =>
    api
      .get<any[]>(`/chat/${threadId}/messages`, { params: { before } })
      .then((r) => ({
        ...r,
        data: {
          messages: r.data.map((m) => normalizeChatMessage(m, currentUserId)),
          hasMore: r.data.length >= CHAT_PAGE_SIZE,
        },
      })),

  sendMessage: (threadId: string, text: string) =>
    api.post<{ id: string; thread_id: string; body: string; sent_at: string }>(
      `/chat/${threadId}/messages`,
      { body: text }
    ),

  addReaction: (messageId: string, emoji: string) =>
    api.post(`/chat/messages/${messageId}/reactions`, { emoji }),
};

// ─── Profile ─────────────────────────────────────────────────────────────────

export const profileApi = {
  getMe: () => api.get<UserProfile>('/profiles/me'),

  getUser: (userId: string) => api.get<UserProfile>(`/profiles/${userId}`),

  updateMe: (updates: Partial<{ displayName: string; city: string; avatarUrl: string }>) =>
    api.patch<UserProfile>('/profiles/me', updates),

  // Handle only. Proving ownership is a separate OAuth flow per platform and
  // is the only thing that sets verified = true.
  linkSocial: (platform: string, handle: string) =>
    api.post<{ platform: string; handle: string; verified: boolean }>(
      '/profiles/me/social', { platform, handle }
    ),

  unlinkSocial: (platform: string) =>
    api.delete(`/profiles/me/social/${platform}`),

  updatePrivacy: (settings: Record<string, boolean>) =>
    api.patch('/profiles/me/privacy', settings),

  getReferrals: () =>
    api.get<{
      code: string;
      signedUp: number;
      paidEntries: number;
      paidWomen: number;
      multiplier: number;
      maxMultiplier: number;
      perReferralBonus: number;
      perWomanBonus: number;
      atCap: boolean;
      referredBy: string | null;
    }>('/profiles/me/referrals'),

  redeemReferral: (code: string) =>
    api.post('/profiles/me/referrals/redeem', { code }),

  // The runner's rung plus both ladders. /profiles/me already carries the rank
  // itself; this is for a screen that wants to draw the whole progression.
  getRank: () => api.get<{ rank: Rank; ladders: RankLadders }>('/profiles/me/rank'),

  report: (targetUserId: string, reason: string) =>
    api.post('/moderation/report', { target_user_id: targetUserId, reason }),

  block: (targetUserId: string) =>
    api.post('/moderation/block', { target_user_id: targetUserId }),
};

// ─── Wallet ──────────────────────────────────────────────────────────────────

export const walletApi = {
  getBalance: () => api.get<{ balance: number; currency: string }>('/wallet/balance'),

  getTransactions: (page = 1) =>
    api.get<{ transactions: WalletTransaction[]; total: number }>('/wallet/transactions', {
      params: { page },
    }),

  createPaymentIntent: (amount: number, currency = 'usd') =>
    api.post<{ clientSecret: string }>('/wallet/payment-intent', { amount, currency }),
};

export default api;
