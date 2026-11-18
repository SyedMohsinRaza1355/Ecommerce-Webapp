import bcrypt from "bcryptjs";

// bcrypt (cost 12) for now; ADR to move to Argon2id before launch (NFR-09).
const COST = 12;

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 128) return "Use at most 128 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Include letters and numbers.";
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const err = validatePasswordStrength(pw);
  if (err) throw new Error(err);
  return bcrypt.hash(pw, COST);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
