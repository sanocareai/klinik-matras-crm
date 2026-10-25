// Keadaan EFEKTIF catatan historis: GR resmi / pengeluaran stok biasa mengubah saldo di LUAR modul catatan → catatan lain yang memakai bahan sama TIDAK boleh tampil SIAP_POSTING yang basi
// (pembaca langsung sesudah transaksi, rencana/mesin posting berikutnya, klik ulang, transaksi bersamaan) TANPA evaluasi global manual. Penulis ledger (postStockMovement) tidak disentuh.
// Dunia uji sama dengan evaluasiCatatanAtomik: bahan MX (pasokan 10): uA 6 (3 Sep) lolos, uB 5 (4 Sep) diblokir, uC 4 (5 Sep) lolos; MY untuk transaksi sah uB.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, periksaKeadaanCatatan, ambilCatatanHistoris, ringkasCatatanUnits, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, jalankanPosting } from "../../src/services/postingPemakaianHistoris.js";
import { ringkasRencana, saldoBahanRencana } from "../../src/services/postingKonfirmasiManifest.js";
import { koreksiCatatan } from "../../src/services/koreksiPemakaian.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const konfirmasiDari = (p, rujukan = "OWNER-2026-10-25") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan, isiTransaksi: r.isiTransaksi, saldoManifest: p.__saldo ?? [] }; };
const rencanakan = async (db, o) => { const p = await rencanakanPosting(db, o); p.__saldo = await saldoBahanRencana(db, p); return p; }; // seperti UI: konfirmasi memuat saldo bahan yang ditinjau saat rencana dibuat
const PERSETUJUAN = (p) => (typeof p === "string" ? { hashDisetujui: p, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", konfirmasi: {} } : { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", konfirmasi: konfirmasiDari(p) });

async function dunia() {
  resetKeadaanEfektif();
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const mx = await createTestMaterial({ code: "B-MX", name: "KAIN REBUTAN BASI", unit: "METER" }); const my = await createTestMaterial({ code: "B-MY", name: "BUSA SAH BASI", unit: "SHEET" });
  await seedBalance(mx.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 20000 }); await seedBalance(my.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 50000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const uA = await mk("RES-03092026-901"); const uB = await mk("RES-04092026-902"); const uC = await mk("RES-05092026-903");
  const csv = ["J", "D", HDR,
    baris(1, "RES-03092026-901", "3 Sep 26", "Bahan Lapisan", "KAIN REBUTAN BASI", "6,0", "METER"),
    baris(2, "RES-04092026-902", "4 Sep 26", "Bahan Fondasi", "BUSA SAH BASI", "1,0", "LEMBAR"),
    baris(3, "RES-04092026-902", "4 Sep 26", "Bahan Lapisan", "KAIN REBUTAN BASI", "5,0", "METER"),
    baris(4, "RES-05092026-903", "5 Sep 26", "Bahan Lapisan", "KAIN REBUTAN BASI", "4,0", "METER")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: "basi.csv" }), {});
  await evaluasiUlang(testPrisma, {});
  return { admin, owner, A: { id: admin.user.id, name: admin.user.name, roles: ["ADMIN"] }, B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, mx, my, uA, uB, uC };
}
/** GR resmi / pengeluaran stok biasa = jalur ledger inti (postStockMovement), TANPA menyentuh modul catatan. */
const ledger = (w, materialId, type, qty, createdAt) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type, qty, note: `uji ${type} di luar modul catatan`, createdById: w.A.id, ...(createdAt ? { createdAt } : {}) }), { timeout: 30_000 });
const cat = (unit, mat) => testPrisma.unitUsageNote.findFirst({ where: { unitId: unit.id, materialId: mat.id, origin: "EXCEL" } });
const tersimpan = async (w) => ({ A_MX: (await cat(w.uA, w.mx)).state, B_MY: (await cat(w.uB, w.my)).state, B_MX: (await cat(w.uB, w.mx)).state, C_MX: (await cat(w.uC, w.mx)).state });
/** Yang DILIHAT pengguna (API baca Produksi) — per catatan unit×bahan. */
const dilihat = async (w) => {
  const g = async (u, m) => (await ambilCatatanHistoris(testPrisma, u.id)).items.find((i) => i.bahan?.id === m.id && i.origin === "EXCEL").state;
  return { A_MX: await g(w.uA, w.mx), B_MY: await g(w.uB, w.my), B_MX: await g(w.uB, w.mx), C_MX: await g(w.uC, w.mx) };
};
/** Yang DIPAKAI mesin posting: catatan dalam rencana. */
const dipakaiMesin = async (w) => { const p = await rencanakan(testPrisma); const ids = new Set(p.transaksi.flatMap((t) => t.catatanIds)); const s = async (u, m) => (ids.has((await cat(u, m)).id) ? "SIAP_POSTING" : "BUKAN_SIAP"); return { plan: p, A_MX: await s(w.uA, w.mx), B_MY: await s(w.uB, w.my), B_MX: await s(w.uB, w.mx), C_MX: await s(w.uC, w.mx) }; };
const samaDenganMesin = (lihat, mesin) => { for (const k of ["A_MX", "B_MY", "B_MX", "C_MX"]) assert.equal(lihat[k] === "SIAP_POSTING", mesin[k] === "SIAP_POSTING", `UI vs mesin tidak konsisten untuk ${k}: UI=${lihat[k]} mesin=${mesin[k]}`); };
const titikTetap = async (label) => { const r = await evaluasiUlang(testPrisma, {}); assert.equal(r.berubah, 0, `${label}: masih ada ${r.berubah} perubahan`); };

test("B0. awal: UI = mesin = tersimpan", async () => {
  const w = await dunia(); const d = await dilihat(w); const m = await dipakaiMesin(w);
  assert.deepEqual(d, { A_MX: "SIAP_POSTING", B_MY: "SIAP_POSTING", B_MX: "PERLU_DICEK", C_MX: "SIAP_POSTING" }); samaDenganMesin(d, m); assert.deepEqual(await tersimpan(w), d);
});

test("B1. pengeluaran stok BIASA (di luar modul) mengurangi pasokan: pembaca langsung sesudah commit tidak melihat SIAP basi; UI = mesin; tersimpan menyusul tanpa evaluasi manual", async () => {
  const w = await dunia();
  await ledger(w, w.mx.id, "ISSUE", -5);                                      // 10 → 5; uA (6) dan uC (4)+uB(5) berebut sisa
  assert.equal((await tersimpan(w)).A_MX, "SIAP_POSTING", "keadaan TERSIMPAN memang masih basi tepat sesudah commit (penulis luar modul tidak mengevaluasi)");
  const d = await dilihat(w); const m = await dipakaiMesin(w);
  assert.deepEqual(d, { A_MX: "PERLU_DICEK", B_MY: "SIAP_POSTING", B_MX: "SIAP_POSTING", C_MX: "PERLU_DICEK" }, "yang DILIHAT pengguna = keadaan efektif, bukan basi");
  samaDenganMesin(d, m);
  assert.ok(!m.plan.transaksi.some((t) => t.unitId === w.uA.id) && !m.plan.transaksi.some((t) => t.unitId === w.uC.id), "mesin tidak merencanakan transaksi basi");
  const r = await ringkasCatatanUnits(testPrisma, [w.uA.id, w.uB.id, w.uC.id]);
  assert.equal(r.get(w.uA.id).siapPosting, 0); assert.equal(r.get(w.uB.id).siapPosting, 2); assert.equal(r.get(w.uC.id).siapPosting, 0, "ringkasan daftar Order Produksi memakai keadaan efektif");
  await tungguPenyegaran();
  assert.deepEqual(await tersimpan(w), d, "penyegaran latar menyimpan keadaan yang benar — tanpa evaluasi global manual"); await titikTetap("B1");
});

test("B2. GR resmi menambah pasokan: catatan yang tadinya diblokir langsung terbaca benar (arah sebaliknya) dan masuk rencana", async () => {
  const w = await dunia();
  await ledger(w, w.mx.id, "RECEIPT", 6, WIB("2026-09-02"));               // GR resmi bertanggal tiba 2 Sep: 10 → 16 sebelum pemakaian uB-MX (5, 4 Sep) → kini cukup
  const d = await dilihat(w); const m = await dipakaiMesin(w);
  assert.deepEqual(d, { A_MX: "SIAP_POSTING", B_MY: "SIAP_POSTING", B_MX: "SIAP_POSTING", C_MX: "SIAP_POSTING" }); samaDenganMesin(d, m);
  await tungguPenyegaran(); assert.deepEqual(await tersimpan(w), d); await titikTetap("B2");
});

test("B3. posting berikutnya sesudah perubahan di luar modul: rencana basi ditolak; rencana efektif berjalan; tidak ada pergerakan dari catatan basi; titik tetap", async () => {
  const w = await dunia();
  const planLama = await rencanakan(testPrisma, { unitIds: [w.uA.id] });           // dihitung SEBELUM stok dikurangi
  assert.equal(planLama.jumlah, 1);
  await ledger(w, w.mx.id, "ISSUE", -5);
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(planLama), aktor: w.B, unitIds: [w.uA.id] }), /BERBEDA dari yang disetujui|tidak lagi siap/);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.uA.id, type: "ISSUE" } }), 0, "tidak ada pengeluaran dari catatan basi");
  const planB = await rencanakan(testPrisma, { unitIds: [w.uB.id] }); assert.equal(planB.jumlah, 2, "uB-MY dan uB-MX (kini cukup) ada dalam rencana efektif");
  const h = await jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(planB), aktor: w.B, unitIds: [w.uB.id] });
  assert.equal(h.diposting.length, 2); assert.equal(h.gagal.length, 0, JSON.stringify(h.gagal));
  const d = await dilihat(w); samaDenganMesin(d, await dipakaiMesin(w));
  assert.equal(d.A_MX, "PERLU_DICEK"); assert.equal(d.C_MX, "PERLU_DICEK"); await tungguPenyegaran(); assert.deepEqual(await tersimpan(w), d); await titikTetap("B3");
  assert.ok((await testPrisma.stockMovement.aggregate({ where: { materialId: w.mx.id }, _sum: { qty: true } }))._sum.qty >= 0);
});

test("B4. klik ulang / baca berulang: stabil, tanpa penulisan tambahan; klik ganda posting = satu pergerakan", async () => {
  const w = await dunia();
  await ledger(w, w.mx.id, "ISSUE", -5);
  const d1 = await dilihat(w); const d2 = await dilihat(w); const d3 = await dilihat(w); assert.deepEqual(d1, d2); assert.deepEqual(d2, d3);
  await tungguPenyegaran(); const ev = await testPrisma.unitUsageNoteEvent.count();
  await dilihat(w); await dilihat(w); await tungguPenyegaran(); assert.equal(await testPrisma.unitUsageNoteEvent.count(), ev, "pembacaan berulang tidak menulis peristiwa");
  const p = await rencanakan(testPrisma, { unitIds: [w.uB.id] });
  const rr = await Promise.allSettled([jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uB.id] }), jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uB.id] })]);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.uB.id, type: "ISSUE" } }), 2, "tepat dua pergerakan (MY dan MX) walau klik ganda");
  assert.ok(rr.some((x) => x.status === "fulfilled" && x.value.diposting.length === 2));
  await tungguPenyegaran(); await titikTetap("B4");
});

test("B5. transaksi bersamaan: pengeluaran biasa ∥ GR ∥ posting ∥ koreksi catatan ∥ pembaca → tanpa deadlock, UI = mesin = tersimpan sesudah penyegaran, saldo tak negatif", async () => {
  const w = await dunia(); const p = await rencanakan(testPrisma, { unitIds: [w.uC.id] }); const nC = await cat(w.uC, w.mx);
  const t0 = Date.now(); let jalan = true; let baca = 0; const galatBaca = [];
  const pembaca = (async () => { while (jalan) { try { await dilihat(w); await dipakaiMesin(w); baca++; } catch (e) { galatBaca.push(e.message); } } })();
  const waktu = async (f) => { const t = Date.now(); const v = await f(); return { ms: Date.now() - t, v }; };
  const hasil = await Promise.allSettled([
    waktu(() => ledger(w, w.mx.id, "ISSUE", -2)), waktu(() => ledger(w, w.my.id, "ISSUE", -3)), waktu(() => ledger(w, w.mx.id, "RECEIPT", 3)),
    waktu(() => jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uC.id] })),
    waktu(() => koreksiCatatan(testPrisma, { noteId: nC.id, perubahan: { qty: 3 }, alasan: "Admin Sales konfirmasi 3 meter", kunci: `uji-b5-${Date.now()}-aaaaaaaa`, aktor: w.A })),
  ]);
  jalan = false; await pembaca;
  const gagal = hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message);
  assert.ok(!gagal.some((m) => /deadlock/i.test(m ?? "")), "tidak ada deadlock: " + gagal.join(" | "));
  assert.deepEqual(galatBaca, [], "pembaca tidak pernah galat"); assert.ok(baca > 0);
  const ledgerMs = hasil.slice(0, 3).filter((x) => x.status === "fulfilled").map((x) => x.value.ms);
  assert.ok(Math.max(...ledgerMs) < 20_000, `penulis ledger tidak terhambat berlebihan: ${ledgerMs.join(",")} ms`);
  assert.ok((await testPrisma.stockMovement.aggregate({ where: { materialId: w.mx.id }, _sum: { qty: true } }))._sum.qty >= -1e-6);
  await tungguPenyegaran(); const d = await dilihat(w); samaDenganMesin(d, await dipakaiMesin(w)); assert.deepEqual(await tersimpan(w), d); await titikTetap("B5");
  const potret = await testPrisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead" }); assert.equal(potret.berubah, 0);
  console.log(`   [B5] ${Date.now() - t0} ms total; ledger ms=${ledgerMs.join(",")}; pembacaan UI+mesin=${baca}x`);
});
