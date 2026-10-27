/** What a strength level asks of the engine (design doc section 8). */
export interface Level {
  readonly id: "beginner" | "normal" | "strong" | "max";
  readonly label: string;
  /** Which evaluator searches: the heuristic needs no download, the network does. */
  readonly engine: "heuristic" | "network";
  readonly simulations: number;
  /** 0 plays the most visited move; above 0 samples among the searched moves. */
  readonly temperature: number;
}

/**
 * Beginner samples among the five simulations' moves, so it varies from game
 * to game; the others play the most visited move.
 */
export const LEVELS: readonly Level[] = [
  { id: "beginner", label: "Beginner", engine: "heuristic", simulations: 5, temperature: 1 },
  { id: "normal", label: "Normal", engine: "heuristic", simulations: 100, temperature: 0 },
  { id: "strong", label: "Strong", engine: "network", simulations: 32, temperature: 0 },
  { id: "max", label: "Max", engine: "network", simulations: 200, temperature: 0 },
];

/** What a level plays with, in words: "Neural network, 32 searches a move". */
export function levelSummary(level: Level): string {
  return `${level.engine === "network" ? "Neural network" : "Heuristic"}, ${level.simulations} searches a move${level.temperature > 0 ? ", varied" : ""}`;
}

/** Whether the level can be played now: a network level needs a model that has been loaded. */
export function isAvailable(level: Level, modelReady: boolean): boolean {
  return level.engine === "heuristic" || modelReady;
}
