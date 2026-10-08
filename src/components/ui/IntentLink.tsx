"use client";

// A <Link> for links between pages of the site. Light pages keep Next's default prefetch (in view). A heavy page
// (ROUTES[key].heavy: the 3D engine and its models) is not prefetched in view; it is prefetched on intent instead:
// pointer over it, keyboard focus, or a touch starting on it. It also carries the loading-line marker.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { LinkPending } from "../LoadingLine";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string; heavy?: boolean };

export default function IntentLink({ href, heavy, children, onPointerEnter, onFocus, onTouchStart, ...rest }: Props) {
  const router = useRouter();
  const warm = () => { if (heavy) router.prefetch(href); };
  return (
    <Link
      {...rest}
      href={href}
      prefetch={heavy ? false : undefined}
      onPointerEnter={(e) => { warm(); onPointerEnter?.(e); }}
      onFocus={(e) => { warm(); onFocus?.(e); }}
      onTouchStart={(e) => { warm(); onTouchStart?.(e); }}
    >
      {children}
      <LinkPending />
    </Link>
  );
}
