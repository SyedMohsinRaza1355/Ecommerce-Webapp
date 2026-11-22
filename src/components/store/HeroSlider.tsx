"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type Slide = { title: string; text: string; imageUrl: string; link: string };

/** Home page banner that changes by itself, pauses on hover or focus, and never moves for people who asked for less motion. */
export default function HeroSlider({ slides, cta }: { slides: Slide[]; cta: string }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (slides.length < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), 6000);
    return () => clearInterval(id);
  }, [slides.length, paused]);
  const s = slides[i];
  return (
    <section
      className="hero-bg relative -mx-4 -mt-8 mb-10 overflow-hidden rounded-b-3xl sm:mx-0 sm:mt-0 sm:rounded-3xl"
      aria-roledescription="carousel" aria-label="Featured"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      {s.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
      )}
      {s.imageUrl && <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/45 to-black/60" aria-hidden="true" />}
      <div className="relative px-6 py-14 text-center sm:py-20" aria-live={paused ? "polite" : "off"}>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{s.title}</h1>
        {s.text && <p className="mx-auto mt-3 max-w-xl text-lg text-slate-100 urdu-line">{s.text}</p>}
        {s.link && (s.link.startsWith("/") ? <Link href={s.link} className="btn btn-primary mt-7">{cta}</Link> : <a href={s.link} rel="noopener noreferrer" className="btn btn-primary mt-7">{cta}</a>)}
      </div>
      {slides.length > 1 && (
        <div className="relative flex justify-center gap-2 pb-4" role="group" aria-label="Choose a slide">
          {slides.map((_, n) => (
            <button key={n} onClick={() => setI(n)} aria-label={`Slide ${n + 1}`} aria-current={n === i} className={`h-3 w-3 rounded-full ${n === i ? "bg-white" : "bg-white/40"}`} />
          ))}
        </div>
      )}
    </section>
  );
}
