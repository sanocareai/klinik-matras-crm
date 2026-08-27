import React, { useEffect, useState } from "react";
import { RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Award, AlertCircle } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";

// ═══ SALES PERFORMANCE INTELLIGENCE — 27 Agustus 2026 ═════════════════════
// Agregasi Quality Scorer + Sales Risk Engine + SLA/response-time. TIDAK
// ADA skor AI baru dihitung di halaman ini — semua angka berasal dari 3
// sistem yang sudah ada, digabung di backend (services/salesPerformance/).
const DAYS_OPTIONS = [7, 30, 90];

function HealthBadge({ score }) {
  if (score == null) return <span className="text-[12px] text-ink3">Belum ada data</span>;
  const tone = score >= 75 ? "bg-green/10 text-green" : score >= 50 ? "bg-orange/10 text-orange" : "bg-red/10 text-red";
  return <span className={cn("inline-block rounded-full px-3 py-1 text-[13px] font-bold tabular-nums", tone)}>{score}</span>;
}

function TrendBadge({ trend }) {
  if (trend == null) return <span className="text-[11px] text-ink3">—</span>;
  const naik = trend > 0;
  const flat = trend === 0;
  const Icon = flat ? Minus : naik ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums", flat ? "text-ink3" : naik ? "text-green" : "text-red")}>
      <Icon size={13} />{naik ? "+" : ""}{trend}
    </span>
  );
}

// Sparkline sederhana (bar) utk 6 titik mingguan — TIDAK menambah dependency
// chart baru, cukup div biasa. Tinggi relatif thd skor maks 5.
function TrendSparkline({ points }) {
  if (!points || points.every((p) => p.overallAvg == null)) {
    return <p className="text-[11px] text-ink3">Belum cukup data utk tren.</p>;
  }
  return (
    <div className="flex items-end gap-1" style={{ height: 36 }}>
      {points.map((p, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${p.overallAvg ?? "-"}/5`}>
          <div
            className={cn("w-full rounded-sm", p.overallAvg == null ? "bg-inset" : p.overallAvg >= 4 ? "bg-green" : p.overallAvg >= 3 ? "bg-accent" : "bg-red")}
            style={{ height: p.overallAvg == null ? 4 : Math.max(4, (p.overallAvg / 5) * 32) }}
          />
        </div>
      ))}
    </div>
  );
}

function RiskMiniBadges({ counts }) {
  const parts = [];
  if (counts.CRITICAL > 0) parts.push({ label: `${counts.CRITICAL} kritis`, tone: "text-red" });
  if (counts.HIGH > 0) parts.push({ label: `${counts.HIGH} tinggi`, tone: "text-orange" });
  if (counts.MEDIUM > 0) parts.push({ label: `${counts.MEDIUM} sedang`, tone: "text-ink3" });
  if (parts.length === 0) return <span className="text-[12px] text-green">Tidak ada risiko aktif</span>;
  return (
    <span className="flex flex-wrap gap-2 text-[12px] font-semibold">
      {parts.map((p, i) => <span key={i} className={p.tone}>{p.label}</span>)}
    </span>
  );
}

function ProfileCard({ profile }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <HealthBadge score={profile.healthScore} />
        <span className="min-w-[120px] flex-1 font-semibold text-ink">{profile.name}</span>
        <span className="text-[11px] text-ink3">{profile.sampleCount} percakapan dinilai</span>
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Skor Kualitas Percakapan</p>
              <div className="flex items-center gap-2">
                <span className="font-bold tabular-nums text-ink">{profile.qualityScore != null ? `${profile.qualityScore}/5` : "—"}</span>
                <TrendBadge trend={profile.qualityTrend} />
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Kontribusi Risiko Pelanggan</p>
              <RiskMiniBadges counts={profile.riskContribution} />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Disiplin Waktu Respons</p>
              <p className="text-[12.5px] text-ink2">
                {profile.slaDiscipline.avgResponseMinutes != null ? `Rata-rata balas ${profile.slaDiscipline.avgResponseMinutes} menit` : "Belum ada data"}
                {profile.slaDiscipline.slaBreachRate != null && ` · ${profile.slaDiscipline.slaBreachRate}% percakapan lewat SLA`}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Tren 6 Minggu Terakhir</p>
              <TrendSparkline points={profile.skillTrend} />
            </div>
          </div>

          <div className="flex flex-col gap-3 text-[12.5px]">
            {profile.strength && (
              <div className="rounded-btn bg-green/10 p-3">
                <p className="mb-0.5 font-bold text-green">Kekuatan</p>
                <p className="text-ink2">{profile.strength.label} ({profile.strength.avg}/5)</p>
              </div>
            )}
            {profile.weakness && (
              <div className="rounded-btn bg-red/10 p-3">
                <p className="mb-0.5 font-bold text-red">Perlu Diperbaiki</p>
                <p className="text-ink2">{profile.weakness.label} ({profile.weakness.avg}/5)</p>
              </div>
            )}
            {profile.recommendedTraining && (
              <div>
                <Badge variant="brand">Rekomendasi Training: {profile.recommendedTraining}</Badge>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSummary({ team, totalSales }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ringkasan Tim</CardTitle>
        <CardDescription>{team.coachingRecommendation}</CardDescription>
      </CardHeader>
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-3">
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink3">Rata-rata Tim</p>
          <HealthBadge score={team.averageHealthScore} />
        </div>
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink3 flex items-center gap-1"><Award size={12} /> Top Performer</p>
          <p className="font-semibold text-ink">{team.topPerformer?.name || "—"}</p>
        </div>
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink3 flex items-center gap-1"><AlertCircle size={12} /> Butuh Perhatian</p>
          <p className="font-semibold text-ink">
            {team.needsAttention.length ? team.needsAttention.map((p) => p.name).join(", ") : "Tidak ada"}
          </p>
        </div>
      </div>
      {team.skillGapDistribution.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {team.skillGapDistribution.map((g) => (
            <Badge key={g.module} variant="neutral">{g.module}: {g.count} sales</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function SalesPerformance() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.getSalesIntelligence({ days })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageContainer>
      <PageHeader
        title="Sales Performance Intelligence"
        subtitle="Siapa butuh coaching, kenapa, dan harus belajar apa — gabungan Quality Scorer, Sales Risk Engine, dan disiplin SLA."
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-lg bg-inset p-0.5">
              {DAYS_OPTIONS.map((d) => (
                <button
                  key={d} type="button" onClick={() => setDays(d)}
                  className={cn("rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors", days === d ? "bg-surface text-ink shadow-card" : "text-ink3 hover:text-ink2")}
                >{d} hari</button>
              ))}
            </div>
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
            <TeamSummary team={data.team} totalSales={data.individual.length} />
            <div className="flex flex-col gap-3">
              {data.individual.length === 0 ? (
                <Card><p className="py-8 text-center text-sm text-ink3">Tidak ada sales aktif.</p></Card>
              ) : (
                data.individual.map((p) => <ProfileCard key={p.userId} profile={p} />)
              )}
            </div>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
