// Resi Gabungan Fase 1 (frontend): logika pratinjau (Total Resi, DP 30%), validasi form, pemasangan tombol/flag, copy Bahasa Indonesia.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hitungRingkasan, bagiProporsional, galatForm, payloadResi, formKosong, itemKosong, DP_PERSEN, MAKS_ITEM } from "../src/features/resi/logika.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

test("Ringkasan: Total Resi = subtotal + Ongkir Tambahan; DP 30% dari total resi; sisa pelunasan", () => {
  const r = hitungRingkasan({ ongkirTambahan: "100000", items: [{ nominal: "1000000" }, { nominal: "500.000" }] });
  assert.equal(DP_PERSEN, 30);
  assert.deepEqual(r, { subtotal: 1_500_000, ongkirTambahan: 100_000, totalResi: 1_600_000, dpPersen: 30, dp: 480_000, sisaSetelahDp: 1_120_000 });
});

test("Ongkir Tambahan default 0; kosong/negatif tidak mengurangi total", () => {
  assert.equal(formKosong().ongkirTambahan, "0");
  assert.equal(hitungRingkasan({ ongkirTambahan: "", items: [{ nominal: "100" }] }).totalResi, 100);
  assert.equal(hitungRingkasan({ ongkirTambahan: "-5", items: [{ nominal: "100" }] }).totalResi, 100);
});

test("bagiProporsional berjumlah tepat", () => {
  assert.equal(bagiProporsional(100, [1, 1, 1]).reduce((s, x) => s + x, 0), 100);
});

test("Validasi form: pesan Indonesia untuk yang pasti ditolak server", () => {
  const ok = { ongkirTambahan: "0", items: [{ nominal: "1000", unitCount: 1 }] };
  assert.equal(galatForm(ok), null);
  assert.match(galatForm({ ...ok, items: [] }), /minimal berisi 1 item/);
  assert.match(galatForm({ ...ok, items: [{ nominal: "0", unitCount: 1 }] }), /Item 1: nominal harus lebih dari 0/);
  assert.match(galatForm({ ...ok, items: [{ nominal: "10", unitCount: 0 }] }), /jumlah unit harus 1 sampai 10/);
  assert.match(galatForm({ ...ok, ongkirTambahan: "-1" }), /Ongkir Tambahan harus bilangan bulat/);
  assert.match(galatForm({ ...ok, items: Array.from({ length: MAKS_ITEM + 1 }, () => ({ nominal: "1", unitCount: 1 })) }), /maksimal berisi 20 item/);
});

test("Payload: nominal angka, ongkir default 0, item apa adanya", () => {
  const f = { ...formKosong(), alamat: "Jl. A", ongkirTambahan: "", items: [{ ...itemKosong(), merk: "Sano", nominal: "1.200.000", unitCount: "2" }] };
  const p = payloadResi("c1", f);
  assert.equal(p.customerId, "c1");
  assert.equal(p.ongkirTambahan, 0);
  assert.deepEqual(p.items[0], { merk: "Sano", ukuran: "", keluhan: "", catatan: "", nominal: 1_200_000, unitCount: 2 });
});

test("UI: form memakai copy Resi Gabungan / Item dalam Resi / Ongkir Tambahan / DP 30% / Total Resi", () => {
  const s = baca("features/resi/BuatResiModal.jsx");
  for (const t of ["Buat Resi Gabungan", "Item dalam Resi", "Ongkir Tambahan", "Total Resi", "Tambah Item", "Sisa pelunasan", "Invoice anchor"]) assert.ok(s.includes(t), t);
  assert.match(s, /"DP " \+ DP_PERSEN \+ "%"/);
  assert.doesNotMatch(s, /Sign in|Cancel|Submit/);
});

test("Tombol Buat Resi hanya muncul bila flag server aktif (Customer 360, Inbox, Invoice)", () => {
  const os = baca("components/customer/OrderSection.jsx");
  assert.match(os, /resiAktif && <button[^>]*data-testid="buat-resi"/);
  assert.match(os, /\{resiAktif && <BuatResiModal/);
  const oh = baca("features/inbox/components/CustomerPanel/OrderHistoryList.jsx");
  assert.match(oh, /\{resiAktif && \(/);
  assert.match(oh, /Buat Resi \(banyak item\)/);
  const ip = baca("features/orders/InvoicePanel.jsx");
  assert.match(ip, /const resiTampil = resiAktif && orders\.length > 1/);
  assert.match(ip, /Resi Gabungan · /);
  assert.match(ip, /resiTampil \? "Total Resi" : "Total tagihan"/);
  const hook = baca("features/resi/useResiAktif.js");
  assert.match(hook, /gagal membaca = dianggap MATI|Gagal membaca = dianggap MATI/);
  assert.match(baca("api.js"), /buatResi: \(data\) => request\("\/resi", \{ method: "POST"/);
});
