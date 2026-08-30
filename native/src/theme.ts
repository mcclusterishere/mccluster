/**
 * HERE — the house palette, on device.
 *
 * These are not new values. They are the tokens from
 * docs/design/HERE-BRAND-LIBRARY.md, which the web side already builds
 * against, moved into the one place the native app reads them from. If the
 * library changes, this file changes, and nothing else does.
 *
 * The library's rules that this file exists to make enforceable:
 *   - Ruby marks action, live state, or registered emphasis. It is never
 *     general decoration, so there is no "ruby background" token.
 *   - Rounded glass is reserved for persistent system chrome. Editorial
 *     content uses rules, fields, frames and open space.
 *   - Minimum touch target is 44pt, and persistent controls clear the
 *     bottom safe area.
 */

export const color = {
  /** the ground everything sits on */
  stage: '#0a0807',
  /** one step up from the stage, for grouped rows and sheets */
  stageRaised: '#141010',
  /** the reading colour */
  paper: '#f4efe6',
  /** action, live state, registered emphasis. Nothing else. */
  ruby: '#e5383b',
  /** pressed and gradient-floor ruby */
  rubyDeep: '#9d121a',
  /** 20% paper — hairlines and separators */
  rule: 'rgba(244, 239, 230, 0.2)',
  /** 66% paper — secondary reading */
  quiet: 'rgba(244, 239, 230, 0.66)',
  /** 40% paper — captions, disabled, timestamps */
  fainter: 'rgba(244, 239, 230, 0.4)',
  /** a field, not a card: the library reserves glass for chrome */
  field: 'rgba(244, 239, 230, 0.045)',
  fieldPressed: 'rgba(244, 239, 230, 0.09)',
  /** the registered gold used on catalogue identifiers */
  gold: '#e8c877',
} as const;

/**
 * THE SAME TWO TYPEFACES AS EVERY OTHER HERE PAGE.
 *
 * Anton for declarations, Archivo for everything else — this is the exact
 * pairing css/style.css defines as --display/--sig and --body. The app
 * shipped without them for one build, reading as a generic system-font app
 * instead of HERE; assets/fonts/*.woff2 are converted to real .ttf (native
 * text engines render sfnt, not the browser-only WOFF2 wrapper) and loaded
 * in app/_layout.tsx via expo-font before anything paints.
 *
 * Anton is a single static weight, so it never takes a fontWeight prop —
 * asking a custom font file to fake-bold produces the slightly-smeared
 * double-stroke Android is notorious for. Archivo is loaded as three
 * separate named weights for the same reason; `family()` below picks the
 * right one instead of layering fontWeight over a static file.
 *
 * On web, Anton marks true headline moments — the "greet" hero line, track
 * names — not every heading. It stays exactly that scoped here: only
 * `display` and `displayLarge` use it. Screen titles, row titles and body
 * copy were already Archivo-equivalent in scale before this change; they
 * simply were not actually loading Archivo. That swap alone, with zero
 * layout change, is most of the fix.
 */
export function family(weight: 400 | 500 | 700): string {
  return weight === 700 ? 'Archivo-Bold' : weight === 500 ? 'Archivo-Medium' : 'Archivo-Regular';
}

type FontVariant = 'tabular-nums' | 'lining-nums' | 'oldstyle-nums'
  | 'small-caps' | 'proportional-nums';

export const type = {
  /** declarations: album name, track title on the Now Playing/Films stage */
  display: {
    fontFamily: 'Anton',
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: 0.2,
    textTransform: 'uppercase' as const,
  },
  displayLarge: {
    fontFamily: 'Anton',
    fontSize: 46,
    lineHeight: 47,
    letterSpacing: 0.2,
    textTransform: 'uppercase' as const,
  },
  /** screen titles */
  title: { fontFamily: family(700), fontSize: 22, lineHeight: 27, letterSpacing: -0.2 },
  /** row titles */
  row: { fontFamily: family(500), fontSize: 16, lineHeight: 21 },
  /** reading */
  body: { fontFamily: family(400), fontSize: 15, lineHeight: 22 },
  /** secondary reading */
  sub: { fontFamily: family(400), fontSize: 13, lineHeight: 18 },
  /** uppercase labels carry spacing, per the library */
  label: {
    fontFamily: family(700),
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  /** ISRC, QT6KV and every other technical identifier.
      fontVariant is typed rather than inferred: `as const` on the object
      would freeze it to a readonly tuple, which TextStyle will not take. */
  mono: {
    fontFamily: family(500),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    fontVariant: ['tabular-nums'] as FontVariant[],
  },
};

export const space = {
  /** the page gutter */
  gutter: 20,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 36,
} as const;

export const radius = {
  /** editorial content: frames, not pills */
  frame: 10,
  sheet: 18,
  /** persistent system chrome only */
  pill: 999,
} as const;

/** the library's floor, and the platform's floor, are the same number */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;

/**
 * THE MATERIALS. Not a native-app reinterpretation of HERE's look — the
 * literal values from css/style.css at the site's own source of truth,
 * carried over rather than approximated:
 *
 *   --metal: linear-gradient(165deg,#ff5a5c 0%,#e5383b 34%,#b3121b 58%,#ff6a6c 100%)
 *   .deckbar { background: linear-gradient(180deg, rgba(32,26,21,.88), rgba(14,11,9,.92));
 *              backdrop-filter: blur(14px);
 *              box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 18px 50px -14px rgba(0,0,0,.85); }
 *   .appbar  { background: linear-gradient(180deg, rgba(34,28,23,.82), rgba(16,13,11,.86));
 *              backdrop-filter: blur(22px) saturate(1.25);
 *              box-shadow: 0 18px 50px -12px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.14); }
 *   .alb__play { background: var(--metal);
 *                box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 14px 36px -14px rgba(229,56,59,.6); }
 *
 * React Native's `boxShadow` style prop (new architecture, which this app
 * runs with `newArchEnabled: true`) accepts the same CSS box-shadow syntax,
 * inset included — so these are the same strings, not a reconstruction.
 * expo-linear-gradient does not take a CSS angle, so METAL_ANGLE is the
 * closest start/end point pair to 165deg.
 */
export const METAL_COLORS = ['#ff5a5c', '#e5383b', '#b3121b', '#ff6a6c'] as const;
export const METAL_LOCATIONS = [0, 0.34, 0.58, 1] as const;
export const METAL_ANGLE = { start: { x: 0.1, y: 0 }, end: { x: 0.75, y: 1 } } as const;

export const GLASS_FILL = {
  /** the deckbar / cards: warmer, slightly lighter */
  panel: ['rgba(32,26,21,0.88)', 'rgba(14,11,9,0.92)'] as const,
  /** the appbar: a touch darker, so the persistent floor reads behind the deckbar */
  bar: ['rgba(34,28,23,0.82)', 'rgba(16,13,11,0.86)'] as const,
};

export const shadow = {
  /** the deckbar lifting off the page */
  panel: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 50px -14px rgba(0,0,0,0.85)',
  /** the appbar lifting off the page, slightly heavier */
  bar: '0 18px 50px -12px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.14)',
  /** the metal button: a specular top edge plus a tinted ruby glow beneath it */
  metal: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 14px 36px -14px rgba(229,56,59,0.6)',
  /** the small circular transport buttons (deckbar-scale, not hero-scale) */
  metalSmall: 'inset 0 1px 0 rgba(255,255,255,0.55)',
  /** a still image or card lifting off the stage */
  card: '0 22px 56px -18px rgba(0,0,0,0.95)',
} as const;

/**
 * THE ROOM: the ambient wash behind a screen. Ported from
 *   body.songpage { background:
 *     radial-gradient(140% 58% at 50% -10%, color-mix(pulse 18%, transparent), transparent 62%),
 *     radial-gradient(130% 46% at 50% 116%, color-mix(pulse 9%, transparent), transparent 58%),
 *     linear-gradient(180deg, #0d0a08 0%, #0a0807 42%, #070605 100%); }
 * React Native has no radial-gradient primitive, so the two pulse-tinted
 * radial glows are approximated as soft absolutely-positioned blurred
 * circles (see src/Room.tsx) sitting over the same three-stop vertical wash.
 */
export const ROOM_WASH = ['#0d0a08', '#0a0807', '#070605'] as const;
export const ROOM_WASH_LOCATIONS = [0, 0.42, 1] as const;

export const theme = {
  color, type, space, radius, MIN_TOUCH, HIT_SLOP,
  METAL_COLORS, METAL_LOCATIONS, METAL_ANGLE, GLASS_FILL, shadow,
  ROOM_WASH, ROOM_WASH_LOCATIONS,
};
export default theme;
