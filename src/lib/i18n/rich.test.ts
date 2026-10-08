import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { accent, plainText, rich } from "./rich";

const tags = { b: (c: ReactNode) => createElement("b", null, c), a: (c: ReactNode) => createElement("a", { href: "/x" }, c) };

/** Serialises a node tree to a string, enough to compare structure. */
function html(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(html).join("");
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    // the wrapping Fragment (keyed) is transparent
    if (typeof el.type === "symbol") return html(el.props.children);
    return `[${String(el.type)}:${html(el.props.children)}]`;
  }
  return String(node ?? "");
}

describe("rich", () => {
  it("returns plain text untouched", () => {
    expect(rich("plain", tags)).toEqual(["plain"]);
  });
  it("turns known tags into elements and keeps the surrounding text", () => {
    expect(html(rich("See <a>the plan</a> and <b>read</b> on.", tags))).toBe("See [a:the plan] and [b:read] on.");
  });
  it("leaves unknown or unclosed tags as text", () => {
    expect(html(rich("a <i>b</i> c", tags))).toBe("a <i>b</i> c");
    expect(html(rich("a <b>b c", tags))).toBe("a <b>b c");
  });
  it("supports different tags nested in each other", () => {
    expect(html(rich("<a>go <b>now</b></a>", tags))).toBe("[a:go [b:now]]");
  });
  it("without tags the text comes back as is", () => {
    expect(rich("a <b>b</b>", {})).toEqual(["a <b>b</b>"]);
  });
});

describe("two-voice headings", () => {
  it("renders the <q> accent phrase as a span with the accent class", () => {
    const out = accent("Dům a zahrada <q>ve 3D</q>");
    expect(html(out)).toBe("Dům a zahrada [span:ve 3D]");
    const el = out[1] as ReactElement<{ children: ReactElement<{ className: string }> }>;
    expect(el.props.children.props.className).toBe("accent");
  });
  it("leaves a title without an accent as it is", () => {
    expect(accent("Galerie")).toEqual(["Galerie"]);
  });
  it("gives the plain text for titles and labels", () => {
    expect(plainText("Dům a zahrada <q>ve 3D</q>")).toBe("Dům a zahrada ve 3D");
    expect(plainText("See <a>the plan</a>")).toBe("See the plan");
  });
});
