import crypto from "crypto";

// ==================================
// TOKEN HASHING
// ==================================

export function hashToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}
