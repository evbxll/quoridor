import type { ModelEnv } from "../../model/store";
import { architectureUrl, describeArchitecture, drawArchitecture, parametersText, parseArchitecture } from "../architecture";
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
    element("arch-size", HTMLElement).textContent = `${parametersText(arch.parameters)} numbers (parameters) in all. The same network plays every board size.`;
    element("arch", HTMLElement).hidden = false;
  } catch {
    // The card's words stand on their own.
  }
}
