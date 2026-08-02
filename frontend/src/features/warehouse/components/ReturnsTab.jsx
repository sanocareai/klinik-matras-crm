import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Undo2, Plus, RefreshCw, X, Loader2, ArrowRight, XCircle, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "./StatusBadge.jsx";
import {
  RETURN_TYPE_REAL, RETURN_STATUS_REAL, RETURN_RESOLUTION_REAL, RETURN_FORWARD_FLOW,
} from "../inventoryReal.js";

// Returns — cuma resolusi RETURN_TO_AVAILABLE yang menulis ledger (RETURN,
// positif). Lihat catatan panjang di schema.prisma & routes/returnRecord.js.
const TABS = [
  { key: "",           label: "Semua" },
  { key: "CREATED",    label: "Created" },
  { key: "RECEIVED",   label: "Received" },
  { key: "INSPECTION", label: "Inspection" },
  { key: "COMPLETED",  label: "Completed" },
  { key: "CANCELLED",  label: "Cancelled" },
];

function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [returnType, setReturnType] = useState("CUSTOMER_RETURN");
  const [reference, setReference] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setReturnType("CUSTOMER_RETURN"); setReference(""); setMaterialId(""); setQty("");
    setCondition(""); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId || !(Number(qty) > 0)) { setErr("Item dan quantity wajib diisi"); return; }
    setBusy(true); setErr("");
    try {
      await api.createReturnRecord({
        returnType, reference: reference || undefined, materialId, qty,
        condition: condition || undefined, notes: notes || undefined,
      });
      onCreated(); onClose();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Buat Return Record">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Return Type *</label>
            <select value={returnType} onChange={(e) => setReturnType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(RETURN_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. order/job"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Item *</label>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
            <option value="">Pilih item…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Quantity *</label>
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Condition</label>
            <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="mis. baik, sedikit kotor"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>
        {err && <p className="text-[12px] text-red">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Buat</Button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDrawer({ record, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspectionNote, setInspectionNote] = useState("");
  const [resolution, setResolution] = useState("RETURN_TO_AVAILABLE");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => { if (record) { setInspectionNote(record.inspectionNote || ""); } }, [record]);

  if (!record) return null;
  const status = record.status;
  const selesai = status === "COMPLETED" || status === "CANCELLED";
  const currentIdx = RETURN_FORWARD_FLOW.indexOf(status);
  const nextStatus = RETURN_FORWARD_FLOW[currentIdx + 1];

  async function majukan() {
    setBusy(true); setError("");
    try {
      const body = { status: nextStatus };
      if (nextStatus === "INSPECTION" && inspectionNote) body.inspectionNote = inspectionNote;
      await api.updateReturnRecord(record.id, body);
      onChanged(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function selesaikan() {
    setBusy(true); setError("");
    try { await api.completeReturnRecord(record.id, resolution); onChanged(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function batalkan() {
    if (!cancelReason.trim()) { setError("Alasan pembatalan wajib diisi"); return; }
    setBusy(true); setError("");
    try { await api.cancelReturnRecord(record.id, cancelReason); onChanged(); onClose(); setCancelling(false); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={!!record} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{record.returnNumber}</Dialog.Title>
            <StatusBadge map={RETURN_STATUS_REAL} value={status} />
            <Dialog.Close className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink"><X size={16} /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">{record.material.code}</p>
            <p className="text-[11.5px] text-ink2">{record.material.name}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              <div><dt className="text-ink3">Return Type</dt><dd className="font-medium text-ink">{RETURN_TYPE_REAL[record.returnType]?.label}</dd></div>
              <div><dt className="text-ink3">Reference</dt><dd className="font-medium text-ink">{record.reference || "—"}</dd></div>
              <div><dt className="text-ink3">Quantity</dt><dd className="font-medium text-ink">{record.qty} {record.material.unit}</dd></div>
              <div><dt className="text-ink3">Condition</dt><dd className="font-medium text-ink">{record.condition || "—"}</dd></div>
            </dl>
            {record.notes && <p className="mt-2 text-[11.5px] text-ink2">{record.notes}</p>}

            {status === "INSPECTION" && (
              <div className="mt-4 border-t border-line pt-3 space-y-2">
                <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Inspection Note</label>
                <textarea value={inspectionNote} onChange={(e) => setInspectionNote(e.target.value)} rows={2}
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
                <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Resolution *</label>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)}
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                  {Object.entries(RETURN_RESOLUTION_REAL).map(([k, r]) => (
                    <option key={k} value={k}>{r.label}{r.writesLedger ? " (stok masuk)" : ""}</option>
                  ))}
                </select>
              </div>
            )}
            {selesai && status === "COMPLETED" && (
              <div className="mt-3 rounded-btn border-l-[3px] border-green bg-greenbg px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-green">Resolution</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{RETURN_RESOLUTION_REAL[record.resolution]?.label}</p>
              </div>
            )}
          </div>
          {!selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {cancelling ? (
                <div className="space-y-2">
                  <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2}
                    placeholder="Alasan pembatalan…"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(false)}>Batal</Button>
                    <Button variant="destructive" size="sm" onClick={batalkan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}><XCircle size={14} /> Cancel</Button>
                  {status === "INSPECTION" ? (
                    <Button size="sm" className="ml-auto" onClick={selesaikan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Complete
                    </Button>
                  ) : nextStatus ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Advance to {RETURN_STATUS_REAL[nextStatus]?.label}
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

export default function ReturnsTab() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getReturns({ status: tab || undefined })
      .then((d) => setRows(d.records)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  const kosong = !loading && rows && rows.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Saring status" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              {t.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
        <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Return</Button>
      </div>

      {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      <Card className="overflow-hidden">
        {kosong ? (
          <EmptyState icon={Undo2} title="Belum ada Return" description="Retur pelanggan, pengiriman, produksi, atau supplier akan tampil di sini."
            action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Return</Button>} />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Return ID</TH><TH>Type</TH><TH>Item</TH><TH numeric>Qty</TH><TH>Resolution</TH><TH>Status</TH></TR></THead>
              <TBody>
                {loading && <TableSkeletonRows rows={5} cols={6} />}
                {!loading && rows?.map((r) => (
                  <TR key={r.id} clickable onClick={() => setSelected(r)}>
                    <TD className="font-semibold text-ink">{r.returnNumber}</TD>
                    <TD className="whitespace-nowrap text-ink2">{RETURN_TYPE_REAL[r.returnType]?.label}</TD>
                    <TD truncate>{r.material.code}</TD>
                    <TD numeric>{r.qty}</TD>
                    <TD className="text-ink2">{r.resolution ? RETURN_RESOLUTION_REAL[r.resolution]?.label : "—"}</TD>
                    <TD><StatusBadge map={RETURN_STATUS_REAL} value={r.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <FormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <DetailDrawer record={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}
