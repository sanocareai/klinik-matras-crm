// Pembuat lembar opname (Excel) untuk cutover persediaan — dua berkas dengan peruntukan BERBEDA:
//   1. Lembar Hitung   → dibagikan ke penghitung. BUTA: tidak memuat saldo sistem, nilai, ataupun file Jan–Sep.
//   2. Rekonsiliasi    → TERTUTUP (Gudang + Finance + Owner): saldo ledger, dokumen tertunda, nilai buku Finance, keputusan per barang.
// Judul kolom lembar hitung diambil dari KOLOM_HITUNG supaya cocok dengan pembaca scripts/opname-preview.mjs.
import ExcelJS from "exceljs";
import { KOLOM_HITUNG, KOLOM_LOG, KOLOM_HARGA, DEFAULTS } from "./opnameCutover.js";

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, alignment: { vertical: "middle", wrapText: true } };
const INPUT = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } };
const sheetWith = (wb, nama, kolom, rows, { freeze = 0 } = {}) => {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", xSplit: freeze, ySplit: 1 }] });
  ws.columns = kolom.map((c) => ({ header: c.h, key: c.k, width: c.w || 14, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getRow(1).eachCell((c) => Object.assign(c, HEAD)); ws.getRow(1).height = 36;
  for (const r of rows) ws.addRow(r);
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  return ws;
};

const LOKASI_BAWAAN = "RAW-MATERIAL";

/** @param ds dataset — lihat docs/RUNBOOK. materials[], locations[], pending[], pilotKodes Set|null */
export function buatLembarHitung(ds, { pilotSaja = false, judul = "LEMBAR HITUNG OPNAME FISIK" } = {}) {
  const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — cutover persediaan";
  const petunjuk = wb.addWorksheet("Petunjuk");
  petunjuk.columns = [{ width: 120 }];
  const isiPetunjuk = [
    judul + (pilotSaja ? " — PILOT" : " — PENUH"),
    "Lembar ini BUTA: sengaja tidak memuat saldo sistem. Hitung apa yang ada di depan Anda, jangan menebak, jangan menyalin angka dari file lama.",
    "1. Isi sheet 'Sesi' lebih dulu (tanggal, mulai, selesai, penghitung, pemeriksa, nomor dokumen terakhir sebelum hitung).",
    "2. Satu baris = satu Material di satu Lokasi. Bahan ada di dua lokasi → salin baris dan ganti Lokasi.",
    "3. 'Status hitung': DIHITUNG (ada barang, isi angka > 0) · NOL_FISIK (sudah dicari, tidak ada: isi 0, wajib foto/bukti) · BELUM_DIHITUNG (jangan diubah bila belum dihitung).",
    "   KOLOM KOSONG BUKAN NOL. Angka 0 hanya sah bila status NOL_FISIK dan diperiksa orang lain.",
    "4. Kolom jumlah di rak = barang MILIK SANO yang ada di lokasi itu. JANGAN campurkan: barang tiba belum diposting GR, sudah-diambil-untuk-Issue, dalam perjalanan, sisa di lantai produksi, atau milik customer — masing-masing punya kolom sendiri.",
    "5. Waktu mulai/selesai per baris (format 2026-10-31 09:15, WIB). Pemeriksa harus orang LAIN dari penghitung dan menghitung ulang/menyaksikan.",
    "6. Setiap pergerakan barang yang terjadi SELAMA jendela hitung (barang masuk/keluar/pindah) wajib dicatat di sheet 'Log pergerakan jendela'.",
    "7. Selisih besar atau nol fisik: lampirkan bukti (nomor foto rak/label atau nomor form). Jangan mengisi harga — harga urusan Finance.",
    `8. Batas wajar satu baris hitung: ${DEFAULTS.jendelaMaksJam} jam. Bila lebih lama, pecah baris.`,
  ];
  isiPetunjuk.forEach((t, i) => { const r = petunjuk.addRow([t]); r.alignment = { wrapText: true, vertical: "top" }; if (i === 0) r.font = { bold: true, size: 14 }; });

  // Sesi
  const ses = wb.addWorksheet("Sesi");
  ses.columns = [{ width: 52 }, { width: 48 }];
  [["Tanggal opname", ""], ["Zona / lokasi yang dihitung", ""], ["Waktu mulai (WIB)", ""], ["Waktu selesai (WIB)", ""], ["Penghitung 1", ""], ["Penghitung 2", ""], ["Pemeriksa Gudang (orang lain)", ""],
    ["Pemeriksa Finance (saksi)", ""], ["Gudang dibekukan selama hitung? (YA/TIDAK)", ""], ["No. GR terakhir sebelum hitung", ""], ["No. Material Issue terakhir sebelum hitung", ""], ["No. Transfer terakhir sebelum hitung", ""],
    ["No. Adjustment/Stock Count terakhir sebelum hitung", ""], ["Catatan", ""]].forEach(([a]) => { const r = ses.addRow([a, null]); r.getCell(2).fill = INPUT; });

  // Hitung
  const ms = ds.materials.filter((m) => !pilotSaja || ds.pilotKodes?.has(m.code));
  const pendingPerKode = new Map();
  for (const p of ds.pending || []) (pendingPerKode.get(p.materialCode) || pendingPerKode.set(p.materialCode, []).get(p.materialCode)).push(p);
  const urut = [...ms].sort((a, b) => (b.active === true) - (a.active === true) || a.code.localeCompare(b.code));
  const ws = wb.addWorksheet("Hitung", { views: [{ state: "frozen", xSplit: 4, ySplit: 1 }] });
  const hdr = Object.values(KOLOM_HITUNG).concat(["Catatan lantai (dokumen tertunda)"]);
  ws.addRow(hdr); ws.getRow(1).eachCell((c) => Object.assign(c, HEAD)); ws.getRow(1).height = 48;
  [6, 38, 28, 40, 9, 16, 16, 14, 14, 14, 14, 14, 14, 17, 17, 16, 16, 18, 28, 44].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  urut.forEach((m, i) => {
    const pend = pendingPerKode.get(m.code) || [];
    const cat = [];
    if (pend.some((p) => p.jenis === "GR_TERTUNDA")) cat.push("Ada GR belum diposting: " + [...new Set(pend.filter((p) => p.jenis === "GR_TERTUNDA").map((p) => p.dok))].join(", ") + " — hitung di kolom GR, jangan di rak");
    if (pend.some((p) => p.jenis === "ISSUE_TERTUNDA")) cat.push("Ada Issue belum diposting: " + [...new Set(pend.filter((p) => p.jenis === "ISSUE_TERTUNDA").map((p) => p.dok))].join(", ") + " — barang yang sudah diambil masuk kolom Staging");
    if (pend.some((p) => p.jenis === "TRANSFER_DI_JALAN")) cat.push("Ada transfer di jalan: " + [...new Set(pend.filter((p) => p.jenis === "TRANSFER_DI_JALAN").map((p) => p.dok))].join(", "));
    if (m.active === false) cat.push("Material NONAKTIF — cukup konfirmasi ada/tidak");
    const lokasi = ds.locations.find((l) => l.code === (m.storageHint || "").toUpperCase())?.code || LOKASI_BAWAAN;
    const r = ws.addRow([i + 1, m.id, m.code, m.name, m.unit, lokasi, "BELUM_DIHITUNG", null, null, null, null, null, null, null, null, null, null, null, null, cat.join(" | ") || null]);
    for (const c of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) r.getCell(c).fill = INPUT;
    r.alignment = { vertical: "top", wrapText: true };
    r.getCell(7).dataValidation = { type: "list", allowBlank: false, formulae: ['"DIHITUNG,NOL_FISIK,BELUM_DIHITUNG"'] };
    r.getCell(6).dataValidation = { type: "list", allowBlank: false, formulae: [`"${ds.locations.map((l) => l.code).join(",")}"`] };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hdr.length } };

  const log = wb.addWorksheet("Log pergerakan jendela");
  log.addRow(Object.values(KOLOM_LOG)); log.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  [34, 24, 12, 20, 36, 20].forEach((w, i) => { log.getColumn(i + 1).width = w; });
  log.getColumn(5).eachCell?.(() => {});
  for (let r = 2; r <= 60; r++) log.getCell(r, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"YA,TIDAK"'] };

  const lok = wb.addWorksheet("Daftar lokasi");
  lok.addRow(["Kode", "Zona", "Jenis", "Aktif"]); lok.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  for (const l of ds.locations) lok.addRow([l.code, l.zone, l.locationType, l.active ? "ya" : "tidak"]);
  lok.columns.forEach((c) => { c.width = 24; });
  return wb;
}

/** Berkas TERTUTUP: keputusan per barang + referensi + template harga Finance + gerbang. */
export function buatRekonsiliasi(ds) {
  const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — cutover persediaan (tertutup)";
  const tahapOrder = ["0_PILOT", "1_GELOMBANG_1", "2_GELOMBANG_2", "3_NONAKTIF"];
  const rows = ds.keputusan.slice().sort((a, b) => tahapOrder.indexOf(a.tahap) - tahapOrder.indexOf(b.tahap) || a.kode.localeCompare(b.kode));
  const asRp = "#,##0;[Red]-#,##0";
  sheetWith(wb, "Keputusan per barang", [
    { h: "Tahap", k: "tahap", w: 16 }, { h: "Material ID", k: "id", w: 38 }, { h: "Kode", k: "kode", w: 30 }, { h: "Nama", k: "nama", w: 36 }, { h: "Satuan", k: "unit", w: 9 }, { h: "Aktif", k: "aktif", w: 7 },
    { h: "Kategori", k: "kategori", w: 14 }, { h: "Vendor (master)", k: "vendor", w: 22 },
    { h: `Saldo ledger saat cetak (${ds.meta.cutoffLabel})`, k: "ledger", w: 14, fmt: "#,##0.##;[Red]-#,##0.##" }, { h: "Jumlah pergerakan", k: "nMov", w: 10 }, { h: "Pergerakan terakhir", k: "lastMov", w: 17 },
    { h: "Dokumen tertunda (jangan dihitung ganda)", k: "pend", w: 40 }, { h: "Referensi file Jan–Sep: QTY SEP (BUKAN saldo)", k: "refSep", w: 14 }, { h: "Referensi file: pemakaian label SEP+OKT", k: "refPakai", w: 14 },
    { h: "Nilai buku Finance (Rp)", k: "buku", w: 15, fmt: asRp }, { h: "Kandidat harga dari GR terakhir (Rp/satuan, BUKAN keputusan)", k: "kandidatHarga", w: 18, fmt: asRp }, { h: "Harga referensi master (hanya pembanding)", k: "refMaster", w: 16, fmt: asRp },
    { h: "Temuan otomatis", k: "temuan", w: 48 }, { h: "Pertanyaan untuk Gudang", k: "qGudang", w: 44 }, { h: "Pertanyaan untuk Finance", k: "qFinance", w: 44 },
    { h: "KEPUTUSAN GUDANG", k: "dGudang", w: 28 }, { h: "KEPUTUSAN FINANCE", k: "dFinance", w: 28 }, { h: "Pemutus / tanggal", k: "pemutus", w: 22 },
  ], rows.map((r) => ({ ...r, aktif: r.aktif ? "ya" : "tidak" })), { freeze: 4 });

  sheetWith(wb, "Pilot", [
    { h: "Kode", k: "kode", w: 30 }, { h: "Nama", k: "nama", w: 38 }, { h: "Satuan", k: "unit", w: 9 }, { h: "Peran dalam pilot", k: "peran", w: 40 }, { h: "Alasan dipilih", k: "alasan", w: 70 },
  ], ds.pilot, {});

  sheetWith(wb, "Dokumen tertunda", [
    { h: "Jenis", k: "jenis", w: 22 }, { h: "Dokumen", k: "dok", w: 20 }, { h: "Status", k: "status", w: 20 }, { h: "Kode material", k: "materialCode", w: 36 }, { h: "Qty", k: "qty", w: 10 }, { h: "Tindakan sebelum hitung", k: "aksi", w: 60 },
  ], (ds.pending || []).map((p) => ({ ...p, aksi: p.jenis === "GR_TERTUNDA" ? "Selesaikan putaway (bila barang sudah diperiksa) ATAU biarkan dan hitung di kolom GR; jangan dua-duanya" : p.jenis === "ISSUE_TERTUNDA" ? "Posting Issue sebelum hitung ATAU hitung barang staging di kolom Staging" : "Selesaikan/terima transfer sebelum hitung" })), {});

  const hf = wb.addWorksheet("Harga Finance");
  hf.addRow(Object.values(KOLOM_HARGA)); hf.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  [34, 18, 40, 28, 40].forEach((w, i) => { hf.getColumn(i + 1).width = w; });
  hf.addRow(["(contoh) KAIN-001", 35500, "FAKTUR", "INV-2026-001", "hapus baris contoh ini"]);

  const rn = wb.addWorksheet("Rekonsiliasi nilai");
  rn.columns = [{ width: 70 }, { width: 24 }, { width: 70 }];
  const T = (a, b = null, c = null) => rn.addRow([a, b, c]);
  T("REKONSILIASI NILAI — TERPISAH dari rekonsiliasi kuantitas", null, "Diisi Finance setelah preview opname lolos tanpa BLOCKER").font = { bold: true };
  T("A. Nilai stok fisik (Σ qty fisik × harga dokumen Finance)", null, "Dari preview.xlsx › Ringkasan; hanya material berharga sah");
  T("B. Saldo buku 1-1400 per tanggal hitung", null, `Per ${ds.meta.dibuat}: Rp${(ds.meta.saldo1400 ?? 0).toLocaleString("id-ID")} (hanya GR 9 & 13 Okt) — verifikasi ulang tepat sebelum posting`);
  T("C. Penyesuaian jurnal PERSEDIAAN_AWAL (A − B)", null, "Dr 1-1400 / Cr 5-1100 bila A > B (arah dibalik bila A < B)");
  T("D. Material berstok fisik TANPA harga dokumen", null, "Harus 0 sebelum snapshot diperiksa; harga sheet/referensi master tidak sah");
  T("E. Selisih kuantitas NAIK (satuan campur — tidak dijumlah uang)", null, "Dari preview");
  T("F. Selisih kuantitas TURUN", null, "Dari preview — jangan di-offset dengan naik");
  T("G. Nilai selisih NAIK / TURUN (Rp, terpisah)", null, "Hanya baris DITETAPKAN");
  T("H. Rekonsiliasi: ledger Gudang sesudah adjustment = qty fisik per material?", null, "Cek ulang preview setelah adjustment diposting: semua SESUAI");

  const gate = wb.addWorksheet("Gerbang Go-NoGo");
  gate.columns = [{ width: 6 }, { width: 80 }, { width: 22 }, { width: 22 }];
  gate.addRow(["#", "Syarat", "Status (YA/TIDAK)", "Penanggung jawab"]); gate.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  (ds.gerbang || []).forEach((g, i) => gate.addRow([i + 1, g.syarat, g.status || "", g.pj || ""]));
  gate.eachRow((r, i) => { if (i > 1) r.alignment = { wrapText: true, vertical: "top" }; });

  const src = wb.addWorksheet("Sumber & batas");
  src.columns = [{ width: 36 }, { width: 120 }];
  for (const [a, b] of ds.sumber || []) { const r = src.addRow([a, b]); r.alignment = { wrapText: true, vertical: "top" }; }
  return wb;
}
