// CATATAN PEMAKAIAN HISTORIS — aturan MURNI (tanpa database): membaca CSV Admin Sales, kunci idempoten, penandaan "Perlu dicek".
// Prinsip Owner (Okt 2026): nilai asli berkas disimpan apa adanya; angka yang terlihat janggal TIDAK diperbaiki otomatis (mis. 1,5 "KG" untuk lem berkemasan CAN 13 kg tidak dikali/dibagi 13) — hanya ditandai dengan
// catatan singkat yang bisa ditindaklanjuti. Catatan ini BUKAN pergerakan stok: tidak mengurangi saldo, tidak ada biaya/jurnal.
import crypto from "node:crypto";
import { kunciNama, cariKembar } from "./bahanUsulan.js";

export const SUMBER_EXCEL = "EXCEL_ADMIN_SALES_CSV";
export const STATE = Object.freeze({
  TERCATAT_DI_STOK: "TERCATAT_DI_STOK", PERLU_DICEK: "PERLU_DICEK", SIAP_POSTING: "SIAP_POSTING", DIPOSTING: "DIPOSTING",
  BUKAN_STOK: "BUKAN_STOK", TIDAK_DIHITUNG: "TIDAK_DIHITUNG", DIKOREKSI: "DIKOREKSI",
});
export const LABEL_STATE = Object.freeze({
  TERCATAT_DI_STOK: "Sudah tercatat di stok", PERLU_DICEK: "Perlu dicek", SIAP_POSTING: "Siap jadi pengeluaran stok", DIPOSTING: "Sudah jadi pengeluaran stok",
  BUKAN_STOK: "Bukan stok Gudang", TIDAK_DIHITUNG: "Tidak dihitung (jumlah 0)", DIKOREKSI: "Sudah dikoreksi",
});

// ───────────────────────────── angka, tanggal, teks ─────────────────────────────
/** Angka format Indonesia ("1,7" · "1.250,5"). Mengembalikan { v, jenis } — TIDAK menebak: teks aneh = jenis "teks". */
export function angkaId(raw) {
  if (raw === null || raw === undefined) return { v: null, jenis: "kosong" };
  let t = String(raw).trim();
  if (t === "" || t === "-") return { v: null, jenis: "kosong" };
  if (/^#N\/A$/i.test(t)) return { v: null, jenis: "na" };
  const neg = t.startsWith("-"); if (neg) t = t.slice(1);
  if (!/^[0-9.,]+$/.test(t)) return { v: null, jenis: "teks", raw: String(raw) };
  const x = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(x) ? { v: neg ? -x : x, jenis: "angka" } : { v: null, jenis: "teks", raw: String(raw) };
}
/** Rupiah format Indonesia ("Rp 43.590" · "Rp 1.250,5"): titik = ribuan, koma = desimal. */
export const uang = (raw) => { const t = String(raw ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."); const x = t ? parseFloat(t) : NaN; return Number.isFinite(x) ? x : null; };
const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };
/** "1 Sep 26" → "2026-09-01" (kalender WIB); selain itu "". */
export function tanggalId(raw) {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{2,4})$/); if (!m) return "";
  const b = BULAN[m[2].toLowerCase()]; if (!b) return "";
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(b).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** Awal hari WIB (00:00 WIB) sebagai Date UTC — kalender WIB di tepi, UTC di dalam. */
export const awalHariWIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
export const normNama = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
export const slugKode = (s) => normNama(s).replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
/** Angka untuk TEKS yang dibaca orang: koma desimal ala Indonesia (nilai tersimpan tetap angka biasa). */
export const koma = (v) => String(v).replace(".", ",");

const ALIAS_SATUAN = { PCS: "PCS", METER: "METER", M: "METER", MTR: "METER", LEMBAR: "SHEET", LBR: "SHEET", SHEET: "SHEET", ROLL: "ROLL", ROL: "ROLL", KG: "KG", PAK: "PACK", PACK: "PACK", BUNGKUS: "PACK", BKS: "PACK", KUBIK: "M3", M3: "M3", BATANG: "ROD", ROD: "ROD", PASANG: "PAIR", PAIR: "PAIR", BLEK: "CAN", KLG: "CAN", CAN: "CAN", BOX: "BOX", SPOOL: "SPOOL", GULUNG: "ROLL" };
/** Satuan berkas → enum satuan Gudang (hanya alias baku; tidak ada konversi jumlah). */
export const satuanBaku = (raw) => (raw ? ALIAS_SATUAN[String(raw).trim().toUpperCase()] ?? null : null);

// ───────────────────────────── CSV ─────────────────────────────
/** Pembaca CSV RFC-4180 (kutip ganda, koma/baris-baru di dalam sel). */
export function parseCsv(text) {
  const rows = []; let r = []; let f = ""; let q = false; const t = String(text ?? "").replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n") { r.push(f); rows.push(r); r = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || r.length) { r.push(f); rows.push(r); }
  return rows;
}
const hn = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const KOLOM = { order: /no\. resi/, tglSelesai: /^tgl selesai/, bulan: /^bulan selesai/, pelanggan: /nama pelanggan/, pic: /pic \/ teknisi/, kategori: /kategori bahan/, nama: /nama material/, spek: /spesifikasi/, qty: /qty pakai/, satuan: /^satuan$/, harga: /harga satuan/, total: /total biaya bahan/, ket: /keterangan/ };
/** Baca sheet "Pemakaian Bahan" hasil ekspor CSV. Kolom dikenali dari header (bukan posisi). Baris tanpa nomor order (mis. #N/A pengisi) dilaporkan terpisah. */
export function bacaCsvPemakaian(text) {
  const R = parseCsv(text); const hi = R.findIndex((r) => r.some((c) => /no\. resi \/ order/i.test(c)));
  if (hi < 0) throw new Error("Header 'No. Resi / Order' tidak ditemukan — bukan ekspor sheet Pemakaian Bahan.");
  const K = {}; for (const [k, re] of Object.entries(KOLOM)) { const j = R[hi].findIndex((h) => re.test(hn(h))); if (j < 0 && ["order", "nama", "qty", "satuan", "tglSelesai"].includes(k)) throw new Error(`Kolom '${k}' tidak ditemukan di header.`); K[k] = j; }
  const g = (r, k) => (K[k] >= 0 ? String(r[K[k]] ?? "").trim() : "");
  const baris = []; const tanpaOrder = [];
  for (let i = hi + 1; i < R.length; i++) {
    const r = R[i]; if (!r.some((c) => String(c).trim())) continue;
    const o = { baris: i + 1, order: g(r, "order"), tglTeks: g(r, "tglSelesai"), bulan: g(r, "bulan"), pelanggan: g(r, "pelanggan"), pic: g(r, "pic"), kategori: g(r, "kategori"), nama: g(r, "nama"), spek: g(r, "spek"), qtyTeks: g(r, "qty"), satuan: g(r, "satuan"), hargaTeks: g(r, "harga"), totalTeks: g(r, "total"), ket: g(r, "ket"), raw: r.map((c) => String(c ?? "")) };
    if (!o.order || /^#N\/A$/i.test(o.order)) { tanpaOrder.push(o); continue; }
    baris.push(o);
  }
  return { baris, tanpaOrder, kolom: K, barisHeader: hi + 1 };
}
/** Kunci idempoten baris: hash isi baris + urutan kemunculan isi yang sama (baris identik yang berulang tetap berbeda kunci). */
export function kunciSumber(row, kemunculan) {
  const isi = [row.order, normNama(row.nama), normNama(row.spek), row.qtyTeks, normNama(row.satuan), normNama(row.kategori), row.tglTeks].join("␟");
  return `EXCEL:${crypto.createHash("sha1").update(isi).digest("hex").slice(0, 20)}:${kemunculan}`;
}
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ───────────────────────────── pemetaan bahan (tanpa menebak) ─────────────────────────────
/** Cocokkan nama berkas ke katalog HANYA bila persis (nama ternormalisasi, atau penulisan = kode). Selain itu: tidak terpetakan + kandidat untuk dibaca manusia. */
export function petakanBahan({ nama, spek }, katalog) {
  const kandidatNama = [nama, spek ? `${nama} ${spek}` : null].filter(Boolean);
  const byNama = new Map(); const byKode = new Map();
  for (const m of katalog) { const k = normNama(m.name); (byNama.get(k) ?? byNama.set(k, []).get(k)).push(m); byKode.set(m.code, m); }
  for (const s of kandidatNama) {
    const x = byNama.get(normNama(s)); if (x?.length === 1) return { bahan: x[0], via: "NAMA_PERSIS" };
    if (x?.length > 1) return { galat: "BAHAN_GANDA", kandidat: x.map((m) => ({ kode: m.code, nama: m.name, satuan: m.unit })) };
    const k = byKode.get(slugKode(s)); if (k) return { bahan: k, via: "KODE_PERSIS" };
  }
  const kembar = cariKembar({ nama, bahan: katalog.filter((m) => m.active).map((m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active })) }).slice(0, 3).map((k) => ({ kode: k.kode, nama: k.nama, satuan: k.satuan, tingkat: k.tingkat }));
  return { galat: "NAMA_TIDAK_DI_KATALOG", kandidat: kembar };
}
export const KOMPONEN_LAMA_RE = /\bLAMA\b|KILOAN|BUANG KASUR/i;

// ───────────────────────────── penanda "Perlu dicek" ─────────────────────────────
export const TINGKAT = Object.freeze({ BLOK: "BLOK", INFO: "INFO" });
/** Katalog penanda: kode → pembuat penanda { kode, tingkat, teks (apa yang janggal), aksi (apa yang dilakukan) }. Teks singkat, bahasa Indonesia, bisa ditindaklanjuti. */
export const FLAG = Object.freeze({
  SATUAN_BEDA_MASTER: ({ rawUom, rawQty, masterUom, kemasanKg }) => ({ kode: "SATUAN_BEDA_MASTER", tingkat: "BLOK", data: { rawUom, rawQty, masterUom, kemasanKg: kemasanKg ?? null },
    teks: kemasanKg && masterUom !== "KG" ? `Tertulis ${rawQty} ${rawUom}, sedangkan bahan ini bersatuan ${masterUom} (nama bahan memuat ${kemasanKg} KG). Bisa jadi salah satuan, bisa jadi memang kg.` : `Tertulis ${rawQty} ${rawUom}, sedangkan satuan bahan di Gudang ${masterUom}.`,
    aksi: kemasanKg ? "Konfirmasi ke Admin Sales: angka ini kg atau kemasan? Tidak dikonversi otomatis." : `Butuh faktor ${rawUom}↔${masterUom} berbukti (label kemasan, invoice, atau timbang/ukur).` }),
  NAMA_TIDAK_DI_KATALOG: ({ rawName, kandidat }) => ({ kode: "NAMA_TIDAK_DI_KATALOG", tingkat: "BLOK", data: { rawName, kandidat: kandidat ?? [] },
    teks: `Bahan "${rawName}" belum ada di katalog Gudang.`, aksi: "Petakan ke bahan yang ada, atau buat master bahan baru (tanpa menambah stok)." }),
  BAHAN_GANDA: ({ rawName, kandidat }) => ({ kode: "BAHAN_GANDA", tingkat: "BLOK", data: { rawName, kandidat }, teks: `Nama "${rawName}" cocok dengan lebih dari satu bahan katalog.`, aksi: "Pilih bahan yang benar." }),
  BAHAN_NONAKTIF: ({ kode }) => ({ kode: "BAHAN_NONAKTIF", tingkat: "BLOK", data: { kode }, teks: `Bahan ${kode} sudah nonaktif.`, aksi: "Aktifkan bahan atau petakan ke bahan pengganti." }),
  ORDER_TIDAK_ADA: ({ orderNumber }) => ({ kode: "ORDER_TIDAK_ADA", tingkat: "BLOK", data: { orderNumber }, teks: `Order ${orderNumber} tidak ditemukan di sistem.`, aksi: "Periksa nomor order di sumber; catatan tetap disimpan apa adanya." }),
  SATUAN_TAK_DIKENAL: ({ rawUom }) => ({ kode: "SATUAN_TAK_DIKENAL", tingkat: "BLOK", data: { rawUom }, teks: `Satuan "${rawUom}" tidak dikenal.`, aksi: "Tentukan satuan yang benar lewat koreksi catatan." }),
  UNIT_DIBATALKAN: ({ unitCode }) => ({ kode: "UNIT_DIBATALKAN", tingkat: "BLOK", data: { unitCode }, teks: `Unit ${unitCode ?? ""} berstatus DIBATALKAN, tetapi ada catatan pemakaian bahan.`.replace("  ", " "), aksi: "Pastikan bahan memang terpakai sebelum dibatalkan (atau kecualikan catatan); bila bahan kembali ke stok, catat lewat retur." }),
  UNIT_TIDAK_PASTI: ({ jumlahUnit }) => ({ kode: "UNIT_TIDAK_PASTI", tingkat: "BLOK", data: { jumlahUnit }, teks: jumlahUnit === 0 ? "Order ini belum punya unit produksi." : `Order ini punya ${jumlahUnit} unit; Excel tidak menyebut unit mana.`, aksi: "Tentukan unit yang memakai bahan ini." }),
  TANGGAL_TIDAK_VALID: ({ rawDate }) => ({ kode: "TANGGAL_TIDAK_VALID", tingkat: "BLOK", data: { rawDate }, teks: `Tanggal selesai "${rawDate ?? ""}" tidak terbaca.`, aksi: "Isi tanggal pemakaian lewat koreksi catatan dengan alasan." }),
  QTY_TIDAK_VALID: ({ rawQty }) => ({ kode: "QTY_TIDAK_VALID", tingkat: "BLOK", data: { rawQty }, teks: `Jumlah "${rawQty}" tidak terbaca sebagai angka.`, aksi: "Perbaiki jumlah di sumber atau koreksi catatan ini dengan alasan." }),
  BARIS_BERULANG: ({ jumlah }) => ({ kode: "BARIS_BERULANG", tingkat: "BLOK", data: { jumlah }, teks: `Baris serupa muncul ${jumlah}× pada order ini (bahan, spesifikasi, jumlah sama).`, aksi: `Konfirmasi: memang dipakai ${jumlah}× (sah) atau salinan ganda?` }),
  ISSUE_LAMA_BERBEDA: ({ ledger, excel, satuan }) => ({ kode: "ISSUE_LAMA_BERBEDA", tingkat: "BLOK", data: { ledger, excel, selisih: r4(excel - ledger), satuan },
    teks: `Stok mencatat ${koma(ledger)} ${satuan}, Excel ${koma(excel)} ${satuan} (selisih ${koma(r4(excel - ledger))}).`, aksi: "Ajukan koreksi pemakaian per order bila Excel yang benar (nilai lama tetap tersimpan)." }),
  ISSUE_LAMA_SATUAN_BEDA: ({ ledger, rawQty, rawUom, masterUom }) => ({ kode: "ISSUE_LAMA_SATUAN_BEDA", tingkat: "BLOK", data: { ledger, rawQty, rawUom, masterUom },
    teks: `Stok mencatat ${koma(ledger)} ${masterUom}; Excel menulis ${rawQty} ${rawUom}. Angka stok kemungkinan memakai satuan Excel, bukan ${masterUom}.`, aksi: "Butuh faktor satuan berbukti sebelum stok lama dikoreksi." }),
  ISSUE_TANPA_PASANGAN: ({ qty, satuan, ordeAdaDiExcel }) => ({ kode: "ISSUE_TANPA_PASANGAN", tingkat: "BLOK", data: { qty, satuan, ordeAdaDiExcel },
    teks: ordeAdaDiExcel ? `Pengeluaran stok ${qty} ${satuan} ini tidak punya baris bahan yang sama di Excel untuk order ini.` : `Order ini tidak ada di Excel; pengeluaran stok ${qty} ${satuan} tidak punya catatan pembanding.`,
    aksi: ordeAdaDiExcel ? "Cek apakah bahan tertukar varian; ajukan koreksi/pembatalan pemakaian bila salah." : "Admin Produksi memastikan order ini memang memakai bahan tsb; bila tidak, ajukan pembatalan pemakaian." }),
  BERGANTUNG_ISSUE_LAMA: () => ({ kode: "BERGANTUNG_ISSUE_LAMA", tingkat: "BLOK", data: {}, teks: "Unit ini masih punya pengeluaran stok lama yang tidak cocok dengan Excel.", aksi: "Selesaikan koreksi pemakaian unit ini dulu, baru jadikan pengeluaran stok." }),
  TANPA_SALDO_PEMBUKA: () => ({ kode: "TANPA_SALDO_PEMBUKA", tingkat: "BLOK", data: {}, teks: "Bahan ini belum punya catatan stok sama sekali (bukan saldo nol).", aksi: "Butuh saldo pembuka/penerimaan historis berbukti." }),
  SALDO_NEGATIF: ({ minimum, tanggal }) => ({ kode: "SALDO_NEGATIF", tingkat: "BLOK", data: { minimum, tanggal }, teks: `Saldo bahan sudah negatif di ledger (${minimum} pada ${tanggal}).`, aksi: "Penerimaan historis berbukti atau koreksi saldo bahan." }),
  MENDAHULUI_GR: ({ tanggal, saldo, butuh }) => ({ kode: "MENDAHULUI_GR", tingkat: "BLOK", data: { tanggal, saldo, butuh }, teks: `Pemakaian ${tanggal} lebih awal dari penerimaan yang tercatat (saldo ${saldo}, butuh ${butuh}).`, aksi: "Tanggal penerimaan lebih awal berbukti, atau koreksi saldo bahan." }),
  SALDO_TIDAK_CUKUP: ({ butuh, saldoAkhir }) => ({ kode: "SALDO_TIDAK_CUKUP", tingkat: "BLOK", data: { butuh, saldoAkhir }, teks: `Saldo tidak mencukupi (butuh ${butuh}, saldo akhir ${saldoAkhir}).`, aksi: "Penerimaan/saldo pembuka berbukti, atau koreksi saldo bahan." }),
  KATEGORI_KOMPLAIN: () => ({ kode: "KATEGORI_KOMPLAIN", tingkat: "INFO", data: {}, teks: "Baris berkategori Bahan Komplain.", aksi: "Hanya penanda; tidak menahan." }),
  KOMPONEN_LAMA: () => ({ kode: "KOMPONEN_LAMA", tingkat: "INFO", data: {}, teks: "Komponen lama dari kasur pelanggan, bukan stok Gudang.", aksi: "Catat lewat 'Komponen lama dari unit ini' bila perlu." }),
  QTY_NOL: () => ({ kode: "QTY_NOL", tingkat: "INFO", data: {}, teks: "Jumlah 0 — bukan pemakaian.", aksi: "Tidak ada." }),
});
export const flagMemblok = (flags) => (flags || []).some((f) => f.tingkat === "BLOK");
/** Satu kalimat ringkas untuk label "Perlu dicek": penanda BLOK pertama (teks + aksi). */
export function catatanSingkat(flags) {
  const f = (flags || []).find((x) => x.tingkat === "BLOK"); if (!f) return null;
  return `${f.teks} ${f.aksi}`.trim();
}
/** Petunjuk kemasan dari nama bahan ("LEM I-SR 1037 13 KG" → 13) — hanya petunjuk untuk teks, TIDAK dipakai menghitung. */
export function petunjukKemasanKg(namaBahan) {
  const m = String(namaBahan ?? "").match(/(\d+(?:[.,]\d+)?)\s*KG\b/i); return m ? Number(m[1].replace(",", ".")) : null;
}
export const labelState = (s) => LABEL_STATE[s] ?? s;
export { kunciNama };
