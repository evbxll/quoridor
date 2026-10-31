import { type Bot, fitTo } from "./bots";
import { HUMAN, isOfferedSize, type Player, type Players, type Side } from "./controller";

const SIDES = ["p1", "p2"] as const;
/** A person's seat in the address. */
const PERSON = "p";
const ENGINE_CODES = { heuristic: "h", network: "n" } as const;
/** A bot's seat: engine, simulations, "v" if its moves vary, then "~" and a gallery model's id (the ids `index.json` allows). */
const BOT_CODE = /^([hn])([0-9]{1,6})(v?)(?:~([A-Za-z0-9._-]{1,80}))?$/;

/**
 * A seat as the address writes it: "p" for a person; a bot as its engine ("h" heuristic, "n" neural network), its
 * simulations, "v" if its moves vary, and "~" and the model's id for a gallery model: "n32", "h5v", "n200~some-model".
 */
export function seatCode(player: Player): string {
  if (player === HUMAN) return PERSON;
  return `${ENGINE_CODES[player.engine]}${player.simulations}${player.vary ? "v" : ""}${player.model === undefined ? "" : `~${player.model}`}`;
}

/**
 * Reads a seat code, or null if it is not one. A bot's simulations move to the nearest step offered on a board of
 * `size`, so an address never asks for more than the cap. A heuristic bot with a model is not a seat. Whether the
 * gallery has the model is for the page to check, once it knows the gallery.
 */
export function parseSeat(code: string, size: number): Player | null {
  if (code === PERSON) return HUMAN;
  const found = BOT_CODE.exec(code);
  if (found === null) return null;
  const [, letter, simulations, vary, model] = found;
  const engine = letter === ENGINE_CODES.network ? "network" : "heuristic";
  if (engine === "heuristic" && model !== undefined) return null;
  const bot: Bot = fitTo({ engine, simulations: Number(simulations), vary: vary === "v" }, size);
  return model === undefined ? bot : { ...bot, model };
}

/** The page's address: the game's (`#n=9&m=e2.e8`) with both seats after the board size, `#n=9&p1=p&p2=n32&m=e2.e8`. */
export function addressOf(gameHash: string, players: Players): string {
  const [size = "", ...rest] = gameHash.replace(/^#/, "").split("&");
  return `#${[size, `p1=${seatCode(players.p1)}`, `p2=${seatCode(players.p2)}`, ...rest].join("&")}`;
}

/** The seats an address names: those it names well, and the sides whose seat it names badly (or twice), which are left out. */
export interface LinkSeats {
  readonly seats: Partial<Record<Side, Player>>;
  readonly unreadable: readonly Side[];
}

/** The seats in an address for a board of `size`, or null for an address that names none (an older link, or one opened from the Games card). */
export function seatsOf(hash: string, size: number): LinkSeats | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has("p1") && !params.has("p2")) return null;
  const seats: Partial<Record<Side, Player>> = {};
  const unreadable: Side[] = [];
  for (const side of SIDES) {
    const codes = params.getAll(side);
    const player = codes.length === 1 ? parseSeat(codes[0]!, size) : null;
    if (player === null) unreadable.push(side);
    else seats[side] = player;
  }
  return { seats, unreadable };
}

/** A setup the page keeps between visits: the board size and the seats. */
export interface Setup {
  readonly size: number;
  readonly players: Players;
}

/** A setup as it is kept: the address's own words without the moves, `n=9&p1=p&p2=n32`. */
export const setupText = (setup: Setup): string => addressOf(`#n=${setup.size}`, setup.players).slice(1);

/** Reads a kept setup, or null if it is not one the page offers; a seat it cannot read takes `fallback`'s. */
export function readSetup(text: string | null, fallback: Players): Setup | null {
  if (text === null) return null;
  const sizeText = new URLSearchParams(text).get("n") ?? "";
  const size = /^[0-9]{1,2}$/.test(sizeText) ? Number(sizeText) : 0;
  if (!isOfferedSize(size)) return null;
  const linked = seatsOf(text, size);
  if (linked === null) return null;
  return { size, players: { p1: linked.seats.p1 ?? fallback.p1, p2: linked.seats.p2 ?? fallback.p2 } };
}
