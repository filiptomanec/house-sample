import type { MetadataRoute } from "next";
import { LOCALE_META } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { SITE } from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} · ${SITE.house.name.cs}`,
    short_name: SITE.name,
    description: MESSAGES.home.cs.meta.description,
    lang: LOCALE_META.cs.htmlLang,
    start_url: "/",
    display: "standalone",
    background_color: SITE.chrome.light,
    theme_color: SITE.chrome.dark,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
