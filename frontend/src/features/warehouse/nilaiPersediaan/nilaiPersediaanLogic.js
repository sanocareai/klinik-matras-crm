// Logika MURNI tampilan Nilai Persediaan (kandidat laporan baca-saja). Tidak menghitung ulang nilai: semua angka berasal dari respons server (`/api/inventory/nilai-persediaan`).
// Aturan tampilan: pengecualian TIDAK pernah ditulis Rp0 dan tidak disembunyikan; nominal hanya bila server mengizinkan (izin.nominal); satu sumber cakupan untuk kartu, strip, dan tabel.
export const STATUS_TEKS = Object.freeze({
  DINILAI: "Dinilai", SALDO_NOL: "Saldo nol", STOK_BELUM_DIKETAHUI: "Stok belum diketahui", HARGA_KOSONG: "Harga kosong", SALDO_MINUS: "Saldo minus", SATUAN_TIDAK_COCOK: "Satuan tidak cocok", PENGAMATAN_FISIK: "Terukur dalam satuan lain",
});
export const STATUS_NADA = Object.freeze({ DINILAI: "ok", SALDO_NOL: "netral", STOK_BELUM_DIKETAHUI: "waspada", HARGA_KOSONG: "waspada", SALDO_MINUS: "bahaya", SATUAN_TIDAK_COCOK: "bahaya", PENGAMATAN_FISIK: "info" });
export const URUT_STATUS = Object.freeze(["DINILAI", "SALDO_MINUS", "SATUAN_TIDAK_COCOK", "HARGA_KOSONG", "PENGAMATAN_FISIK", "STOK_BELUM_DIKETAHUI", "SALDO_NOL"]);
export const STATUS_PENGECUALIAN = Object.freeze(["STOK_BELUM_DIKETAHUI", "HARGA_KOSONG", "SALDO_MINUS", "SATUAN_TIDAK_COCOK", "PENGAMATAN_FISIK"]);
export const FILTER_SEMUA = "SEMUA"; export const FILTER_PENGECUALIAN = "PENGECUALIAN";
export const SUMBER_HARGA_TEKS = Object.freeze({ MANUAL: "Manual", KOREKSI: "Koreksi manual", PO: "Dari PO (otomatis; belum tentu diterima)" });
export const STATUS_REKON_TEKS = Object.freeze({ BELUM_DIREKONSILIASI: "Belum direkonsiliasi" });

const NF = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });
/** Angka kuantitas; null/undefined → "belum diketahui" (BUKAN 0). */
export function teksSaldo(saldo, satuan) { return saldo === null || saldo === undefined ? "belum diketahui" : `${NF.format(saldo)} ${satuan ?? ""}`.trim(); }
/** Rupiah utuh; null → tanda hubung (nominal tidak tersedia/ tidak diizinkan), TIDAK pernah "Rp0" untuk nilai yang memang tidak diketahui. */
export function teksRupiah(n) { return n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`; }
export function teksHarga(harga, satuan) { return harga?.nilai === null || harga?.nilai === undefined ? null : `${teksRupiah(harga.nilai)} / ${harga.satuan || satuan}`; }
export const teksSumberHarga = (s) => SUMBER_HARGA_TEKS[s] ?? "";
const pad = (n) => String(n).padStart(2, "0");
/** "5 Nov 2026 01:10 WIB" dari ISO; selalu WIB (UTC+7) agar tidak bergantung zona peramban. */
export function teksWaktuWIB(iso) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return "—";
  const w = new Date(d.getTime() + 7 * 3600_000); const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][w.getUTCMonth()];
  return `${w.getUTCDate()} ${bln} ${w.getUTCFullYear()} ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())} WIB`;
}
/** Kalimat cakupan SATU sumber: "118 dari 379 bahan relevan dinilai (31%) · 261 belum dinilai". */
export function kalimatCakupan(c) {
  if (!c) return "";
  const persen = c.persenDinilai === null || c.persenDinilai === undefined ? "" : ` (${String(c.persenDinilai).replace(".", ",")}%)`;
  return `${c.dinilai} dari ${c.relevan} bahan relevan dinilai${persen} · ${c.pengecualian} belum dinilai`;
}
export function saringBaris(baris, { filter = FILTER_PENGECUALIAN, cari = "" } = {}) {
  const q = String(cari ?? "").trim().toLowerCase();
  return (baris ?? []).filter((b) => (filter === FILTER_SEMUA ? true : filter === FILTER_PENGECUALIAN ? STATUS_PENGECUALIAN.includes(b.status) : b.status === filter))
    .filter((b) => !q || `${b.kode} ${b.nama}`.toLowerCase().includes(q));
}
/** Hitungan per status untuk tombol penyaring: SEMUA, PENGECUALIAN (gabungan), lalu status yang ada. */
export function opsiFilter(cakupan) {
  const per = cakupan?.perStatus ?? {}; const ada = URUT_STATUS.filter((s) => (per[s] ?? 0) > 0);
  return [{ kode: FILTER_PENGECUALIAN, teks: "Semua pengecualian", jumlah: cakupan?.pengecualian ?? 0 }, { kode: FILTER_SEMUA, teks: "Semua bahan", jumlah: cakupan?.universe ?? 0 }, ...ada.map((s) => ({ kode: s, teks: STATUS_TEKS[s], jumlah: per[s] }))];
}
/** Segmen strip cakupan (persen lebar) — urut risiko, tanpa menyembunyikan status apa pun. */
export function segmenCakupan(cakupan) {
  const per = cakupan?.perStatus ?? {}; const total = cakupan?.universe || 0; if (!total) return [];
  return URUT_STATUS.filter((s) => per[s] > 0).map((s) => ({ status: s, jumlah: per[s], persen: (per[s] / total) * 100, teks: STATUS_TEKS[s], nada: STATUS_NADA[s] }));
}
/** Penjelasan kartu bila nominal tidak diizinkan. */
export const TEKS_TANPA_NOMINAL = "Nominal hanya untuk Finance/Owner. Jumlah bahan dan status tetap tampil.";
export const TEKS_NILAI_PARSIAL = "Nilai parsial berdasarkan biaya penerimaan terakhir: hanya bahan yang pernah punya biaya penerimaan, dihitung biaya penerimaan terakhir × saldo (termasuk saldo minus). Bukan Estimasi nilai stok dan bukan saldo akun Finance — hanya rincian.";
export const TEKS_BELUM_FINAL = "Belum direkonsiliasi dengan hasil SO — bukan hasil stok fisik final.";

// ── Form pencatatan hasil SO (validasi ringan di peramban; server tetap memeriksa ulang) ──
export const JENIS_HASIL_SO = Object.freeze({ NOL_DIKONFIRMASI: "Fisik nol dikonfirmasi", PENGAMATAN_SATUAN: "Terukur dalam satuan lain (mis. ROLL)" });
const ISO_TGL = /^\d{4}-\d{2}-\d{2}$/;
export function periksaFormHasilSO(f, { satuanStok } = {}) {
  const e = {}; const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
  if (!ISO_TGL.test(String(f.soTanggal ?? ""))) e.soTanggal = "Tanggal SO wajib diisi.";
  if (norm(f.sumber).length < 3) e.sumber = "Sumber wajib (mis. nama berkas dan sel).";
  if (norm(f.alasan).length < 10) e.alasan = "Alasan wajib, minimal 10 karakter.";
  if (f.jenis === "PENGAMATAN_SATUAN") {
    const j = Number(String(f.jumlah ?? "").replace(",", ".")); if (String(f.jumlah ?? "").trim() === "" || !Number.isFinite(j) || j <= 0) e.jumlah = "Jumlah harus lebih dari 0.";
    const sat = norm(f.satuan).toUpperCase(); if (!sat) e.satuan = "Satuan pengamatan wajib (mis. ROLL)."; else if (sat === String(satuanStok ?? "").toUpperCase()) e.satuan = `Sama dengan satuan stok (${satuanStok}) — gunakan Koreksi Saldo.`;
  }
  return e;
}
/** Badan permintaan. Jam SO tidak dikirim (belum dikonfirmasi — tidak ditebak). Koreksi menunjuk catatan terkini. */
export function bangunBodyHasilSO(f, bahan) {
  const nol = f.jenis === "NOL_DIKONFIRMASI";
  return { baris: [{ materialId: bahan.materialId, jenis: f.jenis, jumlah: nol ? 0 : Number(String(f.jumlah).replace(",", ".")), ...(nol ? {} : { satuan: String(f.satuan).trim().toUpperCase() }), soTanggal: f.soTanggal, sumber: String(f.sumber).trim(), alasan: String(f.alasan).trim(), ...(bahan.hasilSO?.id ? { menggantikanId: bahan.hasilSO.id } : {}) }] };
}

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-11-04" → "4 Nov 2026" (tanggal sumber SO apa adanya, tanpa zona). */
export function teksTanggalSO(t) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t ?? "")); return m ? `${Number(m[3])} ${BLN[Number(m[2]) - 1]} ${m[1]}` : "—"; }
export const TEKS_RINCIAN_NOL = "Rincian verifikasi nol";
/** Rincian nol terverifikasi menurut SUMBER bukti: Koreksi Saldo (dokumen + tanggal SO bila ditautkan) dibedakan dari Stock Count. null bila bukan nol terverifikasi. */
export function ringkasVerifikasiNol(v) {
  if (!v) return null;
  const sumber = v.sumber === "KOREKSI_SALDO" ? "Koreksi Saldo" : v.sumber === "STOCK_COUNT" ? "Stock Count" : (v.sumber ?? "—");
  return { label: v.label ?? `Nol terverifikasi — ${sumber}`, sumber, dokumen: v.nomor ?? "—", tanggalSO: v.soTanggal ? teksTanggalSO(v.soTanggal) : (v.sumber === "KOREKSI_SALDO" ? "belum ditautkan" : null) };
}
/** Satu baris "sumber SO": tanggal sumber, status rekonsiliasi, dan pergerakan sesudahnya. null bila tidak ada hasil SO. */
export function ringkasHasilSO(h) {
  if (!h) return null; const sd = h.pergerakanSesudah ?? { jumlah: 0, net: 0, padaTanggal: 0 };
  const bagian = [`Hasil SO ${teksTanggalSO(h.soTanggal)}`, h.statusTeks ?? "Status belum dihitung"];
  bagian.push(sd.jumlah > 0 ? `${sd.jumlah} pergerakan sesudahnya (net ${NF.format(sd.net)})` : "tidak ada pergerakan sesudahnya");
  return { teks: bagian.join(" · "), kedaluwarsa: !!h.kedaluwarsa, terbuka: h.status === "TERBUKA_SATUAN" };
}
