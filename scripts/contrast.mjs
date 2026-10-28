// Contrast audit of the colour tokens in src/app.css, for both themes. No browser needed.
//
// Usage: node scripts/contrast.mjs [css file]     (exit code 1 when a pair fails)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** What a pair must reach: WCAG 1.4.3 text (4.5), 1.4.11 components and graphics (3), or a lower bar for things that only need to be told apart. */
export const LEVEL = { text: 4.5, graphic: 3, apart: 1.5, soft: 1.3 };

/**
 * Colour tokens that appear together on the page, as [first, second, level, where]. For text and graphics the
 * first is painted on the second; for "apart" and "soft" the two touch and must differ.
 */
export const PAIRS = /** @type {[string, string, keyof typeof LEVEL, string][]} */ ([
  ["text", "surface", "text", "body text, side to move, past-position line"],
  ["text", "card", "text", "text in cards, buttons, selects"],
  ["card", "text", "text", "hover blurb: text (--card) on its background (--text)"],
  ["muted", "surface", "text", "hints, summaries, eval toggle on the page"],
  ["muted", "card", "text", "hints, labels, chip, quiet buttons in cards"],
  ["p1", "surface", "text", "player 1 share printed beside the bar"],
  ["p2", "surface", "text", "player 2 share printed beside the bar"],
  ["label", "board", "text", "coordinate labels in the board's margin"],
  ["label", "cell", "text", "coordinate labels on squares"],
  ["pawn-text", "p1", "text", "numeral on player 1's pawn, disc and marker"],
  ["pawn-text", "p2", "text", "numeral on player 2's pawn, disc and marker"],
  ["on-accent", "accent", "text", "Start / Pause"],
  ["card", "text", "text", "hover blurbs on the eval bar (card colour on a text-colour ground)"],
  ["wall", "cell", "graphic", "neutral wall against squares"],
  ["wall", "board", "graphic", "neutral wall against the board"],
  ["wall-edge", "cell", "graphic", "player wall outline against squares"],
  ["wall-edge", "board", "graphic", "player wall outline against the board"],
  ["wall-p1", "board", "graphic", "player 1 wall fill"],
  ["wall-p2", "board", "graphic", "player 2 wall fill"],
  ["p1", "cell", "graphic", "player 1 pawn against a square"],
  ["p2", "cell", "graphic", "player 2 pawn against a square"],
  ["text", "cell", "graphic", "pawn outline, last-move marks against a square"],
  ["text", "board", "graphic", "last-wall marks against the board"],
  ["accent", "cell", "graphic", "move targets"],
  ["accent", "board", "graphic", "wall targets"],
  ["focus", "cell", "graphic", "board cursor"],
  ["focus", "board", "graphic", "board cursor on a groove"],
  ["focus", "surface", "graphic", "focus ring on the page"],
  ["focus", "card", "graphic", "focus ring in cards"],
  ["muted", "card", "graphic", "button, select and eval-track borders"],
  ["muted", "surface", "graphic", "eval-track border"],
  ["card", "text", "graphic", "hover blurb border (--card) on its background (--text)"],
  ["accent", "card", "graphic", "primary button, slider, chip dot, pending ring"],
  ["accent", "surface", "graphic", "pending ring, best-move bar"],
  ["bad", "card", "graphic", "chip dot (failed)"],
  ["busy", "card", "graphic", "chip dot (busy)"],
  ["text", "eval-p1", "graphic", "line where player 1's fill ends"],
  ["text", "eval-p2", "graphic", "line where player 1's fill ends, on player 2's side"],
  ["eval-p1", "eval-p2", "apart", "the two sides of the bar"],
  ["p1", "p2", "apart", "the two pawns"],
  ["wall-p1", "wall-p2", "apart", "the two players' walls"],
  ["cell", "board", "soft", "squares against the grooves"],
  ["line", "surface", "soft", "card and chip borders"],
  ["line", "card", "soft", "popover and divider lines"],
]);

/**
 * @param {string} hex `#rgb` or `#rrggbb`.
 * @returns {number[]} 0-255.
 */
export function rgb(hex) {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

/** @param {number} c 0-255. */
const linear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of linear RGB components. */
/** @param {number[]} c */
const luminance = ([r = 0, g = 0, b = 0]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * WCAG contrast ratio of two colours.
 * @param {string} a Hex.
 * @param {string} b Hex.
 * @returns {number} 1 to 21.
 */
export function contrast(a, b) {
  const [la = 0, lb = 0] = [a, b].map((hex) => luminance(rgb(hex).map(linear)));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Machado et al. (2009), severity 1.0, applied to linear RGB. */
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

/**
 * Contrast ratio of two colours as someone with a colour-vision deficiency sees them.
 * @param {string} a Hex.
 * @param {string} b Hex.
 * @param {"protan" | "deutan" | "tritan"} kind
 * @returns {number}
 */
export function contrastSeenBy(a, b, kind) {
  const [la = 0, lb = 0] = [a, b].map((hex) => {
    const [r = 0, g = 0, b = 0] = rgb(hex).map(linear);
    const seen = CVD[kind].map(([x = 0, y = 0, z = 0]) => Math.min(1, Math.max(0, x * r + y * g + z * b)));
    return luminance(seen);
  });
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pairs whose two sides must stay apart in lightness for everyone. */
export const CVD_PAIRS = /** @type {[string, string][]} */ ([["p1", "p2"], ["wall-p1", "wall-p2"], ["eval-p1", "eval-p2"]]);
const KINDS = /** @type {const} */ (["protan", "deutan", "tritan"]);
const THEMES = /** @type {const} */ (["light", "dark"]);
/** The least ratio between two players' colours for each kind of vision, and the least for the pawns' lightness when seen normally. */
export const CVD_MIN = 1.3;

/**
 * Reads `--name: #hex` declarations from a block of CSS.
 * @param {string} block
 * @returns {Record<string, string>}
 */
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2]]));
}

/**
 * The tokens of each theme: the `:root` block is light; dark is `:root[data-theme="dark"]` and, for the
 * system default, the same set again under `prefers-color-scheme: dark`.
 * @param {string} css
 * @returns {{light: Record<string, string>, dark: Record<string, string>, systemDark: Record<string, string>}}
 */
export function themes(css) {
  const light = css.match(/^:root\s*\{([^}]*)\}/m);
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const system = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/);
  if (light === null || dark === null || system === null) throw new Error("app.css lacks the :root, [data-theme=dark] or system-dark token block");
  return { light: tokens(light[1] ?? ""), dark: tokens(dark[1] ?? ""), systemDark: tokens(system[1] ?? "") };
}

/**
 * @param {Record<string, string>} set
 * @param {string} name
 * @returns {string} The token's colour; a name the theme lacks is an error.
 */
function token(set, name) {
  const value = set[name];
  if (value === undefined) throw new Error(`no colour token --${name}`);
  return value;
}

/**
 * Checks every pair in both themes.
 * @param {string} css
 * @returns {{theme: string, fg: string, bg: string, level: string, need: number, ratio: number, where: string, pass: boolean}[]}
 */
export function audit(css) {
  const all = themes(css);
  return THEMES.flatMap((theme) =>
    PAIRS.map(([fg, bg, level, where]) => {
      const ratio = contrast(token(all[theme], fg), token(all[theme], bg));
      return { theme, fg, bg, level, need: LEVEL[level], ratio, where, pass: ratio >= LEVEL[level] };
    }),
  );
}

/**
 * The same player colours as seen with each kind of colour-vision deficiency.
 * @param {string} css
 * @returns {{theme: string, kind: string, a: string, b: string, ratio: number, pass: boolean}[]}
 */
export function auditCvd(css) {
  const all = themes(css);
  return THEMES.flatMap((theme) =>
    CVD_PAIRS.flatMap(([a, b]) =>
      KINDS.map((kind) => {
        const ratio = contrastSeenBy(token(all[theme], a), token(all[theme], b), kind);
        return { theme, kind, a, b, ratio, pass: ratio >= CVD_MIN };
      }),
    ),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app.css");
  const css = readFileSync(file, "utf8");
  const rows = audit(css);
  const cvd = auditCvd(css);
  for (const r of rows) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)} (need ${r.need}) ${r.where}`);
  for (const r of cvd) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${r.kind} ${r.a} vs ${r.b}: ${r.ratio.toFixed(2)} (need ${CVD_MIN})`);
  const failed = rows.filter((r) => !r.pass).length + cvd.filter((r) => !r.pass).length;
  console.log(`${failed} failing`);
  process.exitCode = failed === 0 ? 0 : 1;
}
