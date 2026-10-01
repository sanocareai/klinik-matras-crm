import React, { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { toApiParams } from "@/lib/dateRange.js";
import { rolesOf } from "@/lib/roles.js";

// PENJUALAN KARYAWAN (di luar tim Sales) — order yang dijual karyawan non-Sales. Masuk omzet/total perusahaan, TIDAK masuk angka Tim Sales (performa, target, ranking).
// Semua angka dari server (GET /api/orders/penjualan-karyawan/ringkasan); tidak ada hitungan di sini. Hanya tampil untuk Admin/Owner/Finance dan hanya bila ada datanya.
function bacaUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

export default function KartuPenjualanKaryawan({ range }) {
  const user = bacaUser();
  const boleh = rolesOf(user).some((r) => ["ADMIN", "OWNER", "FINANCE"].includes(r));
  const [data, setData] = useState(null);
  const kunci = JSON.stringify(toApiParams(range));
  useEffect(() => {
    if (!boleh) return undefined;
    let batal = false;
    api.getPenjualanKaryawan(toApiParams(range)).then((d) => { if (!batal) setData(d); }).catch(() => { if (!batal) setData(null); });
    return () => { batal = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, boleh]);

  if (!boleh || !data || data.total.jumlahOrder === 0) return null;
  return (
    <section className="rounded-card bg-surface p-4 shadow-card" data-testid="kartu-penjualan-karyawan">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink3"><UserRound size={13} /> Penjualan Karyawan (di luar tim Sales)</div>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Order", String(data.total.jumlahOrder)], ["Nilai Penjualan", formatRupiah(data.total.nilai)], ["Sudah Dibayar", formatRupiah(data.total.terbayar)], ["Sisa Tagihan ke Karyawan", formatRupiah(data.total.sisa)]].map(([l, v]) => (
          <div key={l}><p className="text-[11px] text-ink3">{l}</p><p className="text-[16px] font-bold tabular-nums text-ink">{v}</p></div>
        ))}
      </div>
      <div className="mt-3 divide-y divide-line/60">
        {data.karyawan.map((k) => (
          <details key={k.staffSellerId} className="py-2">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-[13px] text-ink">
              <span className="font-semibold">{k.nama} <span className="font-normal text-ink3">· {k.jumlahOrder} order</span></span>
              <span className="tabular-nums text-ink2">Sisa {formatRupiah(k.sisa)}</span>
            </summary>
            <ul className="mt-1.5 space-y-1 text-[12px] text-ink2">
              {k.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate"><span className="font-mono">{o.orderNumber}</span> · {formatTanggalPendek(o.tanggal)} · {o.pelanggan}</span>
                  <span className="shrink-0 tabular-nums">{formatRupiah(o.terbayar)} / {formatRupiah(o.nilai)}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{data.catatan.join(" ")}</p>
    </section>
  );
}
