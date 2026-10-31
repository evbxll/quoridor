import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/app.css", import.meta.url), "utf8");
const at = (needle: string): number => {
  const found = html.indexOf(needle);
  expect(found, needle).toBeGreaterThan(-1);
  return found;
};

describe("page order", () => {
  it("puts the game controls before the players, so a seat change cannot move them", () => {
    const players = at('class="card players"');
    for (const id of ["new", "toggle", "step", "speed", "undo", "retry"]) expect(at(`id="${id}"`), id).toBeLessThan(players);
  });

  it("keeps the game controls in the first card of the panel, right after the board", () => {
    const panel = at('class="panel"');
    const game = at('class="card game"');
    expect(game).toBeGreaterThan(panel);
    expect(html.slice(panel, game)).not.toContain('class="card');
  });

  it("puts both view choices in the View menu beside the board, not in the move list", () => {
    const view = at('id="view"');
    const panel = at('class="panel"');
    for (const id of ["show-eval", "analysis-toggle"]) {
      expect(at(`id="${id}"`), id).toBeGreaterThan(view);
      expect(at(`id="${id}"`), id).toBeLessThan(panel);
    }
  });
});

describe("the Games card", () => {
  const games = html.slice(html.indexOf('id="games"'), html.indexOf("</section>", html.indexOf('id="games"')));

  it("has no box that scrolls inside it, and a real table with a caption and column headers", () => {
    expect(games).not.toMatch(/tabindex|role="region"|games-scroll/);
    expect(games).toContain('<table class="games-table" role="table">');
    expect(games).toMatch(/<caption[^>]*>Games finished, newest first/);
    expect(games.match(/scope="col" role="columnheader"/g)).toHaveLength(6);
  });

  it("lets the rest of the games be shown with a button that says whether they are", () => {
    expect(games).toMatch(/<button id="games-more"[^>]*aria-controls="games-rows" aria-expanded="false"/);
  });
});

describe("text size", () => {
  it("sets text in rem and none under 14px; only the eval markers' digits and the diagram's labels (drawn to scale) are in px", () => {
    const pixelLines = css.split("\n").filter((line) => /font-size: [0-9.]+px/.test(line));
    expect(pixelLines.map((line) => line.trim())).toEqual([
      "font-size: 11px; font-weight: 800; color: var(--pawn-text);",
      ".arch-label { fill: var(--text); font-size: 13px; text-anchor: middle; dominant-baseline: central; }",
      ".arch-label.small { fill: var(--muted); font-size: 12px; }",
    ]);
    const rems = [...css.matchAll(/font(?:-size)?: ([0-9.]+)rem/g)].map((found) => Number(found[1]));
    expect(rems.length).toBeGreaterThan(20);
    expect(Math.min(...rems)).toBeGreaterThanOrEqual(0.875);
  });
});