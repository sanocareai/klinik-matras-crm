// Fungsi MURNI representasi multi-unit Order CRM Penjualan Karyawan (lib/domain/pkrUnitBaris.js) — tanpa database.
import test from "node:test";
import assert from "node:assert/strict";
import { susunBarisUnitPkr, rencanaUnit, deliveryUnit, LABEL_UNIT } from "../src/lib/domain/pkrUnitBaris.js";

const unit = (seq, extra = {}) => ({ id: `u${seq}`, unitCode: `NEW-11102026-023-U${seq}`, seq, status: "RECEIVED", merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", currentStageId: null, currentStage: null, productionDueAt: null, productionRunsV2: [], jobUnits: [], ...extra });
const itemVirtual = { no: 1, kategoriNama: "Kasur Baru", produk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", spesifikasi: null, perluDikirim: true, unit: [1, 2, 3].map((n) => ({ kode: `NEW-11102026-023-U${n}` })) };
const order = { status: "PENDING", pkrPerluDikirim: true };

test("3 unit → 3 sub-baris berurutan '1 dari 3' … '3 dari 3', ID & kode unik, ringkasan induk dari status unit", () => {
  const { baris, ringkas } = susunBarisUnitPkr({ order, units: [unit(1), unit(2), unit(3)], items: [itemVirtual] });
  assert.deepEqual(baris.map((b) => b.urutanLabel), ["1 dari 3", "2 dari 3", "3 dari 3"]);
  assert.equal(new Set(baris.map((b) => b.id)).size, 3);
  assert.deepEqual(ringkas, { total: 3, dibatalkan: 0, dijadwalkan: 0, sedangDiproduksi: 0, siap: 0, dalamPengiriman: 0, terkirim: 0 });
  assert.equal(baris[0].item.nama, "Kasur Sorong 3in1 custom");
  assert.equal(baris[0].ukuran, "100 x 200");
  assert.equal(baris[0].produksi.label, LABEL_UNIT.RECEIVED);
  assert.equal(baris[0].rencana, null);
  assert.equal(baris[0].kirim.label, "Dikirim");
});

test("ringkasan induk: siap/diproduksi/terkirim dihitung per unit, bukan agregat order", () => {
  const units = [unit(1, { status: "READY_FOR_DELIVERY" }), unit(2, { status: "IN_PRODUCTION" }), unit(3, { status: "DELIVERED" })];
  const { ringkas, baris } = susunBarisUnitPkr({ order, units, items: [itemVirtual] });
  assert.equal(ringkas.siap, 1);
  assert.equal(ringkas.sedangDiproduksi, 1);
  assert.equal(ringkas.terkirim, 1);
  assert.equal(ringkas.total, 3);
  assert.equal(baris[2].delivery.kode, "COMPLETED");
});

test("unit dibatalkan tidak dihitung dan tidak tampil; 'n dari N' memakai jumlah unit aktif", () => {
  const { baris, ringkas } = susunBarisUnitPkr({ order, units: [unit(1), unit(2, { status: "CANCELLED" }), unit(3)], items: [itemVirtual] });
  assert.equal(baris.length, 2);
  assert.deepEqual(baris.map((b) => b.urutanLabel), ["1 dari 2", "2 dari 2"]);
  assert.equal(ringkas.dibatalkan, 1);
});

test("rencana: dari plan V2 (target, PIC, meja); plan DIBATALKAN / tanpa data = null; cadangan productionDueAt tanpa PIC", () => {
  const plan = (p) => unit(1, { productionRunsV2: [{ status: "ACTIVE", plan: p }] });
  const r = rencanaUnit(plan({ status: "PLANNED", productionDate: new Date("2026-10-13T00:00:00Z"), targetDate: new Date("2026-10-14T00:00:00Z"), stationCode: "TABLE_1", operator: { user: { name: "Budi" } }, cornerOperator: null }));
  assert.deepEqual(r, { tanggalProduksi: "2026-10-13", target: "2026-10-14", stasiun: "TABLE_1", pic: "Budi", picCorner: null, status: "PLANNED" });
  assert.equal(rencanaUnit(plan({ status: "CANCELLED", productionDate: new Date("2026-10-13"), operator: null })), null);
  assert.equal(rencanaUnit(plan({ status: "DRAFT", productionDate: null, targetDate: null, stationCode: null, operator: null })), null);
  const due = rencanaUnit(unit(1, { productionDueAt: new Date("2026-10-20T03:00:00Z") }));
  assert.equal(due.target, "2026-10-20");
  assert.equal(due.pic, null);
  const { ringkas } = susunBarisUnitPkr({ order, units: [plan({ status: "PLANNED", productionDate: new Date("2026-10-13"), operator: null }), unit(2), unit(3)], items: [itemVirtual] });
  assert.equal(ringkas.dijadwalkan, 1);
});

test("delivery: satu job menaungi 3 unit → ketiganya menunjuk job yang sama; diambil sendiri/belum ditentukan tanpa job; job lama tanpa JobUnit berlaku untuk semua", () => {
  const job = { id: "J1", type: "DELIVERY", status: "ASSIGNED", scheduledDate: new Date("2026-10-14T00:00:00Z"), createdAt: new Date("2026-10-12") };
  const units = [1, 2, 3].map((n) => unit(n, { status: "READY_FOR_DELIVERY", jobUnits: [{ job }] }));
  const { baris } = susunBarisUnitPkr({ order, units, items: [itemVirtual], jobsOrder: [{ ...job, unitIds: ["u1", "u2", "u3"] }] });
  assert.deepEqual(new Set(baris.map((b) => b.delivery.jobId)), new Set(["J1"]));
  assert.equal(baris[0].delivery.tanggal, "2026-10-14");
  assert.equal(baris[0].delivery.label, "Terjadwal (driver ditetapkan)");

  const lama = susunBarisUnitPkr({ order, units: [unit(1, { status: "READY_FOR_DELIVERY" })], items: [itemVirtual], jobsOrder: [{ ...job, unitIds: [] }] });
  assert.equal(lama.baris[0].delivery.jobId, "J1", "job lama tanpa JobUnit berlaku untuk unit order");

  const ambil = deliveryUnit({ order, unit: unit(1), perluDikirim: false, jobsOrder: [] });
  assert.equal(ambil.kode, "AMBIL_SENDIRI");
  const belum = deliveryUnit({ order, unit: unit(1), perluDikirim: null, jobsOrder: [] });
  assert.equal(belum.kode, "BELUM_DITENTUKAN");
  const tanpaJob = deliveryUnit({ order, unit: unit(1, { status: "READY_FOR_DELIVERY" }), perluDikirim: true, jobsOrder: [] });
  assert.equal(tanpaJob.label, "Siap kirim — job belum terbentuk");
  assert.equal(tanpaJob.kode, "BELUM_ADA_JOB");
  const belumSiap = deliveryUnit({ order, unit: unit(1), perluDikirim: true, jobsOrder: [] });
  assert.equal(belumSiap.kode, "MENUNGGU_PRODUKSI");
  assert.equal(deliveryUnit({ order: { status: "CANCELLED" }, unit: unit(1), perluDikirim: true, jobsOrder: [] }).kode, "DIBATALKAN");
});

test("per item: unit milik item berbeda menampilkan nama & kirim/ambil item masing-masing (multi-item)", () => {
  const items = [
    { no: 1, produk: "Kasur Sano 160", ukuran: "160 x 200", perluDikirim: true, unit: [{ kode: "NEW-11102026-023-U1" }] },
    { no: 2, produk: "Divan", ukuran: "160 x 200", spesifikasi: "Kain abu", perluDikirim: false, unit: [{ kode: "NEW-11102026-023-U2" }] },
  ];
  const { baris } = susunBarisUnitPkr({ order, units: [unit(1, { merk: null }), unit(2, { merk: null })], items });
  assert.equal(baris[0].item.nama, "Kasur Sano 160");
  assert.equal(baris[1].item.nama, "Divan");
  assert.equal(baris[1].spesifikasi, "Kain abu");
  assert.equal(baris[1].kirim.label, "Diambil sendiri");
  assert.equal(baris[1].delivery.kode, "AMBIL_SENDIRI");
});
