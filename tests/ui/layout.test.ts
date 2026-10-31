import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
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
