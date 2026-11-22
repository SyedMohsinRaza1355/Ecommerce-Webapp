"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;

/** Reads a barcode or QR code with the phone camera and types it into the field named by `target`. Hidden when the browser cannot do it. */
export function ScanButton({ target }: { target: string }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSupported("BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia)); }, []);
  useEffect(() => {
    if (!open) return;
    let stop = false;
    let stream: MediaStream | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const det = new (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector();
        while (!stop) {
          const found = await det.detect(v).catch(() => []);
          if (found[0]) {
            const el = document.getElementById(target) as HTMLInputElement | null;
            if (el) { el.value = found[0].rawValue; el.focus(); }
            setOpen(false);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setOpen(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, target]);
  if (!supported) return null;
  return (
    <div className="mb-3">
      <button type="button" className="btn btn-secondary" onClick={() => setOpen((o) => !o)}>{open ? "Close camera" : "Scan with camera"}</button>
      {open && <video ref={video} className="mt-2 w-full max-w-sm rounded-xl bg-black" muted playsInline aria-label="Camera view for scanning a barcode" />}
    </div>
  );
}
