"use client";

// The loading line: 2 px of mint under the navigation bar while a link is navigating.
//
// Next's useLinkStatus() reports the pending state of the <Link> it sits in (true before the history updates). Every
// shell link carries a <LinkPending /> marker; the one line in the bar (<LoadingLine />) shows while any marker is
// pending, through a CSS :has() rule in nav.css, so no state has to travel between components. A prefetched light
// page usually swaps before the line appears; a heavy page (3D) shows it. Without JavaScript nothing renders.

import { useLinkStatus } from "next/link";

/** Put inside a <Link>: marks the link while its navigation is pending. Renders an empty, hidden span. */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span hidden data-link-pending={pending ? "" : undefined} />;
}

/** The line itself, placed once at the bottom edge of the bar. Decorative: the new page announces itself. */
export function LoadingLine() {
  return <span className="loading-line" aria-hidden />;
}
