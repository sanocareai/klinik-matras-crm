import React, { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, RefreshCw, Play, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";

// ═══ AI CONVERSATION QUALITY SCORER — laporan TERPISAH ═══════════════════
// Halaman validasi manual (26 Agustus 2026) — SENGAJA bukan tab di Laporan
// utama & bukan bagian dari Dashboard produksi, sesuai permintaan owner:
// tim perlu lihat & nilai dulu apakah skor LLM ini masuk akal sebelum
// diputuskan diintegrasikan penuh. Pelengkap audit_balasan_sales (rule-
// based, MCP) — TIDAK menggantikannya.
const DAYS_OPTIONS = [7, 14, 30];

function TrendBadge({ trend }) {
  if (trend == null) return <span className="text-[11px] text-ink3">—</span>;
  const naik = trend > 0;
  const flat = trend === 0;
  const Icon = flat ? Minus : naik ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums",
      flat ? "text-ink3" : naik ? "text-green" : "text-red"
    )}>
      <Icon size={13} />
      {naik ? "+" : ""}{trend}
    </span>
  );
}

function ScoreCell({ value }) {
  if (value == null) return <span className="text-ink3">—</span>;
  const tone = value >= 4 ? "text-green" : value >= 3 ? "text-ink" : "text-red";
  return <span className={cn("font-bold tabular-nums", tone)}>{value.toFixed(1)}</span>;
}

// ═══ Pola Perilaku Berulang (Closing & Komunikasi) — 26 Agustus 2026 ═════
// Section BARU, terpisah dari leaderboard di atas — TIDAK mengubah apa pun
// di section lama. `pm` = row.patternDimensions[dimKey] dari /weekly.
function NegativeFlagRate({ pm }) {
  if (pm.negativeFlagRatePct == null) return <span className="text-[12px] text-ink3">Belum ada data relevan</span>;
  const tone = pm.negativeFlagRatePct >= 40 ? "text-red" : pm.negativeFlagRatePct >= 20 ? "text-orange" : "text-green";
  return (
    <span className={cn("text-[12px] font-semibold tabular-nums", tone)}>
      {pm.negativeFlagRatePct}% tanpa {pm.flagKey === "closingAskPresent" ? "closing ask" : "bahasa sederhana/cek paham"}
      <span className="ml-1 font-normal text-ink3">({pm.sampleCountForFlag} percakapan relevan)</span>
    </span>
  );
}

function PatternDimensionCard({ meta, pm }) {
  return (
    <div className="flex flex-1 min-w-[220px] flex-col gap-1 rounded-btn bg-inset p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-ink">{meta.label}</span>
        <div className="flex items-center gap-1.5">
          <ScoreCell value={pm.avgScore} />
          <TrendBadge trend={pm.trend} />
        </div>
      </div>
      <NegativeFlagRate pm={pm} />
    </div>
  );
}

function PatternSalesCard({ row, patternDimensionsMeta, narrative }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{row.salesName}</span>
        <span className="text-[11px] text-ink3">{row.sampleCount} percakapan minggu ini</span>
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>
      <div className="mt-3 flex flex-wrap gap-3">
        {patternDimensionsMeta.map((meta) => (
          <PatternDimensionCard key={meta.key} meta={meta} pm={row.patternDimensions[meta.key]} />
        ))}
      </div>
      {open && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Ringkasan Pola Mingguan (AI)</p>
          {narrative ? (
            <p className="text-[12.5px] italic text-ink2">"{narrative.narrative}"</p>
          ) : (
            <p className="text-[12px] text-ink3">Belum ada ringkasan minggu ini — job jalan tiap Senin 04:00 WIB, atau klik "Jalankan Ringkasan Mingguan" di atas.</p>
          )}
        </div>
      )}
    </div>
  );
}

function PatternSection({ data, narrativesBySales, onRunNarrative, runningNarrative, narrativeMsg }) {
  if (!data || !data.patternDimensionsMeta) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Pola Perilaku Berulang — Closing & Komunikasi</CardTitle>
            <CardDescription>
              Dimensi tambahan (Closing Assertiveness & Customer Comprehension) + ringkasan naratif mingguan (1 panggilan AI/sales/minggu) untuk bahan SANO Class.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onRunNarrative} disabled={runningNarrative}>
            <Play size={14} /> {runningNarrative ? "Menjalankan..." : "Jalankan Ringkasan Mingguan"}
          </Button>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {narrativeMsg && (
          <p className={cn(
            "rounded-lg px-3 py-2 text-[13px] font-medium",
            narrativeMsg.type === "success" ? "bg-green/10 text-green" : "bg-red/10 text-red"
          )}>
            {narrativeMsg.text}
          </p>
        )}
        {data.perSales.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink3">Belum ada data untuk periode ini.</p>
        ) : (
          data.perSales.map((row) => (
            <PatternSalesCard
              key={row.salesUserId}
              row={row}
              patternDimensionsMeta={data.patternDimensionsMeta}
              narrative={narrativesBySales.get(row.salesUserId)}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function ExampleCard({ example, dimensions }) {
  return (
    <div className="rounded-btn bg-inset p-3 text-[12.5px]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-bold text-ink">Skor keseluruhan: {example.overallScore.toFixed(1)}</span>
        <Badge variant="neutral">{example.pipelineStageAtSample}</Badge>
      </div>
      {example.overallNote && <p className="mb-2 italic text-ink2">"{example.overallNote}"</p>}
      <div className="flex flex-col gap-1.5">
        {dimensions.map(({ key, label }) => {
          const d = example.dimensions[key];
          if (!d || d.score == null) return null;
          return (
            <div key={key} className="border-t border-line pt-1.5 first:border-0 first:pt-0">
              <span className="font-semibold text-ink2">{label}: </span>
              <span className="font-bold tabular-nums">{d.score}/5</span>
              {d.note && <span className="text-ink3"> — {d.note}</span>}
              {d.quote && <p className="mt-0.5 truncate text-ink3" title={d.quote}>&ldquo;{d.quote}&rdquo;</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SalesRow({ row, dimensions }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{row.salesName}</span>
        <span className="text-[11px] text-ink3">{row.sampleCount} percakapan dinilai</span>
        {dimensions.map(({ key, label }) => (
          <span key={key} className="flex w-20 flex-col items-center text-center">
            <span className="text-[10px] uppercase text-ink3">{label.split(" ")[0]}</span>
            <ScoreCell value={row.dimensions[key]} />
          </span>
        ))}
        <span className="flex w-20 flex-col items-center text-center">
          <span className="text-[10px] uppercase text-ink3">Overall</span>
          <ScoreCell value={row.overallAvg} />
        </span>
        <TrendBadge trend={row.trend} />
        {open ? <ChevronUp size={16} className="text-ink3" /> : <ChevronDown size={16} className="text-ink3" />}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-green">Contoh Terbaik</p>
            <div className="flex flex-col gap-2">
              {row.bestExamples.length === 0
                ? <p className="text-[12px] text-ink3">Belum ada data.</p>
                : row.bestExamples.map((ex) => <ExampleCard key={ex.conversationId} example={ex} dimensions={dimensions} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-red">Perlu Perhatian</p>
            <div className="flex flex-col gap-2">
              {row.worstExamples.length === 0
                ? <p className="text-[12px] text-ink3">Belum ada data.</p>
                : row.worstExamples.map((ex) => <ExampleCard key={ex.conversationId} example={ex} dimensions={dimensions} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QualityScorer() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState(null);
  const [narratives, setNarratives] = useState([]);
  const [runningNarrative, setRunningNarrative] = useState(false);
  const [narrativeMsg, setNarrativeMsg] = useState(null);

  function load() {
    setLoading(true);
    api.getQualityScorerWeekly({ days })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }
  function loadNarratives() {
    api.getQualityScorerWeeklyNarrative()
      .then((res) => setNarratives(res.narratives || []))
      .catch(() => setNarratives([]));
  }
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadNarratives(); }, []);
  const narrativesBySales = new Map(narratives.map((n) => [n.salesUserId, n]));

  async function handleRunNarrativeNow() {
    setRunningNarrative(true);
    setNarrativeMsg(null);
    try {
      const summary = await api.runQualityScorerWeeklyNarrativeNow();
      setNarrativeMsg({
        type: "success",
        text: `Selesai — ${summary.narrativesGenerated} narasi dibuat, estimasi biaya $${summary.totalCostUsd.toFixed(4)}.`,
      });
      loadNarratives();
    } catch (err) {
      setNarrativeMsg({ type: "error", text: err.message || "Gagal menjalankan ringkasan mingguan." });
    } finally {
      setRunningNarrative(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const summary = await api.runQualityScorerNow();
      setRunMsg({
        type: "success",
        text: `Selesai — ${summary.conversationsGraded} percakapan dinilai, ${summary.conversationsFailed} gagal, estimasi biaya $${summary.totalCostUsd.toFixed(4)}.`,
      });
      load();
    } catch (err) {
      setRunMsg({ type: "error", text: err.message || "Gagal menjalankan job." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="AI Conversation Quality Scorer"
        subtitle="Laporan validasi manual — pelengkap audit_balasan_sales, BUKAN pengganti. Belum masuk Dashboard produksi."
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-lg bg-inset p-0.5">
              {DAYS_OPTIONS.map((d) => (
                <button
                  key={d} type="button" onClick={() => setDays(d)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                    days === d ? "bg-surface text-ink shadow-card" : "text-ink3 hover:text-ink2"
                  )}
                >{d} hari</button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button size="sm" onClick={handleRunNow} disabled={running}>
              <Play size={14} /> {running ? "Menjalankan..." : "Jalankan Sekarang"}
            </Button>
          </>
        }
      />

      <PageBody>
        {runMsg && (
          <p className={cn(
            "rounded-lg px-3 py-2 text-[13px] font-medium",
            runMsg.type === "success" ? "bg-green/10 text-green" : "bg-red/10 text-red"
          )}>
            {runMsg.text}
          </p>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-ink3">Memuat...</p>
        ) : !data ? (
          <p className="py-16 text-center text-sm text-ink3">Gagal memuat data.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Ringkasan {days} Hari Terakhir</CardTitle>
                <CardDescription>
                  {data.totalScored} percakapan dinilai · sample default {data.config.sampleSizePerSales}/sales/hari ·
                  batas keras {data.config.maxDailyLlmCalls} panggilan LLM/hari.
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="flex flex-col gap-3">
              {data.perSales.length === 0 ? (
                <Card><p className="py-8 text-center text-sm text-ink3">Belum ada data untuk periode ini — job berjalan tiap hari jam 03:00 WIB, atau klik "Jalankan Sekarang" untuk uji coba.</p></Card>
              ) : (
                data.perSales.map((row) => (
                  <SalesRow key={row.salesUserId} row={row} dimensions={data.dimensions} />
                ))
              )}
            </div>

            <PatternSection
              data={data}
              narrativesBySales={narrativesBySales}
              onRunNarrative={handleRunNarrativeNow}
              runningNarrative={runningNarrative}
              narrativeMsg={narrativeMsg}
            />
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
