import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  test: {
    environment: "node",
    exclude: ["tests/e2e/**", "node_modules/**"],
    testTimeout: 20000,
  },
});
