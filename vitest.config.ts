import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup.ts'],
        env: { NODE_ENV: 'test' },
        testTimeout: 30000,
        pool: 'forks',
        // fileParallelism/sequence.concurrent explicitly false: every test file
        // shares one real Postgres instance via cleanupDatabase() in beforeEach,
        // so files must never run interleaved — singleFork alone controls
        // process count, not scheduling order, and doesn't guarantee this.
        fileParallelism: false,
        sequence: {
            concurrent: false,
        },
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 70,
                statements: 80,
            },
            exclude: [
                'node_modules/**',
                'artifacts/**',
                'src/blockchain/**',
                'src/index.ts',
                'src/api/server.ts',
                '**/*.config.ts',
                'src/types/**',
                'src/api/plugins/**',
                'src/api/schemas/**',
                'src/common/errors/**',
            ],
        },
    },
});
