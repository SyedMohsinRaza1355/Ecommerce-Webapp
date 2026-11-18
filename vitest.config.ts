import { defineConfig } from "vitest/config";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no local env file: integration tests will be reported as skipped
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000 },
});
