import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, ArrowRight, XCircle, Link2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  REPLENISHMENT_STATUS_REAL, REPLENISHMENT_SOURCE_REAL, REPLENISHMENT_FORWARD_FLOW,
} from "../inventoryReal.js";

// Detail Replenishment — edit quantity/supplier selama belum ORDERED,
// majukan status, lalu "Link to Goods Receipt" untuk menandai barang
// benar-benar tiba (COMPLETED). TIDAK menulis stock_movements sendiri —
// GoodsReceipt yang sudah menulisnya. Lihat schema.prisma.
export default function ReplenishmentDetailDrawer({ requestId, onClose, onChanged }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [suggestedQty, setSuggestedQty] = useState("");
  const [receipts, setReceipts] = useState([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [linking, setLinking] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = () => {
    if (!requestId) return;
    setLoading(true); setError("");
    api.getReplenishmentRequest(requestId)
      .then((d) => { setRequest(d); setSupplier(d.supplier || ""); setSuggestedQty(d.suggestedQty); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [requestId]);

  useEffect(() => {
    if (request?.status === "ORDERED") {
      api.getGoodsReceipts({}).then((d) => setReceipts(d.receipts)).catch(() => {});
    }
  }, [request?.status]);

  if (!requestId) return null;
  const status = request?.status;
  const selesai = status === "COMPLETED" || status === "REJECTED";
  const bisaEdit = !selesai && status !== "ORDERED";
  const currentIdx = REPLENISHMENT_FORWARD_FLOW.indexOf(status);
  const nextStatus = REPLENISHMENT_FORWARD_FLOW[currentIdx + 1];

  async function simpanEdit() {
    setBusy(true); setError("");
    try {
      await api.updateReplenishmentRequest(requestId, { supplier: supplier || undefined, suggestedQty });
      load(); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function majukan() {
    setBusy(true); setError("");
    try { await api.updateReplenishmentRequest(requestId, { status: nextStatus }); load(); onChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function tautkan() {
    if (!selectedReceiptId) { setError("Pilih Goods Receipt dulu"); return; }
    setBusy(true); setError("");
    try { await api.linkReplenishmentReceipt(requestId, selectedReceiptId); load(); onChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function tolak() {
    if (!rejectReason.trim()) { setError("Alasan penolakan wajib diisi"); return; }
    setBusy(true); setError("");
    try { await api.rejectReplenishmentRequest(requestId, rejectReason); load(); onChanged(); setRejecting(false); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={!!requestId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{request?.requestNumber || "…"}</Dialog.Title>
            {status && <StatusBadge map={REPLENISHMENT_STATUS_REAL} value={status} />}
            <Dialog.Close className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink"><X size={16} /></Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading && <p className="flex items-center gap-1.5 py-6 text-[12.5px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat…</p>}
            {request && (
              <>
                <p className="text-[13px] font-semibold text-ink">{request.material.code}</p>
                <p className="text-[11.5px] text-ink2">{request.material.name}</p>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  <div><dt className="text-ink3">Source</dt><dd className="font-medium text-ink">{REPLENISHMENT_SOURCE_REAL[request.source]?.label}</dd></div>
                  <div><dt className="text-ink3">Current Stock</dt><dd className="font-medium text-ink">{request.currentStockSnapshot}</dd></div>
                  <div><dt className="text-ink3">Minimum Stock</dt><dd className="font-medium text-ink">{request.minimumStockSnapshot ?? "—"}</dd></div>
                  <div><dt className="text-ink3">Requested By</dt><dd className="font-medium text-ink">{request.requestedBy?.name || "—"}</dd></div>
                  <div><dt className="text-ink3">Approved By</dt><dd className="font-medium text-ink">{request.approvedBy?.name || "—"}</dd></div>
                </dl>

                {bisaEdit ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <div>
                      <label className="mb-0.5 block text-[10.5px] text-ink3">Suggested Quantity</label>
                      <input type="number" step="any" min="0" value={suggestedQty} onChange={(e) => setSuggestedQty(e.target.value)}
                        className="w-full rounded-btn border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent" />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10.5px] text-ink3">Preferred Supplier</label>
                      <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
                        className="w-full rounded-btn border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent" />
                    </div>
                    {(Number(suggestedQty) !== request.suggestedQty || supplier !== (request.supplier || "")) && (
                      <Button variant="secondary" size="sm" onClick={simpanEdit} disabled={busy}>
                        {busy && <Loader2 size={14} className="animate-spin" />} Simpan Perubahan
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink2">
                    Suggested Quantity <strong>{request.suggestedQty}</strong> {request.material.unit}
                    {request.supplier && ` · Supplier ${request.supplier}`}
                  </p>
                )}

                {status === "ORDERED" && (
                  <div className="mt-3 border-t border-line pt-3">
                    <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Link to Goods Receipt</label>
                    <select value={selectedReceiptId} onChange={(e) => setSelectedReceiptId(e.target.value)}
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                      <option value="">Pilih goods receipt…</option>
                      {receipts.map((r) => <option key={r.id} value={r.id}>{r.receiptNumber} — {r.status}</option>)}
                    </select>
                    <p className="mt-1 text-[10.5px] text-ink3">
                      Buat Goods Receipt seperti biasa di halaman Goods Receipt, lalu tautkan di sini setelah barang tiba.
                    </p>
                  </div>
                )}

                {status === "COMPLETED" && request.goodsReceipt && (
                  <div className="mt-3 rounded-btn border-l-[3px] border-green bg-greenbg px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-green">Linked Goods Receipt</div>
                    <p className="mt-0.5 text-[12.5px] text-ink">{request.goodsReceipt.receiptNumber}</p>
                  </div>
                )}
                {status === "REJECTED" && request.rejectedReason && (
                  <div className="mt-3 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-red">Rejected</div>
                    <p className="mt-0.5 text-[12.5px] text-ink">{request.rejectedReason}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {request && !selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {rejecting ? (
                <div className="space-y-2">
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2}
                    placeholder="Alasan penolakan…"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>Batal</Button>
                    <Button variant="destructive" size="sm" onClick={tolak} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}><XCircle size={14} /> Reject</Button>
                  {status === "ORDERED" ? (
                    <Button size="sm" className="ml-auto" onClick={tautkan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link &amp; Complete
                    </Button>
                  ) : nextStatus ? (
                    <Button size="sm" className="ml-auto" onClick={majukan} disabled={busy}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Advance to {REPLENISHMENT_STATUS_REAL[nextStatus]?.label}
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
