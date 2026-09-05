import React from "react";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from "@/utils/format.js";
import { JOB_STATUS_REAL } from "../jobStatus.js";

// Timeline visual bergaya tracking paket (GoFood/Gojek) — D-036 (30 Agustus
// 2026). SATU komponen dipakai di JobDetailDrawer.jsx (Delivery Hub) DAN
// OrderSection.jsx (Sales CRM) supaya urutan/label tahapnya SELALU identik
// di dua tempat — sebelumnya masing-masing punya representasi teks sendiri
// yang bisa diam-diam beda susunan.
//
// Langkah TERBATAS ke 5 status hidup (PENDING..DELIVERED) — CANCELLED BUKAN
// "langkah ke-6", itu status terminal terpisah yang menghentikan alur, jadi
// dirender sebagai pita berbeda, bukan titik paling kanan yang "sudah
// dilewati".
const STEPS = ORDER_STATUSES.filter((s) => s !== "CANCELLED");

// Order kategori BARU (D-051, 4 September 2026 — laporan owner: order kasur
// BARU itu MEMBUAT produk dari nol, bukan menjemput barang lama milik
// customer — "Menunggu"/"Pengambilan" tidak masuk akal untuk alur ini,
// prosesnya cuma 3 tahap). Unit BARU sekarang lahir langsung berstatus
// RECEIVED (lihat backend unitProvisioning.js), jadi Order.status-nya juga
// TIDAK PERNAH bernilai PENDING/PICKUP untuk kategori ini — timeline visual
// mengikuti kenyataan itu, bukan cuma memotong tampilan di atas data yang
// sebenarnya masih 5 tahap.
// SHIPPING (5 Sep 2026) disisipkan setelah READY — order BARU tetap lewat
// tahap "sedang di jalan diantar" seperti LAYANAN, cuma tidak lewat PICKUP.
const BARU_STEPS = ["PROCESSING", "READY", "SHIPPING", "DELIVERED"];

// Job aktif (kalau ada) ditumpangkan sebagai baris kecil di bawah timeline —
// cuma untuk status yang benar-benar berarti "sedang terjadi", bukan
// UNSCHEDULED/COMPLETED yang sudah terwakili oleh posisi titik Order itu
// sendiri.
const JOB_LIVE_STATUSES = new Set(["EN_ROUTE", "ARRIVED"]);

export default function DeliveryTimeline({ orderStatus, orderCategory, job, className }) {
  if (orderStatus === "CANCELLED") {
    return (
      <div className={cn("rounded-btn bg-redbg px-3 py-2 text-[11.5px] font-semibold text-red", className)}>
        Order dibatalkan
      </div>
    );
  }

  const steps = orderCategory === "BARU" ? BARU_STEPS : STEPS;
  const activeIndex = steps.indexOf(orderStatus);
  const liveJob = job && JOB_LIVE_STATUSES.has(job.status) ? job : null;

  return (
    <div className={className}>
      <div className="flex items-center">
        {steps.map((step, i) => {
          const done = activeIndex >= 0 && i < activeIndex;
          const current = i === activeIndex;
          return (
            <React.Fragment key={step}>
              {i > 0 && (
                <div className={cn("h-[2px] flex-1", done || current ? "bg-brand-500" : "bg-inset")} />
              )}
              <div className="flex flex-col items-center gap-1" style={{ minWidth: 0 }}>
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    current ? "bg-brand-500 ring-4 ring-brand-100 animate-pulse" : done ? "bg-brand-500" : "bg-inset"
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "whitespace-nowrap text-[9.5px] font-medium",
                    current ? "font-bold text-brand-700" : done ? "text-ink2" : "text-ink3"
                  )}
                >
                  {ORDER_STATUS_LABELS[step]}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {liveJob && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-brand-700">
          <Truck size={12} className="shrink-0" />
          {JOB_STATUS_REAL[liveJob.status]?.label || liveJob.status}
          {liveJob.driverName ? ` — ${liveJob.driverName}` : ""}
        </p>
      )}
    </div>
  );
}
