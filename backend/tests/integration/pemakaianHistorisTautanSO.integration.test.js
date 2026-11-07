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
import { tautkanSO } from "../../src/services/pengamanHistorisPascaSO.js";
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
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const { unit } = await createTestUnit({ status: "DELIVERED", createdAt: new Date(Date.now() - 20 * HARI) });
  return { lead, owner, B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, l: makeClient(server.baseUrl, lead.token), unit };
}
async function bahanBerSO(w, { unit = "METER", saldoSO = 5, kode = `KAIN-SO-${++seq}`, soHariLalu = 2 } = {}) {
  const m = await createTestMaterial({ code: kode, name: `BAHAN ${kode}`, unit });
  await seedBalance(m.id, saldoSO, { unitCost: 20000, createdAt: new Date(Date.now() - 41 * HARI) });
  const t = await tautkanSO(testPrisma, { aktor: w.B, materialId: m.id, soTanggal: tgl(soHariLalu), sumber: "SO uji (berkas dan rencana)", alasan: "Hasil SO ditautkan eksplisit untuk uji pengaman", rujukanHash: "hash-manifest-so-uji-0001", kunci: kunci("taut") });
  return { m, t };
}
async function catat(w, body, { tanggal, k = kunci("pk") } = {}) {
  const pra = await w.l.post(PRA(w), { materialId: body.materialId, jenis: "TAMBAH", qty: Math.abs(body.qty), tanggalPemakaian: tanggal, satuan: body.satuan, pengecualianStokTidakCukup: body.pengecualianStokTidakCukup === true });
  const kirim = { alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tanggal, saldoDilihat: pra.body?.stok?.saldoDilihat, hppSidik: pra.body?.hppOperasional?.sidik, ...body };
  return { pra, res: await w.l.post(`/api/units/${w.unit.id}/materials`, kirim, { "Idempotency-Key": k }) };
}

test("G1. tautan SO aktif: 'Tetap catat' untuk pemakaian PRA-SO ditolak (pratinjau DAN pencatatan), stok tidak berkurang dua kali, tidak ada ISSUE", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 2 }); const mov0 = await testPrisma.stockMovement.count({ where: { type: "ISSUE" } });
  const r = await catat(w, { materialId: m.id, qty: 8, ...EXC }, { tanggal: tgl(4) });
  assert.equal(r.pra.status, 200); const h = r.pra.body.penghalang.find((x) => x.kode === "SALDO_KURANG");
  assert.ok(h && h.bisaDikecualikan === false, `pratinjau harus menyatakan TIDAK bisa dikecualikan: ${JSON.stringify(r.pra.body.penghalang)}`); assert.match(h.sebabTidakBisaDikecualikan ?? "", /tautan SO|hasil SO/i);
  assert.equal(r.res.status, 409, JSON.stringify(r.res.body)); assert.equal(r.res.body.code, "PENGECUALIAN_MELINTASI_OPNAME");
  assert.equal(await saldo(m.id), 5, "saldo hasil SO tidak boleh berkurang"); assert.equal(await testPrisma.stockMovement.count({ where: { type: "ISSUE" } }), mov0);
});

test("G2. tanggal pemakaian SAMA dengan tanggal SO juga ditolak (urutan dalam satu hari tak terbukti); SESUDAH tanggal SO pengecualian tetap bekerja seperti biasa", async () => {
  const w = await dunia(); const { m } = await bahanBerSO(w, { saldoSO: 5, soHariLalu: 3 });
  const sama = await catat(w, { materialId: m.id, qty: 8, ...EXC }, { tanggal: tgl(3) }); assert.equal(sama.res.status, 409, JSON.stringify(sama.res.body)); assert.equal(await saldo(m.id), 5);
  const sesudah = await catat(w, { materialId: m.id, qty: 8, ...EXC }, { tanggal: tgl(1) }); assert.equal(sesudah.res.status, 201, JSON.stringify(sesudah.res.body)); assert.equal(await saldo(m.id), -3);
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: sesudah.res.body.id } }); assert.ok(mv.reason.includes(ALASAN));
});

test("G3. bahan TANPA tautan SO: perilaku lama utuh (pengecualian berlaku untuk pemakaian pra-tanggal bila tidak ada opname/persediaan awal)", async () => {
  const w = await dunia(); const polos = await createTestMaterial({ code: `KAIN-POLOS-${++seq}`, name: "POLOS", unit: "METER" }); await seedBalance(polos.id, 5, { unitCost: 20000, createdAt: new Date(Date.now() - 41 * HARI) });
  const a = await catat(w, { materialId: polos.id, qty: 8, ...EXC }, { tanggal: tgl(4) }); assert.equal(a.res.status, 201, JSON.stringify(a.res.body)); assert.equal(await saldo(polos.id), -3);
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
