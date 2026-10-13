// Uang Muka Supplier (PO): logika murni + pemasangan layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statusMelebihi, kesiapanBayarUangMuka, bodyBayarUangMuka, kesiapanTerapkan, bodyTerapkanUangMuka, kalimatEventUangMuka, KALIMAT_UANG_MUKA } from "../src/features/finance/uangMukaLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const FORM = { amount: 4_000_000, date: "2026-10-13", cashAccountId: "bank1", receiptUrl: "/media/finance-receipts/abc.jpg", reference: " TRF-1 ", notes: "", paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: "" };

test("statusMelebihi: hanya perbandingan peringatan dini (server memutuskan); tepat sama dengan nilai PO tidak melebihi", () => {
  assert.deepEqual(statusMelebihi({ nilaiPO: 6_000_000, uangMukaDibayar: 0, nominal: 4_000_000 }), { melebihi: false, kelebihan: 0, totalSesudah: 4_000_000 });
  assert.equal(statusMelebihi({ nilaiPO: 6_000_000, uangMukaDibayar: 4_000_000, nominal: 2_000_000 }).melebihi, false);
  assert.deepEqual(statusMelebihi({ nilaiPO: 6_000_000, uangMukaDibayar: 4_000_000, nominal: 2_500_000 }), { melebihi: true, kelebihan: 500_000, totalSesudah: 6_500_000 });
  assert.equal(statusMelebihi({ nilaiPO: 1, uangMukaDibayar: 0, nominal: "" }).melebihi, false);
});

test("kesiapan bayar: nominal, tanggal, rekening, biaya admin lengkap, dan BUKTI wajib; melebihi PO butuh Admin + konfirmasi + alasan ≥5", () => {
  assert.equal(kesiapanBayarUangMuka({ f: FORM }).siap, true);
  assert.match(kesiapanBayarUangMuka({ f: { ...FORM, amount: "" } }).pesan, /nominal/i);
  assert.match(kesiapanBayarUangMuka({ f: { ...FORM, date: "" } }).pesan, /tanggal/i);
  assert.match(kesiapanBayarUangMuka({ f: { ...FORM, cashAccountId: "" } }).pesan, /rekening/i);
  assert.match(kesiapanBayarUangMuka({ f: { ...FORM, receiptUrl: "  " } }).pesan, /bukti/i);
  assert.match(kesiapanBayarUangMuka({ f: FORM, rekeningLengkap: false }).pesan, /biaya admin/i);
  assert.match(kesiapanBayarUangMuka({ f: FORM, melebihi: true, admin: false }).pesan, /hanya Admin Finance/);
  assert.match(kesiapanBayarUangMuka({ f: FORM, melebihi: true, admin: true }).pesan, /konfirmasi/);
  assert.match(kesiapanBayarUangMuka({ f: { ...FORM, konfirmasiMelebihi: true, alasanMelebihi: "abc" }, melebihi: true, admin: true }).pesan, /minimal 5/);
  assert.equal(kesiapanBayarUangMuka({ f: { ...FORM, konfirmasiMelebihi: true, alasanMelebihi: "Titip pesanan berikutnya" }, melebihi: true, admin: true }).siap, true);
});

test("body bayar: hanya kolom yang dikenal server; biaya admin lewat bodyBiayaTransfer (preset tanpa nominal); kolom melebihi hanya saat melebihi", () => {
  const b = JSON.parse(JSON.stringify(bodyBayarUangMuka(FORM))); // yang terkirim ke server (kunci undefined tidak ikut)
  assert.deepEqual(Object.keys(b).sort(), ["amount", "cashAccountId", "date", "paymentMethod", "receiptUrl", "reference", "transferFeeType"].sort());
  assert.equal(b.reference, "TRF-1"); assert.equal(b.amount, 4_000_000); assert.equal("transferFeeAmount" in b, false, "preset: nominal biaya dihitung server");
  const m = bodyBayarUangMuka({ ...FORM, konfirmasiMelebihi: true, alasanMelebihi: " Titip pesanan " }, { melebihi: true });
  assert.equal(m.konfirmasiMelebihi, true); assert.equal(m.alasanMelebihi, "Titip pesanan");
  assert.equal("konfirmasiMelebihi" in bodyBayarUangMuka({ ...FORM, konfirmasiMelebihi: true }), false);
});

test("kesiapan terapkan: ≤ saldo uang muka, ≤ sisa faktur, konfirmasi Finance wajib; beda PO butuh konfirmasi tambahan; body tanpa kolom keuangan lain", () => {
  const dp = { id: "u1", saldoBelumDiterapkan: 4_000_000, bedaPO: false };
  assert.equal(kesiapanTerapkan({ uangMuka: dp, nominal: 4_000_000, sisaFaktur: 6_000_000, konfirmasi: true }).siap, true);
  assert.match(kesiapanTerapkan({ uangMuka: null, nominal: 1, sisaFaktur: 1, konfirmasi: true }).pesan, /Pilih uang muka/);
  assert.match(kesiapanTerapkan({ uangMuka: dp, nominal: 0, sisaFaktur: 1, konfirmasi: true }).pesan, /nominal/i);
  assert.match(kesiapanTerapkan({ uangMuka: dp, nominal: 4_000_001, sisaFaktur: 9_000_000, konfirmasi: true }).pesan, /saldo uang muka/);
  assert.match(kesiapanTerapkan({ uangMuka: dp, nominal: 3_000_000, sisaFaktur: 2_000_000, konfirmasi: true }).pesan, /sisa faktur/);
  assert.match(kesiapanTerapkan({ uangMuka: dp, nominal: 1, sisaFaktur: 1, konfirmasi: false }).pesan, /konfirmasi/);
  assert.match(kesiapanTerapkan({ uangMuka: { ...dp, bedaPO: true }, nominal: 1, sisaFaktur: 1, konfirmasi: true }).pesan, /PO lain/);
  assert.equal(kesiapanTerapkan({ uangMuka: { ...dp, bedaPO: true }, nominal: 1, sisaFaktur: 1, konfirmasi: true, konfirmasiBedaPO: true }).siap, true);
  assert.deepEqual(bodyTerapkanUangMuka({ uangMuka: dp, billId: "b1", nominal: "4000000", sisaFaktur: 6_000_000 }), { advanceId: "u1", billId: "b1", amount: 4_000_000, konfirmasi: true, sisaFakturDilihat: 6_000_000 });
  assert.equal(bodyTerapkanUangMuka({ uangMuka: dp, billId: "b1", nominal: 1, sisaFaktur: 1, konfirmasiBedaPO: true, catatan: " pindah " }).konfirmasiBedaPO, true);
});

test("kalimat riwayat PO untuk uang muka (metadata server); jenis lain null", () => {
  assert.match(kalimatEventUangMuka({ type: "UANG_MUKA_DIBAYAR", metadata: { dokumen: "PUR-1", jumlah: "4000000.00", biayaAdmin: "2500.00" } }), /Uang muka PUR-1 dibayar Rp4\.000\.000 \(\+ biaya admin Rp2\.500\)/);
  assert.match(kalimatEventUangMuka({ type: "UANG_MUKA_DIBAYAR", metadata: { dokumen: "PUR-1", jumlah: "1", melebihiPO: true } }), /melebihi nilai PO/);
  assert.match(kalimatEventUangMuka({ type: "UANG_MUKA_DITERAPKAN", metadata: { uangMuka: "PUR-1", faktur: "BILL-1", jumlah: "4000000", sisaFakturSebelum: "6000000", sisaFakturSesudah: "2000000" } }), /diterapkan Rp4\.000\.000 ke faktur BILL-1 · sisa faktur Rp6\.000\.000 → Rp2\.000\.000/);
  assert.match(kalimatEventUangMuka({ type: "UANG_MUKA_PENERAPAN_DIBATALKAN", note: "salah", metadata: { uangMuka: "PUR-1", faktur: "BILL-1", jumlah: "1000" } }), /dibatalkan — salah/);
  assert.equal(kalimatEventUangMuka({ type: "DIBUAT" }), null);
  assert.match(KALIMAT_UANG_MUKA, /aset.*bukan stok.*bukan biaya.*belum menjadi utang/);
});

test("pemasangan: api, PO (tombol Bayar Uang Muka, dua kelompok, tooltip, peringatan batal, terapkan di kartu faktur), Supplier & Utang (kartu, tabel per supplier, menu faktur, export); UI berbahasa Indonesia", () => {
  const api = baca("../src/api.js");
  assert.match(api, /bayarUangMukaPO: \(poId, data, idempotencyKey\)/); assert.match(api, /\/uang-muka\/terapkan/); assert.match(api, /penerapan\/\$\{id\}\/batal/); assert.match(api, /getUangMukaSupplierRingkasan/);
  const um = baca("../src/features/finance/UangMukaPO.jsx");
  for (const t of ["A. Pemenuhan barang", "B. Keuangan", "Nilai PO", "Uang muka dibayar", "Sudah ditagih", "Uang muka diterapkan", "Utang tercatat", "Sudah dibayar atas faktur", "Sisa utang", "Sisa komitmen PO", "Datang fisik", "Belum datang", "Diterima bersih dari PO", "Masuk stok", "Uang muka perlu dikembalikan atau dialihkan", "Bayar Uang Muka", "Terapkan Uang Muka", "Bukti transfer"]) assert.ok(um.includes(t), t);
  assert.match(um, /title=\{definisi\}/); assert.match(um, /aria-label=\{`Arti \$\{label\}`\}/, "definisi bisa dibuka di layar sentuh");
  assert.doesNotMatch(um, /Sisa Utang"[^<]*sisaKomitmen|\bsisaKomitmen\b[^\n]{0,60}"Sisa utang"/, "sisa komitmen tidak diberi label utang");
  assert.doesNotMatch(um, /\b(Upload|Cancel|Save|Loading|Retry|Delete|Submit|Pay)\b/);
  const po = baca("../src/pages/finance/FinancePurchaseOrders.jsx");
  assert.match(po, /data-testid="bayar-uang-muka"/); assert.match(po, /<PanelKelompokPO po=\{po\} \/>/); assert.match(po, /<PeringatanUangMukaPO po=\{po\} \/>/); assert.match(po, /<DaftarUangMukaPO/); assert.match(po, /data-testid="terapkan-uang-muka"/); assert.match(po, /<ModalBayarUangMuka/); assert.match(po, /<ModalTerapkanUangMuka/);
  const sup = baca("../src/pages/finance/FinanceSuppliers.jsx");
  assert.match(sup, /Uang Muka Supplier Belum Diterapkan/); assert.match(sup, /<TabelUangMukaSupplier/); assert.match(sup, /modul="uang-muka-supplier"/); assert.match(sup, /label: "Terapkan Uang Muka"/); assert.match(sup, /<ModalTerapkanUangMuka/);
  assert.match(sup, /Sisa utang faktur yang sudah DISETUJUI/, "kartu Utang Aktif hanya faktur disetujui");
});
