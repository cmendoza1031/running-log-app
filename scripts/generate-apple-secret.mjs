/**
 * Run: node scripts/generate-apple-secret.mjs
 *
 * Generates the JWT secret key required by Supabase for Sign in with Apple.
 * The JWT is valid for 6 months — regenerate before it expires.
 *
 * Usage:
 *   APPLE_TEAM_ID=XXXXXXXXXX \
 *   APPLE_KEY_ID=XXXXXXXXXX \
 *   APPLE_BUNDLE_ID=com.vistarunning.app \
 *   APPLE_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8 \
 *   node scripts/generate-apple-secret.mjs
 */

import { createSign } from "crypto";
import { readFileSync } from "fs";

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || "com.vistarunning.app";
const P8_PATH = process.env.APPLE_PRIVATE_KEY_PATH;

if (!TEAM_ID || !KEY_ID || !P8_PATH) {
  console.error("Missing required env vars:");
  console.error("  APPLE_TEAM_ID — your 10-char Team ID (top-right of developer.apple.com)");
  console.error("  APPLE_KEY_ID  — your 10-char Key ID from the key you created");
  console.error("  APPLE_PRIVATE_KEY_PATH — path to your AuthKey_XXXXXXXX.p8 file");
  process.exit(1);
}

const privateKey = readFileSync(P8_PATH, "utf8");

const now = Math.floor(Date.now() / 1000);
const sixMonths = 60 * 60 * 24 * 180; // 180 days in seconds

const header = { alg: "ES256", kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + sixMonths,
  aud: "https://appleid.apple.com",
  sub: BUNDLE_ID,
};

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

const headerEncoded = base64url(header);
const payloadEncoded = base64url(payload);
const signingInput = `${headerEncoded}.${payloadEncoded}`;

const sign = createSign("SHA256");
sign.update(signingInput);
const signature = sign
  .sign(privateKey, "base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=/g, "");

const jwt = `${signingInput}.${signature}`;

const expiryDate = new Date((now + sixMonths) * 1000).toLocaleDateString();

console.log("\n✅ Apple Secret Key JWT generated successfully!\n");
console.log("─────────────────────────────────────────────────────────────");
console.log(jwt);
console.log("─────────────────────────────────────────────────────────────");
console.log(`\n⚠️  Expires: ${expiryDate} (regenerate before this date!)`);
console.log("\n📋 Paste this JWT into:");
console.log("   Supabase → Authentication → Providers → Apple → Secret Key (for OAuth)");
console.log("\n📝 Also add to your .env:");
console.log(`   APPLE_CLIENT_ID=${BUNDLE_ID}`);
console.log(`   APPLE_SECRET_KEY=${jwt}\n`);
