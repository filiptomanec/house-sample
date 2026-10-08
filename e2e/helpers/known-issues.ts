// Problems of the site that the suite has found and reports, but does not let turn the whole run red. Every entry says where it
// happens; the test still measures and writes the result into the report as an annotation: the note while the problem is there,
// "FIXED: remove the entry" once it is gone. Fix the site, then delete the entry. The list is mirrored in docs/TESTING.md.
import type { TestInfo } from "@playwright/test";
import type { Locale, RouteKey } from "./site";

export interface KnownIssue {
  id: "overflow" | "heading-skip" | "touch-select" | "touch-menu";
  /** Playwright project names; all projects when omitted. */
  projects?: readonly string[];
  locale?: Locale;
  key?: RouteKey;
  note: string;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: "overflow",
    projects: ["iphone-se"],
    locale: "en",
    key: "plan",
    note: "320 px wide: the toolbar of the floor plan (.pl-bar: mode switch and layer chips with the longer English labels) is 23 px wider than the screen",
  },
  {
    id: "heading-skip",
    key: "sun",
    note: "the side panel headings (shading, the sun right now) are h3 straight after the h1; the sections below are h2",
  },
  {
    id: "touch-select",
    key: "plot",
    note: "the two point selectors of the measuring panel (select.numin) are 26 px high on touch screens instead of 44 px",
  },
  {
    id: "touch-menu",
    projects: ["iphone-se"],
    note: "on a 568 px high screen the eight entries of the menu are squeezed to 42 px each instead of 44 px",
  },
];

/** The known issue of this kind that applies to this project and page, if any. */
export function knownIssue(id: KnownIssue["id"], where: { project: string; locale?: Locale; key?: RouteKey }): KnownIssue | undefined {
  return KNOWN_ISSUES.find(
    (k) =>
      k.id === id &&
      (!k.projects || k.projects.includes(where.project)) &&
      (!k.locale || k.locale === where.locale) &&
      (!k.key || k.key === where.key),
  );
}

/** Writes the state of a known issue into the report. */
export function noteKnown(testInfo: TestInfo, issue: KnownIssue, present: boolean): void {
  testInfo.annotations.push({ type: "known-issue", description: present ? issue.note : `FIXED: remove "${issue.id}" from helpers/known-issues.ts` });
}
