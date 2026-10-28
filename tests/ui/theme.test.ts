import { describe, expect, it } from "vitest";
import { otherTheme, parseTheme, resolveTheme, THEME_KEY, ThemeSwitch, toggleLabel, type Theme, type ThemeEnv } from "../../src/ui/theme";

/** A page and browser in memory: storage that can be blocked, a system preference that can change, and a log of what was drawn. */
function fakes(options: { stored?: string; blocked?: boolean; systemDark?: boolean } = {}) {
  const state = { stored: options.stored ?? null, dark: options.systemDark ?? false, attribute: "unset" as Theme | null | "unset", rendered: [] as Theme[] };
  let listener: () => void = () => undefined;
  const env: ThemeEnv = {
    getItem: (key) => {
      if (options.blocked) throw new Error("blocked");
      return key === THEME_KEY ? state.stored : null;
    },
    setItem: (key, value) => {
      if (options.blocked) throw new Error("blocked");
      if (key === THEME_KEY) state.stored = value;
    },
    systemDark: () => state.dark,
    onSystemChange: (l) => (listener = l),
    setAttribute: (theme) => (state.attribute = theme),
    render: (theme) => state.rendered.push(theme),
  };
  return { env, state, changeSystem: (dark: boolean) => { state.dark = dark; listener(); } };
}

describe("theme choice", () => {
  it("reads only the two themes", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    for (const bad of [null, undefined, "", "auto", "Dark", "{}"]) expect(parseTheme(bad)).toBeNull();
  });

  it("prefers the stored theme, else the system's", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("names the action, not the state", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(toggleLabel("dark")).toBe("Switch to light theme");
    expect(toggleLabel("light")).toBe("Switch to dark theme");
  });
});

describe("ThemeSwitch", () => {
  it("follows the system when nothing is stored, leaving the attribute off", () => {
    const f = fakes({ systemDark: true });
    const sw = new ThemeSwitch(f.env);
    expect(sw.current()).toBe("dark");
    expect(f.state.attribute).toBeNull();
    expect(f.state.rendered).toEqual(["dark"]);
  });

  it("uses a stored choice over the system and sets the attribute", () => {
    const f = fakes({ stored: "light", systemDark: true });
    const sw = new ThemeSwitch(f.env);
    expect(sw.current()).toBe("light");
    expect(f.state.attribute).toBe("light");
  });

  it("ignores a stored value it does not know", () => {
    const f = fakes({ stored: "sepia", systemDark: false });
    expect(new ThemeSwitch(f.env).current()).toBe("light");
    expect(f.state.attribute).toBeNull();
  });

  it("toggles to the other theme, stores it and draws it", () => {
    const f = fakes({ systemDark: true });
    const sw = new ThemeSwitch(f.env);
    sw.toggle();
    expect(sw.current()).toBe("light");
    expect(f.state.stored).toBe("light");
    expect(f.state.attribute).toBe("light");
    expect(f.state.rendered).toEqual(["dark", "light"]);
    sw.toggle();
    expect(f.state.stored).toBe("dark");
  });

  it("still switches when storage is blocked", () => {
    const f = fakes({ blocked: true, systemDark: false });
    const sw = new ThemeSwitch(f.env);
    expect(sw.current()).toBe("light");
    sw.toggle();
    expect(sw.current()).toBe("dark");
    expect(f.state.attribute).toBe("dark");
    f.changeSystem(true);
    f.changeSystem(false);
    expect(sw.current()).toBe("dark");
  });

  it("follows the system while no choice is made, and stops once one is", () => {
    const f = fakes({ systemDark: false });
    const sw = new ThemeSwitch(f.env);
    f.changeSystem(true);
    expect(sw.current()).toBe("dark");
    expect(f.state.rendered).toEqual(["light", "dark"]);
    sw.toggle();
    f.changeSystem(false);
    expect(sw.current()).toBe("light");
    expect(f.state.rendered).toEqual(["light", "dark", "light"]);
    f.changeSystem(true);
    expect(sw.current()).toBe("light");
    expect(f.state.rendered).toEqual(["light", "dark", "light"]);
  });
});
