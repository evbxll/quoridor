// Checks a built `dist/` before it is deployed.
//
// Usage: node scripts/verify-dist.mjs [distDir]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE = "/quoridor/";

/**
 * Lists files under a directory, recursively.
 * @param {string} dir
 * @returns {string[]} Absolute paths.
 */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * @param {string} path
 * @returns {string} Hex sha256 of the file.
 */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The rules the page applies when it reads `models/index.json` (`src/model/index.ts`); a dist the page would partly ignore is refused. */
const MODEL_ID = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** A `bots` entry with this value means: no network at that size. */
const NO_NETWORK = "heuristic";
/** Longest text and longest size list `parseCard` accepts. */
const MAX_TEXT = 400;
const MAX_SIZES = 32;
const shortText = (/** @type {unknown} */ value) => typeof value === "string" && value.length <= MAX_TEXT;
/** The input plane counts the page can encode (`SUPPORTED_PLANES` in `src/ai/encoding.ts`; a test keeps the two equal). */
export const SUPPORTED_PLANES = [6, 10];

/**
 * Checks the shape of an index the way the page reads it.
 * @param {any} index
 * @returns {{errors: string[], models: {id: string, path: string, sha256: string}[], bots: Record<string, string>}}
 */
function validateIndex(index) {
  const errors = [];
  if (typeof index !== "object" || index === null || !Array.isArray(index.models) || typeof index.bots !== "object" || index.bots === null || Array.isArray(index.bots)) {
    return { errors: ["models/index.json must be {models: [...], bots: {...}}"], models: [], bots: {} };
  }
  const models = [];
  const ids = new Set();
  for (const [position, model] of index.models.entries()) {
    const label = `model ${position}`;
    if (typeof model !== "object" || model === null) {
      errors.push(`${label}: not an object`);
      continue;
    }
    const { id, path, sha256: sum } = model;
    if (typeof id !== "string" || !MODEL_ID.test(id) || id === NO_NETWORK) {
      errors.push(`${label}: id ${JSON.stringify(id)} is not a plain id (letters, digits, . _ -; not "${NO_NETWORK}")`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`model ${id}: listed twice`);
      continue;
    }
    ids.add(id);
    if (typeof path !== "string" || !path.startsWith("models/") || path.split("/").some((part) => part === ".." || part === "" || part === ".") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
      errors.push(`model ${id}: path ${JSON.stringify(path)} must be a relative path under models/`);
      continue;
    }
    if (typeof sum !== "string" || !SHA256.test(sum)) {
      errors.push(`model ${id}: sha256 must be 64 lowercase hex digits`);
      continue;
    }
    models.push({ id, path, sha256: sum });
  }
  for (const [size, id] of Object.entries(index.bots)) {
    if (!/^[0-9]+$/.test(size)) errors.push(`bot size ${JSON.stringify(size)} is not a number`);
    else if (id !== NO_NETWORK && !ids.has(id)) errors.push(`bot for ${size}x${size} names ${id}, which is not in the index`);
  }
  if (index.gallery !== undefined) {
    if (!Array.isArray(index.gallery)) errors.push("gallery must be a list of model ids");
    else {
      for (const [position, id] of index.gallery.entries()) {
        if (!ids.has(id)) errors.push(`gallery entry ${position} names ${JSON.stringify(id)}, which is not in the index`);
        else if (index.gallery.indexOf(id) !== position) errors.push(`gallery lists ${id} twice`);
      }
    }
  }
  return { errors, models, bots: index.bots };
}

/** The fields a shipped card may have: what the page reads, the licence and the attribution. How a model was trained, rated or exported stays out of the public site. */
export const CARD_FIELDS = ["id", "display_name", "sizes", "sha256", "bytes", "license", "attribution", "network", "trained_size", "plane_names", "parameters", "strength"];

/** A strength entry as shipped: a board size and Elo above Normal, nothing about how it was measured. */
const isPlainStrength = (/** @type {any} */ entry) =>
  typeof entry === "object" && entry !== null && Object.keys(entry).every((key) => key === "size" || key === "elo_vs_normal") && Number.isInteger(entry.size) && Number.isFinite(entry.elo_vs_normal);

/**
 * Words that belong to how the models were made and rated, or to the private repository, never to the public site. Each is
 * a whole phrase, so the page's own words ("Varied openings", a model's trained size) stay allowed.
 */
export const FORBIDDEN_TERMS = [/\bevan bot\b/i, /\bladder\b/i, /\bbradley/i, /\blaplace\b/i, /\bfresh[ -]tree\b/i, /\bresearch\b/i, /\bprivate\b/i, /\bgeneration\b/i, /\bgen \d/i, /\bPR #\d/, /\bryzen\b/i, /how this was measured/i, /git_sha/i, /ratings?_folder/i, /self-play/i, /\banchor(ed)? (bot|at|on)\b/i];

/**
 * Finds forbidden terms in a text, as "term" strings.
 * @param {string} text
 * @returns {string[]}
 */
export function forbiddenIn(text) {
  return FORBIDDEN_TERMS.flatMap((term) => {
    const found = term.exec(text);
    return found === null ? [] : [found[0]];
  });
}

/**
 * Checks the site's own shipped text (the page, its styles and scripts, and the model files) for forbidden terms. The
 * third-party runtime (`ort*`) and the licence notices are not the site's words and are not read.
 * @param {string} distDir
 * @returns {string[]} Error messages.
 */
function checkPublicText(distDir) {
  return walk(distDir)
    .filter((file) => /\.(html|css|js|mjs|json)$/.test(file) && !/(^|[\\/])ort[^\\/]*$/.test(file))
    .flatMap((file) => forbiddenIn(readFileSync(file, "utf8")).map((term) => `${relative(distDir, file).replaceAll("\\", "/")}: "${term}" belongs to how the models were made, not to the public site`));
}

/**
 * Checks a model's card the way the page reads it (`src/model/card.ts`): it is this model's, it states the plane
 * count of a model the page can slice an input for, and it can be played at the sizes it claims. Every field
 * `parseCard` requires is required here with the same limits (texts of at most 400 characters, at most 32 sizes),
 * so a card the page would refuse is refused before it is deployed; a test keeps the two in step.
 * @param {string} id
 * @param {any} card
 * @param {string} actual Hex sha256 of the model file.
 * @returns {string[]} Error messages.
 */
export function checkCard(id, card, actual) {
  /** @type {string[]} */
  const errors = [];
  /** @param {string} message */
  const fail = (message) => errors.push(`model ${id}: ${message}`);
  if (typeof card !== "object" || card === null || Array.isArray(card)) return [`model ${id}: card.json is not an object`];
  if (card.id !== id) fail(`its card is for ${JSON.stringify(card.id)}`);
  if (card.sha256 !== actual) fail("sha256 differs from the one its card states");
  const network = card.network;
  if (typeof network !== "object" || network === null || (network.head !== "fc" && network.head !== "conv")) {
    fail("its card has no network with a head of fc or conv");
    return errors;
  }
  if (!SUPPORTED_PLANES.includes(network.input_planes)) {
    fail(`its card says ${network.input_planes} input planes; the page can build ${SUPPORTED_PLANES.join(" or ")}`);
  } else if (!Array.isArray(card.plane_names) || card.plane_names.length !== network.input_planes || !card.plane_names.every(shortText)) {
    fail("its card's plane_names does not match input_planes");
  }
  for (const name of ["display_name", "license"]) if (!shortText(card[name])) fail(`its card's ${name} is not a short text`);
  const fields = /** @type {[string, any, number, boolean][]} */ ([
    ["parameters", card.parameters, 0, false],
    ["channels", network.channels, 1, false],
    ["blocks", network.blocks, 0, false],
    ["pool_every", network.pool_every, 1, true],
    ["head_channels", network.head_channels, 1, true],
    ["board_size", network.board_size, 2, true],
  ]);
  for (const [name, value, least, optional] of fields) {
    if (!(optional && (value === null || value === undefined)) && !(Number.isInteger(value) && value >= least)) fail(`its card's ${name} is not a whole number of at least ${least}`);
  }
  const whole = (/** @type {any} */ value) => Number.isInteger(value) && value >= 2;
  for (const key of Object.keys(card)) if (!CARD_FIELDS.includes(key)) fail(`its card has a field the public site does not ship: ${key}`);
  if (card.strength !== undefined && !(Array.isArray(card.strength) && card.strength.every(isPlainStrength))) fail("its card's strength must be a list of {size, elo_vs_normal}");
  if (!Array.isArray(card.sizes) || card.sizes.length === 0 || card.sizes.length > MAX_SIZES || !card.sizes.every(whole) || !whole(card.trained_size)) {
    fail("its card needs sizes (board sizes) and a trained_size");
  } else if (network.head === "fc" && (card.sizes.length !== 1 || card.sizes[0] !== card.trained_size)) {
    fail("an fc model plays its trained size only, so its card must list that size alone");
  }
  return errors;
}

/**
 * Whether a model plays a board size, as the page decides it (`supportsSize` in `src/model/card.ts`).
 * @param {any} card
 * @param {number} size
 * @returns {boolean}
 */
function supportsSize(card, size) {
  return card.network.head === "fc" ? size === card.trained_size : card.sizes.includes(size);
}

/**
 * Checks every model in `models/index.json`. A model's `path` is relative to the site root (`models/<id>/model.onnx`), as `quoridor-publish` writes it. A dist without the index has no
 * published models, which is valid until the first model is published.
 * @param {string} distDir
 * @returns {string[]} Error messages.
 */
function checkModels(distDir) {
  const indexPath = join(distDir, "models", "index.json");
  if (!existsSync(indexPath)) {
    return [];
  }
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return ["models/index.json is not valid JSON"];
  }
  const { errors, models, bots } = validateIndex(index);
  const cards = new Map();
  for (const model of models) {
    const file = join(distDir, model.path);
    if (!existsSync(file)) {
      errors.push(`model ${model.id}: ${model.path} is missing`);
      continue;
    }
    const actual = sha256(file);
    if (actual !== model.sha256) {
      errors.push(`model ${model.id}: sha256 ${actual} differs from the index`);
    }
    const cardPath = join(dirname(file), "card.json");
    if (!existsSync(cardPath)) {
      errors.push(`model ${model.id}: card.json is missing`);
      continue;
    }
    let card;
    try {
      card = JSON.parse(readFileSync(cardPath, "utf8"));
    } catch {
      errors.push(`model ${model.id}: card.json is not valid JSON`);
      continue;
    }
    const problems = checkCard(model.id, card, actual);
    errors.push(...problems);
    if (problems.length === 0) cards.set(model.id, card);
  }
  for (const [size, id] of Object.entries(bots)) {
    const card = cards.get(id);
    if (card && !supportsSize(card, Number(size))) errors.push(`bot for ${size}x${size} names ${id}, whose card says it does not play that size`);
  }
  return errors;
}

/**
 * Checks that the service worker and, once onnxruntime-web is a dependency,
 * its WebAssembly binary are present.
 * @param {string} distDir
 * @param {string} projectDir
 * @returns {string[]} Error messages.
 */
function checkRuntimeFiles(distDir, projectDir) {
  const errors = [];
  for (const name of ["coi-serviceworker.js", "coi-config.js", "THIRD-PARTY-NOTICES.txt"]) {
    if (!existsSync(join(distDir, name))) {
      errors.push(`${name} is missing`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
  if (pkg.dependencies?.["onnxruntime-web"] !== undefined) {
    const hasWasm = walk(distDir).some((file) => file.endsWith(".wasm"));
    if (!hasWasm) {
      errors.push("onnxruntime-web is a dependency but dist has no .wasm file");
    }
  }
  return errors;
}

/**
 * Finds references in HTML and CSS that point outside `BASE`: absolute URLs,
 * protocol-relative URLs and root-relative paths. Bundled JS is not scanned,
 * because it legitimately contains strings such as XML namespaces.
 * @param {string} distDir
 * @returns {string[]} Error messages.
 */
function checkExternalUrls(distDir) {
  const errors = [];
  const reference = /(?:src|href|action)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;
  for (const file of walk(distDir)) {
    if (!/\.(html|css)$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(reference)) {
      const url = match[1] ?? match[2] ?? "";
      const isAbsolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
      if (url.startsWith("data:") || url.startsWith("#")) {
        continue;
      }
      if (isAbsolute || (url.startsWith("/") && !url.startsWith(BASE))) {
        errors.push(`${relative(distDir, file).replaceAll("\\", "/")}: ${url} points outside ${BASE}`);
      }
    }
  }
  return errors;
}

/**
 * Verifies a built site.
 * @param {string} distDir The build output.
 * @param {string} projectDir The project root, for package.json.
 * @returns {string[]} Error messages; empty when the dist is valid.
 */
export function verifyDist(distDir, projectDir) {
  if (!existsSync(join(distDir, "index.html"))) {
    return [`${distDir} has no index.html; run the build first`];
  }
  return [
    ...checkRuntimeFiles(distDir, projectDir),
    ...checkModels(distDir),
    ...checkExternalUrls(distDir),
    ...checkPublicText(distDir),
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const errors = verifyDist(process.argv[2] ?? join(projectDir, "dist"), projectDir);
  if (errors.length > 0) {
    console.error(errors.map((e) => `verify-dist: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("verify-dist: ok");
}
