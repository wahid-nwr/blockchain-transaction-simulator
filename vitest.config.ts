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
        coverage:{
            provider:"v8",
            reporter:[
                "text",
                "html"
            ],
            thresholds:{
                lines:80,
                functions:80,
                branches:70,
                statements:80
            },
            exclude:[
                "scripts/**",
                "src/blockchain/**",
                "src/index.ts",
                "src/api/server.ts",
                "**/*.config.ts",
                "src/common/errors/**",
                "src/api/plugins/**",
                "src/api/schemas/**",
                "src/database/check.ts",
                "test/**"
            ]
        }
    }
});