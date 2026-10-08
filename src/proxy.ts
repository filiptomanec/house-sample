import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveRequest } from "@/lib/routes";

/**
 * Language routing, no authentication. Czech lives on root URLs, English under /en; the pages themselves live under
 * /cs/... and /en/... (src/app/[locale]/<key>). All of the decisions are in resolveRequest() (lib/routes.ts):
 *   canonical public URL      -> rewrite to the internal URL ("/pudorys" -> "/cs/plan")
 *   other spelling of a page  -> permanent redirect to the canonical URL ("/cs/plan", "/en/pudorys", "/floor-plan")
 *   unknown path              -> rewrite into the language with status 404 ("/nic" -> "/cs/nic"); no route matches
 *                                there, so Next (and Vercel's edge) answer with app/global-not-found.tsx, a static page
 */
export function proxy(request: NextRequest) {
  const { nextUrl } = request;
  const r = resolveRequest(nextUrl.pathname);
  if (r.type === "next") return NextResponse.next();
  const url = nextUrl.clone();
  url.pathname = r.to;
  if (r.type === "redirect") return NextResponse.redirect(url, 308);
  return NextResponse.rewrite(url, r.status ? { status: r.status } : undefined);
}

export const config = {
  // pages only: not the build output, files with an extension (icons, images, models, manifest, robots, sitemap)
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
