import { scrypt, randomBytes, timingSafeEqual, randomInt } from "crypto";
import { promisify } from "util";
import { z } from "zod";

const scryptAsync = promisify(scrypt);

/** Same format as before ("hexhash.salt"), so existing password hashes keep working. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = String(stored || "").split(".");
  if (!hashed || !salt) return false;
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return hashedBuf.length === suppliedBuf.length && timingSafeEqual(hashedBuf, suppliedBuf);
}

/** Policy for NEW passwords only (existing passwords are never re-validated). */
export const newPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Password is too long.")
  .refine(v => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number.");

/** Readable temporary password for admin resets, e.g. "plum-river-4821-K7". */
export function generateTemporaryPassword(): string {
  const words = ["amber", "cedar", "delta", "ember", "falcon", "harbor", "indigo", "jasper", "lotus", "maple", "nova", "orbit", "plum", "quartz", "river", "sable", "tidal", "violet"];
  const pick = () => words[randomInt(words.length)];
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${pick()}-${pick()}-${randomInt(1000, 10000)}-${letters[randomInt(letters.length)]}${randomInt(10)}`;
}
