import { describe, expect, it } from "vitest";
import { type ModelCard, parseCard } from "../../src/model/card";
import { botLabel, botOf, botSummary, estimateMs, MEASURED_MODEL, modelName, presetOf, sameBot, setModelLabel, timeModelOf, withModel } from "../../src/ui/bots";
import { buildModelOptions, choosableModels, describeModelStatus, disabledReason, extraModels, MAIN_MODEL, modelTitle, offSizeNote, strengthDetail, strengthLine } from "../../src/ui/modelInfo";
import { cardJson, fcCardJson } from "../helpers/cards";

const ladder = (elo: number): Record<string, unknown> => ({ ...(cardJson("x").strength as Record<string, unknown>[])[0], elo, interval: [elo - 37.5, elo + 37.5] });
const conv = (id: string, generation: number, elo: number | null = 406.7): ModelCard =>
  parseCard(cardJson(id, { source: { run: "s9-conv-paths", generation }, strength: elo === null ? [] : [ladder(elo)] }));
const fc = parseCard({ ...fcCardJson("s9-fpu-basic-g112"), source: { run: "s9-fpu-basic", generation: 112 }, strength: [ladder(333.7)] });
const CARDS: Record<string, ModelCard> = {
  "s9-conv-paths-g105": conv("s9-conv-paths-g105", 105, 557.8),
  "s9-conv-paths-g050": conv("s9-conv-paths-g050", 50),
  "s9-conv-paths-g010": conv("s9-conv-paths-g010", 10, 211.7),
  "s9-fpu-basic-g112": fc,
};
const GALLERY = ["s9-conv-paths-g010", "s9-conv-paths-g050", "s9-fpu-basic-g112", "s9-conv-paths-g105"];
const options = (size: number, gallery = GALLERY, cards = CARDS, failed: string[] = []) =>
  buildModelOptions({ mainId: "s9-conv-paths-g105", gallery, card: (id) => cards[id] ?? null, size, cardFailed: (id) => failed.includes(id) });

describe("the Model select's options", () => {
  it("is empty (the select hidden) when only the main model is published, whether or not the gallery lists it", () => {
    expect(options(9, [])).toEqual([]);
    expect(options(9, ["s9-conv-paths-g105"])).toEqual([]);
    expect(extraModels("s9-conv-paths-g105", ["s9-conv-paths-g105"])).toEqual([]);
  });

  it("lists the main network first, then the gallery in its published order, each named by its architecture alone", () => {
    expect(options(9, ["s9-fpu-basic-g112", "s9-conv-paths-g105"]).map((o) => [o.value, o.label, o.disabled])).toEqual([
      [MAIN_MODEL, "Convolutional", false],
      ["s9-fpu-basic-g112", "Fully connected", false],
    ]);
  });

  it("disables a model that cannot play the size and says why in the label; a conv model's trained size is not a reason", () => {
    const at7 = options(7);
    expect(at7.find((o) => o.value === "s9-fpu-basic-g112")).toEqual({ value: "s9-fpu-basic-g112", label: "Fully connected (9x9 only)", disabled: true });
    expect(at7.filter((o) => o.disabled).map((o) => o.value)).toEqual(["s9-fpu-basic-g112"]);
    expect(options(11, GALLERY, { "s9-conv-paths-g050": CARDS["s9-conv-paths-g050"]! }).find((o) => o.value === "s9-conv-paths-g050")!.disabled).toBe(false);
  });

  it("offers one model per architecture other than the main one: the last listed, so older generations of the main network never show", () => {
    expect(options(9).map((o) => o.value)).toEqual([MAIN_MODEL, "s9-fpu-basic-g112"]);
    expect(options(9, ["s9-conv-paths-g010", "s9-conv-paths-g050", "s9-conv-paths-g105"])).toEqual([]);
    const fc2 = parseCard({ ...fcCardJson("s9-fpu-basic-g200"), source: { run: "s9-fpu-basic", generation: 200 } });
    const two = { ...CARDS, "s9-fpu-basic-g200": fc2 };
    expect(options(9, ["s9-fpu-basic-g112", "s9-fpu-basic-g200", "s9-conv-paths-g105"], two).map((o) => o.value)).toEqual([MAIN_MODEL, "s9-fpu-basic-g200"]);
    expect(choosableModels("s9-conv-paths-g105", ["unread", "s9-conv-paths-g050"], (id) => CARDS[id] ?? null)).toEqual(["unread"]);
  });

  it("names a conv model whose card leaves out a size as not offered there", () => {
    const narrow = parseCard(cardJson("s9-conv-paths-g050", { sizes: [9], source: { run: "s9-conv-paths", generation: 50 } }));
    expect(disabledReason(narrow, 11)).toBe("not offered at 11x11");
    expect(disabledReason(narrow, 9)).toBeNull();
    expect(disabledReason(null, 11)).toBe("loading");
  });


  it("does not let a gallery model be picked before its card is read, whatever the size", () => {
    const some = { "s9-conv-paths-g050": CARDS["s9-conv-paths-g050"]! };
    const built = options(7, GALLERY, some);
    expect(built[0]).toEqual({ value: MAIN_MODEL, label: "Main network", disabled: false });
    expect(built.find((o) => o.value === "s9-conv-paths-g050")!.disabled).toBe(false);
    expect(built.find((o) => o.value === "s9-fpu-basic-g112")).toEqual({ value: "s9-fpu-basic-g112", label: "s9-fpu-basic-g112 (loading)", disabled: true });
  });

  it("says a card that could not be read is not coming", () => {
    const built = options(9, GALLERY, {}, ["s9-fpu-basic-g112"]);
    expect(built.find((o) => o.value === "s9-fpu-basic-g112")).toMatchObject({ label: "s9-fpu-basic-g112 (card could not be read)", disabled: true });
  });

  it("names a model by its architecture, with no generation, and by its id until its card is read", () => {
    expect(modelTitle("s9-conv-paths-g050", CARDS["s9-conv-paths-g050"]!)).toBe("Convolutional");
    expect(modelTitle("s9-fpu-basic-g112", fc)).toBe("Fully connected");
    expect(modelTitle("s9-fpu-basic-g112", null)).toBe("s9-fpu-basic-g112");
  });
});

describe("what a seat says about its model", () => {
  const g105 = CARDS["s9-conv-paths-g105"]!;
  const g050 = CARDS["s9-conv-paths-g050"]!;

  it("gives no off-size note on the trained size or for an fc model", () => {
    expect(offSizeNote("s9-conv-paths-g050", g050, 9)).toBeNull();
    expect(offSizeNote("s9-fpu-basic-g112", fc, 9)).toBeNull();
  });

  it("says an older generation's strength on another size is unmeasured", () => {
    expect(offSizeNote("s9-conv-paths-g050", g050, 7)).toBe(
      "Trained on 9x9. Its convolutional architecture can play other sizes, but it was never trained on this one, so its strength here is unmeasured.",
    );
  });

  it("cites the measured score where the repo has one", () => {
    expect(offSizeNote("s9-conv-paths-g105", g105, 11)).toContain("0.927 [0.833, 1.000] at 32 simulations");
    expect(offSizeNote("s9-conv-paths-g105", g105, 11)).not.toContain("unmeasured");
    expect(offSizeNote("s9-conv-paths-g105", g105, 5)).toContain("unmeasured");
  });

  it("states the ladder Elo with its interval, opponent and budget, and that it is not a win rate", () => {
    expect(strengthLine(g050, 9)).toBe("9x9 ladder Elo +407 [+369, +444] vs the Evan bot at 25 simulations (95%). Ladder Elo, not a win rate.");
    expect(strengthLine(g050, 11)).toMatch(/^Not rated on 11x11\. 9x9 ladder Elo/);
    expect(strengthLine(conv("x", 1, null), 9)).toBe("No strength is measured for this model.");
    expect(strengthDetail(g050, 9)).toContain("Evan bot");
    expect(strengthDetail(g050, 9)).toContain("2 random legal actions");
    expect(strengthDetail(g050, 9)).toContain("Laplace");
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
    expect(sameBot(strong, withModel(strong, "s9-conv-paths-g050"))).toBe(false);
    expect(sameBot(withModel(strong, "s9-conv-paths-g050"), withModel(strong, "s9-conv-paths-g050"))).toBe(true);
    expect(sameBot(withModel(strong, "s9-conv-paths-g050"), withModel(strong, "s9-conv-paths-g010"))).toBe(false);
  });

  it("keeps the preset's name with any model, and names the model in the summary", () => {
    const other = withModel(strong, "s9-conv-paths-g050");
    expect(presetOf(other)?.id).toBe("strong");
    expect(botLabel(other)).toBe("Strong");
    expect(botSummary(strong)).toBe("Neural network, 32 searches a move");
    setModelLabel("s9-conv-paths-g050", "Conv, gen 50");
    expect(modelName("s9-conv-paths-g050")).toBe("Conv, gen 50");
    expect(botSummary(other)).toBe("Neural network, 32 searches a move, Conv, gen 50");
  });

  it("gives a heuristic bot no model", () => {
    expect(withModel(botOf("normal"), "s9-conv-paths-g050")).toEqual(botOf("normal"));
  });
});

describe("time estimates by model", () => {
  it("reuses the measured table for a model made the same way and has its own for the fc model", () => {
    expect(timeModelOf(CARDS["s9-conv-paths-g050"]!)).toBe(MEASURED_MODEL);
    expect(timeModelOf(fc)).toBe("s9-fpu-basic-g112");
    const bot = botOf("strong");
    expect(estimateMs(bot, 9, timeModelOf(CARDS["s9-conv-paths-g050"]!))).toEqual({ ms: 155, p90: 213, kind: "measured" });
    expect(estimateMs(bot, 9, "s9-fpu-basic-g112")).toEqual({ ms: 128, p90: 170, kind: "measured" });
    expect(estimateMs(bot, 7, "s9-fpu-basic-g112")).toBeNull();
    expect(estimateMs(bot, 9, "some-other-model")).toBeNull();
  });
});
