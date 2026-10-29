// Times the network and the search in Node (design doc section 10).
//
// Usage: npm run bench -- <model.onnx> [threads] [heuristic]
//
// Run it once per thread count: onnxruntime-web fixes its thread pool when it
// starts. Numbers depend on the machine and on what else is running.

import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { HeuristicEvaluator } from "../src/ai/heuristic";
import { encodeState, INPUT_PLANES } from "../src/ai/encoding";
import type { Evaluator } from "../src/ai/evaluator";
import { Mcts } from "../src/ai/mcts";
import { OnnxEvaluator } from "../src/ai/onnxEvaluator";
import { createOrtNetwork } from "../src/ai/ort";
import { seededRandom } from "../src/ai/random";
import { GameState } from "../src/engine/state";

const SIZES = [5, 7, 9, 11];
const INFERENCES = 100;
const WARMUP = 10;
const SIMULATIONS = 100;
const SEARCHES = 5;

/** Positions from a seeded random game: every ply up to `count` that is not finished. */
function randomPositions(size: number, count: number): GameState[] {
  const random = seededRandom(size);
  const state = GameState.initial(size);
  const positions: GameState[] = [];
  while (positions.length < count && !state.isEnd()) {
    positions.push(state.clone());
    const legal = state.legalActions();
    state.play(legal[Math.floor(random() * legal.length)]!);
  }
  return positions;
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

async function timeSearches(size: number, makeEvaluator: () => Evaluator): Promise<string> {
  const starts = randomPositions(size, SEARCHES * 8).filter((_, i) => i % 8 === 0);
  let seconds = 0;
  for (const start of starts) {
    const evaluator = makeEvaluator();
    const began = performance.now();
    const mcts = await Mcts.create(evaluator, start);
    await mcts.search(SIMULATIONS);
    seconds += (performance.now() - began) / 1000;
  }
  return `${((starts.length * SIMULATIONS) / seconds).toFixed(0)} simulations/s (${starts.length} searches of ${SIMULATIONS}, fresh cache each)`;
}

async function main(): Promise<void> {
  const [modelPath, threadsText = "1", mode = "network"] = process.argv.slice(2);
  if (!modelPath) throw new Error("usage: npm run bench -- <model.onnx> [threads] [heuristic]");
  const threads = Number(threadsText);
  if (mode === "heuristic") {
    for (const size of SIZES) console.log(`${size}x${size} heuristic: ${await timeSearches(size, () => new HeuristicEvaluator())}`);
    return;
  }
  const network = await createOrtNetwork(ort, readFileSync(modelPath), { threads }, { planes: INPUT_PLANES, fixedSize: null });
  console.log(`onnxruntime-web WASM, ${threads} thread(s), node ${process.version}`);
  for (const size of SIZES) {
    const planes = randomPositions(size, INFERENCES + WARMUP).map((state) => encodeState(state));
    for (const input of planes.slice(0, WARMUP)) await network.infer(input, size);
    const milliseconds: number[] = [];
    for (const input of planes.slice(WARMUP)) {
      const began = performance.now();
      await network.infer(input, size);
      milliseconds.push(performance.now() - began);
    }
    const mean = milliseconds.reduce((a, b) => a + b, 0) / milliseconds.length;
    console.log(`${size}x${size} network: ${median(milliseconds).toFixed(1)} ms median, ${mean.toFixed(1)} ms mean per position`);
    console.log(`${size}x${size} search:  ${await timeSearches(size, () => new OnnxEvaluator(network))}`);
  }
}

await main();
