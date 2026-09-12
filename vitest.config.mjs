import { defineConfig } from "vitest/config";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 35000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
