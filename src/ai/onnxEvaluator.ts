import type { GameState } from "../engine/state";
import { encodeState } from "./encoding";
import type { Evaluation, Evaluator } from "./evaluator";
import { LruCache } from "./lru";

/** Positions the evaluation cache keeps (about 17 MB of policies on 11x11). */
export const CACHE_POSITIONS = 20_000;

/** A network that evaluates one encoded position: the input is `[planes, size, size]` float32, where `planes` is the model's own plane count. */
export interface Network {
  /** Planes the model takes (6 or 10); the evaluator encodes that many. */
  readonly planes: number;
  infer(input: Float32Array, size: number): Promise<Evaluation>;
  /** Frees the model's memory; the network is not used afterwards. */
  release?(): Promise<void>;
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

  /** Frees the network's memory when this evaluator is replaced. */
  async dispose(): Promise<void> {
    await this.network.release?.();
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
    const input = encodeState(state, this.network.planes);
    const evaluation = await this.network.infer(input, state.size);
    this.cache.set(key, evaluation);
    return evaluation;
  }
}
