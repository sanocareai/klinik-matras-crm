import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

// Header section per severity (29 Agustus 2026) — 3 tingkat warna dari HANYA
// 2 hue yang sudah ada (red/orange, lihat badge.jsx: cuma 4 hue diizinkan di
// seluruh sistem, tidak ada hue kuning/amber terpisah). Kritis=merah solid,
// Tinggi=oranye solid (2 tone SAMA PERSIS dgn TIER_LABEL di atas), Sedang=
// oranye TINT lembut (bg-orangebg/text-orange, pola sama dgn Badge
// variant="orange" biasa) — bukan "kuning muda" literal spt diminta ticket,
// karena token itu tidak ada; ini kompromi tergradasi (solid->solid->tint)
// yang tetap keliatan beda 3 tingkat TANPA bikin warna baru. Dijelaskan di
// laporan, bukan diam-diam menyimpang dari spec.
const SEVERITY_SECTION = {
  CRITICAL: { label: "Kritis", headerClass: "bg-red text-white" },
  HIGH: { label: "Tinggi", headerClass: "bg-orange text-white" },
  MEDIUM: { label: "Sedang", headerClass: "bg-orangebg text-orange" },
};
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM"];

// Pill filter (29 Agustus 2026) — state LOKAL (bukan query param spt salesId)
// krn ticket cuma minta "klik untuk filter", tidak minta persist/shareable
// URL utk severity. Dikombinasikan dgn salesId yang SUDAH di query param
// (filter di sini murni di atas `data.risks` yang sudah datang ter-scope
// salesId dari backend — 2 filter berbeda lapisan, tidak saling ganti).
const SEVERITY_TABS = [
  { key: "ALL", label: "Semua" },
  { key: "CRITICAL", label: "Kritis" },
  { key: "HIGH", label: "Tinggi" },
  { key: "MEDIUM", label: "Sedang" },
];

function TierBadge({ tier }) {
  const t = TIER_LABEL[tier] || TIER_LABEL.LOW;
  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold", t.tone)}>{t.text}</span>;
}

// Hari sejak pesan customer TERAKHIR (evidence.lastInboundAt, sudah ada di
// payload) — dipakai tampilkan "hari stagnan" di kartu. Pola sama dgn
// daysStagnant() di SalesPerformance.jsx — diduplikasi LOKAL (bukan
// diekstrak ke util bersama) supaya perubahan ini tetap terkurung di 1
// file sesuai stop condition ticket ("jangan ubah halaman di luar
// SalesRisk.jsx").
function daysStagnant(risk) {
  const at = risk?.evidence?.lastInboundAt;
  if (!at) return null;
  return Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
}

// Kartu diringkas (29 Agustus 2026) — tampilan utama SEKARANG tag pendek
// (risk.problemTags, sudah terstruktur dari backend, BUKAN parsing teks
// bebas thd risk.problem — lihat riskScore.js#explainRisk), bukan kalimat
// penuh berulang. Kalimat lengkap (risk.problem) TETAP ADA, dipindah ke
// dalam expand/detail supaya tidak hilang, cuma tidak lagi mendominasi
// tampilan utama.
function RiskCard({ risk }) {
  const [open, setOpen] = useState(false);
  const days = daysStagnant(risk);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <TierBadge tier={risk.tier} />
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{risk.customerName}</span>
        {days != null && <span className="text-[11px] text-ink3">{days} hari stagnan</span>}
        <span className="text-[11px] text-ink3">{risk.salesOwnerName || "Belum di-assign"}</span>
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>
      {risk.problemTags?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {risk.problemTags.map((tag) => (
            <Badge key={tag} variant="neutral">{tag}</Badge>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-[12.5px]">
          <p className="text-ink2">{risk.problem}</p>
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

// Section per severity — header berwarna (lihat SEVERITY_SECTION), cuma
// dirender kalau ada isinya (severityFilter aktif otomatis mengosongkan
// section lain via `risks` yang sudah difilter di pemanggil).
function SeveritySection({ tier, risks }) {
  if (risks.length === 0) return null;
  const meta = SEVERITY_SECTION[tier];
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-2 rounded-btn px-3 py-1.5", meta.headerClass)}>
        <span className="text-[12px] font-bold uppercase tracking-wide">{meta.label}</span>
        <span className="text-[12px] opacity-90">({risks.length})</span>
      </div>
      <div className="flex flex-col gap-3">
        {risks.map((r) => <RiskCard key={r.customerId} risk={r} />)}
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
  const [severityFilter, setSeverityFilter] = useState("ALL");

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

  // Filter severity DI FRONTEND (data.risks sudah lengkap dari 1x fetch,
  // salesId sudah discope backend) — dikombinasikan, bukan menggantikan.
  const visibleRisks = severityFilter === "ALL" ? (data?.risks || []) : (data?.risks || []).filter((r) => r.tier === severityFilter);
  const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [] };
  for (const r of visibleRisks) bySeverity[r.tier]?.push(r);

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

            <div className="flex flex-wrap items-center gap-0.5 self-start rounded-lg bg-inset p-0.5">
              {SEVERITY_TABS.map((tab) => {
                const count = tab.key === "ALL" ? data.totalAtRisk : (data.severityCounts[tab.key] ?? 0);
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSeverityFilter(tab.key)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                      severityFilter === tab.key ? "bg-surface text-ink shadow-card" : "text-ink3 hover:text-ink2"
                    )}
                  >
                    {tab.label} ({count})
                  </button>
                );
              })}
            </div>

            {visibleRisks.length === 0 ? (
              <Card><p className="py-8 text-center text-sm text-ink3">Tidak ada pelanggan berisiko saat ini.</p></Card>
            ) : (
              <div className="flex flex-col gap-4">
                {SEVERITY_ORDER.map((tier) => (
                  <SeveritySection key={tier} tier={tier} risks={bySeverity[tier]} />
                ))}
              </div>
            )}
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
