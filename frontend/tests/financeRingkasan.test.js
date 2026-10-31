// Ringkasan Keuangan Finance (Fase Ringkasan Finance, 31 Okt 2026): logika penyajian murni + pagar CSS/aset/shell. Tidak mengubah rumus; tampilan terukur di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jenisRekening, keteranganRekening, keadaanStrip, susunPerluDibereskan, bahanBarisRekening, STATUS_PENCOCOKAN, ISTILAH } from "../src/features/finance/ringkasanTampilan.js";
import { hitungKualitasData } from "../src/features/finance/ringkasanKualitas.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");

test("logo bank: BCA/Mandiri hanya dari kind+bankName; beberapa rekening satu bank = jenis sama; tidak menebak dari nama rekening", () => {
  assert.equal(jenisRekening({ kind: "BANK", bankName: "BCA", name: "PT Sano" }).jenis, "BCA");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "bca", name: "Operasional" }).jenis, "BCA");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "Bank Central Asia" }).jenis, "BCA");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "Mandiri" }).jenis, "MANDIRI");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "Bank Mandiri" }).jenis, "MANDIRI");
  assert.equal(jenisRekening({ kind: "KAS", bankName: null }).jenis, "TUNAI");
  assert.equal(jenisRekening({ kind: "KAS", bankName: "BCA" }).jenis, "TUNAI", "kas tunai selalu ikon dompet");
  assert.equal(jenisRekening({ kind: "EWALLET" }).jenis, "EWALLET");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "BNI" }).jenis, "BANK_LAIN");
  assert.equal(jenisRekening({ kind: "BANK", bankName: null, name: "BCA 123 Operasional" }).jenis, "BANK_LAIN", "tanpa bankName → ikon netral, bukan tebakan dari nama rekening");
  assert.equal(jenisRekening({ kind: "BANK", bankName: "Bank BCA Syariah" }).jenis, "BANK_LAIN", "bank yang mirip tetapi berbeda tidak dianggap BCA");
});

test("identitas sekunder: nama bank/jenis + nomor rekening tetap tersedia", () => {
  assert.equal(keteranganRekening({ kind: "BANK", bankName: "BCA", accountNumber: "123" }), "BCA · 123");
  assert.equal(keteranganRekening({ kind: "KAS" }), "Kas tunai");
  assert.equal(keteranganRekening({ kind: "EWALLET", accountNumber: "08123" }), "E-wallet · 08123");
});

test("strip status: kondisi sama dengan banner lama; hanya 'belum lengkap' bila ada butir bermasalah; sumber hilang dinyatakan berbeda", () => {
  const k = (p) => hitungKualitasData(p);
  const bersih = k({ antrean: { lunasBelumDicatat: { jumlah: 0, total: 0 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: 0 }] }, riil: { cutoffLabel: "x", rekening: [] } });
  assert.equal(keadaanStrip(bersih), "lengkap");
  const masalah = k({ antrean: { lunasBelumDicatat: { jumlah: 2, total: 100 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: 0 }] }, riil: { cutoffLabel: "x", rekening: [] } });
  assert.equal(keadaanStrip(masalah), "belumLengkap");
  const hilang = k({ antrean: {}, catatan: null, backfill: null, riil: null });
  assert.equal(keadaanStrip(hilang), "sumberHilang");
});

test("Perlu dibereskan: empat baris tetap, tidak dijumlahkan, 'tidak tersedia' ≠ nol, selisih per rekening terbaca", () => {
  const kualitas = hitungKualitasData({
    antrean: { lunasBelumDicatat: { jumlah: 7, total: 12400000 } }, catatan: { gapTerbuka: 5 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 428, nilai: 1234567890 }] },
    riil: { cutoffLabel: "21 Sep 2026", rekening: [{ id: "a", name: "KEM - Sano Bank", status: "SELISIH", selisih: 12088 }, { id: "b", name: "PT Sano", status: "SESUAI", selisih: 0 }] },
  });
  const baris = susunPerluDibereskan(kualitas);
  assert.deepEqual(baris.map((b) => b.id), ["pembayaran_belum_tercatat", "order_belum_diakui", "transaksi_belum_lengkap", "selisih_rekening"]);
  assert.equal(baris[0].label, "Pembayaran belum tercatat di pembukuan");
  assert.equal(baris[1].label, "Order belum diakui sebagai pendapatan");
  assert.equal(baris[0].tujuan, "/finance/payments"); assert.equal(baris[1].tujuan, "/finance/pemasukan"); assert.equal(baris[2].tujuan, "/finance/settings");
  assert.equal(baris[3].jumlah, 1); assert.equal(baris[3].detailRupiah[0].nilai, 12088);
  assert.ok(!baris.some((b) => "total" in b), "tidak ada jumlah gabungan");
  const hilang = susunPerluDibereskan(hitungKualitasData({ antrean: {}, catatan: null, backfill: null, riil: null }));
  assert.ok(hilang.every((b) => b.status === "tanpa-data" && b.jumlah === null), "sumber tak termuat = tidak tersedia, bukan 0");
  const aman = susunPerluDibereskan(hitungKualitasData({ antrean: { lunasBelumDicatat: { jumlah: 0, total: 0 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: 0 }] }, riil: { rekening: [] } }));
  assert.ok(aman.every((b) => b.status === "bersih"));
});

test("Saldo rekening: PT Sano (saldo pembukuan ≠ terkonfirmasi tetapi 'Sesuai') dijelaskan dengan tanggal acuan, tanpa menghitung selisih baru", () => {
  const riil = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB", tanggalBuku: "2026-09-21" };
  const r = { id: "a1", name: "PT Sano", kind: "BANK", saldo: 41250000 };
  const x = { id: "a1", saldoBuku: 39180615, saldoRiil: 39180615, selisih: 0, status: "SESUAI" };
  const b = bahanBarisRekening(r, x, riil);
  assert.equal(b.status.label, "Sesuai"); assert.equal(b.bukuBerbeda, true); assert.equal(b.perluTindakan, false);
  assert.equal(b.terkonfirmasi.keadaan, "ada"); assert.equal(b.terkonfirmasi.nilai, 39180615); assert.match(b.terkonfirmasi.keterangan, /21 Sep 2026 pukul 20\.00 WIB/);
  const selisih = b.baris.find((z) => z.k === "selisih"); assert.equal(selisih.nilai, 0, "selisih dibaca dari server, bukan buku − riil");
  assert.ok(b.baris.some((z) => z.k === "berbeda" && /posisi terbaru/.test(z.teks)));
});

test("Saldo rekening: belum dikonfirmasi ≠ Rp0; riil gagal dimuat = tidak tersedia; selisih menandai perlu tindakan", () => {
  const riil = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB" };
  const r = { id: "a3", name: "Uang Kas", kind: "KAS", saldo: 1500000 };
  const belum = bahanBarisRekening(r, { id: "a3", saldoBuku: 1500000, saldoRiil: null, selisih: null, status: "BELUM_DIKONFIRMASI" }, riil);
  assert.equal(belum.terkonfirmasi.keadaan, "belum"); assert.equal(belum.terkonfirmasi.nilai, null);
  assert.match(belum.terkonfirmasi.keterangan, /Tanggal acuan belum ada/);
  const hilang = bahanBarisRekening(r, undefined, null);
  assert.equal(hilang.terkonfirmasi.keadaan, "tidak-tersedia"); assert.equal(hilang.terkonfirmasi.nilai, null);
  const sel = bahanBarisRekening({ ...r, saldo: 100 }, { saldoBuku: 100, saldoRiil: 88, selisih: 12, status: "SELISIH" }, riil);
  assert.equal(sel.perluTindakan, true); assert.equal(STATUS_PENCOCOKAN.SELISIH.tone, "red");
});

test("bahasa: istilah sederhana di label, istilah asli tetap ada", () => {
  assert.equal(ISTILAH.pencocokanSaldo.tampil, "Pencocokan saldo"); assert.equal(ISTILAH.pencocokanSaldo.asli, "Rekonsiliasi rekening");
  assert.equal(ISTILAH.tanggalAcuan.tampil, "Tanggal acuan"); assert.equal(ISTILAH.tanggalAcuan.asli, "Cutoff");
  assert.equal(ISTILAH.lengkapiOrderLama.tampil, "Melengkapi data order lama");
  assert.equal(ISTILAH.sumberDanaBelumDiketahui.tampil, "Sumber dana belum diketahui");
  assert.equal(ISTILAH.penyesuaianPengurangBiaya.tampil, "Penyesuaian pengurang biaya");
});

test("halaman: urutan panel, KPI sesuai spesifikasi, tanggal posisi vs rentang, tanpa teks mockup yang tidak benar", () => {
  const dash = baca("src/pages/finance/FinanceDashboard.jsx");
  const urut = ["<StripStatus", "fin-kpi-grid", "<PerluDibereskan", "<SaldoRekening", "<LabaRugiPanel"].map((k) => dash.indexOf(k));
  assert.ok(urut.every((i) => i > 0) && urut.every((v, i) => i === 0 || v > urut[i - 1]), "urutan: strip, KPI, perlu dibereskan, saldo rekening, laba rugi");
  for (const k of ['label="Saldo kas & bank"', 'ket="Menurut pembukuan"', 'label="Laba sementara"', 'ket="Dari transaksi yang sudah dibukukan"', 'label="Tagihan pelanggan"', 'ket="Piutang dalam pembukuan"', 'label="Tagihan supplier"', 'ket="Utang usaha"']) assert.ok(dash.includes(k), k);
  assert.ok(dash.includes("Per ${tanggalPendek(posisi)}") && dash.includes("data.periode?.from ?? periode.from"), "saldo = Per [tanggal posisi]; laba = rentang dari data.periode (bukan tanggal akhir filter)");
  assert.ok(!dash.includes("Tanggal acuan di rincian"));
  assert.ok(dash.includes("data.totalKas") && dash.includes("lr?.labaBersih") && dash.includes("piutang.bukuBesar") && dash.includes("data.utang.total"), "angka KPI dari sumber lama");
  const p = baca("src/features/finance/RingkasanPanels.jsx");
  assert.ok(!p.includes("Tanggal acuan di rincian"));
  for (const k of ["Pendapatan tercatat", "Retur & potongan", "Pendapatan bersih", "Biaya pokok (HPP)", "Laba kotor", "Biaya operasional", "Laba sementara", "Ada penyesuaian yang mengurangi biaya"]) assert.ok(p.includes(k) || baca("src/features/finance/ringkasanTampilan.js").includes(k), k);
  assert.ok(p.includes("Saldo pembukuan") && p.includes("Saldo terkonfirmasi") && p.includes("Rincian"));
  assert.ok(p.includes('alt=""') && p.includes("object-fit") === false, "logo dekoratif beralt kosong; teks nama bank tetap ditulis");
});

test("aset logo bank: lokal, tanpa hotlink; CSS wadah 40px contain; kerangka Finance memakai .crm-skin", () => {
  assert.ok(fs.existsSync(path.join(repo, "src/assets/bank/bca.svg")) && fs.existsSync(path.join(repo, "src/assets/bank/mandiri.png")));
  const svg = baca("src/assets/bank/bca.svg").replace(/<!--[\s\S]*?-->/g, ""); assert.ok(!/<script|onload=|https?:\/\/(?!www\.w3\.org\/)/.test(svg), "SVG bersih");
  const p = baca("src/features/finance/RingkasanPanels.jsx"); assert.ok(!/https?:\/\//.test(p), "tanpa URL luar");
  const css = baca("src/styles/sanss-finance.css");
  assert.match(css, /\.fin-logo \{[^}]*width: 40px; height: 40px/); assert.match(css, /\.fin-logo-merek img \{[^}]*object-fit: contain/);
  const layout = baca("src/components/Layout.jsx");
  assert.ok(layout.includes('(divisionKey === "growth" || divisionKey === "finance")') && layout.includes("hubTerlihat(rolesOf(user))"));
  assert.ok(baca("src/components/financeIcons.jsx").includes("IKON_NAV_FINANCE") && !/https?:|href=|<image|url\(/.test(baca("src/components/financeIcons.jsx").replace(/import[^\n]*\n/g, "")));
});

test("CSS Finance: semua aturan terkunci ke halaman Ringkasan, tanpa font-family/@import/url()", () => {
  const css = baca("src/styles/sanss-finance.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/font-family|@import|url\(/.test(css));
  const aturan = [...css.matchAll(/(^|\})\s*([^{}@][^{}]*)\{/g)].map((m) => m[2].trim());
  for (const sel0 of aturan) for (const bagian of sel0.replace(/:is\([^)]*\)/g, ":is()").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("@media"))) {
    assert.ok(/^:root( \.app-shell\.crm-skin)?/.test(bagian), `terkunci: ${bagian}`);
    if (bagian.startsWith(":root .app-shell.crm-skin")) assert.ok(/\.fin-(halaman|ring|strip|kpi|panel|perlu|tabel|rek|detail|logo|dana|lr|chip|pembuka|asli|redup|ok|perhatian|galat|catatan)/.test(bagian), `hanya kelas Ringkasan: ${bagian}`);
  }
});

test("PWA & halaman lain tidak disentuh: manifest/service worker/index.html/vite.config tidak ada di berkas ini", () => {
  const p = baca("src/features/finance/RingkasanPanels.jsx") + baca("src/styles/sanss-finance.css");
  assert.ok(!/serviceWorker|manifest|vite\.config/.test(p));
});

test("rekening belum dikonfirmasi: saldo pembukuan pada tanggal acuan tetap tampil di rincian bila berbeda dari posisi terbaru", () => {
  const b = bahanBarisRekening({ id: "a4", name: "BCA Ops", kind: "BANK", saldo: 9000000 }, { saldoBuku: 7320500, saldoRiil: null, selisih: null, status: "BELUM_DIKONFIRMASI" }, { cutoffLabel: "21 Sep 2026" });
  assert.equal(b.baris.find((z) => z.k === "bukuAcuan").nilai, 7320500);
  assert.ok(b.baris.some((z) => z.k === "belum" && /bukan saldo Rp0/.test(z.teks)));
});
