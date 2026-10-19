import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/*.d.ts",
      ".codegraph/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^@gestaloka/(?!contracts(?:/|$))|(?:^|/)(?:packages/server|apps/(?:api|worker))(?:/|$)|^node:|^(?:pg|pg-boss|neo4j-driver|@langchain/)(?:/|$)",
              message:
                "ブラウザーと公開契約からサーバー内部へ依存しないでください。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
);
