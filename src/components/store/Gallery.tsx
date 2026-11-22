"use client";

import { useRef, useState } from "react";

/** Main picture with thumbnails and a full-size view (F-006). Works with keyboard and screen readers. */
export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  const dlg = useRef<HTMLDialogElement>(null);
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <div>
      <button type="button" className="block w-full cursor-zoom-in" aria-label={`Enlarge picture of ${name}`} onClick={() => dlg.current?.showModal()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur} alt={name} className="product-img" width={800} height={600} />
      </button>
      {images.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More pictures">
          {images.map((src, n) => (
            <li key={src + n}>
              <button type="button" onClick={() => setI(n)} aria-label={`Show picture ${n + 1}`} aria-current={n === i} className={`overflow-hidden rounded-lg ring-2 ${n === i ? "ring-[var(--brand-primary)]" : "ring-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" width={64} height={64} className="h-16 w-16 object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <dialog ref={dlg} className="m-auto max-h-[92vh] max-w-[92vw] rounded-2xl bg-white p-2 backdrop:bg-black/70" aria-label={`Large picture of ${name}`} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur} alt={name} className="max-h-[84vh] max-w-full rounded-xl object-contain" />
        <div className="mt-2 flex justify-between gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setI((i - 1 + images.length) % images.length)} disabled={images.length < 2}>Previous</button>
          <button type="button" className="btn btn-primary" onClick={() => dlg.current?.close()}>Close</button>
          <button type="button" className="btn btn-secondary" onClick={() => setI((i + 1) % images.length)} disabled={images.length < 2}>Next</button>
        </div>
      </dialog>
    </div>
  );
}
