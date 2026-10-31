import { describe, expect, it } from "vitest";
import { botOf, PRESETS, withModel } from "../../src/ui/bots";
import { HUMAN } from "../../src/ui/controller";
import { choiceOf, CUSTOM, ENGINE_GROUPS, playerAfterChoice, seatAfterChoice, type SeatState } from "../../src/ui/seatChoice";

const GALLERY_MODEL = "s9-fpu-basic-g112";

describe("the seat select's entries", () => {
  it("group every preset under its engine, heuristic first, each group with its Custom entry", () => {
    expect(ENGINE_GROUPS.map((group) => [group.label, PRESETS.filter((preset) => preset.engine === group.engine).map((preset) => preset.id), CUSTOM[group.engine]])).toEqual([
      ["Heuristic", ["beginner", "normal"], "custom-heuristic"],
      ["Neural network", ["strong", "max"], "custom-network"],
    ]);
  });

  it("show Human, the preset, or the Custom entry of the bot's own engine", () => {
    expect(choiceOf(HUMAN)).toBe(HUMAN);
    for (const preset of PRESETS) expect(choiceOf(botOf(preset.id))).toBe(preset.id);
    expect(choiceOf({ ...botOf("normal"), simulations: 400 })).toBe("custom-heuristic");
    expect(choiceOf({ ...botOf("strong"), vary: true })).toBe("custom-network");
  });

  it("show a network preset with a gallery model as that preset: the model is not part of the level", () => {
    expect(choiceOf(withModel(botOf("max"), GALLERY_MODEL))).toBe("max");
  });
});

describe("choosing an entry", () => {
  it("seats a person, or a preset's bot with the preset's settings", () => {
    expect(playerAfterChoice(botOf("strong"), HUMAN)).toBe(HUMAN);
    expect(playerAfterChoice(HUMAN, "normal")).toEqual(botOf("normal"));
    expect(playerAfterChoice({ ...botOf("normal"), simulations: 1600, vary: true }, "beginner")).toEqual(botOf("beginner"));
  });

  it("keeps the network model from one network level to another", () => {
    expect(playerAfterChoice(withModel(botOf("strong"), GALLERY_MODEL), "max")).toEqual(withModel(botOf("max"), GALLERY_MODEL));
    expect(playerAfterChoice(withModel({ ...botOf("strong"), simulations: 800 }, GALLERY_MODEL), "strong")).toEqual(withModel(botOf("strong"), GALLERY_MODEL));
  });

  it("drops the model when the engine changes, so a heuristic never holds one and a network chosen afresh is the main one", () => {
    const heuristic = playerAfterChoice(withModel(botOf("max"), GALLERY_MODEL), "normal")!;
    expect(heuristic).toEqual(botOf("normal"));
    expect(heuristic !== HUMAN && "model" in heuristic).toBe(false);
    expect(playerAfterChoice(heuristic, "strong")).toEqual(botOf("strong"));
    expect(playerAfterChoice(HUMAN, "max")).toEqual(botOf("max"));
  });

  it("changes nothing for a Custom entry, which only names the current settings", () => {
    expect(playerAfterChoice(botOf("strong"), "custom-network")).toBeNull();
    expect(playerAfterChoice(HUMAN, "custom-heuristic")).toBeNull();
  });
});

describe("a seat's state after a choice", () => {
  const max: SeatState = { human: false, bot: botOf("max"), model: GALLERY_MODEL };

  it("drops a gallery model on the way to a heuristic or a person, so a network chosen later is the main one", () => {
    const normal = seatAfterChoice(max, "normal")!;
    expect(normal).toEqual({ human: false, bot: botOf("normal"), model: undefined });
    expect(seatAfterChoice(normal, "strong")).toEqual({ human: false, bot: botOf("strong"), model: undefined });
    const person = seatAfterChoice(max, HUMAN)!;
    expect(person.human).toBe(true);
    expect(person.model).toBeUndefined();
    expect(seatAfterChoice(person, "max")!.model).toBeUndefined();
  });

  it("keeps it from one network level to another, and changes nothing for Custom", () => {
    expect(seatAfterChoice(max, "strong")).toEqual({ human: false, bot: botOf("strong"), model: GALLERY_MODEL });
    expect(seatAfterChoice(max, "custom-network")).toBeNull();
  });
});
