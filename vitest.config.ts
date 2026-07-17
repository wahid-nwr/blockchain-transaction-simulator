import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./test/setup.ts"],
        testTimeout: 30000,
        pool: "forks",
        poolOptions: {
          forks: {
            singleFork: true
          }
        },
        coverage: {
            provider: "v8",
            reporter: [
                "text",
                "html"
            ]
        }
    }
});