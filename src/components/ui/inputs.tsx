"use client";

// Interactive form controls of the tools. Every control has a visible or ARIA label, works with keyboard and touch
// (44 px targets, see styles/components/controls.css) and formats numbers for the current language.
// Import them from "@/components/ui/controls".

import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { NBSP, getFormatter } from "@/lib/i18n/format";
import { useLocale, useT } from "@/lib/i18n/client";
import { MQ } from "@/styles/breakpoints";
import { clampNum, formatNum, parseNum, pickSegFit, roundTo, sliderValueAt, stepDigits, stepNum, type SegFit } from "./numeric";

const TOUCH_THUMB = 28; // thumb diameter on touch screens, see controls.css

/** Custom properties as an inline style (typed). */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

// ------------------------------------------------------------------------------------------------ Slider

export function Slider({ label, value, min, max, step = 1, onChange, format, hint, unit }: {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  /** Custom text of the value (also used as aria-valuetext). */
  format?: (v: number) => string; hint?: ReactNode; unit?: string;
}) {
  const id = useId();
  const locale = useLocale();
  const p = max > min ? ((clampNum(value, min, max) - min) / (max - min)) * 100 : 0;
  const text = format ? format(value) : `${formatNum(value, stepDigits(step), stepDigits(step), locale)}${unit ? NBSP + unit : ""}`;
  // iOS moves a range input only when its thumb is dragged. A tap elsewhere on the track jumps there, as a mouse click does.
  const onTap = (e: MouseEvent<HTMLInputElement>) => {
    if (e.detail === 0 || max <= min || !matchMedia(MQ.coarse).matches) return;
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
    if (Math.abs(x - (TOUCH_THUMB / 2 + (p / 100) * (r.width - TOUCH_THUMB))) <= TOUCH_THUMB / 2 + 4) return; // end of a thumb drag
    const v = sliderValueAt(x, r.width, TOUCH_THUMB, min, max, step);
    if (v !== value) onChange(v);
  };
  return (
    <div className="field">
      <div className="field-top"><label htmlFor={id}>{label}</label><output htmlFor={id}>{text}</output></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={text} style={vars({ "--p": `${p}%` })}
        onChange={(e) => onChange(+e.target.value)} onClick={onTap} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Segmented

/** Natural one-line widths of the segments against the room they have (browser only). */
function measureSeg(seg: HTMLElement, field: HTMLElement, host: HTMLElement): SegFit {
  const px = (v: string) => parseFloat(v) || 0;
  const hs = getComputedStyle(host), ss = getComputedStyle(seg);
  // in a toolbar (a wrapping flex row) the control may take a line of its own; elsewhere it fills its field
  const line = hs.display.endsWith("flex") && !hs.flexDirection.startsWith("column")
    ? host.clientWidth - px(hs.paddingLeft) - px(hs.paddingRight)
    : field.clientWidth;
  const room = line - px(ss.paddingLeft) - px(ss.paddingRight) - px(ss.borderLeftWidth) - px(ss.borderRightWidth);
  seg.setAttribute("data-measure", ""); // keeps every label on one line while measuring
  const widths = Array.from(seg.children, (b) => {
    const bs = getComputedStyle(b);
    return (b.firstElementChild?.getBoundingClientRect().width ?? 0) + px(bs.paddingLeft) + px(bs.paddingRight);
  });
  seg.removeAttribute("data-measure");
  return pickSegFit(widths, room, px(ss.columnGap));
}

/**
 * Segmented control (single choice). Labels are never cut off: the segments share one row while they fit,
 * then form a balanced grid (four as 2 × 2), and as a last resort stack with wrapping labels.
 */
export function Segmented<T extends string | number>({ label, ariaLabel, value, options, onChange }: {
  label?: ReactNode; ariaLabel?: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void;
}) {
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<SegFit | null>(null); // null until measured in the browser: one row
  const keys = options.map((o) => String(o.value)).join("|");
  useLayoutEffect(() => {
    const seg = ref.current, field = seg?.parentElement, host = field?.parentElement;
    if (!seg || !field || !host || typeof ResizeObserver === "undefined") return;
    // the first observation arrives right after layout, later ones on resize, font load or a label change
    const ro = new ResizeObserver(() => {
      const f = measureSeg(seg, field, host);
      setFit((o) => (o?.kind === f.kind && o.cols === f.cols ? o : f));
    });
    ro.observe(host);
    seg.querySelectorAll(":scope > button > span").forEach((s) => ro.observe(s));
    return () => ro.disconnect();
  }, [keys]);
  return (
    <div className="field">
      {label && <div className="field-top"><span id={labelId}>{label}</span></div>}
      <div ref={ref} className="seg fit" role="group" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel}
        data-fit={fit?.kind} style={vars({ "--seg-cols": fit?.cols ?? options.length })}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}><span>{o.label}</span></button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Switch

export function Switch({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <div className="field">
      <label className="switch"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Chips

export type ChipOption<T extends string> = { value: T; label: ReactNode; /** A CSS colour for a small dot, e.g. "var(--zone-day)". */ dot?: string };

/**
 * A row of toggle chips (layers, filters, views). `selected` lists the chips that are on; clicking calls `onToggle`.
 * For a single choice keep one value in `selected` and replace it in `onToggle`.
 */
export function Chips<T extends string>({ label, ariaLabel, options, selected, onToggle }: {
  label?: ReactNode; ariaLabel?: string; options: readonly ChipOption<T>[]; selected: readonly T[]; onToggle: (v: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="field">
      {label && <div className="field-top"><span id={labelId}>{label}</span></div>}
      <div className="chips" role="group" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel}>
        {options.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={selected.includes(o.value)} onClick={() => onToggle(o.value)}>
            {o.dot && <span className="dot" style={vars({ "--dot": o.dot })} aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ number entry

type NumOpts = {
  value: number; onChange: (v: number) => void;
  /** Lowest accepted value; 0 unless set, because amounts, prices and quantities are never negative. */
  min?: number; max?: number; step?: number;
  /** Decimal places shown while the field is not being edited (default: those of `step`). */
  digits?: number;
  /** Called when the field is left empty, e.g. to drop a user override. Without it the last value returns. */
  onEmpty?: () => void;
};

/**
 * Number entry backed by the typed text. While typing, the field keeps exactly what was typed (it may be empty
 * or end with a comma); readable values within min-max apply at once, others are flagged. Leaving the field clamps
 * to min-max, brings back the last value when the text is unreadable, and shows the number in the current format.
 */
function useNumDraft({ value, onChange, min = 0, max = Infinity, step = 1, digits, onEmpty }: NumOpts) {
  const locale = useLocale();
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const d = digits ?? stepDigits(step);
  const num = (v: number, minD: number, maxD: number) => getFormatter(locale).num(v, minD, maxD);
  const typed = draft === null ? null : parseNum(draft, locale);
  const issue = draft === null || !draft.trim() ? null
    : typed === null ? (min >= 0 && /^\s*[-\u{2212}]/u.test(draft) ? "min" : "nan")
    : typed < min ? "min" : typed > max ? "max" : null;
  const commit = (v: number) => { if (v !== value) onChange(v); };
  const finish = () => {
    if (draft === null) return;
    if (typed !== null) commit(clampNum(roundTo(typed, d), min, max)); // what the field then shows is exactly the value used
    else if (!draft.trim()) onEmpty?.();
    setDraft(null);
  };
  const input = {
    type: "text", inputMode: d > 0 ? "decimal" : "numeric", autoComplete: "off", spellCheck: false, enterKeyHint: "done",
    value: draft ?? (Number.isFinite(value) ? num(value, 0, d) : ""),
    "aria-invalid": issue ? true : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value, v = parseNum(text, locale);
      setDraft(text);
      if (v !== null && v >= min && v <= max) commit(v);
    },
    onBlur: finish,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") finish();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = stepNum(clampNum(typed ?? value, min, max), step, e.key === "ArrowUp" ? 1 : -1, min, max);
        commit(next);
        setDraft(num(next, 0, Math.max(d, stepDigits(step))));
      }
    },
  } as const;
  const message = (unit?: string) => {
    if (!issue) return null;
    if (issue === "nan") return t("common.validation.number");
    const limit = `${num(issue === "min" ? min : max, 0, d)}${unit ? NBSP + unit : ""}`;
    return t(issue === "min" ? "common.validation.min" : "common.validation.max", { value: limit });
  };
  return { input, message };
}

export function NumberField({ label, value, onChange, step = 1, min = 0, max, unit, digits, hint }: NumOpts & { label: ReactNode; unit?: string; hint?: ReactNode }) {
  const id = useId(), hintId = useId();
  const { input, message } = useNumDraft({ value, onChange, min, max, step, digits });
  const msg = message(unit);
  return (
    <div className="field">
      <div className="field-top"><label htmlFor={id}>{label}</label>{unit && <span className="val small">{unit}</span>}</div>
      <input id={id} className="numin" {...input} aria-describedby={msg || hint ? hintId : undefined} />
      {(msg || hint) && <p id={hintId} className={msg ? "hint err" : "hint"}>{msg ?? hint}</p>}
    </div>
  );
}

/** The bare input of NumberField, for tables: pass aria-label, a className (default "numin") and, where useful, onEmpty. */
export function NumInput({ value, onChange, min, max, step, digits, onEmpty, className = "numin", ...rest }:
  NumOpts & Omit<InputHTMLAttributes<HTMLInputElement>, keyof NumOpts | "type" | "inputMode">) {
  const { input, message } = useNumDraft({ value, onChange, min, max, step, digits, onEmpty });
  return <input {...rest} className={className} {...input} title={message() ?? rest.title} />;
}
