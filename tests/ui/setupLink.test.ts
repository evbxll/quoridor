import { describe, expect, it } from "vitest";
import { Game } from "../../src/engine/game";
import { botOf, capFor, capitalized, modelName, PRESETS, withModel } from "../../src/ui/bots";
import { HUMAN, type Player, type Players } from "../../src/ui/controller";
import { keepNote, takeNote } from "../../src/ui/persistence";
import { addressOf, isOwnAddress, keptAfterSeat, keptAfterSwap, parseSeat, personFirst, readSetup, seatCode, seatsForLink, seatsOf, type Setup, setupText } from "../../src/ui/setupLink";

const DEFAULTS: Players = { p1: HUMAN, p2: botOf("strong") };
const SEATS: readonly Player[] = [
  HUMAN,
  ...PRESETS.map((preset) => botOf(preset.id)),
  { engine: "heuristic", simulations: 1600, vary: true },
  { engine: "network", simulations: 1, vary: false },
  withModel(botOf("max"), "s9-fpu-basic-g112"),
];

describe("seat codes", () => {
  it("are short", () => {
    expect(SEATS.map(seatCode)).toEqual(["p", "h5v", "h100", "n32", "n200", "h1600v", "n1", "n200~s9-fpu-basic-g112"]);
  });

  it("read back to the same seat", () => {
    for (const seat of SEATS) expect(parseSeat(seatCode(seat), 9)).toEqual(seat);
  });

  it("clamp a bot's simulations to a step offered on the board, never above its cap", () => {
    expect(parseSeat("n800", 11)).toEqual({ engine: "network", simulations: capFor("network", 11), vary: false });
    expect(parseSeat("n999999", 9)).toEqual({ engine: "network", simulations: capFor("network", 9), vary: false });
    expect(parseSeat("h0", 9)).toEqual({ engine: "heuristic", simulations: 1, vary: false });
    expect(parseSeat("n33", 9)).toEqual(botOf("strong"));
  });

  it("refuse anything else, so a hostile or broken link cannot seat it", () => {
    for (const bad of ["", "P", "x32", "n", "n-5", "n32 ", "n1234567", "n32vv", "n32~", "n32~../model", "n32~a/b", "h100~some-model", "n32~" + "a".repeat(81), "human", "<script>"]) {
      expect(parseSeat(bad, 9), bad).toBeNull();
    }
  });
});

describe("the page's address", () => {
  const game = new Game(9);
  game.playMove("e2");
  game.playMove("e8");

  it("puts both seats after the board size and before the moves", () => {
    expect(addressOf(game.toHash(), DEFAULTS)).toBe("#n=9&p1=p&p2=n32&m=e2.e8");
    expect(addressOf("#n=7&m=", { p1: botOf("normal"), p2: botOf("beginner") })).toBe("#n=7&p1=h100&p2=h5v&m=");
  });

  it("still replays as the same game", () => {
    expect(Game.fromHash(addressOf(game.toHash(), DEFAULTS)).toHash()).toBe(game.toHash());
  });

  it("gives back the seats it names", () => {
    const players: Players = { p1: withModel(botOf("max"), "s9-fpu-basic-g112"), p2: HUMAN };
    expect(seatsOf(addressOf(game.toHash(), players), 9)).toEqual({ seats: players, unreadable: [] });
  });

  it("names no seats in an older link, which opens as before", () => {
    expect(seatsOf("#n=9&m=e2.e8", 9)).toBeNull();
    expect(seatsOf("", 9)).toBeNull();
  });

  it("lists a seat it cannot read, or that is named twice, and keeps the other", () => {
    expect(seatsOf("#n=9&p1=zz&p2=h100&m=", 9)).toEqual({ seats: { p2: botOf("normal") }, unreadable: ["p1"] });
    expect(seatsOf("#n=9&p1=p&p1=n32&p2=h100", 9)).toEqual({ seats: { p2: botOf("normal") }, unreadable: ["p1"] });
    expect(seatsOf("#n=9&p2=p", 9)).toEqual({ seats: { p2: HUMAN }, unreadable: ["p1"] });
  });
});

describe("the setup kept between visits", () => {
  const players: Players = { p1: botOf("beginner"), p2: withModel(botOf("strong"), "s9-fpu-basic-g112") };

  it("reads back what was kept", () => {
    expect(setupText({ size: 7, players })).toBe("n=7&p1=h5v&p2=n32~s9-fpu-basic-g112");
    expect(readSetup(setupText({ size: 7, players }), DEFAULTS)).toEqual({ size: 7, players });
  });

  it("is ignored when missing or for a board the site does not offer", () => {
    for (const text of [null, "", "garbage", "n=13&p1=p&p2=p", "n=9.0&p1=p&p2=p", "n=9", "n=-9&p1=p&p2=p"]) expect(readSetup(text, DEFAULTS), String(text)).toBeNull();
  });

  it("takes the default for a seat it cannot read", () => {
    expect(readSetup("n=9&p1=h100&p2=???", DEFAULTS)).toEqual({ size: 9, players: { p1: botOf("normal"), p2: DEFAULTS.p2 } });
  });
});

describe("opening a link", () => {
  const strong = botOf("strong");

  it("lets the person move first on a fresh position, and keeps a game in progress as the link has it", () => {
    const botFirst = seatsOf("#n=9&p1=n32&p2=p&m=", 9)!;
    expect(seatsForLink(botFirst, DEFAULTS, 0)).toEqual({ p1: HUMAN, p2: strong });
    expect(seatsForLink(botFirst, DEFAULTS, 3)).toEqual({ p1: strong, p2: HUMAN });
    expect(personFirst({ p1: strong, p2: botOf("normal") })).toEqual({ p1: strong, p2: botOf("normal") });
  });

  it("takes the default for a seat it cannot read", () => {
    expect(seatsForLink(seatsOf("#n=9&p1=zz&p2=h100", 9)!, DEFAULTS, 4)).toEqual({ p1: HUMAN, p2: botOf("normal") });
  });

  it("needs no opening when the address is the page's own", () => {
    expect(isOwnAddress("#n=9&p1=p&p2=n32&m=e2", "#n=9&m=e2", DEFAULTS)).toBe(true);
    expect(isOwnAddress("#n=9&m=e2", "#n=9&m=e2", DEFAULTS)).toBe(false);
    expect(isOwnAddress("#n=9&p1=p&p2=h100&m=e2", "#n=9&m=e2", DEFAULTS)).toBe(false);
  });
});

describe("what the page keeps of the person's choices", () => {
  const kept: Setup = { size: 7, players: { p1: HUMAN, p2: botOf("max") } };

  it("changes one seat, or swaps them, and nothing else", () => {
    expect(keptAfterSeat(kept, "p1", botOf("normal"))).toEqual({ size: 7, players: { p1: botOf("normal"), p2: botOf("max") } });
    expect(keptAfterSwap(kept)).toEqual({ size: 7, players: { p1: botOf("max"), p2: HUMAN } });
  });

  it("keeps a seat the page swapped in on its own out of it: only the edited seat is taken from the controls", () => {
    // The network was off, so the page seated Normal for player 2; the person then edits player 1.
    expect(keptAfterSeat(kept, "p1", botOf("beginner")).players.p2).toEqual(botOf("max"));
  });
});

describe("a sentence kept across the page's one reload", () => {
  const store = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> => {
    const items = new Map<string, string>();
    return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
  };

  it("is said once on the next page, and only soon after", () => {
    const tab = store();
    keepNote("Part of the link could not be read.", 1000, tab);
    expect(takeNote(2000, tab)).toBe("Part of the link could not be read.");
    expect(takeNote(2000, tab)).toBeNull();
    keepNote("Old.", 1000, tab);
    expect(takeNote(60_000, tab)).toBeNull();
  });

  it("is dropped when storage is blocked or holds something else", () => {
    expect(takeNote(0, null)).toBeNull();
    const tab = store();
    tab.setItem("quoridor.note", "{not json");
    expect(takeNote(0, tab)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(() => keepNote("x", 0, broken)).not.toThrow();
    expect(takeNote(0, broken)).toBeNull();
  });
});

describe("a model's name in words", () => {
  it("is never its id: a model whose card is not read is the chosen network", () => {
    expect(modelName("no-such-model")).toBe("the chosen network");
    expect(capitalized(modelName("no-such-model"))).toBe("The chosen network");
  });
});
