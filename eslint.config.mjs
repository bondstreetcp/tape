// ESLint 10 flat config. `npm run lint` fails on ERRORS only — the rules that catch real bugs (hooks
// order, undefined names, unsafe patterns). Style-grade findings are warnings so the first pass over a
// 100k-line codebase is informative rather than a wall. `any` is deliberately NOT a lint rule: it is
// budgeted per directory by tests/anyBudget (a ratchet), which is what makes it go down over time.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      ".next/**", "node_modules/**", "data/**", "lake/**", "public/**", "staples-scans/**",
      "next-env.d.ts", "*.tsbuildinfo", "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2021 } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // budgeted by tests/anyBudget, not linted
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // "degrade, never break" leans on empty catches on purpose; the counted form is lib/scriptKit.swallow
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-console": "off",
      // style-grade rules new in ESLint 10 — informative, not blocking (55 hits on first run, none a bug)
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      // filings carry NBSPs; the regexes that match them are deliberate
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipStrings: true, skipTemplates: true, skipComments: true }],
    },
  },
  {
    // scripts and tests are Node programs: top-level side effects and process.exit are the point
    files: ["scripts/**", "tests/**"],
    rules: { "@next/next/no-img-element": "off" },
  },
);
