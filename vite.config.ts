import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/quoridor/",
  build: {
    target: "es2022",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
