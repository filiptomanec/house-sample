import { notFound } from "next/navigation";

/** Catch-all: every unknown address below a language lands here and renders the localised 404 inside the site layout. */
export default function CatchAll(): never {
  notFound();
}
