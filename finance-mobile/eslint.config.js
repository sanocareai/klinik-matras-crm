const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// Uang di klien adalah STRING desimal (lihat src/lib/money.ts). Aturan di bawah
// mencegah aritmetika float menyelinap ke angka keuangan — server tetap sumber
// kebenaran, klien hanya menampilkan.
const PESAN = "Jangan hitung uang di klien dengan Number/parseFloat/toFixed — pakai string desimal (src/lib/money.ts). Angka resmi datang dari server.";

module.exports = defineConfig([
  expoConfig,
  { ignores: ["dist/*", ".expo/*", "node_modules/*", "coverage/*"] },
  {
    rules: {
      // Log hanya lewat src/lib/log.ts (redaksi token/PIN/nominal).
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='parseFloat']", message: PESAN },
        { selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']", message: PESAN },
        { selector: "CallExpression[callee.property.name='toFixed']", message: PESAN },
        {
          selector: "CallExpression[callee.name='Number'] > Identifier[name=/(amount|nominal|saldo|total|nilai|sisa|harga|balance|money|laba|beban)/i]",
          message: PESAN,
        },
      ],
    },
  },
  {
    // Tes boleh memakai Number untuk membandingkan hasil (bukan menghitung uang produksi).
    files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.js"],
    rules: { "no-restricted-syntax": "off" },
    languageOptions: { globals: { jest: "readonly" } },
  },
]);
