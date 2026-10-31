import React from "react";
import { useNavigate } from "react-router-dom";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { MiniTile, IkApi } from "./MiniIkon.jsx";
import { formatRupiahShort, STAGE_LABELS } from "@/utils/format.js";

// "Hot Leads" — lead dengan sinyal beli. Data, skor, dan tujuan klik tidak berubah (ke percakapan bila ada, kalau tidak ke Pipeline).
// Tampilan (redesain 31 Okt 2026): baris 1 = nama (ruang terbesar) + nilai/skor; baris 2 = badge tahap + keterangan singkat.
// Ubin api berwarna oranye hanya untuk skor ≥ 55 (warna pendukung selektif), selainnya biru.
export default function HotLeadsCard({ items = [], loading, error }) {
  const navigate = useNavigate();
  const list = (Array.isArray(items) ? items : []).slice(0, 4);

  function bukaLead(l) {
    if (l.conversationId) navigate(`/inbox?conv=${l.conversationId}`);
    else navigate("/pipeline");
  }

  return (
    <SectionCard
      title="Hot Leads"
      footer={<ViewAllLink onClick={() => navigate("/pipeline")}>Buka Pipeline</ViewAllLink>}
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="crm-kosong">Gagal memuat lead panas.</p>
      ) : list.length === 0 ? (
        <p className="crm-kosong" data-testid="hot-leads-kosong">Belum ada lead dengan sinyal beli.</p>
      ) : (
        <div className="crm-daftar" data-testid="hot-leads-daftar">
          {list.map((l) => (
            <button key={l.id} type="button" onClick={() => bukaLead(l)} className="crm-baris crm-baris--dua">
              <MiniTile tone={(l.score || 0) >= 55 ? "orange" : "blue"} Ikon={IkApi} />
              <span className="crm-baris-teks">
                <span className="crm-baris-atas">
                  <span className="crm-baris-judul">{l.name}</span>
                  <span className="crm-baris-nilai">{l.valueEstimate ? formatRupiahShort(l.valueEstimate) : `${l.score}`}</span>
                </span>
                <span className="crm-baris-bawah">
                  <Badge variant="accent" className="shrink-0">{STAGE_LABELS[l.stage] || l.stage}</Badge>
                  <span className="crm-baris-sub">{l.reason}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
