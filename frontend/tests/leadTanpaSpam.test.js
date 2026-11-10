// Lead & spam lintas Dashboard ↔ Marketing (10 Nov 2026):
//   New Leads Dashboard = Total lead (+spam) Marketing   (semua customer baru TERMASUK spam; B2B/penjualan karyawan tidak dihitung)
//   Lead tanpa spam Marketing = penyebut Conversion Dashboard (total lead − spam)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leadTanpaSpam, migrasiPilihanKolom, kartuRingkas, rekonLead, KOLOM_AWAL_SUMBER } from "../src/features/laporan/marketingLogic.js";

const baca = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lap = { total: { lead: 67, spam: 13, leadSah: 54, berOrder: 0, membayar: 0, lunas: 0, nilaiOrderSaatIni: 0, uangBersih: 0, berbayar: null }, status: {} };

test("leadTanpaSpam = lead − spam; null bila lead tidak ada", () => {
  assert.equal(leadTanpaSpam({ lead: 67, spam: 13 }), 54);
  assert.equal(leadTanpaSpam({ lead: 4 }), 4);
  assert.equal(leadTanpaSpam(null), null);
});

test("kartu ringkas memuat Lead tanpa spam tepat sesudah Total lead; padanannya = dasar Conversion Dashboard", () => {
  const k = kartuRingkas(lap);
  assert.equal(k[1].id, "leadTanpaSpam"); assert.equal(k[1].nilai, "54"); assert.match(k[1].sub, /13 spam dikeluarkan dari 67 lead/);
  assert.match(k[1].tip, /penyebut\) Conversion di Dashboard/);
  assert.match(k[1].tip, /New Leads Dashboard = Total lead \(termasuk spam\)/);
});

test("angka kartu sama dengan rumus rekonsiliasi traffic (tanpaSpam)", () => {
  assert.equal(rekonLead(lap, { totalLeads: 54, daily: [] }).tanpaSpam, leadTanpaSpam(lap.total));
});

test("tabel sumber: baris total Total lead = New Leads Dashboard, Lead tanpa spam = dasar Conversion", () => {
  const src = baca("../src/features/laporan/components/marketing/TabelSumber.jsx");
  assert.ok(src.includes('case "leadTanpaSpam": return { t: angka(leadTanpaSpam(s))'));
  assert.ok(src.includes('case "lead": return { t: angka(t.lead), sub: "= New Leads Dashboard"'));
  assert.ok(src.includes('case "leadTanpaSpam": return { t: angka(leadTanpaSpam(t)), sub: "= dasar Conversion"'));
  assert.ok(src.includes("migrasiPilihanKolom(v)"));
  const r = baca("../src/features/laporan/components/marketing/RingkasanMarketing.jsx");
  assert.match(r, /id: "leadTanpaSpam", label: "Lead tanpa spam"/);
  assert.match(r, /id: "lead", label: "Total lead", nilai: k\.lead\.nilai, sub: `termasuk \$\{angka\(t\.spam\)\} spam · sama dengan New Leads Dashboard`/);
});

test("kolom awal + migrasi pilihan kolom tersimpan lama", () => {
  assert.ok(KOLOM_AWAL_SUMBER.includes("leadTanpaSpam"));
  assert.deepEqual(migrasiPilihanKolom(["lead", "cpa"]), ["lead", "cpa", "leadTanpaSpam"]);
  assert.deepEqual(migrasiPilihanKolom(["cpa"]), ["cpa"]);
  assert.deepEqual(migrasiPilihanKolom(["lead", "leadTanpaSpam"]), ["lead", "leadTanpaSpam"]);
  assert.equal(migrasiPilihanKolom(null), null);
});

test("Dashboard: New Leads memakai newLeadsTermasukSpam (fallback field lama); Conversion tetap dari lead tanpa spam", () => {
  const src = baca("../src/pages/Dashboard.jsx");
  assert.match(src, /value=\{\(ov\?\.newLeadsTermasukSpam \?\? ov\?\.newCustomers \?\? 0\)/);
  assert.match(src, /delta=\{ov\?\.newLeadsTermasukSpam != null \? ov\?\.growthNewLeadsTermasukSpam : ov\?\.growthCustomers\}/);
  assert.match(src, /TERMASUK chat yang ditandai SPAM/);
  assert.match(src, /const konversi = ov && ov\.totalCustomers > 0\s*\? Math\.round\(\(ov\.customersWithOrders \/ ov\.totalCustomers\) \* 100\)/, "Conversion tidak berubah");
  assert.match(src, /lead tanpa spam order/);
});

test("backend /analytics/overview: field baru aditif — termasuk spam, tanpa B2B; field lama & Conversion tidak berubah", () => {
  const be = baca("../../backend/src/routes/analytics.js");
  const ov = be.slice(be.indexOf('analyticsRouter.get("/overview"'), be.indexOf("analyticsRouter.get(", be.indexOf('analyticsRouter.get("/overview"') + 10));
  assert.match(ov, /newLeadsTermasukSpam, newLeadsTermasukSpamPrev,\n\s*\] = await Promise\.all\(\[/);
  assert.match(ov, /prisma\.customer\.count\(\{ where: \{ \.\.\.custWhere, leadSource: \{ notIn: LEAD_SOURCE_BUKAN_FUNNEL \} \} \}\),\n\s*prevRange \? prisma\.customer\.count\(\{ where: \{ createdAt: prevRange, leadSource: \{ notIn: LEAD_SOURCE_BUKAN_FUNNEL \} \} \}\) : Promise\.resolve\(null\),\n\s*\]\);/);
  assert.match(ov, /newCustomers: totalCustomers,\n\s*totalCustomers,/, "field lama tetap tanpa spam");
  assert.match(ov, /const conversionRateCurr = pctOrNull\(customersWithOrdersCount, totalCustomers\);/, "Conversion tetap tanpa spam");
  assert.match(ov, /growthNewLeadsTermasukSpam: growth\(newLeadsTermasukSpam, newLeadsTermasukSpamPrev\)/);
});
