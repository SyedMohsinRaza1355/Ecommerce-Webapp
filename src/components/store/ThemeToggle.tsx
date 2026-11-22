"use client";

import { useEffect, useState } from "react";

/** Light / dark switch (F-077). The choice is kept in this browser only. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const on = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = on ? "dark" : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(on);
  }, []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("theme", next ? "dark" : "light");
  };
  return <button type="button" className="btn btn-secondary" onClick={flip} aria-pressed={dark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>{dark ? "☀" : "☾"}</button>;
}
