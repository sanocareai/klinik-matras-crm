import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, ShoppingCart, GitBranch, ChevronDown } from "lucide-react";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import IconTile from "@/components/ui/icon-tile.jsx";
import { MiniTile, IkAlur } from "./MiniIkon.jsx";
import { IkonTas, IkonOrang } from "./KpiTile.jsx";
import { formatRupiahShort, STAGE_LABELS } from "@/utils/format.js";
import { formatRelatif } from "@/utils/formatDate.js";

const JENIS = {
  order: { Icon: ShoppingCart, depth: 3, Ikon: IkonTas,   tone: "green" },
  lead:  { Icon: UserPlus,     depth: 1, Ikon: IkonOrang, tone: "blue" },
  stage: { Icon: GitBranch,    depth: 2, Ikon: IkAlur,    tone: "indigo" },
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

// Batas awal daftar ringkas Dashboard Sales CRM; sisanya dibuka lewat "Lihat semua" (data tidak dibuang).
const AWAL = 5;

// `ringkas` (OPSIONAL, default false — Portal & ReadinessPanel memakai kartu ini dan TIDAK berubah): daftar padat ikon · nama · aktivitas · waktu,
// lima teratas dulu, "Lihat semua" membuka seluruh data yang dimuat (tanpa tinggi minimum / padding berlebih).
export default function RecentActivityCard({ items = [], loading, error, ringkas = false }) {
  const navigate = useNavigate();
  const [semua, setSemua] = useState(false);
  const data = Array.isArray(items) ? items : [];
  const list = ringkas ? data : data.slice(0, 8);
  const tampil = ringkas && !semua ? list.slice(0, AWAL) : list;
  const adaSisa = ringkas && list.length > AWAL;

  if (ringkas) {
    return (
      <SectionCard
        title="Recent Activity"
        footer={adaSisa ? (
          <button type="button" className="crm-lihat-semua" aria-expanded={semua} onClick={() => setSemua((v) => !v)} data-testid="aktivitas-toggle">
            {semua ? "Tampilkan lebih sedikit" : `Lihat semua (${list.length})`}
            <ChevronDown size={15} className={semua ? "crm-putar" : undefined} aria-hidden="true" />
          </button>
        ) : undefined}
      >
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-btn" />)}
          </div>
        ) : error ? (
          <p className="crm-kosong">Gagal memuat aktivitas.</p>
        ) : list.length === 0 ? (
          <p className="crm-kosong" data-testid="aktivitas-kosong">Belum ada aktivitas terbaru.</p>
        ) : (
          <div className="crm-daftar" data-testid="aktivitas-daftar">
            {tampil.map((item) => {
              const j = JENIS[item.type] || JENIS.lead;
              const { judul, sub } = teksAktivitas(item);
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => item.customerId && navigate(`/customers?id=${item.customerId}`)}
                  disabled={!item.customerId}
                  className="crm-baris"
                >
                  <MiniTile tone={j.tone} Ikon={j.Ikon} />
                  <span className="crm-baris-teks">
                    <span className="crm-baris-judul">{judul}</span>
                    <span className="crm-baris-sub">{sub}</span>
                  </span>
                  <span className="crm-baris-waktu">{formatRelatif(item.createdAt)}</span>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>
    );
  }

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
