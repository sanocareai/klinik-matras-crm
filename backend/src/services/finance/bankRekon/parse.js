// PARSER REKENING KORAN (XLSX / CSV) — MURNI (tanpa database), supaya bisa dites dengan berkas contoh.
//
// Aturan: parser hanya MEMBACA dan menormalkan. Ia tidak membuat jurnal, tidak mengubah saldo buku, dan tidak menebak yang ambigu —
// baris yang tidak bisa dibaca dilaporkan sebagai galat (nomor baris + alasan), bukan dibuang atau diperbaiki diam-diam.
//
// Format yang didukung dengan deteksi otomatis (pemetaan kolom tetap bisa diubah di pratinjau):
//   • kolom Debit & Kredit terpisah (Mandiri Online/Livin/Cash Management)  → debit = uang KELUAR, kredit = uang MASUK menurut bank
//   • satu kolom Jumlah bertanda (negatif = keluar) atau Jumlah + kolom jenis DB/CR
//   • tanggal: tanggal Excel, yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, "dd Mmm yyyy" (bulan Indonesia/Inggris), boleh disertai jam
//   • nominal gaya Indonesia (1.234.567,89) maupun Inggris (1,234,567.89), "Rp", DB/CR, kurung = negatif
import crypto from "node:crypto";
import ExcelJS from "exceljs";

export class ParseError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "ParseError";
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

export const MAKS_BYTE = 5 * 1024 * 1024;
export const MAKS_BARIS = 20_000;

const BULAN = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12 };

export const BIDANG = Object.freeze(["tanggal", "tanggalEfektif", "deskripsi", "referensi", "debit", "kredit", "jumlah", "jenis", "saldo"]);
export const LABEL_BIDANG = Object.freeze({
  tanggal: "Tanggal transaksi", tanggalEfektif: "Tanggal efektif / valuta", deskripsi: "Keterangan", referensi: "Referensi / No. bukti", debit: "Debit (uang keluar)",
  kredit: "Kredit (uang masuk)", jumlah: "Jumlah (satu kolom)", jenis: "Jenis DB/CR", saldo: "Saldo",
});

// Kata kunci header (huruf kecil, tanpa tanda baca). Urutan tidak berarti; satu kolom dipakai satu bidang saja.
const KUNCI = {
  tanggalEfektif: ["val date", "value date", "tanggal valuta", "tgl valuta", "tanggal efektif", "tgl efektif", "effective date", "posting date", "tanggal posting"],
  tanggal: ["tanggal", "tgl", "date", "transaction date", "tanggal transaksi", "tgl transaksi", "waktu", "post date"],
  deskripsi: ["keterangan", "remark", "remarks", "description", "deskripsi", "uraian", "berita", "transaction detail", "detail transaksi", "narasi", "narrative", "transaction description"],
  referensi: ["referensi", "reference", "reference no", "no referensi", "no. referensi", "no bukti", "ref", "ref no", "nomor referensi", "journal no", "no jurnal", "customer reference"],
  debit: ["debit", "debet", "db", "uang keluar", "keluar", "withdrawal", "dana keluar", "mutasi debit", "debit amount"],
  kredit: ["kredit", "credit", "cr", "uang masuk", "masuk", "deposit", "dana masuk", "mutasi kredit", "credit amount"],
  jumlah: ["jumlah", "amount", "nominal", "mutasi", "nilai"],
  jenis: ["jenis", "tipe", "type", "dc", "d/c", "db/cr", "cr/db", "debit/kredit", "d/k"],
  saldo: ["saldo", "balance", "saldo akhir", "running balance", "saldo berjalan", "ending balance"],
};

const norm = (v) => String(v ?? "").toLowerCase().replace(/[\r\n\t]+/g, " ").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Isi sel → teks bersih (angka/tanggal Excel dipertahankan lewat konversi di bawah). */
function teks(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return String(v);
  }
  return String(v);
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Pembaca CSV sederhana yang aman terhadap tanda kutip & baris baru di dalam sel. Pemisah dideteksi dari baris awal. */
export function parseCsv(textRaw) {
  const text = String(textRaw).replace(/^﻿/, "");
  const contoh = text.split(/\r?\n/).slice(0, 15).join("\n");
  const hitung = (d) => (contoh.match(new RegExp(`\\${d}`, "g")) || []).length;
  const pemisah = [",", ";", "\t", "|"].map((d) => [d, hitung(d)]).sort((a, b) => b[1] - a[1])[0][0];
  const baris = [];
  let sel = "", row = [], dalamKutip = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (dalamKutip) {
      if (c === '"') { if (text[i + 1] === '"') { sel += '"'; i += 1; } else dalamKutip = false; } else sel += c;
    } else if (c === '"') dalamKutip = true;
    else if (c === pemisah) { row.push(sel); sel = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(sel); sel = "";
      baris.push(row.some((x) => String(x).trim() !== "") ? row : []); // baris kosong dipertahankan: nomor baris = nomor baris di berkas
      row = [];
    } else sel += c;
  }
  row.push(sel);
  if (row.some((x) => String(x).trim() !== "")) baris.push(row);
  while (baris.length && baris[baris.length - 1].length === 0) baris.pop();
  return { baris, pemisah };
}

/**
 * Nilai satu sel Excel. Tanggal tetap Date, angka tetap angka; formula → hasilnya; teks KAYA (richText — dipakai ekspor Mandiri untuk SEMUA sel) dan hyperlink → teks biasa.
 * Tanpa ini sel rich text sampai ke parser sebagai objek dan seluruh baris ditolak ("Tanggal 01/09/26 tidak terbaca").
 */
function nilaiSel(cell) {
  const v = cell.type === 6 /* formula */ ? cell.result : cell.value;
  if (v instanceof Date || v == null || typeof v !== "object") return v;
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
  if (v.text != null) return String(v.text);
  if (v.result != null) return v.result instanceof Date ? v.result : String(v.result);
  return v;
}

/** Baca berkas → { format, baris: any[][] } (semua baris apa adanya, termasuk judul/kop di atas tabel). */
export async function bacaBerkas(buffer, namaBerkas = "") {
  if (!buffer || !buffer.length) throw new ParseError("Berkas kosong", 400, "BERKAS_KOSONG");
  if (buffer.length > MAKS_BYTE) throw new ParseError(`Berkas terlalu besar (maks ${MAKS_BYTE / 1024 / 1024} MB)`, 413, "BERKAS_BESAR");
  const nama = String(namaBerkas).toLowerCase();
  const xlsx = buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK" = zip = xlsx
  if (xlsx || nama.endsWith(".xlsx")) {
    if (!xlsx) throw new ParseError("Berkas .xlsx tidak valid", 400, "BERKAS_RUSAK");
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch { throw new ParseError("Berkas Excel tidak bisa dibaca (rusak atau bukan .xlsx)", 400, "BERKAS_RUSAK"); }
    const ws = wb.worksheets.find((w) => w.rowCount > 1) || wb.worksheets[0];
    if (!ws) throw new ParseError("Berkas Excel tidak punya lembar kerja", 400, "BERKAS_RUSAK");
    const baris = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const nilai = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { nilai[col - 1] = nilaiSel(cell); });
      for (let i = 0; i < nilai.length; i += 1) if (nilai[i] === undefined) nilai[i] = null;
      if (nilai.some((x) => x != null && teks(x).trim() !== "")) baris[row.number - 1] = nilai; // nomor baris = nomor baris di Excel
    });
    for (let i = 0; i < baris.length; i += 1) if (!baris[i]) baris[i] = [];
    return { format: "XLSX", baris };
  }
  if (nama.endsWith(".xls")) throw new ParseError("Format .xls lama tidak didukung — simpan ulang sebagai .xlsx atau .csv", 400, "FORMAT_TIDAK_DIDUKUNG");
  const { baris, pemisah } = parseCsv(buffer.toString("utf8"));
  return { format: "CSV", baris, pemisah };
}

// ── Header & pemetaan ───────────────────────────────────────────────────────────────────────────────────────────
function skorKolom(judul) {
  const n = norm(judul);
  const hasil = {};
  for (const [bidang, kata] of Object.entries(KUNCI)) {
    if (kata.includes(n)) hasil[bidang] = 3;
    else if (kata.some((k) => k.length > 3 && n.includes(k))) hasil[bidang] = 1;
  }
  return hasil;
}

/** Cari baris header (di 40 baris awal): baris dengan paling banyak kolom yang dikenali, wajib punya tanggal DAN (debit/kredit/jumlah). */
export function cariBarisHeader(baris) {
  let terbaik = { idx: -1, skor: 0 };
  baris.slice(0, 40).forEach((row, idx) => {
    const bidang = new Set();
    let skor = 0;
    row.forEach((c) => { const s = skorKolom(teks(c)); for (const [b, v] of Object.entries(s)) { bidang.add(b); skor += v; } });
    const lengkap = bidang.has("tanggal") && (bidang.has("debit") || bidang.has("kredit") || bidang.has("jumlah"));
    if (lengkap && skor > terbaik.skor) terbaik = { idx, skor };
  });
  return terbaik.idx;
}

/** Pemetaan otomatis: { bidang: indeksKolom } — satu kolom hanya untuk satu bidang (skor tertinggi menang). */
export function deteksiPemetaan(headers) {
  const kandidat = [];
  headers.forEach((h, i) => { for (const [bidang, v] of Object.entries(skorKolom(teks(h)))) kandidat.push({ bidang, i, v }); });
  kandidat.sort((a, b) => b.v - a.v || a.i - b.i);
  const peta = {}; const terpakai = new Set();
  for (const k of kandidat) {
    if (peta[k.bidang] != null || terpakai.has(k.i)) continue;
    peta[k.bidang] = k.i; terpakai.add(k.i);
  }
  // Bila ada Debit/Kredit terpisah, kolom "Jumlah" tunggal tidak dipakai (hindari ganda).
  if (peta.debit != null && peta.kredit != null) delete peta.jumlah;
  return peta;
}

/** Validasi pemetaan dari pengguna: indeks kolom harus bilangan bulat dalam jangkauan; wajib tanggal + deskripsi + (debit/kredit atau jumlah). */
export function validasiPemetaan(peta, jumlahKolom) {
  const bersih = {};
  for (const b of BIDANG) {
    const v = peta?.[b];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= jumlahKolom) throw new ParseError(`Pemetaan kolom "${LABEL_BIDANG[b]}" tidak valid`, 400, "PEMETAAN_TIDAK_VALID");
    bersih[b] = n;
  }
  const pakai = Object.values(bersih);
  if (new Set(pakai).size !== pakai.length) throw new ParseError("Satu kolom tidak boleh dipetakan ke dua bidang", 400, "PEMETAAN_GANDA");
  if (bersih.tanggal == null) throw new ParseError("Kolom tanggal transaksi wajib dipetakan", 400, "PEMETAAN_KURANG");
  if (bersih.deskripsi == null) throw new ParseError("Kolom keterangan wajib dipetakan", 400, "PEMETAAN_KURANG");
  if (bersih.debit == null && bersih.kredit == null && bersih.jumlah == null) throw new ParseError("Petakan kolom Debit/Kredit, atau satu kolom Jumlah", 400, "PEMETAAN_KURANG");
  return bersih;
}

// ── Nilai ───────────────────────────────────────────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const tglIso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 31 Feb dst
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Tanggal → "YYYY-MM-DD" atau null bila tidak terbaca. TIDAK menebak format ambigu dd/mm vs mm/dd: Indonesia selalu dd/mm. */
export function parseTanggal(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : tglIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") { // serial Excel (hari sejak 1899-12-30)
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return tglIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const t = String(v).trim().replace(/\s+/g, " ");
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/);
  if (m) return tglIso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[ T,].*)?$/);
  if (m) return tglIso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]*(\d{4}|\d{2})(?:[ T,].*)?$/);
  if (m && BULAN[m[2].toLowerCase()]) return tglIso(m[3].length === 2 ? 2000 + +m[3] : +m[3], BULAN[m[2].toLowerCase()], +m[1]);
  return null;
}

/**
 * Nominal → { nilai: string 2 desimal (selalu >= 0), tanda: -1|0|1 } atau null bila bukan angka. Mengembalikan tanda terpisah supaya pemanggil
 * bisa menafsirkan "-" / kurung / DB / CR sesuai kolomnya. Heuristik pemisah:
 *   dua jenis pemisah → yang TERAKHIR adalah desimal; satu jenis muncul >1 kali → ribuan; satu kali diikuti 3 digit → ribuan; selain itu → desimal.
 */
export function parseNominal(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return { nilai: Math.abs(v).toFixed(2), tanda: v < 0 ? -1 : v > 0 ? 1 : 0 };
  }
  let t = String(v).trim();
  if (!t) return null;
  let tanda = 1;
  if (/^\(.*\)$/.test(t)) { tanda = -1; t = t.slice(1, -1); }
  if (/(^|\s)(DB|DR|D)\b\.?$/i.test(t) || /^(DB|DR)\b/i.test(t)) { tanda = -1; t = t.replace(/(\s*\b(DB|DR|D)\b\.?$)|(^\s*(DB|DR)\b\s*)/i, ""); }
  else if (/(^|\s)(CR|K|C)\b\.?$/i.test(t) || /^CR\b/i.test(t)) { t = t.replace(/(\s*\b(CR|K|C)\b\.?$)|(^\s*CR\b\s*)/i, ""); }
  t = t.replace(/^(rp\.?|idr)\s*/i, "").replace(/\s+/g, "");
  if (t.startsWith("-")) { tanda = -tanda; t = t.slice(1); } else if (t.startsWith("+")) t = t.slice(1);
  if (t.endsWith("-")) { tanda = -tanda; t = t.slice(0, -1); }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const titik = (t.match(/\./g) || []).length, koma = (t.match(/,/g) || []).length;
  let bulat, desimal = "";
  if (titik && koma) {
    const dec = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const idx = t.lastIndexOf(dec);
    bulat = t.slice(0, idx).replace(/[.,]/g, ""); desimal = t.slice(idx + 1);
  } else if (titik || koma) {
    const p = titik ? "." : ",";
    const n = titik || koma;
    const idx = t.lastIndexOf(p);
    const belakang = t.slice(idx + 1);
    if (n > 1 || belakang.length === 3) bulat = t.replace(/[.,]/g, "");
    else { bulat = t.slice(0, idx); desimal = belakang; }
  } else bulat = t;
  if (desimal.length > 2 || (desimal && !/^\d+$/.test(desimal)) || !/^\d*$/.test(bulat)) return null;
  const angka = Number(`${bulat || "0"}.${(desimal + "00").slice(0, 2)}`);
  if (!Number.isFinite(angka)) return null;
  return { nilai: angka.toFixed(2), tanda: angka === 0 ? 0 : tanda };
}

const rapikan = (v) => teks(v).replace(/\s+/g, " ").trim();

/** Normalisasi keterangan untuk sidik jari (huruf kecil, spasi tunggal). */
export const normalisasiTeks = (v) => rapikan(v).toLowerCase();

/**
 * Baris tabel → baris bank ternormalisasi. Kembalian: { baris, galat, urutan }.
 *  baris[i] = { noBaris (nomor di berkas, 1-based), tanggal, tanggalEfektif, deskripsi, referensi, debit, kredit, saldo, raw }
 *  Baris yang seluruh kolom kuncinya kosong (mis. baris "Saldo awal/Total" tanpa tanggal) dilewati dengan catatan, bukan galat; baris bertanggal tetapi nominalnya tidak terbaca = galat.
 */
export function parseBaris(rows, headerIdx, pemetaan, deskripsiTambahan = []) {
  const header = rows[headerIdx].map((c) => rapikan(c));
  const baris = []; const galat = []; const dilewati = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    const noBaris = r + 1;
    const sel = (b) => (pemetaan[b] == null ? null : row[pemetaan[b]]);
    const tanggal = parseTanggal(sel("tanggal"));
    const adaNominal = ["debit", "kredit", "jumlah"].some((b) => { const x = sel(b); return x != null && rapikan(x) !== ""; });
    if (!tanggal) {
      if (adaNominal || rapikan(sel("tanggal")) !== "") {
        // Ada isi tetapi bukan tanggal: baris ringkasan/total/saldo awal → dilewati bila tidak bernominal; selain itu galat.
        if (adaNominal && /\d/.test(rapikan(sel("tanggal")))) galat.push({ noBaris, pesan: `Tanggal "${rapikan(sel("tanggal"))}" tidak terbaca` });
        else dilewati.push({ noBaris, alasan: "bukan baris transaksi (tidak ada tanggal)" });
      }
      continue;
    }
    let debit = null, kredit = null;
    if (pemetaan.debit != null || pemetaan.kredit != null) {
      const d = parseNominal(sel("debit")), k = parseNominal(sel("kredit"));
      if (sel("debit") != null && rapikan(sel("debit")) !== "" && !d) { galat.push({ noBaris, pesan: `Debit "${rapikan(sel("debit"))}" bukan angka` }); continue; }
      if (sel("kredit") != null && rapikan(sel("kredit")) !== "" && !k) { galat.push({ noBaris, pesan: `Kredit "${rapikan(sel("kredit"))}" bukan angka` }); continue; }
      debit = d ? d.nilai : "0.00"; kredit = k ? k.nilai : "0.00";
      if (d && k && Number(d.nilai) > 0 && Number(k.nilai) > 0) { galat.push({ noBaris, pesan: "Debit dan kredit terisi bersamaan" }); continue; }
    } else {
      const j = parseNominal(sel("jumlah"));
      if (!j) { galat.push({ noBaris, pesan: `Jumlah "${rapikan(sel("jumlah"))}" bukan angka` }); continue; }
      let keluar = j.tanda < 0;
      if (pemetaan.jenis != null) {
        const jenis = rapikan(sel("jenis")).toUpperCase();
        if (/^(DB|DR|D|DEBIT|DEBET)\b/.test(jenis)) keluar = true;
        else if (/^(CR|K|C|KREDIT|CREDIT)\b/.test(jenis)) keluar = false;
        else { galat.push({ noBaris, pesan: `Jenis DB/CR "${jenis}" tidak dikenal` }); continue; }
      }
      debit = keluar ? j.nilai : "0.00"; kredit = keluar ? "0.00" : j.nilai;
    }
    if (Number(debit) === 0 && Number(kredit) === 0) { dilewati.push({ noBaris, alasan: "nominal nol" }); continue; }
    let saldo = null;
    if (pemetaan.saldo != null && rapikan(sel("saldo")) !== "") {
      const s = parseNominal(sel("saldo"));
      if (!s) { galat.push({ noBaris, pesan: `Saldo "${rapikan(sel("saldo"))}" bukan angka` }); continue; }
      saldo = (s.tanda < 0 ? "-" : "") + s.nilai;
    }
    const tglEfektif = pemetaan.tanggalEfektif != null ? parseTanggal(sel("tanggalEfektif")) : null;
    // Keterangan = kolom utama + kolom keterangan tambahan (Mandiri punya DUA kolom "Description": uraian & catatan pengirim). Tanda kutip pembungkus sel dibuang.
    const deskripsi = [sel("deskripsi"), ...deskripsiTambahan.map((i) => row[i])].map((x) => rapikan(x).replace(/^"+|"+$/g, "").trim()).filter(Boolean).join(" | ");
    if (!deskripsi) { galat.push({ noBaris, pesan: "Keterangan kosong" }); continue; }
    const raw = {};
    header.forEach((h, i) => { const v = row[i]; raw[h || `kolom_${i + 1}`] = v instanceof Date ? v.toISOString().slice(0, 10) : (v == null ? null : (typeof v === "object" ? teks(v) : v)); });
    baris.push({ noBaris, tanggal, tanggalEfektif: tglEfektif, deskripsi, referensi: pemetaan.referensi != null ? (rapikan(sel("referensi")) || null) : null, debit, kredit, saldo, raw });
  }
  // Urutan kronologis: berkas yang diurut dari terbaru ke terlama dibalik supaya nomor baris & rantai saldo menurut waktu.
  let urutan = "TERLAMA_DULU";
  if (baris.length > 1 && baris[0].tanggal > baris[baris.length - 1].tanggal) { baris.reverse(); urutan = "TERBARU_DULU"; }
  return { baris, galat, dilewati, urutan };
}

/** Rantai saldo: saldo_i = saldo_{i-1} + kredit_i − debit_i. Dilaporkan, TIDAK memblokir (sebagian bank memformat saldo berbeda). */
export function periksaRantaiSaldo(baris) {
  const ada = baris.filter((b) => b.saldo != null);
  if (ada.length < 2 || ada.length !== baris.length) return { diperiksa: false, konsisten: null, putus: [] };
  const putus = [];
  for (let i = 1; i < baris.length; i += 1) {
    const harus = (Number(baris[i - 1].saldo) * 100 + Number(baris[i].kredit) * 100 - Number(baris[i].debit) * 100) / 100;
    if (Math.abs(harus - Number(baris[i].saldo)) > 0.005) putus.push({ noBaris: baris[i].noBaris, diharapkan: harus.toFixed(2), tertulis: Number(baris[i].saldo).toFixed(2) });
  }
  return { diperiksa: true, konsisten: putus.length === 0, putus: putus.slice(0, 20), jumlahPutus: putus.length };
}

/**
 * Sidik jari tiap baris — mencegah baris yang sama masuk dua kali walau berkasnya berbeda (mis. rekening koran bulanan lalu rentang tanggal yang tumpang tindih).
 * Baris yang IDENTIK dalam satu berkas (dua biaya Rp2.500 di hari yang sama) diberi nomor kemunculan supaya tidak dianggap ganda; berkas tumpang tindih
 * menghasilkan nomor kemunculan yang sama untuk baris yang sama, jadi tetap terdeteksi.
 */
export function sidikJariBaris(cashAccountId, baris) {
  const muncul = new Map();
  return baris.map((b) => {
    const dasar = [cashAccountId, b.tanggal, normalisasiTeks(b.deskripsi), normalisasiTeks(b.referensi ?? ""), b.debit, b.kredit, b.saldo ?? ""].join("|");
    const ke = (muncul.get(dasar) ?? 0) + 1;
    muncul.set(dasar, ke);
    return crypto.createHash("sha256").update(`${dasar}|#${ke}`).digest("hex");
  });
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Pipeline lengkap berkas → hasil terparse + diagnosa. `pemetaanManual` (opsional) menggantikan deteksi otomatis. */
export async function telaahBerkas(buffer, namaBerkas, pemetaanManual = null) {
  const { format, baris: rows } = await bacaBerkas(buffer, namaBerkas);
  const headerIdx = cariBarisHeader(rows);
  if (headerIdx < 0) {
    if (!pemetaanManual) throw new ParseError("Baris judul kolom tidak ditemukan. Pastikan ada kolom Tanggal, Keterangan, dan Debit/Kredit (atau Jumlah).", 400, "HEADER_TIDAK_ADA");
  }
  const idx = headerIdx >= 0 ? headerIdx : Math.max(0, Number(pemetaanManual?.barisJudul ?? 0));
  const headers = rows[idx] || [];
  const otomatis = deteksiPemetaan(headers);
  const pemetaan = validasiPemetaan(pemetaanManual?.kolom ?? otomatis, Math.max(headers.length, ...rows.slice(idx).map((r) => r.length)));
  // Kolom lain yang JUGA dikenali sebagai keterangan (bukan yang sudah dipetakan) ikut digabung — hanya pada pemetaan otomatis.
  const tambahan = pemetaanManual?.kolom ? [] : headers.map((h, i) => [h, i]).filter(([h, i]) => i !== pemetaan.deskripsi && skorKolom(teks(h)).deskripsi >= 3 && !Object.values(pemetaan).includes(i)).map(([, i]) => i);
  const hasil = parseBaris(rows, idx, pemetaan, tambahan);
  if (hasil.baris.length > MAKS_BARIS) throw new ParseError(`Berkas memuat ${hasil.baris.length.toLocaleString("id-ID")} baris (maks ${MAKS_BARIS.toLocaleString("id-ID")}). Pecah per periode.`, 413, "BARIS_TERLALU_BANYAK");
  return { format, headers: headers.map((h) => rapikan(h)), barisJudul: idx, pemetaan, pemetaanOtomatis: otomatis, deskripsiTambahan: tambahan, ...hasil, rantaiSaldo: periksaRantaiSaldo(hasil.baris), totalBarisBerkas: rows.length };
}
