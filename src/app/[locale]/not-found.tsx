import { NotFoundView } from "@/components/ui/StateViews";

/**
 * 404 for notFound() calls inside real pages, rendered in the site layout. Unknown addresses never get here: there is no
 * catch-all route, so the router answers them with the static app/global-not-found.tsx (status 404, full server HTML).
 */
export default function NotFound() {
  return <NotFoundView />;
}
