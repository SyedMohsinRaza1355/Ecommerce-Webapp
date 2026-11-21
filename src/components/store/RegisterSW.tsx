"use client";

import { useEffect } from "react";

export function RegisterSW({ sub }: { sub: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register(`/s/${sub}/sw.js`, { scope: `/s/${sub}/` }).catch(() => undefined);
  }, [sub]);
  return null;
}
