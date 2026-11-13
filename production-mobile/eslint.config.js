const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  { ignores: ["dist/*", ".expo/*", "node_modules/*", "coverage/*"] },
  // Log hanya lewat src/lib/log.ts (redaksi token/kata sandi).
  { rules: { "no-console": "error" } },
  { files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.js"], languageOptions: { globals: { jest: "readonly" } } },
]);
