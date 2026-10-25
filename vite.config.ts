import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/quoridor/",
  // ES module workers can split code, which keeps onnxruntime-web out of the heuristic bot's start-up.
  worker: { format: "es" },
  build: {
    target: "es2022",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
