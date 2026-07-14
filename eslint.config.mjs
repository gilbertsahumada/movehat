import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/build/**",
      "**/node_modules/**",
      "packages/movehat/src/templates/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/movehat/src/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-control-regex": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "packages/movehat/src/**/__tests__/**/*.ts",
      "packages/movehat/src/**/*.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
