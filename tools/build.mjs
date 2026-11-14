// Builds index.html from src/site.html.
// Reads portal content from portals/<id>.html and logins from secrets.json (both kept out of git),
// encrypts each portal with AES-256-GCM using a key derived from its username and password (PBKDF2-SHA256),
// and embeds the logos as data URIs.
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 600000;
const root = new URL("..", import.meta.url).pathname;
const read = p => readFileSync(root + p);
const b64 = buf => Buffer.from(buf).toString("base64");
const dataUri = p => "data:image/png;base64," + b64(read(p));

async function encrypt(html, username, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = new TextEncoder().encode(username.trim().toLowerCase() + "\n" + password);
  const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(html));
  return { iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

const logins = JSON.parse(read("secrets.json"));
const vault = {};
for (const [id, { username, password }] of Object.entries(logins)) {
  vault[id] = await encrypt(read(`portals/${id}.html`).toString(), username, password);
}

const out = read("src/site.html").toString()
  .replaceAll("{{CADENCY_CREST}}", dataUri("src/assets/cadency-crest.png"))
  .replaceAll("{{MP_INK}}", dataUri("src/assets/mp-mark-ink.png"))
  .replaceAll("{{MP_GOLD}}", dataUri("src/assets/mp-mark-gold.png"))
  .replace("{{VAULT}}", JSON.stringify(vault));
writeFileSync(root + "index.html", out);
console.log("Built index.html with portals:", Object.keys(vault).join(", "));
