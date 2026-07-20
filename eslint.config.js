import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    /**
     * Ignore generated files
     */
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'artifacts/**',
            'cache/**',
            '*.config.js',
        ],
    },

    /**
     * JavaScript recommended rules
     */
    {
        files: [
            'scripts/**/*.js',
            'src/**/*.js',
            'test/**/*.js',
        ],

        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    /**
     * TypeScript recommended rules
     */
    ...tseslint.configs.recommended,

    /**
     * Production source code
     */
    {
        files: ['src/**/*.ts'],

        languageOptions: {
            parserOptions: {
                project: './tsconfig.eslint.json',
            },

            globals: {
                ...globals.node,
            },
        },

        rules: {
            '@typescript-eslint/no-explicit-any': 'error',

            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },

    /**
     * Tests
     */
    {
        files: ['test/**/*.ts'],

        languageOptions: {
            parserOptions: {
                project: './tsconfig.eslint.json',
            },

            globals: {
                ...globals.node,
            },
        },

        rules: {
            '@typescript-eslint/no-explicit-any': 'off',

            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
];
