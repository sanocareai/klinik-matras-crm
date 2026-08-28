import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Award, AlertCircle } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";

// ═══ SALES PERFORMANCE INTELLIGENCE — hub (28 Agustus 2026) ═══════════════
// Redesign dari kartu-list rata jadi 1 baris/sales (avatar, 3 mini bar
// dimensi, overall, badge risiko ringkas, chevron) — hub utama menu
// Analitik. Quality Scorer (AI) & Pelanggan Berisiko TIDAK dihapus, tetap
// full page tersendiri (linked dari drill-down expand di sini) — halaman
// ini murni AGREGASI PRESENTASI dari 4 endpoint yang SUDAH ADA:
//   - /sales-intelligence  (health/quality/risk/SLA per sales, sudah ada)
//   - /quality-scorer/weekly            (kutipan bukti terbaik/terlemah per dimensi)
//   - /quality-scorer/weekly-narrative  (narasi pola mingguan per sales)
//   - /sales-risk                       (daftar pelanggan kritis/tinggi per sales)
// TIDAK ADA skor/logic baru dihitung di sini — murni join di frontend.
const DAYS_OPTIONS = [7, 30, 90];

// Skala warna KONSISTEN di SELURUH elemen berwarna halaman ini (mini bar
// dimensi, angka overall, rata-rata tim) — >=3.5 hijau, 3.0-3.4 kuning,
// <3.0 merah. Design system (tokens.css) tidak punya hue kuning terpisah
// dari 4 hue tetap (accent/red/orange/green), jadi "kuning" pada spec
// dipetakan ke token --orange yang sudah ada (bukan warna baru).
function scoreTone(score) {
  if (score == null) return "neutral";
  if (score >= 3.5) return "green";
  if (score >= 3.0) return "orange";
  return "red";
}
const TONE_TEXT = { green: "text-green", orange: "text-orange", red: "text-red", neutral: "text-ink3" };
const TONE_BAR = { green: "green", orange: "orange", red: "red", neutral: "accent" };

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

function DimBar({ label, score }) {
  const tone = scoreTone(score);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[92px] shrink-0 text-[11px] text-ink3">{label}</span>
      <ProgressBar value={score != null ? (score / 5) * 100 : 0} variant={TONE_BAR[tone]} className="flex-1" />
      <span className={cn("w-7 shrink-0 text-right text-[11px] font-semibold tabular-nums", TONE_TEXT[tone])}>
        {score != null ? score.toFixed(1) : "—"}
      </span>
    </div>
  );
}

// Badge risiko RINGKAS ("N kritis") — bukan kalimat panjang berulang spt
// halaman Pelanggan Berisiko lama. Prioritas tampil: CRITICAL > HIGH >
// MEDIUM > "Aman" (tidak ada risiko aktif).
function RiskBadge({ counts }) {
  if (!counts) return <Badge variant="neutral">—</Badge>;
  if (counts.CRITICAL > 0) return <Badge variant="red">{counts.CRITICAL} kritis</Badge>;
  if (counts.HIGH > 0) return <Badge variant="orange">{counts.HIGH} tinggi</Badge>;
  if (counts.MEDIUM > 0) return <Badge variant="neutral">{counts.MEDIUM} sedang</Badge>;
  return <Badge variant="green">Aman</Badge>;
}

const DIM_LABEL = { communicationSkill: "Communication", authoritySelling: "Authority", objectionHandling: "Objection" };

function SalesRow({ profile, bestExample, narrative, riskCustomers }) {
  const [open, setOpen] = useState(false);
  const tone = scoreTone(profile.qualityScore);
  const dims = profile.dimensions || {};

  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-4 text-left">
        <Avatar name={profile.name} size="md" />
        <div className="min-w-[130px] flex-1">
          <p className="font-semibold text-ink">{profile.name}</p>
          <p className="text-[11px] text-ink3">{profile.sampleCount} percakapan dinilai</p>
        </div>

        <div className="flex w-full flex-col gap-1 sm:w-[260px]">
          <DimBar label={DIM_LABEL.communicationSkill} score={dims.communicationSkill} />
          <DimBar label={DIM_LABEL.authoritySelling} score={dims.authoritySelling} />
          <DimBar label={DIM_LABEL.objectionHandling} score={dims.objectionHandling} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className={cn("text-2xl font-bold tabular-nums", TONE_TEXT[tone])}>
            {profile.qualityScore != null ? profile.qualityScore.toFixed(1) : "—"}
          </span>
          <TrendBadge trend={profile.qualityTrend} />
        </div>

        <RiskBadge counts={profile.riskContribution} />
        {open ? <ChevronUp size={16} className="shrink-0 text-ink3" /> : <ChevronDown size={16} className="shrink-0 text-ink3" />}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-3">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Kutipan Bukti</p>
            {bestExample ? (
              <div className="rounded-btn bg-inset p-2 text-[12px]">
                <p className="mb-1 font-semibold text-ink2">{bestExample.label}</p>
                <p className="italic text-ink3">"{bestExample.quote}"</p>
              </div>
            ) : (
              <p className="text-[12px] text-ink3">Belum ada contoh percakapan periode ini.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Narasi Mingguan</p>
            <p className="text-[12.5px] text-ink2">{narrative?.narrative || "Belum ada ringkasan pola minggu ini."}</p>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Pelanggan Kritis/Tinggi</p>
            {riskCustomers?.length ? (
              <ul className="flex flex-col gap-1.5">
                {riskCustomers.slice(0, 5).map((c) => (
                  <li key={c.customerId} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate text-ink2">{c.customerName}</span>
                    <Badge variant={c.tier === "CRITICAL" ? "red" : "orange"}>{c.tier === "CRITICAL" ? "Kritis" : "Tinggi"}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink3">Tidak ada pelanggan berisiko tinggi/kritis.</p>
            )}
          </div>

          <div className="col-span-full flex flex-wrap gap-4 border-t border-line pt-3">
            {/* BUG (29 Agustus 2026): sebelumnya link ini TIDAK bawa konteks
                sales sama sekali — user expand baris Ervina, klik, mendarat
                di halaman general (semua sales), harus filter manual lagi
                (padahal belum ada filter manual di kedua halaman itu). Sekarang
                keduanya bawa ?salesId= dan halaman tujuan PRE-FILTER begitu
                dibuka (lihat QualityScorer.jsx & SalesRisk.jsx). */}
            <Link to={`/quality-scorer?salesId=${profile.userId}`} className="text-[12px] font-semibold text-accent hover:underline">
              Lihat detail Quality Scorer →
            </Link>
            <Link to={`/sales-risk?salesId=${profile.userId}`} className="text-[12px] font-semibold text-accent hover:underline">
              Lihat semua Pelanggan Berisiko →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSummary({ averageQualityScore, topPerformerName, totalCritical }) {
  const tone = scoreTone(averageQualityScore);
  return (
    <Card>
      <CardHeader><CardTitle>Ringkasan Tim</CardTitle></CardHeader>
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-3">
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-ink3">Rata-rata Tim</p>
          <p className={cn("text-2xl font-bold tabular-nums", TONE_TEXT[tone])}>
            {averageQualityScore != null ? averageQualityScore.toFixed(1) : "—"}
          </p>
        </div>
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-ink3"><Award size={12} /> Top Performer</p>
          <p className="font-semibold text-ink">{topPerformerName || "—"}</p>
        </div>
        <div className="rounded-btn bg-inset p-3">
          <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-ink3"><AlertCircle size={12} /> Total Kritis Hari Ini</p>
          <p className={cn("text-2xl font-bold tabular-nums", totalCritical > 0 ? "text-red" : "text-green")}>{totalCritical}</p>
        </div>
      </div>
    </Card>
  );
}

export default function SalesPerformance() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [narratives, setNarratives] = useState(null);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      api.getSalesIntelligence({ days }),
      api.getQualityScorerWeekly({ days }),
      api.getQualityScorerWeeklyNarrative(),
      api.getSalesRisk({ minTier: "MEDIUM" }),
    ])
      .then(([intel, weeklyRes, narrativeRes, riskRes]) => {
        setData(intel);
        setWeekly(weeklyRes);
        setNarratives(narrativeRes);
        setRisk(riskRes);
      })
      .catch(() => { setData(null); setWeekly(null); setNarratives(null); setRisk(null); })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeklyByUser = new Map((weekly?.perSales || []).map((r) => [r.salesUserId, r]));
  const narrativeByUser = new Map((narratives?.narratives || []).map((n) => [n.salesUserId, n]));
  const riskByUser = new Map();
  for (const r of risk?.risks || []) {
    if (!r.salesOwnerId) continue;
    if (!riskByUser.has(r.salesOwnerId)) riskByUser.set(r.salesOwnerId, []);
    riskByUser.get(r.salesOwnerId).push(r);
  }

  const profiles = data?.individual || [];
  const scored = profiles.filter((p) => p.qualityScore != null);
  const averageQualityScore = scored.length
    ? scored.reduce((s, p) => s + p.qualityScore, 0) / scored.length
    : null;
  const totalCritical = profiles.reduce((s, p) => s + (p.riskContribution?.CRITICAL || 0), 0);

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
            <TeamSummary
              averageQualityScore={averageQualityScore}
              topPerformerName={data.team?.topPerformer?.name}
              totalCritical={totalCritical}
            />
            <div className="flex flex-col gap-3">
              {profiles.length === 0 ? (
                <Card><p className="py-8 text-center text-sm text-ink3">Tidak ada sales aktif.</p></Card>
              ) : (
                profiles.map((p) => {
                  const weeklyRow = weeklyByUser.get(p.userId);
                  const bestRaw = weeklyRow?.bestExamples?.[0] || null;
                  let bestExample = null;
                  if (bestRaw) {
                    // Ambil dimensi dgn score TERTINGGI dari contoh terbaik itu
                    // sbg kutipan yang ditampilkan (bukan panggilan LLM baru,
                    // murni pilih dari data quote yang sudah ada).
                    const dimEntries = Object.entries(bestRaw.dimensions || {})
                      .filter(([, v]) => v.score != null && v.quote)
                      .sort((a, b) => b[1].score - a[1].score);
                    if (dimEntries.length) {
                      const [key, v] = dimEntries[0];
                      bestExample = { label: DIM_LABEL[key] || key, quote: v.quote };
                    }
                  }
                  return (
                    <SalesRow
                      key={p.userId}
                      profile={p}
                      bestExample={bestExample}
                      narrative={narrativeByUser.get(p.userId)}
                      riskCustomers={riskByUser.get(p.userId)}
                    />
                  );
                })
              )}
            </div>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
