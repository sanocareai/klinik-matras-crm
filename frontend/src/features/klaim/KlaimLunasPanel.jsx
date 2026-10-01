import React, { useCallback, useEffect, useState } from "react";
import { BadgeCheck, FileWarning } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import KlaimLunasDialog from "./KlaimLunasDialog.jsx";
import { STATUS_KLAIM_LABEL } from "./klaimLunasLogic.js";
import { useKlaimLunasAktif } from "./useKlaimLunasAktif.js";

// Panel kecil "Klaim Lunas" untuk satu order: status klaim terkini + tombol "Ajukan Klaim Lunas". Menggantikan cara lama Sales menandai order
// Lunas lewat dropdown (server menolaknya untuk non-Admin). Dipakai di tab Pembayaran drawer order dan di form order Pelanggan.
export default function KlaimLunasPanel({ order, onChanged, className }) {
  const gateAktif = useKlaimLunasAktif(); // sakelar rollout: MATI → panel tidak tampil (UI lama)
  const [info, setInfo] = useState(null);
  const [buka, setBuka] = useState(false);

  const muat = useCallback(() => {
    if (gateAktif !== true) return;
    api.getKlaimLunasOrder(order.id).then(setInfo).catch(() => setInfo(null));
  }, [order.id, gateAktif]);
  useEffect(() => { setInfo(null); muat(); }, [muat]);

  if (gateAktif !== true || !info) return null;
  const aktif = info.klaim.find((k) => k.id === info.klaimAktifId) || null;
  const ditolak = !aktif ? info.klaim.find((k) => k.status === "REJECTED") : null;
  const terakhir = aktif || ditolak;
  // Tidak ada yang bisa dilakukan & tidak ada klaim untuk ditampilkan → panel tidak perlu ada.
  if (!info.bolehDiklaim && !terakhir && !info.buktiBelumLengkap) return null;

  const teksTombol = !terakhir ? "Ajukan Pembayaran (DP / Lunas)"
    : terakhir.status === "SUBMITTED" ? "Lihat Klaim"
      : terakhir.status === "DRAFT" ? "Lengkapi & Ajukan Klaim"
        : "Perbaiki & Ajukan Ulang";
  const nada = !terakhir ? "bg-inset text-ink2"
    : terakhir.status === "SUBMITTED" ? "bg-greenbg text-green"
      : terakhir.status === "DRAFT" ? "bg-inset text-ink2" : "bg-orangebg text-orange";

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl bg-surface p-3 shadow-card", className)} data-testid="panel-klaim-lunas">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-ink3">
        <BadgeCheck size={12} /> Pembayaran (DP / Lunas)
      </div>
      {info.buktiBelumLengkap && !terakhir && (
        <p className="flex items-start gap-1.5 rounded-lg bg-orangebg px-2.5 py-2 text-[11.5px] text-orange" data-testid="bukti-belum-lengkap">
          <FileWarning size={13} className="mt-0.5 shrink-0" /> Bukti belum lengkap — order ini ditandai Lunas tetapi belum ada pembayaran tercatat.
        </p>
      )}
      {terakhir && (
        <div className={cn("rounded-lg px-2.5 py-2 text-[11.5px]", nada)}>
          <p className="font-semibold">{STATUS_KLAIM_LABEL[terakhir.status] || terakhir.status}</p>
          {terakhir.reviewReason && <p className="mt-0.5">Alasan Finance: {terakhir.reviewReason}</p>}
        </div>
      )}
      <button
        type="button" onClick={() => setBuka(true)}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accentbg text-[13px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
      >
        {teksTombol}
      </button>
      <p className="text-[10.5px] leading-snug text-ink3">Status pembayaran berubah menjadi Lunas setelah Finance memverifikasi bukti pembayaran.</p>
      {buka && (
        <KlaimLunasDialog
          open order={order}
          onClose={() => { setBuka(false); muat(); }}
          onChanged={() => { muat(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
