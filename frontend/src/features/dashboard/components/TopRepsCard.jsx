import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Avatar from "@/components/Avatar.jsx";
import RankBadge from "@/components/ui/rank-badge.jsx";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import { toApiParams } from "@/lib/dateRange.js";

// ─── TOP PERFORMING REPS ─────────────────────────────────────────────────────
// DS v2.4: periode SENDIRI (PeriodMenu) DIHAPUS — mengikuti SATU date picker
// di header Dashboard lewat prop `range` (sama seperti Sales Overview & Deal
// Pipeline); kolom "% target" tetap tidak ada karena target bulanan tidak
// bermakna untuk rentang sembarang — diganti Closing Rate.
//
// BUG YANG DIPERBAIKI (28 Jul 2026): sumber data SEBELUMNYA /analytics/
// cs-performance — `closingRate` di situ = % PERCAKAPAN berstatus RESOLVED,
// metrik operasional CS (chat sudah "beres ditangani"), BUKAN metrik closing
// SALES. Sales bisa saja SUDAH closing order hari ini tapi chat-nya tetap
// terbuka (customer lanjut chat soal pengiriman dll) — tampil "Rp4.740.000,
// 0% closing" yang membingungkan karena dua angka itu kelihatan berkaitan
// padahal dari 2 definisi berbeda total. Sekarang pakai /analytics/
// sales-report (endpoint yang sama dipakai Laporan > Sales Report,
// SalesReportTab.jsx).
//
// REVISI 25 Agustus 2026: ganti dari `orderConversionRate` ke
// `conversionRate` — metrik UTAMA sekarang berbasis TRANSISI pipeline
// (pindah ke stage TRANSACTION dalam periode / percakapan ditangani dalam
// periode, SPAM dikecualikan), lebih akurat & konsisten dengan pipelineStage
// sebagai sumber kebenaran funnel (restrukturisasi 7→4 stage 24 Agt 2026).
// `orderConversionRate` (order benar-benar dibuat) tetap ada sebagai metrik
// sekunder di SalesReportTab, cuma tidak dipakai di widget ringkas ini.
export default function TopRepsCard({ range }) {
  const navigate = useNavigate();
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["sales-report", params],
    queryFn: () => api.getSalesReport(params),
    staleTime: 60_000,
  });

  const rows = [...(Array.isArray(q.data?.rows) ? q.data.rows : [])]
    .sort((a, b) => (b.grossValue || 0) - (a.grossValue || 0))
    .slice(0, 5);

  return (
    <SectionCard
      title="Top Performing Reps"
      footer={<ViewAllLink onClick={() => navigate("/laporan")}>Lihat semua sales</ViewAllLink>}
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className="t-secondary py-8 text-center">Gagal memuat data sales.</p>
      ) : rows.length === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada data performa sales pada periode ini.</p>
      ) : (
        <div className="flex flex-col">
          {/* BUG YANG DIPERBAIKI (26 Agustus 2026) — kelas bug sama dengan
              BarRow.jsx: RankBadge(24px)+Avatar(32px)+nilai Rupiah(~100px)+
              w-24(96px) + 4 gap sudah ~280px+ SEBELUM nama dapat ruang, jadi
              `flex-1 truncate` pada nama terjepit sampai cuma sisa beberapa
              huruf di layar HP. Default (mobile) tumpuk 2 baris (rank+avatar+
              nama dulu, nilai+konversi di bawahnya); sm: ke atas kembali satu
              baris — urutan DOM di sini KEBETULAN sudah = urutan visual yang
              diinginkan, jadi cukup `sm:contents` tanpa perlu `sm:order-*`. */}
          {rows.map((r, i) => (
            <div key={r.userId} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-2.5">
              <div className="flex items-center gap-2.5 sm:contents">
                <RankBadge rank={i + 1} />
                <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                <span className="t-body min-w-0 flex-1 truncate font-medium">{r.name}</span>
              </div>
              <div className="flex items-center justify-between gap-2 sm:contents">
                <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {formatRupiah(r.grossValue || 0)}
                </span>
                <span className="t-secondary shrink-0 text-right text-[11px] tabular-nums sm:w-24">
                  {r.conversionRate == null ? "—" : `${r.conversionRate}%`} closing
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
