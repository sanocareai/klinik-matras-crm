// Evaluasi keadaan catatan pemakaian historis: GLOBAL + ATOMIK + TERSERIALISASI. Regresi cacat "SIAP_POSTING palsu" (24 Okt 2026):
// evaluasi pasca-posting hanya melihat unit yang diposting, sehingga catatan unit itu yang berebut bahan dengan unit LAIN tampak cukup stoknya (palsu) sampai evaluasi global manual.
// Dunia uji: bahan MX (pasokan 10, tiga unit berebut) — uA 6 (3 Sep) lolos, uB 5 (4 Sep) TIDAK cukup, uC 4 (5 Sep) lolos; bahan MY (pasokan 10) untuk transaksi uB yang sah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, periksaKeadaanCatatan } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, jalankanPosting, postingSatuUnit } from "../../src/services/postingPemakaianHistoris.js";
import { ringkasRencana } from "../../src/services/postingPersetujuanTerikat.js";
import { koreksiCatatan, kecualikanCatatan, ajukanKoreksiPemakaian, setujuiKoreksiPemakaian } from "../../src/services/koreksiPemakaian.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const terikatDari = (p, rujukan = "OWNER-2026-10-25") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan }; };
const PERSETUJUAN = (p) => (typeof p === "string" ? { hashDisetujui: p, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", terikat: {} } : { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", terikat: terikatDari(p) });
let seq = 0; const kunciUji = (t) => `uji-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const mx = await createTestMaterial({ code: "E-MX", name: "KAIN REBUTAN EVAL", unit: "METER" }); const my = await createTestMaterial({ code: "E-MY", name: "BUSA SAH EVAL", unit: "SHEET" });
  await seedBalance(mx.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 20000 }); await seedBalance(my.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 50000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const uA = await mk("RES-03092026-901"); const uB = await mk("RES-04092026-902"); const uC = await mk("RES-05092026-903");
  const csv = ["J", "D", HDR,
    baris(1, "RES-03092026-901", "3 Sep 26", "Bahan Lapisan", "KAIN REBUTAN EVAL", "6,0", "METER"),
    baris(2, "RES-04092026-902", "4 Sep 26", "Bahan Fondasi", "BUSA SAH EVAL", "1,0", "LEMBAR"),
    baris(3, "RES-04092026-902", "4 Sep 26", "Bahan Lapisan", "KAIN REBUTAN EVAL", "5,0", "METER"),
    baris(4, "RES-05092026-903", "5 Sep 26", "Bahan Lapisan", "KAIN REBUTAN EVAL", "4,0", "METER")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: "eval.csv" }), {});
  await evaluasiUlang(testPrisma, {}); // keadaan awal yang benar
  return { admin, owner, A: { id: admin.user.id, name: admin.user.name }, B: { id: owner.user.id, name: owner.user.name }, mx, my, uA, uB, uC };
}
const cat = (w, unit, mat) => testPrisma.unitUsageNote.findFirst({ where: { unitId: unit.id, materialId: mat.id, origin: "EXCEL" } });
const keadaan = async (w) => Object.fromEntries(await Promise.all([["A_MX", w.uA, w.mx], ["B_MY", w.uB, w.my], ["B_MX", w.uB, w.mx], ["C_MX", w.uC, w.mx]].map(async ([k, u, m]) => [k, (await cat(w, u, m)).state])));
const saldo = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty);
const siapIds = async () => (await testPrisma.unitUsageNote.findMany({ where: { state: "SIAP_POSTING" }, select: { id: true } })).map((n) => n.id).sort().join(",");
/** Titik tetap: evaluasi global tidak mengubah apa pun = tidak ada keadaan palsu di mana pun. */
async function titikTetap(label) { const r = await evaluasiUlang(testPrisma, {}); assert.equal(r.berubah, 0, `${label}: evaluasi global masih mengubah ${r.berubah} catatan → ada keadaan palsu (${JSON.stringify(r.detail?.slice(0, 3))})`); }
const planUnit = (w, ...unit) => rencanakanPosting(testPrisma, { unitIds: unit.map((u) => u.id) });

test("E0. dunia uji: uA & uC lolos, uB-MX diblokir saldo tidak cukup, uB-MY sah", async () => {
  const w = await dunia(); const k = await keadaan(w);
  assert.deepEqual(k, { A_MX: "SIAP_POSTING", B_MY: "SIAP_POSTING", B_MX: "PERLU_DICEK", C_MX: "SIAP_POSTING" });
  assert.equal((await cat(w, w.uB, w.mx)).flags[0].kode, "SALDO_TIDAK_CUKUP");
});

test("E1. REGRESI: posting unit uB (transaksi sah MY) tidak boleh membuat catatan uB-MX yang diblokir menjadi SIAP palsu", async () => {
  const w = await dunia(); const p = await planUnit(w, w.uB); assert.equal(p.jumlah, 1);
  const h = await jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uB.id] }); assert.equal(h.diposting.length, 1); assert.equal(h.gagal.length, 0);
  const k = await keadaan(w); assert.equal(k.B_MX, "PERLU_DICEK", "catatan yang berebut bahan dengan unit lain tetap diblokir");
  assert.equal((await cat(w, w.uB, w.mx)).flags[0].kode, "SALDO_TIDAK_CUKUP");
  await titikTetap("E1 sesudah posting");
  const rb = await rencanakanPosting(testPrisma); assert.ok(!rb.transaksi.some((t) => t.unitId === w.uB.id && t.kodeBahan === "E-MX"), "rencana berikutnya tidak memuat transaksi palsu");
});

test("E2. klik ulang: rencana lama ditolak; klik ganda serentak = tepat satu pergerakan; saldo tidak pernah negatif", async () => {
  const w = await dunia(); const p = await planUnit(w, w.uA);
  const hasil = await Promise.allSettled([jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] }), jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] })]);
  const n = await testPrisma.stockMovement.count({ where: { unitId: w.uA.id, type: "ISSUE" } }); assert.equal(n, 1, "klik ganda serentak hanya menulis satu pergerakan");
  assert.ok(hasil.some((x) => x.status === "fulfilled" && x.value.diposting.length === 1), "salah satu berhasil");
  assert.equal(await saldo(w.mx.id), 4);
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] }), /BERBEDA dari yang disetujui/);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.uA.id, type: "ISSUE" } }), 1, "klik ulang rencana lama tidak menulis lagi");
  await titikTetap("E2");
});

test("E3. posting berurutan uA → uC → uB: tiap langkah titik tetap; pasokan tidak pernah terbagi dua kali; uB-MX tetap diblokir", async () => {
  const w = await dunia();
  for (const [u, label] of [[w.uA, "uA"], [w.uC, "uC"], [w.uB, "uB"]]) {
    const p = await planUnit(w, u); assert.ok(p.jumlah >= 1, `${label} punya transaksi`);
    const h = await jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [u.id] }); assert.equal(h.gagal.length, 0, JSON.stringify(h.gagal));
    await titikTetap(`E3 setelah ${label}`); assert.ok((await saldo(w.mx.id)) >= 0 && (await saldo(w.my.id)) >= 0);
    assert.equal((await keadaan(w)).B_MX, "PERLU_DICEK", `uB-MX tetap diblokir setelah ${label}`);
  }
  assert.equal(await saldo(w.mx.id), 0); assert.equal(await saldo(w.my.id), 9);
});

test("E4. dua proses bersamaan (uA ∥ uC ∥ uB): semua commit, tanpa deadlock, titik tetap, tak ada saldo negatif", async () => {
  const w = await dunia(); const ps = await Promise.all([w.uA, w.uC, w.uB].map((u) => planUnit(w, u)));
  const hasil = await Promise.allSettled([w.uA, w.uC, w.uB].map((u, i) => jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(ps[i]), aktor: w.B, unitIds: [u.id] })).flat());
  for (const x of hasil) { assert.equal(x.status, "fulfilled", x.reason?.message); assert.equal(x.value.gagal.length, 0, JSON.stringify(x.value.gagal)); }
  assert.equal(await saldo(w.mx.id), 0); assert.equal(await saldo(w.my.id), 9); await titikTetap("E4");
  assert.equal((await keadaan(w)).B_MX, "PERLU_DICEK");
});

test("E5. pembaca serentak tidak pernah melihat keadaan antara: hanya sebelum atau sesudah posting", async () => {
  const w = await dunia(); const s0 = await siapIds(); const p = await planUnit(w, w.uB);
  const lihat = new Set([s0]); let jalan = true;
  let potret = 0; let palsu = 0; // pembaca mengaudit SETIAP potret konsisten (RepeatableRead): evaluasi global tidak boleh punya apa pun untuk diubah
  const pembaca = (async () => { while (jalan) { const r = await testPrisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead" }); potret++; palsu += r.berubah; lihat.add(await siapIds()); } })();
  await jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uB.id] });
  lihat.add(await siapIds()); jalan = false; await pembaca; const s1 = await siapIds();
  const boleh = new Set([s0, s1]); for (const s of lihat) assert.ok(boleh.has(s), `keadaan antara terbaca: ${s}`);
  assert.ok(potret > 0, "pembaca sempat membaca"); assert.equal(palsu, 0, `${palsu} perubahan palsu terbaca di ${potret} potret`);
  assert.notEqual(s0, s1); await titikTetap("E5");
});

test("E6. koreksi pemakaian yang melepas pasokan: keadaan unit LAIN ikut benar di transaksi yang sama (uB-MX naik, uC-MX turun)", async () => {
  const w = await dunia(); const p = await planUnit(w, w.uA);
  await jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] });
  assert.deepEqual(await keadaan(w), { A_MX: "DIPOSTING", B_MY: "SIAP_POSTING", B_MX: "PERLU_DICEK", C_MX: "SIAP_POSTING" });
  const aj = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.uA.id, materialId: w.mx.id, qtyBaru: 2, alasan: "Pemakaian sebenarnya 2 meter", kunci: kunciUji("e6"), aktor: w.A, tanggalEfektif: "2026-09-03T00:00:00+07:00" });
  await setujuiKoreksiPemakaian(testPrisma, { koreksiId: aj.id, aktor: w.B });
  // pasokan 8 tersisa: uB-MX (5, lebih awal) lolos → sisa 3 → uC-MX (4) tidak cukup. Langsung benar setelah setujui kembali — tanpa evaluasi manual.
  assert.deepEqual(await keadaan(w), { A_MX: "DIPOSTING", B_MY: "SIAP_POSTING", B_MX: "SIAP_POSTING", C_MX: "PERLU_DICEK" });
  await titikTetap("E6");
});

test("E7. campuran serentak (posting ∥ koreksi catatan ∥ kecualikan): tanpa deadlock, titik tetap", async () => {
  const w = await dunia(); const p = await planUnit(w, w.uA); const nC = await cat(w, w.uC, w.mx); const nB = await cat(w, w.uB, w.mx);
  const hasil = await Promise.allSettled([
    jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] }),
    koreksiCatatan(testPrisma, { noteId: nC.id, perubahan: { qty: 3 }, alasan: "Admin Sales konfirmasi 3 meter", kunci: kunciUji("e7a"), aktor: w.A }),
    kecualikanCatatan(testPrisma, { noteId: nB.id, alasan: "Salinan ganda dikonfirmasi PIC", kunci: kunciUji("e7b"), aktor: w.A }),
  ]);
  for (const x of hasil) assert.equal(x.status, "fulfilled", x.reason?.message);
  assert.equal(hasil[0].value.diposting.length, 1); await titikTetap("E7"); assert.ok((await saldo(w.mx.id)) >= 0);
  assert.equal((await cat(w, w.uB, w.mx)).state, "TIDAK_DIHITUNG");
});

test("E8. pasokan terpakai DI LUAR modul ini: rencana basi ditolak sejak awal; eksekusi dari daftar basi (balapan) gugur fail-closed DAN keadaan yang benar tersimpan tanpa evaluasi manual", async () => {
  const w = await dunia(); const p = await planUnit(w, w.uA); assert.equal(p.jumlah, 1);
  assert.equal((await keadaan(w)).A_MX, "SIAP_POSTING");
  // pengeluaran stok biasa menghabiskan 8 dari 10 meter (menulis ledger langsung, tidak lewat evaluasi catatan) → catatan uA (6) tidak lagi cukup
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, type: "ISSUE", qty: -8, note: "pengeluaran biasa di luar modul", createdAt: WIB("2026-09-02") } });
  assert.equal((await keadaan(w)).A_MX, "SIAP_POSTING", "keadaan TERSIMPAN basi sebelum ada penyegaran");
  // (a) jalur normal: rencana dihitung dari keadaan EFEKTIF → hash lama ditolak, tidak ada pergerakan
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id] }), /BERBEDA dari yang disetujui/);
  assert.equal(await saldo(w.mx.id), 2, "tidak ada pergerakan baru");
  // (b) balapan: eksekusi memakai daftar yang dihitung SEBELUM stok berubah → fail-closed di dalam kunci
  const h = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar: p.transaksi, persetujuan: PERSETUJUAN(p), aktor: w.B });
  assert.equal(h.status, "GAGAL"); assert.equal(h.kode, "CATATAN_BERUBAH", JSON.stringify(h)); assert.equal(await saldo(w.mx.id), 2);
  assert.equal((await keadaan(w)).A_MX, "PERLU_DICEK", "keadaan benar SUDAH tersimpan (penyembuhan), tanpa evaluasi global manual");
  await titikTetap("E8");
});
