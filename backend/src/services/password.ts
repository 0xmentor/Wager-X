import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }

  const key = scryptSync(password, salt, KEY_LEN);
  const storedKey = Buffer.from(hash, "hex");
  if (key.length !== storedKey.length) {
    return false;
  }

  return timingSafeEqual(key, storedKey);
}
