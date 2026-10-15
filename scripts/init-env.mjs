import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");
const domain = process.argv[2]?.trim();

if (!domain || domain.length > 253 || !/^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain)) {
  console.error("Usage: node scripts/init-env.mjs your-public-domain.example");
  process.exit(2);
}

if (fs.existsSync(envPath)) {
  console.error(".env already exists; leaving it untouched. Edit it manually if you intend to rotate keys or change domains.");
  process.exit(1);
}

const token = crypto.randomBytes(32).toString("base64url");
const contents = [
  `SITE_DOMAIN=${domain}`,
  `DEVICE_API_TOKEN=${token}`,
  "",
].join("\n");
fs.writeFileSync(envPath, contents, { flag: "wx", mode: 0o600 });
console.log(`Created ${envPath} with a fresh device token. The token is stored only in .env; do not publish or paste that file into a chat.`);
