// PEMBACA RIWAYAT + BIAYA sesudah transisi satuan bahan: satuan ASAL tidak tertimpa label satuan master baru, biaya tidak mencampur satuan, koreksi penambahan atas pemakaian lama tidak menjadi jalan pintas pra-SO.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauTransisi, terapkanTransisi, referensiSahPer } from "../../src/services/transisiSatuanBahan.js";
import { tautkanSO } from "../../src/services/pengamanHistorisPascaSO.js";
import { ambilPemakaianAktual } from "../../src/services/productionAdoptionService.js";
import { bacaJejakUnit } from "../../src/services/finance/biayaBahan.js";
import { dasarHargaRataRata } from "../../src/services/finance/posting/inventory.js";
import { ajukanKoreksiPemakaian } from "../../src/services/koreksiPemakaian.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const HARI = 86400_000; const HASH = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
let seq = 0; const kunci = (p = "k") => `${p}-${Date.now()}-${++seq}-uji-pembaca-satuan`;
const PAKAI = (r) => (Array.isArray(r) ? r : r.baris ?? r.pergerakan ?? []);

async function dunia({ transisi = true, tautanSoHariLalu = null } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const owner = await createTestUser({ roles: ["OWNER"] }); const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const B = { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }; const L = { id: lead.user.id, name: lead.user.name, roles: ["PRODUCTION_LEAD"] };
  const { unit } = await createTestUnit({ status: "DELIVERED", createdAt: new Date(Date.now() - 30 * HARI) });
  const m = await createTestMaterial({ code: `LIST-PEMBACA-${++seq}`, name: "LIST PEMBACA UJI", unit: "ROLL" });
  await seedBalance(m.id, 10, { type: "RECEIPT", unitCost: 100000, createdAt: new Date(Date.now() - 40 * HARI) });
  const lama = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -2, unitId: unit.id, createdAt: new Date(Date.now() - 10 * HARI), note: "Pemakaian lama (ROLL)", createdById: owner.user.id } });
  if (transisi) {
    const minta = { materialId: m.id, satuanBaru: "METER", saldoBaru: 720 };
    const p = await pratinjauTransisi(testPrisma, { aktor: B, transisi: [minta] }); assert.equal(p.bolehDiterapkan, true, JSON.stringify(p.transisi[0].penghalang));
    await terapkanTransisi(testPrisma, { aktor: B, transisi: [{ ...minta, hashPratinjau: p.transisi[0].hash }], sumber: "SO uji", alasan: "Satuan mengikuti Excel SO", rujukanHash: HASH, kunci: kunci("tr") });
    await new Promise((r) => setTimeout(r, 20));
  }
  if (tautanSoHariLalu != null) await tautkanSO(testPrisma, { aktor: B, materialId: m.id, soTanggal: wib(Date.now() - tautanSoHariLalu * HARI), sumber: "SO uji", alasan: "Hasil SO ditautkan eksplisit untuk uji", rujukanHash: "hash-manifest-so-uji-0001", kunci: kunci("taut") });
  return { owner, lead, B, L, unit, m, lama };
}

test("R1. pembaca pemakaian aktual unit (Produksi/Admin): baris lama berlabel ROLL, baris baru METER — bukan satuan master sekarang", async () => {
  const w = await dunia();
  await testPrisma.stockMovement.create({ data: { materialId: w.m.id, type: "ISSUE", qty: -5, unitId: w.unit.id, createdAt: new Date(), note: "Pemakaian baru (METER)", createdById: w.owner.user.id } });
  const rows = PAKAI(await ambilPemakaianAktual(testPrisma, w.unit.id)).filter((r) => r.materialId === w.m.id);
  assert.equal(rows.length, 2, JSON.stringify(rows.map((r) => [r.tipe, r.qty, r.satuan])));
  const lama = rows.find((r) => Math.abs(Number(r.qty)) === 2); const baru = rows.find((r) => Math.abs(Number(r.qty)) === 5);
  assert.equal(lama.satuan, "ROLL", "pemakaian lama tetap berlabel satuan ASAL"); assert.equal(baru.satuan, "METER");
});

test("R2. jejak biaya bahan per unit: satuan baris lama = ROLL, baru = METER", async () => {
  const w = await dunia();
  await testPrisma.stockMovement.create({ data: { materialId: w.m.id, type: "ISSUE", qty: -5, unitId: w.unit.id, createdAt: new Date(), note: "Pemakaian baru (METER)", createdById: w.owner.user.id } });
  const j = await bacaJejakUnit(testPrisma, w.unit.id, { izinHarga: false });
  const rows = (j.bahan ?? []).flatMap((b) => b.pergerakan ?? []).filter((r) => r.materialId === w.m.id);
  assert.equal(rows.length, 2, JSON.stringify(rows.map((r) => [r.qty, r.satuan])));
  assert.equal(rows.find((r) => Math.abs(r.qty) === 2).satuan, "ROLL"); assert.equal(rows.find((r) => Math.abs(r.qty) === 5).satuan, "METER");
});

test("R3. harga rata-rata tidak mencampur satuan: penerimaan ROLL (Rp100.000) tidak ikut menilai METER; tanpa penerimaan baru = null (gap), bukan angka karangan; menilai pergerakan lama tetap memakai harga ROLL", async () => {
  const w = await dunia();
  assert.equal((await dasarHargaRataRata(testPrisma, w.m.id)).harga, null, "sesudah transisi dan sebelum penerimaan METER berharga: tidak ada harga (bukan Rp100.000 per METER)");
  const sebelum = await dasarHargaRataRata(testPrisma, w.m.id, { asOf: new Date(Date.now() - 5 * HARI) });
  assert.equal(Number(sebelum.harga), 100000, "pergerakan lama (sebelum transisi) tetap dinilai dari harga satuan lamanya");
  await seedBalance(w.m.id, 90, { type: "RECEIPT", unitCost: 1000, createdAt: new Date() });
  const sesudah = await dasarHargaRataRata(testPrisma, w.m.id);
  assert.equal(Number(sesudah.harga), 1000, `rata-rata hanya dari penerimaan METER: ${sesudah.harga}`);
});

test("R3b. bahan tanpa transisi tidak berubah: rata-rata tertimbang tetap seperti sebelumnya", async () => {
  const w = await dunia({ transisi: false });
  await seedBalance(w.m.id, 10, { type: "RECEIPT", unitCost: 120000, createdAt: new Date() });
  assert.equal(Number((await dasarHargaRataRata(testPrisma, w.m.id)).harga), 110000);
});

test("R4. harga referensi (per satuan asal) hanya sah untuk baris satuan asal: baris ROLL sah, baris METER tidak; bahan tanpa transisi selalu sah", async () => {
  const w = await dunia();
  const baru = await testPrisma.stockMovement.create({ data: { materialId: w.m.id, type: "ISSUE", qty: -5, unitId: w.unit.id, createdAt: new Date(), createdById: w.owner.user.id } });
  const biasa = await createTestMaterial({ code: `BIASA-${++seq}`, name: "BIASA", unit: "KG" }); await seedBalance(biasa.id, 10);
  const rows = await testPrisma.stockMovement.findMany({ where: { materialId: { in: [w.m.id, biasa.id] } }, select: { id: true, materialId: true, unitAtEntry: true, qty: true, type: true } });
  const sah = await referensiSahPer(testPrisma, rows);
  assert.equal(sah(rows.find((r) => r.id === w.lama.id)), true, "baris lama (ROLL) sah"); assert.equal(sah(rows.find((r) => r.id === baru.id)), false, "baris METER tidak boleh dinilai dengan referensi per ROLL");
  assert.equal(sah(rows.find((r) => r.materialId === biasa.id)), true);
});

// ── Koreksi penambahan atas pemakaian LAMA tanpa tanggal historis ──
async function ajukan(w, over = {}) {
  return ajukanKoreksiPemakaian(testPrisma, { unitId: w.unit.id, materialId: w.m.id, qtyBaru: 3, alasan: "Pemakaian sebenarnya lebih banyak dari catatan", kunci: kunci("kor"), aktor: w.L, ...over });
}

test("R5. koreksi PENAMBAHAN atas pemakaian lama (asal sebelum/pada tanggal SO) tanpa tanggal pemakaian ditahan — juga bila tanggal klaim sebelum SO; saldo dan pergerakan tidak berubah", async () => {
  const w = await dunia({ transisi: false, tautanSoHariLalu: 2 }); // SO 2 hari lalu; pemakaian asal 10 hari lalu
  await seedBalance(w.m.id, 50, { type: "RECEIPT", unitCost: 100000, createdAt: new Date() });
  const hitung = async () => [Number((await testPrisma.stockMovement.aggregate({ where: { materialId: w.m.id }, _sum: { qty: true } }))._sum.qty), await testPrisma.stockMovement.count({ where: { materialId: w.m.id } }), await testPrisma.warehouseCorrection.count()];
  const s0 = await hitung();
  const tanpa = await ajukan(w).then(() => null, (e) => e);
  assert.ok(tanpa, "harus ditahan"); assert.equal(tanpa.code ?? tanpa.kode, "KOREKSI_PRA_SO", String(tanpa?.message)); assert.match(String(tanpa.message), /tidak menyebut tanggal pemakaian sebenarnya/);
  const klaimLama = await ajukan(w, { tanggalPemakaian: wib(Date.now() - 5 * HARI), kunci: kunci("kor3") }).then(() => null, (e) => e);
  assert.ok(klaimLama && (klaimLama.code ?? klaimLama.kode) === "KOREKSI_PRA_SO", "tanggal klaim sebelum SO ditahan: " + String(klaimLama?.message));
  assert.deepEqual(await hitung(), s0, "tidak ada koreksi, pergerakan, atau perubahan saldo yang tertulis");
});

test("R5b. koreksi penambahan dengan tanggal pemakaian SESUDAH tanggal SO diajukan seperti biasa (belum mengubah stok)", async () => {
  const w = await dunia({ transisi: false, tautanSoHariLalu: 2 }); await seedBalance(w.m.id, 50, { type: "RECEIPT", unitCost: 100000, createdAt: new Date() });
  const k = await ajukan(w, { tanggalPemakaian: wib(Date.now()) }); assert.ok(k.id);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.m.id, type: "ISSUE" } }), 1, "hanya pemakaian asal; pengajuan belum menulis pergerakan");
});

test("R5c. koreksi PENGURANGAN (retur) atas pemakaian lama tidak disentuh aturan pra-SO", async () => {
  const w = await dunia({ transisi: false, tautanSoHariLalu: 2 });
  const k = await ajukan(w, { qtyBaru: 1 }); assert.ok(k.id);
});

test("R6. bahan TANPA tautan SO: koreksi penambahan tanpa tanggal tetap seperti semula (tidak ditahan oleh aturan pra-SO)", async () => {
  const w = await dunia({ transisi: false }); await seedBalance(w.m.id, 50, { type: "RECEIPT", unitCost: 100000, createdAt: new Date() });
  const k = await ajukan(w); assert.ok(k.id);
});
