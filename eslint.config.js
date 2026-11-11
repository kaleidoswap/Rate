import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

// Mirrors the web extension's config (the house standard), calibrated for a
// codebase that has never been linted: every diagnostic that is not a
// hook violation or a Node script scoping issue starts as a warning, so
// `pnpm lint` passes from day one while the warning list is the worklist.
// `pnpm lint:strict` is the zero-warning budget the extension runs under;
// the app adopts it when the ratchet has done its work.
export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "coverage",
      "dist",
      // Expo prebuild output — generated, never linted.
      "ios/**",
      "android/**",
      ".expo/**",
      // Vendored native modules and bundled artifacts.
      "modules/**",
      "skills.bundle.json",
      // Bundled Mind/QVAC previews and generated audit output.
      "preview/**",
      "output/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // `cond && side()` and `cond ? a() : b()` are idiomatic in the app;
      // flag the rest (standalone expressions that do nothing).
      "@typescript-eslint/no-unused-expressions": [
        "warn",
        { allowShortCircuit: true, allowTernary: true },
      ],
      "@typescript-eslint/no-require-imports": "warn",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-prototype-builtins": "warn",
      "prefer-const": "warn",
      "no-async-promise-executor": "warn",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-cond-assign": "warn",
      "no-fallthrough": "warn",
      "no-func-assign": "warn",
      "no-useless-assignment": "warn",
    },
  },
  {
    // Plain-JS tooling: build scripts, mocks, test setup, Metro/Babel/Jest
    // configs. These run under Node (or Jest's environment) and legitimately
    // use require() and Node globals.
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  prettier,
);
