import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  authApi,
  saveTokens,
  clearTokens,
  getStoredToken,
  normalizeAuthResponse,
  setSessionExpiredHandler,
} from '../services/apiClient';
import { User, AuthTokens } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  isHydrated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  hydrate: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    displayName: string,
    gender: string,
    dob: string
  ) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  clearError: () => void;
  devBypassLogin?: () => Promise<void>;
}

const USER_KEY = 'runfluence_user';

export const ALLOW_DEV_BYPASS =
  __DEV__ || process.env.EXPO_PUBLIC_ALLOW_DEV_BYPASS === 'true';

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isHydrated: false,
  isLoading: false,
  error: null,

  hydrate: async () => {
    // A token that no longer works — the account was removed, or the signing
    // key changed — must drop the app back to sign-in rather than leaving it
    // mounted with every request failing.
    setSessionExpiredHandler(() => {
      set({ token: null, user: null, error: 'Your session expired. Please sign in again.' });
      SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
    });

    try {
      const token = await getStoredToken();
      const userJson = await SecureStore.getItemAsync(USER_KEY);
      const user: User | null = userJson ? JSON.parse(userJson) : null;
      set({ token, user, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  loginWithEmail: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.signInWithEmail(email, password);
      await _handleAuthSuccess(normalizeAuthResponse(data), set);
    } catch (e: any) {
      set({ error: e?.response?.data?.detail ?? 'Login failed', isLoading: false });
      throw e;
    }
  },

  registerWithEmail: async (email, password, displayName, gender, dob) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.registerWithEmail(email, password, displayName, gender, dob);
      await _handleAuthSuccess(normalizeAuthResponse(data), set);
    } catch (e: any) {
      set({ error: e?.response?.data?.detail ?? 'Registration failed', isLoading: false });
      throw e;
    }
  },

  // Google Sign-In is not wired up server-side yet (no /auth/google route).
  // Kept on the interface so the UI can call it once the backend supports it.
  loginWithGoogle: async (_idToken) => {
    set({ error: 'Google sign-in is not available yet.' });
    throw new Error('Google sign-in not implemented');
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {}
    await clearTokens();
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null });
  },

  setUser: (user) => {
    set({ user });
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },

  clearError: () => set({ error: null }),

  // One-tap sign-in to the shared test account. This used to fake a session
  // with the literal token 'dev-bypass-token', which the server rejected with
  // 401 on every request — so the map showed no cells and recorded runs could
  // never upload, with a generic error as the only clue. It now performs a real
  // login and gets a real token; the only thing it skips is typing.
  //
  // Enabled in dev builds automatically, and in release builds only when
  // EXPO_PUBLIC_ALLOW_DEV_BYPASS is "true", so sideloaded test APKs can sign in
  // without a keyboard. Both that flag and these credentials are baked into the
  // bundle at build time and are therefore public — this MUST be false or
  // absent for any build that goes to the Play Store, and the account it points
  // at must stay disposable.
  ...(ALLOW_DEV_BYPASS
    ? {
        devBypassLogin: async () => {
          const email = process.env.EXPO_PUBLIC_DEV_ACCOUNT_EMAIL;
          const password = process.env.EXPO_PUBLIC_DEV_ACCOUNT_PASSWORD;

          if (!email || !password) {
            set({ error: 'No test account is configured in this build.' });
            return;
          }

          set({ isLoading: true, error: null });
          try {
            const { data } = await authApi.signInWithEmail(email, password);
            await _handleAuthSuccess(normalizeAuthResponse(data), set);
          } catch {
            // Same account every time, so territory accumulates across runs
            // instead of each tap starting from nothing.
            try {
              const { data } = await authApi.registerWithEmail(
                email, password, 'Herbert', 'prefer_not_to_say', '1990-01-01'
              );
              await _handleAuthSuccess(normalizeAuthResponse(data), set);
            } catch {
              set({ error: 'Could not reach the server to sign in.' });
            }
          } finally {
            set({ isLoading: false });
          }
        },
      }
    : {}),
}));

async function _handleAuthSuccess(
  tokens: AuthTokens,
  set: (partial: Partial<AuthState>) => void
) {
  await saveTokens(tokens);
  set({ token: tokens.accessToken, isLoading: false });
}

// Hydrate on module load
useAuthStore.getState().hydrate();
