import { Platform } from 'react-native';

/**
 * Vivid Retro-Digital — the "Luminous Industrial Void" aesthetic.
 *
 * Foundation: Midnight Void (#000000) canvas. Vibrant single-color accents
 * punch through. White text dominates, accents are used one-at-a-time per
 * surface (the "black, white, and one" rule).
 */

export const VoidColors = {
  // Surfaces
  void: '#000000',
  surface: '#353535',
  surfaceElevated: '#1a1a1a',

  // Text
  pureWhite: '#ffffff',
  mutedAsh: '#999999',
  inkFaint: '#4a4a4a',
  offBlackText: '#0a0a0a',

  // Borders / dividers
  ghostlyGray: '#e5e5e5',
  ghostlyDim: 'rgba(229,229,229,0.18)',

  // Accents — use one at a time, never adjacent
  luminousGreen: '#03e65b',
  deepViolet: '#6e60ee',
  electricYellow: '#ffc533',
  vividCrimson: '#ff3386',
  sunsetRed: '#ff5d4b',

  // Status
  error: '#ff3386',
  success: '#03e65b',
  overlay: 'rgba(0,0,0,0.7)',
} as const;

/**
 * Rotation used to colorize repeating cards (book covers, category chips).
 * Indexed by stable hash so the same book always gets the same accent.
 */
export const AccentRotation = [
  VoidColors.vividCrimson,
  VoidColors.electricYellow,
  VoidColors.luminousGreen,
  VoidColors.deepViolet,
  VoidColors.sunsetRed,
] as const;

export function pickAccent(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AccentRotation[Math.abs(h) % AccentRotation.length];
}

/**
 * Type system. Custom display fonts (canvaSans, leoSans) aren't bundled —
 * we lean on system condensed sans-serif and rely on heavy weight + negative
 * tracking to approximate the leoSans feel.
 */
export const VoidFonts = {
  display: Platform.select({
    ios: 'Helvetica Neue',
    android: 'sans-serif-condensed',
    default: 'system-ui',
  }),
  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'system-ui',
  }),
} as const;

export const VoidWeight = {
  regular: '400' as const,
  medium: '500' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
};

/**
 * Display type uses heavy weight + tight negative tracking. Sizes are
 * proportional — values are in px-equivalent units for RN.
 */
export const VoidType = {
  caption: { fontSize: 10, lineHeight: 11, letterSpacing: 0.4 },
  body: { fontSize: 14, lineHeight: 17 },
  subheading: { fontSize: 18, lineHeight: 22 },
  headingSm: { fontSize: 22, lineHeight: 22, letterSpacing: -0.22 },
  heading: { fontSize: 39, lineHeight: 35, letterSpacing: -0.78 },
  headingLg: { fontSize: 59, lineHeight: 50, letterSpacing: -1.18 },
  display: { fontSize: 88, lineHeight: 70, letterSpacing: -2.0 },
};

export const VoidSpacing = {
  xs: 5,
  sm: 7,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 27,
  xxxl: 34,
  section: 41,
};

export const VoidRadius = {
  card: 8.4375,
  cardLg: 16.4375,
  cardXl: 20.4375,
  pill: 60,
  tag: 270,
};

/**
 * Pill button presets. Use `filled` for primary CTAs, `ghost` for secondary.
 */
export const VoidButton = {
  filled: {
    backgroundColor: VoidColors.pureWhite,
    color: VoidColors.void,
    borderRadius: VoidRadius.pill,
    paddingVertical: 7,
    paddingHorizontal: 20,
  },
  ghost: {
    backgroundColor: 'transparent',
    color: VoidColors.pureWhite,
    borderColor: VoidColors.pureWhite,
    borderWidth: 1,
    borderRadius: VoidRadius.pill,
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  accent: (accent: string) => ({
    backgroundColor: accent,
    color: VoidColors.void,
    borderRadius: VoidRadius.pill,
    paddingVertical: 7,
    paddingHorizontal: 20,
  }),
};
