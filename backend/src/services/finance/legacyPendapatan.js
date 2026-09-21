// DATA SEBELUM SISTEM — register pendapatan historis NON-POSTING (arsip Notion sebelum sistem dipakai).
//
// PRINSIP (permintaan Owner 21 Sep 2026):
//  • BUKAN input pemasukan bebas: hanya impor berkas (CSV/XLSX) → PRATINJAU + validasi → masuk register → (nanti) rekonsiliasi & posting atas persetujuan Owner.
//  • TIDAK membuat jurnal, invoice, piutang, atau mengubah saldo Kas & Bank / JV-19092026-372 / akun koreksi saldo awal. Modul ini tidak mengimpor posting apa pun.
//  • Cutoff DITURUNKAN dari data produksi (tanggal order sistem paling awal), bukan ditebak. Baris bertanggal ≥ cutoff = periode sistem → tidak dihitung dari arsip.
//  • Idempoten: berkas identik (sha256) tidak membuat batch baru; identitas baris stabil (nomor lama, atau hash tanggal|pelanggan|nominal|keterangan).
//  • Baris meragukan → PERLU_DITINJAU (tidak dihitung, tidak diklasifikasi otomatis). Duplikat vs arsip lain dan vs order sistem dideteksi.
//  • Batch bisa dibatalkan selama postedAt kosong (belum pernah diposting).

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { toMoney, sumMoney, ZERO } from "./money.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class LegacyError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = "LegacyError"; this.statusCode = statusCode; }
}

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const wibTanggal = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const MAKS_BARIS = 20000;
const MAKS_BYTE = 8 * 1024 * 1024;
export const LABEL_STATUS_BARIS = { SIAP: "Siap (dihitung)", PERLU_DITINJAU: "Perlu ditinjau", DUPLIKAT: "Duplikat", DI_LUAR_PERIODE: "Di luar periode arsip", TIDAK_VALID: "Tidak valid" };
export const LABEL_BAYAR = { LUNAS: "Lunas", SEBAGIAN: "Sebagian", BELUM_BAYAR: "Belum dibayar", TIDAK_DIKETAHUI: "Tidak diketahui" };
const NADA = { SIAP: "success", PERLU_DITINJAU: "warning", DUPLIKAT: "neutral", DI_LUAR_PERIODE: "neutral", TIDAK_VALID: "danger" };

// ── CUTOFF (dari data produksi) ─────────────────────────────────────────────────────────────────────────────────
export async function hitungCutoff(db) {
  const o = await db.order.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true, orderNumber: true } });
  const pengakuan = await db.finJournalEntry.findFirst({ where: { source: "PENGAKUAN_PENDAPATAN", status: { in: STATUS_DIHITUNG } }, orderBy: { date: "asc" }, select: { date: true, entryNumber: true } });
  if (!o) return { tanggal: null, dasar: "Belum ada order di sistem", orderPertama: null, pengakuanPertama: pengakuan ? tgl(pengakuan.date) : null, celahPengakuan: null };
  const tanggal = wibTanggal(o.createdAt);
  const pengakuanTgl = pengakuan ? tgl(pengakuan.date) : null;
  // Celah: order sistem yang sudah ada tetapi belum ada pengakuan pendapatan di buku (periode antara order pertama dan pengakuan pertama). INFORMASI, tidak dijumlahkan.
  let celah = null;
  if (pengakuanTgl && pengakuanTgl > tanggal) {
    const orders = await db.order.findMany({
      where: { createdAt: { gte: new Date(`${tanggal}T00:00:00+07:00`), lt: new Date(`${pengakuanTgl}T00:00:00+07:00`) }, status: { not: "CANCELLED" } },
      select: { createdAt: true, value: true },
    });
    const perBulan = {};
    for (const x of orders) { const b = wibTanggal(x.createdAt).slice(0, 7); perBulan[b] ??= { jumlah: 0, nilai: ZERO }; perBulan[b].jumlah++; perBulan[b].nilai = perBulan[b].nilai.plus(toMoney(x.value ?? 0)); }
    celah = {
      dari: tanggal, sampai: pengakuanTgl, jumlahOrder: orders.length, nilaiOrder: uang(orders.length ? sumMoney(orders.map((x) => x.value ?? 0)) : ZERO),
      perBulan: Object.entries(perBulan).sort().map(([bulan, v]) => ({ bulan, jumlah: v.jumlah, nilai: uang(v.nilai) })),
      catatan: "Order sistem pada rentang ini belum memiliki pengakuan pendapatan di buku besar. Ini bukan bagian Data Sebelum Sistem dan TIDAK dijumlahkan ke pendapatan gabungan.",
    };
  }
  return { tanggal, dasar: `Order sistem paling awal: ${o.orderNumber} (${tanggal}). Transaksi SEBELUM tanggal ini = Data Sebelum Sistem; pada/sesudahnya harus berasal dari order/invoice sistem.`, orderPertama: { nomor: o.orderNumber, tanggal }, pengakuanPertama: pengakuanTgl, celahPengakuan: celah };
}

// ── PARSER ──────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS = {
  tanggal: ["tanggal", "tanggaltransaksi", "tgl", "tgltransaksi", "date", "tanggalorder", "tanggalpenjualan"],
  nomor: ["nomor", "noresi", "resi", "nomorresi", "noorder", "nomororder", "noinvoice", "nomorinvoice", "invoice", "nomorlama", "noresilama", "id", "ordernumber"],
  pelanggan: ["pelanggan", "customer", "namapelanggan", "namacustomer", "nama", "konsumen", "namakonsumen"],
  keterangan: ["keterangan", "deskripsi", "produk", "item", "layanan", "catatan", "description", "barang"],
  nominal: ["nominal", "jumlah", "total", "nilai", "amount", "harga", "omzet", "pendapatan", "totaltagihan", "totalharga"],
  status: ["statuspembayaran", "statusbayar", "status", "pembayaran", "paymentstatus"],
  tglbayar: ["tanggalpembayaran", "tanggalbayar", "tglbayar", "tglpembayaran", "paiddate", "tanggallunas"],
  metode: ["metodepembayaran", "metodebayar", "metode", "caraBayar".toLowerCase(), "paymentmethod", "carabayar"],
  sumber: ["sumberdata", "sumber", "source", "asaldata"],
  rekening: ["rekening", "rekeningpenerima", "rekeningtujuan", "bank", "banktujuan"],
  dibayar: ["dibayar", "jumlahdibayar", "terbayar", "paidamount", "nominaldibayar"],
};
const BULAN = { januari: 1, jan: 1, january: 1, februari: 2, feb: 2, february: 2, maret: 3, mar: 3, march: 3, april: 4, apr: 4, mei: 5, may: 5, juni: 6, jun: 6, june: 6, juli: 7, jul: 7, july: 7, agustus: 8, agu: 8, agt: 8, aug: 8, august: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, october: 10, november: 11, nov: 11, desember: 12, des: 12, dec: 12, december: 12 };

export function parseTanggal(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10); // sel tanggal Excel: hindari geser zona
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10); // serial Excel
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) return cek(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return cek(+m[3], +m[2], +m[1]); // dd/mm/yyyy (format Indonesia)
  if ((m = /^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s)) && BULAN[m[2].toLowerCase()]) return cek(+m[3], BULAN[m[2].toLowerCase()], +m[1]);
  if ((m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)) && BULAN[m[1].toLowerCase()]) return cek(+m[3], BULAN[m[1].toLowerCase()], +m[2]); // Notion: "January 12, 2026"
  return null;
}
function cek(y, mo, d) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** Uang teks/angka → string desimal "1234.50" (tanpa float untuk teks). Format: "Rp 1.500.000", "1.500.000,50", "1,500,000.50", "(2.000)". null bila tak terbaca. */
export function parseNominal(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? toMoney(String(v)).toFixed(2) : null;
  let s = String(v).trim().replace(/rp\.?/gi, "").replace(/\s/g, "");
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const titik = (s.match(/\./g) || []).length;
  const koma = (s.match(/,/g) || []).length;
  let desimal = "";
  let bulat = s;
  if (titik && koma) {
    const idxDes = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    bulat = s.slice(0, idxDes); desimal = s.slice(idxDes + 1);
  } else if (koma === 1 && /,\d{1,2}$/.test(s)) { bulat = s.split(",")[0]; desimal = s.split(",")[1]; }
  else if (titik === 1 && /\.\d{1,2}$/.test(s)) { bulat = s.split(".")[0]; desimal = s.split(".")[1]; }
  bulat = bulat.replace(/[.,]/g, "");
  if (!/^\d+$/.test(bulat) || (desimal && !/^\d+$/.test(desimal))) return null;
  const hasil = toMoney(`${bulat}${desimal ? `.${desimal}` : ""}`);
  return (neg ? hasil.negated() : hasil).toFixed(2);
}

function statusBayar(v) {
  const s = norm(v);
  if (!s) return "TIDAK_DIKETAHUI";
  if (/(belum|unpaid|pending|utang|piutang|tempo|nunggu|menunggu)/.test(s)) return "BELUM_BAYAR";
  if (/(dp|sebagian|cicil|partial|termin|kurang)/.test(s)) return "SEBAGIAN";
  if (/(lunas|paid|sudah|dibayar|selesai|done|full)/.test(s)) return "LUNAS";
  return "TIDAK_DIKETAHUI";
}

function parseCSV(teks) {
  const t = teks.replace(/^﻿/, "");
  const barisPertama = t.split(/\r?\n/, 1)[0] ?? "";
  const pemisah = [";", "\t", ","].map((c) => [c, barisPertama.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const hasil = [];
  let baris = []; let sel = ""; let kutip = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (kutip) {
      if (c === '"') { if (t[i + 1] === '"') { sel += '"'; i++; } else kutip = false; } else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) { baris.push(sel); sel = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; baris.push(sel); sel = ""; if (baris.some((x) => x.trim() !== "")) hasil.push(baris); baris = []; }
    else sel += c;
  }
  baris.push(sel); if (baris.some((x) => x.trim() !== "")) hasil.push(baris);
  return hasil;
}

async function parseXLSX(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.read(Readable.from(buffer));
  const ws = wb.worksheets[0];
  if (!ws) throw new LegacyError("Berkas XLSX tidak memiliki lembar kerja");
  const hasil = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const v = row.values.slice(1).map((c) => {
      if (c && typeof c === "object" && !(c instanceof Date)) return c.result ?? c.text ?? (Array.isArray(c.richText) ? c.richText.map((r) => r.text).join("") : null);
      return c;
    });
    if (v.some((x) => x !== null && x !== undefined && String(x).trim() !== "")) hasil.push(v);
  });
  return hasil;
}

/** Berkas → baris terpetakan. Kolom dipetakan dari NAMA HEADER (alias Indonesia/Inggris); kolom wajib: tanggal & nominal. */
export async function bacaBerkas(fileName, buffer) {
  if (!buffer?.length) throw new LegacyError("Berkas kosong");
  if (buffer.length > MAKS_BYTE) throw new LegacyError("Berkas terlalu besar (maksimal 8 MB)");
  const nama = String(fileName || "").toLowerCase();
  let tabel;
  if (nama.endsWith(".xlsx")) tabel = await parseXLSX(buffer);
  else if (nama.endsWith(".csv") || nama.endsWith(".txt")) tabel = parseCSV(buffer.toString("utf8"));
  else throw new LegacyError("Format berkas harus CSV atau XLSX");
  if (tabel.length < 2) throw new LegacyError("Berkas tidak memiliki baris data");
  if (tabel.length - 1 > MAKS_BARIS) throw new LegacyError(`Terlalu banyak baris (maksimal ${MAKS_BARIS})`);
  const header = tabel[0].map(norm);
  const peta = {};
  for (const [k, alias] of Object.entries(ALIAS)) { const i = header.findIndex((h) => alias.includes(h)); if (i >= 0) peta[k] = i; }
  if (peta.tanggal === undefined || peta.nominal === undefined) {
    throw new LegacyError(`Kolom wajib tidak ditemukan. Dibutuhkan kolom tanggal transaksi dan nominal. Header terbaca: ${tabel[0].map((x) => String(x ?? "")).join(" | ").slice(0, 200)}`);
  }
  const ambil = (r, k) => (peta[k] === undefined ? null : r[peta[k]] ?? null);
  const teks = (v) => (v === null || v === undefined ? null : String(v instanceof Date ? v.toISOString().slice(0, 10) : v).trim() || null);
  return {
    kolom: Object.fromEntries(Object.entries(peta).map(([k, i]) => [k, String(tabel[0][i] ?? "")])),
    baris: tabel.slice(1).map((r, i) => ({
      rowNo: i + 2, tanggalMentah: ambil(r, "tanggal"), nominalMentah: ambil(r, "nominal"), nomor: teks(ambil(r, "nomor")), pelanggan: teks(ambil(r, "pelanggan")), keterangan: teks(ambil(r, "keterangan")),
      statusMentah: ambil(r, "status"), tglBayarMentah: ambil(r, "tglbayar"), metode: teks(ambil(r, "metode")), sumber: teks(ambil(r, "sumber")), rekening: teks(ambil(r, "rekening")), dibayarMentah: ambil(r, "dibayar"),
    })),
  };
}

// ── VALIDASI + DEDUP ────────────────────────────────────────────────────────────────────────────────────────────
const ket = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const idStabil = (b, tanggal, nominal) => (b.nomor
  ? `NO-${b.nomor.trim().toUpperCase().replace(/\s+/g, "")}`
  : `LEG-${createHash("sha1").update([tanggal, ket(b.pelanggan), nominal, ket(b.keterangan)].join("|")).digest("hex").slice(0, 16)}`);

/**
 * Validasi & deduplikasi (murni terhadap data yang diberikan). `ada` = { legacyId → id baris lain aktif }, `orders` = daftar order sistem
 * ({id, orderNumber, value, tanggal, pelanggan}) untuk deteksi kemungkinan cocok.
 */
export function validasiBaris(bariBaris, { cutoff, awalArsip, hariIni, ada = new Map(), orders = [] }) {
  const lihatDalamBerkas = new Map();
  const urutId = new Map();
  const ordersByNomor = new Map(orders.map((o) => [String(o.orderNumber).toUpperCase(), o]));
  return bariBaris.map((b) => {
    const alasan = [];
    const tanggal = parseTanggal(b.tanggalMentah);
    const nominal = parseNominal(b.nominalMentah);
    const dibayar = parseNominal(b.dibayarMentah);
    const tglBayar = parseTanggal(b.tglBayarMentah);
    const pay = statusBayar(b.statusMentah);
    let status = "SIAP";
    const tandai = (s, teksAlasan) => { if (!(status === "TIDAK_VALID")) { const rank = { SIAP: 0, DI_LUAR_PERIODE: 1, PERLU_DITINJAU: 2, DUPLIKAT: 3, TIDAK_VALID: 4 }; if (rank[s] > rank[status]) status = s; } alasan.push(teksAlasan); };

    if (!tanggal) tandai("TIDAK_VALID", "Tanggal transaksi kosong atau tidak terbaca");
    if (nominal === null) tandai("TIDAK_VALID", "Nominal kosong atau tidak terbaca");
    else if (toMoney(nominal).isZero()) tandai("TIDAK_VALID", "Nominal nol");
    else if (toMoney(nominal).abs().greaterThan("1000000000000")) tandai("TIDAK_VALID", "Nominal tidak masuk akal (> Rp1 triliun)");
    else if (toMoney(nominal).isNegative()) tandai("PERLU_DITINJAU", "Nominal negatif (retur/koreksi?) — tidak diklasifikasikan otomatis");

    const id0 = idStabil(b, tanggal ?? "?", nominal ?? "?");
    let legacyId = id0;
    let matchedLegacyId = null; let matchedOrderId = null;

    if (status !== "TIDAK_VALID") {
      if (tanggal >= cutoff) tandai("DI_LUAR_PERIODE", `Bertanggal ${tanggal}, pada/setelah cutoff sistem ${cutoff}: periode ini harus berasal dari order/invoice sistem`);
      else if (tanggal < awalArsip) tandai("PERLU_DITINJAU", `Bertanggal ${tanggal}, sebelum awal periode arsip ${awalArsip}`);
      if (tanggal > hariIni) tandai("PERLU_DITINJAU", "Tanggal di masa depan");
      if (b.nomor && ordersByNomor.has(b.nomor.trim().toUpperCase())) { const o = ordersByNomor.get(b.nomor.trim().toUpperCase()); matchedOrderId = o.id; tandai("DUPLIKAT", `Nomor sama dengan order sistem ${o.orderNumber}`); }
      // duplikat dalam berkas
      const kunci = id0;
      if (lihatDalamBerkas.has(kunci)) {
        const pertama = lihatDalamBerkas.get(kunci);
        const n = (urutId.get(kunci) ?? 1) + 1; urutId.set(kunci, n); legacyId = `${id0}#${n}`;
        matchedLegacyId = id0;
        if (b.nomor && pertama.nominal !== nominal) tandai("PERLU_DITINJAU", `Nomor ${b.nomor} muncul lagi dengan nominal berbeda (${pertama.nominal} vs ${nominal})`);
        else if (b.nomor) tandai("DUPLIKAT", `Nomor ${b.nomor} sudah muncul di baris ${pertama.rowNo}`);
        else tandai("PERLU_DITINJAU", `Baris identik dengan baris ${pertama.rowNo}: bisa ganda atau dua transaksi yang sama — tidak ditebak`);
      } else lihatDalamBerkas.set(kunci, { rowNo: b.rowNo, nominal });
      // duplikat terhadap arsip lain yang sudah aktif
      if (ada.has(legacyId) || ada.has(id0)) { matchedLegacyId = ada.get(legacyId) ?? ada.get(id0); tandai("DUPLIKAT", "Sudah ada di arsip (batch lain yang aktif)"); }
      // kemungkinan cocok dengan order sistem (nama + nominal + selisih tanggal ≤ 3 hari) → tinjau, jangan tebak
      if (status === "SIAP" && b.pelanggan) {
        const nm = ket(b.pelanggan);
        const kandidat = orders.find((o) => o.pelanggan === nm && o.value === toMoney(nominal).toFixed(2) && Math.abs((new Date(`${o.tanggal}T00:00:00Z`) - new Date(`${tanggal}T00:00:00Z`)) / 86400000) <= 3);
        if (kandidat) { matchedOrderId = kandidat.id; tandai("PERLU_DITINJAU", `Mirip order sistem ${kandidat.orderNumber} (pelanggan, nominal, tanggal ±3 hari) — mungkin sudah tercatat`); }
      }
    }
    if (pay === "LUNAS" && !tglBayar && status === "SIAP") alasan.push("Lunas tanpa tanggal pembayaran (tetap dihitung sebagai pendapatan)");
    return {
      rowNo: b.rowNo, legacyId, nomorLama: b.nomor, trxDate: tanggal, customerName: b.pelanggan, description: b.keterangan, amount: nominal, payStatus: pay,
      paidAmount: dibayar, paidDate: tglBayar, payMethod: b.metode, cashAccountName: b.rekening, sourceLabel: b.sumber, status, reviewReason: alasan.length ? alasan.join("; ") : null, matchedOrderId, matchedLegacyId,
      raw: { tanggal: String(b.tanggalMentah ?? ""), nominal: String(b.nominalMentah ?? ""), status: String(b.statusMentah ?? "") },
    };
  });
}

function ringkasBaris(rows) {
  const per = { SIAP: 0, PERLU_DITINJAU: 0, DUPLIKAT: 0, DI_LUAR_PERIODE: 0, TIDAK_VALID: 0 };
  let nilai = ZERO;
  for (const r of rows) { per[r.status]++; if (r.status === "SIAP" && r.amount !== null) nilai = nilai.plus(toMoney(r.amount)); }
  return { jumlah: rows.length, perStatus: per, nilaiSiap: uang(nilai) };
}

// ── BATCH: pratinjau / komit / batal ────────────────────────────────────────────────────────────────────────────
async function konteksValidasi(db, cutoff, tanggalMin, tanggalMax) {
  const [aktif, orders] = await Promise.all([
    db.finLegacyRevenue.findMany({ where: { batch: { status: { in: ["IMPORTED", "POSTED"] } }, status: { not: "TIDAK_VALID" } }, select: { legacyId: true, id: true } }),
    db.order.findMany({ where: { status: { not: "CANCELLED" }, createdAt: { gte: new Date(`${tanggalMin}T00:00:00+07:00`), lte: new Date(`${tanggalMax}T23:59:59+07:00`) } }, select: { id: true, orderNumber: true, value: true, createdAt: true, customer: { select: { name: true } } } }),
  ]);
  // Nomor order sistem tetap dicek walau di luar rentang tanggal berkas (pencarian nomor tepat).
  return { ada: new Map(aktif.map((a) => [a.legacyId, a.id])), orders: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, value: toMoney(o.value ?? 0).toFixed(2), tanggal: wibTanggal(o.createdAt), pelanggan: ket(o.customer?.name) })) };
}

export async function buatPratinjau(db, { fileName, buffer, sumberData = null, userId = null, cutoff = null }) {
  const hash = createHash("sha256").update(buffer).digest("hex");
  const ada = await db.finLegacyBatch.findFirst({ where: { fileHash: hash, status: { in: ["PREVIEW", "IMPORTED", "POSTED"] } }, orderBy: { createdAt: "desc" } });
  if (ada) return { batch: bentukBatch(ada), sudahAda: true, pesan: `Berkas yang sama sudah diunggah (batch ${ada.status === "IMPORTED" ? "sudah diimpor" : ada.status === "POSTED" ? "sudah diposting" : "menunggu impor"}). Tidak membuat batch baru.` };
  const c = cutoff ?? (await hitungCutoff(db)).tanggal;
  if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(c)) throw new LegacyError("Cutoff sistem belum bisa ditentukan (belum ada order di sistem)", 409);
  const { kolom, baris } = await bacaBerkas(fileName, buffer);
  const tanggalValid = baris.map((b) => parseTanggal(b.tanggalMentah)).filter(Boolean).sort();
  const awalArsip = `${c.slice(0, 4)}-01-01`;
  const hariIni = wibTanggal(new Date());
  const ctx = await konteksValidasi(db, c, tanggalValid[0] ?? awalArsip, tanggalValid.at(-1) ?? c);
  const rows = validasiBaris(baris, { cutoff: c, awalArsip, hariIni, ...ctx });
  const batch = await db.$transaction(async (tx) => {
    const b = await tx.finLegacyBatch.create({ data: { fileName: String(fileName).slice(0, 200), fileHash: hash, sumberData: sumberData ? String(sumberData).slice(0, 120) : null, cutoffDate: new Date(`${c}T00:00:00.000Z`), status: "PREVIEW", totalRows: rows.length, importedById: userId } });
    for (let i = 0; i < rows.length; i += 500) {
      await tx.finLegacyRevenue.createMany({ data: rows.slice(i, i + 500).map((r) => ({
        batchId: b.id, rowNo: r.rowNo, legacyId: r.legacyId, nomorLama: r.nomorLama, trxDate: r.trxDate ? new Date(`${r.trxDate}T00:00:00.000Z`) : null, customerName: r.customerName, description: r.description,
        amount: r.amount, payStatus: r.payStatus, paidAmount: r.paidAmount, paidDate: r.paidDate ? new Date(`${r.paidDate}T00:00:00.000Z`) : null, payMethod: r.payMethod, cashAccountName: r.cashAccountName,
        sourceLabel: r.sourceLabel, status: r.status, reviewReason: r.reviewReason, matchedOrderId: r.matchedOrderId, matchedLegacyId: r.matchedLegacyId, raw: r.raw,
      })) });
    }
    return b;
  }, { timeout: 120_000, maxWait: 20_000 });
  return { batch: bentukBatch(batch), sudahAda: false, kolomTerbaca: kolom, ringkasan: ringkasBaris(rows), pesan: "Pratinjau dibuat. Periksa baris, lalu impor. Belum ada yang dihitung sampai diimpor." };
}

export async function komitBatch(db, { batchId, userId = null }) {
  return db.$transaction(async (tx) => {
    const b = await tx.finLegacyBatch.findUnique({ where: { id: batchId } });
    if (!b) throw new LegacyError("Batch tidak ditemukan", 404);
    if (b.status === "IMPORTED" || b.status === "POSTED") return { batch: bentukBatch(b), sudahDiimpor: true };
    if (b.status === "CANCELLED") throw new LegacyError("Batch sudah dibatalkan", 409);
    // Periksa ulang duplikat terhadap batch lain yang diimpor SETELAH pratinjau ini dibuat.
    const rows = await tx.finLegacyRevenue.findMany({ where: { batchId, status: { in: ["SIAP", "PERLU_DITINJAU"] } }, select: { id: true, legacyId: true } });
    const aktif = await tx.finLegacyRevenue.findMany({ where: { batch: { status: { in: ["IMPORTED", "POSTED"] }, id: { not: batchId } }, legacyId: { in: rows.map((r) => r.legacyId.replace(/#\d+$/, "")) }, status: { not: "TIDAK_VALID" } }, select: { legacyId: true, id: true } });
    const petaAktif = new Map(aktif.map((a) => [a.legacyId, a.id]));
    for (const r of rows) {
      const m = petaAktif.get(r.legacyId) ?? petaAktif.get(r.legacyId.replace(/#\d+$/, ""));
      if (m) await tx.finLegacyRevenue.update({ where: { id: r.id }, data: { status: "DUPLIKAT", matchedLegacyId: m, reviewReason: "Sudah ada di arsip (batch lain yang diimpor lebih dulu)" } });
    }
    const u = await tx.finLegacyBatch.update({ where: { id: batchId }, data: { status: "IMPORTED", committedAt: new Date() } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_LEGACY_BATCH, entityId: batchId, eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: userId, metadata: { aksi: "legacy_impor", berkas: b.fileName } });
    return { batch: bentukBatch(u), sudahDiimpor: false };
  }, { timeout: 120_000 });
}

export async function batalkanBatch(db, { batchId, alasan, userId = null }) {
  const teksAlasan = String(alasan ?? "").trim();
  if (!teksAlasan) throw new LegacyError("Alasan pembatalan wajib diisi");
  return db.$transaction(async (tx) => {
    const b = await tx.finLegacyBatch.findUnique({ where: { id: batchId } });
    if (!b) throw new LegacyError("Batch tidak ditemukan", 404);
    if (b.status === "CANCELLED") return { batch: bentukBatch(b), sudahDibatalkan: true };
    if (b.status === "POSTED" || b.postedAt) throw new LegacyError("Batch sudah diposting ke buku besar dan tidak bisa dibatalkan dari sini", 409);
    const u = await tx.finLegacyBatch.update({ where: { id: batchId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId, cancelReason: teksAlasan.slice(0, 500) } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_LEGACY_BATCH, entityId: batchId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: userId, metadata: { aksi: "legacy_batal", reason: teksAlasan } });
    return { batch: bentukBatch(u), sudahDibatalkan: false };
  });
}

export async function putuskanBaris(db, { rowId, keputusan, userId = null }) {
  if (!["TERIMA", "ABAIKAN"].includes(keputusan)) throw new LegacyError("Keputusan harus TERIMA atau ABAIKAN");
  const r = await db.finLegacyRevenue.findUnique({ where: { id: rowId }, include: { batch: { select: { status: true } } } });
  if (!r) throw new LegacyError("Baris tidak ditemukan", 404);
  if (r.batch.status !== "IMPORTED") throw new LegacyError("Keputusan hanya untuk batch yang sudah diimpor dan belum diposting", 409);
  if (r.status !== "PERLU_DITINJAU") throw new LegacyError("Hanya baris Perlu Ditinjau yang bisa diputuskan", 409);
  const u = await db.finLegacyRevenue.update({ where: { id: rowId }, data: { decision: keputusan, decidedById: userId, decidedAt: new Date() } });
  return bentukBaris(u);
}

const bentukBatch = (b) => ({ id: b.id, fileName: b.fileName, sumberData: b.sumberData, cutoff: tgl(b.cutoffDate), status: b.status, totalRows: b.totalRows, dibuatPada: b.createdAt.toISOString(), diimporPada: b.committedAt?.toISOString() ?? null, dibatalkanPada: b.cancelledAt?.toISOString() ?? null, alasanBatal: b.cancelReason ?? null, diposting: !!b.postedAt });
const dihitung = (r) => r.batch?.status ? (r.batch.status === "IMPORTED" || r.batch.status === "POSTED") && (r.status === "SIAP" || (r.status === "PERLU_DITINJAU" && r.decision === "TERIMA")) : (r.status === "SIAP" || (r.status === "PERLU_DITINJAU" && r.decision === "TERIMA"));
function bentukBaris(r) {
  return {
    id: r.id, rowNo: r.rowNo, legacyId: r.legacyId, nomorLama: r.nomorLama, tanggal: tgl(r.trxDate), pelanggan: r.customerName, keterangan: r.description, nilai: r.amount === null ? null : uang(r.amount),
    payStatus: r.payStatus, payLabel: LABEL_BAYAR[r.payStatus], dibayar: r.paidAmount === null ? null : uang(r.paidAmount), tanggalBayar: tgl(r.paidDate), metode: r.payMethod, rekening: r.cashAccountName, sumber: r.sourceLabel,
    status: r.status, statusLabel: LABEL_STATUS_BARIS[r.status], nada: NADA[r.status], alasan: r.reviewReason, cocokOrderId: r.matchedOrderId, cocokLegacyId: r.matchedLegacyId, keputusan: r.decision, dihitung: dihitung(r),
  };
}

export async function daftarBatch(db) {
  const batches = await db.finLegacyBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const ids = batches.map((b) => b.id);
  const g = ids.length ? await db.finLegacyRevenue.groupBy({ by: ["batchId", "status"], where: { batchId: { in: ids } }, _count: { _all: true }, _sum: { amount: true } }) : [];
  return { items: batches.map((b) => {
    const per = {}; let nilaiSiap = ZERO;
    for (const x of g.filter((y) => y.batchId === b.id)) { per[x.status] = x._count._all; if (x.status === "SIAP") nilaiSiap = toMoney(x._sum.amount ?? 0); }
    return { ...bentukBatch(b), perStatus: per, nilaiSiap: uang(nilaiSiap) };
  }) };
}

export async function detailBatch(db, id, { status, page = 1, limit = 50 } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const b = await db.finLegacyBatch.findUnique({ where: { id } });
  if (!b) return null;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const where = { batchId: id, ...(status && LABEL_STATUS_BARIS[status] ? { status } : {}) };
  const [rows, total, ringkas] = await Promise.all([
    db.finLegacyRevenue.findMany({ where, orderBy: { rowNo: "asc" }, skip: (pg - 1) * lim, take: lim, include: { batch: { select: { status: true } } } }),
    db.finLegacyRevenue.count({ where }),
    db.finLegacyRevenue.findMany({ where: { batchId: id }, select: { status: true, amount: true } }),
  ]);
  return { batch: bentukBatch(b), ringkasan: ringkasBaris(ringkas.map((r) => ({ status: r.status, amount: r.amount === null ? null : uang(r.amount) }))), items: rows.map(bentukBaris), page: pg, limit: lim, total, adaLagi: pg * lim < total };
}

// ── BARIS UNTUK HALAMAN PEMASUKAN ──────────────────────────────────────────────────────────────────────────────
export async function legacyItems(db, { dari, sampai }) {
  const rows = await db.finLegacyRevenue.findMany({
    where: { batch: { status: { in: ["IMPORTED", "POSTED"] } }, trxDate: { gte: dari, lte: sampai }, status: { in: ["SIAP", "PERLU_DITINJAU", "DUPLIKAT"] } },
    include: { batch: { select: { status: true, fileName: true } } }, orderBy: [{ trxDate: "desc" }, { rowNo: "asc" }], take: 20000,
  });
  return rows.map((r) => {
    const h = dihitung(r);
    const tinjau = r.status === "PERLU_DITINJAU" && r.decision !== "TERIMA" && r.decision !== "ABAIKAN";
    return {
      key: `h:${r.id}`, jenis: "historis", id: r.id, tanggal: tgl(r.trxDate), nomor: r.nomorLama ?? r.legacyId, sumber: "DATA_SEBELUM_SISTEM", sumberLabel: `Data sebelum sistem${r.sourceLabel ? ` (${r.sourceLabel})` : ""}`,
      pihak: r.customerName, keterangan: r.description, rekening: r.cashAccountName, nilai: uang(r.amount), status: r.status, statusLabel: r.decision === "ABAIKAN" ? "Diabaikan (keputusan)" : LABEL_STATUS_BARIS[r.status], nada: NADA[r.status],
      kategori: "HISTORIS", kategoriLabel: "Data Sebelum Sistem", sub: "HISTORIS", subLabel: "Pendapatan arsip (non-posting)", perluTinjau: tinjau, catatan: r.reviewReason,
      payStatus: r.payStatus, payLabel: LABEL_BAYAR[r.payStatus], dihitung: h && r.decision !== "ABAIKAN",
      tautan: { jurnal: null, pembayaran: null, invoice: null, order: r.matchedOrderId ? { id: r.matchedOrderId, nomor: null } : null, dokumen: null },
      _nilai: toMoney(r.amount ?? 0), _bruto: null, _retur: null,
    };
  });
}

export async function detailLegacy(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const r = await db.finLegacyRevenue.findUnique({ where: { id }, include: { batch: { select: { id: true, fileName: true, status: true, createdAt: true, cutoffDate: true } } } });
  if (!r) return null;
  return {
    jenis: "historis", id, klasifikasi: [{ kategori: "HISTORIS", kategoriLabel: "Data Sebelum Sistem", sub: "HISTORIS", subLabel: "Pendapatan arsip (non-posting)", nilai: r.amount === null ? null : uang(r.amount), catatan: r.reviewReason }],
    penjelasan: "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.",
    detail: { ...bentukBaris({ ...r, batch: r.batch }), batch: bentukBatch({ ...r.batch, totalRows: 0, committedAt: null, cancelledAt: null, postedAt: null }), mentah: r.raw },
  };
}

export const ringkasLegacy = () => null; // kompatibilitas ekspor; ringkasan historis dihitung di pemasukan.js dari legacyItems

// ── REKONSILIASI PER BULAN + SIMULASI + PROPOSAL (TIDAK memposting apa pun) ─────────────────────────────────────
function daftarBulan(dari, sampaiSebelum) {
  const hasil = [];
  let [y, m] = dari.split("-").map(Number);
  const [ey, em] = sampaiSebelum.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) { hasil.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return hasil;
}
const S = (a) => (a.length ? sumMoney(a) : ZERO);

export async function rekonsiliasiLegacy(db) {
  const c = await hitungCutoff(db);
  if (!c.tanggal) throw new LegacyError("Cutoff belum bisa ditentukan", 409);
  const awal = `${c.tanggal.slice(0, 4)}-01-01`;
  const rows = await db.finLegacyRevenue.findMany({ where: { batch: { status: { in: ["IMPORTED", "POSTED"] } } }, include: { batch: { select: { status: true } } } });
  const akun = await db.finAccount.findMany({ where: { systemKey: { in: ["PENDAPATAN_LAYANAN", "PENDAPATAN_PRODUK", "PENDAPATAN_SEWA", "PENDAPATAN_ONGKIR", "RETUR_PENJUALAN"] } }, select: { id: true } });
  const bulanIni = daftarBulan(awal.slice(0, 7), (() => { const d = new Date(`${c.tanggal}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 7); })());
  const perBulan = [];
  for (const bln of bulanIni) {
    const rs = rows.filter((r) => r.trxDate && tgl(r.trxDate).startsWith(bln));
    const dihit = rs.filter((r) => dihitung(r) && r.decision !== "ABAIKAN");
    const nilai = (arr) => S(arr.map((r) => r.amount ?? 0));
    const lunas = dihit.filter((r) => r.payStatus === "LUNAS");
    const sebagian = dihit.filter((r) => r.payStatus === "SEBAGIAN");
    const belum = dihit.filter((r) => r.payStatus === "BELUM_BAYAR");
    const tak = dihit.filter((r) => r.payStatus === "TIDAK_DIKETAHUI");
    const rek = {};
    for (const r of lunas.concat(sebagian)) { const k = r.cashAccountName ?? "(rekening tidak diketahui)"; rek[k] = (rek[k] ?? ZERO).plus(toMoney(r.paidAmount ?? r.amount ?? 0)); }
    const ledger = akun.length ? await db.finJournalLine.aggregate({ where: { accountId: { in: akun.map((a) => a.id) }, entry: { status: { in: STATUS_DIHITUNG }, date: { gte: new Date(`${bln}-01T00:00:00Z`), lt: new Date(Date.UTC(+bln.slice(0, 4), +bln.slice(5, 7), 1)) } } }, _sum: { credit: true, debit: true } }) : { _sum: {} };
    const jurnalNilai = toMoney(ledger._sum.credit ?? 0).minus(toMoney(ledger._sum.debit ?? 0));
    perBulan.push({
      bulan: bln, jumlah: dihit.length, pendapatan: uang(nilai(dihit)), lunas: uang(nilai(lunas)), sebagian: uang(nilai(sebagian)), belumBayar: uang(nilai(belum)), tidakDiketahui: uang(nilai(tak)),
      rekeningPenerima: Object.entries(rek).map(([nama, n]) => ({ nama, nilai: uang(n) })),
      perluDitinjau: { jumlah: rs.filter((r) => r.status === "PERLU_DITINJAU" && !r.decision).length, nilai: uang(nilai(rs.filter((r) => r.status === "PERLU_DITINJAU" && !r.decision))) },
      duplikat: { jumlah: rs.filter((r) => r.status === "DUPLIKAT").length, kemungkinanCocokOrderSistem: rs.filter((r) => r.matchedOrderId).length },
      jurnalSaatIni: uang(jurnalNilai), selisihTerhadapJurnal: uang(nilai(dihit).minus(jurnalNilai)),
    });
  }
  const total = (k) => uang(S(perBulan.map((x) => x[k])));
  const totalPend = S(perBulan.map((x) => x.pendapatan));
  const totalBelum = S(perBulan.map((x) => x.belumBayar));
  const totalLunas = S(perBulan.map((x) => x.lunas));
  return {
    cutoff: c, periodeArsip: { from: awal, to: c.tanggal }, perBulan,
    total: { pendapatan: uang(totalPend), lunas: total("lunas"), sebagian: total("sebagian"), belumBayar: total("belumBayar"), tidakDiketahui: total("tidakDiketahui"), jurnalSaatIni: total("jurnalSaatIni"), selisihTerhadapJurnal: total("selisihTerhadapJurnal") },
    simulasi: {
      catatan: "SIMULASI — tidak ada yang diposting. Saldo Kas & Bank sudah dikalibrasi ke saldo riil; penerimaan lama TIDAK boleh diposting ke rekening kas/bank (akan terhitung dua kali).",
      labaRugi: { pendapatanBertambah: uang(totalPend) }, piutang: { bertambah: uang(totalBelum), catatan: "Hanya yang berstatus belum dibayar; 'tidak diketahui' dan 'sebagian' TIDAK dianggap piutang tanpa keputusan." },
      kas: { berubah: "0.00", catatan: "Tidak berubah. Bagian yang sudah dibayar tidak menyentuh kas/bank." },
      ekuitas: { berubah: uang(totalBelum.plus(S(perBulan.map((x) => x.tidakDiketahui))).plus(S(perBulan.map((x) => x.sebagian)))), catatan: "Laba bertambah sebesar pendapatan; bagian yang sudah dibayar diimbangi koreksi ekuitas non-kas." },
    },
    labelHistoris: "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.",
    batasan: `Yang dihitung hanya baris SIAP (atau Perlu Ditinjau yang diputuskan TERIMA). Lunas Rp${uang(totalLunas)}.`,
  };
}

/** PROPOSAL jurnal migrasi — hanya usulan JSON, TIDAK diposting. Menunggu persetujuan Owner. */
export async function proposalJurnal(db) {
  const r = await rekonsiliasiLegacy(db);
  const akun = await db.finAccount.findMany({ where: { code: { in: ["1-1300", "3-4100", "4-1200"] } }, select: { code: true, name: true } });
  const nama = Object.fromEntries(akun.map((a) => [a.code, a.name]));
  const baris = r.perBulan.filter((b) => toMoney(b.pendapatan).greaterThan(ZERO)).map((b) => {
    const belum = toMoney(b.belumBayar);
    const sisa = toMoney(b.pendapatan).minus(belum); // lunas + sebagian + tidak diketahui: diimbangi ekuitas non-kas
    return { bulan: b.bulan, tanggalBuku: `${b.bulan}-28`, lines: [
      ...(belum.greaterThan(ZERO) ? [{ akun: "1-1300", nama: nama["1-1300"] ?? "Piutang Usaha", debit: uang(belum), kredit: "0.00" }] : []),
      ...(sisa.greaterThan(ZERO) ? [{ akun: "3-4100", nama: nama["3-4100"] ?? "Koreksi Saldo Awal", debit: uang(sisa), kredit: "0.00", catatan: "Bagian sudah dibayar/tidak diketahui: lawan ekuitas NON-KAS (kas sudah dikalibrasi ke saldo riil)" }] : []),
      { akun: "4-1200", nama: nama["4-1200"] ?? "Pendapatan Penjualan Produk", debit: "0.00", kredit: uang(b.pendapatan), catatan: "Akun pendapatan ASUMSI — Owner menentukan pemetaan produk/jasa" },
    ] };
  });
  return {
    status: "PROPOSAL — BELUM DIPOSTING",
    persetujuan: "Butuh persetujuan eksplisit Owner sebelum apa pun diposting ke buku besar produksi. Tidak ada posting/kalibrasi otomatis.",
    prinsip: ["Tidak menambah saldo Kas & Bank.", "Tidak mengubah JV-19092026-372 atau akun koreksi saldo awal secara langsung (memakai jurnal baru terpisah).", "Tidak membuat invoice aktif; piutang hanya untuk yang jelas belum dibayar."],
    jurnal: baris, rekonsiliasi: { total: r.total, periodeArsip: r.periodeArsip },
  };
}
