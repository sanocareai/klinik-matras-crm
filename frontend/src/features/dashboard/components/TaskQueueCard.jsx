import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, CheckCircle2 } from "lucide-react";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { MiniTile, IkChat, IkNampan, IkLonceng } from "./MiniIkon.jsx";
import { formatDurasiRelatif } from "@/utils/format.js";

// "Needs Action" — antrean chat yang menunggu tindakan. Sumber data & aturan jenis (balas / ambil / follow-up) tidak berubah;
// tampilan (redesain 31 Okt 2026): baris ringkas ikon · nama + tindakan · waktu. Tinggi kartu mengikuti isi (tidak dipaksa
// setinggi Hot Leads — lihat .crm-bawah di styles/sanss-crm-dashboard.css).
const JENIS = {
  balas:    { Ikon: IkChat,    tone: "orange", label: "Balas chat" },
  ambil:    { Ikon: IkNampan,  tone: "indigo", label: "Ambil & balas" },
  followup: { Ikon: IkLonceng, tone: "blue",   label: "Follow-up" },
};

function jenisDari(t) {
  if (t.unassigned) return "ambil";
  if ((t.waitingMinutes || 0) >= 1440) return "balas";
  return "followup";
}

export default function TaskQueueCard({ items = [], loading, error }) {
  const navigate = useNavigate();
  const list = (Array.isArray(items) ? items : []).slice(0, 4);

  return (
    <SectionCard
      title="Needs Action"
      footer={<ViewAllLink onClick={() => navigate("/inbox")}>Buka Inbox</ViewAllLink>}
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="crm-kosong">Gagal memuat antrean.</p>
      ) : list.length === 0 ? (
        <p className="crm-kosong" data-testid="needs-action-kosong"><CheckCircle2 size={16} aria-hidden="true" /> Semua chat sudah dibalas</p>
      ) : (
        <div className="crm-daftar" data-testid="needs-action-daftar">
          {list.map((t) => {
            const j = JENIS[jenisDari(t)] || JENIS.followup;
            return (
              <button key={t.id} type="button" onClick={() => navigate(`/inbox?conv=${t.id}`)} className="crm-baris">
                <MiniTile tone={j.tone} Ikon={j.Ikon} />
                <span className="crm-baris-teks">
                  <span className="crm-baris-judul">{t.customerName}</span>
                  <span className="crm-baris-sub">{t.nextAction || j.label}</span>
                </span>
                <span className="crm-baris-waktu"><Clock size={11} aria-hidden="true" />{formatDurasiRelatif(t.waitingMinutes)}</span>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
