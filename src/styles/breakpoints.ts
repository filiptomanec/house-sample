// The one set of breakpoints, shared by CSS and JS. Desktop-first: a rule for narrower screens uses max-width.
//   sm  phones (portrait)        up to 640 px
//   md  tablets, large phones    up to 900 px
//   lg  small laptops, the navigation collapses into the menu    up to 1180 px
// CSS media queries cannot read variables, so the numbers are written out in @media rules. tokens.test.ts checks that
// every @media width in src/styles and src/app is one of these (max-width: N or min-width: N + 1), and that tokens.css agrees.

export const BREAKPOINTS = { sm: 640, md: 900, lg: 1180 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

/** Media query strings for matchMedia / useSyncExternalStore. */
export const MQ = {
  maxSm: `(max-width: ${BREAKPOINTS.sm}px)`,
  maxMd: `(max-width: ${BREAKPOINTS.md}px)`,
  maxLg: `(max-width: ${BREAKPOINTS.lg}px)`,
  minSm: `(min-width: ${BREAKPOINTS.sm + 1}px)`,
  minMd: `(min-width: ${BREAKPOINTS.md + 1}px)`,
  minLg: `(min-width: ${BREAKPOINTS.lg + 1}px)`,
  /** Touch screens: bigger targets, no hover-only affordances. */
  coarse: "(pointer: coarse)",
  fine: "(pointer: fine)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  dark: "(prefers-color-scheme: dark)",
} as const;
