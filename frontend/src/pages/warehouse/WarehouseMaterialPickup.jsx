import React, { useCallback, useEffect, useState } from "react";
import { PackageCheck, PackageOpen, RefreshCw, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  PICKUP_TABS, canCancelRequest, canPickRequest, emptyStateCopy, lineComparison, pickErrorMessage, pickupStatusBadgeFor, requestSummary,
} from "@/features/production/materialPickup.js";

// Pengambilan Bahan Produksi V2 (P4) — antrean Gudang: permintaan dari Produksi (material/qty dari Planned BOM +
// reservasi, TIDAK diketik ulang). "Serahkan Bahan" mengurangi stok fisik SEKALI (ledger kanonis), mengonsumsi
// reservasi, dan membukukan HPP lewat jalur yang sudah ada. Tanpa serah parsial: bila jumlah fisik tidak sesuai,
// koreksi stok/BOM lebih dulu. Data hanya muncul bila reader V2 (production_v2_reader) aktif untuk cohort unit
// terkait; di luar itu antrean kosong (fail-closed), bukan error. Logika murni: features/production/materialPickup.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function RequestCard({ item, onPick, onCancel }) {
  const badge = pickupStatusBadgeFor(item.status);
  const summary = requestSummary(item);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{item.issueNumber}</p>
          <p className="text-[12px] text-ink3">Unit {item.unit?.unitCode || "—"}{item.unit?.orderNumber ? ` · Order ${item.unit.orderNumber}` : ""}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-ink3"><th className="pb-1 font-medium">Bahan</th><th className="pb-1 text-right font-medium">Rencana</th><th className="pb-1 text-right font-medium">Direservasi</th><th className="pb-1 text-right font-medium">Diserahkan</th></tr>
          </thead>
          <tbody>
            {item.lines.map((line) => {
              const c = lineComparison(line);
              return (
                <tr key={line.id} className="border-t border-line">
                  <td className="py-1 text-ink">{line.code} · {line.name}</td>
                  <td className="py-1 text-right text-ink">{c.planned} {line.unit}</td>
                  <td className={`py-1 text-right ${c.consistent ? "text-ink" : "text-red"}`}>{c.reserved}</td>
                  <td className="py-1 text-right text-ink">{c.picked}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Diajukan</dt><dd className="text-ink">{waktu(item.createdAt)}</dd></div>
        {item.issuedAt && <div className="flex justify-between"><dt className="text-ink3">Diserahkan</dt><dd className="text-ink">{waktu(item.issuedAt)}</dd></div>}
        {item.cancelReason && <div className="flex justify-between gap-2"><dt className="shrink-0 text-ink3">Alasan batal</dt><dd className="text-right text-ink">{item.cancelReason}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink3">Total</dt><dd className="text-ink">{summary.totalPicked} / {summary.totalPlanned}</dd></div>
      </dl>
      {canPickRequest(item) && (
        <div className="mt-1 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onPick(item)}><PackageCheck size={14} /> Serahkan Bahan</Button>
          {canCancelRequest(item) && <Button size="sm" variant="ghost" onClick={() => onCancel(item)}><XCircle size={14} /> Batalkan</Button>}
        </div>
      )}
    </Card>
  );
}

function PickModal({ item, onClose, onDone }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setError("");
    try {
      const result = await api.pickMaterialRequest(item.id, { expectedRevision: item.revision });
      onDone(result.replayed ? "Sudah diproses sebelumnya (tidak ada pengurangan ganda)." : `Bahan ${item.issueNumber} diserahkan; stok fisik berkurang.`);
    } catch (e) { setError(pickErrorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Serahkan Bahan ${item.issueNumber}`} description="Stok fisik berkurang sekarang sesuai jumlah reservasi. Tidak ada serah parsial; jumlah tidak dapat diubah di sini.">
      <ul className="space-y-1 text-[12.5px] text-ink">
        {item.lines.map((l) => <li key={l.id} className="flex justify-between"><span>{l.code} · {l.name}</span><span>{l.planned} {l.unit}</span></li>)}
      </ul>
      {error && <p className="mt-3 text-[12.5px] text-red">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Memproses…" : "Serahkan Bahan"}</Button>
      </div>
    </Modal>
  );
}

function CancelModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 3) { setError("Alasan pembatalan wajib diisi (minimal 3 karakter)"); return; }
    setSaving(true); setError("");
    try {
      await api.cancelMaterialRequest(item.id, { reason: reason.trim(), expectedRevision: item.revision });
      onDone(`Permintaan ${item.issueNumber} dibatalkan; reservasi dilepas.`);
    } catch (e) { setError(pickErrorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Batalkan ${item.issueNumber}`} description="Hanya bisa sebelum bahan diserahkan. Reservasi dilepas dan rencana kembali ke status Direncanakan.">
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Alasan pembatalan" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
      {error && <p className="mt-3 text-[12.5px] text-red">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Tutup</Button>
        <Button variant="destructive" onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : "Batalkan Permintaan"}</Button>
      </div>
    </Modal>
  );
}

export default function WarehouseMaterialPickup() {
  const [tab, setTab] = useState("READY_TO_PICK");
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pickTarget, setPickTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getMaterialRequests({ status: tab })
      .then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat antrean"))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const kosong = !loading && items && items.length === 0;
  const emptyCopy = emptyStateCopy({ readerMode, tabKey: tab });
  const handleDone = (message) => { setPickTarget(null); setCancelTarget(null); setNotice(message); load(); };

  return (
    <PageContainer>
      <PageHeader
        title="Pengambilan Bahan Produksi"
        subtitle="Permintaan bahan dari Produksi berdasarkan Planned BOM yang sudah direservasi. Stok berkurang saat bahan diserahkan."
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring status pengambilan bahan" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {PICKUP_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}>
              {t.label}
            </button>
          ))}
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} permintaan</span>}
        </div>
        {notice && <div className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-48 animate-pulse bg-inset" />)}</div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0"><EmptyState icon={PackageOpen} title={emptyCopy.title} description={emptyCopy.description} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => <RequestCard key={item.id} item={item} onPick={setPickTarget} onCancel={setCancelTarget} />)}
          </div>
        )}
      </PageBody>
      {pickTarget && <PickModal item={pickTarget} onClose={() => setPickTarget(null)} onDone={handleDone} />}
      {cancelTarget && <CancelModal item={cancelTarget} onClose={() => setCancelTarget(null)} onDone={handleDone} />}
    </PageContainer>
  );
}
