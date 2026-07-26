import React from "react";
import { useNavigate } from "react-router-dom";
import { Flame } from "lucide-react";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import IconTile from "@/components/ui/icon-tile.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { formatRupiahShort, STAGE_LABELS } from "@/utils/format.js";

// Skor → kedalaman ubin. Makin panas lead-nya, makin pekat birunya. Sekali lagi:
// intensitas lewat KEDALAMAN, bukan lewat ganti warna ke merah/oranye.
function depthDariSkor(s) {
  if (s >= 75) return 4;
  if (s >= 55) return 3;
  if (s >= 35) return 2;
  return 1;
}

// ─── LEAD PANAS ──────────────────────────────────────────────────────────────
// Padanan "Recent Activity" di posisi grid, tapi isinya yang paling berguna
// untuk tim ini: lead dengan sinyal beli tertinggi + alasannya (explainable).
export default function HotLeadsCard({ items = [], loading, error }) {
  const navigate = useNavigate();
  const list = (Array.isArray(items) ? items : []).slice(0, 4);

  return (
    <SectionCard
      title="Lead Panas"
      footer={<ViewAllLink onClick={() => navigate("/pipeline")}>Buka Pipeline</ViewAllLink>}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="t-secondary py-8 text-center">Gagal memuat lead panas.</p>
      ) : list.length === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada lead dengan sinyal beli.</p>
      ) : (
        <div className="flex flex-col">
          {list.map((l) => (
            <button
              key={l.id}
              onClick={() => navigate("/pipeline")}
              className="-mx-2 flex items-center gap-3 rounded-btn px-2 py-2.5 text-left transition-colors hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <IconTile icon={Flame} depth={depthDariSkor(l.score)} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="t-body truncate font-medium">{l.name}</p>
                  <Badge variant="accent">{STAGE_LABELS[l.stage] || l.stage}</Badge>
                </div>
                {/* `reason` dari backend = penjelasan kenapa dia dianggap panas.
                    Ditampilkan supaya skornya tidak terasa seperti angka buram. */}
                <p className="t-secondary truncate">{l.reason}</p>
              </div>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-accent">
                {l.valueEstimate ? formatRupiahShort(l.valueEstimate) : `${l.score}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
