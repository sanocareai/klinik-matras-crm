import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw, ChevronDown, ChevronUp, X } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";

// ═══ PELANGGAN BERISIKO — laporan utk owner/supervisor ═══════════════════
// SENGAJA bahasa bisnis polos di seluruh halaman ini — TIDAK ADA kata
// "skor"/"sinyal"/"AI"/"engine" di teks yang tampil ke user. Angka skor
// tetap dikirim backend (dipakai urutan), tapi HANYA badge tingkat risiko
// (Kritis/Tinggi/Sedang) yang ditampilkan, bukan angkanya.
const TIER_LABEL = {
  CRITICAL: { text: "Kritis", tone: "bg-red text-white" },
  HIGH: { text: "Tinggi", tone: "bg-orange text-white" },
  MEDIUM: { text: "Sedang", tone: "bg-inset text-ink2" },
  LOW: { text: "Rendah", tone: "bg-inset text-ink3" },
};

function TierBadge({ tier }) {
  const t = TIER_LABEL[tier] || TIER_LABEL.LOW;
  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold", t.tone)}>{t.text}</span>;
}

function RiskCard({ risk }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <TierBadge tier={risk.tier} />
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{risk.customerName}</span>
        <span className="text-[11px] text-ink3">{risk.salesOwnerName || "Belum di-assign"}</span>
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>
      <p className="mt-2 text-[13px] text-ink2">{risk.problem}</p>

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-[12.5px]">
          <div><span className="font-semibold text-ink2">Bukti: </span>
            <span className="text-ink3">
              {risk.evidence.waitingDuration ? `Menunggu ${risk.evidence.waitingDuration}` : "Sudah dibalas"}
              {risk.evidence.unansweredCount > 0 ? ` · ${risk.evidence.unansweredCount} pesan belum dijawab` : ""}
            </span>
          </div>
          {risk.evidence.quote && (
            <p className="rounded-btn bg-inset p-2 italic text-ink3">"{risk.evidence.quote}"</p>
          )}
          <div><span className="font-semibold text-ink2">Tindakan disarankan: </span><span className="text-ink3">{risk.recommendedAction}</span></div>
          {risk.trainingModuleHint && (
            <div><Badge variant="neutral">Rekomendasi Training: {risk.trainingModuleHint}</Badge></div>
          )}
        </div>
      )}
    </div>
  );
}

function SalesOwnerSummary({ group }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-btn bg-inset p-3">
      <span className="font-semibold text-ink">{group.salesOwnerName}</span>
      <div className="flex items-center gap-2">
        {group.counts.CRITICAL > 0 && <TierBadge tier="CRITICAL" />}
        {group.counts.CRITICAL > 0 && <span className="text-[12px] text-ink3">{group.counts.CRITICAL} kritis</span>}
        {group.counts.HIGH > 0 && <span className="text-[12px] text-ink3">{group.counts.HIGH} tinggi</span>}
      </div>
    </div>
  );
}

export default function SalesRisk() {
  // ?salesId= (29 Agustus 2026) — deep-link dari drill-down Sales Performance
  // Intelligence hub ("Lihat semua Pelanggan Berisiko →" di baris sales yang
  // di-expand). PRE-FILTER begitu halaman dibuka, BUKAN filter manual yang
  // harus dipilih user lagi setelah pindah halaman — itu bug yang diperbaiki.
  const [searchParams, setSearchParams] = useSearchParams();
  const salesId = searchParams.get("salesId");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.getSalesRisk({ minTier: "MEDIUM", salesId: salesId || undefined })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [salesId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nama sales yang sedang difilter — diambil dari hasil respons (bySalesOwner
  // baris pertama), BUKAN state terpisah yang perlu di-fetch ulang.
  const filteredSalesName = salesId ? (data?.bySalesOwner?.[0]?.salesOwnerName || data?.risks?.[0]?.salesOwnerName) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Pelanggan Berisiko"
        subtitle={
          salesId
            ? `Difilter khusus ${filteredSalesName || "sales ini"} — pelanggan berisiko milik sales lain disembunyikan.`
            : "Pelanggan yang berpotensi hilang karena belum ditindaklanjuti sales — bukan daftar prioritas biasa."
        }
        actions={
          <>
            {salesId && (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                <X size={14} /> Tampilkan Semua Sales
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </>
        }
      />
      <PageBody>
        {loading ? (
          <p className="py-16 text-center text-sm text-ink3">Memuat...</p>
        ) : !data ? (
          <p className="py-16 text-center text-sm text-ink3">Gagal memuat data.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Ringkasan</CardTitle>
                <CardDescription>
                  {data.totalScanned} pelanggan diperiksa · {data.totalAtRisk} butuh perhatian ·
                  {" "}{data.severityCounts.CRITICAL} kritis, {data.severityCounts.HIGH} tinggi, {data.severityCounts.MEDIUM} sedang.
                </CardDescription>
              </CardHeader>
            </Card>

            {data.bySalesOwner.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Per Sales</CardTitle></CardHeader>
                <div className="flex flex-col gap-2 px-4 pb-4">
                  {data.bySalesOwner.map((g) => (
                    <SalesOwnerSummary key={g.salesOwnerId || "unassigned"} group={g} />
                  ))}
                </div>
              </Card>
            )}

            <div className="flex flex-col gap-3">
              {data.risks.length === 0 ? (
                <Card><p className="py-8 text-center text-sm text-ink3">Tidak ada pelanggan berisiko saat ini.</p></Card>
              ) : (
                data.risks.map((r) => <RiskCard key={r.customerId} risk={r} />)
              )}
            </div>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
