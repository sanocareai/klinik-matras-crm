import React, { useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { submitOrQueue } from "@/utils/submitJobAction.js";
import { Button } from "@/components/ui/button.jsx";
import { manifestOf } from "@/features/armada/manifest.js";

// CHECKLIST MUAT BARANG — "Barang dimuat 2/3 unit". Konfirmasi dikirim ke server per unit nyata job (idempoten); server yang menghitung 2/3, bukan layar.
// Gerbang penyelesaian (server): driver tidak bisa menutup pengiriman bila ada unit belum dikonfirmasi, kecuali pengecualian resmi beralasan (lihat DriverJobs).
const STATUS_MUAT = ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

export function bolehKonfirmasiMuat(job) {
  const m = manifestOf(job);
  return Boolean(m) && job?.type === "DELIVERY" && STATUS_MUAT.includes(job.status) && (m.muat?.total ?? 0) > 0;
}

export default function MuatBarangPanel({ job, onChanged, className = "" }) {
  const m = manifestOf(job);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!m?.muat || !(m.muat.total > 0)) return null;
  const { dimuat, total, lengkap, label } = m.muat;
  const bisa = bolehKonfirmasiMuat(job);
  async function konfirmasi() {
    setBusy(true); setErr("");
    try {
      // Offline: tersimpan di antrean dan dikirim otomatis saat online (replay aman — konfirmasi muat idempoten di server).
      const { queued } = await submitOrQueue(job.id, "unit-load", { semua: true });
      if (queued) setErr("Tersimpan offline — akan dikirim otomatis saat online.");
      await onChanged?.();
    } catch (e) { setErr(e.message || "Gagal menyimpan konfirmasi muat"); } finally { setBusy(false); }
  }
  return (
    <div className={`rounded-lg border px-3 py-2 ${lengkap ? "border-line bg-greenbg" : "border-line bg-inset"} ${className}`} data-testid="muat-barang">
      <div className="flex items-center justify-between gap-2">
        <p className={`m-0 flex items-center gap-1.5 text-[12.5px] font-semibold ${lengkap ? "text-green" : "text-ink"}`} data-testid="muat-label">
          <PackageCheck size={14} aria-hidden="true" /> {label}
        </p>
        {bisa && !lengkap && (
          <Button size="sm" variant="neutral" disabled={busy} onClick={konfirmasi} className="min-h-9 text-[12px]" data-testid="muat-konfirmasi">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Semua dimuat"}
          </Button>
        )}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={dimuat} aria-label={label}>
        <div className={`h-full ${lengkap ? "bg-green" : "bg-accent"}`} style={{ width: `${Math.round((dimuat / total) * 100)}%` }} />
      </div>
      {err && <p role="alert" className="m-0 mt-1 text-[11.5px] text-red">{err}</p>}
    </div>
  );
}
