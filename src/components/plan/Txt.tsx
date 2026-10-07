import type { ReactNode, SVGProps } from "react";

/**
 * SVG text positioned in plan metres. The font size is given in metres too; the text is laid out in centimetres and scaled
 * by 1/100, so the browser never sees a font size below one unit (tiny sizes render poorly in some engines).
 * `halo` is the thickness of the outline in the page colour, in em (0 = none).
 */
export function Txt({ x, y, fs, rot = 0, halo = 0, children, ...rest }: {
  x: number; y: number; fs: number; rot?: number; halo?: number; children: ReactNode;
} & Omit<SVGProps<SVGTextElement>, "x" | "y" | "fontSize" | "transform" | "children">) {
  return (
    <text transform={`translate(${x} ${y}) rotate(${rot}) scale(0.01)`} fontSize={fs * 100} strokeWidth={halo ? fs * 100 * halo : undefined} {...rest}>
      {children}
    </text>
  );
}
