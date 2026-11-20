import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@opennextjs/cloudflare": path.resolve(import.meta.dirname, "tests/helpers/opennext-stub.ts"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30000 },
});
