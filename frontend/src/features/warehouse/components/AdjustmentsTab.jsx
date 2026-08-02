import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Scale, Plus, RefreshCw, X, Loader2, ArrowRight, XCircle, Send } from "lucide-react";
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
  ADJUSTMENT_TYPE_REAL, ADJUSTMENT_STATUS_REAL, ADJUSTMENT_FORWARD_FLOW,
} from "../inventoryReal.js";

// Stock Adjustment (review-gated) — beda dengan koreksi satu-langkah yang
// sudah ada sejak v1 (dipakai Stock Count Tahap 5 & Gudang.jsx). Wajib
// approval sebelum ledger tersentuh. Lihat catatan panjang di
// schema.prisma & routes/stockAdjustment.js.
const TABS = [
  { key: "",               label: "Semua" },
  { key: "DRAFT",          label: "Draft" },
  { key: "WAITING_APPROVAL",label: "Waiting Approval" },
  { key: "APPROVED",       label: "Approved" },
  { key: "POSTED",         label: "Posted" },
  { key: "CANCELLED",      label: "Cancelled" },
];

function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("DATA_CORRECTION");
  const [adjustmentQty, setAdjustmentQty] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setMaterialId(""); setAdjustmentType("DATA_CORRECTION"); setAdjustmentQty("");
    setReason(""); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId) { setErr("Item wajib dipilih"); return; }
    if (!Number(adjustmentQty)) { setErr("Adjustment quantity wajib diisi dan tidak boleh nol"); return; }
    if (!reason.trim()) { setErr("Alasan wajib diisi"); return; }
    setBusy(true); setErr("");
    try {
      await api.createAdjustmentRequest({ materialId, adjustmentType, adjustmentQty, reason, notes: notes || undefined });
      onCreated(); onClose();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Ajukan Stock Adjustment">
      <form onSubmit={simpan} className="space-y-3">
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
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Adjustment Type *</label>
            <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(ADJUSTMENT_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Adjustment Qty * (+/-)</label>
            <input type="number" step="any" value={adjustmentQty} onChange={(e) => setAdjustmentQty(e.target.value)}
              placeholder="mis. -3 atau 5"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Reason *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Wajib diisi — tidak ada adjustment tanpa alasan"
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>
        {err && <p className="text-[12px] text-red">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Ajukan</Button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDrawer({ request, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (!request) return null;
  const status = request.status;
  const selesai = status === "POSTED" || status === "CANCELLED";
  const currentIdx = ADJUSTMENT_FORWARD_FLOW.indexOf(status);
  const nextStatus = ADJUSTMENT_FORWARD_FLOW[currentIdx + 1];
  const afterQty = request.beforeQty + request.adjustmentQty;

  async function majukan() {
    setBusy(true); setError("");
    try { await api.updateAdjustmentRequest(request.id, { status: nextStatus }); onChanged(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function posting() {
    setBusy(true); setError("");
    try { await api.postAdjustmentRequest(request.id); onChanged(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function batalkan() {
    if (!cancelReason.trim()) { setError("Alasan pembatalan wajib diisi"); return; }
    setBusy(true); setError("");
    try { await api.cancelAdjustmentRequest(request.id, cancelReason); onChanged(); onClose(); setCancelling(false); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={!!request} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{request.adjustmentNumber}</Dialog.Title>
            <StatusBadge map={ADJUSTMENT_STATUS_REAL} value={status} />
            <Dialog.Close className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink"><X size={16} /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">{request.material.code}</p>
            <p className="text-[11.5px] text-ink2">{request.material.name}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              <div><dt className="text-ink3">Type</dt><dd className="font-medium text-ink">{ADJUSTMENT_TYPE_REAL[request.adjustmentType]?.label}</dd></div>
              <div><dt className="text-ink3">Requested By</dt><dd className="font-medium text-ink">{request.requestedBy?.name || "—"}</dd></div>
              <div><dt className="text-ink3">Before Quantity</dt><dd className="font-medium text-ink">{request.beforeQty}</dd></div>
              <div><dt className="text-ink3">Adjustment Quantity</dt>
                <dd className={`font-bold ${request.adjustmentQty > 0 ? "text-green" : "text-red"}`}>
                  {request.adjustmentQty > 0 ? "+" : ""}{request.adjustmentQty}
                </dd></div>
              <div><dt className="text-ink3">After Quantity</dt><dd className="font-bold text-ink">{afterQty}</dd></div>
              <div><dt className="text-ink3">Approved By</dt><dd className="font-medium text-ink">{request.approvedBy?.name || "—"}</dd></div>
            </dl>
            <div className="mt-3 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-orange">Reason</div>
              <p className="mt-0.5 text-[12.5px] text-ink">{request.reason}</p>
            </div>
            {request.notes && <p className="mt-2 text-[11.5px] text-ink2">{request.notes}</p>}
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
                  {status === "APPROVED" ? (
                    <Button size="sm" className="ml-auto" onClick={posting} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post Adjustment
                    </Button>
                  ) : nextStatus ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Advance to {ADJUSTMENT_STATUS_REAL[nextStatus]?.label}
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

export default function AdjustmentsTab() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getAdjustmentRequests({ status: tab || undefined })
      .then((d) => setRows(d.requests)).catch((e) => setError(e.message)).finally(() => setLoading(false));
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
        <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Adjustment</Button>
      </div>

      {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      <Card className="overflow-hidden">
        {kosong ? (
          <EmptyState icon={Scale} title="Belum ada Stock Adjustment" description="Koreksi stok yang perlu ditinjau akan tampil di sini."
            action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Adjustment</Button>} />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Adjustment ID</TH><TH>Item</TH><TH numeric>Before</TH><TH numeric>Adj</TH><TH numeric>After</TH><TH>Requested By</TH><TH>Status</TH></TR></THead>
              <TBody>
                {loading && <TableSkeletonRows rows={5} cols={7} />}
                {!loading && rows?.map((r) => (
                  <TR key={r.id} clickable onClick={() => setSelected(r)}>
                    <TD className="font-semibold text-ink">{r.adjustmentNumber}</TD>
                    <TD truncate>{r.material.code}</TD>
                    <TD numeric className="text-ink3">{r.beforeQty}</TD>
                    <TD numeric className={r.adjustmentQty > 0 ? "font-bold text-green" : "font-bold text-red"}>
                      {r.adjustmentQty > 0 ? "+" : ""}{r.adjustmentQty}
                    </TD>
                    <TD numeric className="font-semibold text-ink">{r.beforeQty + r.adjustmentQty}</TD>
                    <TD className="text-ink2">{r.requestedBy?.name || "—"}</TD>
                    <TD><StatusBadge map={ADJUSTMENT_STATUS_REAL} value={r.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <FormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <DetailDrawer request={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}
