// PENGAMAN "JANGAN ADA KASUS SOFYAN LAGI" (Okt 2026). Nota Kredit mengurangi nilai penjualan, tetapi Order.value tetap KOTOR. Setiap kode baru yang menjumlah/menampilkan
// Order.value mentah sebagai "nilai penjualan" akan diam-diam salah (komisi, target, omset, nilai pelanggan). Tes ini memindai backend/src dan GAGAL bila ada pemakai baru yang
// tidak lewat helper services/orderNilaiBersih.js dan tidak terdaftar di REGISTRI di bawah (dengan alasan tertulis).
//
// Tiga aturan:
//   R1  `_sum/_avg: { value }` pada prisma.order.aggregate/groupBy WAJIB lewat aggregateBersih/groupByBersih.
//   R2  SQL mentah `SUM(o.value)` WAJIB `SUM(${NILAI_BERSIH_SQL})`.
//   R3  Menjumlah/menampilkan `o.value` di JS WAJIB `nilaiBersih(o)` — kecuali file terdaftar di REGISTRI_KOTOR_DISENGAJA.
//   R4  Kontrak PILIH_TAGIHAN: file yang memakai tagihanOrder/dasarStatusBayar dan memilih `ongkir: true` WAJIB menyertakan PILIH_TAGIHAN/PILIH_KREDIT/orderCredits dalam select yang sama.
// Menambah entri registri = KEPUTUSAN SADAR: tulis alasannya (mengapa nilai KOTOR memang benar di sana).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

/** file (relatif ke backend/src) → alasan nilai KOTOR memang benar / bukan penjualan. Pencarian pola R3 dilewati untuk file ini. */
const REGISTRI_KOTOR_DISENGAJA = {
  "services/orderNilaiBersih.js": "helper itu sendiri (melewatkan agregat mentah lalu mengurangi nota)",
  "services/finance/tagihanOrder.js": "definisi tagihan: value + ongkir − nota; value mentah adalah komponen",
  "services/finance/notaKredit.js": "dokumen nota kredit: menampilkan tagihan kotor/bersih berdampingan",
  "services/finance/posting/orderRevenue.js": "pengakuan pendapatan HARUS kotor (Dr Piutang / Cr Pendapatan); potongan dicatat terpisah via Retur & Potongan",
  "services/finance/rekonsiliasi2026.js": "usulan pengakuan pendapatan untuk order BELUM diakui; Nota Kredit hanya boleh pada order yang sudah diakui",
  "services/finance/legacyPendapatan.js": "rekonsiliasi pendapatan legacy sebelum sistem (historis)",
  "services/finance/koreksiDokumen/pengakuan.js": "koreksi pengakuan pendapatan: ledger mengakui nilai KOTOR (sama dengan posting/orderRevenue.js); Nota Kredit tercatat terpisah di 4-2100. Nilai bersih ditampilkan lewat nilaiBersihPerOrder",
  "services/resiBackfill.js": "backfill harga resi dari kolom value mentah (alat sekali jalan)",
  "services/scopeRevision.js": "revisi lingkup: delta harga terhadap item order (kotor by design)",
  "services/finance/penerimaanOrder.js": "guard value > 0 (order sudah dihargai); tagihan memakai dasarStatusBayar",
  "services/finance/klaimLunas.js": "guard value > 0; tagihan memakai dasarStatusBayar",
  "services/finance/pembayaranHistoris.js": "guard value > 0; tagihan memakai tagihanOrder",
  "services/finance/penerimaanResi.js": "guard value > 0; dasar memakai dasarStatusBayar",
  "services/paymentLedger.js": "guard value > 0; dasar memakai dasarStatusBayar",
  "services/invoice.js": "hitungNominal: dasar layanan kotor lalu dikurangi notaKredit (kontrak PILIH_KREDIT)",
  "services/penjualanKaryawanOrder.js": "order PKR: nominal dikelola PKR di Finance (bukan penjualan CRM)",
  "services/penjualanKaryawan.js": "order PKR",
  "routes/orders.js": "buildWaMessage menampilkan total kotor lalu baris potongan + total bersih; aggregate/groupBy memakai helper bersih",
  "services/finance/piutangDetail.js": "detail piutang berbasis buku besar; nilai order hanya atribut",
  "services/finance/pembayaran.js": "detailPembayaran menampilkan atribut order; dasar label memakai dasarStatusBayar + PILIH_KREDIT",
  "services/finance/reports.js": "umurPiutang berbasis buku besar; nilaiOrder atribut + notaKredit disertakan",
  "services/finance/refundRead.js": "daftar refund: atribut nilai order (konteks dokumen refund)",
  "services/finance/export/pembayaran.js": "export: kolom nilaiOrder = dasarStatusBayar (sudah bersih)",
  "services/finance/export/piutang-refund.js": "export: nilaiOrder atribut dari baris laporan",
  "services/deliveryV2Snapshot.js": "normalisasi snapshot (kata 'value' generik, bukan Order.value)",
  "services/attribution/cohort.js": "membaca baris dari cohortLoader yang SUDAH menormalkan value = nilaiBersih(o) (bukan Order.value mentah)",
  "services/finance/transaksi.js": "detail piutang menampilkan Nilai order kotor BERDAMPINGAN dengan 'Nota Kredit aktif' dan 'Nilai bersih'",
  "mcp/toolsShared.js": "ringkasOrder: nilai = bersih, nilaiKotor = Order.value mentah (keduanya dikirim eksplisit)",
  "routes/analytics.js": "nilaiKotor di rincian Lunas (berdampingan dengan value bersih & notaKredit)",
  "routes/pipeline.js": "nilaiKotor di papan order (value sudah bersih)",
  "services/finance/rekonSalesFinance.js": "nilai memakai nilaiBersih; kolom tampilan mengutip tagihan",
  "services/finance/piutangDiagnosis.js": "diagnosis berbasis tagihanOrder (bersih) + buku besar",
  "services/finance/koreksiPembayaran.js": "guard dengan dasarStatusBayar (bersih)",
  "services/finance/pemasukan.js": "status bayar dengan dasarStatusBayar (bersih)",
};

function semuaFile(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...semuaFile(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).replace(/\\/g, "/");
const baca = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const FILES = semuaFile(SRC);

test("R1: setiap _sum/_avg { value } pada order.aggregate/groupBy lewat aggregateBersih/groupByBersih", () => {
  const pelanggaran = [];
  for (const f of FILES) {
    const r = rel(f);
    if (r === "services/orderNilaiBersih.js") continue;
    const s = baca(f);
    for (const m of s.matchAll(/_(?:sum|avg): \{ value: true/g)) {
      const sebelum = s.slice(Math.max(0, m.index - 1800), m.index);
      const panggilan = [...sebelum.matchAll(/(\w+(?:\.\w+)*)\.(aggregate|groupBy)\(|(aggregateBersih|groupByBersih)\(/g)].pop();
      if (!panggilan) continue;
      if (panggilan[3]) continue; // helper bersih
      const model = panggilan[1] ?? "";
      if (/\border$/.test(model)) pelanggaran.push(`${r}: ${model}.${panggilan[2]}(...) menjumlah value mentah`);
    }
  }
  assert.deepEqual(pelanggaran, [], `Pakai aggregateBersih/groupByBersih (services/orderNilaiBersih.js):\n${pelanggaran.join("\n")}`);
});

test("R2: SQL mentah tidak menjumlah o.value mentah (pakai NILAI_BERSIH_SQL)", () => {
  const pelanggaran = [];
  for (const f of FILES) {
    const r = rel(f);
    if (r in REGISTRI_KOTOR_DISENGAJA) continue;
    const s = baca(f);
    s.split("\n").forEach((baris, i) => {
      if (/^\s*(\/\/|\*)/.test(baris)) return;
      if (/SUM\(\s*o\.value\b/i.test(baris) || /SUM\(\s*"?value"?\s*\)/.test(baris)) pelanggaran.push(`${r}:${i + 1}: ${baris.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(pelanggaran, [], `Ganti dengan SUM(\${NILAI_BERSIH_SQL}):\n${pelanggaran.join("\n")}`);
});

test("R3: tidak ada penjumlahan/tampilan o.value mentah di JS di luar registri", () => {
  const pelanggaran = [];
  // Semua pembacaan `o.value` / `order.value` / `ord.value` di baris non-komentar yang bukan nilaiBersih(...) dan bukan penanda nilaiKotor.
  const POLA = [/\b(?:o|ord|order)\.value\b/];
  const DIIZINKAN = [/nilaiKotor:\s*o\.value\b/];
  for (const f of FILES) {
    const r = rel(f);
    if (r in REGISTRI_KOTOR_DISENGAJA) continue;
    const s = baca(f);
    s.split("\n").forEach((baris, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(baris)) return;
      if (/nilaiBersih\(/.test(baris)) return;
      if (DIIZINKAN.some((p) => p.test(baris))) return;
      if (POLA.some((p) => p.test(baris))) pelanggaran.push(`${r}:${i + 1}: ${baris.trim().slice(0, 130)}`);
    });
  }
  assert.deepEqual(pelanggaran, [],
    `Pakai nilaiBersih(o) (select harus memuat ...PILIH_KREDIT) ATAU daftarkan file di REGISTRI_KOTOR_DISENGAJA dengan alasan:\n${pelanggaran.join("\n")}`);
});

test("R4: kontrak PILIH_TAGIHAN — file pemakai tagihanOrder/dasarStatusBayar yang memilih `ongkir: true` menyertakan PILIH_TAGIHAN/PILIH_KREDIT/orderCredits", () => {
  const pelanggaran = [];
  for (const f of FILES) {
    const r = rel(f);
    if (r === "services/finance/tagihanOrder.js" || r === "services/orderNilaiBersih.js" || r === "services/finance/notaKredit.js") continue;
    const s = baca(f);
    if (!/\b(?:tagihanOrder|dasarStatusBayar|tagihanKotorOrder|tagihanAnak)\b/.test(s)) continue;
    const baris = s.split("\n");
    baris.forEach((b, i) => {
      if (!/\bongkir:\s*true\b/.test(b)) return;
      if (/^\s*(\/\/|\*)/.test(b)) return;
      const konteks = baris.slice(Math.max(0, i - 4), i + 5).join("\n");
      if (!/PILIH_TAGIHAN|PILIH_KREDIT|orderCredits|PILIH_ANAK/.test(konteks)) pelanggaran.push(`${r}:${i + 1}: select ongkir tanpa PILIH_TAGIHAN/PILIH_KREDIT`);
    });
  }
  assert.deepEqual(pelanggaran, [], `Select order yang memuat ongkir (tagihan) harus memuat nota kredit:\n${pelanggaran.join("\n")}`);
});

test("registri tidak berisi file yang sudah tidak ada (hindari entri basi)", () => {
  const ada = new Set(FILES.map(rel));
  const basi = Object.keys(REGISTRI_KOTOR_DISENGAJA).filter((f) => !ada.has(f));
  assert.deepEqual(basi, [], `Hapus entri registri basi: ${basi.join(", ")}`);
});
