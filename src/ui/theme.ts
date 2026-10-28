/** The two looks of the page. With no choice made the page follows the system's colour scheme. */
export type Theme = "light" | "dark";

/** Where a viewer's own choice is kept. The inline script in index.html reads the same key. */
export const THEME_KEY = "quoridor.theme";

/** A stored value as a theme, or null when it is missing or not one of ours. */
export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The theme in effect: the viewer's choice if they made one, else the system's. */
export function resolveTheme(stored: Theme | null, systemDark: boolean): Theme {
  return stored ?? (systemDark ? "dark" : "light");
}

/** The other theme. */
export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** What the toggle button says and shows for a theme in effect: it names the action, so it changes with the theme. */
export function toggleLabel(theme: Theme): string {
  return `Switch to ${otherTheme(theme)} theme`;
}

/** The parts of the page and browser the theme touches; faked in tests. */
export interface ThemeEnv {
  /** Throws when storage is blocked. */
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  /** Whether the system prefers dark, and a way to hear it change. */
  readonly systemDark: () => boolean;
  readonly onSystemChange: (listener: () => void) => void;
  /** Sets or, with null, removes `data-theme` on the root element. */
  readonly setAttribute: (theme: Theme | null) => void;
  /** Called after every change of the theme in effect, to update the button and `theme-color`. */
  readonly render: (theme: Theme) => void;
}

/**
 * Keeps the theme: the viewer's choice (remembered when storage allows) over the system's preference, which
 * is followed live until a choice is made.
 */
export class ThemeSwitch {
  private chosen: Theme | null = null;

  constructor(private readonly env: ThemeEnv) {
    try {
      this.chosen = parseTheme(env.getItem(THEME_KEY));
    } catch {
      this.chosen = null;
    }
    env.setAttribute(this.chosen);
    env.onSystemChange(() => {
      if (this.chosen === null) env.render(this.current());
    });
    env.render(this.current());
  }

  /** The theme in effect now. */
  current(): Theme {
    return resolveTheme(this.chosen, this.env.systemDark());
  }

  /** Switches to the other theme and remembers the choice. */
  toggle(): void {
    this.chosen = otherTheme(this.current());
    this.env.setAttribute(this.chosen);
    try {
      this.env.setItem(THEME_KEY, this.chosen);
    } catch {
      // The choice then lasts for this visit only.
    }
    this.env.render(this.chosen);
  }
}

/** Wires the toggle button and the `theme-color` metas to the real page. */
export function startTheme(button: HTMLButtonElement, doc: Document, win: Window): void {
  const dark = win.matchMedia("(prefers-color-scheme: dark)");
  const root = doc.documentElement;
  const icons = { sun: button.querySelector(".sun"), moon: button.querySelector(".moon") };
  const metas = doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  const sw = new ThemeSwitch({
    getItem: (key) => win.localStorage.getItem(key),
    setItem: (key, value) => win.localStorage.setItem(key, value),
    systemDark: () => dark.matches,
    onSystemChange: (listener) => dark.addEventListener("change", listener),
    setAttribute: (theme) => (theme === null ? root.removeAttribute("data-theme") : root.setAttribute("data-theme", theme)),
    render: (theme) => {
      const label = toggleLabel(theme);
      button.setAttribute("aria-label", label);
      button.title = label;
      // A sun offers the light theme and shows in the dark one; a moon offers the dark theme.
      icons.sun?.toggleAttribute("hidden", theme !== "dark");
      icons.moon?.toggleAttribute("hidden", theme !== "light");
      const surface = win.getComputedStyle(root).getPropertyValue("--surface").trim();
      for (const meta of metas) meta.content = surface;
    },
  });
  button.addEventListener("click", () => sw.toggle());
}
