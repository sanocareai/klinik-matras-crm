import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Redesign UI/UX Komplain: bahasa Indonesia natural, tanpa dropdown status teknis, aksi utama + Tindakan lainnya, daftar berhalaman (tanpa pemotongan 300 diam-diam), mode baca kasus tutup,
// biaya penanganan dibedakan dari pengeluaran Finance. Pin sumber (node --test, tanpa DOM); perilaku di browser dibuktikan QA UI lokal.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const baca = (p) => readFileSync(path.join(SRC, p), "utf8").replace(/\r\n/g, "\n");
const drawer = baca("features/complaints/ComplaintCaseDrawer.jsx"); const halaman = baca("pages/ComplaintCases.jsx"); const labels = baca("features/complaints/complaintLabels.js"); const api = baca("api.js");
const teksTampil = drawer + halaman;

test("istilah teknis lama tidak lagi tampil di UI (diganti bahasa natural)", () => {
  for (const lama of ["Root Cause", "Resolusi", "Material Requirement", "Ajukan Material", "Biaya Penyelesaian", "Ubah Status", "Aksi Lintas Divisi", "Objek Tertaut", "Pilih status berikutnya", "Konfirmasi Customer — Tandai SELESAI"]) {
    assert.ok(!teksTampil.includes(lama), `istilah lama masih tampil: ${lama}`);
  }
  for (const baru of ["Penyebab masalah", "Solusi yang disepakati", "Minta bahan", "Perkiraan biaya penanganan", "Tindakan lainnya", "Langkah berikutnya", "Yang sudah dijalankan", "Pilih cara menangani"]) assert.ok(teksTampil.includes(baru), `istilah baru hilang: ${baru}`);
  assert.ok(!/<select[^>]*>\s*<option value="">Pilih status berikutnya/.test(drawer), "tidak ada dropdown status teknis");
  assert.ok(!/transitions\.map|ALLOWED_TRANSITIONS\[kase\.status\]/.test(drawer), "daftar status mentah tidak dirender di drawer");
});

test("kalimat linimasa natural tetapi status rinci tetap disebut (jejak audit)", () => {
  assert.match(labels, /Tugas pengiriman dibuat/); assert.match(labels, /Bahan diminta ke Warehouse/); assert.match(labels, /Pelanggan mengonfirmasi — kasus selesai/);
  assert.match(labels, /Status berubah: \$\{STATUS_LABEL\[metadata\.from\]/);
  assert.ok(!/Material Requirement diajukan|Delivery Task dibuat|Customer mengonfirmasi komplain SELESAI/.test(labels));
});

test("gerbang konfirmasi pelanggan: SELESAI hanya lewat confirmComplaintCustomer setelah dialog konfirmasi; tidak ada transisi status ke SELESAI", () => {
  assert.match(drawer, /api\.confirmComplaintCustomer\(caseId\)/); assert.match(drawer, /Pastikan pelanggan sudah menyatakan puas/);
  assert.ok(!/transitionComplaintStatus\([^)]*SELESAI/.test(drawer) && !/keStatus\("SELESAI"/.test(drawer));
  assert.match(drawer, /if \(a\.jenis === "konfirmasi"\) return setPanel\("selesai"\)/, "aksi utama konfirmasi membuka dialog, tidak langsung menyelesaikan");
});

test("satu aksi utama + Tindakan lainnya; izin ditampilkan sebagai petunjuk, penegak tetap server", () => {
  assert.match(drawer, /data-testid="aksi-utama"/); assert.match(drawer, /data-testid="tindakan-lainnya"/); assert.match(drawer, /pesanIzin\(/); assert.match(drawer, /bisaAksi\(user, izin\)/);
  assert.equal((drawer.match(/data-testid="aksi-utama"/g) || []).length, 1, "tepat satu tombol aksi utama");
});

test("kasus tutup: mode baca ringkas; detail & linimasa dibuka hanya bila diminta", () => {
  assert.match(drawer, /data-testid="mode-baca"/); assert.match(drawer, /data-testid="lihat-detail"/); assert.match(drawer, /\{bukaDetail && \(/);
  assert.match(drawer, /Perkiraan tim, bukan pengeluaran aktual Finance/);
  assert.match(drawer, /Pengeluaran aktual dicatat Finance secara terpisah/);
});

test("daftar: Aktif/Riwayat dipisah, halaman 30 + Muat lagi dengan jumlah jelas, total dari server, penjaga balapan", () => {
  assert.match(halaman, /UKURAN_HALAMAN = 30/); assert.match(halaman, /data-testid="muat-lagi"/); assert.match(halaman, /labelJumlah\(\{ tampil: cases\.length, total \}\)/);
  assert.match(halaman, /scope: tab/); assert.match(halaman, /api\.getComplaintSummary/); assert.match(halaman, /nomor\.current/); assert.match(halaman, /data-testid="tab-riwayat"/);
  assert.ok(!/take: 300|slice\(0, 300\)/.test(halaman));
  assert.match(api, /getComplaintSummary: \(params = \{\}\) => request\(`\/complaints\/ringkasan\$\{buildQuery\(params\)\}`\)/);
});

test("hub Produksi tetap memakai scope aktif/riwayat; halaman lintas divisi memberi tab sendiri", () => {
  const hub = baca("pages/bengkel/ProductionComplaintsHub.jsx");
  assert.match(hub, /<ComplaintCases scope="aktif" \/>/); assert.match(hub, /<ComplaintCases scope="riwayat" \/>/);
  assert.match(halaman, /\{!scope && \(\s*<Tabs/);
});
