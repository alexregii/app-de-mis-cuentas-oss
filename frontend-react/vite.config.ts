import {loadEnv} from "vite";
import {configDefaults, defineConfig} from "vitest/config";
import react from "@vitejs/plugin-react";

const runtime = globalThis as typeof globalThis & {process?: {platform?: string}};
const isWindows = runtime.process?.platform === "win32";

export default defineConfig(({mode}) => {
  const labTests = mode === "ui-lab-test";
  const apiTarget = loadEnv(mode, ".", "").VITE_API_TARGET || "http://127.0.0.1:8000";
  const proxy = {
    "/api": apiTarget,
    "/health/": apiTarget,
    "/adjuntos": apiTarget,
    "/exportar": apiTarget,
  };

  return {
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: "index.html",
        "ui-lab": "ui-lab.html",
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.indexOf("/node_modules/ag-charts-") !== -1) return "statistics-ag-charts";
          if (normalizedId.indexOf("/node_modules/uplot/") !== -1) return "statistics-uplot";
          if (normalizedId.indexOf("/node_modules/lucide-react/") !== -1) return "ui-icons";
        },
      },
    },
  },
  server: {
    proxy,
  },
  preview: {
    proxy,
  },
  test: {
    include: labTests ? ["src/ui-lab/**/*.test.{ts,tsx}"] : configDefaults.include,
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      ...(!labTests ? ["src/ui-lab/**"] : []),
      ...(isWindows ? ["scripts/check-build.test.mjs"] : []),
    ],
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    pool: isWindows ? "vmThreads" : undefined,
    maxWorkers: isWindows ? 8 : 1,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__tests__/**",
        "src/ui-lab/**",
        "src/test-fixtures/**",
        "src/test-setup.ts",
        "src/**/*.d.ts",
        "src/**/*.types.ts",
      ],
      thresholds: {
        statements: 60,
        branches: 74,
        functions: 47,
        lines: 60,
      },
    },
  },
  };
});
