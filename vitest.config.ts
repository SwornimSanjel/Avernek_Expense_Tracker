import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the server-side libraries (money, financial summaries, the AI
// tool layer). Run by `npm test`, which the Docker `verify` stage runs in CI.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
