import { NotFoundView } from "@/components/ui/StateViews";

/** 404 for any unknown address (the [...rest] catch-all) and notFound() calls, inside the site layout. */
export default function NotFound() {
  return <NotFoundView />;
}
