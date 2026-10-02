import React from "react";
import { Uang, formatUang } from "@/features/finance/shared.jsx";
import { nominalTampil } from "@/features/finance/biayaAdminLogic.js";

export { nominalTampil };

// BIAYA ADMIN TRANSFER IKUT NOMINAL (2 Okt 2026, permintaan Owner): di semua daftar (Pengeluaran, Pembelian, Kasbon, Uang Muka, Pembayaran Supplier, Refund, Transfer) nominal yang tampil
// = TOTAL yang keluar dari rekening (nominal + biaya admin) — sama dengan satu baris di rekening koran bank. Rinciannya (nominal, biaya admin, total) hanya muncul saat baris/kartu diklik (panel detail).
// Angka total dari SERVER (totalKeluarRekening); fallback jumlah dua angka server bila field belum ada. Ringkasan kartu di atas daftar tetap menghitung nominal transaksi (tanpa biaya admin).

/** Sel/bidang nominal untuk daftar: total keluar rekening; bila ada biaya admin diberi keterangan kecil (tanpa rincian angka). */
export function NominalDenganBiaya({ d, className }) {
  const n = nominalTampil(d);
  return (
    <>
      <Uang value={n.nilai} className={className} />
      {n.adaBiaya && <span className="block text-[10.5px] leading-tight text-ink3" data-testid="termasuk-biaya-admin">termasuk biaya admin</span>}
    </>
  );
}

/** Versi teks untuk bidang kartu (RowCard fields): "Rp102.500 (termasuk biaya admin)". */
export function nominalTeks(d) {
  const n = nominalTampil(d);
  return n.adaBiaya ? `${formatUang(n.nilai)} (termasuk biaya admin)` : formatUang(n.nilai);
}
