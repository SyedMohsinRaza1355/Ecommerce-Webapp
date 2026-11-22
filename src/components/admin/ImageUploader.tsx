"use client";

import { useId, useState } from "react";
import type { AdminState } from "@/app/s/[sub]/admin/actions";

type Upload = (p: AdminState, f: FormData) => Promise<AdminState>;

/** Shrinks a picked picture in the browser (max 1000 px, JPEG), uploads it, and fills the link field next to it. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background instead of black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  for (const q of [0.85, 0.72, 0.6, 0.45]) {
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 290 * 1024) return blob;
  }
  throw new Error("This picture is too detailed to shrink enough. Try a simpler one.");
}

export default function ImageUploader({ upload, targetName }: { upload: Upload; targetName: string }) {
  const id = useId();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  return (
    <div className="mb-4 rounded-xl bg-slate-50 p-3 ring-1 ring-line">
      <label className="text-sm font-semibold" htmlFor={id}>Upload a picture</label>
      <input
        id={id} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="input mt-1" disabled={busy}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          setBusy(true); setMsg(null);
          try {
            const blob = file.type === "image/gif" && file.size <= 290 * 1024 ? file : await shrink(file);
            const fd = new FormData();
            fd.set("file", new File([blob], "upload", { type: blob.type }));
            const r = await upload(undefined, fd);
            if (r?.error || !r?.link) { setMsg({ ok: false, text: r?.error ?? "Upload failed." }); return; }
            const target = input.form?.elements.namedItem(targetName) as HTMLInputElement | null;
            if (target) { target.value = r.link; target.dispatchEvent(new Event("input", { bubbles: true })); }
            setPreview(r.link);
            setMsg({ ok: true, text: "Uploaded. The link below was filled in; remember to save." });
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message || "Could not read that picture." });
          } finally {
            setBusy(false); input.value = "";
          }
        }}
      />
      <p className="hint">JPG, PNG, WebP or GIF. It is shrunk automatically. Or paste a link below instead.</p>
      {busy && <p role="status" className="mt-1 text-sm">Uploading...</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-sm ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Uploaded preview" className="mt-2 h-24 w-24 rounded-lg object-cover ring-1 ring-line" />
      )}
    </div>
  );
}
