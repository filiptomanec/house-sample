import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { rich } from "./rich";

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
