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

  it("puts the game controls right under the board, in the board's own column, before the column beside it", () => {
    const play = at('class="play"');
    const stage = at('class="stage"');
    const game = at('class="card game"');
    const side = at('class="side"');
    expect(play).toBeLessThan(stage);
    expect(stage).toBeLessThan(game);
    expect(game).toBeLessThan(side);
    expect(html.slice(stage, game)).not.toContain('class="card');
  });

  it("puts both view choices in the View menu, the first of the game controls after the board", () => {
    const board = at('id="board"');
    const view = at('id="view"');
    const size = at('id="size"');
    expect(board).toBeLessThan(view);
    for (const id of ["show-eval", "analysis-toggle"]) {
      expect(at(`id="${id}"`), id).toBeGreaterThan(view);
      expect(at(`id="${id}"`), id).toBeLessThan(size);
    }
  });

  it("puts the games and the notes on the bots under the game, across the page", () => {
    const side = at('class="side"');
    const more = at('class="more"');
    expect(side).toBeLessThan(more);
    for (const id of ["games", "about"]) expect(at(`id="${id}"`), id).toBeGreaterThan(more);
  });
});

describe("the board's column", () => {
  it("stays in view while the page scrolls only on a wide and tall window", () => {
    expect(css.match(/position: sticky/g)).toHaveLength(1);
    expect(css).toMatch(/@media \(min-width: 900px\) and \(min-height: 560px\) \{\s*\.play \{ position: sticky; top: 8px; \}/);
  });

  it("sizes the board from the window's height as well as the column's width, so the column fits the window", () => {
    expect(css).toMatch(/--b: min\(calc\(100cqw - 64px\), var\(--board-h\), 800px\)/);
    expect(css).toMatch(/--board-h: max\(280px, calc\(100dvh - var\(--chrome\)\)\)/);
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