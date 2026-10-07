// Validation of a house/1 model: structure (zod) first, then geometry and design rules (port of the concept/1
// checker, extended for the house/1 fields). Every message exists in Czech and English. A structural error stops the
// run (geometry cannot be derived from a broken structure); everything else is collected.
import type { ZodIssue } from "zod";
import {
  FURNITURE,
  GARAGE_MIN_CLEAR,
  HABITABLE,
  MIN_AREA,
  OPENING_LIMITS,
  OUTDOOR_TYPE_NAMES,
  PRIVATE_TYPES,
  SCHEMA_ID,
  THICKNESS_TOL,
  U_LIMITS,
  WINDOWLESS_OK,
  type LocalizedText,
} from "./catalog";
import { derive } from "./derive";
import {
  doorSwing,
  expandRect,
  furnitureRect,
  inRect,
  interArea,
  rectArea,
  rectHitsSwing,
  uncovered,
  wallBody,
  type Rect,
} from "./geom";
import { computeMetrics } from "./metrics";
import { HouseSchema } from "./schema";
import type { Derived, House, Issue, Severity, ValidationResult } from "./types";

// ---------------------------------------------------------------- registry of codes
export interface IssueCodeInfo {
  severity: Severity;
  title: LocalizedText;
}
const E = (cs: string, en: string): IssueCodeInfo => ({ severity: "error", title: { cs, en } });
const V = (cs: string, en: string): IssueCodeInfo => ({ severity: "warning", title: { cs, en } });

/** All codes the validator can report. Used by the docs and by the tests (each code is exercised at least once). */
export const ISSUE_CODES: Record<string, IssueCodeInfo> = {
  "E-JSON": E("Neplatný JSON", "Invalid JSON"),
  "E-SCHEMA": E('Pole "schema" není "house/1"', 'Field "schema" is not "house/1"'),
  "E-TYP": E("Chybějící nebo špatně typované pole, hodnota mimo seznam nebo rozsah", "Missing or wrongly typed field, value outside the list or range"),
  "E-ID": E("Duplicitní id v jednom seznamu", "Duplicate id within one list"),
  "E-RECT": E("Obdélník s přehozenými souřadnicemi (musí platit x0<x1, y0<y1)", "Rectangle with swapped coordinates (x0<x1, y0<y1 required)"),
  "E-LOKACE": E("Souřadnice polohy nejsou zaokrouhlené na 0,1 stupně", "Location coordinates are not rounded to 0.1 degree"),
  "E-ZONA": E("Typ místnosti nebo venkovní plochy nepatří právě do jedné zóny", "Room or outdoor type does not belong to exactly one zone"),
  "E-ROLE": E("Role místnosti, která má být jedinečná, je použita vícekrát", "A role that must be unique is used more than once"),
  "E-SKLADBA": E("Tloušťka skladby neodpovídá tloušťce zdi nebo stropu v půdorysu", "Assembly thickness does not match the wall or slab thickness in the plan"),
  "E-PREKRYV": E("Překryv místností", "Overlapping rooms"),
  "E-DIRA": E("Díra uvnitř půdorysu", "Hole inside the floor plan"),
  "E-NESOUVISLY": E("Půdorys se skládá z oddělených částí", "Floor plan is made of disconnected parts"),
  "E-MISTNOST": E("Místnost je po odečtení zdí příliš úzká", "Room is too narrow after subtracting the walls"),
  "E-OTVOR-ZED": E("Otvor neleží na zdi", "Opening does not lie on a wall"),
  "E-OTVOR-DRUH": E("Druh otvoru neodpovídá druhu zdi", "Opening kind does not fit the wall kind"),
  "E-OTVOR-ROZMER": E("Rozměr otvoru mimo povolený rozsah", "Opening size outside the allowed range"),
  "E-OTVOR-ROH": E("Otvor je příliš blízko rohu nebo styku zdí", "Opening too close to a corner or wall junction"),
  "E-OTVOR-OTVOR": E("Otvory na jedné zdi jsou příliš blízko nebo se překrývají", "Openings on one wall are too close or overlap"),
  "E-OBKLAD": E("Dřevěný obklad neleží na obvodové zdi", "Timber cladding is not on an exterior wall"),
  "E-STRECHA": E("Zeď nebo část půdorysu není pod střechou", "A wall or part of the plan is not under the roof"),
  "E-TERASA": E("Krytá venkovní plocha není celá pod střechou", "Covered outdoor area is not entirely under a roof"),
  "E-ZASKLENI": E("Zasklení obytné místnosti je pod 1/10 podlahy", "Glazing of a habitable room is below 1/10 of the floor"),
  "E-VSTUP": E("Chybí hlavní vstup", "No main entrance"),
  "E-DOSTUPNOST": E("Místnost není dosažitelná dveřmi z hlavního vstupu", "Room is not reachable by doors from the main entrance"),
  "E-GARAZ-ROZMER": E("Garáž je menší než 5,5 x 5,5 m", "Garage is smaller than 5.5 x 5.5 m"),
  "V-IDEA": V('Chybí popis "idea"', 'Missing "idea" description'),
  "V-PLOCHA": V("Čistá plocha pod doporučeným minimem", "Net area below the recommended minimum"),
  "V-ZASKLENI": V("Zasklení pod 1/8 podlahy", "Glazing below 1/8 of the floor"),
  "V-JIH": V("Hlavní obytná místnost má na jih méně než 40 % zasklení", "Main living room has less than 40 % of its glazing facing south"),
  "V-OBYTNA": V("Chybí hlavní obytná místnost", "No main living room"),
  "V-SEVER": V("Ložnice nebo dětský pokoj zasklené jen na sever", "Bedroom or children's room glazed to the north only"),
  "V-CHODBA": V("Chodba užší než 1,0 m", "Corridor narrower than 1.0 m"),
  "V-UZKA": V("Místnost užší než 0,9 m", "Room narrower than 0.9 m"),
  "V-BEZ-OKNA": V("Obytná místnost bez okna", "Habitable room without a window"),
  "V-NABYTEK-MIMO": V("Nábytek přesahuje místnost nebo leží mimo vše", "Furniture exceeds the room or lies outside everything"),
  "V-NABYTEK-DVERE": V("Nábytek koliduje s otevíráním dveří", "Furniture collides with a door swing"),
  "V-VICE-VSTUPU": V("Více vstupních dveří", "More than one entrance door"),
  "V-PRUCHOD": V("Místnost je dostupná jen přes soukromou místnost", "Room is reachable only through a private room"),
  "V-GARAZ-VRATA": V("Garáž nemá vrata nebo vrata nejsou v garáži", "Garage has no garage door, or the door is not in a garage"),
  "V-TERASA-SLOUPY": V("Krytá plocha bez sloupů", "Covered area without posts"),
  "V-SLOUP-MIMO": V("Sloup mimo svou plochu", "Post outside its area"),
  "V-VENKU-DUM": V("Venkovní plocha zasahuje do obrysu domu", "Outdoor area overlaps the house outline"),
  "V-STRECHA-VYSKA": V("Střecha začíná níž než strop", "Roof starts lower than the ceiling"),
  "V-STRECHA-PRESAH": V("Neobvykle velký přesah střechy", "Unusually large roof overhang"),
  "V-U-ZED": V("Součinitel U obvodové zdi nad doporučenou hodnotou", "U-value of the exterior wall above the recommended value"),
  "V-U-STRECHA": V("Součinitel U střechy nad doporučenou hodnotou", "U-value of the roof above the recommended value"),
  "V-U-PODLAHA": V("Součinitel U podlahy nad doporučenou hodnotou", "U-value of the floor above the recommended value"),
  "V-FVE-NULA": V("Do střechy se nevejde žádný fotovoltaický modul", "No photovoltaic module fits on the roof"),
  "V-SVOD-UDOLI": V("U spodního konce údolí střechy chybí dešťový svod", "No downpipe at the low end of a roof valley"),
  "V-SVETLOVOD-MIMO": V("Světlovod neleží nad místností pod střechou", "Light pipe is not above a room under the roof"),
};

// ---------------------------------------------------------------- helpers
const c = (n: number, d = 2): string => n.toFixed(d).replace(".", ",");
const e = (n: number, d = 2): string => n.toFixed(d);
const T = (cs: string, en: string): LocalizedText => ({ cs, en });

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  error(code: string, message: LocalizedText): void {
    this.errors.push({ code, severity: "error", message });
  }
  warn(code: string, message: LocalizedText): void {
    this.warnings.push({ code, severity: "warning", message });
  }
}

const TYPE_CS: Record<string, string> = { number: "číslo", string: "řetězec", boolean: "true/false", array: "pole", object: "objekt", tuple: "pole", int: "celé číslo" };
const CUSTOM_CS: Record<string, string> = {
  'required for kind "door" ("+" or "-")': 'dveře vyžadují pole "swing" a "hinge" ("+" nebo "-")',
  'required for kind "entry" ("+" or "-")': 'vstup vyžaduje pole "swing" a "hinge" ("+" nebo "-")',
  'give exactly one of "lambda" and "r"': 'uveďte právě jedno z "lambda" a "r"',
  "required for a perspective camera": "perspektivní kamera vyžaduje pole fov",
  "required for an orthographic camera": "ortografická kamera vyžaduje pole orthoHeight",
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** `rooms[2] (R03).rects[0]`-style label of an issue path, using the ids found in the raw input. */
function pathLabel(raw: unknown, path: PropertyKey[]): string {
  let out = "";
  let cur: unknown = raw;
  path.forEach((p, i) => {
    out += typeof p === "number" ? `[${p}]` : out ? `.${String(p)}` : String(p);
    cur = isObj(cur) || Array.isArray(cur) ? (cur as Record<PropertyKey, unknown>)[p as string] : undefined;
    if (typeof p === "number" && isObj(cur) && typeof cur.id === "string" && i < 3) out += ` (${cur.id})`;
  });
  return out || "(root)";
}

function issueText(raw: unknown, issue: ZodIssue): LocalizedText {
  const where = pathLabel(raw, issue.path);
  const i = issue as ZodIssue & Record<string, unknown>;
  switch (issue.code) {
    case "invalid_type": {
      const exp = String(i.expected ?? "value");
      return T(`${where}: musí být ${TYPE_CS[exp] ?? exp}.`, `${where}: must be ${exp}.`);
    }
    case "too_small":
    case "too_big": {
      const big = issue.code === "too_big";
      const lim = big ? i.maximum : i.minimum;
      const incl = i.inclusive !== false;
      const origin = String(i.origin ?? "number");
      const cs = origin === "number" ? `hodnota musí být ${big ? "nejvýše" : "alespoň"} ${String(lim)}${incl ? "" : " (výlučně)"}` : `${origin === "array" ? "počet položek" : "délka"} musí být ${big ? "nejvýše" : "alespoň"} ${String(lim)}`;
      const en = origin === "number" ? `value must be ${big ? "at most" : "at least"} ${String(lim)}${incl ? "" : " (exclusive)"}` : `${origin === "array" ? "item count" : "length"} must be ${big ? "at most" : "at least"} ${String(lim)}`;
      return T(`${where}: ${cs}.`, `${where}: ${en}.`);
    }
    case "invalid_value": {
      const vals = Array.isArray(i.values) ? i.values.map((v) => JSON.stringify(v)).join(", ") : "";
      return T(`${where}: nepovolená hodnota (povolené: ${vals}).`, `${where}: value not allowed (allowed: ${vals}).`);
    }
    case "unrecognized_keys": {
      const keys = Array.isArray(i.keys) ? i.keys.map((k) => JSON.stringify(k)).join(", ") : "";
      return T(`${where}: neznámý klíč ${keys}.`, `${where}: unknown key ${keys}.`);
    }
    case "custom":
      return T(`${where}: ${CUSTOM_CS[issue.message] ?? issue.message}.`, `${where}: ${issue.message}.`);
    case "invalid_union":
      return T(`${where}: hodnota neodpovídá žádné z povolených variant.`, `${where}: value matches none of the allowed variants.`);
    default:
      return T(`${where}: neplatná hodnota (${issue.message}).`, `${where}: invalid value (${issue.message}).`);
  }
}

// ---------------------------------------------------------------- structure
function checkStructure(raw: unknown, out: Collector): House | null {
  if (!isObj(raw)) {
    out.error("E-TYP", T("Kořen JSON musí být objekt.", "The JSON root must be an object."));
    return null;
  }
  if (raw.schema !== SCHEMA_ID) {
    const got = JSON.stringify(raw.schema);
    out.error("E-SCHEMA", T(`Pole "schema" musí být "${SCHEMA_ID}" (je ${got}).`, `Field "schema" must be "${SCHEMA_ID}" (it is ${got}).`));
  }
  const parsed = HouseSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path.length === 1 && issue.path[0] === "schema") continue; // reported as E-SCHEMA
      out.error("E-TYP", issueText(raw, issue));
    }
  }
  // duplicate ids and rectangle order are checked on the raw input so that they are reported even next to type errors
  const dup = (list: unknown, label: string): void => {
    if (!Array.isArray(list)) return;
    const seen = new Set<string>();
    for (const it of list) {
      if (!isObj(it) || typeof it.id !== "string") continue;
      if (seen.has(it.id)) out.error("E-ID", T(`Duplicitní id "${it.id}" v seznamu ${label}.`, `Duplicate id "${it.id}" in list ${label}.`));
      seen.add(it.id);
    }
  };
  for (const key of ["rooms", "openings", "roofs", "outdoor", "accents", "screens", "cameras"]) dup(raw[key], key);
  if (isObj(raw.equipment) && isObj(raw.equipment.battery)) dup(raw.equipment.battery.options, "equipment.battery.options");
  if (isObj(raw.assemblies)) {
    for (const [k, a] of Object.entries(raw.assemblies)) if (isObj(a)) dup(a.layers, `assemblies.${k}.layers`);
  }
  const rectOrder = (r: unknown, label: string): void => {
    if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => typeof v === "number")) return;
    if (!(r[0] < r[2]) || !(r[1] < r[3])) {
      out.error("E-RECT", T(`${label}: obdélník [${r.join(", ")}] je mimo pořadí, musí platit x0<x1 a y0<y1.`, `${label}: rectangle [${r.join(", ")}] is out of order; x0<x1 and y0<y1 required.`));
    }
  };
  if (Array.isArray(raw.rooms)) {
    raw.rooms.forEach((r, n) => {
      if (isObj(r) && Array.isArray(r.rects)) r.rects.forEach((q, k) => rectOrder(q, `rooms[${n}]${typeof r.id === "string" ? ` (${r.id})` : ""}.rects[${k}]`));
    });
  }
  for (const key of ["roofs", "outdoor"]) {
    const list = raw[key];
    if (Array.isArray(list)) list.forEach((r, n) => isObj(r) && rectOrder(r.rect, `${key}[${n}]${typeof r.id === "string" ? ` (${r.id})` : ""}.rect`));
  }
  return out.errors.length ? null : (parsed.success ? parsed.data : null);
}

// ---------------------------------------------------------------- house-wide rules that need no geometry
function checkRules(h: House, out: Collector): void {
  // privacy: the location is rounded to 0.1 degree
  for (const k of ["lat", "lon"] as const) {
    const v = h.location[k];
    if (Math.abs(v * 10 - Math.round(v * 10)) > 1e-9) {
      out.error("E-LOKACE", T(`location.${k} = ${v} není zaokrouhleno na 0,1 stupně.`, `location.${k} = ${v} is not rounded to 0.1 degree.`));
    }
  }
  // zones: every used type belongs to exactly one zone, no type is listed twice
  const zoneOfType = new Map<string, string[]>();
  for (const z of ["day", "night", "service"] as const) for (const t of h.zones[z].types) zoneOfType.set(t, [...(zoneOfType.get(t) ?? []), z]);
  for (const [t, zs] of zoneOfType) {
    if (zs.length > 1) out.error("E-ZONA", T(`Typ místnosti "${t}" je ve více zónách (${zs.join(", ")}).`, `Room type "${t}" is listed in several zones (${zs.join(", ")}).`));
  }
  for (const t of new Set(h.rooms.map((r) => r.type))) {
    if (!zoneOfType.has(t)) out.error("E-ZONA", T(`Typ místnosti "${t}" není v žádné zóně (day, night, service).`, `Room type "${t}" is in no zone (day, night, service).`));
  }
  for (const t of new Set(h.outdoor.map((o) => o.type))) {
    if (!(h.zones.outdoor.types as string[]).includes(t)) out.error("E-ZONA", T(`Typ venkovní plochy "${t}" není v zóně outdoor.`, `Outdoor type "${t}" is not in the outdoor zone.`));
  }
  // roles: all except "children" are unique
  const seenRole = new Map<string, string>();
  for (const r of h.rooms) {
    if (!r.role || r.role === "children") continue;
    const prev = seenRole.get(r.role);
    if (prev) out.error("E-ROLE", T(`Role "${r.role}" mají místnosti ${prev} a ${r.id}; musí být jedinečná.`, `Role "${r.role}" is used by rooms ${prev} and ${r.id}; it must be unique.`));
    else seenRole.set(r.role, r.id);
  }
  // assemblies against the plan
  const thickness = (a: { layers: { t: number }[] }): number => a.layers.reduce((s, l) => s + l.t, 0);
  const pairs: [string, number, number][] = [
    ["exteriorWall", thickness(h.assemblies.exteriorWall), h.wall.ext],
    ["bearingWall", thickness(h.assemblies.bearingWall), h.wall.bearing],
    ["partitionWall", thickness(h.assemblies.partitionWall), h.wall.part],
    ["ceiling", h.assemblies.ceiling.layers.filter((l) => l.role === "structure").reduce((s, l) => s + l.t, 0), h.slab],
  ];
  for (const [key, have, want] of pairs) {
    if (Math.abs(have - want) > THICKNESS_TOL) {
      out.error("E-SKLADBA", T(`Skladba ${key}: tloušťka ${c(have, 3)} m neodpovídá půdorysu (${c(want, 3)} m).`, `Assembly ${key}: thickness ${e(have, 3)} m does not match the plan (${e(want, 3)} m).`));
    }
  }
  if (!h.idea) out.warn("V-IDEA", T('Chybí pole "idea" (2-3 věty popisu domu).', 'Missing field "idea" (2-3 sentences describing the house).'));
}

// ---------------------------------------------------------------- geometry and design rules
const rname = (d: Derived, id: string | null): string => {
  const r = d.rooms.find((q) => q.id === id);
  return r ? `${id} (${r.name.cs})` : String(id);
};
const rnameEn = (d: Derived, id: string | null): string => {
  const r = d.rooms.find((q) => q.id === id);
  return r ? `${id} (${r.name.en})` : String(id);
};
const span = (b: { x0: number; y0: number; x1: number; y1: number } | null, f: (n: number) => string): string =>
  b ? `x ${f(b.x0)}-${f(b.x1)}, y ${f(b.y0)}-${f(b.y1)}` : "";
const rectTxt = (q: Rect, f: (n: number) => string): string => `[${q.map((v) => f(v)).join(", ")}]`;
const DIR_CS = { 0: "severní", 90: "východní", 180: "jižní", 270: "západní" } as Record<number, string>;
const DIR_EN = { 0: "north", 90: "east", 180: "south", 270: "west" } as Record<number, string>;

function checkGeometry(h: House, d: Derived, out: Collector): void {
  const lim = (v: number, [a, b]: [number, number]): boolean => v >= a - 1e-6 && v <= b + 1e-6;

  // overlaps, holes, connectivity
  for (const o of d.overlaps) {
    if (o.same) {
      out.error("E-PREKRYV", T(`Obdélníky místnosti ${rname(d, o.a)} se navzájem překrývají (${c(o.area)} m2; ${span(o.bbox, c)}).`, `Rectangles of room ${rnameEn(d, o.a)} overlap each other (${e(o.area)} m2; ${span(o.bbox, e)}).`));
    } else {
      out.error("E-PREKRYV", T(`Místnosti ${rname(d, o.a)} a ${rname(d, o.b)} se překrývají (${c(o.area)} m2; ${span(o.bbox, c)}).`, `Rooms ${rnameEn(d, o.a)} and ${rnameEn(d, o.b)} overlap (${e(o.area)} m2; ${span(o.bbox, e)}).`));
    }
  }
  for (const hole of d.holes) {
    out.error("E-DIRA", T(`Uvnitř půdorysu je nepokrytá díra ${c(hole.area)} m2 (${span(hole.bbox, c)}); žádná místnost ji nevyplňuje.`, `There is an uncovered hole of ${e(hole.area)} m2 inside the plan (${span(hole.bbox, e)}); no room fills it.`));
  }
  if (d.components.length > 1) {
    const list = d.components.map((q) => q.rooms.join("+")).join(" | ");
    out.error("E-NESOUVISLY", T(`Půdorys je nesouvislý: ${d.components.length} oddělených částí (${list}). Části se musí dotýkat celou stranou, ne jen rohem.`, `The plan is disconnected: ${d.components.length} separate parts (${list}). Parts must share a full side, not just a corner.`));
  }
  for (const r of d.rooms) {
    if (!(r.area > 0.05) || r.rectsClear.some((q) => q.w <= 0.05 || q.d <= 0.05)) {
      out.error("E-MISTNOST", T(`Místnost ${rname(d, r.id)} je po odečtení tlouštěk zdí příliš úzká (čisté rozměry ${r.rectsClear.map((q) => `${c(q.w)} x ${c(q.d)}`).join(", ")} m).`, `Room ${rnameEn(d, r.id)} is too narrow after subtracting the walls (net sizes ${r.rectsClear.map((q) => `${e(q.w)} x ${e(q.d)}`).join(", ")} m).`));
    }
  }

  // openings
  const wallById = new Map(d.walls.map((w) => [w.id, w]));
  const wallKindCs = (w: { ext: boolean; kind: string }): string => (w.ext ? "obvodové" : w.kind === "bearing" ? "vnitřní nosné" : "vnitřní (příčka)");
  const wallKindEn = (w: { ext: boolean; kind: string }): string => (w.ext ? "an exterior" : w.kind === "bearing" ? "an interior bearing" : "an interior partition");
  for (const o of d.openings) {
    const L = `${o.id} (${o.kind})`;
    const axisCs = o.orient === "h" ? `y=${c(o.axis)}, poloha x=${c(o.c)}` : `x=${c(o.axis)}, poloha y=${c(o.c)}`;
    const axisEn = o.orient === "h" ? `y=${e(o.axis)}, position x=${e(o.c)}` : `x=${e(o.axis)}, position y=${e(o.c)}`;
    if (o.problem === "no-axis") {
      const same = d.walls.filter((w) => w.orient === o.orient);
      const nearest = same.length ? same.reduce((a, b) => (Math.abs(b.at - o.axis) < Math.abs(a.at - o.axis) ? b : a)) : null;
      const ax = o.orient === "h" ? "y" : "x";
      out.error("E-OTVOR-ZED", T(`Otvor ${L} neleží na ose žádné zdi (orient "${o.orient}": ${axisCs}).${nearest ? ` Nejbližší zeď této orientace je na ${ax}=${c(nearest.at)}.` : ""}`, `Opening ${L} does not lie on any wall axis (orient "${o.orient}": ${axisEn}).${nearest ? ` The nearest wall of this orientation is at ${ax}=${e(nearest.at)}.` : ""}`));
      continue;
    }
    if (o.problem === "off-wall") {
      out.error("E-OTVOR-ZED", T(`Otvor ${L} leží na ose zdi, ale mimo její rozsah (${axisCs}); v tomto místě zeď není.`, `Opening ${L} lies on a wall axis but outside its extent (${axisEn}); there is no wall at this place.`));
      continue;
    }
    if (o.problem === "span") {
      const w = wallById.get(o.wallId as string)!;
      out.error("E-OTVOR-ZED", T(`Otvor ${L} (${axisCs}, šířka ${c(o.w)} m) přesahuje zeď ${o.wallId} (rozsah ${c(w.from)}-${c(w.to)}) nebo přechází přes styk zdí.`, `Opening ${L} (${axisEn}, width ${e(o.w)} m) exceeds wall ${o.wallId} (extent ${e(w.from)}-${e(w.to)}) or crosses a wall junction.`));
      continue;
    }
    const w = wallById.get(o.wallId as string)!;
    if (o.kind === "window" && !w.ext) {
      out.error("E-OTVOR-DRUH", T(`Otvor ${L} je ve ${wallKindCs(w)} zdi mezi ${w.lo} a ${w.hi}; okno smí být jen v obvodové zdi.`, `Opening ${L} is in ${wallKindEn(w)} wall between ${w.lo} and ${w.hi}; a window may only be in an exterior wall.`));
    }
    if (o.kind === "door" && w.ext) {
      out.error("E-OTVOR-DRUH", T(`Otvor ${L} je v obvodové zdi místnosti ${w.room}; dveře (door) patří jen do vnitřní zdi (do obvodové použijte entry, slider nebo garage).`, `Opening ${L} is in the exterior wall of room ${w.room}; a door belongs in an interior wall only (use entry, slider or garage in an exterior wall).`));
    }
    if ((o.kind === "entry" || o.kind === "garage" || o.kind === "slider") && !w.ext) {
      out.error("E-OTVOR-DRUH", T(`Otvor ${L} je ve ${wallKindCs(w)} zdi mezi ${w.lo} a ${w.hi}; ${o.kind} smí být jen v obvodové zdi.`, `Opening ${L} is in ${wallKindEn(w)} wall between ${w.lo} and ${w.hi}; ${o.kind} may only be in an exterior wall.`));
    }
    const lm = OPENING_LIMITS[o.kind];
    if (!lim(o.w, lm.w)) out.error("E-OTVOR-ROZMER", T(`Otvor ${L}: šířka ${c(o.w)} m je mimo rozsah ${c(lm.w[0])}-${c(lm.w[1])} m.`, `Opening ${L}: width ${e(o.w)} m is outside the range ${e(lm.w[0])}-${e(lm.w[1])} m.`));
    if (!lim(o.sill, lm.sill)) out.error("E-OTVOR-ROZMER", T(`Otvor ${L}: parapet (sill) ${c(o.sill)} m je mimo rozsah ${c(lm.sill[0])}-${c(lm.sill[1])} m.`, `Opening ${L}: sill ${e(o.sill)} m is outside the range ${e(lm.sill[0])}-${e(lm.sill[1])} m.`));
    if (!lim(o.head, lm.head)) out.error("E-OTVOR-ROZMER", T(`Otvor ${L}: nadpraží (head) ${c(o.head)} m je mimo rozsah ${c(lm.head[0])}-${c(lm.head[1])} m.`, `Opening ${L}: head ${e(o.head)} m is outside the range ${e(lm.head[0])}-${e(lm.head[1])} m.`));
    if (o.head > h.clearHeight + 1e-6) out.error("E-OTVOR-ROZMER", T(`Otvor ${L}: nadpraží ${c(o.head)} m je nad světlou výškou ${c(h.clearHeight)} m.`, `Opening ${L}: head ${e(o.head)} m is above the clear height ${e(h.clearHeight)} m.`));
    if (o.kind === "window" && o.head - o.sill < 0.3 - 1e-6) out.error("E-OTVOR-ROZMER", T(`Otvor ${L}: okno je nižší než 0,30 m (sill ${c(o.sill)}, head ${c(o.head)}).`, `Opening ${L}: the window is lower than 0.30 m (sill ${e(o.sill)}, head ${e(o.head)}).`));
    if ((o.clearStart ?? 1) < 0.2 - 1e-6) out.error("E-OTVOR-ROH", T(`Otvor ${L} je jen ${c(o.clearStart ?? 0)} m od rohu/styku zdí na začátku zdi ${o.wallId} (min. 0,20 m čistého zdiva od lícu kolmé zdi).`, `Opening ${L} is only ${e(o.clearStart ?? 0)} m from the corner/junction at the start of wall ${o.wallId} (at least 0.20 m of clear masonry from the face of the perpendicular wall).`));
    if ((o.clearEnd ?? 1) < 0.2 - 1e-6) out.error("E-OTVOR-ROH", T(`Otvor ${L} je jen ${c(o.clearEnd ?? 0)} m od rohu/styku zdí na konci zdi ${o.wallId} (min. 0,20 m čistého zdiva od lícu kolmé zdi).`, `Opening ${L} is only ${e(o.clearEnd ?? 0)} m from the corner/junction at the end of wall ${o.wallId} (at least 0.20 m of clear masonry from the face of the perpendicular wall).`));
    if (o.kind === "garage" && w.ext) {
      const rr = d.rooms.find((q) => q.id === w.room);
      if (rr && rr.type !== "garage") out.warn("V-GARAZ-VRATA", T(`Otvor ${L} (garážová vrata) je v místnosti ${rname(d, w.room ?? null)}, která není typu garage.`, `Opening ${L} (garage door) is in room ${rnameEn(d, w.room ?? null)}, which is not of type garage.`));
    }
  }
  const located = d.openings.filter((o) => !o.problem);
  for (let a = 0; a < located.length; a++) {
    for (let b = a + 1; b < located.length; b++) {
      const A = located[a];
      const B = located[b];
      if (A.orient !== B.orient || Math.abs(A.axis - B.axis) > 0.011) continue;
      const gap = Math.max(A.from, B.from) - Math.min(A.to, B.to);
      if (gap < 0.2 - 1e-6) {
        out.error("E-OTVOR-OTVOR", T(`Otvory ${A.id} a ${B.id} jsou ${gap < 0 ? "překryté" : `jen ${c(gap)} m od sebe`} (min. 0,20 m mezi otvory na jedné zdi).`, `Openings ${A.id} and ${B.id} ${gap < 0 ? "overlap" : `are only ${e(gap)} m apart`} (at least 0.20 m between openings on one wall).`));
      }
    }
  }
  for (const a of d.accents) {
    if (a.problem === "no-axis" || a.problem === "off-wall") out.error("E-OBKLAD", T(`Obklad ${a.id} neleží na žádné zdi.`, `Cladding ${a.id} is not on any wall.`));
    else if (a.problem === "span") out.error("E-OBKLAD", T(`Obklad ${a.id} přesahuje zeď ${a.wallId}.`, `Cladding ${a.id} exceeds wall ${a.wallId}.`));
    else if (!a.exterior) out.error("E-OBKLAD", T(`Obklad ${a.id} leží ve vnitřní zdi; dřevěný obklad patří jen na obvodovou zeď.`, `Cladding ${a.id} is in an interior wall; timber cladding belongs on an exterior wall only.`));
  }

  // roofs
  const roofRects = d.roofs.map((r) => r.rect);
  const TOL = 0.01;
  if (!d.roofs.length) out.error("E-STRECHA", T('Dům nemá žádnou střechu (pole "roofs" je prázdné).', 'The house has no roof (field "roofs" is empty).'));
  let wallErrs = 0;
  for (const w of d.walls) {
    if (!w.ext) continue;
    const un = uncovered([wallBody(w, d.walls)], roofRects, TOL);
    if (un.area > 1e-4) {
      wallErrs++;
      const ax = w.orient === "h" ? "x" : "y";
      out.error("E-STRECHA", T(`Zeď ${w.id} (${DIR_CS[w.azimuth ?? 0]}, místnost ${rname(d, w.room ?? null)}, ${ax} ${c(w.from)}-${c(w.to)}) není celá pod střechou (mimo ${c(un.area)} m2). Vnější líc zdi musí ležet uvnitř některého rect střechy.`, `Wall ${w.id} (${DIR_EN[w.azimuth ?? 0]}, room ${rnameEn(d, w.room ?? null)}, ${ax} ${e(w.from)}-${e(w.to)}) is not entirely under the roof (${e(un.area)} m2 outside). The outer face of the wall must lie inside a roof rect.`));
    }
  }
  if (!wallErrs && d.roofs.length) {
    const un = uncovered(d.outline.rects, roofRects, TOL);
    if (un.area > 1e-3) out.error("E-STRECHA", T(`Část půdorysu o ploše ${c(un.area)} m2 není zastřešená (${un.rects.map((q) => rectTxt(q, c)).join(" ")}).`, `Part of the plan, ${e(un.area)} m2, is not roofed (${un.rects.map((q) => rectTxt(q, e)).join(" ")}).`));
  }
  for (const r of d.roofs) {
    if (r.wallTop < d.defaultWallTop - 0.01) out.warn("V-STRECHA-VYSKA", T(`Střecha ${r.id}: wallTop ${c(r.wallTop)} m je níž než strop + konstrukce (${c(d.defaultWallTop)} m).`, `Roof ${r.id}: wallTop ${e(r.wallTop)} m is lower than ceiling + structure (${e(d.defaultWallTop)} m).`));
    if (r.overhang > 1.5) out.warn("V-STRECHA-PRESAH", T(`Střecha ${r.id}: přesah ${c(r.overhang)} m je neobvykle velký.`, `Roof ${r.id}: overhang ${e(r.overhang)} m is unusually large.`));
  }

  // outdoor areas
  const eaves = d.roofs.map((r) => r.eaveRect);
  for (const o of h.outdoor) {
    const nm = OUTDOOR_TYPE_NAMES[o.type];
    const Lcs = `Venkovní plocha ${o.id} (${nm.cs}${o.covered ? ", krytá" : ""})`;
    const Len = `Outdoor area ${o.id} (${nm.en}${o.covered ? ", covered" : ""})`;
    const over = d.outline.rects.reduce((s, q) => s + interArea(q, o.rect), 0);
    if (over > 0.01) out.warn("V-VENKU-DUM", T(`${Lcs} zasahuje do obrysu domu (${c(over)} m2).`, `${Len} overlaps the house outline (${e(over)} m2).`));
    if (o.covered) {
      const un = uncovered([o.rect], eaves, TOL);
      if (un.area > 1e-3) {
        out.error("E-TERASA", T(`${Lcs} není celá pod střechou včetně přesahu (nezakryto ${c(un.area)} m2; ${un.rects.map((q) => rectTxt(q, c)).join(" ")}). Přidejte střechu nebo zmenšete plochu.`, `${Len} is not entirely under a roof including the overhang (${e(un.area)} m2 uncovered; ${un.rects.map((q) => rectTxt(q, e)).join(" ")}). Add a roof or shrink the area.`));
      }
      if (!o.posts || !o.posts.length) out.warn("V-TERASA-SLOUPY", T(`${Lcs} je krytá, ale nemá žádné sloupy (posts).`, `${Len} is covered but has no posts.`));
    }
    for (const p of o.posts ?? []) {
      if (!inRect(expandRect(o.rect, 0.5), p[0], p[1])) out.warn("V-SLOUP-MIMO", T(`Sloup [${p.join(", ")}] u plochy ${o.id} leží mimo její obdélník.`, `Post [${p.join(", ")}] of area ${o.id} lies outside its rectangle.`));
    }
  }

  // glazing, daylight, orientation
  for (const r of d.rooms.filter((q) => (HABITABLE as readonly string[]).includes(q.type))) {
    const ratio = r.area > 0 ? r.glazing.total / r.area : 0;
    if (ratio < 0.1 - 1e-9) {
      out.error("E-ZASKLENI", T(`Obytná místnost ${rname(d, r.id)}: plocha zasklení ${c(r.glazing.total)} m2 je ${c(ratio * 100, 1)} % podlahy ${c(r.area)} m2 (min. 10 %).`, `Habitable room ${rnameEn(d, r.id)}: glazing area ${e(r.glazing.total)} m2 is ${e(ratio * 100, 1)} % of the floor ${e(r.area)} m2 (at least 10 %).`));
    } else if (ratio < 0.125 - 1e-9) {
      out.warn("V-ZASKLENI", T(`Místnost ${rname(d, r.id)}: zasklení je ${c(ratio * 100, 1)} % podlahy (doporučeno aspoň 12,5 % = 1/8).`, `Room ${rnameEn(d, r.id)}: glazing is ${e(ratio * 100, 1)} % of the floor (at least 12.5 % = 1/8 recommended).`));
    }
  }
  const livings = d.rooms.filter((r) => r.type === "living").sort((a, b) => b.area - a.area);
  const mainLiving = d.rooms.find((r) => r.role === "main-living") ?? livings[0];
  if (!mainLiving) out.warn("V-OBYTNA", T("Dům nemá žádnou místnost typu living (hlavní obytný prostor).", "The house has no room of type living (main living space)."));
  else {
    const share = mainLiving.glazing.total > 0 ? mainLiving.glazing.S / mainLiving.glazing.total : 0;
    if (share < 0.4 - 1e-9) out.warn("V-JIH", T(`Hlavní obytná místnost ${rname(d, mainLiving.id)} má na jih jen ${c(share * 100, 0)} % zasklení (doporučeno aspoň 40 %).`, `The main living room ${rnameEn(d, mainLiving.id)} has only ${e(share * 100, 0)} % of its glazing facing south (at least 40 % recommended).`));
  }
  for (const r of d.rooms) {
    if ((r.type === "bedroom" || r.type === "kids") && r.glazing.total > 0 && r.glazing.N === r.glazing.total) {
      out.warn("V-SEVER", T(`${r.type === "kids" ? "Dětský pokoj" : "Ložnice"} ${rname(d, r.id)} je zasklená jen na sever.`, `${r.type === "kids" ? "Children's room" : "Bedroom"} ${rnameEn(d, r.id)} is glazed to the north only.`));
    }
    if (r.type === "corridor" && r.minWidth < 1.0 - 1e-6) out.warn("V-CHODBA", T(`Chodba ${rname(d, r.id)} je čistě široká jen ${c(r.minWidth)} m (doporučeno aspoň 1,0 m).`, `Corridor ${rnameEn(d, r.id)} is only ${e(r.minWidth)} m wide in the clear (at least 1.0 m recommended).`));
    if (r.type !== "corridor" && r.area > 0.05 && r.minWidth < 0.9 - 1e-6 && r.type !== "wc" && r.type !== "pantry") {
      out.warn("V-UZKA", T(`Místnost ${rname(d, r.id)} má nejmenší čistý rozměr jen ${c(r.minWidth)} m.`, `Room ${rnameEn(d, r.id)} has a smallest clear dimension of only ${e(r.minWidth)} m.`));
    }
    if (!(WINDOWLESS_OK as readonly string[]).includes(r.type)) {
      if (!d.openings.some((o) => o.room === r.id && o.glazingArea > 0)) out.warn("V-BEZ-OKNA", T(`Místnost ${rname(d, r.id)} (${r.type}) nemá žádné okno.`, `Room ${rnameEn(d, r.id)} (${r.type}) has no window.`));
    }
    const mn = MIN_AREA[r.type];
    if (mn !== undefined && r.area < mn - 1e-9) out.warn("V-PLOCHA", T(`${rname(d, r.id)}: čistá plocha ${c(r.area)} m2 je pod doporučeným minimem ${c(mn, 1)} m2 (${r.type}).`, `${rnameEn(d, r.id)}: net area ${e(r.area)} m2 is below the recommended minimum ${e(mn, 1)} m2 (${r.type}).`));
    if (r.type === "garage") {
      const big = r.mainClear;
      if (Math.min(big.w, big.d) < GARAGE_MIN_CLEAR - 1e-6) out.error("E-GARAZ-ROZMER", T(`Garáž ${rname(d, r.id)} má čisté rozměry ${c(big.w)} x ${c(big.d)} m; minimum je 5,5 x 5,5 m.`, `Garage ${rnameEn(d, r.id)} has clear dimensions ${e(big.w)} x ${e(big.d)} m; the minimum is 5.5 x 5.5 m.`));
      if (!d.openings.some((o) => o.kind === "garage" && o.room === r.id)) out.warn("V-GARAZ-VRATA", T(`Garáž ${rname(d, r.id)} nemá garážová vrata (kind garage).`, `Garage ${rnameEn(d, r.id)} has no garage door (kind garage).`));
    }
  }

  // access from the main entrance
  const entries = d.openings.filter((o) => o.kind === "entry" && o.room);
  if (!entries.length) out.error("E-VSTUP", T('Dům nemá hlavní vstup: chybí otvor kind "entry" v obvodové zdi.', 'The house has no main entrance: an opening of kind "entry" in an exterior wall is missing.'));
  else {
    const first = entries[0];
    if (entries.length > 1) out.warn("V-VICE-VSTUPU", T(`Je víc vstupních dveří (${entries.map((x) => x.id).join(", ")}); dostupnost se počítá z prvního (${first.id}).`, `There is more than one entrance door (${entries.map((x) => x.id).join(", ")}); access is computed from the first (${first.id}).`));
    for (const id of d.access.unreachable) {
      const r = d.rooms.find((q) => q.id === id)!;
      out.error("E-DOSTUPNOST", T(`Místnost ${rname(d, id)} není dosažitelná dveřmi z hlavního vstupu (${first.id} v ${rname(d, first.room)}).${r.type === "garage" ? " Garáž musí mít dveře do haly nebo technické místnosti." : ""}`, `Room ${rnameEn(d, id)} is not reachable by doors from the main entrance (${first.id} in ${rnameEn(d, first.room)}).${r.type === "garage" ? " The garage needs a door to the hall or the utility room." : ""}`));
    }
    // reachability without passing through private rooms
    const adj = new Map<string, string[]>(d.rooms.map((r) => [r.id, []]));
    for (const ed of d.access.edges) {
      adj.get(ed.a)?.push(ed.b);
      adj.get(ed.b)?.push(ed.a);
    }
    const typeOf = new Map(d.rooms.map((r) => [r.id, r.type as string]));
    const start = first.room as string;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const a = queue.shift()!;
      if (a !== start && (PRIVATE_TYPES as readonly string[]).includes(typeOf.get(a) as string)) continue;
      for (const b of adj.get(a) ?? []) if (!seen.has(b)) { seen.add(b); queue.push(b); }
    }
    for (const r of d.rooms) {
      if (d.access.depth[r.id] !== undefined && !seen.has(r.id) && !["bath", "wc", "wardrobe"].includes(r.type)) {
        out.warn("V-PRUCHOD", T(`Místnost ${rname(d, r.id)} je dostupná jen průchodem přes soukromou místnost (ložnice, dětský pokoj, host, koupelna, WC, šatna).`, `Room ${rnameEn(d, r.id)} is reachable only through a private room (bedroom, children's room, guest room, bathroom, toilet, wardrobe).`));
      }
    }
  }

  // furniture
  const roomOfPoint = (x: number, y: number) => d.rooms.find((r) => r.cleanRects.some((q) => inRect(q, x, y)));
  h.furniture.forEach((it, n) => {
    const fr = furnitureRect(it, FURNITURE);
    const labCs = `Nábytek ${n + 1} (${it.type} v [${c(it.x)}, ${c(it.y)}])`;
    const labEn = `Furniture ${n + 1} (${it.type} at [${e(it.x)}, ${e(it.y)}])`;
    const room = roomOfPoint(it.x, it.y);
    if (room) {
      const inside = room.cleanRects.reduce((s, q) => s + interArea(q, fr.rect), 0);
      if (inside < rectArea(fr.rect) * 0.98) out.warn("V-NABYTEK-MIMO", T(`${labCs} přesahuje čistou plochu místnosti ${rname(d, room.id)} o ${c(rectArea(fr.rect) - inside)} m2.`, `${labEn} exceeds the net area of room ${rnameEn(d, room.id)} by ${e(rectArea(fr.rect) - inside)} m2.`));
    } else {
      const od = h.outdoor.find((o) => inRect(o.rect, it.x, it.y));
      if (!od) out.warn("V-NABYTEK-MIMO", T(`${labCs} leží mimo všechny místnosti i venkovní plochy.`, `${labEn} lies outside all rooms and outdoor areas.`));
      else if (interArea(od.rect, fr.rect) < rectArea(fr.rect) * 0.98) out.warn("V-NABYTEK-MIMO", T(`${labCs} přesahuje venkovní plochu ${od.id}.`, `${labEn} exceeds outdoor area ${od.id}.`));
    }
    for (const o of d.openings) {
      if ((o.kind !== "door" && o.kind !== "entry") || o.problem) continue;
      const sw = doorSwing(o, wallById.get(o.wallId as string)!.t);
      if (sw && rectHitsSwing(fr.rect, sw)) out.warn("V-NABYTEK-DVERE", T(`${labCs} koliduje s otevíráním dveří ${o.id}.`, `${labEn} collides with the swing of door ${o.id}.`));
    }
  });

  // thermal envelope, PV, roof penetrations
  const uChecks: [string, string, number, number][] = [
    ["V-U-ZED", "exteriorWall", d.assemblies.exteriorWall.U, U_LIMITS.exteriorWall],
    ["V-U-STRECHA", "roof", d.assemblies.roof.U, U_LIMITS.roof],
    ["V-U-PODLAHA", "groundFloor", d.assemblies.groundFloor.U, U_LIMITS.groundFloor],
  ];
  for (const [code, key, u, limit] of uChecks) {
    if (u > limit) out.warn(code, T(`Skladba ${key}: U = ${c(u, 3)} W/(m2K) je nad doporučenou hodnotou ${c(limit, 2)}.`, `Assembly ${key}: U = ${e(u, 3)} W/(m2K) is above the recommended ${e(limit, 2)}.`));
  }
  if (d.pv.count === 0) out.warn("V-FVE-NULA", T("Na vybrané roviny střechy se nevejde žádný fotovoltaický modul.", "No photovoltaic module fits on the selected roof planes."));
  const reported = new Set<string>();
  for (const f of d.roofPlanes) {
    f.edges.forEach((edge, i) => {
      if (edge.kind !== "valley") return;
      const a = f.pts3[i];
      const b = f.pts3[(i + 1) % f.pts3.length];
      const low = a[2] <= b[2] ? a : b;
      const key = `${low[0].toFixed(2)},${low[1].toFixed(2)}`;
      if (reported.has(key)) return;
      reported.add(key);
      if (!h.roof.downpipes.some((p) => Math.hypot(p.x - low[0], p.y - low[1]) < 0.3)) {
        out.warn("V-SVOD-UDOLI", T(`U spodního konce údolí střechy v [${c(low[0])}, ${c(low[1])}] chybí dešťový svod (roof.downpipes).`, `There is no downpipe at the low end of the roof valley at [${e(low[0])}, ${e(low[1])}] (roof.downpipes).`));
      }
    });
  }
  d.lightpipes.forEach((lp, i) => {
    if (!lp.room || !lp.face) out.warn("V-SVETLOVOD-MIMO", T(`Světlovod ${i + 1} v [${c(lp.x)}, ${c(lp.y)}] neleží nad místností pod střechou.`, `Light pipe ${i + 1} at [${e(lp.x)}, ${e(lp.y)}] is not above a room under the roof.`));
  });
}

// ---------------------------------------------------------------- entry points
export interface ValidateOptions {
  /** Stored in the derived data as `inputHash`. */
  inputHash?: string | null;
}

/** Validates a parsed JSON value. Derived data and metrics are returned when the structure is valid. */
export function validateHouse(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const out = new Collector();
  const house = checkStructure(input, out);
  if (!house) return { valid: false, errors: out.errors, warnings: out.warnings, house: null, derived: null, metrics: null };
  checkRules(house, out);
  const derived = derive(house, { inputHash: options.inputHash ?? null });
  checkGeometry(house, derived, out);
  const metrics = computeMetrics(house, derived);
  return { valid: out.errors.length === 0, errors: out.errors, warnings: out.warnings, house, derived, metrics };
}

/** Validates JSON text (reports E-JSON for a syntax error). */
export function validateHouseJson(text: string, options: ValidateOptions = {}): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [{ code: "E-JSON", severity: "error", message: T(`Neplatný JSON: ${msg}`, `Invalid JSON: ${msg}`) }],
      warnings: [],
      house: null,
      derived: null,
      metrics: null,
    };
  }
  return validateHouse(raw, options);
}

/** Plain-text report of a validation result in one language. */
export function formatReport(result: ValidationResult, locale: "cs" | "en" = "cs"): string {
  const cs = locale === "cs";
  const L: string[] = [];
  L.push(cs ? `CHYBY (${result.errors.length}):` : `ERRORS (${result.errors.length}):`);
  if (!result.errors.length) L.push(cs ? "  žádné" : "  none");
  result.errors.forEach((x, n) => L.push(`  ${n + 1}. [${x.code}] ${x.message[locale]}`));
  L.push("");
  L.push(cs ? `VAROVÁNÍ (${result.warnings.length}):` : `WARNINGS (${result.warnings.length}):`);
  if (!result.warnings.length) L.push(cs ? "  žádná" : "  none");
  result.warnings.forEach((x, n) => L.push(`  ${n + 1}. [${x.code}] ${x.message[locale]}`));
  L.push("");
  const m = result.metrics;
  if (m && result.derived) {
    const f = (v: number, d = 1): string => (cs ? c(v, d) : e(v, d));
    L.push(cs ? "METRIKY:" : "METRICS:");
    L.push(`  ${cs ? "Užitná plocha (bez garáže)" : "Net floor area (without garage)"}: ${f(m.netArea, 2)} m2`);
    L.push(`  ${cs ? "Plocha garáže" : "Garage area"}: ${f(m.garageArea, 2)} m2`);
    L.push(`  ${cs ? "Zastavěná plocha" : "Footprint"}: ${f(m.footprintArea, 2)} m2`);
    L.push(`  ${cs ? "Obestavěný prostor" : "Enclosed volume"}: ${f(m.volume)} m3`);
    L.push(`  ${cs ? "Plocha střech" : "Roof area"}: ${f(m.roofArea)} m2`);
    L.push(`  ${cs ? "Zasklení celkem" : "Total glazing"}: ${f(m.glazing.total, 2)} m2 (N ${f(m.glazing.N)}, E ${f(m.glazing.E)}, S ${f(m.glazing.S)}, W ${f(m.glazing.W)})`);
    L.push(`  A/V: ${f(m.envelopeToVolume ?? 0, 2)} 1/m`);
    L.push(`  ${cs ? "FVE (rozmístění)" : "PV (layout)"}: ${m.pvModuleCount} ${cs ? "modulů" : "modules"}, ${f(m.pvLayoutKwp, 2)} kWp`);
    L.push("");
    L.push(cs ? "MÍSTNOSTI (čistá plocha):" : "ROOMS (net area):");
    for (const r of result.derived.rooms) L.push(`  ${r.id.padEnd(6)} ${r.name[locale].padEnd(40)} ${String(r.type).padEnd(9)} ${f(r.area, 2).padStart(7)} m2`);
    L.push("");
  } else {
    L.push(cs ? "METRIKY: nelze spočítat, dokud nejsou opraveny chyby struktury." : "METRICS: cannot be computed until the structural errors are fixed.");
    L.push("");
  }
  L.push(
    result.errors.length
      ? cs ? `VÝSLEDEK: NEPLATNÝ model (${result.errors.length} chyb, ${result.warnings.length} varování)` : `RESULT: INVALID model (${result.errors.length} errors, ${result.warnings.length} warnings)`
      : cs ? `VÝSLEDEK: v pořádku (0 chyb, ${result.warnings.length} varování)` : `RESULT: OK (0 errors, ${result.warnings.length} warnings)`,
  );
  return L.join("\n");
}
