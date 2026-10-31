// Checks that editing the players never moves the game's main controls, and takes screenshots.
//
// Drives a headless Chromium-family browser (Edge or Chrome) over the DevTools protocol against a
// running copy of the site, at 1440, 1280, 1024, 768, 390 and 320 px wide, in the light and the dark theme. In each, it
// seats two bots, then changes every control of both seats in turn (each option of each select,
// each checkbox both ways, each slider step, each disclosure open and shut), Swap sides, and the
// View menu, and measures Start, Step, the board and the eval bar after every change. Any move of
// more than half a pixel fails the run, and so does the page growing wider than the window. Then it
// steps two Beginners through their first moves and checks that neither the controls nor the move list
// and the cards after it move as the moves come in, and plays two Beginners with auto-play on and checks
// the controls during the countdown to the next game.
// Where the board's column stays in view (a wide, tall window), it scrolls the column beside the
// board from top to bottom and fails if the board or its controls leave the window at any step. It
// opens the View menu with the controls at the top and at the bottom of the window and fails if the
// menu crosses an edge of the window. Last, in the light theme, it loads the page with 12 games kept
// and fails if any word on the page is broken across two lines or a games cell is narrower than its text.
//
// Usage:
//   npm run build && npx vite preview --port 4318 --strictPort   (in another terminal)
//   node scripts/layout-probe.mjs http://127.0.0.1:4318/quoridor/ [--shots DIR] [--browser PATH] [--port N]
//
// The browser defaults to Edge's usual Windows path; set --browser (or BROWSER) elsewhere.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDTHS = [
  { width: 1440, height: 900, mobile: false },
  { width: 1280, height: 800, mobile: false },
  { width: 1024, height: 768, mobile: false },
  { width: 768, height: 1024, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 320, height: 700, mobile: true },
];
const THEMES = ["light", "dark"];
/** The controls that must not move, by id. Start and Step are measured only while shown (two bots). */
const WATCHED = ["toggle", "step", "board", "eval"];
/** What must not move as the first moves of a game come in: the controls, and the move list and the cards after it. */
const FIRST_MOVES_WATCHED = [...WATCHED, "moves", "auto", "about"];
const TOLERANCE = 0.5;

const args = process.argv.slice(2);
const option = (/** @type {string} */ name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const shotsDir = option("--shots");
const browserPath = option("--browser") ?? process.env.BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = Number(option("--port") ?? 9333);
const url = args[0];
if (url === undefined) {
  console.error("usage: node scripts/layout-probe.mjs URL [--shots DIR] [--browser PATH] [--port N]");
  process.exit(2);
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal DevTools protocol client over one page target. */
class Page {
  /** @param {WebSocket} socket */
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
    this.waiting = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.waiting.get(message.id);
      if (pending === undefined) return;
      this.waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  /**
   * Sends one protocol command and waits for its result.
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    const id = this.next++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} got no answer in 3 minutes`));
      }, 180_000);
      this.waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /**
   * Evaluates an expression in the page and returns its value (awaiting a promise).
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`in page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  }
}

/** Starts the browser and opens one page target. */
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "layout-probe-"));
  // No scroll bar takes room: a whole-page screenshot lays the page out for a moment without one, and a measurement
  // taken just after it would see the page a scroll bar wider.
  const browser = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let tries = 0; tries < 100 && target === null; tries++) {
    await sleep(100);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      if (response.ok) target = await response.json();
    } catch {
      // Not listening yet.
    }
  }
  if (target === null) throw new Error(`no browser answered on port ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const close = async () => {
    socket.close();
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
    // The profile can stay locked for a moment after the browser exits; a leftover temporary folder is not worth failing over.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.log(`layout-probe: could not remove ${profile}`);
    }
  };
  return { page: new Page(socket), close };
}

/** The page-side half of the probe: helpers, then the edits, run in the page with `await`. */
const IN_PAGE = String.raw`
const MEASURED = ${JSON.stringify(FIRST_MOVES_WATCHED)};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => {
  await pause(120);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
const shown = (el) => el !== null && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const measure = () => Object.fromEntries(MEASURED.map((id) => {
  const el = document.getElementById(id);
  if (!shown(el)) return [id, null];
  const r = el.getBoundingClientRect();
  return [id, [r.x + scrollX, r.y + scrollY, r.width, r.height]];
}).concat([["wide", document.documentElement.scrollWidth - innerWidth]]));
const usable = (el) => shown(el) && !el.disabled && el.closest("[hidden]") === null;
const label = (el) => el.id || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30);
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
`;

/** Seats a bot on both sides: the first option of each seat's first select that is not Human. */
const SEAT_BOTS = `(async () => {
  ${IN_PAGE}
  for (const side of ["p1", "p2"]) {
    const select = document.querySelector("#seat-" + side + " select");
    const bot = [...select.options].find((o) => o.value !== "human" && !o.disabled);
    select.value = bot.value;
    fire(select, "change");
    await settle();
  }
  await settle();
  return measure();
})()`;

/** Changes every control of both seats, then Swap sides and the View menu, measuring after each change. */
const EDIT_ALL = `(async () => {
  ${IN_PAGE}
  const records = [];
  const record = async (what) => {
    window.probeAt = what;
    await settle();
    records.push({ what, at: measure() });
  };
  const controlsOf = (side) => [...document.querySelectorAll("#seat-" + side + " select, #seat-" + side + " input, #seat-" + side + " summary")].filter(usable);
  for (const side of ["p1", "p2"]) {
    // Every disclosure open first, so the controls inside them are changed too.
    for (const details of document.querySelectorAll("#seat-" + side + " details")) details.open = true;
    await record(side + ": disclosures opened");
    for (const control of controlsOf(side)) {
      if (!usable(control)) continue;
      const name = side + ":" + label(control);
      if (control instanceof HTMLSelectElement) {
        const start = control.value;
        for (const value of [...control.options].filter((o) => !o.disabled).map((o) => o.value)) {
          if (!usable(control)) break;
          control.value = value;
          fire(control, "change");
          await record(name + "=" + value);
        }
        if (usable(control)) {
          control.value = start;
          fire(control, "change");
          await record(name + " back");
        }
      } else if (control.type === "checkbox") {
        control.click();
        await record(name + " toggled");
        control.click();
        await record(name + " back");
      } else if (control.type === "range") {
        const start = control.value;
        for (let v = Number(control.min); v <= Number(control.max); v++) {
          control.value = String(v);
          fire(control, "input");
          fire(control, "change");
          await record(name + "=" + v);
        }
        control.value = start;
        fire(control, "input");
        fire(control, "change");
        await record(name + " back");
      } else if (control.tagName === "SUMMARY") {
        control.click();
        await record(name + " opened");
        control.click();
        await record(name + " closed");
      }
    }
  }
  const swap = document.getElementById("swap");
  swap.click();
  await record("swap");
  swap.click();
  await record("swap back");
  const view = document.querySelector("#view summary");
  if (view !== null) {
    view.click();
    await record("view menu opened");
    for (const box of document.querySelectorAll("#view input[type=checkbox]")) {
      if (!usable(box)) continue;
      box.click();
      await record("view: " + label(box) + " toggled");
      box.click();
      await record("view: " + label(box) + " back");
    }
    view.click();
    await record("view menu closed");
  }
  return records;
})()`;

/** Two Beginners, measured on the empty board and after each of their first three moves, played with Step. */
const FIRST_MOVES = `(async () => {
  ${IN_PAGE}
  for (const side of ["p1", "p2"]) {
    const select = document.getElementById("player-" + side);
    select.value = "beginner";
    fire(select, "change");
  }
  document.getElementById("new").click();
  await settle();
  const before = measure();
  const after = [];
  for (let move = 1; move <= 3; move++) {
    document.getElementById("step").click();
    const started = Date.now();
    while (document.querySelectorAll("#moves [data-ply]").length < move && Date.now() - started < 30000) await pause(50);
    await settle();
    after.push({ moves: document.querySelectorAll("#moves [data-ply]").length, at: measure() });
  }
  return { before, after };
})()`;

/** Two Beginners at instant speed with auto-play on, measured before Start and during the countdown to the next game. */
const COUNTDOWN = `(async () => {
  ${IN_PAGE}
  for (const side of ["p1", "p2"]) {
    const select = document.getElementById("player-" + side);
    select.value = "beginner";
    fire(select, "change");
  }
  const speed = document.getElementById("speed");
  speed.value = "instant";
  fire(speed, "change");
  const auto = document.getElementById("auto-on");
  if (!auto.checked) auto.click();
  await settle();
  const before = measure();
  const toggle = document.getElementById("toggle");
  toggle.click();
  const started = Date.now();
  while (!/Next game/.test(toggle.textContent) && Date.now() - started < 90000) await pause(50);
  await settle();
  const during = measure();
  const shownLabel = toggle.textContent;
  document.getElementById("auto-cancel").click();
  if (auto.checked) auto.click();
  return { before, during, label: shownLabel };
})()`;

/** Where the board's column is sticky: scrolls the page through the game area and reports the board and the column at each step. */
const SCROLL = `(async () => {
  ${IN_PAGE}
  const play = document.querySelector(".play");
  if (getComputedStyle(play).position !== "sticky") return null;
  const last = Math.max(0, document.querySelector(".arena").getBoundingClientRect().bottom + scrollY - innerHeight);
  const steps = [];
  for (const share of [0, 0.25, 0.5, 0.75, 1]) {
    scrollTo(0, Math.round(last * share));
    await settle();
    const board = document.getElementById("board").getBoundingClientRect();
    const column = play.getBoundingClientRect();
    steps.push({ scrollY: Math.round(scrollY), board: [Math.round(board.top), Math.round(board.bottom)], column: [Math.round(column.top), Math.round(column.bottom)], inView: board.top >= 0 && column.top >= 0 && column.bottom <= innerHeight });
  }
  scrollTo(0, 0);
  await settle();
  return { window: innerHeight, steps };
})()`;

/** The View menu opened with its control at the top of the window, then at the bottom: where the menu lands each time. */
const VIEW_MENU = `(async () => {
  ${IN_PAGE}
  const view = document.getElementById("view");
  const pop = document.getElementById("view-pop");
  const places = [];
  for (const block of ["start", "end"]) {
    view.scrollIntoView({ block });
    await settle();
    view.querySelector("summary").click();
    await settle();
    const r = pop.getBoundingClientRect();
    places.push({ block, top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= innerHeight });
    view.querySelector("summary").click();
    await settle();
  }
  scrollTo(0, 0);
  await settle();
  return places;
})()`;

/** Games kept for the text check: enough that the Games card shows its first page of rows, with the longest names. */
const KEPT_GAMES = JSON.stringify({
  v: 1,
  games: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    size: [9, 7, 11][i % 3],
    p1: i % 4 === 0 ? { kind: "human" } : { kind: "bot", engine: "heuristic", simulations: 1600, vary: true },
    p2: { kind: "bot", engine: "network", simulations: 32, vary: false },
    winner: i % 2 ? "p1" : "p2",
    reason: "goal",
    moves: "e2.e8.e3.e7",
    seatChanged: i === 5,
  })),
});

/** Words broken across two lines anywhere on the page, and games cells narrower than their text. */
const TEXT_CHECK = `(() => {
  const broken = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || parent.closest("svg, script, style, .sr-only") !== null || parent.getClientRects().length === 0) continue;
    // The table's header row, kept for screen readers in a 1px box while the games are blocks.
    const head = parent.closest("thead");
    if (head !== null && getComputedStyle(head).position === "absolute") continue;
    for (const word of node.textContent.matchAll(/[^\\s\\-\\u2013\\u2014/]{2,}/g)) {
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.bottom)));
      if (lines.size > 1) broken.push(word[0] + " (" + (parent.id || parent.className || parent.tagName) + ")");
    }
  }
  const shownHead = (el) => el.closest("thead") === null || getComputedStyle(el.closest("thead")).position !== "absolute";
  const cells = [...document.querySelectorAll("#games th, #games td, #games a")].filter((el) => el.getClientRects().length > 0 && shownHead(el) && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim().slice(0, 30));
  return { broken, cells, games: document.querySelectorAll("#games-rows tr").length, table: getComputedStyle(document.querySelector(".games-table thead")).position !== "absolute" };
})()`;

/**
 * Loads the page fresh at a width and theme, waiting for the service worker's one reload and the first drawing.
 * @param {Page} page
 * @param {{width: number, height: number, mobile: boolean}} size
 * @param {string} theme
 */
async function load(page, { width, height, mobile }, theme) {
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await page.send("Page.navigate", { url });
  await sleep(2500);
  for (let tries = 0; tries < 100; tries++) {
    const ready = await page.evaluate(`document.readyState === "complete" && document.querySelector("#board *") !== null`).catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  // Long enough for the network to load from the local server, so its status lines have settled.
  await sleep(2000);
}

/**
 * Saves a screenshot of the whole page.
 * @param {Page} page
 * @param {string} name
 */
async function shoot(page, name) {
  if (shotsDir === undefined) return;
  const { cssContentSize } = await page.send("Page.getLayoutMetrics");
  const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
}

/** @typedef {Record<string, number[] | null>} Rects */

/**
 * The largest move of each watched element between `before` and `after`, where both show it.
 * @param {Rects} before
 * @param {Rects} after
 * @param {string[]} [ids] the elements compared: the controls unless given
 * @returns {Record<string, number>}
 */
function moved(before, after, ids = WATCHED) {
  /** @type {Record<string, number>} */
  const found = {};
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    if (!a || !b) continue;
    const delta = Math.max(...a.map((value, i) => Math.abs(value - (b[i] ?? 0))));
    if (delta > TOLERANCE) found[id] = Math.round(delta * 10) / 10;
  }
  return found;
}

async function main() {
  if (shotsDir !== undefined) mkdirSync(shotsDir, { recursive: true });
  const { page, close } = await launch();
  let failures = 0;
  try {
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    for (const size of WIDTHS) {
      for (const theme of THEMES) {
        const tag = `${size.width}-${theme}`;
        await load(page, size, theme);
        await shoot(page, `${tag}-default`);
        const baseline = await page.evaluate(SEAT_BOTS);
        await shoot(page, `${tag}-two-bots`);
        /** @type {{what: string, at: Rects}[]} */
        const records = await page.evaluate(EDIT_ALL).catch(async (error) => {
          const at = await page.evaluate("window.probeAt").catch(() => "?");
          throw new Error(`${tag}: ${error.message}, after "${at}"`);
        });
        await shoot(page, `${tag}-settings-open`);
        /** @type {{before: Rects, after: {moves: number, at: Rects}[]}} */
        const first = await page.evaluate(FIRST_MOVES);
        const firstMoved = first.after.map((step) => moved(first.before, step.at, FIRST_MOVES_WATCHED)).filter((found) => Object.keys(found).length > 0);
        const played = first.after.at(-1)?.moves ?? 0;
        console.log(`${tag}: first moves ${played === 3 ? "played (3)" : `NOT all played (${played})`}; ${firstMoved.length === 0 ? "nothing moved" : `moved ${JSON.stringify(firstMoved)}`}`);
        failures += played === 3 && firstMoved.length === 0 ? 0 : 1;
        const countdown = await page.evaluate(COUNTDOWN);
        const countdownMoved = moved(countdown.before, countdown.during);
        const reached = /Next game/.test(countdown.label);
        console.log(`${tag}: auto-play countdown ${reached ? `reached ("${countdown.label}")` : "NOT reached"}; ${Object.keys(countdownMoved).length === 0 ? "nothing moved" : `moved ${JSON.stringify(countdownMoved)}`}`);
        failures += reached && Object.keys(countdownMoved).length === 0 ? 0 : 1;
        const bad = records.map((entry) => ({ what: entry.what, moved: moved(baseline, entry.at) })).filter((entry) => Object.keys(entry.moved).length > 0);
        const shownStart = records.filter((entry) => entry.at.toggle !== null).length;
        const wide = records.filter((entry) => Number(entry.at["wide"]) > 0).map((entry) => entry.what);
        if (wide.length > 0) console.log(`  the page became wider than the window after: ${wide.join(", ")}`);
        failures += wide.length;
        console.log(`${tag}: ${records.length} edits, Start shown in ${shownStart}; ${bad.length === 0 ? "nothing moved" : `${bad.length} moved something`}`);
        for (const entry of bad.slice(0, 12)) console.log(`  ${entry.what}: ${JSON.stringify(entry.moved)}`);
        if (bad.length > 12) console.log(`  ... and ${bad.length - 12} more`);
        failures += bad.length;
        /** @type {{window: number, steps: {scrollY: number, board: number[], column: number[], inView: boolean}[]} | null} */
        const scroll = await page.evaluate(SCROLL);
        if (scroll === null) {
          console.log(`${tag}: the board's column is not sticky here`);
        } else {
          const out = scroll.steps.filter((step) => !step.inView);
          const steps = scroll.steps.map((step) => `${step.scrollY}: board ${step.board.join("-")}, column ${step.column.join("-")}`).join("; ");
          console.log(`${tag}: scrolling the ${scroll.window}px window, ${out.length === 0 ? "the board and its controls stayed in view" : `${out.length} steps left them out of view`} (${steps})`);
          failures += out.length;
        }
        /** @type {{block: string, top: number, bottom: number, inView: boolean}[]} */
        const menu = await page.evaluate(VIEW_MENU);
        const offScreen = menu.filter((place) => !place.inView);
        console.log(`${tag}: the View menu ${offScreen.length === 0 ? "opened inside the window" : "crossed an edge of the window"} (${menu.map((place) => `controls at the ${place.block}: ${place.top} to ${place.bottom}`).join("; ")})`);
        failures += offScreen.length;
        if (theme === "light") {
          await page.evaluate(`localStorage.setItem("quoridor.history.v1", ${JSON.stringify(KEPT_GAMES)})`);
          await load(page, size, theme);
          /** @type {{broken: string[], cells: string[], games: number, table: boolean}} */
          const text = await page.evaluate(TEXT_CHECK);
          await shoot(page, `${tag}-games`);
          console.log(`${tag}: ${text.games} games shown ${text.table ? "as a table" : "as blocks"}; ${text.broken.length === 0 ? "no word broken across lines" : `broken words ${JSON.stringify(text.broken.slice(0, 8))}`}; ${text.cells.length === 0 ? "no cell narrower than its text" : `cells narrower than their text ${JSON.stringify(text.cells.slice(0, 8))}`}`);
          failures += (text.games >= 10 ? 0 : 1) + text.broken.length + text.cells.length;
        }
      }
    }
  } finally {
    await close();
  }
  if (failures > 0) {
    console.error(`layout-probe: ${failures} checks failed`);
    process.exit(1);
  }
  console.log("layout-probe: ok");
}

await main();
