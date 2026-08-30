import React from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, ShoppingCart, GitBranch } from "lucide-react";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import IconTile from "@/components/ui/icon-tile.jsx";
import { formatRupiahShort, STAGE_LABELS } from "@/utils/format.js";
import { formatRelatif } from "@/utils/formatDate.js";

// ─── RECENT ACTIVITY ─────────────────────────────────────────────────────────
// Padanan "Recent activity" di command center lama (DivisionPage.jsx, /portal/
// growth) — di sana SENGAJA cuma empty state jujur karena backend belum py
// datanya (lihat komentar panjang di file itu). Sekarang beneran ADA:
// GET /analytics/recent-activity gabungan order baru + lead baru + perpindahan
// pipeline, diurutkan waktu. Dipindah ke Dashboard (30 Agustus 2026) supaya
// klik kartu workspace di Main Hub bisa langsung ke Dashboard tanpa mampir
// command center dulu — lihat catatan di Portal.jsx.
const JENIS = {
  order: { Icon: ShoppingCart, depth: 3 },
  lead:  { Icon: UserPlus,     depth: 1 },
  stage: { Icon: GitBranch,    depth: 2 },
};

function teksAktivitas(item) {
  switch (item.type) {
    case "order": {
      const nama = item.categoryLabel || "Order";
      return {
        judul: item.customerName,
        sub: `${nama} baru${item.value ? ` · ${formatRupiahShort(item.value)}` : ""}`,
      };
    }
    case "lead":
      return { judul: item.customerName, sub: "Lead baru masuk" };
    case "stage":
      return {
        judul: item.customerName,
        sub: `${STAGE_LABELS[item.fromStage] || item.fromStage} → ${STAGE_LABELS[item.toStage] || item.toStage}`,
      };
    default:
      return { judul: item.customerName || "Aktivitas", sub: "" };
  }
}

export default function RecentActivityCard({ items = [], loading, error }) {
  const navigate = useNavigate();
  const list = (Array.isArray(items) ? items : []).slice(0, 8);

  return (
    <SectionCard title="Recent Activity">
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="t-secondary py-8 text-center">Gagal memuat aktivitas.</p>
      ) : list.length === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada aktivitas terbaru.</p>
      ) : (
        <div className="flex flex-col">
          {list.map((item) => {
            const j = JENIS[item.type] || JENIS.lead;
            const { judul, sub } = teksAktivitas(item);
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => item.customerId && navigate(`/customers?id=${item.customerId}`)}
                disabled={!item.customerId}
                className="-mx-2 flex items-center gap-3 rounded-btn px-2 py-2.5 text-left transition-colors hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <IconTile icon={j.Icon} depth={j.depth} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="t-body truncate font-semibold">{judul}</p>
                  <p className="truncate text-[13px] text-ink/75">{sub}</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-ink/65">
                  {formatRelatif(item.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
