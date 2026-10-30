import { maxPlies } from "../engine/constants";
import { botLabel, modelName } from "./bots";
import { type GameController, HUMAN, type Players, type Side, sideOf } from "./controller";

/** A seat in words: "You" for the one person against a bot, "Player 1" for either of two people, "Player 2 (Strong)" for a bot. */
export function playerName(players: Players, side: Side): string {
  const seat = players[side];
  const number = side === "p1" ? 1 : 2;
  if (seat !== HUMAN) return `Player ${number} (${botLabel(seat)})`;
  return players[side === "p1" ? "p2" : "p1"] === HUMAN ? `Player ${number}` : "You";
}

/**
 * The status line under the board, also read out by screen readers: the last
 * move, then whose turn it is or how the game ended and why. `network` says
 * where the network stands ("downloading, 40%") for a bot that waits for it;
 * `subject` names what the bot waits for ("the network", or a gallery model).
 */
export function statusText(controller: GameController, network: string, subject = "the network"): string {
  const players = controller.players;
  const name = (side: Side): string => playerName(players, side);
  const moves = controller.moves;
  const played = moves.length === 0 ? "" : `${name(sideOf(moves.length - 1))} played ${moves[moves.length - 1]}. `;
  const result = controller.result;
  if (result) {
    if (result.reason === "repetition") return `${played}Draw by threefold repetition.`;
    if (result.reason === "cap") return `${played}Draw: the limit of ${maxPlies(controller.size)} moves was reached.`;
    const winner = name(result.winner === "p1" ? "p1" : "p2");
    return `${played}${winner} ${winner === "You" ? "win" : "wins"} by reaching the goal row.`;
  }
  const mover = controller.mover;
  const seat = players[mover];
  if (controller.error !== null) return `${played}${name(mover)} could not move (${controller.error}). Choose Retry.`;
  if (seat === HUMAN) return `${played}${name(mover) === "You" ? "Your move." : `${name(mover)} to move.`}`;
  if (controller.thinking) return `${played}${name(mover)} is thinking (${seat.engine === "network" ? "neural network" : "heuristic search"}).`;
  if (controller.waiting) return `${played}${name(mover)} is waiting for ${subject} (${network}).`;
  if (!controller.hasHuman && !controller.running) return moves.length === 0 ? "Choose Start to watch the bots play." : `${played}Paused.`;
  return `${played}${name(mover)} moves next.`;
}

/** The move list as rows of one move per player: `[["e2", "e8"], ["e3"]]`. */
export function moveRows(moves: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push(moves.slice(i, i + 2));
  return rows;
}

/** Whether two bots are playing on by themselves. */
export function botsArePlaying(controller: Pick<GameController, "hasHuman" | "running">): boolean {
  return !controller.hasHuman && controller.running;
}

/**
 * Whether the status line should stay quiet for screen readers: two bots playing on by themselves change it
 * with every move, which would drown out everything else. It stays quiet once such a game is over, because the
 * end of the game is announced once, separately; otherwise the final text would be read twice.
 */
export function statusIsMuted(controller: Pick<GameController, "hasHuman" | "running" | "result">): boolean {
  return botsArePlaying(controller) || (!controller.hasHuman && controller.result !== null);
}

/**
 * The note under a seat: who plays it, or that its bot is thinking or waiting. `toMove` says it is this seat's turn on the latest position;
 * `network` says where the network, or the gallery model with that id, stands.
 */
export function seatNote(controller: GameController, side: Side, toMove: boolean, network: (modelId: string | null) => string): string {
  const players = controller.players;
  if (players[side] === HUMAN) return playerName(players, side) === "You" ? "You play this side." : "A person plays this side.";
  if (toMove && controller.thinking) return "Thinking…";
  if (toMove && controller.waiting) {
    return controller.waitingModel === null
      ? `Waiting for the network: ${network(null)}.`
      : `Waiting for ${modelName(controller.waitingModel)}: ${network(controller.waitingModel)}.`;
  }
  return "";
}
