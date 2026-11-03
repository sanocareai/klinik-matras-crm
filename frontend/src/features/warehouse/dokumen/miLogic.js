// Logika murni ruang kerja PENGELUARAN MATERIAL (redesain Gudang, 3 Nov 2026). Tidak ada aturan stok/izin/status baru: status, tahap, aksi, dan ketersediaan datang dari server
// (`tampilan`, `ketersediaan`); di sini hanya penyaringan daftar yang SUDAH dimuat seluruhnya (GET /inventory/material-issues tanpa batas baris), hitungan yang tidak dipertukarkan
// (dokumen · baris bahan · unit produksi), dan pemetaan pergerakan unit ke tiga pengertian yang dipisahkan: PERMINTAAN, PENGELUARAN, PEMAKAIAN.

export const STATUS_AKTIF = Object.freeze(["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]);
export const STATUS_OPSI = Object.freeze([
  { key: "", label: "Semua status" },
  { key: "DRAFT", label: "Draf" },
  { key: "WAITING_APPROVAL", label: "Menunggu persetujuan" },
  { key: "APPROVED", label: "Disetujui — stok dicadangkan" },
  { key: "READY_TO_PICK", label: "Siap diambil" },
  { key: "PICKED", label: "Sudah diambil — tinggal konfirmasi keluar" },
  { key: "ISSUED", label: "Sudah dikeluarkan" },
  { key: "CANCELLED", label: "Dibatalkan" },
]);
export const TAB_MI = Object.freeze([
  { key: "tindakan", label: "Perlu tindakan", statuses: STATUS_AKTIF },
  { key: "selesai", label: "Sudah dikeluarkan", statuses: ["ISSUED"] },
  { key: "batal", label: "Dibatalkan", statuses: ["CANCELLED"] },
  { key: "semua", label: "Semua", statuses: null },
]);
export const tabAktifMI = (k) => (TAB_MI.some((t) => t.key === k) ? k : "tindakan");
export const filterTabMI = (rows, tab) => { const t = TAB_MI.find((x) => x.key === tab); return !t || !t.statuses ? rows : rows.filter((r) => t.statuses.includes(r.status)); };
export const hitungTabMI = (rows) => Object.fromEntries(TAB_MI.map((t) => [t.key, t.statuses ? rows.filter((r) => t.statuses.includes(r.status)).length : rows.length]));

export const SUMBER_LABEL = Object.freeze({
  PRODUCTION_WORK_ORDER: "Work Order Produksi", MAINTENANCE_REQUEST: "Permintaan Perawatan", INTERNAL_REQUEST: "Permintaan Internal", SAMPLE_REQUEST: "Permintaan Sampel", MANUAL: "Input Manual", COMPLAINT_REWORK: "Rework Komplain",
});
export const PRIORITAS_LABEL = Object.freeze({ LOW: "Rendah", NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak" });
export const DASAR_TANGGAL = Object.freeze([
  { key: "dibuat", label: "Tanggal diajukan", kolom: "createdAt" },
  { key: "dibutuhkan", label: "Tanggal dibutuhkan", kolom: "requiredDate" },
  { key: "keluar", label: "Tanggal dikeluarkan", kolom: "issuedAt" },
]);

/** Tindakan berikutnya untuk daftar: label aksi "maju" PERTAMA dari server (`tampilan.aksi`); tanpa itu penjelasan status singkat. Tidak ada aturan baru. */
export function tindakanBerikutnya(r) {
  const t = r?.tampilan; const aksi = t?.aksi ?? [];
  const maju = aksi.find((a) => a.jenis === "maju");
  if (maju) return { teks: maju.label, perlu: true };
  if (r?.status === "ISSUED") return { teks: "Selesai — stok sudah berkurang", perlu: false };
  if (r?.status === "CANCELLED") return { teks: "Dibatalkan", perlu: false };
  if (aksi.length) return { teks: aksi[0].label, perlu: true };
  return { teks: STATUS_AKTIF.includes(r?.status) ? "Menunggu pihak lain" : "—", perlu: false };
}

const tglLokal = (v) => { if (!v) return ""; const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
/** Dokumen cocok dengan periode (dasar tanggal + dari/sampai, sama-sama inklusif, YYYY-MM-DD). Tanpa dari/sampai = lolos. Dokumen tanpa tanggal pada dasar itu TIDAK lolos saat periode diisi. */
export function cocokPeriode(r, { dasar = "dibuat", dari = "", sampai = "" } = {}) {
  if (!dari && !sampai) return true;
  const kol = (DASAR_TANGGAL.find((d) => d.key === dasar) ?? DASAR_TANGGAL[0]).kolom; const t = kol === "requiredDate" ? String(r[kol] ?? "").slice(0, 10) : tglLokal(r[kol]);
  if (!t) return false;
  return (!dari || t >= dari) && (!sampai || t <= sampai);
}

const teksCari = (r) => [r.issueNumber, r.department, r.sourceReference, r.requestedBy?.name, r.unit?.unitCode, r.unit?.order?.orderNumber, r.unit?.order?.customer?.name, ...(r.lines ?? []).map((l) => `${l.material?.code ?? ""} ${l.material?.name ?? ""}`)].filter(Boolean).join(" ").toLowerCase();
const cocokKata = (r, q) => { const k = String(q ?? "").trim().toLowerCase(); return !k || k.split(/\s+/).every((p) => teksCari(r).includes(p)); };

/** SATU himpunan baris untuk semua penyaringan (tab, status, sumber, prioritas, peminta, unit, bahan, periode, kata kunci). Bekerja atas seluruh data yang dimuat — bukan atas halaman tampil. */
export function saringMI(rows, f = {}) {
  return rows.filter((r) =>
    filterTabMI([r], tabAktifMI(f.tab)).length > 0
    && (!f.status || r.status === f.status)
    && (!f.sumber || r.sourceType === f.sumber)
    && (!f.prioritas || r.priority === f.prioritas)
    && (!f.peminta || (r.requestedBy?.id ?? "") === f.peminta)
    && (!f.unit || (r.unitId ?? r.unit?.id ?? "") === f.unit)
    && (!f.bahan || (r.lines ?? []).some((l) => l.materialId === f.bahan))
    && cocokPeriode(r, { dasar: f.dasar, dari: f.dari, sampai: f.sampai })
    && cocokKata(r, f.q));
}

/** Pilihan saringan dari data yang dimuat (peminta, unit/order, bahan) — apa adanya, urut abjad. */
export function opsiSaringMI(rows) {
  const peminta = new Map(); const unit = new Map(); const bahan = new Map();
  for (const r of rows) {
    if (r.requestedBy?.id) peminta.set(r.requestedBy.id, r.requestedBy.name);
    const uid = r.unitId ?? r.unit?.id; if (uid && r.unit) unit.set(uid, `${r.unit.unitCode}${r.unit.order?.orderNumber ? ` · ${r.unit.order.orderNumber}` : ""}`);
    for (const l of r.lines ?? []) if (l.materialId && l.material) bahan.set(l.materialId, `${l.material.code} — ${l.material.name}`);
  }
  const urut = (m) => [...m.entries()].map(([nilai, label]) => ({ nilai, label })).sort((a, b) => a.label.localeCompare(b.label, "id"));
  return { peminta: urut(peminta), unit: urut(unit), bahan: urut(bahan) };
}

/** Tiga hitungan yang TIDAK boleh dipertukarkan: jumlah dokumen, jumlah baris bahan (di seluruh dokumen), jumlah unit produksi berbeda. Tidak ada total kuantitas (satuan berbeda). */
export function hitunganMI(rows) {
  const unit = new Set(rows.map((r) => r.unitId ?? r.unit?.id).filter(Boolean));
  return { dokumen: rows.length, barisBahan: rows.reduce((n, r) => n + (r.lines?.length ?? 0), 0), unitProduksi: unit.size };
}

/** Chip saringan aktif (selain tab dan kata kunci). `kunci` = parameter URL yang dikosongkan. */
export function chipMI(f, opsi) {
  const out = []; const cari = (daftar, v) => daftar.find((o) => o.nilai === v)?.label ?? v;
  if (f.status) out.push({ kunci: "status", teks: `Status: ${STATUS_OPSI.find((s) => s.key === f.status)?.label ?? f.status}` });
  if (f.sumber) out.push({ kunci: "sumber", teks: `Sumber: ${SUMBER_LABEL[f.sumber] ?? f.sumber}` });
  if (f.prioritas) out.push({ kunci: "prioritas", teks: `Prioritas: ${PRIORITAS_LABEL[f.prioritas] ?? f.prioritas}` });
  if (f.peminta) out.push({ kunci: "peminta", teks: `Peminta: ${cari(opsi.peminta, f.peminta)}` });
  if (f.unit) out.push({ kunci: "unit", teks: `Unit: ${cari(opsi.unit, f.unit)}` });
  if (f.bahan) out.push({ kunci: "bahan", teks: `Bahan: ${cari(opsi.bahan, f.bahan)}` });
  if (f.dari || f.sampai) out.push({ kunci: "periode", teks: `${(DASAR_TANGGAL.find((d) => d.key === f.dasar) ?? DASAR_TANGGAL[0]).label}: ${f.dari || "…"} s.d. ${f.sampai || "…"}` });
  return out;
}

/**
 * Pergerakan stok pada SATU UNIT, dipisah menurut asalnya (dari GET /units/:id/materials; `materialIssueId` = dokumen Gudang, kosong = dicatat langsung oleh Produksi / pergerakan lain):
 *  • dokumenIni — dikeluarkan lewat dokumen yang sedang dibuka; • dokumenLain — dikeluarkan lewat Material Issue lain; • langsung — dicatat langsung (Produksi atau pergerakan lain tanpa dokumen).
 * Jumlah per BAHAN (bukan dijumlahkan lintas bahan/satuan). Pergerakan ISSUE negatif di ledger → ditampilkan sebagai jumlah keluar positif; RETURN/koreksi sebagai pengembalian.
 */
export function pisahPemakaianUnit(movements = [], dokumenId) {
  const kelompok = { dokumenIni: [], dokumenLain: [], langsung: [] };
  for (const m of movements) {
    if (m.materialIssueId && m.materialIssueId === dokumenId) kelompok.dokumenIni.push(m);
    else if (m.materialIssueId) kelompok.dokumenLain.push(m);
    else kelompok.langsung.push(m);
  }
  const perBahan = (ms) => {
    const peta = new Map();
    for (const m of ms) { const k = m.material?.id ?? m.materialId; const e = peta.get(k) ?? { bahan: m.material, bersih: 0 }; e.bersih += -Number(m.qty); peta.set(k, e); }
    return [...peta.values()];
  };
  return { ...kelompok, ringkas: { dokumenIni: perBahan(kelompok.dokumenIni), dokumenLain: perBahan(kelompok.dokumenLain), langsung: perBahan(kelompok.langsung) } };
}

/** Peringatan kemungkinan pencatatan ganda: unit sudah punya pencatatan langsung dari Produksi untuk bahan yang JUGA dikeluarkan lewat dokumen ini. Hanya peringatan — tidak memblokir apa pun. */
export function bahanTumpangTindih(pisah, barisDokumen = []) {
  const kodeDokumen = new Set(barisDokumen.map((l) => l.materialId));
  return pisah.ringkas.langsung.filter((e) => e.bahan?.id && kodeDokumen.has(e.bahan.id) && Math.abs(e.bersih) > 0);
}

/** Selisih pengeluaran per baris dokumen yang sudah dikeluarkan: diminta − dikeluarkan (positif = kurang dikeluarkan). null bila belum dikeluarkan. */
export function selisihKeluar(line) {
  if (line?.issuedQty === null || line?.issuedQty === undefined) return null;
  return Math.round((Number(line.requestedQty) - Number(line.issuedQty)) * 10000) / 10000;
}
