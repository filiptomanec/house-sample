"use client";

import { useEffect } from "react";
import { ErrorView } from "@/components/ui/StateViews";

/** Error boundary of every page. `retry` re-fetches and re-renders the segment; older versions call it `reset`. */
export default function Error({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <ErrorView digest={error.digest} onRetry={retry ?? reset} />;
}
