import { describe, expect, it } from "vitest";
import { boardSizesText } from "../../src/ui/view/about";
import { cardJson } from "../helpers/cards";
import { envOf, fakeFetch } from "../helpers/fakeBrowser";

const FALLBACK = "The same network plays several board sizes.";

describe("the About card's board sizes", () => {
  it("come from the model's card", async () => {
    const { fetch, requested } = fakeFetch({ "models/m/card.json": () => new Response(JSON.stringify(cardJson("m", { sizes: [5, 7, 9, 11, 13] }))) });
    expect(await boardSizesText(envOf(fetch, undefined), "m")).toBe("Trained on 9 × 9; also plays 5 × 5, 7 × 7, 11 × 11 and 13 × 13.");
    expect(requested).toHaveLength(1);
  });

  it("fall back to a plain sentence when the card is missing, malformed or cannot be fetched", async () => {
    const missing = fakeFetch({}).fetch;
    const malformed = fakeFetch({ "models/m/card.json": () => new Response("{ nope") }).fetch;
    const offline = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    for (const fetch of [missing, malformed, offline]) expect(await boardSizesText(envOf(fetch, undefined), "m")).toBe(FALLBACK);
  });
});
