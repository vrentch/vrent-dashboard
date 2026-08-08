#!/usr/bin/env node
/**
 * Writes every piece of packaging metadata from `shared/editions.ts` and
 * `shared/brand.ts`, so the PWA manifest and the three TWA manifests can never
 * drift away from the source of truth.
 *
 *   node scripts/gen-manifests.mjs
 *
 * Output:
 *
 *   public/manifest.webmanifest          the PWA manifest for ONE edition
 *   android/twa-manifest.demo.json       bubblewrap input, one per edition
 *   android/twa-manifest.pro.json
 *   android/twa-manifest.enterprise.json
 *   public/.well-known/assetlinks.json   only when CERT_SHA256 is supplied
 *
 * `manifest.webmanifest` describes a single edition, because that is what the
 * PWA install prompt and `bubblewrap update` read. Vite copies `public/` into
 * the edition's `dist-*` folder, so regenerate it with the matching EDITION
 * before each build:
 *
 *   EDITION=demo node scripts/gen-manifests.mjs && npm run build:demo
 *
 * Env vars (all optional):
 *
 *   DEPLOY_DOMAIN       host the app is served from, no scheme.
 *                       Default: quest.vrent.ch
 *   DEPLOY_BASE_PATH    path prefix if the edition is not at the domain root,
 *                       e.g. "/demo". Default: "/"
 *   EDITION             which edition manifest.webmanifest describes
 *                       (demo | pro | enterprise). Default: pro
 *   APP_VERSION_NAME    human version, default: version from package.json
 *   APP_VERSION_CODE    integer Android version code, default: 1.
 *                       MUST increase for every build uploaded to the Store.
 *   KEYSTORE_PATH       signing keystore, relative to the bubblewrap project
 *                       directory or absolute. Default: ./vrent-release.keystore
 *   KEYSTORE_ALIAS      key alias inside the keystore. Default: vrent
 *   HORIZON_APP_ID_DEMO / _PRO / _ENTERPRISE
 *                       numeric Horizon app id. Default "0", which builds and
 *                       sideloads fine but must be set before Store work.
 *   CERT_SHA256         colon-separated SHA-256 of the signing certificate. When
 *                       set, assetlinks.json is rewritten with it; when unset
 *                       the file is left exactly as it is.
 *
 * This file is plain ESM run directly by Node, never bundled, so it cannot
 * import the TypeScript sources; it parses the literals it needs instead.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEST = path.resolve(HERE, "..");

/** The domain the Quest build is fetched from when nothing overrides it. */
const DEFAULT_DEPLOY_DOMAIN = "quest.vrent.ch";

const DEPLOY_DOMAIN = (process.env.DEPLOY_DOMAIN || DEFAULT_DEPLOY_DOMAIN)
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const BASE_PATH = `/${(process.env.DEPLOY_BASE_PATH || "/").replace(/^\/+|\/+$/g, "")}/`.replace(
  "//",
  "/",
);
const ORIGIN = `https://${DEPLOY_DOMAIN}`;
const url = (rel) => `${ORIGIN}${BASE_PATH}${rel}`.replace(/([^:])\/{2,}/g, "$1/");
const abs = (rel) => `${BASE_PATH}${rel}`.replace(/\/{2,}/g, "/");

/* ── reading the source of truth ─────────────────────────────────────────── */

function balancedObject(src, from) {
  const start = src.indexOf("{", from);
  if (start < 0) throw new Error(`no object literal after offset ${from}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced object literal");
}

function objectAfter(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not find ${what} — has the source moved?`);
  return balancedObject(src, m.index + m[0].length);
}

function strField(block, key, what) {
  const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]*)"`).exec(block);
  if (!m) throw new Error(`could not read "${key}" from ${what}`);
  return m[1];
}

const brandSrc = readFileSync(path.join(QUEST, "shared", "brand.ts"), "utf8");
const editionSrc = readFileSync(path.join(QUEST, "shared", "editions.ts"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(QUEST, "package.json"), "utf8"));

const paletteBlock = objectAfter(
  brandSrc,
  /export const palette\s*:\s*Palette\s*=\s*/,
  "`palette` in shared/brand.ts",
);
const brandBlock = objectAfter(brandSrc, /export const brand\s*=\s*/, "`brand` in shared/brand.ts");

const pal = Object.fromEntries(
  ["ink", "surface", "surfaceAlt", "primary", "accent", "reward", "danger"].map((k) => [
    k,
    strField(paletteBlock, k, "palette"),
  ]),
);
const brand = Object.fromEntries(
  ["name", "productName", "shortName", "tagline", "website", "packageRoot"].map((k) => [
    k,
    strField(brandBlock, k, "brand"),
  ]),
);

const EDITION_IDS = ["demo", "pro", "enterprise"];

/** Editions in tier order, straight out of `shared/editions.ts`. */
const editions = EDITION_IDS.map((id) => {
  const block = objectAfter(
    editionSrc,
    new RegExp(`const ${id.toUpperCase()}\\s*:\\s*EditionSpec\\s*=\\s*`),
    `edition ${id} in shared/editions.ts`,
  );
  const packageId = strField(block, "packageId", id);
  if (!packageId.startsWith(brand.packageRoot)) {
    throw new Error(
      `edition "${id}" has packageId "${packageId}", which is not under ` +
        `brand.packageRoot "${brand.packageRoot}" — one of the two is wrong`,
    );
  }
  return {
    id,
    name: strField(block, "name", id),
    tagline: strField(block, "tagline", id),
    packageId,
  };
});

/* ── configuration ───────────────────────────────────────────────────────── */

const EDITION = process.env.EDITION || process.env.VITE_EDITION || "pro";
if (!EDITION_IDS.includes(EDITION)) {
  throw new Error(`EDITION must be one of ${EDITION_IDS.join(", ")}, got "${EDITION}"`);
}

const APP_VERSION_NAME = process.env.APP_VERSION_NAME || pkg.version || "1.0.0";
const APP_VERSION_CODE = Number(process.env.APP_VERSION_CODE || 1);
if (!Number.isInteger(APP_VERSION_CODE) || APP_VERSION_CODE < 1) {
  throw new Error(`APP_VERSION_CODE must be a positive integer, got "${process.env.APP_VERSION_CODE}"`);
}

const KEYSTORE_PATH = process.env.KEYSTORE_PATH || "./vrent-release.keystore";
const KEYSTORE_ALIAS = process.env.KEYSTORE_ALIAS || "vrent";

/**
 * Launcher name: what is printed under the icon on the headset home screen.
 * Android truncates hard, so keep it short. Overridable per edition because
 * an Enterprise build is normally rebranded for the customer.
 */
function launcherName(ed) {
  const override = process.env[`LAUNCHER_NAME_${ed.id.toUpperCase()}`];
  if (override) return override;
  if (ed.id === "demo") return `${brand.shortName} Demo`;
  return brand.shortName;
}

function horizonAppId(ed) {
  return process.env[`HORIZON_APP_ID_${ed.id.toUpperCase()}`] || "0";
}

/* ── the PWA manifest ────────────────────────────────────────────────────── */

/**
 * Immersive WebXR PWA:
 *  - `display: "standalone"` so Horizon gives it its own Library entry rather
 *    than opening it in a browser tab.
 *  - `orientation: "landscape"` — a headset is always landscape.
 * The icons live under `icons/<edition>/` so all three editions can be hosted
 * on one domain without fighting over the same files.
 */
function webManifest(ed) {
  const iconDir = `icons/${ed.id}`;
  return {
    id: abs(""),
    name: ed.name,
    short_name: launcherName(ed),
    description: `${ed.tagline} ${brand.tagline}`,
    start_url: abs(""),
    scope: abs(""),
    display: "standalone",
    orientation: "landscape",
    background_color: pal.ink,
    theme_color: pal.surface,
    categories: ["games", "entertainment"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: abs(`${iconDir}/icon-192.png`), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: abs(`${iconDir}/icon-512.png`), sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: abs(`${iconDir}/icon-512-maskable.png`),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/* ── the TWA manifests ───────────────────────────────────────────────────── */

/**
 * Input for `@meta-quest/bubblewrap-cli`. Field names follow bubblewrap's
 * `TwaManifest` schema.
 *
 * `horizonOSAppMode` is the single most important value in this file. This
 * game is an immersive WebXR experience, so it MUST be "immersive". Setting it
 * to "2D" makes the installed app open a windowed panel with a browser URL bar
 * instead of entering VR — Meta's documented number one packaging failure.
 */
function twaManifest(ed) {
  const iconDir = `icons/${ed.id}`;
  return {
    packageId: ed.packageId,
    applicationId: horizonAppId(ed),
    host: DEPLOY_DOMAIN,
    name: ed.name,
    launcherName: launcherName(ed),
    display: "standalone",
    orientation: "landscape",
    themeColor: pal.surface,
    backgroundColor: pal.ink,
    startUrl: abs(""),
    iconUrl: url(`${iconDir}/icon-512.png`),
    maskableIconUrl: url(`${iconDir}/icon-512-maskable.png`),
    webManifestUrl: url("manifest.webmanifest"),
    signingKey: { path: KEYSTORE_PATH, alias: KEYSTORE_ALIAS },
    appVersion: APP_VERSION_NAME,
    appVersionName: APP_VERSION_NAME,
    appVersionCode: APP_VERSION_CODE,
    fallbackType: "customtabs",
    features: {},
    isMetaQuest: true,
    horizonOSAppMode: "immersive",
    fingerprints: [],
    minSdkVersion: 23,
  };
}

/* ── digital asset links ─────────────────────────────────────────────────── */

/**
 * One statement per edition, so a single domain can serve all three APKs.
 * Only rewritten when CERT_SHA256 is supplied — otherwise the checked-in
 * template (with its placeholder) is left alone, so a real fingerprint that
 * someone pasted in by hand is never clobbered.
 */
function assetLinks(fingerprint) {
  return editions.map((ed) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ed.packageId,
      sha256_cert_fingerprints: [fingerprint],
    },
  }));
}

/* ── write ───────────────────────────────────────────────────────────────── */

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const bytes = Buffer.byteLength(JSON.stringify(value, null, 2)) + 1;
  console.log(`  ${path.relative(QUEST, file).padEnd(44)} ${String(bytes).padStart(6)} B`);
}

function main() {
  const selected = editions.find((e) => e.id === EDITION);

  console.log(`Domain     ${ORIGIN}${BASE_PATH}`);
  console.log(`Edition    ${selected.id} (${selected.packageId})`);
  console.log(`Version    ${APP_VERSION_NAME} (code ${APP_VERSION_CODE})`);
  console.log(`App mode   immersive (WebXR)`);
  console.log("");

  writeJson(path.join(QUEST, "public", "manifest.webmanifest"), webManifest(selected));
  for (const ed of editions) {
    writeJson(path.join(QUEST, "android", `twa-manifest.${ed.id}.json`), twaManifest(ed));
  }

  const fingerprint = process.env.CERT_SHA256;
  if (fingerprint) {
    const clean = fingerprint.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(clean)) {
      throw new Error(
        "CERT_SHA256 must be 32 colon-separated hex bytes, as printed by " +
          '`keytool -list -v` (for example "3B:06:...:8B")',
      );
    }
    writeJson(path.join(QUEST, "public", ".well-known", "assetlinks.json"), assetLinks(clean));
  } else {
    console.log("  public/.well-known/assetlinks.json           left as is (no CERT_SHA256)");
  }
}

try {
  main();
} catch (err) {
  console.error(`gen-manifests failed: ${err.message}`);
  process.exitCode = 1;
}
