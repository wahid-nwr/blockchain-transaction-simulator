import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup.ts'],
        env: { NODE_ENV: 'test' },
        testTimeout: 30000,

        exclude: ['node_modules/**', 'test/e2e/**'],

        pool: 'forks',
        fileParallelism: false,
        sequence: {
            concurrent: false,
        },
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },

        // ...
    },
});
