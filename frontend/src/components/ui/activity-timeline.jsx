import React from "react";
import { formatTanggalJam } from "@/utils/formatDate.js";

// Linimasa aktivitas GENERIK (Production Core Slice 1) — presentasional
// murni, dipakai bersama GET /api/activity. `formatSentence` diinjeksikan
// pemanggil (lihat features/bengkel/activityFeed.js) supaya komponen ini
// tidak perlu tahu bentuk metadata per eventType — cuma menyusun kalimat +
// waktu + aktor jadi daftar.
export function ActivityTimeline({ events, formatSentence, emptyLabel = "Belum ada aktivitas tercatat." }) {
  if (!events || events.length === 0) {
    return <p className="px-4 py-3 text-[12px] text-ink3">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="px-4 py-2.5 text-[12px]">
          <p className="text-ink">{formatSentence(e)}</p>
          <p className="mt-0.5 text-[10.5px] text-ink3">
            {formatTanggalJam(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
