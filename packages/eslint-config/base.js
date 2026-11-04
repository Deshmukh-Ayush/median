import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import turboPlugin from "eslint-plugin-turbo"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

/**
 * Shared ESLint configuration for the repository.
 *
 * Type-aware: every TS file is linted against its nearest tsconfig, so the
 * no-unsafe-* rules can see through `any` that leaks in from libraries.
 * Violations are errors (lint runs with --max-warnings 0 as well).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = defineConfig(
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "error",

      // No `any`, explicit or via `as any`.
      "@typescript-eslint/no-explicit-any": [
        "error",
        { fixToUnknown: true, ignoreRestArgs: false },
      ],
      // No `any` flowing in from untyped values.
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-declaration-merging": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-unsafe-function-type": "error",
      // @ts-ignore / @ts-nocheck are banned; @ts-expect-error needs a reason.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Plain JS config files are not part of any tsconfig.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  eslintConfigPrettier,
  {
    ignores: ["dist/**", ".next/**", ".turbo/**", "coverage/**"],
  }
)
