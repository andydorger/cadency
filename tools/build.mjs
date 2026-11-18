// Builds index.html from src/site.html.
// Reads portal content from portals/<id>.html and logins from secrets.json (both kept out of git),
// encrypts each portal with AES-256-GCM using a key derived from its username and password (PBKDF2-SHA256),
// and embeds the logos as data URIs.
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { renderPortfolio, renderTenant } from "./render-portfolio.mjs";
import { renderCompanies } from "./render-companies.mjs";
import { webcrypto as crypto, createHash } from "node:crypto";

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
// Every portal keeps one encrypted copy per user, filed under a hash of the username
// so the page knows which copy to try without listing usernames in the clear.
const userKey = (vaultId, u) => createHash("sha256").update(vaultId + "\n" + u.trim().toLowerCase()).digest("hex");
const { tenants = {}, ...portalLogins } = logins;
for (const [id, { title, users }] of Object.entries(portalLogins)) {
  // A portal with a data file (portals/<id>.json) is rendered from it; otherwise portals/<id>.html is used as is.
  // A data file with "companies" is Cadency's portfolio companies; one with "properties" is a real estate portfolio.
  let html;
  if (existsSync(root + `portals/${id}.json`)) {
    const data = JSON.parse(read(`portals/${id}.json`));
    html = data.companies ? renderCompanies(data, title || id) : renderPortfolio(data, title || id);
  } else html = read(`portals/${id}.html`).toString();
  vault[id] = {};
  for (const [username, password] of Object.entries(users)) vault[id][userKey(id, username)] = await encrypt(html, username, password);
}

// Tenant portals: one encrypted page per unit, shown only to that unit's login.
if (Object.keys(tenants).length) {
  const data = JSON.parse(read("portals/mp-holdings.json"));
  vault["mp-tenants"] = {};
  for (const p of data.properties) for (const u of p.units || []) {
    const login = tenants[u.unit];
    if (!login) continue;
    vault["mp-tenants"][userKey("mp-tenants", login.username)] = await encrypt(renderTenant(data, p, u), login.username, login.password);
  }
}

// The same template builds two sites. Each gets only its own sign-in pages and encrypted content.
const SITES = [
  { id: "cadency", out: "index.html", title: "Cadency", description: "Cadency is a private holding company.",
    portals: ["cadency", "mp-owner"], vaults: ["cadency", "mp-holdings"] },
  { id: "mp", out: process.env.MP_SITE_OUT || "dist/mpholdings/index.html", title: "MP Holdings",
    description: "MP Holdings owns and manages residential properties in Cincinnati, Ohio.",
    portals: ["mp-owner", "mp-tenant"], vaults: ["mp-holdings", "mp-tenants"] }
];
const template = read("src/site.html").toString()
  .replaceAll("{{CADENCY_CREST}}", dataUri("src/assets/cadency-seal.png"))
  .replaceAll("{{MP_INK}}", dataUri("src/assets/mp-mark-ink.png"))
  .replaceAll("{{MP_GOLD}}", dataUri("src/assets/mp-mark-gold.png"))
  .replaceAll("{{MP_HOUSE}}", dataUri("src/assets/mp-house.png"));
for (const site of SITES) {
  // Keep this site's <!--@site--> blocks, drop the other sites' blocks.
  const html = template
    .replace(/<!--@(\w+)-->([\s\S]*?)<!--@end-->\n?/g, (_, id, body) => id === site.id ? body : "")
    .replaceAll("{{SITE_TITLE}}", site.title)
    .replaceAll("{{SITE_ID}}", site.id)
    .replaceAll("{{SITE_DESCRIPTION}}", site.description)
    .replace("{{SITE_PORTALS}}", JSON.stringify(site.portals))
    .replace("{{VAULT}}", JSON.stringify(Object.fromEntries(site.vaults.filter(v => vault[v]).map(v => [v, vault[v]]))));
  mkdirSync(dirname(root + site.out), { recursive: true });
  writeFileSync(root + site.out, html);
  console.log(`Built ${site.out}: ${site.portals.join(", ")}`);
}
