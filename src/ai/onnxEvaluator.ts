import type { GameState } from "../engine/state";
import { encodeState } from "./encoding";
import type { Evaluation, Evaluator } from "./evaluator";
import { LruCache } from "./lru";

/** Positions the evaluation cache keeps (design doc section 4.3; about 17 MB of policies on 11x11). */
export const CACHE_POSITIONS = 20_000;

/** A network that evaluates one encoded position: `planes` is `[10, size, size]` float32. */
export interface Network {
  infer(planes: Float32Array, size: number): Promise<Evaluation>;
}

/**
 * Evaluates positions with a network, remembering the answers by position
 * key (the network is a pure function of the position, and the search
 * reaches the same position by different move orders).
 */
export class OnnxEvaluator implements Evaluator {
  private readonly cache: LruCache<Evaluation>;
  private hitCount = 0;
  private missCount = 0;

  constructor(
    private readonly network: Network,
    capacity = CACHE_POSITIONS,
  ) {
    this.cache = new LruCache(capacity);
  }

  /** Evaluations answered from the cache. */
  get hits(): number {
    return this.hitCount;
  }

  /** Evaluations that ran the network. */
  get misses(): number {
    return this.missCount;
  }

  async evaluate(state: GameState): Promise<Evaluation> {
    const key = state.positionKey();
    const cached = this.cache.get(key);
    if (cached) {
      this.hitCount++;
      return cached;
    }
    this.missCount++;
    const planes = encodeState(state);
    const evaluation = await this.network.infer(planes, state.size);
    this.cache.set(key, evaluation);
    return evaluation;
  }
}
