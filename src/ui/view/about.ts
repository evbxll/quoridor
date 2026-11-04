import type { ModelEnv } from "../../model/store";
import { parseCard } from "../../model/card";
import { playsText } from "../modelInfo";
import { architectureUrl, cardUrl, describeArchitecture, drawArchitecture, parametersText, parseArchitecture } from "../architecture";
import { element } from "../dom";

/**
 * Fills the "About the bots" card with the network `id` plays with: the drawing, one line per stage and its size, from
 * the model's `arch.json`. Without the file the card keeps its words and shows no drawing.
 */
export async function showArchitecture(env: ModelEnv, id: string): Promise<void> {
  try {
    const response = await env.fetch(architectureUrl(env.base, id), { credentials: "omit", mode: "same-origin" });
    if (!response.ok) return;
    const arch = parseArchitecture(await response.json());
    drawArchitecture(element("arch-diagram", SVGSVGElement), arch);
    element("arch-steps", HTMLOListElement).replaceChildren(
      ...describeArchitecture(arch).map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
    const sizes = await boardSizesText(env, id);
    element("arch-size", HTMLElement).textContent = `${parametersText(arch.parameters)} numbers (parameters) in all. ${sizes}`;
    element("arch", HTMLElement).hidden = false;
  } catch {
    // The card's words stand on their own.
  }
}

/** Which board sizes the model plays, from its card; the plain "plays every board size" where the card cannot be read. */
async function boardSizesText(env: ModelEnv, id: string): Promise<string> {
  try {
    const response = await env.fetch(cardUrl(env.base, id), { credentials: "omit", mode: "same-origin" });
    return response.ok ? playsText(parseCard(await response.json())) : "The same network plays every board size.";
  } catch {
    return "The same network plays every board size.";
  }
}
