import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit, auditCvd, contrast, themes } from "../../scripts/contrast.mjs";

const css = readFileSync(new URL("../../src/app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("colour tokens", () => {
  it("compute the WCAG ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("give the system-dark set exactly the tokens of the chosen-dark set", () => {
    const { dark, systemDark, light } = themes(css);
    expect(systemDark).toEqual(dark);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("keep the static theme-color metas on each theme's page colour", () => {
    const { light, dark } = themes(css);
    expect(html).toContain(`content="${light.surface}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${dark.surface}" media="(prefers-color-scheme: dark)"`);
  });

  it("have no colour outside the token blocks", () => {
    const outside = css.slice(css.indexOf("* { box-sizing"));
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it.each(audit(css).map((r) => [`${r.theme}: ${r.fg} on ${r.bg} (${r.where})`, r] as const))("%s", (_name, r) => {
    expect(r.ratio).toBeGreaterThanOrEqual(r.need);
  });

  it.each(auditCvd(css).map((r) => [`${r.theme}: ${r.a} vs ${r.b} as seen with ${r.kind}`, r] as const))("%s", (_name, r) => {
    expect(r.pass).toBe(true);
  });
});
