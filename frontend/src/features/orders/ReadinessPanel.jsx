import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Ban, MessageSquare, UserRound } from "lucide-react";
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
//
// Cuma DUA status (disederhanakan 7 Sep 2026) — READY atau BLOCKED, tidak
// ada lagi tingkat "perlu info" (dulu khusus pembayaran, sekarang dianggap
// duplikat kolom Status Pembayaran yang sudah ada sendiri).
export default function ReadinessPanel({ order, onOpenChat }) {
  const navigate = useNavigate();
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

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="rounded-xl bg-redbg p-3"
    >
      <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-red">
        <Ban size={14} className="shrink-0" />
        Belum bisa diserahkan ke Delivery & Fulfillment
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {hasil.missingBlockers.map((r) => (
          <li key={r.key} className="flex items-center gap-1.5 text-[12px] text-ink">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
            {r.label}
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {order.customerId && (
          // Navigasi DALAM APLIKASI YANG SAMA (bukan tab/window baru) — pola
          // yang sama dengan RecentActivityCard.jsx & Pipeline.jsx. Sebelumnya
          // ini pakai <a target="_blank">, yang di PWA/Capacitor terbuka
          // sebagai JENDELA APLIKASI TERPISAH (bukan tab browser biasa),
          // kelihatan seperti dua app beda — ditemukan lewat laporan owner.
          <button
            type="button"
            onClick={() => navigate(`/customers?id=${order.customerId}`)}
            className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 shadow-card transition-colors hover:text-ink"
          >
            <UserRound size={12} /> Lengkapi di profil pelanggan
          </button>
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
