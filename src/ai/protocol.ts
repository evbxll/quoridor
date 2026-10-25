/** Which evaluator the worker searches with. */
export type EngineSpec = { readonly kind: "heuristic" };

/** Messages from the page to the search worker. Ids are chosen by the page and echoed back. */
export type Request =
  | { readonly type: "configure"; readonly id: number; readonly engine: EngineSpec }
  | {
      readonly type: "search";
      readonly id: number;
      readonly size: number;
      /** The whole game so far in standard notation. The worker keeps its tree when this extends the last search's moves. */
      readonly moves: readonly string[];
      readonly simulations: number;
      /** 0 plays the most visited move; above 0 samples in proportion to `visits ** (1 / temperature)`. */
      readonly temperature: number;
      readonly seed: number;
      readonly cPuct?: number;
      readonly fpuReduction?: number;
    }
  | { readonly type: "cancel"; readonly id: number };

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
  | SearchResponse
  | { readonly type: "cancelled"; readonly id: number }
  | { readonly type: "error"; readonly id: number; readonly message: string };
