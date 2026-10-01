import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export { SCREEN_WIDTH, SCREEN_HEIGHT };

// COLORS is the app-wide palette every screen imports. It was a dark theme; it
// now resolves to the neubrutalist system below, so the tab screens inherit the
// redesign without each one being rewritten. Keys are unchanged on purpose.
export const COLORS = {
  // Backgrounds — warm paper, not grey
  bg: '#FBFBF9',
  bgCard: '#FFFFFF',
  bgElevated: '#F3F1EA',
  bgInput: '#FFFFFF',

  // Brand. primary sits under white text in existing screens, so it stays a
  // dark-enough hue; yellow is reserved for CTAs styled explicitly.
  primary: '#432DD7',
  primaryLight: '#6C63FF',
  primaryDark: '#2E1D9E',

  // Territory states
  claimed: '#432DD7',
  defended: '#16A34A',
  contested: '#DC2626',
  decaying: '#D97706',
  familiar: '#2563EB',
  visited: '#60A5FA',
  neutral: '#9CA3AF',

  // Text — ink on paper
  textPrimary: '#1C293C',
  textSecondary: '#3F4A5C',
  textMuted: '#6B7280',
  textAccent: '#432DD7',

  // UI — borders are structural in this system, so they read as ink
  border: '#1C293C',
  borderLight: '#1C293C',
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',

  // Tab bar — ink slab, yellow active
  tabBar: '#1C293C',
  tabActive: '#FDC800',
  tabInactive: '#8C97A8',
};

// Neubrutalist token layer (v2 redesign) — warm surface, ink text, hard shadows.
// Shadow formula is always offset + zero blur; borders are thick and ink-colored.
export const NEO = {
  surface: '#FBFBF9',
  surfaceAlt: '#F3F1EA',
  ink: '#1C293C',
  black: '#111111',
  yellow: '#FDC800',
  violet: '#432DD7',
  violetSoft: '#6C63FF',
  green: '#16A34A',
  amber: '#D97706',
  red: '#DC2626',
  blue: '#2563EB',
  white: '#FFFFFF',
  borderWidth: 3,
  shadow: (color: string = '#111111') => ({ boxShadow: `4px 4px 0px ${color}` }),
  shadowLg: (color: string = '#111111') => ({ boxShadow: `6px 6px 0px ${color}` }),
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  mono: 'Courier',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  // Kept round: avatars and pills read as circles in every screen that uses it.
  full: 9999,
};

// Offset, never blurred. elevation stays 0 so Android does not add its own
// soft shadow underneath the hard one.
export const SHADOWS = {
  card: {
    boxShadow: '4px 4px 0px #111111',
    elevation: 0,
  },
  modal: {
    boxShadow: '6px 6px 0px #111111',
    elevation: 0,
  },
};

export const globalStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    // Sits on the violet button fill, so it must not follow textPrimary (ink).
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.bgInput,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  divider: {
    height: 2,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
  },
});
