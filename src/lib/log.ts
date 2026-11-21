import { redact } from "@/lib/audit/log";

type Level = "info" | "warn" | "error";

/** Structured JSON logs with secrets and PII-like keys redacted (ADD-070, NFR-14). One line per event. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}
