// Logika murni ruang kerja PERMINTAAN BAHAN PRODUKSI (V2/P4; /production-planning/material-requests). Hanya penyaringan atas daftar yang SUDAH dimuat + pemetaan label; aturan stok/reservasi/izin tetap milik server.
// Kontrak yang dipakai (formatIssue di productionMaterialIssueCommandService.js): id, issueNumber, status (READY_TO_PICK | ISSUED | CANCELLED), revision, planStatus, supplemental (bahan tambahan rework), unit {id, unitCode, orderNumber},
// createdAt, issuedAt, cancelledAt, cancelReason, lines[{materialId, code, name, unit, planned, reserved, reservationStatus, picked}]. TIDAK ada data peminta/PIC di kontrak ini — layar tidak menampilkannya.
// Batas daftar dari server: urut dari yang TERLAMA, paling banyak 200 — bila tepat 200, daftar mungkin terpotong dan layar menyatakannya.

export const BATAS_DAFTAR = 200;
export const TAB_PICKUP = Object.freeze([
  { key: "tindakan", label: "Perlu diserahkan", statuses: ["READY_TO_PICK"] },
  { key: "selesai", label: "Sudah diserahkan", statuses: ["ISSUED"] },
  { key: "batal", label: "Dibatalkan", statuses: ["CANCELLED"] },
  { key: "semua", label: "Semua", statuses: null },
]);
export const STATUS_PICKUP_LABEL = Object.freeze({ READY_TO_PICK: "Menunggu diserahkan", ISSUED: "Sudah diserahkan", CANCELLED: "Dibatalkan" });
export const STATUS_PICKUP_WARNA = Object.freeze({ READY_TO_PICK: "orange", ISSUED: "green", CANCELLED: "neutral" });
export const JENIS_OPSI = Object.freeze([{ key: "", label: "Semua jenis" }, { key: "awal", label: "Dari rencana bahan (BOM)" }, { key: "tambahan", label: "Bahan tambahan rework" }]);
export const DASAR_PICKUP = Object.freeze([
  { key: "dibuat", label: "Tanggal diajukan", kolom: "createdAt" },
  { key: "diserahkan", label: "Tanggal diserahkan", kolom: "issuedAt" },
  { key: "dibatalkan", label: "Tanggal dibatalkan", kolom: "cancelledAt" },
]);
export const tabAktifPickup = (k) => (TAB_PICKUP.some((t) => t.key === k) ? k : "tindakan");
export const hitungTabPickup = (rows) => Object.fromEntries(TAB_PICKUP.map((t) => [t.key, t.statuses ? rows.filter((r) => t.statuses.includes(r.status)).length : rows.length]));

const tglLokal = (v) => { if (!v) return ""; const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export function cocokPeriodePickup(r, { dasar = "dibuat", dari = "", sampai = "" } = {}) {
  if (!dari && !sampai) return true;
  const t = tglLokal(r[(DASAR_PICKUP.find((d) => d.key === dasar) ?? DASAR_PICKUP[0]).kolom]);
  if (!t) return false;
  return (!dari || t >= dari) && (!sampai || t <= sampai);
}
const teksCari = (r) => [r.issueNumber, r.unit?.unitCode, r.unit?.orderNumber, ...(r.lines ?? []).map((l) => `${l.code} ${l.name}`)].filter(Boolean).join(" ").toLowerCase();
const cocokKata = (r, q) => { const k = String(q ?? "").trim().toLowerCase(); return !k || k.split(/\s+/).every((p) => teksCari(r).includes(p)); };

/** SATU himpunan baris untuk tab, status, unit, bahan, jenis, periode, dan kata kunci — atas seluruh daftar yang dimuat. */
export function saringPickup(rows, f = {}) {
  const tab = TAB_PICKUP.find((t) => t.key === tabAktifPickup(f.tab));
  return rows.filter((r) =>
    (!tab.statuses || tab.statuses.includes(r.status))
    && (!f.status || r.status === f.status)
    && (!f.unit || r.unit?.id === f.unit)
    && (!f.bahan || (r.lines ?? []).some((l) => l.materialId === f.bahan))
    && (!f.jenis || (f.jenis === "tambahan" ? !!r.supplemental : !r.supplemental))
    && cocokPeriodePickup(r, { dasar: f.dasar, dari: f.dari, sampai: f.sampai })
    && cocokKata(r, f.q));
}
export function opsiSaringPickup(rows) {
  const unit = new Map(); const bahan = new Map();
  for (const r of rows) { if (r.unit?.id) unit.set(r.unit.id, `${r.unit.unitCode}${r.unit.orderNumber ? ` · ${r.unit.orderNumber}` : ""}`); for (const l of r.lines ?? []) if (l.materialId) bahan.set(l.materialId, `${l.code} — ${l.name}`); }
  const urut = (m) => [...m.entries()].map(([nilai, label]) => ({ nilai, label })).sort((a, b) => a.label.localeCompare(b.label, "id"));
  return { unit: urut(unit), bahan: urut(bahan) };
}
export function chipPickup(f, opsi) {
  const out = []; const cari = (d, v) => d.find((o) => o.nilai === v)?.label ?? v;
  if (f.status) out.push({ kunci: "status", teks: `Status: ${STATUS_PICKUP_LABEL[f.status] ?? f.status}` });
  if (f.unit) out.push({ kunci: "unit", teks: `Unit: ${cari(opsi.unit, f.unit)}` });
  if (f.bahan) out.push({ kunci: "bahan", teks: `Bahan: ${cari(opsi.bahan, f.bahan)}` });
  if (f.jenis) out.push({ kunci: "jenis", teks: JENIS_OPSI.find((j) => j.key === f.jenis)?.label ?? f.jenis });
  if (f.dari || f.sampai) out.push({ kunci: "periode", teks: `${(DASAR_PICKUP.find((d) => d.key === f.dasar) ?? DASAR_PICKUP[0]).label}: ${f.dari || "…"} s.d. ${f.sampai || "…"}` });
  return out;
}
/** Tiga hitungan terpisah: permintaan (dokumen), baris bahan, unit produksi berbeda. */
export function hitunganPickup(rows) {
  return { dokumen: rows.length, barisBahan: rows.reduce((n, r) => n + (r.lines?.length ?? 0), 0), unitProduksi: new Set(rows.map((r) => r.unit?.id).filter(Boolean)).size };
}
export function tindakanBerikutnyaPickup(r) {
  if (r.status === "READY_TO_PICK") return { teks: "Serahkan bahan", perlu: true };
  if (r.status === "ISSUED") return { teks: "Selesai — stok sudah berkurang", perlu: false };
  return { teks: "Dibatalkan — reservasi dilepas", perlu: false };
}
export const daftarMungkinTerpotong = (rows) => (rows?.length ?? 0) >= BATAS_DAFTAR;
/** Reservasi tidak sama dengan rencana → ditandai (angka server; layar tidak menghitung ulang). */
export const barisTidakKonsisten = (lines = []) => lines.filter((l) => Number(l.planned) !== Number(l.reserved));
