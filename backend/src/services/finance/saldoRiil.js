// SALDO RIIL TERKONFIRMASI vs SALDO BUKU pada tanggal buku YANG SAMA — read-only (tidak menulis jurnal, tidak mengubah perhitungan saldo).
//
// Saldo riil ini KONFIRMASI OWNER (belum berdasarkan rekening koran). Disimpan sebagai konstanta karena sistem belum punya tabel "saldo bank terkonfirmasi".
// Membandingkan saldo dari WAKTU BERBEDA menyesatkan, jadi saldo buku dihitung pada tanggal buku cutoff (bukan "sekarang").
// Ganti konstanta ini (dan hanya ini) setelah cutoff/rekening koran baru tersedia.

import { toMoney, moneyToNumber } from "./money.js";

export const SALDO_RIIL_TERKONFIRMASI = Object.freeze({
  cutoffLabel: "21 Sep 2026 pukul 20.00 WIB",
  tanggalBuku: "2026-09-21", // saldo buku dihitung sampai tanggal buku ini
  sumber: "Konfirmasi owner — belum berdasarkan rekening koran",
  // nama rekening (persis seperti di Kas & Bank) → saldo riil; null = belum dikonfirmasi
  saldo: Object.freeze({ "PT Sano": "39180615", "KEM - Sano Bank": "4912088", "Uang Kas Sano": null }),
  catatan: "Rekonsiliasi sementara tanpa rekening koran. Saldo akhir telah dikonfirmasi owner, tetapi mutasi individual belum seluruhnya diverifikasi.",
});

/** Murni: gabungkan saldo buku (per rekening, pada tanggal cutoff) dengan saldo riil terkonfirmasi. */
export function bandingkanSaldoRiil(rekeningBuku, konfig = SALDO_RIIL_TERKONFIRMASI) {
  const norm = (s) => String(s ?? "").trim().toUpperCase();
  const peta = new Map(Object.entries(konfig.saldo).map(([k, v]) => [norm(k), v]));
  return rekeningBuku.map((r) => {
    const raw = peta.get(norm(r.name));
    const buku = toMoney(r.saldo);
    if (raw === undefined) return { id: r.id, name: r.name, kind: r.kind, saldoBuku: moneyToNumber(buku), saldoRiil: null, selisih: null, status: "TIDAK_ADA_SALDO_RIIL" };
    if (raw === null) return { id: r.id, name: r.name, kind: r.kind, saldoBuku: moneyToNumber(buku), saldoRiil: null, selisih: null, status: "BELUM_DIKONFIRMASI" };
    const riil = toMoney(raw);
    const selisih = buku.minus(riil); // + = buku lebih tinggi dari saldo riil
    return { id: r.id, name: r.name, kind: r.kind, saldoBuku: moneyToNumber(buku), saldoRiil: moneyToNumber(riil), selisih: moneyToNumber(selisih), status: selisih.isZero() ? "SESUAI" : "SELISIH" };
  });
}
