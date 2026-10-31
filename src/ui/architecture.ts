/** What the "About the bots" card shows of a network, read from its `arch.json`. */
export interface Architecture {
  /** What each input plane holds, in order. */
  readonly planes: readonly string[];
  /** Channels after the first convolution, which every block keeps. */
  readonly channels: number;
  /** Blocks after the first convolution, in order; true for a block that also pools the whole board. */
  readonly blocks: readonly boolean[];
  readonly parameters: number;
}

const MAX_PLANES = 32;
const MAX_BLOCKS = 64;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const whole = (value: unknown, least: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= least;

/**
 * Reads the parts of an `arch.json` the card draws, throwing on anything it cannot draw. The file comes from the
 * publisher but is treated as untrusted: counts are bounded and texts are shown as text only.
 */
export function parseArchitecture(json: unknown): Architecture {
  if (!isObject(json) || !isObject(json["input"]) || !Array.isArray(json["layers"])) throw new Error("not an architecture");
  const planes = json["input"]["planes"];
  if (!Array.isArray(planes) || planes.length === 0 || planes.length > MAX_PLANES || !planes.every((plane) => typeof plane === "string" && plane.length <= 80)) {
    throw new Error("no input planes");
  }
  const layers = json["layers"].filter(isObject);
  const stem = layers.find((layer) => layer["kind"] === "stem");
  const blocks = layers.filter((layer) => layer["kind"] === "residual_block" || layer["kind"] === "global_pooling_block");
  if (stem === undefined || !whole(stem["out"], 1)) throw new Error("no first convolution");
  if (blocks.length === 0 || blocks.length > MAX_BLOCKS) throw new Error("no blocks");
  if (!["policy_head", "value_head"].every((kind) => layers.some((layer) => layer["kind"] === kind))) throw new Error("no heads");
  const parameters = json["parameters"];
  if (!whole(parameters, 1)) throw new Error("no parameter count");
  return { planes: planes as string[], channels: stem["out"], blocks: blocks.map((layer) => layer["kind"] === "global_pooling_block"), parameters };
}

/** Where a model's `arch.json` is published: beside its `model.onnx`, as the publisher writes them (`models/<id>/`). */
export const architectureUrl = (base: string, id: string): URL => new URL(`models/${encodeURIComponent(id)}/arch.json`, base);

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The network's parameters in words: "2.5 million". */
export const parametersText = (count: number): string => (count >= 1e6 ? `${(count / 1e6).toFixed(1)} million` : count.toLocaleString("en-US"));

/** The network from input to outputs, one plain sentence per stage; also the diagram's text alternative. */
export function describeArchitecture(arch: Architecture): string[] {
  const pooling = arch.blocks.filter(Boolean).length;
  return [
    `Input: the board as ${plural(arch.planes.length, "picture")} of N × N squares: ${arch.planes.join(", ")}.`,
    `A first 3 × 3 convolution turns them into ${arch.channels} feature maps.`,
    `${plural(arch.blocks.length, "block")} of two 3 × 3 convolutions each, with a shortcut around every block${pooling === 0 ? "" : `; ${pooling} of them also sum up the whole board`}.`,
    "Policy head: a score for every move, pawn steps and every wall slot.",
    "Value head: one number, how likely the player to move is to win.",
  ];
}

const SVG = "http://www.w3.org/2000/svg";

function add(parent: Element, tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const created = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, String(value));
  if (text !== undefined) created.textContent = text;
  parent.append(created);
  return created;
}

/**
 * Draws the network top to bottom into `svg`: the input, the first convolution, one bar per block (a pooling block
 * marked), then the two heads side by side. The drawing is decoration for the list under it, which says the same.
 */
export function drawArchitecture(svg: SVGSVGElement, arch: Architecture): void {
  svg.replaceChildren();
  const box = (x: number, y: number, w: number, label: string, className = "arch-box"): void => {
    add(svg, "rect", { x, y, width: w, height: 34, rx: 6, class: className });
    add(svg, "text", { x: x + w / 2, y: y + 17, class: "arch-label" }, label);
  };
  const arrow = (x1: number, y1: number, x2: number, y2: number): void => {
    add(svg, "line", { x1, y1, x2, y2, class: "arch-flow" });
  };
  box(30, 0, 180, `${plural(arch.planes.length, "input plane")}`);
  arrow(120, 34, 120, 48);
  box(30, 48, 180, "3 × 3 convolution");
  arrow(120, 82, 120, 96);
  arch.blocks.forEach((pooling, i) => {
    add(svg, "rect", { x: 30, y: 96 + i * 14, width: 180, height: 10, rx: 3, class: pooling ? "arch-block pooling" : "arch-block" });
  });
  const below = 96 + arch.blocks.length * 14;
  add(svg, "text", { x: 120, y: below + 8, class: "arch-label small" }, plural(arch.blocks.length, "block"));
  arrow(120, below + 18, 60, below + 36);
  arrow(120, below + 18, 180, below + 36);
  box(5, below + 36, 110, "Policy", "arch-box head");
  box(125, below + 36, 110, "Value", "arch-box head");
  svg.setAttribute("viewBox", `0 0 240 ${below + 72}`);
}