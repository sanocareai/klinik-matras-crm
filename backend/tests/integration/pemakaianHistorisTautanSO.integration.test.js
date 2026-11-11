// PEMAKAIAN HISTORIS × TAUTAN SO EKSPLISIT, dan SATUAN PAKAI LIST WIBING sesudah master menjadi METER. Backend asli + DB uji terisolasi.
// Risiko: (1) jalur "Tetap catat meskipun stok tidak cukup" hanya memeriksa opname/persediaan awal — hasil SO yang ditautkan eksplisit tidak dihormati, sehingga pemakaian PRA-SO mengurangi stok yang sudah dihitung SO (dua kali);
// (2) aturan meter÷90 diterapkan lagi pada stok yang sudah bersatuan METER.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { denganVerifikasiOtomatis } from "./setup/verifikasiOtomatis.js"; // non-ADMIN: pengajuan → diverifikasi ADMIN uji lain (jalur tulis yang sama)
import { tautkanSO, batalkanTautan } from "../../src/services/pengamanHistorisPascaSO.js";
import { pratinjauTransisi, terapkanTransisi } from "../../src/services/transisiSatuanBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "so") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
const HARI = 86400_000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tgl = (hariLalu = 0) => wib(Date.now() - hariLalu * HARI);
const ALASAN = "Pemakaian lama belum tercatat; saldo dibereskan lewat opname";
const EXC = { pengecualianStokTidakCukup: true, alasanPengecualianStok: ALASAN, konfirmasiSaldoMinus: true };
const PRA = (w) => `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);

async function dunia() {
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const owner = await createTestUser({ roles: ["OWNER"] }); const admin = await createTestUser({ roles: ["ADMIN"] }); // ADMIN: jalur LANGSUNG & penyetuju koreksi pemakaian (Nov 2026)
  const { unit } = await createTestUnit({ status: "DELIVERED", createdAt: new Date(Date.now() - 20 * HARI) });
  return { lead, owner, admin, A: { id: admin.user.id, name: admin.user.name, roles: ["ADMIN"] }, a: makeClient(server.baseUrl, admin.token), B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, l: denganVerifikasiOtomatis(makeClient(server.baseUrl, lead.token), server.baseUrl), unit };
}
async function bahanBerSO(w, { unit = "METER", saldoSO = 5, kode = `KAIN-SO-${++seq}`, soHariLalu = 2 } = {}) {
  const m = await createTestMaterial({ code: kode, name: `BAHAN ${kode}`, unit });
  await seedBalance(m.id, saldoSO, { unitCost: 20000, createdAt: new Date(Date.now() - 41 * HARI) });
  const t = await tautkanSO(testPrisma, { aktor: w.B, materialId: m.id, soTanggal: tgl(soHariLalu), sumber: "SO uji (berkas dan rencana)", alasan: "Hasil SO ditautkan eksplisit untuk uji pengaman", rujukanHash: "hash-manifest-so-uji-0001", kunci: kunci("taut") });
  return { m, t };
}
async function catat(w, body, { tanggal, k = kunci("pk") } = {}) {
  const pra = await w.l.post(PRA(w), { materialId: body.materialId, jenis: body.qty < 0 ? "KURANGI" : "TAMBAH", qty: Math.abs(body.qty), tanggalPemakaian: tanggal, satuan: body.satuan, pengecualianStokTidakCukup: body.pengecualianStokTidakCukup === true });
  const kirim = { alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tanggal, saldoDilihat: pra.body?.stok?.saldoDilihat, hppSidik: pra.body?.hppOperasional?.sidik, ...body };
  return { pra, res: await w.l.post(`/api/units/${w.unit.id}/materials`, kirim, { "Idempotency-Key": k }) };
}

// ── MATRIKS PERLINDUNGAN PEMAKAIAN BARU PRA-SO: tidak bergantung pada 'Tetap catat' maupun kecukupan saldo ──
const BLOK = (r) => assert.ok(r.res.status === 409 && r.res.body.code === "UNIT_PEMAKAIAN_PRA_SO", JSON.stringify(r.res.body));
const adaPenghalang = (r, kode) => (r.pra.body?.penghalang ?? []).some((x) => x.kode === kode);

test("H1. saldo CUKUP, bahan bertautan SO, tanggal pra-SO: pratinjau menahan, pencatatan 409 PEMAKAIAN_PRA_SO, stok tidak berkurang dua kali, tidak ada ISSUE", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 }); const i0 = await testPrisma.stockMovement.count({ where: { type: "ISSUE" } });
  const r = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(5) });
  assert.equal(r.pra.status, 200); assert.ok(adaPenghalang(r, "PEMAKAIAN_PRA_SO"), JSON.stringify(r.pra.body.penghalang)); assert.ok(!adaPenghalang(r, "SALDO_KURANG"), "saldo cukup: penahan BUKAN karena saldo");
  BLOK(r); assert.equal(await saldo(m.id), 5); assert.equal(await testPrisma.stockMovement.count({ where: { type: "ISSUE" } }), i0);
});

test("H2. saldo TIDAK cukup (dengan dan tanpa 'Tetap catat'): sama-sama ditahan oleh PEMAKAIAN_PRA_SO; stok tetap", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  const a = await catat(w, { materialId: m.id, qty: 8, konfirmasiBukanGanda: true }, { tanggal: tgl(5) }); assert.ok(adaPenghalang(a, "PEMAKAIAN_PRA_SO")); BLOK(a);
  const b = await catat(w, { materialId: m.id, qty: 8, konfirmasiBukanGanda: true, ...EXC }, { tanggal: tgl(5) }); assert.ok(adaPenghalang(b, "PEMAKAIAN_PRA_SO")); assert.ok((b.pra.body.penghalang ?? []).every((x) => x.bisaDikecualikan !== true), "tidak ada penghalang yang bisa dikecualikan"); BLOK(b);
  assert.equal(await saldo(m.id), 5);
});

test("H3. batas tanggal: sebelum SO dan SAMA dengan tanggal SO ditahan; SESUDAH tanggal SO jalur normal dan 'Tetap catat' bekerja seperti biasa", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  BLOK(await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(4) })); BLOK(await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(3) })); assert.equal(await saldo(m.id), 5);
  const ok1 = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(2) }); assert.equal(ok1.res.status, 201, JSON.stringify(ok1.res.body)); assert.equal(await saldo(m.id), 3);
  const ok2 = await catat(w, { materialId: m.id, qty: 8, konfirmasiBukanGanda: true, ...EXC }, { tanggal: tgl(1) }); assert.equal(ok2.res.status, 201, JSON.stringify(ok2.res.body)); assert.equal(await saldo(m.id), -5);
});

test("H4. koreksi/retur yang sah TETAP jalan: pengembalian pemakaian bertaut bertanggal pra-SO diterima; bahan TANPA tautan tidak tersentuh", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  const pakai = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(2) }); assert.equal(pakai.res.status, 201, JSON.stringify(pakai.res.body)); assert.equal(await saldo(m.id), 3);
  const retur = await catat(w, { materialId: m.id, qty: -1, konfirmasiBukanGanda: true }, { tanggal: tgl(5) }); assert.equal(retur.res.status, 201, JSON.stringify(retur.res.body)); assert.equal(await saldo(m.id), 4, "RETURN menambah stok");
  const polos = await createTestMaterial({ code: `KAIN-POLOS-${++seq}`, name: "POLOS", unit: "METER" }); await seedBalance(polos.id, 5, { unitCost: 20000, createdAt: new Date(Date.now() - 41 * HARI) });
  const bebas = await catat(w, { materialId: polos.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(5) }); assert.equal(bebas.res.status, 201, JSON.stringify(bebas.res.body)); assert.equal(await saldo(polos.id), 3);
  const bebas2 = await catat(w, { materialId: polos.id, qty: 8, konfirmasiBukanGanda: true, ...EXC }, { tanggal: tgl(5) }); assert.equal(bebas2.res.status, 201, JSON.stringify(bebas2.res.body)); assert.equal(await saldo(polos.id), -5);
});

test("H5. tautan DIBATALKAN: perlindungan ikut hilang (bahan kembali mengikuti aturan lama)", async () => {
  const w = await dunia(); const { m, t } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  BLOK(await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(5) }));
  await batalkanTautan(testPrisma, { aktor: w.B, tautanId: t.id ?? t.tautan?.id ?? t.eventId ?? t.tautanId, alasan: "Dibatalkan untuk uji pengaman pemakaian pra-SO" });
  const bebas = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(5) }); assert.equal(bebas.res.status, 201, JSON.stringify(bebas.res.body)); assert.equal(await saldo(m.id), 3);
});

test("H6. UPAYA MELEWATI: tanpa kunci idempotensi, tanggal salah/masa depan/kosong, ubah-jumlah (tambah ditahan, kurang boleh), unit BERJALAN — tidak ada yang menembus", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  const pra = await w.l.post(PRA(w), { materialId: m.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: tgl(5) });
  const tanpaKunci = await w.l.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2, alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tgl(5), saldoDilihat: pra.body.stok.saldoDilihat, hppSidik: pra.body.hppOperasional.sidik, konfirmasiBukanGanda: true });
  assert.equal(tanpaKunci.status, 409); assert.equal(tanpaKunci.body.code, "UNIT_PEMAKAIAN_PRA_SO");
  for (const [tg, kode] of [["2026-13-40", "UNIT_TANGGAL_PEMAKAIAN_TIDAK_VALID"], [tgl(-3), "UNIT_TANGGAL_PEMAKAIAN_MASA_DEPAN"], ["", "UNIT_TANGGAL_PEMAKAIAN_WAJIB"]]) {
    const r = await w.l.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2, alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tg, saldoDilihat: 5, hppSidik: "x", konfirmasiBukanGanda: true }, { "Idempotency-Key": kunci("by") });
    assert.equal(r.status, 400, `${tg}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, kode);
  }
  const pakai = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(2) }); assert.equal(pakai.res.status, 201, JSON.stringify(pakai.res.body)); assert.equal(await saldo(m.id), 3);
  const prUbah = await w.a.post(`/api/production/units/${w.unit.id}/perubahan-pemakaian/pratinjau`, { materialId: m.id, qtyBaru: 4, tanggalPemakaian: tgl(5) }); assert.equal(prUbah.status, 200, JSON.stringify(prUbah.body));
  assert.ok(prUbah.body.penghalang.some((x) => x.kode === "PEMAKAIAN_PRA_SO"), JSON.stringify(prUbah.body.penghalang)); assert.equal(prUbah.body.boleh, false);
  const apUbah = await w.a.post(`/api/production/units/${w.unit.id}/perubahan-pemakaian`, { materialId: m.id, qtyBaru: 4, tanggalPemakaian: tgl(5), alasan: "Uji: menambah pemakaian pra-SO", dilihat: prUbah.body.sidik }, { "Idempotency-Key": kunci("ub") });
  assert.equal(prUbah.body.jalur, "LANGSUNG", "uji harus menempuh jalur LANGSUNG agar penolakan benar-benar dari pengaman pra-SO"); assert.equal(apUbah.body.code, "PEMAKAIAN_PRA_SO", JSON.stringify(apUbah.body));
  assert.ok(apUbah.status >= 400 && apUbah.status < 500, `ubah jumlah pra-SO harus ditolak: ${apUbah.status} ${JSON.stringify(apUbah.body)}`); assert.equal(await saldo(m.id), 3);
  const prKurang = await w.a.post(`/api/production/units/${w.unit.id}/perubahan-pemakaian/pratinjau`, { materialId: m.id, qtyBaru: 1, tanggalPemakaian: tgl(5) }); assert.equal(prKurang.status, 200);
  assert.ok(!prKurang.body.penghalang.some((x) => x.kode === "PEMAKAIAN_PRA_SO"), "pengurangan (RETURN) tidak ditahan oleh pengaman pra-SO");
  const { unit: berjalan } = await createTestUnit({ status: "IN_PRODUCTION", createdAt: new Date(Date.now() - 20 * HARI) });
  const mv = await w.l.post(`/api/units/${berjalan.id}/materials`, { materialId: m.id, qty: 1 }, { "Idempotency-Key": kunci("jalan") }); assert.equal(mv.status, 201, JSON.stringify(mv.body));
  const baris = await testPrisma.stockMovement.findUnique({ where: { id: mv.body.id } }); assert.equal(wib(baris.createdAt), tgl(0), "pemakaian unit berjalan bertanggal HARI INI (setelah SO)");
});

test("G4. LIST WIBING SESUDAH master menjadi METER: meter TIDAK dibagi 90 lagi; ROLL ditolak; sebelum transisi tetap dikonversi (bukti aturan tidak ganda)", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: `LIST-WIBING-UJI-${++seq}`, name: "LIST WIBING UJI", unit: "ROLL" });
  await seedBalance(m.id, 10, { unitCost: 85000 * 1, createdAt: new Date(Date.now() - 41 * HARI) });
  // sebelum transisi: 90 METER = 1 ROLL (aturan bawaan Owner)
  const pra = await catat(w, { materialId: m.id, qty: 90, satuan: "METER" }, { tanggal: tgl(1) }); assert.equal(pra.res.status, 201, JSON.stringify(pra.res.body)); assert.equal(await saldo(m.id), 9, "90 METER = 1 ROLL");
  // transisi ROLL → METER (hasil SO 180 METER), kewajiban +10 ROLL tetap terbuka
  const minta = { materialId: m.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: [{ rujukan: "GR-051126-02", jumlah: 10, satuan: "ROLL", keterangan: "penerimaan satuan lama belum diterjemahkan" }] };
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta] }); assert.equal(p.bolehDiterapkan, true, JSON.stringify(p.transisi[0].penghalang));
  await terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ ...minta, hashPratinjau: p.transisi[0].hash }], sumber: "SO uji", alasan: "Satuan operasional mengikuti Excel SO", rujukanHash: "hash-manifest-so-uji-0002", kunci: kunci("tr"), tautan: { soTanggal: tgl(1), sumber: "SO uji", alasan: "Tautan SO dalam transisi satuan uji", rujukanHash: "hash-manifest-so-uji-0002" } });
  assert.equal(await saldo(m.id), 180);
  const meter = await catat(w, { materialId: m.id, qty: 3.4, satuan: "METER", konfirmasiBukanGanda: true }, { tanggal: tgl(0) }); assert.equal(meter.res.status, 201, JSON.stringify(meter.res.body));
  assert.equal(await saldo(m.id), 176.6, "3,4 METER mengurangi 3,4 METER (BUKAN 3,4÷90)");
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: meter.res.body.id } }); assert.ok(!/\[pakai /.test(mv.note ?? ""), "tidak ada penanda konversi: tidak ada aturan ganda"); assert.equal(Number(mv.qty), -3.4);
  const tanpa = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(0) }); assert.equal(tanpa.res.status, 201, JSON.stringify(tanpa.res.body)); assert.equal(await saldo(m.id), 174.6, "tanpa satuan = satuan master (METER)");
  const roll = await catat(w, { materialId: m.id, qty: 1, satuan: "ROLL", konfirmasiBukanGanda: true }, { tanggal: tgl(0) }); assert.ok(roll.res.status >= 400, `ROLL pada master METER harus ditolak: ${roll.res.status}`); assert.equal(await saldo(m.id), 174.6);
});

test("H7. jalur KOREKSI pemakaian (ajukan + setujui): penambahan bertanggal pra-SO ditahan di pengajuan; pengurangan dan koreksi tanpa klaim tanggal historis tetap sah dan terposting", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  const pakai = await catat(w, { materialId: m.id, qty: 2, konfirmasiBukanGanda: true }, { tanggal: tgl(2) }); assert.equal(pakai.res.status, 201, JSON.stringify(pakai.res.body)); assert.equal(await saldo(m.id), 3);
  const tambah = await w.l.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian`, { materialId: m.id, qtyBaru: 4, alasan: "Uji: menambah pemakaian bertanggal pra-SO", tanggalPemakaian: tgl(5) }, { "Idempotency-Key": kunci("kt") });
  assert.equal(tambah.status, 409, JSON.stringify(tambah.body)); assert.equal(tambah.body.code, "KOREKSI_PRA_SO"); assert.equal(await testPrisma.warehouseCorrection.count(), 0, "tidak ada pengajuan tersimpan");
  const kurang = await w.l.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian`, { materialId: m.id, qtyBaru: 1, alasan: "Uji: mengurangi pemakaian (retur sah)", tanggalPemakaian: tgl(5) }, { "Idempotency-Key": kunci("kk") });
  assert.ok(kurang.status === 201 || kurang.status === 200, JSON.stringify(kurang.body)); const id = kurang.body.id ?? kurang.body.koreksi?.id; assert.ok(id, JSON.stringify(kurang.body));
  const { setujuiKoreksiPemakaian } = await import("../../src/services/koreksiPemakaian.js");
  await setujuiKoreksiPemakaian(testPrisma, { koreksiId: id, aktor: w.A }); assert.equal(await saldo(m.id), 4, "pengurangan pemakaian (RETURN) terposting: stok bertambah 1");
});
