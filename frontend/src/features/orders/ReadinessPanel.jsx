import React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Ban, MessageSquare, UserRound } from "lucide-react";
import { evaluateReadiness, READINESS } from "@/utils/orderReadiness.js";
import { cn } from "@/lib/utils.js";

// Panel "kenapa order ini belum siap diserahkan ke Delivery & Fulfillment" —
// dipakai di tab Status OrderTimelineDrawer, DI ATAS riwayat status, supaya
// jadi hal PERTAMA yang dilihat sales kalau order-nya bermasalah.
//
// Quick action realistis di codebase ini cuma DUA (bukan mengarang tombol
// edit yang belum ada): buka profil pelanggan (form order/edit lengkap ada
// di sana, lewat OrderSection.jsx) dan buka chat customer — dua-duanya
// sudah jalur navigasi yang ADA, bukan fitur baru.
export default function ReadinessPanel({ order, onOpenChat }) {
  const hasil = evaluateReadiness(order);
  if (!hasil) return null; // CANCELLED — tidak relevan dinilai

  if (hasil.state === READINESS.READY) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-greenbg px-3 py-2.5 text-[12.5px] font-semibold text-green">
        <CheckCircle2 size={15} className="shrink-0" />
        Siap diserahkan ke Delivery & Fulfillment
      </div>
    );
  }

  const Icon = hasil.state === READINESS.BLOCKED ? Ban : AlertTriangle;
  const warna = hasil.state === READINESS.BLOCKED
    ? { bg: "bg-redbg", text: "text-red" }
    : { bg: "bg-orangebg", text: "text-orange" };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={cn("rounded-xl p-3", warna.bg)}
    >
      <p className={cn("flex items-center gap-1.5 text-[12.5px] font-bold", warna.text)}>
        <Icon size={14} className="shrink-0" />
        {hasil.state === READINESS.BLOCKED
          ? "Belum bisa diserahkan ke Delivery & Fulfillment"
          : "Bisa diserahkan, tapi ada yang perlu dilengkapi"}
      </p>

      {hasil.missingBlockers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {hasil.missingBlockers.map((r) => (
            <li key={r.key} className="flex items-center gap-1.5 text-[12px] text-ink">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
              {r.label} belum diisi
            </li>
          ))}
        </ul>
      )}
      {hasil.missingWarnings.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {hasil.missingWarnings.map((r) => (
            <li key={r.key} className="flex items-center gap-1.5 text-[12px] text-ink2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
              {r.label} belum diisi
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {order.customerId && (
          <a
            href={`/customers?id=${order.customerId}`}
            target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 shadow-card transition-colors hover:text-ink"
          >
            <UserRound size={12} /> Lengkapi di profil pelanggan
          </a>
        )}
        {order.conversationId && (
          <button
            type="button"
            onClick={() => onOpenChat?.(order)}
            className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 shadow-card transition-colors hover:text-ink"
          >
            <MessageSquare size={12} /> Chat pelanggan
          </button>
        )}
      </div>
    </motion.div>
  );
}
