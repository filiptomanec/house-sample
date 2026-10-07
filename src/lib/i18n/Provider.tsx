// Server component: gives client components below it the listed namespaces. The [locale] layout already provides
// common, nav, footer and errors; a page with client components that call useT() adds its own namespace:
//   <I18n locale={locale} namespaces={["plan"]}>...</I18n>

import type { ReactNode } from "react";
import type { Locale } from "./config";
import { I18nProvider } from "./client";
import { messagesFor, type Namespace } from "./messages";

export function I18n({ locale, namespaces, children }: { locale: Locale; namespaces: readonly Namespace[]; children: ReactNode }) {
  return <I18nProvider locale={locale} messages={messagesFor(locale, namespaces)}>{children}</I18nProvider>;
}
