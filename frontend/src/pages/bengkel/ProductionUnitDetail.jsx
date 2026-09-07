import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Camera, CheckCircle2, Loader2, PlayCircle, XCircle, SkipForward,
  AlertTriangle, PauseCircle, History,
} from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { formatTanggalJam, formatDurasiMenit, formatDurasiDetik } from "@/utils/formatDate.js";
import { rolesOf } from "@/lib/roles.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { ActivityTimeline } from "@/components/ui/activity-timeline.jsx";
import {
  UNIT_STATUS_REAL, SERVICE_LINE_REAL, STAGE_LOG_STATUS, BLOCK_REASON_REAL,
  FIT_VERDICT_REAL, PREFERENCE_OVERRIDE_REAL, SCOPE_REVISION_STATUS_REAL,
  PRODUCTION_STATUS_REAL, PRODUCTION_PRIORITY_REAL, PAUSE_REASON_REAL,
} from "@/features/bengkel/unitStatus.js";
import { formatActivitySentence } from "@/features/bengkel/activityFeed.js";

// Label kejadian log tahap, dipasangkan dengan tanggalnya di "Jalur Tahap
// Produksi" (D-038, 31 Agustus 2026) — enum action dari unit_stage_logs.
// RESUME ditambah Production Core Slice 3.
const AKSI_LOG_LABEL = {
  START: "Dimulai",
  PAUSE: "Dijeda",
  RESUME: "Dilanjutkan",
  COMPLETE: "Selesai",
  FAIL: "Gagal",
  SKIP: "Dilewati",
};

// Live-ticking Touch/Paused/Elapsed (Production Core Slice 3) TANPA polling
// backend tiap detik — ekstrapolasi LINIER murni dari snapshot timing yang
// sudah didapat saat `load()` terakhir (attempt.timing, dihitung server) +
// selisih waktu sejak snapshot itu diambil (`loadedAt`). BUKAN reimplementasi
// computeExecutionTiming() (itu tetap satu-satunya sumber kebenaran
// rekonstruksi attempt) — ini murni "snapshot + delta wall-clock", valid
// SELAMA attempt belum ditutup: sedang berjalan -> touch & elapsed sama-sama
// bertambah 1 detik tiap detik; sedang dijeda -> paused & elapsed yang
// bertambah, touch tetap.
function liveTiming(attempt, loadedAt, now) {
  const t = attempt?.timing;
  if (!t?.timingKnown || attempt.endedAt || !loadedAt) return t || null;
  const deltaSeconds = Math.max(0, Math.floor((now - loadedAt) / 1000));
  if (t.currentlyPaused) {
    return { ...t, pausedSeconds: t.pausedSeconds + deltaSeconds, elapsedSeconds: t.elapsedSeconds + deltaSeconds };
  }
  return { ...t, touchSeconds: t.touchSeconds + deltaSeconds, elapsedSeconds: t.elapsedSeconds + deltaSeconds };
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

// Detail Unit — Production Tahap 2. Menyambungkan UI ke stage engine yang
// SUDAH LENGKAP sejak Phase 0 (unitStageEngine.js) — start/complete/fail/
// skip semuanya sudah ada di backend, cuma belum pernah dipanggil dari
// halaman mana pun sebelum ini.
//
// SATU TAHAP AKTIF PADA SATU WAKTU — mengikuti disiplin engine (D-003):
// halaman ini tidak pernah menghitung tahap berikutnya sendiri, semua
// keputusan "apa yang bisa dilakukan sekarang" datang dari isCurrent +
// status per tahap yang sudah dihitung server di GET /units/:id/timeline.
export default function ProductionUnitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");

  const [mode, setMode] = useState(null); // null | "complete" | "fail" | "pause"
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [blockReason, setBlockReason] = useState("MATERIAL_SHORTAGE");
  const [uploading, setUploading] = useState(false);

  // Jeda/Lanjutkan tahap (Production Core Slice 3) — pauseReasonDraft
  // TERPISAH dari blockReason di atas (kosakata sengaja tidak overlap,
  // lihat lib/domain/stageExecution.js backend).
  const [pauseReasonDraft, setPauseReasonDraft] = useState("BREAK");
  const [loadedAt, setLoadedAt] = useState(null); // snapshot waktu load() terakhir — dasar liveTiming()
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Uji Berat Badan (D-009) — gerbang QC di jalur tahap.
  const [verdict, setVerdict] = useState("PAS");
  const [referenceWeightKg, setReferenceWeightKg] = useState("");
  const [preferenceOverride, setPreferenceOverride] = useState("");
  const [educationGiven, setEducationGiven] = useState(false);

  // Bahan Digunakan (Production Tahap 5).
  const [materialCatalog, setMaterialCatalog] = useState([]);
  const [materialUsage, setMaterialUsage] = useState(null);
  const [materialId, setMaterialId] = useState("");
  const [materialQty, setMaterialQty] = useState("");
  const [materialNote, setMaterialNote] = useState("");
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState("");

  // Revisi Lingkup (Production Tahap 4) — dua permission terpisah (D-008):
  // PRODUCTION_LEAD/QC_LEAD MENGAJUKAN di sini; SALES/ADMIN MEMUTUSKAN di
  // halaman "Revisi Lingkup" (bukan di sini) — satu orang tidak boleh
  // mengarang delta harga sekaligus menyetujuinya sendiri.
  const myRoles = rolesOf(currentUser());
  const canProposeRevision = myRoles.some((r) => ["PRODUCTION_LEAD", "QC_LEAD"].includes(r));
  const canDecideRevision = myRoles.some((r) => ["SALES", "ADMIN"].includes(r));
  const canSeeRevisions = canProposeRevision || canDecideRevision;

  // Prioritas & Target Produksi (Production Core Slice 1) — permission
  // UNIT_ROUTING_WRITE di backend, dipegang ADMIN + PRODUCTION_LEAD.
  // SENGAJA BUKAN PRODUCTION_WORKER/QC_LEAD (spec: pekerja produksi tidak
  // boleh mereprioritaskan pekerjaannya sendiri) — cermin FRONTEND dari
  // constants/permissions.js, lihat juga tests/authorize.test.js.
  const canEditProduction = myRoles.some((r) => ["ADMIN", "PRODUCTION_LEAD"].includes(r));
  const [priorityDraft, setPriorityDraft] = useState("NORMAL");
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [prodBusy, setProdBusy] = useState(false);
  const [prodError, setProdError] = useState("");

  // Blokir Produksi (Production Core Slice 2A) — RESOLVE permission SAMA
  // dengan OPEN (UNIT_STAGE_WRITE backend): PRODUCTION_WORKER/PRODUCTION_LEAD/
  // QC_LEAD, BUKAN ADMIN (D-013: admin tidak memajukan/menyentuh produksi
  // langsung) dan BUKAN SALES.
  const canResolveBlocker = myRoles.some((r) => ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD"].includes(r));
  const [resolvingBlocker, setResolvingBlocker] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [blockerBusy, setBlockerBusy] = useState(false);
  const [blockerError, setBlockerError] = useState("");

  const [activity, setActivity] = useState(null);
  const [activityError, setActivityError] = useState("");
  const [scopeRevisions, setScopeRevisions] = useState(null);
  const [scopeReason, setScopeReason] = useState("");
  const [scopeDelta, setScopeDelta] = useState("");
  const [scopeToServiceId, setScopeToServiceId] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [scopePhotos, setScopePhotos] = useState([]);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getUnitTimeline(id)
      .then((d) => {
        setData(d);
        setLoadedAt(Date.now()); // snapshot dasar liveTiming() — lihat catatan di atas
        setMode(null); setPhotos([]); setNote(""); setPauseReasonDraft("BREAK");
        setVerdict("PAS"); setReferenceWeightKg(""); setPreferenceOverride(""); setEducationGiven(false);
        // Draft prioritas/target selalu disinkronkan ulang dari data server
        // begitu dimuat — supaya form tidak pernah menampilkan nilai basi
        // setelah orang lain mengubahnya.
        setPriorityDraft(d.unit.priority || "NORMAL");
        setDueDateDraft(d.unit.productionDueAt ? d.unit.productionDueAt.slice(0, 10) : "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const loadMaterials = useCallback(() => {
    api.getUnitMaterials(id).then(setMaterialUsage).catch((e) => setMaterialError(e.message));
  }, [id]);

  const loadScopeRevisions = useCallback(() => {
    if (!canSeeRevisions) return;
    api.getScopeRevisions({ unitId: id }).then(setScopeRevisions).catch((e) => setScopeError(e.message));
  }, [id, canSeeRevisions]);

  const loadActivity = useCallback(() => {
    api.getActivity("unit", id).then((r) => setActivity(r.events)).catch((e) => setActivityError(e.message));
  }, [id]);

  useEffect(() => { load(); loadMaterials(); loadScopeRevisions(); loadActivity(); }, [load, loadMaterials, loadScopeRevisions, loadActivity]);

  // Ticking clock untuk liveTiming() (Production Core Slice 3) — HANYA aktif
  // selama attempt tahap sekarang masih terbuka (IN_PROGRESS/PAUSED), TIDAK
  // memanggil backend sama sekali (spec "live timer TANPA per-second DB
  // write") — cuma memaksa re-render supaya liveTiming() menghitung ulang
  // delta dari `loadedAt` dengan `now` yang segar.
  const currentAttempt = data?.executionHistory?.[data.executionHistory.length - 1] || null;
  const attemptIsOpen = currentAttempt && !currentAttempt.endedAt;
  useEffect(() => {
    if (!attemptIsOpen) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [attemptIsOpen]);
  useEffect(() => {
    api.getMaterials({ active: true }).then(setMaterialCatalog).catch(() => {});
    // Katalog layanan dipakai DUA tempat: adopsi unit backfill (needsService)
    // DAN dropdown "ubah ke layanan" saat mengajukan Revisi Lingkup — jadi
    // dimuat sekali di awal, bukan bersyarat.
    api.getServiceCatalog().then((d) => setServices(d.services)).catch(() => {});
  }, []);

  if (loading && !data) {
    return (
      <PageContainer>
        <p className="flex items-center gap-1.5 py-10 text-[12.5px] text-ink3">
          <Loader2 size={14} className="animate-spin" /> Memuat…
        </p>
      </PageContainer>
    );
  }
  if (error && !data) {
    return (
      <PageContainer>
        <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>
      </PageContainer>
    );
  }

  const { unit, path, qcFitTests, needsService, executionHistory = [] } = data;
  const current = path.find((p) => p.isCurrent);
  const belumMulai = !unit.currentStageId;
  const firstStage = path[0];

  async function tetapkanLayanan() {
    if (!selectedServiceId) return;
    setBusy(true); setError("");
    try {
      await api.setUnitService(unit.id, selectedServiceId);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  // Prioritas & Target Produksi (Production Core Slice 1) — PATCH terpisah
  // dari stage engine, jadi tidak ikut memuat ulang state tahap. dueDateDraft
  // "YYYY-MM-DD" dikirim dengan offset WIB eksplisit (+07:00, tetap sepanjang
  // tahun — Indonesia tidak pakai DST) supaya backend TIDAK perlu menebak
  // timezone browser pengirimnya (CLAUDE.md §11: "UTC di dalam, WIB di tepi").
  async function simpanPrioritas() {
    setProdBusy(true); setProdError("");
    try {
      await api.updateUnitProduction(unit.id, {
        priority: priorityDraft,
        productionDueAt: dueDateDraft ? `${dueDateDraft}T00:00:00+07:00` : null,
      });
      load();
      loadActivity();
    } catch (e) { setProdError(e.message); } finally { setProdBusy(false); }
  }

  // RESOLVE BLOCKER (Production Core Slice 2A) — perintah EKSPLISIT
  // terpisah dari "Mulai Lagi" (yang juga auto-resolve, lihat backend).
  // Dipakai kalau kondisi pemblokirnya sudah selesai tapi belum ada yang
  // langsung menekan Mulai Lagi saat itu juga.
  async function selesaikanBlokir() {
    if (!data.activeBlocker) return;
    setBlockerBusy(true); setBlockerError("");
    try {
      await api.resolveBlocker(unit.id, data.activeBlocker.id, resolutionNote.trim() || undefined);
      setResolvingBlocker(false); setResolutionNote("");
      load();
      loadActivity();
    } catch (e) { setBlockerError(e.message); } finally { setBlockerBusy(false); }
  }

  async function mulaiTahap() {
    setBusy(true); setError("");
    try {
      await api.startUnitStage(unit.id);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function handlePhotos(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      const fd = new FormData();
      compressed.forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadUnitPhotos(unit.id, fd);
      setPhotos((p) => [...p, ...urls]);
    } catch (e2) { setError(e2.message); } finally { setUploading(false); e.target.value = ""; }
  }

  async function selesaikanTahap() {
    setBusy(true); setError("");
    try {
      await api.completeUnitStage(unit.id, current.stage.id, { photoUrls: photos, note });
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function gagalkanTahap() {
    setBusy(true); setError("");
    try {
      await api.failUnitStage(unit.id, current.stage.id, { blockReason, note });
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  // Jeda/Lanjutkan tahap (Production Core Slice 3) — TERPISAH dari
  // gagalkanTahap()/selesaikanBlokir(): pause TIDAK PERNAH untuk kendala
  // eksternal (backend menolaknya, lihat validatePauseReason()).
  async function jedaTahap() {
    setBusy(true); setError("");
    try {
      await api.pauseUnitStage(unit.id, current.stage.id, { reason: pauseReasonDraft, note });
      load();
      loadActivity();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function lanjutkanTahap() {
    setBusy(true); setError("");
    try {
      await api.resumeUnitStage(unit.id, current.stage.id);
      load();
      loadActivity();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function catatQc() {
    setBusy(true); setError("");
    try {
      await api.recordQcFitTest(unit.id, current.stage.id, {
        verdict,
        referenceWeightKg: Number(referenceWeightKg),
        customerPreferenceOverride: preferenceOverride || null,
        educationGiven,
        note,
        photoUrls: photos,
      });
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function catatBahan() {
    if (!materialId || !materialQty) return;
    setMaterialBusy(true); setMaterialError("");
    try {
      await api.addUnitMaterial(unit.id, { materialId, qty: Number(materialQty), note: materialNote });
      setMaterialId(""); setMaterialQty(""); setMaterialNote("");
      loadMaterials();
    } catch (e) { setMaterialError(e.message); } finally { setMaterialBusy(false); }
  }

  function handleScopePhotos(e) {
    const files = Array.from(e.target.files || []);
    setScopePhotos((p) => [...p, ...files]);
    e.target.value = "";
  }

  async function ajukanRevisi() {
    if (!scopeReason.trim() || scopeDelta === "") return;
    setScopeBusy(true); setScopeError("");
    try {
      const compressed = await Promise.all(scopePhotos.map((f) => compressImage(f)));
      const fd = new FormData();
      fd.append("reason", scopeReason.trim());
      fd.append("deltaAmount", scopeDelta);
      if (scopeToServiceId) fd.append("toServiceId", scopeToServiceId);
      if (scopeNote.trim()) fd.append("note", scopeNote.trim());
      compressed.forEach((f) => fd.append("photos", f));
      await api.proposeScopeRevision(unit.id, fd);
      setScopeReason(""); setScopeDelta(""); setScopeToServiceId(""); setScopeNote(""); setScopePhotos([]);
      loadScopeRevisions();
    } catch (e) { setScopeError(e.message); } finally { setScopeBusy(false); }
  }

  async function lewatiTahap() {
    setBusy(true); setError("");
    try {
      await api.skipUnitStage(unit.id, note);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const needsPhoto = !!current?.stage.requiresPhoto;
  const isQcGate = !!current?.stage.requiresQc;

  return (
    <PageContainer>
      <PageHeader
        title={
          <button type="button" onClick={() => navigate("/bengkel/work-orders")} className="flex items-center gap-2 text-ink hover:text-accent">
            <ArrowLeft size={18} /> {unit.unitCode}
          </button>
        }
        subtitle={`${unit.order?.customer?.name || "—"} · ${unit.order?.orderNumber || "—"}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {/* Prioritas HANYA tampil kalau bukan NORMAL — status default
                tidak perlu badge tambahan (Production Core Slice 1). */}
            {unit.priority && unit.priority !== "NORMAL" && (
              <Badge variant={PRODUCTION_PRIORITY_REAL[unit.priority]?.tone || "neutral"}>
                {PRODUCTION_PRIORITY_REAL[unit.priority]?.label || unit.priority}
              </Badge>
            )}
            {data.productionStatus && (
              <Badge variant={PRODUCTION_STATUS_REAL[data.productionStatus]?.tone || "neutral"}>
                {PRODUCTION_STATUS_REAL[data.productionStatus]?.label || data.productionStatus}
              </Badge>
            )}
            <Badge variant={UNIT_STATUS_REAL[unit.status]?.tone || "neutral"}>{UNIT_STATUS_REAL[unit.status]?.label || unit.status}</Badge>
          </div>
        }
      />

      {error && <div className="mb-4 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {needsService && (
            <Card className="border-l-[3px] border-orange p-4">
              <h3 className="text-[13px] font-bold text-ink">Layanan Belum Ditetapkan</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink2">
                Unit ini di-backfill dari data Order dan belum pernah masuk alur tahap produksi.
                Tetapkan lini/layanannya di sini (D-008: keputusan Uji Fondasi) supaya jalur
                tahapnya bisa dihitung, lalu mulai tahap pertama di bawah.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)}
                  className="h-9 min-w-[220px] rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
                >
                  <option value="">Pilih layanan…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.labelId} ({SERVICE_LINE_REAL[s.serviceLine]?.label})</option>
                  ))}
                </select>
                <Button size="sm" onClick={tetapkanLayanan} disabled={busy || !selectedServiceId}>
                  {busy && <Loader2 size={14} className="animate-spin" />} Tetapkan
                </Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Jalur Tahap Produksi</CardTitle>
              <CardDescription>
                {unit.service?.labelId ? `${unit.service.labelId} — ${path.length} tahap` : "Menunggu layanan ditetapkan"}
              </CardDescription>
            </CardHeader>
            <ul className="divide-y divide-line">
              {path.map((p, i) => {
                // Tanggal per tahap (31 Agustus 2026, D-038 — laporan owner:
                // jalur tahap tidak tampil tanggal sama sekali). p.logs sudah
                // terurut ASC dari backend (GET /units/:id/timeline), jadi
                // entri terakhir = kejadian TERBARU pada tahap ini.
                const lastLog = p.logs?.[p.logs.length - 1];
                const labelAksi = lastLog && AKSI_LOG_LABEL[lastLog.action];
                return (
                  <li key={p.stage.id} className={`flex items-center gap-3 px-4 py-2.5 ${p.isCurrent ? "bg-accentbg" : ""}`}>
                    <span className="w-5 shrink-0 text-center text-[11px] font-bold text-ink3">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-ink">{p.stage.labelId}</p>
                      <p className="text-[10.5px] text-ink3">
                        {p.stage.phase}{p.stage.requiresQc && " · Gerbang QC"}{p.stage.requiresPhoto && " · Wajib Foto"}{p.stage.isOptional && " · Opsional"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant={STAGE_LOG_STATUS[p.status]?.tone || "neutral"}>
                        {STAGE_LOG_STATUS[p.status]?.label}
                      </Badge>
                      {lastLog && (
                        <p className="mt-1 text-[10px] text-ink3">{labelAksi} {formatTanggalJam(lastLog.createdAt)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Riwayat Eksekusi (Production Core Slice 3O) — daftar ATTEMPT
              tahap yang SEDANG ditindak sekarang (bisa lebih dari satu kalau
              pernah gagal lalu di-retry). SENGAJA TERPISAH dari "Jalur Tahap
              Produksi" di atas (itu satu baris per TAHAP, bukan per attempt)
              dan dari "Aktivitas" di bawah (itu linimasa GENERIK lintas
              entitas) — ini kosakata level-eksekusi (Touch/Paused/Elapsed). */}
          {executionHistory.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><History size={14} /> Riwayat Eksekusi</CardTitle>
                <CardDescription>{current?.stage.labelId || "Tahap sekarang"} — Touch/Jeda/Elapsed per percobaan.</CardDescription>
              </CardHeader>
              <ul className="divide-y divide-line">
                {executionHistory.slice().reverse().map((a, idx) => {
                  const isOpen = !a.endedAt;
                  const t = isOpen ? liveTiming(a, loadedAt, nowTick) : a.timing;
                  const lastRow = a.rows?.[a.rows.length - 1];
                  return (
                    <li key={a.startedAt ? `${a.startedAt}-${idx}` : idx} className="px-4 py-2.5 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">Percobaan #{executionHistory.length - idx}</span>
                        <Badge variant={STAGE_LOG_STATUS[a.status]?.tone || "neutral"}>{STAGE_LOG_STATUS[a.status]?.label || a.status}</Badge>
                      </div>
                      {t?.timingKnown ? (
                        <p className="mt-1 text-ink2">
                          Touch {formatDurasiDetik(t.touchSeconds)} · Jeda {formatDurasiDetik(t.pausedSeconds)} · Elapsed {formatDurasiDetik(t.elapsedSeconds)}
                        </p>
                      ) : (
                        <p className="mt-1 text-ink3">Durasi tidak tercatat (pencatatan retrospektif).</p>
                      )}
                      {a.pauseReason && (
                        <p className="mt-0.5 text-ink3">Jeda: {PAUSE_REASON_REAL[a.pauseReason]?.label || a.pauseReason}{a.note ? ` — ${a.note}` : ""}</p>
                      )}
                      <p className="mt-0.5 text-[10.5px] text-ink3">
                        {lastRow?.actor?.name ? `Oleh ${lastRow.actor.name} · ` : ""}
                        {a.startTimingKnown ? formatTanggalJam(a.startedAt) : "Waktu mulai tidak tercatat"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {qcFitTests.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Riwayat Uji Berat Badan</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-line">
                {qcFitTests.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">{t.stage.labelId}</span>
                      <Badge variant={t.verdict === "PAS" ? "green" : "orange"}>{t.verdict}</Badge>
                    </div>
                    <p className="mt-0.5 text-ink2">
                      Berat acuan {t.referenceWeightKg} kg
                      {t.customerPreferenceOverride && ` · Override: ${t.customerPreferenceOverride}`}
                      {" · "}{t.testedBy?.name || "—"}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-ink3">{formatTanggalJam(t.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Bahan Digunakan</CardTitle>
              <CardDescription>Dicatat langsung dari sini — stok gudang berkurang otomatis.</CardDescription>
            </CardHeader>

            {materialError && <div className="mx-4 mb-2 rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{materialError}</div>}

            <div className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
              <select
                value={materialId} onChange={(e) => setMaterialId(e.target.value)}
                className="h-9 min-w-[160px] flex-1 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                <option value="">Pilih bahan…</option>
                {materialCatalog.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
              </select>
              <input
                type="number" step="any" value={materialQty} onChange={(e) => setMaterialQty(e.target.value)}
                placeholder="Jumlah (- utk koreksi)"
                className="h-9 w-[150px] rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <input
                type="text" value={materialNote} onChange={(e) => setMaterialNote(e.target.value)}
                placeholder="Catatan (opsional)"
                className="h-9 min-w-[140px] flex-1 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <Button size="sm" onClick={catatBahan} disabled={materialBusy || !materialId || !materialQty}>
                {materialBusy && <Loader2 size={14} className="animate-spin" />} Catat
              </Button>
            </div>

            {materialUsage?.totals.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
                {materialUsage.totals.map((t) => (
                  <Badge key={t.material.id} variant="accent">{t.material.name}: {t.usedQty} {t.material.unit}</Badge>
                ))}
              </div>
            )}

            {materialUsage?.movements.length > 0 ? (
              <ul className="divide-y divide-line">
                {materialUsage.movements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between px-4 py-2 text-[12px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-ink">{m.material.name}</span>
                      <span className="ml-2 text-ink3">{m.createdBy?.name || "—"}</span>
                      {m.note && <p className="text-[11px] text-ink3">{m.note}</p>}
                    </div>
                    <Badge variant={m.type === "ISSUE" ? "accent" : "orange"} className="shrink-0">
                      {m.type === "ISSUE" ? "" : "-"}{Math.abs(Number(m.qty))} {m.material.unit}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[12px] text-ink3">Belum ada bahan dicatat untuk unit ini.</p>
            )}
          </Card>

          {canSeeRevisions && (() => {
            const pending = scopeRevisions?.find((r) => r.status === "PENDING");
            const history = scopeRevisions?.filter((r) => r.status !== "PENDING") || [];
            return (
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Revisi Lingkup</CardTitle>
                  <CardDescription>Temuan bongkar yang mengubah harga/layanan — butuh jawaban customer.</CardDescription>
                </CardHeader>

                {scopeError && <div className="mx-4 mb-2 rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{scopeError}</div>}

                {pending ? (
                  <div className="border-b border-line bg-orangebg px-4 py-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="orange">Menunggu Jawaban Customer</Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] text-ink">{pending.reason}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink2">
                      Selisih Rp{pending.deltaAmount.toLocaleString("id-ID")}
                      {pending.toService && ` · Ke ${pending.toService.labelId}`}
                      {" · "}{pending.createdBy?.name || "—"}
                    </p>
                    {canDecideRevision && (
                      <p className="mt-1.5 text-[11px] text-ink3">
                        Keputusan dicatat di halaman <strong>Revisi Lingkup</strong>, bukan di sini.
                      </p>
                    )}
                  </div>
                ) : canProposeRevision ? (
                  <div className="space-y-2 border-b border-line px-4 py-3">
                    <textarea
                      value={scopeReason} onChange={(e) => setScopeReason(e.target.value)} rows={2}
                      placeholder="Temuan saat bongkar — kenapa harga/layanan perlu berubah *"
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <input
                      type="number" value={scopeDelta} onChange={(e) => setScopeDelta(e.target.value)}
                      placeholder="Selisih harga (Rupiah, boleh negatif) *"
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <select
                      value={scopeToServiceId} onChange={(e) => setScopeToServiceId(e.target.value)}
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
                    >
                      <option value="">Tidak ganti layanan</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.labelId}</option>)}
                    </select>
                    <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-[12px] font-medium text-ink2 hover:border-accent hover:text-accent">
                      <Camera size={15} />
                      {scopePhotos.length > 0 ? `${scopePhotos.length} foto dipilih` : "Foto Temuan (opsional)"}
                      <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handleScopePhotos} />
                    </label>
                    <textarea
                      value={scopeNote} onChange={(e) => setScopeNote(e.target.value)} rows={2}
                      placeholder="Catatan tambahan (opsional)"
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <Button size="sm" className="w-full" onClick={ajukanRevisi} disabled={scopeBusy || !scopeReason.trim() || scopeDelta === ""}>
                      {scopeBusy && <Loader2 size={14} className="animate-spin" />} Ajukan Revisi
                    </Button>
                  </div>
                ) : (
                  <p className="border-b border-line px-4 py-3 text-[12px] text-ink3">Tidak ada revisi yang menunggu jawaban.</p>
                )}

                {history.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {history.map((r) => (
                      <li key={r.id} className="px-4 py-2.5 text-[12px]">
                        <div className="flex items-center justify-between">
                          <span className="text-ink2">{r.reason}</span>
                          <Badge variant={SCOPE_REVISION_STATUS_REAL[r.status]?.tone || "neutral"}>
                            {SCOPE_REVISION_STATUS_REAL[r.status]?.label || r.status}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-ink3">
                          Selisih Rp{r.deltaAmount.toLocaleString("id-ID")}
                          {r.toService && ` · Ke ${r.toService.labelId}`}
                          {r.decidedBy && ` · ${r.decidedBy.name}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : !pending && (
                  <p className="px-4 py-3 text-[12px] text-ink3">Belum pernah ada revisi lingkup untuk unit ini.</p>
                )}
              </Card>
            );
          })()}

          {/* Aktivitas (Production Core Slice 1) — linimasa GENERIK dari
              activity_events, TERPISAH dari "Jalur Tahap Produksi" di atas
              (itu ledger produksi baku/unit_stage_logs). Mencakup mutasi
              yang sebelumnya sama sekali tidak tercatat: perubahan
              prioritas/target produksi, penetapan layanan. */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Aktivitas</CardTitle>
              <CardDescription>Perubahan prioritas, target, dan layanan produksi unit ini.</CardDescription>
            </CardHeader>
            {activityError && <div className="mx-4 mb-2 rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{activityError}</div>}
            <ActivityTimeline events={activity} formatSentence={formatActivitySentence} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-3 text-[13px] font-bold text-ink">Aksi</h3>

            {needsService ? (
              <p className="text-[12px] text-ink3">Tetapkan layanan dulu sebelum bisa memulai tahap.</p>
            ) : belumMulai ? (
              <Button className="w-full" onClick={mulaiTahap} disabled={busy || !firstStage}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai {firstStage?.labelId}
              </Button>
            ) : !current ? (
              <EmptyState icon={CheckCircle2} title="Seluruh tahap selesai" description="Unit sudah menyelesaikan seluruh jalur routing." />
            ) : current.status === "BLOCKED" ? (
              <div className="space-y-2">
                <p className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">
                  Tahap "{current.stage.labelId}" sedang terhambat. Selesaikan hambatannya, lalu mulai lagi.
                </p>
                <Button className="w-full" onClick={mulaiTahap} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai Lagi
                </Button>
              </div>
            ) : current.status === "PAUSED" ? (
              // PAUSED (Production Core Slice 3) — TERPISAH dari BLOCKED di
              // atas: "Lanjutkan" bukan "Mulai Lagi", TIDAK ada form alasan
              // hambatan sama sekali (arsitektur PILIHAN A, lihat backend
              // lib/domain/stageExecution.js).
              <div className="space-y-2">
                <p className="rounded-btn bg-orangebg px-2.5 py-2 text-[11.5px] text-orange">
                  Tahap "{current.stage.labelId}" sedang dijeda
                  {currentAttempt?.pauseReason && ` — ${PAUSE_REASON_REAL[currentAttempt.pauseReason]?.label || currentAttempt.pauseReason}`}
                  {currentAttempt?.note ? `: ${currentAttempt.note}` : ""}.
                </p>
                {currentAttempt?.timing?.timingKnown && (
                  <p className="text-[11.5px] text-ink2">
                    Touch {formatDurasiDetik(liveTiming(currentAttempt, loadedAt, nowTick)?.touchSeconds)} ·
                    {" "}Jeda {formatDurasiDetik(liveTiming(currentAttempt, loadedAt, nowTick)?.pausedSeconds)}
                  </p>
                )}
                <Button className="w-full" onClick={lanjutkanTahap} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Lanjutkan
                </Button>
              </div>
            ) : current.status === "IN_PROGRESS" ? (
              isQcGate ? (
                <div className="space-y-2">
                  <p className="text-[12px] text-ink2">Uji Berat Badan: <strong>{current.stage.labelId}</strong></p>

                  <label className="block text-[11.5px] font-semibold text-ink2">Verdict *</label>
                  <select value={verdict} onChange={(e) => setVerdict(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    {Object.entries(FIT_VERDICT_REAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>

                  <label className="block text-[11.5px] font-semibold text-ink2">Berat Acuan (kg) *</label>
                  <input type="number" min="1" value={referenceWeightKg} onChange={(e) => setReferenceWeightKg(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />

                  <label className="block text-[11.5px] font-semibold text-ink2">Override Preferensi Customer</label>
                  <select value={preferenceOverride} onChange={(e) => setPreferenceOverride(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    <option value="">Tidak ada — ikuti rekomendasi</option>
                    {Object.entries(PREFERENCE_OVERRIDE_REAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  {preferenceOverride && (
                    <label className="flex items-center gap-1.5 text-[11.5px] text-ink2">
                      <input type="checkbox" checked={educationGiven} onChange={(e) => setEducationGiven(e.target.checked)} />
                      Edukasi risiko sudah diberikan ke customer (D-009, wajib)
                    </label>
                  )}

                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-[12px] font-medium text-ink2 hover:border-accent hover:text-accent">
                    {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    {photos.length > 0 ? `${photos.length} foto siap` : "Ambil / Pilih Foto"}
                    <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handlePhotos} disabled={uploading} />
                  </label>
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {photos.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded object-cover" />)}
                    </div>
                  )}
                  {needsPhoto && photos.length === 0 && <p className="text-[11px] text-orange">Tahap ini wajib foto</p>}

                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Catatan (opsional)"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />

                  <Button
                    className="w-full" onClick={catatQc}
                    disabled={busy || !referenceWeightKg || (needsPhoto && photos.length === 0) || (!!preferenceOverride && !educationGiven)}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Simpan Hasil QC
                  </Button>
                </div>
              ) : mode === "fail" ? (
                <div className="space-y-2">
                  <label className="block text-[11.5px] font-semibold text-ink2">Alasan Hambatan *</label>
                  <select value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    {Object.entries(BLOCK_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                  </select>
                  {/* OTHER wajib catatan jelas (Production Core Slice 2A —
                      backend menolak "OTHER" tanpa catatan bermakna, cermin
                      validasinya di sini supaya tombol tidak aktif percuma). */}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder={blockReason === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setMode(null)}>Batal</Button>
                    <Button
                      variant="destructive" size="sm" className="flex-1" onClick={gagalkanTahap}
                      disabled={busy || (blockReason === "OTHER" && note.trim().length < 3)}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Tandai Terhambat
                    </Button>
                  </div>
                </div>
              ) : mode === "complete" ? (
                <div className="space-y-2">
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-[12px] font-medium text-ink2 hover:border-accent hover:text-accent">
                    {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    {photos.length > 0 ? `${photos.length} foto siap` : "Ambil / Pilih Foto"}
                    <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handlePhotos} disabled={uploading} />
                  </label>
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {photos.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded object-cover" />)}
                    </div>
                  )}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Catatan (opsional)"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                  {needsPhoto && photos.length === 0 && <p className="text-[11px] text-orange">Tahap ini wajib foto</p>}
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setMode(null)}>Batal</Button>
                    <Button size="sm" className="flex-1" onClick={selesaikanTahap} disabled={busy || (needsPhoto && photos.length === 0)}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Simpan
                    </Button>
                  </div>
                </div>
              ) : mode === "pause" ? (
                // Dialog Jeda (Production Core Slice 3) — Alasan wajib pilih,
                // Catatan wajib kalau "Lainnya" (cermin validatePauseReason() backend).
                <div className="space-y-2">
                  <label className="block text-[11.5px] font-semibold text-ink2">Alasan Jeda *</label>
                  <select value={pauseReasonDraft} onChange={(e) => setPauseReasonDraft(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    {Object.entries(PAUSE_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                  </select>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder={pauseReasonDraft === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setMode(null)}>Batal</Button>
                    <Button
                      variant="secondary" size="sm" className="flex-1" onClick={jedaTahap}
                      disabled={busy || (pauseReasonDraft === "OTHER" && note.trim().length < 3)}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />} Jeda
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] text-ink2">Sedang berjalan: <strong>{current.stage.labelId}</strong></p>
                  {/* Touch/Elapsed/PerformedBy (Production Core Slice 3) —
                      live tanpa polling backend, lihat liveTiming() di atas. */}
                  {currentAttempt?.timing?.timingKnown && (
                    <p className="text-[11.5px] text-ink2">
                      Touch {formatDurasiDetik(liveTiming(currentAttempt, loadedAt, nowTick)?.touchSeconds)} ·
                      {" "}Elapsed {formatDurasiDetik(liveTiming(currentAttempt, loadedAt, nowTick)?.elapsedSeconds)}
                      {currentAttempt.rows?.[currentAttempt.rows.length - 1]?.actor?.name &&
                        ` · ${currentAttempt.rows[currentAttempt.rows.length - 1].actor.name}`}
                    </p>
                  )}
                  <Button className="w-full" onClick={() => setMode("complete")}>
                    <CheckCircle2 size={14} /> Tandai Selesai
                  </Button>
                  <Button variant="secondary" className="w-full" onClick={() => setMode("pause")}>
                    <PauseCircle size={14} /> Jeda
                  </Button>
                  {current.stage.isOptional && (
                    <Button variant="secondary" className="w-full" onClick={lewatiTahap} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />} Lewati
                    </Button>
                  )}
                  <Button variant="ghost" className="w-full" onClick={() => setMode("fail")}>
                    <AlertTriangle size={14} /> Tandai Terhambat
                  </Button>
                </div>
              )
            ) : (
              // READY — tahap sudah ditunjuk currentStageId tapi belum di-start.
              <div className="space-y-2">
                <p className="text-[12px] text-ink2">Tahap berikutnya: <strong>{current.stage.labelId}</strong></p>
                <Button className="w-full" onClick={mulaiTahap} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai Tahap
                </Button>
                {current.stage.isOptional && (
                  <Button variant="secondary" className="w-full" onClick={lewatiTahap} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <SkipForward size={14} />} Lewati
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Blokir Produksi Aktif (Production Core Slice 2A/2H) — TERPISAH
              dari kartu Aksi: "Mulai Lagi" di atas SUDAH auto-resolve blokir
              (lihat startStage() di backend), kartu ini untuk mencatat
              PENYELESAIANNYA secara eksplisit TANPA harus langsung restart
              (mis. supervisor mengonfirmasi bahan sudah datang duluan). */}
          {data.activeBlocker && (
            <Card className="border-l-[3px] border-red p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-red">Blokir Produksi Aktif</h3>
                <Badge variant="red">{BLOCK_REASON_REAL[data.activeBlocker.reason]?.label || data.activeBlocker.reason}</Badge>
              </div>
              {data.activeBlocker.note && <p className="text-[12px] text-ink2">{data.activeBlocker.note}</p>}
              <dl className="mt-2 space-y-1 text-[11.5px]">
                <div className="flex justify-between"><dt className="text-ink3">Dibuka</dt><dd className="text-ink">{formatTanggalJam(data.activeBlocker.openedAt)}{data.activeBlocker.openedBy?.name ? ` · ${data.activeBlocker.openedBy.name}` : ""}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-ink3">Durasi</dt>
                  <dd className="text-ink">{formatDurasiMenit(Math.floor((Date.now() - new Date(data.activeBlocker.openedAt).getTime()) / 60000))}</dd>
                </div>
              </dl>

              {!canResolveBlocker ? (
                <p className="mt-3 text-[11px] text-ink3">Hanya tim produksi/QC yang bisa menyelesaikan blokir ini.</p>
              ) : !resolvingBlocker ? (
                <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={() => setResolvingBlocker(true)}>
                  Resolve Blocker
                </Button>
              ) : (
                <div className="mt-3 space-y-2">
                  {blockerError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{blockerError}</div>}
                  <textarea
                    value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={2}
                    placeholder="Bagaimana hambatan ini diselesaikan? (opsional)"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setResolvingBlocker(false); setResolutionNote(""); }}>Batal</Button>
                    <Button size="sm" className="flex-1" onClick={selesaikanBlokir} disabled={blockerBusy}>
                      {blockerBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Konfirmasi Selesai
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Prioritas & Target Produksi (Production Core Slice 1) — TERPISAH
              dari Aksi di atas: ini metadata perencanaan (siapa/apa yang
              harus dikerjakan duluan), bukan transisi tahap. Read-only untuk
              yang tidak punya UNIT_ROUTING_WRITE (pekerja produksi/QC Leader
              tetap bisa MELIHAT prioritasnya, cuma tidak bisa mengubah). */}
          <Card className="p-4">
            <h3 className="mb-3 text-[13px] font-bold text-ink">Prioritas & Target Produksi</h3>
            {canEditProduction ? (
              <div className="space-y-2">
                {prodError && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[11.5px] text-red">{prodError}</div>}
                <label className="block text-[11.5px] font-semibold text-ink2">Prioritas</label>
                <select
                  value={priorityDraft} onChange={(e) => setPriorityDraft(e.target.value)}
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
                >
                  {Object.entries(PRODUCTION_PRIORITY_REAL).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                </select>
                <label className="block text-[11.5px] font-semibold text-ink2">Target Produksi Selesai</label>
                <DatePicker value={dueDateDraft} onChange={setDueDateDraft} placeholder="Belum ditetapkan" className="w-full" />
                <Button
                  size="sm" className="w-full" onClick={simpanPrioritas}
                  disabled={prodBusy || (priorityDraft === (unit.priority || "NORMAL") &&
                    dueDateDraft === (unit.productionDueAt ? unit.productionDueAt.slice(0, 10) : ""))}
                >
                  {prodBusy && <Loader2 size={14} className="animate-spin" />} Simpan
                </Button>
              </div>
            ) : (
              <dl className="space-y-1.5 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-ink3">Prioritas</dt>
                  <dd className="text-ink">{PRODUCTION_PRIORITY_REAL[unit.priority]?.label || "Normal"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink3">Target Selesai</dt>
                  <dd className="text-ink">{unit.productionDueAt ? formatTanggalJam(unit.productionDueAt) : "—"}</dd>
                </div>
              </dl>
            )}

            {/* Risiko (Production Core Slice 2C) — SELALU tampil, dihitung
                server (GET /units/:id/timeline), TIDAK PERNAH diedit di sini.
                Overdue MENANG atas at-risk (spec: kondisi yang lebih kuat). */}
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-ink2">Risiko</span>
                {data.overdue?.isOverdue ? (
                  <Badge variant="red">Overdue {formatDurasiMenit(data.overdue.overdueMinutes)}</Badge>
                ) : data.risk?.isAtRisk ? (
                  <Badge variant={data.risk.riskLevel === "HIGH" ? "red" : "orange"}>At Risk</Badge>
                ) : unit.productionDueAt ? (
                  <Badge variant="green">Aman</Badge>
                ) : (
                  <span className="text-[11.5px] text-ink3">—</span>
                )}
              </div>
              {!data.overdue?.isOverdue && data.risk?.isAtRisk && (
                <p className="mt-1 text-[11px] text-ink2">{data.risk.riskReasons.map((r) => r.label).join(" · ")}</p>
              )}
              {!unit.productionDueAt && !data.risk?.isAtRisk && (
                <p className="mt-1 text-[11px] text-ink3">Belum ada target tanggal — risiko belum bisa dihitung.</p>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 text-[13px] font-bold text-ink">Info Unit</h3>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex justify-between"><dt className="text-ink3">Kasur</dt><dd className="text-ink">{[unit.merk, unit.ukuran].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">Lini</dt><dd className="text-ink">{unit.serviceLine ? SERVICE_LINE_REAL[unit.serviceLine]?.label : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">Lokasi Simpan</dt><dd className="text-ink">{unit.storageLocation || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">Telepon</dt><dd className="text-ink">{unit.order?.customer?.phone || "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
