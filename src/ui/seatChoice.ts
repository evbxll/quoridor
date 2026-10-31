import { type Bot, botOf, type EngineKind, PRESETS, presetOf, withModel } from "./bots";
import { HUMAN, type Player } from "./controller";

/** The value of a seat select's Custom entry for an engine: it names a bot whose settings match no preset of that engine. */
export const CUSTOM: Readonly<Record<EngineKind, string>> = { heuristic: "custom-heuristic", network: "custom-network" };

/** The seat select's groups, in order: the engine, and the presets it offers. */
export const ENGINE_GROUPS: readonly { readonly engine: EngineKind; readonly label: string }[] = [
  { engine: "heuristic", label: "Heuristic" },
  { engine: "network", label: "Neural network" },
];

/** The entry the seat select shows for a player: Human, the bot's preset, or the Custom entry of the bot's engine. */
export function choiceOf(player: Player): string {
  if (player === HUMAN) return HUMAN;
  return presetOf(player)?.id ?? CUSTOM[player.engine];
}

/**
 * The player that choosing an entry of the seat select seats, from the seat's current player.
 *
 * A preset sets the engine, the simulations and the move choice. The network model is kept only from a
 * network bot to a network preset (Strong to Max and back); every other change drops it, so a heuristic
 * bot never carries one, and a network bot chosen from Human or a heuristic plays the main model. A Custom
 * entry only names the current settings, so choosing it changes nothing (null).
 */
export function playerAfterChoice(current: Player, choice: string): Player | null {
  if (choice === HUMAN) return HUMAN;
  const preset = PRESETS.find((candidate) => candidate.id === choice);
  if (preset === undefined) return null;
  const bot = botOf(preset.id);
  const model = current !== HUMAN && current.engine === "network" && bot.engine === "network" ? current.model : undefined;
  return model === undefined ? bot : { ...bot, model };
}

/** What a seat holds: a person or its bot, and the gallery model a network bot searches with (undefined: the main one). */
export interface SeatState {
  readonly human: boolean;
  /** The bot shown when the seat is not a person, without its model. */
  readonly bot: Bot;
  readonly model: string | undefined;
}

/** The seat after choosing an entry of its select, or null for a Custom entry (nothing changes). A person holds no model. */
export function seatAfterChoice(state: SeatState, choice: string): SeatState | null {
  const next = playerAfterChoice(state.human ? HUMAN : withModel(state.bot, state.model), choice);
  if (next === null) return null;
  return next === HUMAN ? { human: true, bot: state.bot, model: undefined } : { human: false, bot: withModel(next, undefined), model: next.model };
}
