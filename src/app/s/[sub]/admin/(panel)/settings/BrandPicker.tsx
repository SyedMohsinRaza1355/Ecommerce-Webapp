"use client";

import { useState } from "react";
import { autoFixBrand, checkBrand, isHex } from "@/lib/color";

/** Live colour picker with the WCAG contrast guard (F-139): warns and can fix weak colours before publishing. */
export default function BrandPicker({ initial }: { initial: string }) {
  const [c, setC] = useState(initial || "#4f46e5");
  const valid = isHex(c);
  const r = valid ? checkBrand(c) : null;
  return (
    <div className="field">
      <span>Brand colour</span>
      <div className="flex flex-wrap items-center gap-3">
        <input type="color" aria-label="Pick a colour" value={valid ? c : "#4f46e5"} onChange={(e) => setC(e.target.value)} className="h-11 w-14 cursor-pointer rounded border border-line" />
        <input className="input w-36 font-mono" name="primary" value={c} onChange={(e) => setC(e.target.value.trim())} maxLength={7} dir="ltr" aria-describedby="contrast" />
        {valid && <span className="rounded-lg px-4 py-2 text-sm font-bold" style={{ background: c, color: r!.text }}>Button preview</span>}
      </div>
      <div id="contrast" aria-live="polite" className="mt-2 text-sm">
        {!valid && <p className="err">Use a colour like #4f46e5.</p>}
        {r && r.passesAA && <p className="ok">Text is easy to read on this colour (contrast {r.ratio}:1, WCAG AA passed).</p>}
        {r && !r.passesAA && (
          <p className="err">
            Text is hard to read on this colour (contrast {r.ratio}:1; at least 4.5:1 is needed).{" "}
            <button type="button" className="underline" onClick={() => setC(autoFixBrand(c))}>Fix it for me</button>
          </p>
        )}
      </div>
    </div>
  );
}
