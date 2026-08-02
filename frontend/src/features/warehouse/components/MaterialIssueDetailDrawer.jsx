import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, ArrowRight, XCircle, Send, Save } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  ISSUE_STATUS_REAL, ISSUE_SOURCE_REAL, ISSUE_PRIORITY_REAL, ISSUE_FORWARD_FLOW, UNIT_LABEL,
} from "../inventoryReal.js";

// Detail Material Issue — picking lalu Confirm Issue. Confirm Issue adalah
// SATU-SATUNYA titik yang menulis baris stock_movements ISSUE nyata (lihat
// catatan panjang di schema.prisma & routes/materialIssue.js) — sebelum itu,
// requestedQty baris ini yang dihitung sebagai Reserved (APPROVED..PICKED).
const waktu = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export default function MaterialIssueDetailDrawer({ issueId, onClose, onChanged }) {
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lineEdits, setLineEdits] = useState({});
  const [issueQty, setIssueQty] = useState({});
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = () => {
    if (!issueId) return;
    setLoading(true);
    setError("");
    api.getMaterialIssue(issueId)
      .then((d) => {
        setIssue(d);
        setLineEdits({});
        setIssueQty(Object.fromEntries(d.lines.map((l) => [l.id, l.requestedQty])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [issueId]);

  if (!issueId) return null;

  const status = issue?.status;
  const selesai = status === "ISSUED" || status === "CANCELLED";
  const currentIdx = ISSUE_FORWARD_FLOW.indexOf(status);
  const nextStatus = ISSUE_FORWARD_FLOW[currentIdx + 1];
  const bisaAturLokasi = !selesai && currentIdx >= ISSUE_FORWARD_FLOW.indexOf("READY_TO_PICK");
  const bisaIssue = status === "PICKED";

  function editLokasi(lineId, value) {
    setLineEdits((e) => ({ ...e, [lineId]: value }));
  }

  async function simpanLokasi() {
    setBusy(true);
    setError("");
    try {
      await Promise.all(Object.entries(lineEdits).map(([lineId, sourceLocation]) =>
        api.updateMaterialIssueLine(issueId, lineId, { sourceLocation })
      ));
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function majukan() {
    setBusy(true);
    setError("");
    try {
      await api.updateMaterialIssue(issueId, { status: nextStatus });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function konfirmasiIssue() {
    setBusy(true);
    setError("");
    try {
      await api.issueMaterialIssue(issueId, {
        lines: issue.lines.map((l) => ({ lineId: l.id, issuedQty: issueQty[l.id] })),
      });
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function batalkan() {
    if (!cancelReason.trim()) { setError("Alasan pembatalan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.cancelMaterialIssue(issueId, cancelReason);
      load();
      onChanged();
      setCancelling(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!issueId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail Material Issue"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[560px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{issue?.issueNumber || "…"}</Dialog.Title>
            {status && <StatusBadge map={ISSUE_STATUS_REAL} value={status} />}
            {issue && <StatusBadge map={ISSUE_PRIORITY_REAL} value={issue.priority} />}
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading && (
              <p className="flex items-center gap-1.5 py-6 text-[12.5px] text-ink3">
                <Loader2 size={14} className="animate-spin" /> Memuat…
              </p>
            )}

            {issue && (
              <>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <div><dt className="text-ink3">Source Type</dt><dd className="font-medium text-ink">{ISSUE_SOURCE_REAL[issue.sourceType]?.label}</dd></div>
                  <div><dt className="text-ink3">Reference</dt><dd className="font-medium text-ink">{issue.sourceReference || "—"}</dd></div>
                  <div><dt className="text-ink3">Department</dt><dd className="font-medium text-ink">{issue.department || "—"}</dd></div>
                  <div><dt className="text-ink3">Required Date</dt><dd className="font-medium text-ink">{issue.requiredDate ? waktu(issue.requiredDate) : "—"}</dd></div>
                  <div><dt className="text-ink3">Requested By</dt><dd className="font-medium text-ink">{issue.requestedBy?.name || "—"}</dd></div>
                  <div><dt className="text-ink3">Approved By</dt><dd className="font-medium text-ink">{issue.approvedBy?.name || "—"}</dd></div>
                  {issue.issuedBy && <div><dt className="text-ink3">Issued By</dt><dd className="font-medium text-ink">{issue.issuedBy.name}</dd></div>}
                </dl>
                {issue.notes && <p className="mt-2 text-[11.5px] text-ink2">{issue.notes}</p>}

                <div className="mt-4 border-t border-line pt-3">
                  <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Item Lines</h4>
                  <div className="space-y-2.5">
                    {issue.lines.map((line) => (
                      <div key={line.id} className="rounded-btn border border-border p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[12.5px] font-semibold text-ink">{line.material.code}</p>
                          <p className="text-[11px] text-ink3">
                            Requested {line.requestedQty} {UNIT_LABEL[line.material.unit]}
                          </p>
                        </div>
                        <p className="text-[11px] text-ink2">{line.material.name}</p>

                        {selesai ? (
                          <p className="mt-1.5 text-[11px] text-ink3">
                            {status === "ISSUED" ? `Issued ${line.issuedQty} ${UNIT_LABEL[line.material.unit]}` : "Dibatalkan"}
                            {line.sourceLocation && ` · ${line.sourceLocation}`}
                          </p>
                        ) : bisaAturLokasi ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-0.5 block text-[10px] text-ink3">Source Location</label>
                              <input
                                type="text"
                                value={lineEdits[line.id] ?? line.sourceLocation ?? ""}
                                onChange={(e) => editLokasi(line.id, e.target.value)}
                                placeholder="GUDANG_UTAMA"
                                className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                              />
                            </div>
                            {bisaIssue && (
                              <div>
                                <label className="mb-0.5 block text-[10px] text-ink3">Issue Qty</label>
                                <input
                                  type="number" step="any" min="0" value={issueQty[line.id] ?? ""}
                                  onChange={(e) => setIssueQty((q) => ({ ...q, [line.id]: e.target.value }))}
                                  className="w-full rounded-btn border border-border bg-surface px-1.5 py-1 text-[11.5px] text-ink outline-none focus:border-accent"
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-ink3">Bisa diatur setelah status Ready to Pick.</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {bisaAturLokasi && Object.keys(lineEdits).length > 0 && (
                    <Button variant="secondary" size="sm" className="mt-2" onClick={simpanLokasi} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan Lokasi
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {issue && !selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {cancelling ? (
                <div className="space-y-2">
                  <textarea
                    value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Alasan pembatalan…" rows={2}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(false)}>Batal</Button>
                    <Button variant="destructive" size="sm" onClick={batalkan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Cancel Issue
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
                    <XCircle size={14} /> Cancel
                  </Button>
                  {bisaIssue ? (
                    <Button size="sm" className="ml-auto" onClick={konfirmasiIssue} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Confirm Issue
                    </Button>
                  ) : nextStatus && nextStatus !== "ISSUED" ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      Advance to {ISSUE_STATUS_REAL[nextStatus]?.label}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
