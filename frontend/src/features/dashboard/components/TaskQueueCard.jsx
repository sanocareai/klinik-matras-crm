import React from "react";
import { useNavigate } from "react-router-dom";
import { Phone, Mail, CalendarDays, CheckSquare, Clock } from "lucide-react";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import IconTile from "@/components/ui/icon-tile.jsx";
import { formatDurasiRelatif } from "@/utils/format.js";

// Ikon + kedalaman ubin per jenis antrean. Kedalaman dipakai untuk membedakan
// jenis TANPA memakai hue berbeda — inti aturan "seragam biru, beda kedalaman".
const JENIS = {
  balas:     { Icon: Phone,        depth: 4, label: "Balas chat" },
  ambil:     { Icon: CheckSquare,  depth: 3, label: "Ambil & balas" },
  followup:  { Icon: Mail,         depth: 2, label: "Follow-up" },
  jadwal:    { Icon: CalendarDays, depth: 1, label: "Jadwalkan" },
};

function jenisDari(t) {
  if (t.unassigned) return "ambil";
  if ((t.waitingMinutes || 0) >= 1440) return "balas";
  return "followup";
}

// ─── ANTREAN TUGAS ───────────────────────────────────────────────────────────
// Padanan "Upcoming Tasks" di referensi. Sumber datanya /analytics/follow-ups
// (percakapan yang menunggu balasan) — itu satu-satunya "tugas" nyata yang
// dimiliki sistem ini; TIDAK ada modul task terpisah, jadi tidak dibuat-buat.
export default function TaskQueueCard({ items = [], loading, error }) {
  const navigate = useNavigate();
  const list = (Array.isArray(items) ? items : []).slice(0, 4);

  return (
    <SectionCard
      title="Perlu Ditindak"
      footer={<ViewAllLink onClick={() => navigate("/inbox")}>Buka Inbox</ViewAllLink>}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="t-secondary py-8 text-center">Gagal memuat antrean.</p>
      ) : list.length === 0 ? (
        <p className="t-secondary py-8 text-center">Semua chat sudah dibalas 👍</p>
      ) : (
        <div className="flex flex-col">
          {list.map((t) => {
            const j = JENIS[jenisDari(t)] || JENIS.followup;
            return (
              <button
                key={t.id}
                onClick={() => navigate("/inbox")}
                className="-mx-2 flex items-center gap-3 rounded-btn px-2 py-2.5 text-left transition-colors hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <IconTile icon={j.Icon} depth={j.depth} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="t-body truncate font-medium">{t.customerName}</p>
                  <p className="t-secondary truncate">{t.nextAction || j.label}</p>
                </div>
                <span className="t-secondary flex shrink-0 items-center gap-1 text-[11px] tabular-nums">
                  <Clock size={11} />
                  {formatDurasiRelatif(t.waitingMinutes)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
