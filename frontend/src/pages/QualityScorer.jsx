import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, RefreshCw, Play, ChevronDown, ChevronUp, X } from "lucide-react";
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

// ═══ Ringkasan Naratif Mingguan — 27 Agustus 2026 ═════════════════════════
// Diperbarui: rubrik SANO Sales Framework tidak punya dimensi ber-flag,
// jadi section ini disederhanakan jadi murni ringkasan naratif per sales
// (tanpa kartu metrik pola Closing/Komunikasi yang sudah tidak relevan).
function NarrativeSalesCard({ row, narrative }) {
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{row.salesName}</span>
        <span className="text-[11px] text-ink3">{row.sampleCount} percakapan minggu ini</span>
      </div>
      <div className="mt-2 border-t border-line pt-2">
        {narrative ? (
          <p className="text-[12.5px] italic text-ink2">"{narrative.narrative}"</p>
        ) : (
          <p className="text-[12px] text-ink3">Belum ada ringkasan minggu ini — job jalan tiap Senin 04:00 WIB, atau klik "Jalankan Ringkasan Mingguan" di atas.</p>
        )}
      </div>
    </div>
  );
}

function PatternSection({ data, narrativesBySales, onRunNarrative, runningNarrative, narrativeMsg }) {
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Ringkasan Naratif Mingguan</CardTitle>
            <CardDescription>
              Coaching note per sales berdasarkan pola minggu ini (1 panggilan AI/sales/minggu) — bahan sesi SANO Class.
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
            <NarrativeSalesCard key={row.salesUserId} row={row} narrative={narrativesBySales.get(row.salesUserId)} />
          ))
        )}
      </div>
    </Card>
  );
}

// Diperbarui 27 Agustus 2026 — "note" tunggal diganti Strength/Weakness
// terpisah (rubrik SANO Sales Framework), + badge Rekomendasi Modul SANO
// Class (dihitung rule-based di backend, bukan ditulis di sini).
function ExampleCard({ example, dimensions }) {
  return (
    <div className="rounded-btn bg-inset p-3 text-[12.5px]">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-ink">Skor keseluruhan: {example.overallScore.toFixed(1)}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant="neutral">{example.pipelineStageAtSample}</Badge>
          {example.recommendedModule && <Badge variant="brand">Rekomendasi: {example.recommendedModule}</Badge>}
        </div>
      </div>
      {example.overallNote && <p className="mb-2 italic text-ink2">"{example.overallNote}"</p>}
      <div className="flex flex-col gap-2">
        {dimensions.map(({ key, label }) => {
          const d = example.dimensions[key];
          if (!d || d.score == null) return null;
          return (
            <div key={key} className="border-t border-line pt-2 first:border-0 first:pt-0">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-ink2">{label}</span>
                <span className="font-bold tabular-nums">{d.score}/5</span>
              </div>
              {d.strength && <p className="text-ink3">✓ {d.strength}</p>}
              {d.weakness && <p className="text-ink3">△ {d.weakness}</p>}
              {d.quote && (
                <p className="mt-1 truncate text-ink3" title={d.quote}>
                  <span className="font-semibold">Contoh percakapan: </span>&ldquo;{d.quote}&rdquo;
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SalesRow({ row, dimensions, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
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
  // ?salesId= (29 Agustus 2026) — deep-link dari "Lihat detail Quality Scorer →"
  // di Sales Performance Intelligence hub. Halaman ini tidak punya route
  // detail terpisah per sales (semua sales tampil di 1 list expand/collapse),
  // jadi "detail" di sini berarti PERSEMPIT list ke 1 baris itu saja begitu
  // dibuka — bukan filter manual yang harus dipilih user lagi.
  const [searchParams, setSearchParams] = useSearchParams();
  const salesId = searchParams.get("salesId");
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

  // Filter DI FRONTEND (bukan minta backend baru) — data.perSales sudah
  // lengkap 1x fetch, salesId cuma persempit apa yang DITAMPILKAN. Dipakai
  // ulang utk 2 section (list utama + PatternSection) supaya konsisten,
  // BUKAN cuma section pertama saja yang terfilter.
  const visiblePerSales = data && salesId ? data.perSales.filter((r) => r.salesUserId === salesId) : data?.perSales;
  const filteredSalesName = salesId ? visiblePerSales?.[0]?.salesName : null;

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
        subtitle={
          salesId
            ? `Difilter khusus ${filteredSalesName || "sales ini"} — sales lain disembunyikan.`
            : "Penilaian berdasarkan kurikulum SANO Care Sales Framework (Communication Skill, Authority Selling, Objection Handling) — pelengkap audit_balasan_sales, BUKAN pengganti."
        }
        actions={
          <>
            {salesId && (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                <X size={14} /> Tampilkan Semua Sales
              </Button>
            )}
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
              {visiblePerSales.length === 0 ? (
                <Card><p className="py-8 text-center text-sm text-ink3">
                  {salesId ? "Belum ada data sales ini untuk periode ini." : "Belum ada data untuk periode ini — job berjalan tiap hari jam 03:00 WIB, atau klik \"Jalankan Sekarang\" untuk uji coba."}
                </p></Card>
              ) : (
                visiblePerSales.map((row) => (
                  <SalesRow key={row.salesUserId} row={row} dimensions={data.dimensions} defaultOpen={!!salesId} />
                ))
              )}
            </div>

            <PatternSection
              data={{ ...data, perSales: visiblePerSales }}
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
