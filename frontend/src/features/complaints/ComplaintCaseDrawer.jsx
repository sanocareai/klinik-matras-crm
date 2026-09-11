import React, { useEffect, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, Save, Truck, Package, ClipboardCheck, MessageSquare, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { ActivityTimeline } from "@/components/ui/activity-timeline.jsx";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggal, formatTanggalJam } from "@/utils/formatDate.js";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, WARRANTY_LABEL, OWNER_LABEL,
  STATUS_LABEL, STATUS_TONE, ALLOWED_TRANSITIONS, formatComplaintActivitySentence,
} from "./complaintLabels.js";

const JOB_TYPE_LABEL = { PICKUP: "Pengambilan/Inspeksi", DELIVERY: "Pengiriman" };
const JOB_STATUS_LABEL = {
  UNSCHEDULED: "Belum Dijadwalkan", SCHEDULED: "Dijadwalkan", ASSIGNED: "Ditugaskan",
  EN_ROUTE: "Dalam Perjalanan", ARRIVED: "Tiba", COMPLETED: "Selesai", FAILED: "Gagal", RESCHEDULED: "Dijadwalkan Ulang",
};

function Section({ title, children }) {
  return (
    <div className="border-b border-line pb-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">{title}</p>
      {children}
    </div>
  );
}

// Drawer TUNGGAL dipakai lintas divisi (Sales/Delivery/Produksi/Warehouse/QC)
// — pola sama dengan JobDetailDrawer/RevisionRequestDrawer: SATU komponen,
// aksi yang ditampilkan sama untuk semua orang, backend yang menolak kalau
// role tidak berhak (lihat constants/permissions.js) — bukan disembunyikan
// per-role di sini (mengikuti gaya drawer lain di repo ini, TIDAK ada
// pengecekan permission client-side sama sekali).
export default function ComplaintCaseDrawer({ open, caseId, onClose, onChanged }) {
  const [kase, setKase] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [rootCause, setRootCause] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolutionCost, setResolutionCost] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [jobType, setJobType] = useState("PICKUP");

  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [matId, setMatId] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matPriority, setMatPriority] = useState("NORMAL");

  const [showQcForm, setShowQcForm] = useState(false);
  const [qcTests, setQcTests] = useState([]);
  const [qcId, setQcId] = useState("");

  const load = useCallback(() => {
    if (!caseId) return;
    setLoading(true);
    setError("");
    Promise.all([api.getComplaintCase(caseId), api.getActivity("complaint", caseId)])
      .then(([c, act]) => {
        setKase(c);
        setActivity(act.events || []);
        setRootCause(c.rootCause || "");
        setResolution(c.resolution || "");
        setResolutionCost(c.resolutionCost != null ? String(c.resolutionCost) : "");
        setNextStatus("");
        setStatusNote("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    if (open) load();
    else {
      setKase(null); setActivity([]); setError(""); setShowMaterialForm(false); setShowQcForm(false);
      setFollowUpNote(""); setJobType("PICKUP");
    }
  }, [open, load]);

  function notifyChanged() {
    load();
    onChanged?.();
  }

  async function saveFields() {
    setBusy(true); setError("");
    try {
      await api.updateComplaintCase(caseId, {
        rootCause: rootCause.trim() || null,
        resolution: resolution.trim() || null,
        resolutionCost: resolutionCost === "" ? null : Number(resolutionCost),
      });
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function changeStatus() {
    if (!nextStatus) return;
    setBusy(true); setError("");
    try {
      await api.transitionComplaintStatus(caseId, { status: nextStatus, note: statusNote.trim() || undefined });
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function makeDeliveryTask() {
    setBusy(true); setError("");
    try {
      await api.createComplaintDeliveryTask(caseId, { jobType });
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function openMaterialForm() {
    setShowMaterialForm(true);
    if (materials.length === 0) {
      try {
        const list = await api.getMaterials({ active: "true" });
        setMaterials(Array.isArray(list) ? list : []);
      } catch { /* form tetap tampil, dropdown kosong — bukan blocker */ }
    }
  }

  async function submitMaterialRequirement() {
    if (!matId) { setError("Pilih material terlebih dahulu"); return; }
    const qty = Number(matQty);
    if (!Number.isFinite(qty) || qty <= 0) { setError("Jumlah tidak valid"); return; }
    setBusy(true); setError("");
    try {
      await api.createComplaintMaterialRequirement(caseId, {
        priority: matPriority,
        lines: [{ materialId: matId, requestedQty: qty }],
      });
      setShowMaterialForm(false); setMatId(""); setMatQty("1");
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function openQcForm() {
    setShowQcForm(true);
    if (kase?.unit?.id && qcTests.length === 0) {
      try {
        const t = await api.getUnitTimeline(kase.unit.id);
        setQcTests(t.qcFitTests || []);
      } catch { /* form tetap tampil, dropdown kosong */ }
    }
  }

  async function submitLinkQc() {
    if (!qcId) { setError("Pilih hasil QC terlebih dahulu"); return; }
    setBusy(true); setError("");
    try {
      await api.linkComplaintQc(caseId, qcId);
      setShowQcForm(false); setQcId("");
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submitFollowUp() {
    if (!followUpNote.trim()) { setError("Catatan follow-up wajib diisi"); return; }
    setBusy(true); setError("");
    try {
      await api.logComplaintFollowUp(caseId, followUpNote.trim());
      setFollowUpNote("");
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function confirmCustomer() {
    setBusy(true); setError("");
    try {
      await api.confirmComplaintCustomer(caseId);
      notifyChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const transitions = kase ? (ALLOWED_TRANSITIONS[kase.status] || []) : [];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Kasus Komplain"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">
              {kase ? kase.caseNumber : "Kasus Komplain"}
            </Dialog.Title>
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {loading && <p className="text-[12px] text-ink3">Memuat…</p>}
            {error && <p className="rounded-btn bg-redbg px-2.5 py-2 text-[12px] text-red">{error}</p>}

            {kase && (
              <>
                <Section title="Ringkasan">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={STATUS_TONE[kase.status]}>{STATUS_LABEL[kase.status] || kase.status}</Badge>
                    <Badge variant="neutral">Pemegang: {OWNER_LABEL[kase.currentOwner] || kase.currentOwner}</Badge>
                    <Badge variant={SEVERITY_TONE[kase.severity]}>{SEVERITY_LABEL[kase.severity] || kase.severity}</Badge>
                    <Badge variant="neutral">{CATEGORY_LABEL[kase.category] || kase.category}</Badge>
                    <Badge variant="neutral">{WARRANTY_LABEL[kase.warrantyStatus] || kase.warrantyStatus}</Badge>
                  </div>
                  <p className="mt-2 text-[11.5px] text-ink2">
                    {kase.order?.customer?.name} · {kase.order?.orderNumber}
                    {kase.unit && ` · Unit ${kase.unit.unitCode}`}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink">{kase.description}</p>
                  {kase.targetCompletionAt && (
                    <p className="mt-1 text-[11px] text-ink3">Target selesai: {formatTanggal(kase.targetCompletionAt)}</p>
                  )}
                </Section>

                <Section title="Root Cause & Resolusi">
                  <label className="mb-1 block text-[11px] font-semibold text-ink2">Root Cause</label>
                  <textarea
                    value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2}
                    placeholder="Penyebab utama komplain ini (diisi saat investigasi)"
                    className="mb-2 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                  <label className="mb-1 block text-[11px] font-semibold text-ink2">Resolusi</label>
                  <textarea
                    value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2}
                    placeholder="Apa yang dilakukan untuk menuntaskan komplain ini"
                    className="mb-2 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                  <label className="mb-1 block text-[11px] font-semibold text-ink2">Biaya Penyelesaian (Rp)</label>
                  <input
                    type="number" min="0" value={resolutionCost} onChange={(e) => setResolutionCost(e.target.value)}
                    placeholder="0"
                    className="mb-2 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                  <button type="button" onClick={saveFields} disabled={busy}
                    className="flex items-center gap-1.5 rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-hovertint disabled:opacity-50">
                    <Save size={12} /> Simpan
                  </button>
                </Section>

                {kase.status !== "SELESAI" && kase.status !== "DIBATALKAN" && (
                  <Section title="Ubah Status">
                    <select
                      value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}
                      className="mb-2 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                    >
                      <option value="">Pilih status berikutnya…</option>
                      {transitions.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    {nextStatus === "DIBATALKAN" && (
                      <textarea
                        value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={2}
                        placeholder="Alasan pembatalan (wajib)"
                        className="mb-2 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                      />
                    )}
                    <button type="button" onClick={changeStatus} disabled={busy || !nextStatus}
                      className="rounded-btn bg-accent px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                      Terapkan
                    </button>
                  </Section>
                )}

                <Section title="Aksi Lintas Divisi">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <select value={jobType} onChange={(e) => setJobType(e.target.value)}
                        className="rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent">
                        <option value="PICKUP">Pengambilan/Inspeksi</option>
                        <option value="DELIVERY">Pengiriman Ulang</option>
                      </select>
                      <button type="button" onClick={makeDeliveryTask} disabled={busy}
                        className="flex items-center gap-1.5 rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-hovertint disabled:opacity-50">
                        <Truck size={12} /> Buat Delivery Task
                      </button>
                    </div>

                    {!showMaterialForm ? (
                      <button type="button" onClick={openMaterialForm}
                        className="flex items-center gap-1.5 rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-hovertint">
                        <Package size={12} /> Ajukan Material Requirement
                      </button>
                    ) : (
                      <div className="rounded-btn border border-border p-2">
                        <select value={matId} onChange={(e) => setMatId(e.target.value)}
                          className="mb-1.5 w-full rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent">
                          <option value="">Pilih material…</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                        </select>
                        <div className="mb-1.5 flex gap-1.5">
                          <input type="number" min="0" value={matQty} onChange={(e) => setMatQty(e.target.value)}
                            placeholder="Qty"
                            className="w-20 rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent" />
                          <select value={matPriority} onChange={(e) => setMatPriority(e.target.value)}
                            className="flex-1 rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent">
                            <option value="LOW">Low</option><option value="NORMAL">Normal</option>
                            <option value="HIGH">High</option><option value="URGENT">Urgent</option>
                          </select>
                        </div>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={submitMaterialRequirement} disabled={busy}
                            className="rounded-btn bg-accent px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">Ajukan</button>
                          <button type="button" onClick={() => setShowMaterialForm(false)}
                            className="rounded-btn px-2.5 py-1.5 text-[11.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}

                    {!showQcForm ? (
                      <button type="button" onClick={openQcForm}
                        className="flex items-center gap-1.5 rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-hovertint">
                        <ClipboardCheck size={12} /> Tautkan Hasil QC
                      </button>
                    ) : (
                      <div className="rounded-btn border border-border p-2">
                        <select value={qcId} onChange={(e) => setQcId(e.target.value)}
                          className="mb-1.5 w-full rounded-btn border border-border bg-surface px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent">
                          <option value="">Pilih hasil QC…</option>
                          {qcTests.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.stage?.labelId || "QC"} — {q.verdict} ({formatTanggal(q.createdAt)})
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={submitLinkQc} disabled={busy}
                            className="rounded-btn bg-accent px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">Tautkan</button>
                          <button type="button" onClick={() => setShowQcForm(false)}
                            className="rounded-btn px-2.5 py-1.5 text-[11.5px] font-semibold text-ink3 hover:bg-hovertint">Batal</button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-btn border border-border p-2">
                      <textarea
                        value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} rows={2}
                        placeholder="Catatan follow-up ke customer…"
                        className="mb-1.5 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                      />
                      <button type="button" onClick={submitFollowUp} disabled={busy}
                        className="flex items-center gap-1.5 rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] font-semibold text-ink2 hover:bg-hovertint disabled:opacity-50">
                        <MessageSquare size={12} /> Catat Follow-up
                      </button>
                    </div>

                    {kase.status === "KONFIRMASI_CUSTOMER" && (
                      <button type="button" onClick={confirmCustomer} disabled={busy}
                        className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Konfirmasi Customer — Tandai SELESAI
                      </button>
                    )}
                    {kase.status === "SELESAI" && (
                      <p className="rounded-btn bg-greenbg px-2.5 py-2 text-[12px] font-semibold text-green">
                        ✓ Selesai — dikonfirmasi {formatTanggalJam(kase.customerConfirmedAt)}
                        {kase.customerConfirmedBy?.name ? ` oleh ${kase.customerConfirmedBy.name}` : ""}
                      </p>
                    )}
                  </div>
                </Section>

                {(kase.jobs?.length > 0 || kase.materialIssues?.length > 0 || kase.unitRevisions?.length > 0) && (
                  <Section title="Objek Tertaut">
                    <div className="space-y-1.5">
                      {kase.jobs?.map((j) => (
                        <p key={j.id} className="text-[11.5px] text-ink2">
                          🚚 {JOB_TYPE_LABEL[j.type]} — {JOB_STATUS_LABEL[j.status] || j.status}
                          {j.scheduledDate ? ` (${formatTanggal(j.scheduledDate)})` : ""}
                        </p>
                      ))}
                      {kase.materialIssues?.map((m) => (
                        <p key={m.id} className="text-[11.5px] text-ink2">📦 {m.issueNumber} — {m.status}</p>
                      ))}
                      {kase.unitRevisions?.map((r) => (
                        <p key={r.id} className="text-[11.5px] text-ink2">🔧 Revisi {r.trigger} — {r.status}</p>
                      ))}
                      {kase.resolutionCost != null && (
                        <p className="text-[11.5px] text-ink2">💰 Biaya penyelesaian: {formatRupiah(kase.resolutionCost)}</p>
                      )}
                    </div>
                  </Section>
                )}

                <Section title="Linimasa">
                  <ActivityTimeline events={activity} formatSentence={formatComplaintActivitySentence} />
                </Section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
