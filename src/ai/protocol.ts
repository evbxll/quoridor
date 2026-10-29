/** The evaluators the worker can search with, by name. */
export type EngineKind = "heuristic" | "network";

/**
 * How to build one evaluator; the worker keeps the heuristic and one session per network, by model id.
 * A network is checked against its card: `planes` is the input planes it takes, and `fixedSize` the one board size
 * of an fc model (null for conv). `asDefault` makes it the network that searches without a `model` use.
 */
export type EngineSpec =
  | { readonly kind: "heuristic" }
  | {
      readonly kind: "network";
      readonly model: ArrayBuffer;
      readonly threads: number;
      readonly modelId: string;
      readonly planes: number;
      readonly fixedSize: number | null;
      readonly asDefault: boolean;
    };

/** The key of an evaluator in the worker: the heuristic, or a network by model id. */
export function slotOf(kind: EngineKind, modelId: string | undefined): string {
  return kind === "heuristic" ? "heuristic" : `network:${modelId ?? ""}`;
}

/** Messages from the page to the search worker. Ids are chosen by the page and echoed back. */
export type Request =
  | { readonly type: "configure"; readonly id: number; readonly engine: EngineSpec }
  | {
      readonly type: "search";
      readonly id: number;
      /** Which configured evaluator searches. */
      readonly engine: EngineKind;
      /** For the network engine, the model to search with; the default network (the one configured `asDefault`) if absent. */
      readonly model?: string;
      readonly size: number;
      /** The whole game so far in standard notation. The worker keeps its tree when this extends the last search's moves. */
      readonly moves: readonly string[];
      readonly simulations: number;
      /** 0 plays the most visited move; above 0 samples in proportion to `visits ** (1 / temperature)`. */
      readonly temperature: number;
      readonly seed: number;
      /** False searches a fresh tree that is not kept, so the answer is from exactly `simulations` and the game's tree is untouched. Default true. */
      readonly reuseTree?: boolean;
      readonly cPuct?: number;
      readonly fpuReduction?: number;
    }
  | { readonly type: "cancel"; readonly id: number }
  /** Frees the session of one network (by model id); a search that names it afterwards is refused until it is configured again. */
  | { readonly type: "release"; readonly id: number; readonly model: string };

/** The answer to a finished search. Per-action arrays follow `moves` (the legal moves at the root). */
export interface SearchResponse {
  readonly type: "result";
  readonly id: number;
  /** The chosen move in standard notation. */
  readonly move: string;
  readonly moves: readonly string[];
  readonly visits: readonly number[];
  /** Mean result over the root visits for the player to move. */
  readonly value: number;
  readonly principalVariation: readonly string[];
}

/** Messages from the search worker to the page. */
export type Response =
  | { readonly type: "configured"; readonly id: number }
  | { readonly type: "released"; readonly id: number }
  | SearchResponse
  | { readonly type: "cancelled"; readonly id: number }
  | { readonly type: "error"; readonly id: number; readonly message: string };
