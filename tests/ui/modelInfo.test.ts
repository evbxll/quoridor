import { describe, expect, it } from "vitest";
import { type ModelCard, parseCard } from "../../src/model/card";
import { botLabel, botOf, botSummary, estimateMs, MEASURED_ARCHITECTURE, modelName, presetOf, sameBot, setModelLabel, timeKeyFor, timeKeyOf, withModel } from "../../src/ui/bots";
import { buildModelOptions, choosableModels, describeModelStatus, disabledReason, extraModels, MAIN_MODEL, modelTitle, playsText, seatStrength } from "../../src/ui/modelInfo";
import { cardJson, fcCardJson } from "../helpers/cards";

/** A card's strength entry: Elo above Normal on 9x9. */
const rated = (elo: number): Record<string, unknown> => ({ size: 9, elo_vs_normal: elo });
const conv = (id: string, elo: number | null = 366.7): ModelCard => parseCard(cardJson(id, { strength: elo === null ? [] : [rated(elo)] }));
const fc = parseCard({ ...fcCardJson("test-fc"), strength: [rated(293.7)] });
const CARDS: Record<string, ModelCard> = {
  "test-main": conv("test-main", 517.8),
  "test-older": conv("test-older"),
  "test-oldest": conv("test-oldest", 171.7),
  "test-fc": fc,
};
const GALLERY = ["test-oldest", "test-older", "test-fc", "test-main"];
const options = (size: number, gallery = GALLERY, cards = CARDS, failed: string[] = []) =>
  buildModelOptions({ mainId: "test-main", gallery, card: (id) => cards[id] ?? null, size, cardFailed: (id) => failed.includes(id) });

describe("the Model select's options", () => {
  it("is empty (the select hidden) when only the main model is published, whether or not the gallery lists it", () => {
    expect(options(9, [])).toEqual([]);
    expect(options(9, ["test-main"])).toEqual([]);
    expect(extraModels("test-main", ["test-main"])).toEqual([]);
  });

  it("lists the main network first, then the gallery in its published order, each named by its architecture alone", () => {
    expect(options(9, ["test-fc", "test-main"]).map((o) => [o.value, o.label, o.disabled])).toEqual([
      [MAIN_MODEL, "Convolutional", false],
      ["test-fc", "Fully connected", false],
    ]);
  });

  it("disables a model that cannot play the size and says why in the label; a conv model's trained size is not a reason", () => {
    const at7 = options(7);
    expect(at7.find((o) => o.value === "test-fc")).toEqual({ value: "test-fc", label: "Fully connected (9x9 only)", disabled: true });
    expect(at7.filter((o) => o.disabled).map((o) => o.value)).toEqual(["test-fc"]);
    expect(options(11, GALLERY, { "test-older": CARDS["test-older"]! }).find((o) => o.value === "test-older")!.disabled).toBe(false);
  });

  it("offers one model per architecture other than the main one: the last listed, so older generations of the main network never show", () => {
    expect(options(9).map((o) => o.value)).toEqual([MAIN_MODEL, "test-fc"]);
    expect(options(9, ["test-oldest", "test-older", "test-main"])).toEqual([]);
    const fc2 = parseCard({ ...fcCardJson("test-fc-2"), source: { run: "s9-fpu-basic", generation: 200 } });
    const two = { ...CARDS, "test-fc-2": fc2 };
    expect(options(9, ["test-fc", "test-fc-2", "test-main"], two).map((o) => o.value)).toEqual([MAIN_MODEL, "test-fc-2"]);
    expect(choosableModels("test-main", ["unread", "test-older"], (id) => CARDS[id] ?? null)).toEqual(["unread"]);
  });

  it("names a conv model whose card leaves out a size as not offered there", () => {
    const narrow = parseCard(cardJson("test-older", { sizes: [9] }));
    expect(disabledReason(narrow, 11)).toBe("not offered at 11x11");
    expect(disabledReason(narrow, 9)).toBeNull();
    expect(disabledReason(null, 11)).toBe("loading");
  });


  it("does not let a gallery model be picked before its card is read, whatever the size", () => {
    const some = { "test-older": CARDS["test-older"]! };
    const built = options(7, GALLERY, some);
    expect(built[0]).toEqual({ value: MAIN_MODEL, label: "Main network", disabled: false });
    expect(built.find((o) => o.value === "test-older")!.disabled).toBe(false);
    expect(built.find((o) => o.value === "test-fc")).toEqual({ value: "test-fc", label: "Another network (loading)", disabled: true });
  });

  it("says a card that could not be read is not coming", () => {
    const built = options(9, GALLERY, {}, ["test-fc"]);
    expect(built.find((o) => o.value === "test-fc")).toMatchObject({ label: "Another network (card could not be read)", disabled: true });
  });

  it("names a model by its architecture, with no generation, and as another network until its card is read", () => {
    expect(modelTitle(CARDS["test-older"]!)).toBe("Convolutional");
    expect(modelTitle(fc)).toBe("Fully connected");
    expect(modelTitle(null)).toBe("Another network");
  });
});

describe("what a seat says about its model", () => {
  const main = CARDS["test-main"]!;
  const older = CARDS["test-older"]!;

  it("gives a network bot its card's figure against Normal, rounded to 50", () => {
    // main's card: +517.8 on 9x9, so +500; another card's figure gives another line, with no figure kept in the page.
    expect(seatStrength(botOf("strong"), main, 9)).toBe("≈ +500 Elo vs Normal");
    expect(seatStrength(botOf("max"), main, 9)).toBe("≈ +500 Elo or more vs Normal");
    const strongest = conv("test-new", 744);
    expect(seatStrength(botOf("strong"), strongest, 9)).toBe("≈ +750 Elo vs Normal");
    expect(seatStrength(botOf("max"), strongest, 9)).toBe("≈ +750 Elo or more vs Normal");
    expect(seatStrength(botOf("strong"), strongest, 13)).toBe("≈ +750 Elo vs Normal (measured on 9 × 9)");
    expect(seatStrength({ ...botOf("strong"), vary: true }, strongest, 9)).toBe("");
    expect(seatStrength({ ...botOf("max"), simulations: 800 }, strongest, 9)).toBe("");
    expect(seatStrength(botOf("strong"), older, 9)).toBe("≈ +350 Elo vs Normal");
  });

  it("names the size it was rated on when the board is another one", () => {
    expect(seatStrength(botOf("strong"), main, 11)).toBe("≈ +500 Elo vs Normal (measured on 9 × 9)");
  });

  it("gives none below Strong's simulations, without a card, or without a rating", () => {
    expect(seatStrength({ ...botOf("strong"), simulations: 16 }, main, 9)).toBe("");
    expect(seatStrength(botOf("strong"), null, 9)).toBe("");
    expect(seatStrength(botOf("strong"), conv("x", null), 9)).toBe("");
  });

  it("gives none for a network bot that plays otherwise than rated: Vary moves on, or Custom simulations", () => {
    expect(seatStrength({ ...botOf("strong"), vary: true }, main, 9)).toBe("");
    expect(seatStrength({ ...botOf("max"), vary: true }, main, 9)).toBe("");
    expect(seatStrength({ ...botOf("max"), simulations: 800 }, main, 9)).toBe("");
    expect(seatStrength({ ...botOf("strong"), simulations: 64 }, main, 9)).toBe("");
  });

  it("says what Beginner and Normal are, and nothing for custom heuristic settings", () => {
    expect(seatStrength(botOf("beginner"), null, 9)).toBe("Much weaker than Normal.");
    expect(seatStrength(botOf("normal"), main, 7)).toBe("A solid all-round opponent.");
    expect(seatStrength({ ...botOf("normal"), simulations: 400 }, null, 9)).toBe("");
  });

  it("never names the reference bot, the ladder, intervals, openings or the method", () => {
    const lines = [seatStrength(botOf("strong"), main, 9), seatStrength(botOf("strong"), main, 11), seatStrength(botOf("normal"), null, 9), seatStrength(botOf("beginner"), null, 9)];
    for (const line of lines) expect(line).not.toMatch(/Evan|ladder|interval|anchor|opening|fresh|simulation|\[/i);
  });
  it("describes each state of a model", () => {
    const t = "Conv, gen 50";
    expect(describeModelStatus(t, { status: "idle" }).text).toBe("Conv, gen 50: not loaded.");
    expect(describeModelStatus(t, { status: "downloading", loaded: 4_950_000, total: 9_900_000 })).toMatchObject({ percent: 50, downloading: true, text: "Conv, gen 50: downloading 50% (5.0 of 9.9 MB)" });
    expect(describeModelStatus(t, { status: "downloading", loaded: 1_000_000, total: null })).toMatchObject({ percent: null, downloading: true });
    expect(describeModelStatus(t, { status: "ready", model: "m", fromCache: true, saved: true }).text).toBe("Conv, gen 50: ready, loaded from this device.");
    expect(describeModelStatus(t, { status: "failed", message: "Offline.", kind: "network" })).toMatchObject({ failed: true, text: "Conv, gen 50: the download failed. Offline." });
  });
});

describe("a bot's model in its identity", () => {
  const strong = botOf("strong");

  it("makes two bots with different models different bots, and no model the main model", () => {
    expect(sameBot(strong, withModel(strong, undefined))).toBe(true);
    expect(sameBot(strong, withModel(strong, "test-older"))).toBe(false);
    expect(sameBot(withModel(strong, "test-older"), withModel(strong, "test-older"))).toBe(true);
    expect(sameBot(withModel(strong, "test-older"), withModel(strong, "test-oldest"))).toBe(false);
  });

  it("keeps the preset's name with any model, and names the model in the summary", () => {
    const other = withModel(strong, "test-older");
    expect(presetOf(other)?.id).toBe("strong");
    expect(botLabel(other)).toBe("Strong (neural net)");
    expect(botSummary(strong)).toBe("32 searches a move");
    setModelLabel("test-older", "Conv, gen 50");
    expect(modelName("test-older")).toBe("Conv, gen 50");
    expect(botSummary(other)).toBe("32 searches a move, Conv, gen 50");
  });

  it("gives a heuristic bot no model", () => {
    expect(withModel(botOf("normal"), "test-older")).toEqual(botOf("normal"));
  });
});

describe("time estimates by model", () => {
  it("reuses the measured table for a model made the same way; another make is unmeasured", () => {
    expect(timeKeyOf(CARDS["test-older"]!)).toBe(MEASURED_ARCHITECTURE);
    expect(timeKeyOf(CARDS["test-older"]!)).toBe("conv-128x8");
    expect(timeKeyOf(fc)).toBe("fc-128x8");
    expect(timeKeyOf(conv("another-id", 1))).toBe(MEASURED_ARCHITECTURE);
    expect(timeKeyOf(parseCard(cardJson("wide", { network: { head: "conv", input_planes: 10, channels: 256, blocks: 8, pool_every: 3, head_channels: 32, board_size: null } })))).not.toBe(MEASURED_ARCHITECTURE);
    const bot = botOf("strong");
    expect(estimateMs(bot, 9, timeKeyOf(CARDS["test-older"]!))).toEqual({ ms: 155, kind: "measured" });
    expect(estimateMs(bot, 9, timeKeyOf(fc))).toBeNull();
    expect(estimateMs(bot, 9, "some-other-model")).toBeNull();
  });
});

describe("where a model plays", () => {
  it("says the trained size and the other sizes the card lists, in order", () => {
    expect(playsText(parseCard(cardJson("m", { sizes: [13, 5, 9, 7, 11] })))).toBe("Trained on 9 × 9; also plays 5 × 5, 7 × 7, 11 × 11 and 13 × 13.");
    expect(playsText(parseCard(cardJson("m", { sizes: [9, 11] })))).toBe("Trained on 9 × 9; also plays 11 × 11.");
    expect(playsText(parseCard(cardJson("m", { sizes: [9] })))).toBe("Trained on 9 × 9.");
    expect(playsText(fc)).toBe("Trained on 9 × 9.");
  });

  it("passes the public text audit", async () => {
    const { forbiddenIn } = await import("../../scripts/verify-dist.mjs");
    expect(forbiddenIn(playsText(parseCard(cardJson("m", { sizes: [5, 7, 9, 11, 13] }))))).toEqual([]);
  });
});

describe("the time key of a seat", () => {
  const strong = botOf("strong");
  const cards = (id: string): ModelCard | null => CARDS[id] ?? null;

  it("is the main model's make when the seat holds no model, so Strong and Max are measured whatever the main model's id", () => {
    expect(timeKeyFor(strong, undefined, "test-main", cards)).toBe("conv-128x8");
    expect(timeKeyFor(strong, undefined, "a-model-never-seen-before", (id) => conv(id))).toBe(MEASURED_ARCHITECTURE);
  });

  it("uses the table while the main model is not ready or its card is not read, and is none for a heuristic bot", () => {
    expect(timeKeyFor(strong, undefined, null, cards)).toBeNull();
    expect(timeKeyFor(strong, undefined, "unread", cards)).toBeNull();
    expect(timeKeyFor(botOf("normal"), undefined, "test-main", cards)).toBeNull();
  });

  it("is the gallery model's make, or its id (unmeasured) while its card is not read", () => {
    expect(timeKeyFor(strong, "test-fc", "test-main", cards)).toBe("fc-128x8");
    expect(timeKeyFor(strong, "test-older", "test-main", cards)).toBe(MEASURED_ARCHITECTURE);
    expect(timeKeyFor(strong, "unread", "test-main", cards)).toBe("unread");
    expect(estimateMs(strong, 9, timeKeyFor(strong, "unread", "test-main", cards))).toBeNull();
  });

  it("follows the model a seat holds explicitly, even when it is the main model", () => {
    expect(timeKeyFor(strong, "test-main", "test-fc", cards)).toBe("conv-128x8");
  });

  it("names the make by its width and depth", () => {
    const network = (channels: number, blocks: number) => ({ head: "conv", input_planes: 10, channels, blocks, pool_every: 3, head_channels: 32, board_size: null });
    expect(timeKeyOf(parseCard(cardJson("m", { network: network(128, 6) })))).toBe("conv-128x6");
    expect(timeKeyOf(parseCard(cardJson("m", { network: network(64, 8) })))).toBe("conv-64x8");
  });
});
