"use client";

import { useEffect } from "react";

/** Print button. With auto set, the print dialog opens by itself a moment after the page loads. */
export default function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return <button className="btn btn-primary" onClick={() => window.print()}>Print</button>;
}
