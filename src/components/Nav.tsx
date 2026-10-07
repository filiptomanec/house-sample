"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/client";
import { navLink, navLinks } from "@/lib/links";
import { inertOutside, trapTab } from "@/lib/modal";
import { parseAnyPath, routePath } from "@/lib/routes";
import { MQ } from "@/styles/breakpoints";
import LanguageSwitch from "./LanguageSwitch";
import ThemeSwitch from "./ui/ThemeSwitch";

/** Full-bleed dark blocks. Over them the bar turns into dark glass with light text. A page marks its own with data-nav="dark". */
const DARK = ".night, [data-nav='dark'], [data-nav='clear']";
/** Dark blocks with their own top scrim (a photo hero): the bar stays fully transparent over them. */
const CLEAR = "[data-nav='clear']";
type Under = "clear" | "dark" | null;
const toneOf = (hits: Element[]): Under => (hits.some((e) => e.matches(CLEAR)) ? "clear" : hits.length ? "dark" : null);

// useLayoutEffect warns during server rendering; the effect only matters in the browser anyway
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Nav() {
  const path = usePathname();
  const locale = useLocale();
  const t = useT();
  const here = parseAnyPath(path);
  const home = routePath(locale, "home");
  const links = navLinks(locale, t);
  const menuLinks = [navLink(locale, "home", t), ...links];

  // The menu is open "at" a path: any navigation (also the language switch inside the menu) closes it by itself.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const [scrolled, setScrolled] = useState(false);
  // server render and first paint: only the home page starts on a dark full-bleed image
  const [under, setUnder] = useState<Under>(here?.key === "home" ? "clear" : null);
  const bar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, [path]);

  // Which dark block sits under the middle of the bar? Measured once before paint (so a new page never
  // flashes the previous tone), then followed by an IntersectionObserver on a 1 px line at that height.
  useBrowserLayoutEffect(() => {
    const els = Array.from(document.querySelectorAll(DARK));
    const lineY = () => Math.round((bar.current?.offsetHeight ?? 60) / 2);
    const y0 = lineY();
    setUnder(toneOf(els.filter((el) => { const r = el.getBoundingClientRect(); return r.top <= y0 && r.bottom > y0; })));
    if (!els.length) return;
    const hits = new Set<Element>();
    let io: IntersectionObserver | undefined;
    const watch = () => {
      io?.disconnect();
      hits.clear();
      const y = lineY();
      io = new IntersectionObserver((entries) => {
        for (const e of entries) { if (e.isIntersecting) hits.add(e.target); else hits.delete(e.target); }
        setUnder(toneOf([...hits]));
      }, { rootMargin: `-${y}px 0px -${Math.max(0, innerHeight - y - 1)}px 0px` });
      els.forEach((el) => io!.observe(el));
    };
    watch();
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(watch); };
    addEventListener("resize", onResize);
    return () => { io?.disconnect(); cancelAnimationFrame(raf); removeEventListener("resize", onResize); };
  }, [path]);

  // Open menu: the page behind is inert and scroll-locked, focus moves to the first link and Tab cycles
  // between the bar (brand, close toggle) and the menu. Escape or a wide window closes it; focus returns to the toggle.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = "hidden";
    const release = inertOutside([bar.current, menu.current]);
    menu.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenAt(null); else trapTab(e, [bar.current, menu.current]); };
    addEventListener("keydown", key);
    const wide = matchMedia(MQ.minLg);
    const onWide = () => { if (wide.matches) setOpenAt(null); };
    wide.addEventListener("change", onWide);
    const btn = toggle.current;
    return () => {
      html.style.overflow = prev;
      release();
      removeEventListener("keydown", key);
      wide.removeEventListener("change", onWide);
      btn?.focus({ preventScroll: true });
    };
  }, [open]);

  const solid = open || under === "dark" || (under !== "clear" && scrolled);
  const tone = open || under ? "light" : "dark";
  return (
    <>
      <header ref={bar} className={tone === "light" ? "nav scheme-dark" : "nav"} data-solid={solid ? "true" : "false"} data-tone={tone} data-open={open ? "true" : undefined}>
        <div className="shell nav-in">
          <Link href={home} className="brand" onClick={() => setOpenAt(null)} aria-label={t("nav.homeAria")}>
            <b>{t("nav.brand")}</b><span>{t("nav.brandSub")}</span>
          </Link>
          <nav className="nav-links" aria-label={t("nav.main")}>
            {links.map((l) => (
              <Link key={l.key} href={l.href} aria-current={here?.key === l.key ? "page" : undefined}>{l.label}</Link>
            ))}
          </nav>
          <div className="nav-tools">
            <LanguageSwitch />
            <ThemeSwitch />
          </div>
          <button ref={toggle} type="button" className="nav-toggle" aria-expanded={open} aria-controls="menu" onClick={() => setOpenAt(open ? null : path)}>
            {open ? t("common.menu.close") : t("common.menu.open")}<span className="bars" aria-hidden><i /><i /></span>
          </button>
        </div>
      </header>
      {open && (
        <nav ref={menu} id="menu" className="menu night" aria-label={t("common.menu.label")}>
          <ol>
            {menuLinks.map((l) => (
              <li key={l.key}>
                <Link href={l.href} onClick={() => setOpenAt(null)} aria-current={here?.key === l.key ? "page" : undefined}>
                  <span className="n">{l.n}</span><b>{l.label}</b><small>{l.desc}</small>
                </Link>
              </li>
            ))}
          </ol>
          <div className="menu-foot">
            <LanguageSwitch />
            <ThemeSwitch />
            <span className="small">{t("common.fiction")}</span>
          </div>
        </nav>
      )}
    </>
  );
}
