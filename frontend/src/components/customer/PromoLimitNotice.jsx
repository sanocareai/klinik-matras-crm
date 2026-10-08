import React from "react";
import { cekBatasDiskonPromo, formatRupiah } from "@/utils/format.js";

// Info & peringatan batas maksimal diskon promo (8 Okt 2026, permintaan owner). Dipakai di form order baru dan di detail order.
// TIDAK memblokir penyimpanan — hanya memberi tahu (keputusan owner 29 Agustus: sales bebas menembus batas harga asal kelihatan).
// Diskon diukur dari selisih harga final ke harga standard katalog, sama dengan penanda "di bawah standard" di tiap item.
export default function PromoLimitNotice({ promo, items }) {
  if (!promo || promo.maxDiscountAmount == null) return null;
  const cek = cekBatasDiskonPromo(items, promo);
  if (!cek) return null;
  const melebihi = cek.melebihi;
  return (
    <div
      role={melebihi ? "alert" : "note"}
      style={{
        marginTop: 8, padding: "8px 10px", borderRadius: 10, fontSize: 12, lineHeight: 1.45,
        background: melebihi ? "rgba(220,38,38,0.10)" : "rgba(0,0,0,0.04)",
        color: melebihi ? "#b91c1c" : "var(--text-muted)",
        border: melebihi ? "1px solid rgba(220,38,38,0.35)" : "1px solid transparent",
      }}
    >
      {melebihi ? (
        <>
          <strong>Diskon melebihi batas promo.</strong> Batas maksimal {promo.code}: {formatRupiah(cek.batas)}; diskon di bawah harga standard
          saat ini {formatRupiah(cek.diskon)} (lebih {formatRupiah(cek.lebih)}). Naikkan harga item atau pilih promo lain — order tetap bisa
          disimpan, tetapi akan ditandai di laporan.
        </>
      ) : (
        <>
          Batas maksimal diskon {promo.code}: {formatRupiah(cek.batas)} · terpakai {formatRupiah(cek.diskon)}
        </>
      )}
    </div>
  );
}
