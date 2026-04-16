import { createHash, randomBytes } from "node:crypto";

export function generateNonce() {
  return randomBytes(32).toString("hex");
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}
