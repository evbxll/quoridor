import { describe, expect, it } from "vitest";
import { botOf } from "../../src/ui/bots";
import { HUMAN, type Players } from "../../src/ui/controller";
import { type VisibilityState, visibleControls } from "../../src/ui/visibility";

const BOT = botOf("normal");
const READY: VisibilityState = { networkPublished: true, showEvaluation: true, gameOver: false };
const NONE: VisibilityState = { networkPublished: false, showEvaluation: true, gameOver: false };

const SEATS: readonly [string, Players, boolean][] = [
  ["human vs human", { p1: HUMAN, p2: HUMAN }, true],
  ["human vs bot", { p1: HUMAN, p2: BOT }, true],
  ["bot vs human", { p1: BOT, p2: HUMAN }, true],
  ["bot vs bot", { p1: BOT, p2: BOT }, false],
];

describe("visibleControls", () => {
  for (const [name, players, person] of SEATS) {
    it(`${name}, network published`, () => {
      expect(visibleControls(players, READY)).toEqual({
        howToMove: person,
        undo: person,
        botControls: !person,
        startBlocked: false,
        evaluationToggle: person,
        evalBar: true,
        analysis: true,
      });
    });

    it(`${name}, no network published`, () => {
      expect(visibleControls(players, NONE)).toEqual({
        howToMove: person,
        undo: person,
        botControls: !person,
        startBlocked: false,
        evaluationToggle: false,
        evalBar: false,
        analysis: false,
      });
    });
  }

  it("lets a person hide the bar, but never hides it from two bots", () => {
    const hidden = { ...READY, showEvaluation: false };
    expect(visibleControls({ p1: HUMAN, p2: BOT }, hidden).evalBar).toBe(false);
    expect(visibleControls({ p1: BOT, p2: BOT }, hidden).evalBar).toBe(true);
  });

  it("blocks Start only for two bots whose game is over", () => {
    const over = { ...READY, gameOver: true };
    expect(visibleControls({ p1: BOT, p2: BOT }, over).startBlocked).toBe(true);
    expect(visibleControls({ p1: HUMAN, p2: BOT }, over).startBlocked).toBe(false);
  });
});
