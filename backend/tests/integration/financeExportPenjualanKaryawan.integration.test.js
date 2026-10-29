// EXPORT EXCEL PENJUALAN KARYAWAN (PKR) terhadap PostgreSQL sungguhan + endpoint ASLI. Yang dikunci:
//  - memuat SELURUH hasil filter (524 dokumen) walau layar memotong di 500;
//  - mengikuti periode, status, pencarian, dan karyawan (sama persis dengan daftar layar bila hasil < 500);
//  - TOTAL hanya dokumen AKTIF; dokumen batal = "Dibatalkan — tidak ditagih" (sisa Rp0, nilai historis tetap); pembayaran batal tidak masuk total pembayaran aktif;
//  - kolom sensitif hanya untuk Finance Admin; izin FINANCE_READ; ekspor tidak menulis apa pun.
// Skenario (Rp): Emon (A) — 520 dokumen BELUM_BAYAR @100 (Okt) + P1 LUNAS 200 + P2 SEBAGIAN 300 (bayar 100 aktif + 50 batal) + P3 DIBATALKAN 400 (bayar 150 batal) + P5 (Sep) 700.
//                Kemal (B) — P4 Okt 250 "Kerabat Cari" belum dibayar.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const D = (s) => new Date(`${s}T00:00:00.000Z`);
const OKT = { from: "2026-10-01", to: "2026-10-31" }; const SEP = { from: "2026-09-01", to: "2026-09-30" };
const N = 520;

async function dunia() {
  const emon = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${crypto.randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const kemal = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${crypto.randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const doc = async ({ nomor, date, seller, buyer, total, status = "AKTIF", notes = null, payments = [] }) => {
    const id = crypto.randomUUID();
    await testPrisma.finPenjualanKaryawan.create({ data: { id, nomor, date: D(date), sellerId: seller.id, buyerName: buyer, total, status, notes, ...(status === "DIBATALKAN" && { cancelledAt: new Date("2026-10-20T05:00:00Z"), cancelReason: "uji" }),
      items: { create: [{ name: "Kasur Uji", quantity: 1, unitPrice: total, sortOrder: 0 }] } } });
    for (const p of payments) await testPrisma.finPenjualanKaryawanPayment.create({ data: { penjualanId: id, date: D(p.date ?? date), amount: p.amount, method: p.method ?? "TUNAI", ...(p.batal && { cancelledAt: new Date("2026-10-21T05:00:00Z"), cancelReason: "uji" }) } });
    return id;
  };
  // 520 dokumen massal (createMany agar cepat)
  const ids = Array.from({ length: N }, () => crypto.randomUUID());
  await testPrisma.finPenjualanKaryawan.createMany({ data: ids.map((id, i) => ({ id, nomor: `PKR-MASAL-${String(i + 1).padStart(4, "0")}`, date: D("2026-10-05"), sellerId: emon.id, buyerName: `Pembeli Masal ${i + 1}`, total: 100, status: "AKTIF" })) });
  await testPrisma.finPenjualanKaryawanItem.createMany({ data: ids.map((id) => ({ penjualanId: id, name: "Kasur Masal", quantity: 1, unitPrice: 100, sortOrder: 0 })) });
  const p1 = await doc({ nomor: "PKR-UJI-P1", date: "2026-10-10", seller: emon, buyer: "Pembeli Lunas", total: 200, payments: [{ amount: 200 }] });
  const p2 = await doc({ nomor: "PKR-UJI-P2", date: "2026-10-11", seller: emon, buyer: "Pembeli Sebagian", total: 300, notes: "catatan rahasia", payments: [{ amount: 100 }, { amount: 50, batal: true }] });
  const p3 = await doc({ nomor: "PKR-UJI-P3", date: "2026-10-12", seller: emon, buyer: "Pembeli Batal", total: 400, status: "DIBATALKAN", payments: [{ amount: 150, batal: true }] });
  const p4 = await doc({ nomor: "PKR-UJI-P4", date: "2026-10-13", seller: kemal, buyer: "Kerabat Cari", total: 250 });
  const p5 = await doc({ nomor: "PKR-UJI-P5", date: "2026-09-15", seller: emon, buyer: "Pembeli September", total: 700 });
  const admin = await createTestUser({ roles: ["ADMIN"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  return { emon, kemal, p1, p2, p3, p4, p5, admin, fin, sales, a: makeClient(server.baseUrl, admin.token), f: makeClient(server.baseUrl, fin.token) };
}
const unduh = (w, filter = {}, periode = OKT, who = "admin") => unduhExport(server.baseUrl, w[who].token, "penjualan-karyawan", { periode, filter });
const layar = async (w, { periode = OKT, status = "", q = "", sellerId = "" } = {}) => {
  const qs = new URLSearchParams({ ...periode, ...(status && { status }), ...(q && { q }), ...(sellerId && { sellerId }) }).toString();
  const r = await w.a.get(`/api/finance/penjualan-karyawan?${qs}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
};
const baris = (ex) => bacaSheet(ex.wb, "Daftar Penjualan");
const angka = (x) => Number(x ?? 0);
const jml = (xs) => Math.round(xs.reduce((a, b) => a + Number(b || 0), 0) * 100) / 100;

test("A. memuat SELURUH hasil filter (524 dokumen) walau layar memotong di 500; total aktif mengecualikan dokumen batal", async () => {
  const w = await dunia();
  const sc = await layar(w); assert.equal(sc.penjualan.length, 500, "layar dipotong 500"); assert.equal(sc.terpotong, true);
  const ex = await unduh(w); assert.equal(ex.status, 200, JSON.stringify(ex.json));
  const d = baris(ex);
  assert.equal(d.baris.length, N + 4, "Excel memuat semua 524 dokumen periode Oktober (520 + P1..P4)");
  assert.ok(d.baris.length > 500);
  const aktif = d.baris.filter((b) => !/^Dibatalkan/.test(String(b.Status)));
  assert.equal(aktif.length, N + 3); assert.match(String(d.total["Nomor PKR"]), /TOTAL AKTIF \(523 dari 524 dokumen\)/);
  assert.equal(angka(d.total["Nilai (Rp)"]), N * 100 + 200 + 300 + 250, "total nilai hanya dokumen aktif (tanpa P3 Rp400)");
  assert.equal(angka(d.total["Dibayar (Rp)"]), 200 + 100, "dibayar hanya pembayaran aktif dokumen aktif");
  assert.equal(angka(d.total["Sisa Ditagih (Rp)"]), N * 100 + 300 - 100 + 250 - 0 + (200 - 200), "sisa = nilai − dibayar (aktif)");
});

test("B. dokumen batal: 'Dibatalkan — tidak ditagih', sisa Rp0, nilai historis tetap tersedia; pembayaran batal tidak masuk total pembayaran aktif", async () => {
  const w = await dunia(); const ex = await unduh(w); const d = baris(ex);
  const p3 = d.baris.find((b) => b["Nomor PKR"] === "PKR-UJI-P3");
  assert.equal(p3.Status, "Dibatalkan — tidak ditagih"); assert.equal(angka(p3["Sisa Ditagih (Rp)"]), 0); assert.equal(angka(p3["Nilai (Rp)"]), 400, "nilai historis tidak diubah"); assert.equal(angka(p3["Dibayar (Rp)"]), 0);
  assert.ok(d.baris.some((b) => /Dibatalkan — tidak ditagih/.test(String(b.Status))));
  const bayar = bacaSheet(ex.wb, "Pembayaran");
  assert.equal(bayar.baris.length, 1 + 2 + 1, "P1(1) + P2(2) + P3(1) = 4 pembayaran");
  const batal = bayar.baris.filter((b) => b.Status === "Dibatalkan"); assert.equal(batal.length, 2); assert.deepEqual(batal.map((b) => angka(b["Nominal (Rp)"])).sort((a, c) => a - c), [50, 150]);
  assert.match(String(bayar.total["Nomor PKR"]), /TOTAL PEMBAYARAN AKTIF \(2 dari 4 pembayaran\)/);
  assert.equal(angka(bayar.total["Nominal (Rp)"]), 300, "200 (P1) + 100 (P2); 50 dan 150 batal tidak dihitung");
  assert.ok(bayar.baris.every((b) => b.Status === "Aktif" || b.Status === "Dibatalkan"));
});

test("C. filter periode, status, pencarian, dan karyawan — hasilnya SAMA dengan daftar layar (hasil < 500), tidak ada yang bocor", async () => {
  const w = await dunia();
  const kasus = [
    { nama: "status LUNAS", f: { status: "LUNAS" }, s: { status: "LUNAS" }, nomor: ["PKR-UJI-P1"] },
    { nama: "status SEBAGIAN", f: { status: "SEBAGIAN" }, s: { status: "SEBAGIAN" }, nomor: ["PKR-UJI-P2"] },
    { nama: "status DIBATALKAN", f: { status: "DIBATALKAN" }, s: { status: "DIBATALKAN" }, nomor: ["PKR-UJI-P3"] },
    { nama: "pencarian", f: { q: "Kerabat Cari" }, s: { q: "Kerabat Cari" }, nomor: ["PKR-UJI-P4"] },
    { nama: "karyawan Kemal", f: { sellerId: w.kemal.id }, s: { sellerId: w.kemal.id }, nomor: ["PKR-UJI-P4"] },
    { nama: "periode September", f: {}, s: { periode: SEP }, per: SEP, nomor: ["PKR-UJI-P5"] },
    { nama: "kombinasi karyawan Emon + SEBAGIAN", f: { sellerId: w.emon.id, status: "SEBAGIAN" }, s: { sellerId: w.emon.id, status: "SEBAGIAN" }, nomor: ["PKR-UJI-P2"] },
  ];
  for (const k of kasus) {
    const ex = await unduh(w, k.f, k.per ?? OKT); assert.equal(ex.status, 200, `${k.nama}: ${JSON.stringify(ex.json)}`);
    const d = baris(ex); const sc = await layar(w, k.s);
    assert.deepEqual(d.baris.map((b) => b["Nomor PKR"]).sort(), k.nomor.sort(), `${k.nama}: nomor`);
    assert.deepEqual(d.baris.map((b) => b["Nomor PKR"]).sort(), sc.penjualan.map((p) => p.nomor).sort(), `${k.nama}: sama dengan layar`);
    for (const p of sc.penjualan) { const b = d.baris.find((x) => x["Nomor PKR"] === p.nomor); assert.equal(angka(b["Nilai (Rp)"]), p.total); assert.equal(angka(b["Dibayar (Rp)"]), p.terbayar); assert.equal(angka(b["Sisa Ditagih (Rp)"]), p.sisa); }
  }
  const semua = await unduh(w, { status: "BELUM_BAYAR" }); assert.equal(baris(semua).baris.length, N + 1, "BELUM_BAYAR: 520 masal + P4 (>500, utuh)");
});

test("D. 500 baris pertama layar adalah himpunan bagian Excel dengan angka identik", async () => {
  const w = await dunia(); const sc = await layar(w); const d = baris(await unduh(w));
  const peta = new Map(d.baris.map((b) => [b["Nomor PKR"], b]));
  for (const p of sc.penjualan) { const b = peta.get(p.nomor); assert.ok(b, `${p.nomor} ada di Excel`); assert.equal(angka(b["Nilai (Rp)"]), p.total); assert.equal(angka(b["Sisa Ditagih (Rp)"]), p.sisa); }
});

test("E. rekap Per Karyawan mengikuti periode (dokumen aktif saja), terpisah dari batal; filter karyawan mempersempit; label filter memakai NAMA", async () => {
  const w = await dunia(); const ex = await unduh(w); const r = bacaSheet(ex.wb, "Per Karyawan");
  const emon = r.baris.find((b) => b.Karyawan === "Emon Uji"); const kemal = r.baris.find((b) => b.Karyawan === "Kemal Uji");
  assert.equal(angka(emon["Penjualan Aktif"]), N + 2, "520 + P1 + P2 (P3 batal dan P5 September tidak ikut)");
  assert.equal(angka(emon["Nilai (Rp)"]), N * 100 + 200 + 300); assert.equal(angka(emon["Dibayar (Rp)"]), 300); assert.equal(angka(emon["Sisa Ditagih (Rp)"]), N * 100 + 500 - 300);
  assert.equal(angka(kemal["Nilai (Rp)"]), 250);
  const exK = await unduh(w, { sellerId: w.kemal.id }); const rk = bacaSheet(exK.wb, "Per Karyawan"); const rkData = rk.baris.filter((b) => b["Penjualan Aktif"] != null); /* sheet tanpa baris total: helper ikut membaca baris catatan */
  assert.equal(rkData.length, 1); assert.equal(rkData[0].Karyawan, "Kemal Uji");
  assert.ok(exK.wb.getWorksheet("Daftar Penjualan").getCell("A4").value.toString().includes("Karyawan: Kemal Uji") || JSON.stringify(baris(exK).kepala).includes("Karyawan: Kemal Uji"), "label filter memuat nama karyawan");
  assert.ok(!JSON.stringify(baris(exK).kepala).includes(w.kemal.id), "label tidak memuat id mentah");
  const rS = bacaSheet((await unduh(w, {}, SEP)).wb, "Per Karyawan"); const rsData = rS.baris.filter((b) => b["Penjualan Aktif"] != null); assert.equal(rsData.length, 1); assert.equal(angka(rsData[0]["Nilai (Rp)"]), 700, "periode September: hanya P5");
});

test("F. izin & kolom sensitif: SALES ditolak 403; Finance memperoleh berkas tanpa kolom sensitif; Finance Admin memperoleh Catatan Internal", async () => {
  const w = await dunia();
  const tolak = await unduh(w, {}, OKT, "sales"); assert.equal(tolak.status, 403, JSON.stringify(tolak.json)); assert.equal(tolak.json.code, "TIDAK_BERHAK");
  const fin = await unduh(w, { status: "SEBAGIAN" }, OKT, "fin"); assert.equal(fin.status, 200, JSON.stringify(fin.json));
  assert.ok(!baris(fin).header.includes("Catatan Internal"), "Finance biasa tidak menerima kolom sensitif"); assert.ok(!JSON.stringify(baris(fin)).includes("catatan rahasia"));
  const adm = await unduh(w, { status: "SEBAGIAN" }); assert.ok(baris(adm).header.includes("Catatan Internal")); assert.equal(baris(adm).baris[0]["Catatan Internal"], "catatan rahasia");
  const buruk = await unduh(w, { status: "APA_SAJA" }); assert.equal(buruk.status, 400); assert.equal(buruk.json.code, "FILTER_TIDAK_VALID");
});

test("G. ekspor hanya membaca: dokumen, pembayaran, dan jurnal tidak berubah", async () => {
  const w = await dunia();
  const potret = async () => ({ doc: await testPrisma.finPenjualanKaryawan.count(), bayar: await testPrisma.finPenjualanKaryawanPayment.count(), jurnal: await testPrisma.finJournalEntry.count(),
    batal: await testPrisma.finPenjualanKaryawan.count({ where: { status: "DIBATALKAN" } }), nilai: jml((await testPrisma.finPenjualanKaryawan.findMany({ select: { total: true } })).map((x) => x.total)) });
  const sebelum = await potret();
  for (const f of [{}, { status: "LUNAS" }, { q: "Kerabat" }, { sellerId: w.emon.id }]) assert.equal((await unduh(w, f)).status, 200);
  assert.deepEqual(await potret(), sebelum);
});
