// "Lead tanpa spam" (10 Nov 2026): total lead − spam, harus sama dengan New Leads Dashboard (customer baru, SPAM & B2B tidak dihitung).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leadTanpaSpam, migrasiPilihanKolom, kartuRingkas, rekonLead, KOLOM_AWAL_SUMBER } from "../src/features/laporan/marketingLogic.js";

const lap = { total: { lead: 67, spam: 13, leadSah: 54, berOrder: 0, membayar: 0, lunas: 0, nilaiOrderSaatIni: 0, uangBersih: 0, berbayar: null }, status: {} };

test("leadTanpaSpam = lead − spam; null bila lead tidak ada", () => {
  assert.equal(leadTanpaSpam({ lead: 67, spam: 13 }), 54);
  assert.equal(leadTanpaSpam({ lead: 4 }), 4);
  assert.equal(leadTanpaSpam(null), null);
});

test("kartu ringkas memuat Lead tanpa spam tepat sesudah Total lead", () => {
  const k = kartuRingkas(lap);
  assert.equal(k[1].id, "leadTanpaSpam"); assert.equal(k[1].nilai, "54"); assert.match(k[1].sub, /13 spam dikeluarkan dari 67 lead/);
  assert.match(k[1].tip, /New Leads di Dashboard/);
});

test("angka kartu sama dengan rumus rekonsiliasi traffic (tanpaSpam)", () => {
  assert.equal(rekonLead(lap, { totalLeads: 54, daily: [] }).tanpaSpam, leadTanpaSpam(lap.total));
});

test("tabel sumber: sel per sumber dan baris total memakai leadTanpaSpam", () => {
  const src = readFileSync(new URL("../src/features/laporan/components/marketing/TabelSumber.jsx", import.meta.url), "utf8");
  assert.ok(src.includes('case "leadTanpaSpam": return { t: angka(leadTanpaSpam(s))'));
  assert.ok(src.includes('case "leadTanpaSpam": return { t: angka(leadTanpaSpam(t)), sub: "= New Leads Dashboard"'));
  assert.ok(src.includes("migrasiPilihanKolom(v)"));
  const r = readFileSync(new URL("../src/features/laporan/components/marketing/RingkasanMarketing.jsx", import.meta.url), "utf8");
  assert.match(r, /id: "leadTanpaSpam", label: "Lead tanpa spam"/);
});

test("kolom awal + migrasi pilihan kolom tersimpan lama", () => {
  assert.ok(KOLOM_AWAL_SUMBER.includes("leadTanpaSpam"));
  assert.deepEqual(migrasiPilihanKolom(["lead", "cpa"]), ["lead", "cpa", "leadTanpaSpam"]);
  assert.deepEqual(migrasiPilihanKolom(["cpa"]), ["cpa"]);
  assert.deepEqual(migrasiPilihanKolom(["lead", "leadTanpaSpam"]), ["lead", "leadTanpaSpam"]);
  assert.equal(migrasiPilihanKolom(null), null);
});

test("tooltip Dashboard menyebut padanannya di Marketing", () => {
  const src = readFileSync(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
  assert.match(src, /Lead tanpa spam/);
});
