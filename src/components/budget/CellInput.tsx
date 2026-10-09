"use client";

// A number in a table of the budget: typed text with locale parsing (NumInput), a mint tint when the number was changed, and a
// button that brings the computed value back. Clearing the field does the same.
import { NumInput } from "@/components/ui/controls";

export function CellInput({ value, edited, label, resetLabel, digits, step, onCommit, onReset }: {
  value: number;
  edited: boolean;
  /** Accessible name of the field (says what and which line). */
  label: string;
  /** Accessible name of the reset button (says which value comes back). */
  resetLabel: string;
  digits: number;
  step: number;
  onCommit: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <span className="cell">
      <NumInput className="numin cell-in" value={value} digits={digits} step={step} min={0} max={1e12} aria-label={label}
        data-edited={edited ? "" : undefined} onChange={onCommit} onEmpty={onReset} />
      {edited && (
        <button type="button" className="cell-reset" aria-label={resetLabel} title={resetLabel} onClick={onReset}
          onMouseDown={(e) => e.preventDefault() /* Safari does not focus a clicked button: the input would blur, the phone row would close and take the button with it before the click lands */}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M3 8a5 5 0 1 0 1.7-3.75M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
