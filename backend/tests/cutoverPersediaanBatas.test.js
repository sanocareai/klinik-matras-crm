// Batas cutover persediaan: hari bisnis WIB, penerimaan terlambat, presisi kuantitas snapshot.
import test from "node:test";
import assert from "node:assert/strict";
import { hariBisnisWIB } from "../src/services/finance/posting/inventory.js";
import { hashIsi, penerimaanTercakupPembuka, penerimaanTertutupPeriodik } from "../src/services/finance/persediaanAwal.js";

const iso = (d) => d.toISOString().slice(0, 10);

test("hari bisnis: stempel 00.00-06.59 WIB masuk hari WIB, bukan hari UTC", () => {
  assert.equal(iso(hariBisnisWIB(new Date("2026-11-08T21:30:00.000Z"))), "2026-11-09");
  assert.equal(iso(hariBisnisWIB(new Date("2026-11-30T17:00:01.000Z"))), "2026-12-01");
  assert.equal(iso(hariBisnisWIB(new Date("2026-11-09T10:00:00.000Z"))), "2026-11-09");
});

test("hari bisnis: kolom tanggal (tengah malam UTC) dan string tidak bergeser", () => {
  assert.equal(iso(hariBisnisWIB(new Date("2026-11-01T00:00:00.000Z"))), "2026-11-01");
  assert.equal(hariBisnisWIB("2026-11-01"), "2026-11-01");
});

// tx palsu: PSA aktif dengan waktu hitung 8 Nov 23.59 WIB, cutover 9 Nov.
const countedAt = new Date("2026-11-08T16:59:00.000Z");
const txPalsu = ({ receiptSesudah, jurnal = null, gr = { receivedDate: new Date("2026-11-01T00:00:00.000Z"), createdAt: new Date("2026-11-01T02:00:00.000Z") } }) => ({
  finSetting: { findUnique: async ({ where }) => (where.key === "inventory_perpetual_cutover_date" ? { value: "2026-11-09" } : where.key === "inventory_method_before_cutover" ? { value: "PERIODIK" } : null) },
  finInventoryOpening: { findFirst: async () => ({ id: "o1", number: "PSA-1", cutoverDate: new Date("2026-11-09T00:00:00.000Z"), countedAt, journalEntryId: "j", totalValue: 1 }) },
  stockMovement: { findFirst: async ({ where }) => { assert.equal(where.createdAt.gt.getTime(), countedAt.getTime()); return receiptSesudah ? { id: "m" } : null; } },
  goodsReceipt: { findUnique: async () => gr },
  finJournalEntry: { findUnique: async () => jurnal, findFirst: async () => jurnal },
});

test("penerimaan bertanggal sebelum cutover tetapi ditulis sesudah waktu hitung TIDAK dianggap tercakup", async () => {
  assert.equal(await penerimaanTercakupPembuka(txPalsu({ receiptSesudah: true }), "g1", new Date("2026-11-01T00:00:00.000Z")), false);
});

test("penerimaan yang sudah ada di ledger saat waktu hitung tetap tercakup, tidak dijurnal ganda", async () => {
  assert.equal(await penerimaanTercakupPembuka(txPalsu({ receiptSesudah: false }), "g1", new Date("2026-11-01T00:00:00.000Z")), true);
});

test("penerimaan bertanggal mulai cutover tidak pernah tercakup", async () => {
  assert.equal(await penerimaanTercakupPembuka(txPalsu({ receiptSesudah: false }), "g1", new Date("2026-11-09T00:00:00.000Z")), false);
});

test("tagihan penerimaan terlambat tidak diperlakukan periodik", async () => {
  assert.equal(await penerimaanTertutupPeriodik(txPalsu({ receiptSesudah: true }), "g1"), false);
  assert.equal(await penerimaanTertutupPeriodik(txPalsu({ receiptSesudah: false }), "g1"), true);
});

test("hash isi membedakan kuantitas sampai empat desimal", () => {
  const baris = (qty) => [{ materialId: "m", qty, unit: "CAN", unitCost: "649350", value: "1", priceSource: "LAINNYA", priceReference: "", priceNote: "" }];
  assert.notEqual(hashIsi(baris("17.2231")), hashIsi(baris("17.22")));
});
