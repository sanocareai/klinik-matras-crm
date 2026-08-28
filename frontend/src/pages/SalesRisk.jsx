import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, ChevronDown, ChevronUp, X, MessageSquare, Flag } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { cn } from "@/lib/utils.js";
import { formatWaktu } from "../utils/format.js";

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

// Bubble presentasi RINGAN (29 Agustus 2026) — REUSE class CSS yang SAMA
// dgn Inbox (bubble/bubble.in/bubble.out/bubble-text/bubble-meta/bubble-time,
// lihat index.css) supaya tampilan identik, TAPI SENGAJA TIDAK import
// MessageBubble asli dari Inbox: komponen itu terikat erat ke state
// interaktif Inbox (useMessageStore + 6 callback reply/forward/edit/delete/
// select/media-load) yang semuanya tidak relevan di sini — transkrip ini
// READ-ONLY murni utk audit manual. Stub 6+ props kosong ke komponen yang
// tidak didesain dipakai begini lebih rapuh drpd bubble ringan sendiri yang
// reuse CSS-nya saja.
function SimpleBubble({ message }) {
  const isOut = message.direction === "OUTBOUND";
  return (
    <div className="msg-row" style={{ width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", width: "100%" }}>
        <div className={cn("bubble", isOut ? "out" : "in")}>
          {message.mediaType && ["image", "video", "audio", "document"].includes(message.mediaType) ? (
            <span className="bubble-text text-ink3">[{message.mediaType}]{message.content ? ` — ${message.content}` : ""}</span>
          ) : message.content ? (
            <span className="bubble-text">{message.content}</span>
          ) : (
            <span className="bubble-text text-ink3">(tanpa teks)</span>
          )}
          <span className="bubble-meta"><span className="bubble-time">{formatWaktu(message.createdAt)}</span></span>
        </div>
      </div>
    </div>
  );
}

// Modal transkrip + "Tandai salah kategori" (29 Agustus 2026) — alat bantu
// audit manual selama investigasi false-positive classifier. Ambil pesan via
// api.peekConversation() — endpoint GET /conversations/:id/peek yang SUDAH
// ADA (dipakai fitur "Peek Preview" Inbox mobile), SENGAJA BUKAN
// api.getMessages() yang dipakai Inbox utama: endpoint itu py efek samping
// mark-as-read + kirim read-receipt WhatsApp ke customer (dikonfirmasi baca
// routes/conversations.js) — kalau dipakai di sini, sekadar admin buka
// transkrip utk audit akan diam-diam mengubah status baca percakapan &
// mengirim ceklis biru ke customer, padahal sales aslinya belum tentu sudah
// baca. /peek dirancang eksplisit "TANPA efek samping apa pun", pas untuk
// kebutuhan audit read-only ini.
function TranscriptModal({ risk, open, onOpenChange, onFlagged, alreadyFlagged }) {
  const [messages, setMessages] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setShowFlagForm(false);
    setCatatan("");
    setSubmitError(null);
    if (!risk?.conversationId) { setMessages([]); return; }
    setMessages(null);
    setLoadError(false);
    api.peekConversation(risk.conversationId, 20)
      .then(setMessages)
      .catch(() => { setMessages([]); setLoadError(true); });
  }, [open, risk?.conversationId]);

  async function handleSubmitFlag() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.flagRiskClassification(risk.customerId, {
        severityAsli: risk.tier,
        alasanAsli: risk.problemTags?.length ? risk.problemTags.join(", ") : risk.problem,
        catatan: catatan.trim() || undefined,
      });
      await onFlagged?.();
      setShowFlagForm(false);
      setCatatan("");
    } catch (err) {
      setSubmitError(err.message || "Gagal menyimpan tanda.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={risk ? `Percakapan — ${risk.customerName}` : "Percakapan"}
      description="Transkrip pesan terbaru (maks 20 pesan) — tanpa efek samping, tidak menandai percakapan sudah dibaca."
      className="flex max-h-[85vh] w-[560px] flex-col"
    >
      <div className="flex-1 overflow-y-auto rounded-btn bg-inset px-1" style={{ maxHeight: "50vh" }}>
        {messages === null ? (
          <p className="py-8 text-center text-sm text-ink3">Memuat transkrip...</p>
        ) : loadError ? (
          <p className="py-8 text-center text-sm text-ink3">Gagal memuat transkrip.</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink3">Tidak ada pesan.</p>
        ) : (
          <div className="flex flex-col gap-1 py-2">
            {messages.map((m) => <SimpleBubble key={m.id} message={m} />)}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        {alreadyFlagged && (
          <p className="mb-2 text-[12px] text-ink3">Kartu ini sudah pernah ditandai salah kategori sebelumnya.</p>
        )}
        {!showFlagForm ? (
          <Button variant="ghost" size="sm" onClick={() => setShowFlagForm(true)}>
            <Flag size={14} /> Tandai salah kategori
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Kenapa kartu ini dianggap salah kategori? (opsional)"
              className="min-h-[70px] w-full resize-none rounded-lg bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink3 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            {submitError && <p className="text-[12px] text-red">{submitError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmitFlag} disabled={submitting}>
                {submitting ? "Menyimpan..." : "Simpan Tanda"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowFlagForm(false)} disabled={submitting}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Kartu diringkas (29 Agustus 2026) — tampilan utama SEKARANG tag pendek
// (risk.problemTags, sudah terstruktur dari backend, BUKAN parsing teks
// bebas thd risk.problem — lihat riskScore.js#explainRisk), bukan kalimat
// penuh berulang. Kalimat lengkap (risk.problem) TETAP ADA, dipindah ke
// dalam expand/detail supaya tidak hilang, cuma tidak lagi mendominasi
// tampilan utama.
//
// `isFlagged`/`onOpenTranscript` (29 Agustus 2026) — alat audit manual.
// Badge "Ditandai salah" SENGAJA netral (bg-inset/text-ink3, bukan warna
// merah/oranye) supaya tidak tertukar makna dgn TierBadge severity di
// sebelahnya (constraint eksplisit ticket).
function RiskCard({ risk, isFlagged, onOpenTranscript }) {
  const [open, setOpen] = useState(false);
  const days = daysStagnant(risk);
  return (
    <div className="rounded-btn bg-surface p-4 shadow-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
        <TierBadge tier={risk.tier} />
        <span className="min-w-[140px] flex-1 font-semibold text-ink">{risk.customerName}</span>
        {isFlagged && (
          <span className="rounded-chip bg-inset px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink3">
            Ditandai salah
          </span>
        )}
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
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onOpenTranscript(risk); }}>
              <MessageSquare size={14} /> Lihat percakapan penuh
            </Button>
          </div>
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
function SeveritySection({ tier, risks, flaggedCustomerIds, onOpenTranscript }) {
  if (risks.length === 0) return null;
  const meta = SEVERITY_SECTION[tier];
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex items-center gap-2 rounded-btn px-3 py-1.5", meta.headerClass)}>
        <span className="text-[12px] font-bold uppercase tracking-wide">{meta.label}</span>
        <span className="text-[12px] opacity-90">({risks.length})</span>
      </div>
      <div className="flex flex-col gap-3">
        {risks.map((r) => (
          <RiskCard key={r.customerId} risk={r} isFlagged={flaggedCustomerIds.has(r.customerId)} onOpenTranscript={onOpenTranscript} />
        ))}
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
  // Feedback "salah kategori" (29 Agustus 2026) — dimuat terpisah dari
  // data.risks (tabel kecil, tidak perlu ikut di-refresh tiap kali severity
  // pill diklik). transcriptRisk = risk yang SEDANG dibuka modalnya (null =
  // tertutup) — SATU instance modal di level halaman, bukan 1 per kartu.
  const [feedback, setFeedback] = useState([]);
  const [transcriptRisk, setTranscriptRisk] = useState(null);

  function load() {
    setLoading(true);
    api.getSalesRisk({ minTier: "MEDIUM", salesId: salesId || undefined })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }
  function loadFeedback() {
    return api.getRiskClassificationFeedback()
      .then((res) => setFeedback(res.feedback || []))
      .catch(() => setFeedback([]));
  }
  useEffect(() => { load(); }, [salesId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadFeedback(); }, []);

  const flaggedCustomerIds = new Set(feedback.map((f) => f.customerId));

  // Nama sales yang sedang difilter — diambil dari hasil respons (bySalesOwner
  // baris pertama), BUKAN state terpisah yang perlu di-fetch ulang.
  const filteredSalesName = salesId ? (data?.bySalesOwner?.[0]?.salesOwnerName || data?.risks?.[0]?.salesOwnerName) : null;

  // Filter severity DI FRONTEND (data.risks sudah lengkap dari 1x fetch,
  // salesId sudah discope backend) — dikombinasikan, bukan menggantikan.
  const visibleRisks = severityFilter === "ALL" ? (data?.risks || []) : (data?.risks || []).filter((r) => r.tier === severityFilter);
  const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [] };
  for (const r of visibleRisks) bySeverity[r.tier]?.push(r);
  // Count utk Ringkasan — DISTINCT customer yang ditandai DI ANTARA yang
  // sedang tampil (severity+salesId filter aktif), bukan total feedback
  // global (1 customer bisa punya >1 baris feedback seiring waktu).
  const flaggedVisibleCount = visibleRisks.filter((r) => flaggedCustomerIds.has(r.customerId)).length;

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
                  {flaggedVisibleCount > 0 ? ` · ${flaggedVisibleCount} ditandai salah kategori.` : ""}
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
                  <SeveritySection
                    key={tier} tier={tier} risks={bySeverity[tier]}
                    flaggedCustomerIds={flaggedCustomerIds}
                    onOpenTranscript={setTranscriptRisk}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </PageBody>

      <TranscriptModal
        risk={transcriptRisk}
        open={!!transcriptRisk}
        onOpenChange={(v) => { if (!v) setTranscriptRisk(null); }}
        onFlagged={loadFeedback}
        alreadyFlagged={transcriptRisk ? flaggedCustomerIds.has(transcriptRisk.customerId) : false}
      />
    </PageContainer>
  );
}
