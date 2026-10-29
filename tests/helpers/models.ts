import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inputOf, parseCard } from "../../src/model/card";
import { parseIndex } from "../../src/model/index";

export interface TestModel {
  readonly id: string;
  /** A folder holding `model.onnx` and `golden.json`. */
  readonly dir: string;
  /** Input planes and fixed board size from the model's `card.json`; 10 and null (a conv net) where there is no card. */
  readonly planes: number;
  readonly fixedSize: number | null;
}

function withCard(id: string, dir: string): TestModel {
  const cardPath = join(dir, "card.json");
  if (!existsSync(cardPath)) return { id, dir, planes: 10, fixedSize: null };
  const { planes, fixedSize } = inputOf(parseCard(JSON.parse(readFileSync(cardPath, "utf8"))));
  return { id, dir, planes, fixedSize };
}

function complete(dir: string): boolean {
  return existsSync(join(dir, "model.onnx")) && existsSync(join(dir, "golden.json"));
}

/**
 * The models the tests can check: the folder `override` names (the
 * `QUORIDOR_TEST_MODEL_DIR` setting), else `test-data/model`, else every
 * model published in `public/models/index.json` under `root` whose files are
 * all there. Empty when there is none.
 */
export function discoverModels(root: string, override: string | undefined): TestModel[] {
  const local = override ?? join(root, "test-data", "model");
  if (complete(local)) return [withCard(override ? "from QUORIDOR_TEST_MODEL_DIR" : "from test-data/model", local)];
  if (override) return [];
  const indexPath = join(root, "public", "models", "index.json");
  if (!existsSync(indexPath)) return [];
  try {
    return parseIndex(JSON.parse(readFileSync(indexPath, "utf8")))
      .models.map((model) => ({ id: model.id, dir: join(root, "public", "models", model.id) }))
      .filter((model) => complete(model.dir))
      .map((model) => withCard(model.id, model.dir));
  } catch {
    return [];
  }
}
