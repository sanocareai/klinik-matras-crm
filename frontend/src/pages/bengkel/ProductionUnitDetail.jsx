import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Camera, CheckCircle2, Loader2, PlayCircle, XCircle, SkipForward,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { formatTanggalJam } from "@/utils/formatDate.js";
import { rolesOf } from "@/lib/roles.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  UNIT_STATUS_REAL, SERVICE_LINE_REAL, STAGE_LOG_STATUS, BLOCK_REASON_REAL,
  FIT_VERDICT_REAL, PREFERENCE_OVERRIDE_REAL, SCOPE_REVISION_STATUS_REAL,
} from "@/features/bengkel/unitStatus.js";

// Label kejadian log tahap, dipasangkan dengan tanggalnya di "Jalur Tahap
// Produksi" (D-038, 31 Agustus 2026) — enum action dari unit_stage_logs.
const AKSI_LOG_LABEL = {
  START: "Dimulai",
  PAUSE: "Dijeda",
  COMPLETE: "Selesai",
  FAIL: "Gagal",
  SKIP: "Dilewati",
};

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

  const [mode, setMode] = useState(null); // null | "complete" | "fail"
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [blockReason, setBlockReason] = useState("MATERIAL_SHORTAGE");
  const [uploading, setUploading] = useState(false);

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
        setMode(null); setPhotos([]); setNote("");
        setVerdict("PAS"); setReferenceWeightKg(""); setPreferenceOverride(""); setEducationGiven(false);
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

  useEffect(() => { load(); loadMaterials(); loadScopeRevisions(); }, [load, loadMaterials, loadScopeRevisions]);
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

  const { unit, path, qcFitTests, needsService } = data;
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
        actions={<Badge variant={UNIT_STATUS_REAL[unit.status]?.tone || "neutral"}>{UNIT_STATUS_REAL[unit.status]?.label || unit.status}</Badge>}
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
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Catatan (opsional)"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setMode(null)}>Batal</Button>
                    <Button variant="destructive" size="sm" className="flex-1" onClick={gagalkanTahap} disabled={busy}>
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
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] text-ink2">Sedang berjalan: <strong>{current.stage.labelId}</strong></p>
                  <Button className="w-full" onClick={() => setMode("complete")}>
                    <CheckCircle2 size={14} /> Tandai Selesai
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
