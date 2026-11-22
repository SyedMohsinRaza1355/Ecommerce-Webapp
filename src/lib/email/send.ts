// Real email delivery. Brevo (free plan, one verified sender address, no domain needed) or Resend
// (needs a verified domain). If neither is configured the platform keeps working in "recorded only"
// mode: messages are stored and visible in the admin but not sent.
export type MailInput = { to: string; subject: string; text: string; html: string; fromName: string; replyTo?: string };
export type MailResult = { mode: "sent" | "recorded"; id?: string };

export type Provider = "brevo" | "resend" | null;

export function emailProvider(): Provider {
  if (!process.env.EMAIL_FROM) return null;
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

export function emailMode(): "live" | "recorded" {
  return emailProvider() ? "live" : "recorded";
}

/** EMAIL_FROM may be "orders@x.com" or "Name <orders@x.com>"; only the address is used. */
export function fromAddress(): string {
  const raw = process.env.EMAIL_FROM ?? "";
  return /<([^<>\s]+)>/.exec(raw)?.[1] ?? raw.trim();
}

const cleanName = (name: string) => name.replace(/[^\p{L}\p{N} .,&'-]/gu, "").trim().slice(0, 60) || "Storeforge";

/** "Store Name" <orders@platform.com>. The display name is sanitised so a store name cannot inject headers. */
export function fromHeader(name: string): string {
  return `${cleanName(name)} <${fromAddress()}>`;
}

export async function sendMail(m: MailInput): Promise<MailResult> {
  const provider = emailProvider();
  if (!provider) return { mode: "recorded" };
  const subject = m.subject.replace(/[\u000d\u000a]+/g, " ").slice(0, 200);
  const res = provider === "brevo"
    ? await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY!, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { name: cleanName(m.fromName), email: fromAddress() }, to: [{ email: m.to }], subject, textContent: m.text, htmlContent: m.html, ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}) }),
        signal: AbortSignal.timeout(15_000),
      })
    : await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: fromHeader(m.fromName), to: [m.to], subject, text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
  const json = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string; message?: string };
  if (!res.ok) throw new Error(`Email provider error ${res.status}${json.message ? `: ${json.message}` : ""}`);
  return { mode: "sent", id: json.id ?? json.messageId };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A simple, mobile-safe branded layout. Only escaped text and https links are ever placed in it. */
export function htmlEmail(o: { store: string; color: string; heading: string; paragraphs: string[]; button?: { label: string; url: string } }): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : "#4f46e5";
  const btn = o.button && /^https?:\/\//.test(o.button.url) ? `<p style="margin:24px 0"><a href="${esc(o.button.url)}" style="background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${esc(o.button.label)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:${color};color:#fff;padding:18px 24px;font-size:18px;font-weight:800">${esc(o.store)}</td></tr><tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${esc(o.heading)}</h1>${o.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.55">${esc(p)}</p>`).join("")}${btn}</td></tr><tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">Sent by ${esc(o.store)}. If you did not expect this email, you can ignore it.</td></tr></table></td></tr></table></body></html>`;
}
