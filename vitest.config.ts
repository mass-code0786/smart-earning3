import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/releases/**"],
    // Real PostgreSQL suites exercise singleton queues and advisory-lock domains.
    // One isolated test database must not be mutated by multiple files concurrently.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
