// Logika murni panel Copilot (AI Studio MVP 2) — dites di tests/copilotPanel.test.js.

export const LABEL_TAHAP = {
  SAMBUT: "Sambut", DIAGNOSA: "Diagnosa", EDUKASI: "Edukasi", REKOMENDASI: "Rekomendasi",
  HARGA: "Harga", KEBERATAN: "Keberatan", CLOSING: "Closing", HANDOVER: "Serahkan ke sales",
};

export const ALASAN_ABAIKAN = [
  ["SALAH_INFO", "Salah info"],
  ["TERLALU_PANJANG", "Terlalu panjang"],
  ["TIDAK_NATURAL", "Tidak natural"],
  ["SALAH_TAHAP", "Salah tahap"],
  ["LAINNYA", "Lainnya"],
];

const kosong = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const rapikan = (s) => String(s).replace(/\s+/g, " ").trim();
const samaTeks = (a, b) => rapikan(a || "").toLowerCase() === rapikan(b || "").toLowerCase();

// Usulan simpan ke CRM dari dataTerkumpul — hanya 3 field yang diizinkan server:
// kota, tag keluhan, catatan. Data yang sudah sama di kartu customer tidak diusulkan.
export function usulanCrm(dataTerkumpul = {}, customer = {}) {
  const d = dataTerkumpul || {};
  const usulan = [];
  if (!kosong(d.domisili) && !samaTeks(d.domisili, customer?.city)) {
    usulan.push({ kunci: "city", label: "Kota", nilai: rapikan(d.domisili).slice(0, 80) });
  }
  if (!kosong(d.keluhan)) {
    usulan.push({ kunci: "tag", label: "Tag keluhan", nilai: rapikan(d.keluhan).slice(0, 40) });
  }
  const bb = Array.isArray(d.beratBadan) ? d.beratBadan.map((x) => (typeof x === "number" ? `${x} kg` : x)).join(" & ") : d.beratBadan;
  const bagian = [
    ["Ukuran", d.ukuran], ["BB", bb], ["Kondisi", d.kondisiKasur], ["Umur kasur", d.umurKasur],
    ["Posisi tidur", d.posisiTidur], ["Riwayat", d.riwayatKesehatan],
  ].filter(([, v]) => !kosong(v)).map(([k, v]) => `${k}: ${rapikan(v)}`);
  if (bagian.length) usulan.push({ kunci: "note", label: "Catatan", nilai: bagian.join(" · ").slice(0, 1000) });
  return usulan;
}

// Bubble draft → satu teks untuk kolom ketik (dipisah baris kosong; sales bisa edit).
export const gabungBubble = (bubbles = []) => bubbles.map((b) => String(b).trim()).filter(Boolean).join("\n\n");

// Nasib draft saat sales mengirim: sama persis (abaikan spasi) → USED_AS_IS, selain itu USED_EDITED.
export function nasibDraft(teksAsli, teksDikirim) {
  return rapikan(teksAsli) === rapikan(teksDikirim) ? "USED_AS_IS" : "USED_EDITED";
}

// Cek keras yang gagal → peringatan singkat untuk sales.
export const peringatan = (checks = []) => (checks || []).filter((c) => c && c.lulus === false).map((c) => c.pesan);
