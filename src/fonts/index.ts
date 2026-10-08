// The site's typefaces, defined once (a "font definitions file", see next/font): every call of a font loader is one hosted
// instance, so the root layout and the global 404 page import the same objects from here. Server only (the root layouts).
//
//   Geist Sans and Geist Mono   self-hosted from the `geist` package (variable fonts, weights 100-900)
//   Instrument Serif Italic     the accent voice: one phrase per heading (`<q>` in a title, class `.accent`), never body,
//                               UI or numbers. Downloaded by next/font at build time and served from our own origin, so the
//                               browser never contacts Google. Only the italic is loaded: an upright face would be preloaded
//                               and never used. latin-ext carries the Czech letters (č ř ů ě š ž ď ť ň).
//
// tokens.css maps these variables to --font-sans, --font-mono and --font-accent. Switching the accent to another face
// (for example Geist Italic 300) is a change in this file only.

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Instrument_Serif } from "next/font/google";

const accent = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: "italic",
  display: "swap",
  variable: "--font-accent-face",
});

/** Class names that declare --font-geist-sans, --font-geist-mono and --font-accent-face; put them on <html>. */
export const fontVariables = [GeistSans.variable, GeistMono.variable, accent.variable].join(" ");
