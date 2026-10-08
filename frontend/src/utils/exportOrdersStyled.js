import { saveAs } from "file-saver";

// Export Order "advanced" (7 Okt 2026, permintaan owner): file Excel berwarna dengan filter, panel beku,
// format angka/tanggal asli, sheet Ringkasan & Komplain Aktif. ExcelJS (~1MB) dimuat HANYA saat tombol
// Export diklik (dynamic import) supaya bundle awal tidak membesar. Fungsi lama di utils/export.js
// (SheetJS polos) tidak berubah dan tetap dipakai halaman lain.

const WARNA = {
  header: "FF1E293B", headerTeks: "FFFFFFFF",
  garis: "FFD4D4D4",
  zebra: "FFF8FAFC",
  kategori: { LAYANAN: ["FFDBEAFE", "FF1E40AF"], BARU: ["FFDCFCE7", "FF166534"], SEWA: ["FFEDE9FE", "FF5B21B6"] },
  bayar: { LUNAS: ["FFDCFCE7", "FF166534"], DP: ["FFFEF3C7", "FF92400E"], BELUM_BAYAR: ["FFE2E8F0", "FF475569"] },
  komplainBaris: "FFFEE2E2", komplainTeks: "FF7F1D1D", komplainLabel: "FFDC2626",
  mandek: ["FFFFEDD5", "FF9A3412"],
};

const KOLOM_TANGGAL = new Set([
  "Tanggal Lunas", "Tanggal Pick Up Pasti", "Tanggal Kirim Pasti", "Tgl Pickup Komplain", "Tgl Kirim Komplain",
  "Dibuat", "Tanggal Order",
]);
const KOLOM_RUPIAH = new Set(["Nilai", "Ongkir", "Ongkir Klaim Garansi", "Harga Normal", "Harga Standard", "Harga Final", "Selisih ke Standard"]);
const KOLOM_ANGKA = new Set(["Hari di Status"]);
const KOLOM_TENGAH = new Set(["Kategori", "Status", "Pembayaran", "Mandek", "Perkiraan?", "Sudah Lunas?", "Komplain", "Jenis Pekerjaan"]);
const KOLOM_BUNGKUS = new Set(["Keluhan Komplain", "Keluhan/Catatan", "Alamat Pengiriman", "Layanan", "Ukuran/Konfigurasi", "Kategori Keluhan", "Berat Badan", "Promo"]);
const LEBAR_TETAP = {
  "ID Order": 20, Pelanggan: 22, "No HP": 16, Kota: 14, "Sales Person": 14, Kategori: 13, "Lini Produk": 14, "Jenis Produk": 16,
  "Merk/Model": 18, "Ukuran/Konfigurasi": 24, Layanan: 30, Status: 13, "Jenis Pekerjaan": 20, "No Komplain": 20, "Keluhan Komplain": 40,
  "Hari di Status": 11, "Perkiraan?": 10, Mandek: 9, Pembayaran: 14, "Sudah Lunas?": 11, "Tanggal Lunas": 13, Nilai: 15,
  "Ada Nego Di Bawah Standard": 16, Promo: 22, "Cek Batas Diskon": 30, Ongkir: 13, "Ongkir Klaim Garansi": 14, Komplain: 10, "Kondisi Kesehatan": 16,
  "Kategori Keluhan": 24, "Berat Badan": 18, "Keluhan/Catatan": 36, "Kota Pengiriman": 16, "Alamat Pengiriman": 36,
  "Estimasi Pick Up": 14, "Tanggal Pick Up Pasti": 14, "Estimasi Kirim": 14, "Tanggal Kirim Pasti": 14, "Tgl Pickup Komplain": 14,
  "Tgl Kirim Komplain": 14, "Link Lokasi": 18, Dibuat: 12,
};

function keTanggal(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function isiSel(cell, nama, nilai) {
  if (KOLOM_TANGGAL.has(nama)) {
    const d = keTanggal(nilai);
    cell.value = d;
    if (d) cell.numFmt = "yyyy-mm-dd";
  } else if (KOLOM_RUPIAH.has(nama) && nilai !== "" && nilai != null) {
    cell.value = Number(nilai);
    cell.numFmt = '"Rp" #,##0;[Red]-"Rp" #,##0';
  } else if (KOLOM_ANGKA.has(nama) && nilai !== "" && nilai != null) {
    cell.value = Number(nilai);
    cell.numFmt = "0";
  } else {
    cell.value = nilai === "" || nilai == null ? null : nilai;
  }
}

function gayaHeader(ws, jumlahKolom) {
  const row = ws.getRow(1);
  row.height = 26;
  for (let c = 1; c <= jumlahKolom; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: WARNA.headerTeks }, name: "Calibri", size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.header } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF475569" } } };
  }
}

function aturLebar(ws, headers) {
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = LEBAR_TETAP[h] || Math.min(Math.max(h.length + 4, 12), 30); });
}

function aturCetak(ws) {
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.pageSetup.printTitlesRow = "1:1";
}

/** Sheet "Order": 1 baris per order, berwarna, dengan filter dan panel beku. */
function buatSheetOrder(wb, rows, meta) {
  const headers = Object.keys(rows[0]);
  const ws = wb.addWorksheet("Order", { views: [{ state: "frozen", xSplit: 2, ySplit: 1, zoomScale: 100 }] });
  ws.addRow(headers);
  gayaHeader(ws, headers.length);

  rows.forEach((r, i) => {
    const m = meta[i] || {};
    const row = ws.addRow([]);
    const dasar = m.komplain ? WARNA.komplainBaris : i % 2 ? WARNA.zebra : null;
    headers.forEach((h, c) => {
      const cell = row.getCell(c + 1);
      isiSel(cell, h, r[h]);
      cell.font = { name: "Calibri", size: 11, color: { argb: m.komplain ? WARNA.komplainTeks : "FF111111" }, ...(m.dibatalkan ? { color: { argb: "FF94A3B8" } } : {}) };
      if (dasar) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dasar } };
      cell.border = { bottom: { style: "thin", color: { argb: WARNA.garis } }, right: { style: "hair", color: { argb: WARNA.garis } } };
      cell.alignment = {
        vertical: "top",
        wrapText: KOLOM_BUNGKUS.has(h),
        horizontal: KOLOM_TENGAH.has(h) ? "center" : KOLOM_RUPIAH.has(h) || KOLOM_ANGKA.has(h) ? "right" : "left",
      };
      if (h === "Kategori" && WARNA.kategori[m.kategori]) {
        const [bg, fg] = WARNA.kategori[m.kategori];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: fg } };
      }
      if (h === "Pembayaran" && WARNA.bayar[m.bayar]) {
        const [bg, fg] = WARNA.bayar[m.bayar];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: fg } };
      }
      if (h === "Jenis Pekerjaan" && m.komplain) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.komplainLabel } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      }
      if (h === "Mandek" && r[h] === "Ya") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.mandek[0] } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WARNA.mandek[1] } };
      }
      if (h === "Cek Batas Diskon" && String(r[h] || "").startsWith("MELEBIHI")) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFB91C1C" } };
      }
      if (h === "Status" && m.menunggu) cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF92400E" } };
      // Tautan: nomor HP -> chat WhatsApp, Link Lokasi -> peta.
      if (h === "No HP" && r[h]) {
        const digit = String(r[h]).replace(/\D/g, "");
        if (digit) cell.value = { text: String(r[h]), hyperlink: `https://wa.me/${digit}` };
        cell.font = { name: "Calibri", size: 11, underline: true, color: { argb: "FF1D4ED8" } };
      }
      if (h === "Link Lokasi" && /^https?:\/\//i.test(String(r[h] || ""))) {
        cell.value = { text: "Buka peta", hyperlink: String(r[h]) };
        cell.font = { name: "Calibri", size: 11, underline: true, color: { argb: "FF1D4ED8" } };
      }
    });
  });

  aturLebar(ws, headers);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: headers.length } };
  aturCetak(ws);
  return { ws, headers };
}

/** Sheet "Komplain Aktif": hanya order yang sedang komplain/revisi, kolom yang relevan untuk produksi & delivery. */
function buatSheetKomplain(wb, rows, meta) {
  const dipilih = rows.map((r, i) => ({ r, m: meta[i] })).filter((x) => x.m?.komplain);
  if (dipilih.length === 0) return;
  const headers = [
    "ID Order", "Pelanggan", "No HP", "Sales Person", "Kategori", "Status", "No Komplain", "Keluhan Komplain",
    "Hari di Status", "Mandek", "Tanggal Pick Up Pasti", "Tanggal Kirim Pasti", "Tgl Pickup Komplain", "Tgl Kirim Komplain",
  ].filter((h) => h in rows[0]);
  const ws = wb.addWorksheet("Komplain Aktif", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }], properties: { tabColor: { argb: "FFDC2626" } } });
  ws.addRow(headers);
  gayaHeader(ws, headers.length);
  ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } }; });
  dipilih.forEach(({ r }) => {
    const row = ws.addRow([]);
    headers.forEach((h, c) => {
      const cell = row.getCell(c + 1);
      isiSel(cell, h, r[h]);
      cell.font = { name: "Calibri", size: 11, color: { argb: WARNA.komplainTeks } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.komplainBaris } };
      cell.border = { bottom: { style: "thin", color: { argb: WARNA.garis } } };
      cell.alignment = { vertical: "top", wrapText: KOLOM_BUNGKUS.has(h), horizontal: KOLOM_TENGAH.has(h) ? "center" : KOLOM_ANGKA.has(h) ? "right" : "left" };
    });
  });
  aturLebar(ws, headers);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + dipilih.length, column: headers.length } };
  aturCetak(ws);
}

/** Sheet "Rincian Layanan": 1 baris per item layanan. */
function buatSheetLayanan(wb, rows) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const ws = wb.addWorksheet("Rincian Layanan", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.addRow(headers);
  gayaHeader(ws, headers.length);
  rows.forEach((r, i) => {
    const row = ws.addRow([]);
    headers.forEach((h, c) => {
      const cell = row.getCell(c + 1);
      isiSel(cell, h, r[h]);
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF111111" } };
      if (i % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.zebra } };
      cell.border = { bottom: { style: "thin", color: { argb: WARNA.garis } } };
      cell.alignment = { vertical: "top", horizontal: KOLOM_RUPIAH.has(h) ? "right" : "left" };
      if (h === "Status Nego" && r[h] === "Di bawah standard") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.mandek[0] } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WARNA.mandek[1] } };
      }
    });
  });
  aturLebar(ws, headers);
  ws.getColumn(headers.indexOf("Layanan") + 1).width = 34;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + rows.length, column: headers.length } };
  aturCetak(ws);
}

function kolomHuruf(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Sheet "Ringkasan": rumus hidup (COUNTIFS/SUMIFS) terhadap sheet Order, dengan hasil terhitung ikut disimpan supaya
 * pratinjau (HP/Google Drive) tidak menampilkan 0. Aturan omset SAMA dengan Laporan: status Menunggu & Dibatalkan
 * TIDAK dihitung omset.
 */
function buatSheetRingkasan(wb, rows, meta, headers, info) {
  const ws = wb.addWorksheet("Ringkasan", { views: [{ showGridLines: false }] });
  const col = (nama) => kolomHuruf(headers.indexOf(nama) + 1);
  const n = rows.length + 1;
  const rng = (nama) => `Order!$${col(nama)}$2:$${col(nama)}$${n}`;
  const rp = '"Rp" #,##0';

  ws.getColumn(1).width = 34; ws.getColumn(2).width = 14; ws.getColumn(3).width = 20; ws.getColumn(4).width = 22;
  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = "Ringkasan Export Order";
  ws.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF1E293B" } };
  ws.getRow(1).height = 30;
  let r = 2;
  for (const baris of info) { ws.getCell(`A${r}`).value = baris; ws.getCell(`A${r}`).font = { size: 11, color: { argb: "FF475569" } }; r++; }
  r++;

  const judul = (teks) => {
    ws.mergeCells(`A${r}:D${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = teks; c.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.header } };
    r++;
  };
  const headerTabel = (...nama) => {
    nama.forEach((t, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = t; c.font = { bold: true, color: { argb: "FF1E293B" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      c.alignment = { horizontal: i === 0 ? "left" : "right" };
    });
    r++;
  };
  const NILAI = rng("Nilai");
  const STATUS = rng("Status");
  const adaStatus = headers.includes("Status");

  // helper hasil terhitung
  const nilaiOmset = (m) => rows.reduce((s, row, i) => (meta[i] && m(meta[i], row) && !meta[i].menunggu && !meta[i].dibatalkan ? s + (Number(row.Nilai) || 0) : s), 0);
  const hitung = (m) => rows.reduce((s, row, i) => (meta[i] && m(meta[i], row) ? s + 1 : s), 0);

  // ── Ikhtisar
  judul("Ikhtisar");
  const baris = (label, rumus, hasil, fmt) => {
    ws.getCell(`A${r}`).value = label;
    const c = ws.getCell(`B${r}`);
    c.value = { formula: rumus, result: hasil };
    if (fmt) c.numFmt = fmt;
    c.alignment = { horizontal: "right" }; c.font = { bold: true };
    r++;
  };
  baris("Total order", `COUNTA(${rng("ID Order")})`, rows.length);
  baris("Order masuk omset (tanpa Menunggu & Dibatalkan)", `COUNTA(${rng("ID Order")})-COUNTIFS(${STATUS},"Menunggu")-COUNTIFS(${STATUS},"Dibatalkan")`,
    hitung((m) => !m.menunggu && !m.dibatalkan));
  baris("Nilai omset", `SUM(${NILAI})-SUMIFS(${NILAI},${STATUS},"Menunggu")-SUMIFS(${NILAI},${STATUS},"Dibatalkan")`, nilaiOmset(() => true), rp);
  baris("Nilai order Menunggu (belum masuk omset)", `SUMIFS(${NILAI},${STATUS},"Menunggu")`,
    rows.reduce((s, row, i) => (meta[i]?.menunggu ? s + (Number(row.Nilai) || 0) : s), 0), rp);
  baris("Order komplain / revisi aktif", `COUNTIFS(${rng("Jenis Pekerjaan")},"KOMPLAIN / REVISI")`, hitung((m) => m.komplain));
  if (headers.includes("Cek Batas Diskon")) {
    baris("Order diskon melebihi batas promo", `COUNTIFS(${rng("Cek Batas Diskon")},"MELEBIHI*")`, rows.filter((x) => String(x["Cek Batas Diskon"] || "").startsWith("MELEBIHI")).length);
  }
  if (headers.includes("Mandek")) baris("Order mandek", `COUNTIFS(${rng("Mandek")},"Ya")`, rows.filter((x) => x.Mandek === "Ya").length);
  r++;

  // ── Per kategori
  judul("Per kategori");
  headerTabel("Kategori", "Jumlah", "Nilai omset", "Komplain");
  const KAT = [["LAYANAN", "Layanan"], ["BARU", "Baru"], ["SEWA", "Sewa"]];
  for (const [key, label] of KAT) {
    ws.getCell(`A${r}`).value = label;
    const [bg, fg] = WARNA.kategori[key];
    ws.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: fg } };
    const k = rng("Kategori");
    ws.getCell(`B${r}`).value = { formula: `COUNTIFS(${k},"${label}")`, result: hitung((m) => m.kategori === key) };
    ws.getCell(`C${r}`).value = {
      formula: `SUMIFS(${NILAI},${k},"${label}")-SUMIFS(${NILAI},${k},"${label}",${STATUS},"Menunggu")-SUMIFS(${NILAI},${k},"${label}",${STATUS},"Dibatalkan")`,
      result: nilaiOmset((m) => m.kategori === key),
    };
    ws.getCell(`C${r}`).numFmt = rp;
    ws.getCell(`D${r}`).value = { formula: `COUNTIFS(${k},"${label}",${rng("Jenis Pekerjaan")},"KOMPLAIN / REVISI")`, result: hitung((m) => m.kategori === key && m.komplain) };
    r++;
  }
  r++;

  // ── Per status
  if (adaStatus) {
    judul("Per status");
    headerTabel("Status", "Jumlah", "Nilai", "Masuk omset?");
    const daftar = [...new Set(rows.map((x) => x.Status))];
    for (const s of daftar) {
      ws.getCell(`A${r}`).value = s;
      ws.getCell(`B${r}`).value = { formula: `COUNTIFS(${STATUS},A${r})`, result: rows.filter((x) => x.Status === s).length };
      ws.getCell(`C${r}`).value = { formula: `SUMIFS(${NILAI},${STATUS},A${r})`, result: rows.filter((x) => x.Status === s).reduce((t, x) => t + (Number(x.Nilai) || 0), 0) };
      ws.getCell(`C${r}`).numFmt = rp;
      const tidak = s === "Menunggu" || s === "Dibatalkan";
      ws.getCell(`D${r}`).value = tidak ? "Tidak" : "Ya";
      ws.getCell(`D${r}`).alignment = { horizontal: "right" };
      if (tidak) ws.getCell(`D${r}`).font = { bold: true, color: { argb: "FF92400E" } };
      r++;
    }
    r++;
  }

  // ── Per pembayaran
  if (headers.includes("Pembayaran")) {
    judul("Per status pembayaran");
    headerTabel("Pembayaran", "Jumlah", "Nilai", "");
    const daftar = [...new Set(rows.map((x) => x.Pembayaran))];
    for (const s of daftar) {
      ws.getCell(`A${r}`).value = s;
      ws.getCell(`B${r}`).value = { formula: `COUNTIFS(${rng("Pembayaran")},A${r})`, result: rows.filter((x) => x.Pembayaran === s).length };
      ws.getCell(`C${r}`).value = { formula: `SUMIFS(${NILAI},${rng("Pembayaran")},A${r})`, result: rows.filter((x) => x.Pembayaran === s).reduce((t, x) => t + (Number(x.Nilai) || 0), 0) };
      ws.getCell(`C${r}`).numFmt = rp;
      r++;
    }
    r++;
  }

  // ── Legenda
  judul("Keterangan warna");
  const leg = [
    ["Kategori", "Layanan biru · Baru hijau · Sewa ungu"],
    ["Baris merah muda", "Order komplain / revisi aktif (label KOMPLAIN / REVISI merah tebal)"],
    ["Pembayaran", "Lunas hijau · DP kuning · Belum Bayar abu-abu"],
    ["Mandek", "Order tertahan ≥14 hari di status yang sama (oranye)"],
    ["Status Menunggu / Dibatalkan", "Tidak dihitung sebagai omset (Menunggu = belum pasti dikerjakan)"],
    ["Filter", "Gunakan tombol ▼ di judul kolom pada sheet Order untuk menyaring & mengurutkan"],
  ];
  for (const [a, b] of leg) {
    ws.getCell(`A${r}`).value = a; ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`B${r}:D${r}`); ws.getCell(`B${r}`).value = b;
    ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: "top" };
    r++;
  }
  aturCetak(ws);
  ws.pageSetup.printTitlesRow = undefined;
}

/**
 * @param {{rows: object[], meta: object[], layanan?: object[], info?: string[], filename?: string}} p
 *   rows  = 1 objek per order (kunci = judul kolom, seperti export lama)
 *   meta  = paralel dgn rows: { komplain, kategori (LAYANAN|BARU|SEWA), bayar (LUNAS|DP|BELUM_BAYAR), menunggu, dibatalkan }
 */
export async function exportOrdersStyled({ rows, meta, layanan = [], info = [], filename = "order" }) {
  if (!rows || rows.length === 0) throw new Error("Tidak ada order untuk diexport");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SANSS";
  wb.created = new Date();

  const { headers } = buatSheetOrder(wb, rows, meta);
  buatSheetRingkasan(wb, rows, meta, headers, [...info, `Diexport ${new Date().toLocaleString("id-ID")}`]);
  buatSheetKomplain(wb, rows, meta);
  buatSheetLayanan(wb, layanan);

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}
