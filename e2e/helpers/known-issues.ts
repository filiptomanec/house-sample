// Problems of the site that the suite has found and reports, but does not let turn the whole run red. Every entry says where it
// happens; the test still measures and writes the result into the report as an annotation: the note while the problem is there,
// "FIXED: remove the entry" once it is gone. Fix the site, then delete the entry. The list is mirrored in docs/TESTING.md.
import type { TestInfo } from "@playwright/test";
import type { Locale, RouteKey } from "./site";

export interface KnownIssue {
  id: "heading-skip";
  /** Playwright project names; all projects when omitted. */
  projects?: readonly string[];
  locale?: Locale;
  key?: RouteKey;
  note: string;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: "heading-skip",
    key: "sun",
    note: "the side panel headings (shading, the sun right now) are h3 straight after the h1; the sections below are h2",
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
