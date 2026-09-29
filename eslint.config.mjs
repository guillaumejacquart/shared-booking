import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

/**
 * Garde-fous projet (voir AGENTS.md « Règles de code ») :
 * - promesses jamais flottantes ;
 * - imports de types stricts ;
 * - noms d'identifiants explicites (pas de `b`, `e`, `m`…) ;
 * - complexité et taille bornées sur la couche service ;
 * - couche : seuls les services accèdent à la DAL/DB.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Règles de nommage et d'asynchronisme, sur tout le code applicatif.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  // Noms explicites : exigé sur le cœur métier (services, DAL, lib),
  // signalé en warning sur le reste (dette UI existante à purger).
  {
    files: ["src/lib/**/*.ts", "src/dal/**/*.ts"],
    ignores: ["**/*.test.ts", "src/test/**"],
    rules: {
      "id-length": ["error", { min: 2, properties: "never", exceptions: ["t"] }], // `t()` = i18n
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "src/test/**", "src/lib/**/*.ts", "src/dal/**/*.ts"],
    rules: {
      "id-length": ["warn", { min: 2, properties: "never", exceptions: ["t"] }],
    },
  },

  // Garde-fous de forme sur la logique métier.
  {
    files: ["src/lib/services/**/*.ts", "src/dal/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      complexity: ["error", 12],
      "max-lines-per-function": ["error", { max: 80, skipComments: true }],
    },
  },

  // Couche : pas d'accès runtime à la DAL/DB hors des services.
  // (Pages RSC : lecture seule tolérée ; `auth.ts`, `dashboard.ts` et
  // `google-sync.ts` sont des points d'accès documentés, voir AGENTS.md.)
  {
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/app/**/route.ts",
      "src/app/**/actions.ts",
      "src/lib/**/*.ts",
    ],
    ignores: [
      "**/*.test.ts",
      "src/lib/services/**",
      "src/lib/auth.ts",
      "src/lib/dashboard.ts",
      "src/lib/google-sync.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/dal/*", "@/db/*"],
              message:
                "Seuls les services (src/lib/services) accèdent à la DAL/DB. Passer par un service.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
]);

export default tseslint.config(eslintConfig);
