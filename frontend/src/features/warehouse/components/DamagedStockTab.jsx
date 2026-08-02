import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertOctagon, Plus, RefreshCw, X, Loader2, CheckCircle2 } from "lucide-react";
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
  DAMAGE_CATEGORY_REAL, DAMAGED_STATUS_REAL, DAMAGED_RESOLUTION_REAL,
} from "../inventoryReal.js";

// Damaged Stock — cuma resolusi RETURN_TO_SUPPLIER & DISPOSE yang menulis
// ledger (WASTE). Lihat catatan panjang di schema.prisma & routes/damagedStock.js.
const TABS = [
  { key: "",                label: "Semua" },
  { key: "REPORTED",        label: "Reported" },
  { key: "UNDER_INSPECTION",label: "Under Inspection" },
  { key: "RESOLVED",        label: "Resolved" },
];

function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [damageCategory, setDamageCategory] = useState("OTHER");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setMaterialId(""); setQty(""); setDamageCategory("OTHER"); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId || !(Number(qty) > 0)) { setErr("Item dan quantity wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createDamagedStockRecord({ materialId, qty, damageCategory, notes: notes || undefined });
      onCreated();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Report Damaged Stock">
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
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Quantity *</label>
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Damage Category *</label>
            <select value={damageCategory} onChange={(e) => setDamageCategory(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(DAMAGE_CATEGORY_REAL).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
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
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Report</Button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDrawer({ record, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("RESTORE_TO_AVAILABLE");
  const [resolutionNote, setResolutionNote] = useState("");

  if (!record) return null;
  const selesai = record.status === "RESOLVED";

  async function inspeksi() {
    setBusy(true); setError("");
    try { await api.requestDamagedStockInspection(record.id); onChanged(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function selesaikan() {
    setBusy(true); setError("");
    try { await api.resolveDamagedStock(record.id, { resolution, resolutionNote: resolutionNote || undefined }); onChanged(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog.Root open={!!record} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="truncate text-[15px] font-bold text-ink">{record.recordNumber}</Dialog.Title>
            <StatusBadge map={DAMAGED_STATUS_REAL} value={record.status} />
            <Dialog.Close className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink"><X size={16} /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">{record.material.code}</p>
            <p className="text-[11.5px] text-ink2">{record.material.name}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              <div><dt className="text-ink3">Quantity</dt><dd className="font-medium text-ink">{record.qty} {record.material.unit}</dd></div>
              <div><dt className="text-ink3">Category</dt><dd className="font-medium text-ink">{DAMAGE_CATEGORY_REAL[record.damageCategory]?.label}</dd></div>
              <div><dt className="text-ink3">Reported By</dt><dd className="font-medium text-ink">{record.reportedBy?.name || "—"}</dd></div>
              <div><dt className="text-ink3">Reported At</dt><dd className="font-medium text-ink">{new Date(record.reportedAt).toLocaleDateString("id-ID")}</dd></div>
            </dl>
            {record.notes && <p className="mt-2 text-[11.5px] text-ink2">{record.notes}</p>}
            {selesai && (
              <div className="mt-3 rounded-btn border-l-[3px] border-green bg-greenbg px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-green">Resolution</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{DAMAGED_RESOLUTION_REAL[record.resolution]?.label}</p>
                {record.resolutionNote && <p className="mt-0.5 text-[11.5px] text-ink2">{record.resolutionNote}</p>}
                <p className="mt-1 text-[10.5px] text-ink3">oleh {record.resolvedBy?.name} · {new Date(record.resolvedAt).toLocaleDateString("id-ID")}</p>
              </div>
            )}

            {!selesai && (
              <div className="mt-4 border-t border-line pt-3">
                {resolving ? (
                  <div className="space-y-2">
                    <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Resolution *</label>
                    <select value={resolution} onChange={(e) => setResolution(e.target.value)}
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                      {Object.entries(DAMAGED_RESOLUTION_REAL).map(([k, r]) => (
                        <option key={k} value={k}>{r.label}{r.writesLedger ? " (stok keluar)" : ""}</option>
                      ))}
                    </select>
                    <textarea value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} rows={2}
                      placeholder="Catatan resolusi (opsional)"
                      className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {!selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              <div className="flex gap-2">
                {record.status === "REPORTED" && (
                  <Button variant="secondary" size="sm" onClick={inspeksi} disabled={busy}>
                    {busy && <Loader2 size={14} className="animate-spin" />} Request Inspection
                  </Button>
                )}
                {resolving ? (
                  <Button size="sm" className="ml-auto" onClick={selesaikan} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirm Resolution
                  </Button>
                ) : (
                  <Button size="sm" className="ml-auto" onClick={() => setResolving(true)}>Resolve</Button>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function DamagedStockTab() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getDamagedStock({ status: tab || undefined })
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
        <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Report Damage</Button>
      </div>

      {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

      <Card className="overflow-hidden">
        {kosong ? (
          <EmptyState icon={AlertOctagon} title="Belum ada Damaged Stock" description="Laporkan barang rusak untuk mulai melacak resolusinya."
            action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Report Damage</Button>} />
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Record ID</TH><TH>Item</TH><TH numeric>Qty</TH><TH>Category</TH><TH>Reported By</TH><TH>Status</TH></TR></THead>
              <TBody>
                {loading && <TableSkeletonRows rows={5} cols={6} />}
                {!loading && rows?.map((r) => (
                  <TR key={r.id} clickable onClick={() => setSelected(r)}>
                    <TD className="font-semibold text-ink">{r.recordNumber}</TD>
                    <TD truncate>{r.material.code}</TD>
                    <TD numeric>{r.qty}</TD>
                    <TD className="text-ink2">{DAMAGE_CATEGORY_REAL[r.damageCategory]?.label}</TD>
                    <TD className="text-ink2">{r.reportedBy?.name || "—"}</TD>
                    <TD><StatusBadge map={DAMAGED_STATUS_REAL} value={r.status} /></TD>
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
