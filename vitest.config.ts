import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
