import { HeuristicEvaluator } from "./heuristic";
import type { Request, Response } from "./protocol";
import { createSearchService } from "./searchService";

const handle = createSearchService(
  (response: Response) => self.postMessage(response),
  async () => new HeuristicEvaluator(),
);

self.onmessage = (event: MessageEvent<Request>) => handle(event.data);
