import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, PackageX, WifiOff } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { STAGE_LOG_STATUS } from "@/features/bengkel/unitStatus.js";
import { actionLabel, formatMinutes, friendlyError, isQuickAction, isRetryableError, waitCopy } from "@/features/production/experience.js";
import { materialBadge } from "@/features/production/unitCardModel.js";
import { GantiKainNote, JobPhoto, PriorityChip, ProgressLine, SalesNote, SalesServicesLine, StageChip, StatusChip } from "./JobCard.jsx";
import { DELAY_ACTION_LABEL, FINISH_ACTION_LABEL, RESUME_ACTION_LABEL, SKIP_ACTION_LABEL, SKIP_LABEL, delayKindText, delayStatusText, resumeInfo } from "@/features/production/productionLabels.js";
import { stepOf } from "@/features/production/experience.js";
import { V1ActionBar, V1MaterialsPanel } from "./V1Panels.jsx";
import { ShortageSheet, StepSheet, intentKeys } from "./workerSheets.jsx";
import { DelaySheet, FinishSheet, SkipSheet } from "./adaptationSheets.jsx";
import { ComponentNotesPanel } from "@/features/production/componentNotes/ComponentNotesPanel.jsx";
import { isV1Actionable, jobFromV1, jobFromV2, submitState } from "./workerAppModel.js";

// Detail pekerjaan: progres dari server, bahan, dokumentasi, dan SATU aksi utama (batang lengket) sesuai kemampuan & tahap.
//  V2: `next` dari server (aksi cepat / lembar isian / wizard diagnosis); konflik revisi -> muat ulang. V1: keadaan tahap dari timeline server; tahap V1 TIDAK dipetakan ke 12 langkah V2.
const POLL_MS = 30_000;
const Section = ({ title, aside, children, testid }) => (
  <section className="wa-card p-4" data-testid={testid}>
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="m-0 text-[15px] font-extrabold text-ink">{title}</h2>{aside}</div>
    {children}
  </section>
);
const TONE = { accent: "bg-accentbg text-accent", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", green: "bg-greenbg text-green", neutral: "bg-inset text-ink2" };

function Identity({ job, extra = null }) {
  return (
    <div className="wa-card" data-testid="job-identity">
      <div className="relative"><JobPhoto job={job} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5"><PriorityChip priority={job.priority} /></div>
        <div className="absolute right-3 top-3"><StatusChip job={job} /></div>
      </div>
      <div className="space-y-2.5 p-4">
        <p data-testid="job-customer" className="wa-wrap m-0 text-[22px] font-extrabold leading-snug text-ink">{job.customerName}</p>
        <p data-testid="job-ids" className="wa-wrap m-0 text-[13.5px] text-ink3">{[job.orderNumber, job.unitCode].filter(Boolean).join(" · ")}{job.stationLabel ? ` · ${job.stationLabel}` : ""}</p>
        <SalesServicesLine job={job} />
        {job.kasur && <p data-testid="job-kasur" className="wa-wrap m-0 text-[13.5px] text-ink2">{job.kasur}</p>}
        <SalesNote job={job} clamp={false} />
        <GantiKainNote job={job} />
        {extra}
        <div className="pt-1"><StageChip job={job} /></div>
      </div>
    </div>
  );
}

function StepList({ steps, lane }) {
  const mine = steps.filter((s) => (lane === "CORNER" ? s.no >= 9 : s.no <= 9));
  return (
    <ol className="m-0 list-none space-y-1 p-0" aria-label="Tahap">
      {mine.map((s) => (
        <li key={s.no} data-step-status={s.status} className={`flex items-center gap-3 rounded-btn px-3 py-2 text-[13.5px] ${s.status === "CURRENT" ? "bg-accentbg font-semibold text-accent" : s.status === "NA" ? "text-ink3 line-through" : s.status === "SKIPPED" ? "bg-inset text-ink3" : "text-ink2"}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.status === "DONE" ? "bg-green text-white" : s.status === "CURRENT" ? "bg-accent text-white" : "bg-inset text-ink3"}`}>{s.status === "DONE" ? <CheckCircle2 size={14} aria-hidden /> : s.no}</span>
          <span className="flex-1">{s.label}</span>
          {s.status === "NA" && <span className="text-[11px]">tidak berlaku</span>}
          {s.status === "SKIPPED" && <span data-testid="step-skipped" className="text-[11px] font-semibold">{SKIP_LABEL}</span>}
          {s.status === "WAITING" && <span className="text-[11px] text-orange">menunggu</span>}
        </li>
      ))}
    </ol>
  );
}

function EvidenceList({ evidence }) {
  if (!evidence?.length) return <p className="m-0 text-[13.5px] text-ink3" data-testid="evidence-empty">Belum ada dokumentasi.</p>;
  return (
    <ul className="m-0 list-none space-y-2 p-0" data-testid="evidence-list">
      {[...evidence].reverse().slice(0, 8).map((e) => (
        <li key={e.id} className="rounded-btn bg-inset p-2.5">
          <p className="m-0 text-[12.5px] text-ink2"><b className="text-ink">{e.stepNo}. {e.stepLabel}</b>{e.version > 1 ? ` (ke-${e.version})` : ""}{e.payload?.verdict ? ` · ${String(e.payload.verdict).replace("_", " ")}` : ""}{e.actor ? ` · ${e.actor}` : ""}</p>
          {e.media?.length > 0 && <div className="mt-1.5 flex gap-1.5 overflow-x-auto">{e.media.map((m) => (m.kind === "video" ? <video key={m.url} src={m.url} controls preload="none" className="h-20 w-28 shrink-0 rounded object-cover" /> : <img key={m.url} src={m.url} alt="Bukti" loading="lazy" className="h-20 w-20 shrink-0 rounded object-cover" />))}</div>}
        </li>
      ))}
    </ul>
  );
}

function OfflineNote() {
  return <p role="status" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] font-semibold text-orange"><WifiOff size={15} className="mt-px shrink-0" aria-hidden /> {submitState({ online: false, busy: false }).reason}</p>;
}

// ================= V2 =================
function V2Detail({ job, lane, onBack, onChanged }) {
  const online = useOnline();
  const [card, setCard] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [finishedMsg, setFinishedMsg] = useState(""); // setelah Selesaikan Produksi kartu hilang dari antrean: tampilkan hasilnya, jangan langsung "tidak lagi di antrean"
  const [sheet, setSheet] = useState(null); // step | shortage | skip | finish | delay
  const [quickBusy, setQuickBusy] = useState(false);
  const sheetRef = useRef(null); sheetRef.current = sheet;
  const loadCard = useCallback(async () => { try { setCard(await api.getProductionV2Card(job.id)); setError(""); } catch (e) { setError(friendlyError(e)); } }, [job.id]);
  useEffect(() => { setCard(null); loadCard(); }, [loadCard]);
  useEffect(() => { const t = () => { if (document.visibilityState === "visible" && !sheetRef.current) loadCard(); }; const id = setInterval(t, POLL_MS); document.addEventListener("visibilitychange", t); return () => { clearInterval(id); document.removeEventListener("visibilitychange", t); }; }, [loadCard]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);

  const view = card ? jobFromV2(card) : job;
  const next = card?.next;
  const mineNow = !!next && next.action !== "WAIT" && (lane === "CORNER" ? next.actor === "CORNER" : next.actor === "TABLE");
  const gate = submitState({ online, busy: quickBusy });
  const afterChange = async () => { await loadCard(); onChanged?.(); };

  async function quick() {
    setQuickBusy(true); setError("");
    const key = intentKeys.keyFor(card.runId, next.stepNo, card.revision);
    try {
      await api.recordProductionV2Step(card.runId, next.stepNo, { expectedRevision: card.revision, workCenterId: card.workCenterId, payload: {}, media: [] }, key);
      intentKeys.release(card.runId, next.stepNo, card.revision);
      setNotice("Tersimpan."); await afterChange();
    } catch (e) {
      if (!isRetryableError(e)) intentKeys.release(card.runId, next.stepNo, card.revision);
      setError(friendlyError(e)); loadCard();
    } finally { setQuickBusy(false); }
  }
  // Flow adaptasi (slice 2)
  const adaptation = !!card?.adaptation;
  const canSkip = adaptation && mineNow && !card.activeOp && ["START_WITH_EVIDENCE", "START", "START_CORNER", "FINISH"].includes(next?.action);
  const canFinish = adaptation && !!next && !["PENDING_ARRIVAL", "COMPLETED", "RUN_CANCELLED"].includes(next.wait);
  const readyToFinish = next?.wait === "READY_TO_FINISH";
  const canDelay = mineNow && card?.activeOp?.status === "ACTIVE";
  async function resumeWork() {
    setQuickBusy(true); setError("");
    try { await api.resumeProductionWork(card.unit.id, { expectedRevision: card.revision }); setNotice("Pekerjaan dilanjutkan."); await afterChange(); }
    catch (e) { setError(friendlyError(e)); loadCard(); } finally { setQuickBusy(false); }
  }
  const canShortage = lane === "TABLE" && card && !card.shortage && next?.stepNo && next.stepNo >= 3 && next.stepNo <= 8 && (next.action !== "WAIT" || next.wait === "MATERIAL_NOT_READY");
  const mat = card ? materialBadge(card) : null;

  if (finishedMsg) {
    return (
      <div data-testid="worker-unit-detail" data-unit-code={job.unitCode} data-source="V2">
        <div role="status" data-testid="finish-done" className="rounded-card bg-surface p-5 text-center">
          <p className="m-0 text-[17px] font-bold text-ink">Produksi selesai</p>
          <p className="m-0 mt-1 text-[13.5px] text-ink2">{job.unitCode} — {finishedMsg}</p>
          <button type="button" data-testid="finish-done-back" onClick={() => { onChanged?.(); onBack?.(); }} className="wa-primary mt-4">Kembali ke Pekerjaan Saya</button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="worker-unit-detail" data-unit-code={job.unitCode} data-source="V2">
      {notice && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green">{notice}</div>}
      {error && <div role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      <div className="wa-detail">
        <div className="space-y-3.5">
          <Identity job={view} extra={card && (
            <dl className="m-0 grid grid-cols-2 gap-2 text-[13px]">
              <div className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Berat badan</dt><dd className="m-0 font-semibold text-ink">{card.customer.weightKg ? `${card.customer.weightKg} kg` : "—"}</dd></div>
              <div className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Posisi tidur</dt><dd className="m-0 font-semibold text-ink">{card.customer.sleepPosition || "Belum dicatat Sales"}</dd></div>
              <div className="col-span-2 min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Keluhan</dt><dd className="wa-wrap m-0 font-semibold text-ink">{card.customer.complaints?.length ? card.customer.complaints.join(", ") : "—"}</dd></div>
            </dl>
          )} />
          {card?.warnings?.filter((w) => w.code === "TERLAMBAT").map((w) => <p key={w.code} className="m-0 flex items-center gap-2 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange"><AlertTriangle size={15} aria-hidden /> {w.text}</p>)}
        </div>
        <div className="space-y-3.5">
          {!card ? <div className="space-y-3"><div className="h-28 animate-pulse rounded-card bg-inset" /><div className="h-28 animate-pulse rounded-card bg-inset" /></div> : (
            <>
              <Section title="Progres" testid="section-progres" aside={card.timer?.elapsedMinutes ? <span className="flex items-center gap-1 text-[12.5px] text-ink3"><Clock size={13} aria-hidden /> {formatMinutes(card.timer.elapsedMinutes)}</span> : null}>
                <div className="mb-3"><ProgressLine job={view} /></div>
                <StepList steps={card.steps} lane={lane} />
              </Section>
              <Section title="Catatan Komponen" testid="section-komponen"><ComponentNotesPanel unitId={card.unit.id} unitCode={card.unit.unitCode} stepNo={next?.stepNo ?? null} /></Section>
              <Section title="Bahan" testid="section-bahan" aside={card.shortage ? <Badge variant="red">Bahan kurang</Badge> : mat ? <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONE[mat.tone] || TONE.neutral}`}>{mat.label}</span> : null}>
                {card.shortage && <div className="mb-3 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red"><p className="m-0 font-bold" data-testid="delay-status">{delayStatusText("MATERIAL_SHORTAGE")}</p><p className="m-0 mt-0.5 text-[12.5px]" data-testid="resume-who">{resumeInfo({ source: "SHORTAGE", reason: "MATERIAL_SHORTAGE", canResume: false }).text}</p><ul className="m-0 mt-1 list-disc pl-5">{card.shortage.items.map((i) => <li key={i.materialId}>{i.name}{i.qty ? ` — ${i.qty}` : ""}</li>)}</ul></div>}
                {card.bom?.length ? <ul className="m-0 list-none space-y-1.5 p-0" data-testid="bom-list">{card.bom.map((b) => <li key={b.id} className="flex items-center justify-between gap-2 rounded-btn bg-inset px-3 py-2 text-[14px]"><span className="min-w-0 truncate font-semibold text-ink">{b.name}{b.supplemental ? " (tambahan)" : ""}</span><span className="shrink-0 tabular-nums text-ink2">{b.qty} {b.uom}</span></li>)}</ul> : <p className="m-0 text-[13.5px] text-ink3">{card.materialStatus?.label || "Rencana bahan belum dibuat"} — rencana bahan muncul setelah diagnosis.</p>}
                {canDelay && <button type="button" data-testid="open-delay" onClick={() => setSheet("delay")} className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-btn bg-redbg text-[15px] font-bold text-red"><PackageX size={19} aria-hidden /> {DELAY_ACTION_LABEL}</button>}
                {!canDelay && canShortage && <button type="button" data-testid="open-shortage" onClick={() => setSheet("shortage")} className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-btn bg-redbg text-[15px] font-bold text-red"><PackageX size={19} aria-hidden /> {DELAY_ACTION_LABEL}</button>}
              </Section>
              <Section title="Dokumentasi" testid="section-dokumentasi"><EvidenceList evidence={card.evidence} /></Section>
            </>
          )}
        </div>
      </div>

      {/* Aksi utama: SATU tombol sesuai `next` server (tidak ada tombol yang melewati guard). */}
      {card && (
        <div className="wa-actionbar" data-testid="v2-actionbar"><div className="wa-actionbar-inner">
          {!online && <OfflineNote />}
          {mineNow ? (
            <>
              {next.rework && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Uji tekstur {String(next.lastVerdict || "").replace("_", " ").toLowerCase()} — sesuaikan lapisan lalu kirim ulang bukti.</p>}
              {card.activeOp?.status === "PAUSED" && card.activeOp.delayKind && <p data-testid="delay-kind-note" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red"><b>{delayKindText(card.activeOp.delayKind, card.activeOp.delayNote)}.</b> Tekan “{RESUME_ACTION_LABEL}” setelah kendalanya selesai.</p>}
              <button type="button" className="wa-primary" data-testid={next.action === "RESUME" ? "resume-work" : next.stepNo === 5 ? "open-diagnosis" : "v2-primary"} data-mutates={next.action === "RESUME" || isQuickAction(next) ? "" : undefined} disabled={gate.disabled && (next.action === "RESUME" || isQuickAction(next))} onClick={() => (next.action === "RESUME" ? resumeWork() : isQuickAction(next) ? quick() : setSheet("step"))}>
                {quickBusy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}{actionLabel(next, { stageLabel: card.activeOp?.stageLabel, track: card.track })}
              </button>
            </>
          ) : (
            <div data-testid="v2-wait" className="rounded-btn bg-inset px-3 py-3">
              <p className="m-0 text-[14.5px] font-bold text-ink">{next?.action === "WAIT" ? waitCopy(next).title : "Tahap berikutnya milik tim lain"}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink3">{next?.action === "WAIT" ? waitCopy(next).text : lane === "CORNER" ? "Unit masih dikerjakan di meja bongkar." : "Unit sedang di meja Corner."}</p>
              {readyToFinish && <button type="button" data-mutates data-testid="open-finish-primary" onClick={() => setSheet("finish")} className="wa-primary mt-3">{FINISH_ACTION_LABEL}</button>}
            </div>
          )}
          {(canSkip || (canFinish && !readyToFinish)) && (
            <div className="grid grid-cols-2 gap-2">
              {canSkip ? <button type="button" data-mutates data-testid="open-skip" onClick={() => setSheet("skip")} className="flex min-h-[48px] items-center justify-center rounded-btn bg-inset text-[14px] font-bold text-ink2">{SKIP_ACTION_LABEL}</button> : <span />}
              {canFinish && !readyToFinish ? <button type="button" data-mutates data-testid="open-finish" onClick={() => setSheet("finish")} className="flex min-h-[48px] items-center justify-center rounded-btn bg-inset text-[14px] font-bold text-ink2">{FINISH_ACTION_LABEL}</button> : <span />}
            </div>
          )}
        </div></div>
      )}

      {sheet === "step" && card && next && <StepSheet card={card} next={next} onClose={() => setSheet(null)} onSubmitted={async (result) => { if (result) { setSheet(null); setNotice(result.verdict && result.verdict !== "PAS" ? "Hasil uji tercatat — lanjutkan rework lapisan." : "Tahap tersimpan."); } await afterChange(); }} />}
      {sheet === "skip" && card && next && <SkipSheet card={card} next={next} stageLabel={stepOf(next.stepNo, card.track)?.label} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); setNotice("Tahap dicatat dilewati (Adaptasi sistem)."); await afterChange(); }} />}
      {sheet === "finish" && card && <FinishSheet card={card} onClose={() => setSheet(null)} onDone={(res) => { setSheet(null); setFinishedMsg(`Unit Siap Kirim. QC tidak dilakukan; ${res.skippedSteps?.length ?? 0} tahap dicatat dilewati.`); }} />}
      {sheet === "delay" && card && <DelaySheet card={card} onClose={() => setSheet(null)} onPickMaterial={() => setSheet("shortage")} onDone={async () => { setSheet(null); setNotice("Pekerjaan ditunda."); await afterChange(); }} />}
      {sheet === "shortage" && card && <ShortageSheet card={card} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); setNotice("Gudang sudah diberi tahu."); await afterChange(); }} />}
    </div>
  );
}

// ================= V1 =================
function V1Detail({ job, roles, onChanged, refreshV1Unit, fetchV1Queue, onHandoff }) {
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { const t = await api.getUnitTimeline(job.unitId); setTimeline(t); setError(""); return t; } catch (e) { setError(e.message || "Gagal memuat"); return null; } }, [job.unitId]);
  useEffect(() => { setTimeline(null); load(); }, [load]);
  const view = timeline ? jobFromV1(job.item, timeline) : job;
  const afterChange = async () => { await load(); await refreshV1Unit?.(job.unitId); await onChanged?.(); };
  const v1 = job.v1; // keadaan antrean SEGAR dari server (props dari daftar yang dimuat ulang) — bukan salinan lama
  // Penjaga tombol basi: validasi ulang ke server sebelum aksi apa pun dikirim.
  const beforeAction = async () => {
    try {
      const fresh = await fetchV1Queue?.();
      const it = fresh?.items?.find((i) => i.unit.id === job.unitId);
      const ok = !!it && isV1Actionable(it.state) && it.state === v1.state && it.stage?.id === v1.stage?.id;
      return ok ? { ok: true } : { ok: false, message: "Penugasan atau keadaan tahap sudah berubah — daftar dimuat ulang. Aksi tidak dikirim." };
    } catch { return { ok: true }; } // tak ada jaringan: server tetap pemutus akhir (aksi gagal aman)
  };
  const photos = (timeline?.executionHistory || []).flatMap((h) => (h.photoUrls || []).map((u) => ({ url: u, at: h.createdAt, action: h.action })));

  return (
    <div data-testid="worker-unit-detail" data-unit-code={job.unitCode} data-source="V1">
      {error && <div role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      <div className="wa-detail">
        <div className="space-y-3.5">
          <Identity job={view} extra={<>
            {v1.wait && <div data-testid="v1-wait-panel" role="status" className="rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange"><p className="m-0 font-bold">{v1.wait.title}</p><p className="m-0 mt-0.5">{v1.wait.text}</p></div>}
            <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2">Data pelanggan lain (berat badan, keluhan) belum tercatat untuk unit ini.</p>
          </>} />
          {timeline?.activeBlocker && <p className="m-0 flex items-start gap-2 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red"><AlertTriangle size={15} className="mt-px shrink-0" aria-hidden /> <span data-testid="delay-status">{delayStatusText(timeline.activeBlocker.reason, timeline.activeBlocker.note)}</span></p>}
        </div>
        <div className="space-y-3.5">
          {!timeline ? <div className="space-y-3"><div className="h-28 animate-pulse rounded-card bg-inset" /><div className="h-28 animate-pulse rounded-card bg-inset" /></div> : (
            <>
              <Section title="Progres" testid="section-progres">
                <div className="mb-3"><ProgressLine job={view} /></div>
                {timeline.path?.length ? (
                  <ol className="m-0 list-none space-y-1 p-0" aria-label="Tahap pengerjaan">
                    {timeline.path.map((p, i) => (
                      <li key={p.stage.id} className={`flex items-center gap-3 rounded-btn px-3 py-2 text-[13.5px] ${p.isCurrent ? "bg-accentbg font-semibold text-accent" : "text-ink2"}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${p.status === "DONE" ? "bg-green text-white" : p.isCurrent ? "bg-accent text-white" : "bg-inset text-ink3"}`}>{p.status === "DONE" ? <CheckCircle2 size={14} aria-hidden /> : i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{p.stage.labelId}</span>
                        <Badge variant={STAGE_LOG_STATUS[p.status]?.tone || "neutral"}>{STAGE_LOG_STATUS[p.status]?.label || p.status}</Badge>
                      </li>
                    ))}
                  </ol>
                ) : <p className="m-0 text-[13.5px] text-ink3">Tahap pengerjaan belum tersusun — rute pengerjaan belum ditentukan.</p>}
              </Section>
              <Section title="Bahan" testid="section-bahan"><V1MaterialsPanel unitId={job.unitId} roles={roles} onChanged={onChanged} /></Section>
              <Section title="Dokumentasi" testid="section-dokumentasi">
                {photos.length ? <div className="flex flex-wrap gap-2" data-testid="evidence-list">{photos.slice(-12).map((p) => <img key={p.url} src={p.url} alt="Dokumentasi tahap" loading="lazy" className="h-20 w-20 rounded-btn object-cover" />)}</div> : <p className="m-0 text-[13.5px] text-ink3" data-testid="evidence-empty">Belum ada foto dokumentasi.</p>}
              </Section>
            </>
          )}
        </div>
      </div>
      {timeline && v1.actionable && <V1ActionBar job={view} timeline={timeline} roles={roles} onChanged={afterChange} state={v1.state} beforeAction={beforeAction} onHandoff={() => onHandoff?.(job)} />}
      {timeline && !v1.actionable && (
        <div className="wa-actionbar" data-testid="v1-info-bar"><div className="wa-actionbar-inner">
          <p data-testid="v1-no-action" className="m-0 rounded-btn bg-inset px-3 py-3 text-[13.5px] font-semibold text-ink2">{v1.wait ? `${v1.wait.title} — belum ada tindakan untuk Anda.` : (v1.state === "BLOCKED" ? resumeInfo({ source: "BLOCKER", reason: timeline?.activeBlocker?.reason, canResume: false }).text : "Belum ada tindakan yang tersedia.")}</p>
        </div></div>
      )}
    </div>
  );
}

export default function JobDetail(props) { // props: { job, lane, roles, onChanged, refreshV1Unit, fetchV1Queue, onHandoff }
  return props.job.source === "V1" ? <V1Detail {...props} /> : <V2Detail {...props} />;
}
