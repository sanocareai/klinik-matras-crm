// Kegagalan infrastruktur DB (P2028/P2024) = 503 + kode stabil, BUKAN konflik bisnis 409 dan bukan 500 bocor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adalahGalatInfraDb, kirimGalatInfraDb, KODE_DB_SIBUK } from "../src/lib/dbInfraError.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

function resPalsu() {
  const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}

test("P2028 dan P2024 dikenali sebagai galat infrastruktur; konflik bisnis tidak", () => {
  assert.ok(adalahGalatInfraDb({ code: "P2028" }));
  assert.ok(adalahGalatInfraDb({ code: "P2024" }));
  assert.ok(!adalahGalatInfraDb({ code: "P2002" }));
  assert.ok(!adalahGalatInfraDb({ code: "P2010", meta: { code: "55P03" } }));
  assert.ok(!adalahGalatInfraDb(null));
});

test("Respons: 503, kode stabil, pesan Bahasa Indonesia, Retry-After", () => {
  const r = resPalsu();
  const log = console.error; console.error = () => {};
  try { kirimGalatInfraDb(r, Object.assign(new Error("Transaction API error: x"), { code: "P2028" }), "[uji]"); } finally { console.error = log; }
  assert.equal(r.code, 503);
  assert.equal(r.body.code, KODE_DB_SIBUK);
  assert.equal(KODE_DB_SIBUK, "DB_TRANSAKSI_TIMEOUT");
  assert.match(r.body.error, /coba lagi/i);
  assert.equal(r.headers["Retry-After"], "3");
});

test("Tidak ada rute yang memetakan P2028 ke 409 lagi", () => {
  for (const f of ["routes/armada.js", "routes/incentivePayout.js", "routes/incentiveSnapshot.js", "routes/finance.js"]) {
    const s = src(f);
    assert.ok(!/P2028[^\n]*\n[^\n]*status\(409\)/.test(s), `${f} masih memetakan P2028 ke 409`);
    assert.match(s, /adalahGalatInfraDb/);
  }
});

test("handleFinanceError: P2028 -> 503 (bukan 500 yang membocorkan pesan Prisma)", async () => {
  const { handleFinanceError } = await import("../src/routes/finance.js");
  const r = resPalsu();
  const log = console.error; console.error = () => {};
  try { handleFinanceError(Object.assign(new Error("Unable to start a transaction in the given time."), { code: "P2028" }), r); } finally { console.error = log; }
  assert.equal(r.code, 503);
  assert.equal(r.body.code, "DB_TRANSAKSI_TIMEOUT");
  assert.ok(!/Prisma|Unable to start/.test(r.body.error));
});
