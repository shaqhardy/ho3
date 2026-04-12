import { createHash, randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // avoid 0/O/1/I/L confusion
const CODE_LENGTH = 10; // XXXX-XXXXX
const CODE_COUNT = 10;

/**
 * Generate N recovery codes. Returns plaintext codes (shown once to user)
 * and SHA-256 hashes (stored in DB).
 */
export function generateBackupCodes(): {
  plaintext: string[];
  hashes: string[];
} {
  const plaintext: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < CODE_COUNT; i++) {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (let j = 0; j < CODE_LENGTH; j++) {
      code += ALPHABET[bytes[j] % ALPHABET.length];
    }
    // Format as XXXX-XXXXXX for readability
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    plaintext.push(formatted);
    hashes.push(hashCode(formatted));
  }

  return { plaintext, hashes };
}

export function hashCode(code: string): string {
  // Normalize: uppercase, strip whitespace and dashes
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}
