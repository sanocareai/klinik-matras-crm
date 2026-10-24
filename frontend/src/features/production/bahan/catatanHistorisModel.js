// Model MURNI Catatan Pemakaian Historis (diuji node --test tanpa React/DOM).
// Prinsip: nilai asli berkas ditampilkan APA ADANYA (mis. "1,5 KG"); yang janggal diberi label "Perlu dicek" + catatan singkat yang bisa ditindaklanjuti.
// Catatan ini BUKAN pengeluaran stok dan TIDAK dijumlahkan ke "Pemakaian aktual".
import { parseJumlah } from "../orderProduksiModel.js";

export const JUDUL_CATATAN = "Catatan pemakaian historis (Excel Admin Sales)";
export const KETERANGAN_CATATAN = "Tampil apa adanya dari berkas. Bukan pengeluaran stok: tidak mengurangi saldo, tidak ada biaya atau jurnal. Yang sudah sama dengan stok ditautkan (tidak digandakan).";
export const NADA_STATE = Object.freeze({ PERLU_DICEK: "orange", SIAP_POSTING: "accent", TERCATAT_DI_STOK: "green", DIPOSTING: "green", BUKAN_STOK: "neutral", DIKOREKSI: "neutral", TIDAK_DIHITUNG: "neutral" });
export const KODE_BISA_DIKONFIRMASI = Object.freeze(["BARIS_BERULANG", "KATEGORI_KOMPLAIN"]);
export const SATUAN_KOREKSI = Object.freeze(["PCS", "METER", "M3", "SHEET", "SPOOL", "KG", "PACK", "ROLL", "BUNDLE", "ROD", "PAIR", "CAN", "BOX", "LITER"]);

/** Kelompok tampilan: yang perlu dicek DI ATAS dan terbuka; sisanya ringkas. */
export function kelompokkanCatatan(items = []) {
  const g = { perluDicek: [], siap: [], sudah: [], lain: [] };
  for (const i of items) {
    if (i.state === "PERLU_DICEK") g.perluDicek.push(i);
    else if (i.state === "SIAP_POSTING") g.siap.push(i);
    else if (i.state === "TERCATAT_DI_STOK" || i.state === "DIPOSTING") g.sudah.push(i);
    else g.lain.push(i);
  }
  return g;
}
/** Nilai asli berkas tanpa konversi; catatan dari pengeluaran stok memakai nilai stok. */
export function teksNilai(i) {
  if (i.origin === "LEDGER") return `${i.qty ?? "—"} ${i.satuan ?? ""}`.trim();
  return `${i.qtyAsli ?? "—"} ${i.satuanAsli ?? ""}`.trim();
}
export function ringkasCatatan(r = {}) {
  const bagian = [];
  if (r.perluDicek) bagian.push(`${r.perluDicek} perlu dicek`);
  if (r.siapPosting) bagian.push(`${r.siapPosting} siap jadi pengeluaran stok`);
  const sudah = (r.tercatatDiStok ?? 0) + (r.diposting ?? 0); if (sudah) bagian.push(`${sudah} sudah di stok`);
  if (r.bukanStok) bagian.push(`${r.bukanStok} bukan stok Gudang`);
  return bagian.length ? bagian.join(" · ") : "Tidak ada catatan";
}
/** Aksi yang tersedia per catatan. izin.catatanHistoris = boleh menulis bahan; izin.ajukanKoreksiPemakaian sama (penyetuju terpisah). */
export function aksiCatatan(i, izin = {}) {
  const a = []; if (!izin.catatanHistoris) return a;
  const flags = (i.flags ?? []).map((f) => f.kode);
  if (i.origin === "EXCEL" && ["PERLU_DICEK", "SIAP_POSTING", "TERCATAT_DI_STOK"].includes(i.state)) a.push({ key: "koreksi", label: "Koreksi catatan" });
  if (i.origin === "EXCEL" && flags.some((k) => KODE_BISA_DIKONFIRMASI.includes(k)) && ["PERLU_DICEK", "SIAP_POSTING"].includes(i.state)) a.push({ key: "konfirmasi", label: "Konfirmasi wajar" });
  if (i.origin === "EXCEL" && ["PERLU_DICEK", "SIAP_POSTING"].includes(i.state)) a.push({ key: "kecualikan", label: "Kecualikan (salinan ganda)" });
  if (i.bahan?.id && (flags.includes("ISSUE_LAMA_BERBEDA") || flags.includes("ISSUE_TANPA_PASANGAN"))) a.push({ key: "koreksiPemakaian", label: "Ajukan koreksi pemakaian" });
  return a;
}
export function teksPenanda(f) { return `${f.teks} ${f.aksi}`.trim(); }
/** HPP per order: PARSIAL bila ada gap — tidak pernah ditampilkan sebagai final. */
export function badgeHpp(h) {
  if (!h) return null;
  if (h.final) return { tone: "green", label: "HPP bahan final", detail: null };
  const gap = (h.gap ?? []); const jenis = [...new Set(gap.map((g) => g.jenis))];
  return { tone: "orange", label: "HPP bahan PARSIAL", detail: gap.length ? `${jenis.length} gap: ${gap.slice(0, 3).map((g) => g.pesan).join(" · ")}` : "Belum ada pemakaian bernilai.", nilai: h.lihatNilai && h.nilaiTerhitung != null ? h.nilaiTerhitung : null };
}
export function validasiKoreksiCatatan({ qty, uom, alasan }) {
  const v = parseJumlah(qty);
  if (qty !== "" && qty !== undefined && (v === null || v <= 0)) return { ok: false, galat: "Jumlah harus angka lebih dari 0." };
  if (uom && !SATUAN_KOREKSI.includes(uom)) return { ok: false, galat: "Satuan tidak dikenal." };
  if (String(alasan ?? "").trim().length < 5) return { ok: false, galat: "Alasan wajib diisi (minimal 5 karakter)." };
  return { ok: true, galat: null };
}
export function validasiKoreksiPemakaian({ qtyBaru, alasan }) {
  const v = parseJumlah(qtyBaru);
  if (v === null || v < 0) return { ok: false, galat: "Pemakaian yang benar harus angka 0 atau lebih." };
  if (String(alasan ?? "").trim().length < 5) return { ok: false, galat: "Alasan wajib diisi (minimal 5 karakter)." };
  return { ok: true, galat: null, qty: v };
}
