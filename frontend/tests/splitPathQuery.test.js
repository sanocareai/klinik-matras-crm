// Tes P8.1 (UI & Navigation Consolidation) — pemisah query string dipakai
// resolveEntryPath() supaya menu "Riwayat" (?tab=work-order&status=DELIVERED)
// tidak jatuh ke fallback "/portal". Lihat src/lib/splitPathQuery.js.
import test from "node:test";
import assert from "node:assert/strict";

import { splitPathQuery } from "../src/lib/splitPathQuery.js";

test("path tanpa query: search kosong, base apa adanya", () => {
  assert.deepEqual(splitPathQuery("/bengkel/production-v2"), { base: "/bengkel/production-v2", search: "" });
});

test("path dengan query: base dan search terpisah, tanda tanya ikut search", () => {
  assert.deepEqual(
    splitPathQuery("/bengkel/order-produksi?tab=work-order&status=DELIVERED"),
    { base: "/bengkel/order-produksi", search: "?tab=work-order&status=DELIVERED" },
  );
});

test("path root dengan query", () => {
  assert.deepEqual(splitPathQuery("/?x=1"), { base: "/", search: "?x=1" });
});
