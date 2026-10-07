"use client";

// State of the Budget page: the visitor's switches, reserve and edits (restored from the browser after mount, saved on every
// change), the PV choice made on the Energy page, and the calculation. Server markup and the first client render use the
// model's own defaults, so they agree.
import { useCallback, useEffect, useMemo, useState } from "react";
import { computeBudget, defaultBudgetSettings, type BudgetLine, type BudgetResult, type BudgetSettings } from "@/lib/calc/budgetCompute";
import { defaultPricebook, pvQuantities, type PvChoice, type Pricebook, type Quantities } from "@/lib/calc/budgetCore";
import { currentPvSelection, defaultPvSelection, groupRoofPlanes, layoutPanels, lightpipeObstacles } from "@/lib/calc/roofLayout";
import { derived, house } from "@/lib/model/instance";
import { budgetFingerprint, isDefaultSettings, loadBudgetSettings, saveBudgetSettings, withOverride } from "./store";

const book = defaultPricebook();
const planes = groupRoofPlanes(derived.roofPlanes);
const batteryIds = house.equipment.battery.options.map((o) => o.id);

/** The PV choice of the Energy page when it differs from the model's own, as quantities; null = the model's own. Browser only. */
function readPvChoice(): PvChoice | null {
  const defaults = defaultPvSelection(house, planes, derived);
  const sel = currentPvSelection(defaults, planes, batteryIds);
  const samePlanes = sel.enabledPlanes.length === defaults.enabledPlanes.length && sel.enabledPlanes.every((k) => defaults.enabledPlanes.includes(k));
  if (sel.panelCount === defaults.panelCount && samePlanes && sel.batteryId === defaults.batteryId) return null;
  const layout = layoutPanels(planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: lightpipeObstacles(derived) });
  const batteryKwh = house.equipment.battery.options.find((o) => o.id === sel.batteryId)?.capacityKwh ?? 0;
  return { panelCount: layout.count, kwp: layout.kwp, batteryKwh };
}

export interface BudgetState {
  book: Pricebook;
  quantities: Quantities;
  settings: BudgetSettings;
  result: BudgetResult;
  /** Does the PV and battery in the quantities come from the Energy page rather than from the model? */
  pvFromEnergy: boolean;
  isDefault: boolean;
  setReserve: (share: number) => void;
  toggleGroup: (id: string, on: boolean) => void;
  /** Sets one field of a line; `null` brings the computed value back. */
  edit: (line: BudgetLine, field: "quantity" | "price", value: number | null) => void;
  reset: () => void;
}

/** `base`: the quantities of the model without the visitor's PV choice (computed on the server, they need the plot). */
export function useBudget(base: Quantities): BudgetState {
  const fp = useMemo(() => budgetFingerprint(base), [base]);
  const [settings, setSettings] = useState<BudgetSettings>(() => defaultBudgetSettings(book));
  const [pv, setPv] = useState<PvChoice | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = loadBudgetSettings(book, fp);
    /* eslint-disable react-hooks/set-state-in-effect -- the saved choices live in localStorage, which exists only in the browser (not during SSR) */
    if (saved) setSettings(saved);
    setPv(readPvChoice());
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [fp]);

  useEffect(() => {
    if (loaded) saveBudgetSettings(settings, book, fp);
  }, [settings, loaded, fp]);

  const quantities = useMemo<Quantities>(() => ({ ...base, ...pvQuantities(house, derived.pv, pv ?? undefined) }), [base, pv]);
  const result = useMemo(() => computeBudget(book, quantities, settings), [quantities, settings]);

  const setReserve = useCallback((share: number) => setSettings((s) => ({ ...s, reserve: share })), []);
  const toggleGroup = useCallback((id: string, on: boolean) => setSettings((s) => ({ ...s, groups: { ...s.groups, [id]: on } })), []);
  const edit = useCallback(
    (line: BudgetLine, field: "quantity" | "price", value: number | null) =>
      setSettings((s) => withOverride(s, line.id, field, value, field === "quantity" ? line.defaultQuantity : line.defaultPrice)),
    [],
  );
  const reset = useCallback(() => setSettings(defaultBudgetSettings(book)), []);

  return { book, quantities, settings, result, pvFromEnergy: pv !== null, isDefault: isDefaultSettings(settings, book), setReserve, toggleGroup, edit, reset };
}
