// Model MURNI untuk daftar Order Produksi (redesain komposisi): tindakan baris menurut kondisi nyata, dan sasaran tab panel unit.
// Server tetap otoritas (adopsi.tindakan + izin di panel); di sini hanya memetakan kode tindakan server ke SATU tombol baris + tab tujuan di panel. Tidak ada tindakan tulis dari baris:
// semua tombol hanya MEMBUKA panel unit (konfirmasi, izin, dan dampak tetap ada di panel).

export const AKTIF_UNIT_TERTUTUP = Object.freeze(["CANCELLED", "DELIVERED"]);
export const unitBerjalan = (u) => !AKTIF_UNIT_TERTUTUP.includes(u?.status);

// kode tindakan server -> { label, tab, utama }. `utama` = tombol terisi; selain itu tombol netral.
const PETA = Object.freeze({
  CONFIRM_ARRIVAL: { label: "Catat diterima", tab: "pekerjaan", utama: true },
  UBAH_ORDER_DIPROSES: { label: "Ubah ke Diproses", tab: "pekerjaan", utama: true },
  MARK_READY: { label: "Tandai siap kirim", tab: "pekerjaan", utama: true },
  FINISH_WORK: { label: "Catat selesai", tab: "pekerjaan", utama: true },
  RECORD_MATERIAL: { label: "Catat bahan", labelLihat: "Lihat bahan", tab: "bahan", utama: true },
  PLAN_MATERIAL: { label: "Susun rencana bahan", tab: "bahan", utama: false },
  SET_TARGET: { label: "Atur target", tab: "pekerjaan", utama: false },
  OPEN_PLAN: { label: "Atur jadwal", tab: "pekerjaan", utama: false },
  OPEN_WORK: { label: "Buka pekerjaan", tab: "pekerjaan", utama: false },
  RESOLVE_DELAY: { label: "Tangani tertunda", tab: "pekerjaan", utama: true },
});

/** Tindakan baris untuk satu unit. Mengembalikan { teks, aktor, tombol|null }. Unit tertutup/riwayat tidak punya tombol tindakan (hanya membuka rincian lewat klik baris). */
export function tindakanBaris(unit, adopsi, { bisaCatat = false } = {}) {
  const t = adopsi?.tindakan ?? null;
  const aktor = t?.aktor && t.aktor !== "—" ? t.aktor : null;
  if (!unitBerjalan(unit)) return { teks: t?.label || null, aktor, tombol: null };
  const p = t ? PETA[t.aksi] : null;
  if (!p) return { teks: t?.label || null, aktor, tombol: null };
  return { teks: t.label, aktor, tombol: { label: !bisaCatat && p.labelLihat ? p.labelLihat : p.label, tab: p.tab, utama: p.utama } };
}

/** Tab pembuka panel menurut fokus dari daftar: bahan → tab Bahan; selain itu → tab Pekerjaan. */
export const TAB_PANEL = Object.freeze(["pekerjaan", "bahan", "riwayat"]);
export const tabAwalPanel = (fokus) => (fokus === "bahan" ? "bahan" : "pekerjaan");

/** Ringkasan jumlah termuat vs hasil: kontrak server (total = seluruh hasil filter; hasMore = masih ada halaman). */
export function teksJumlah({ dimuat, total, hasMore }) {
  if (hasMore) return `Menampilkan ${dimuat} dari ${total} unit — sisanya dimuat bertahap`;
  return `${dimuat} dari ${total} unit`;
}

/** Salin teks ke papan klip (tanpa melempar). true bila berhasil. */
export async function salinTeks(teks) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(teks); return true; }
  } catch { /* jatuh ke cadangan */ }
  try {
    const ta = document.createElement("textarea"); ta.value = teks; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return !!ok;
  } catch { return false; }
}
