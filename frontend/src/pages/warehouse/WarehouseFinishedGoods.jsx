import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, PackageCheck, PackageX, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { LOCATION_TYPE_REAL } from "@/features/warehouse/inventoryReal.js";
import {
  FG_TABS, acceptSummary, fgEmptyStateCopy, fgErrorMessage, fgStatusBadgeFor, isFgDecisionPending, locationsForFinishedGoods, rejectSummary,
  validateAcceptForm, validateRejectForm,
} from "@/features/warehouse/finishedGoods.js";

// Terima Barang Jadi (Production Workshop + Warehouse V2, P6) — custody FINISHED_GOODS dari Produksi ke Gudang. Menerima = lokasi wajib
// (area barang jadi/dispatch aktif) -> Production Run selesai dan unit siap kirim. Menolak = alasan wajib; histori tersimpan dan kasus kembali
// ke Production untuk tindakan koreksi. Data hanya muncul bila reader V2 (production_v2_reader) diaktifkan server untuk cohort unit terkait
// (fail-closed, bukan error). Halaman ini TIDAK mengubah flag apa pun. Logika murni: features/warehouse/finishedGoods.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function FgCard({ item, onAccept, onReject }) {
  const badge = fgStatusBadgeFor(item.status);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
          <p className="text-[12px] text-ink3">{item.unit.orderNumber ? `Order ${item.unit.orderNumber}` : "Tanpa nomor order"}{item.unit.merk ? ` · ${item.unit.merk}` : ""}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Ditawarkan</dt><dd className="text-ink">{waktu(item.offeredAt)}</dd></div>
        {item.acceptedAt && <div className="flex justify-between"><dt className="text-ink3">Diterima</dt><dd className="text-ink">{waktu(item.acceptedAt)}</dd></div>}
        {item.location && <div className="flex justify-between"><dt className="text-ink3">Lokasi</dt><dd className="text-ink">{item.location.code}</dd></div>}
        {item.reason && <div className="flex justify-between gap-2"><dt className="shrink-0 text-ink3">Alasan</dt><dd className="text-right text-ink">{item.reason}</dd></div>}
      </dl>
      {isFgDecisionPending(item.status) && (
        <div className="mt-1 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAccept(item)}><PackageCheck size={14} /> Terima</Button>
          <Button size="sm" variant="ghost" className="flex-1" onClick={() => onReject(item)}><PackageX size={14} /> Tolak</Button>
        </div>
      )}
    </Card>
  );
}

// Kunci idempotensi per NIAT keputusan: dipakai ulang bila pengguna mengulang setelah galat jaringan, diganti setelah sukses/konflik.
function useIntentKey(prefix) {
  const ref = useRef(null);
  return {
    get: () => { if (!ref.current) ref.current = `web-${prefix}-${crypto.randomUUID()}`; return ref.current; },
    reset: () => { ref.current = null; },
  };
}

function AcceptModal({ item, onClose, onDone }) {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const key = useIntentKey("fg-accept");

  useEffect(() => {
    api.getStorageLocations().then((d) => setLocations(locationsForFinishedGoods(d.locations))).catch((e) => setError(e.message));
  }, []);

  const submit = async () => {
    const check = validateAcceptForm({ locationId });
    if (!check.valid) { setError(check.error); return; }
    setSaving(true); setError("");
    try {
      const result = await api.acceptUnitCustody(item.id, { locationId, expectedRevision: item.revision }, key.get());
      key.reset();
      onDone(acceptSummary(result, item.unit.unitCode));
    } catch (e) {
      if (e.status && e.status < 500) key.reset();
      setError(fgErrorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Terima Barang Jadi ${item.unit.unitCode}`} description="Pilih lokasi penyimpanan barang jadi. Setelah diterima, Production Run selesai dan unit siap kirim.">
      <div className="space-y-3">
        {locations === null ? <p className="text-[12.5px] text-ink3">Memuat daftar lokasi…</p> : locations.length === 0 ? (
          <p className="text-[12.5px] text-red">Tidak ada lokasi aktif bertipe area barang jadi/dispatch. Hubungi Admin Gudang.</p>
        ) : (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Lokasi penyimpanan" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink">
            <option value="">— Pilih lokasi —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {LOCATION_TYPE_REAL[l.locationType] || l.locationType}{l.warehouse?.name ? ` (${l.warehouse.name})` : ""}</option>)}
          </select>
        )}
        {error && <p role="alert" className="text-[12.5px] text-red">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
        <Button onClick={submit} disabled={saving || !locations?.length}>{saving ? "Menyimpan…" : "Terima Barang Jadi"}</Button>
      </div>
    </Modal>
  );
}

function RejectModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const key = useIntentKey("fg-reject");

  const submit = async () => {
    const check = validateRejectForm({ reason });
    if (!check.valid) { setError(check.error); return; }
    setSaving(true); setError("");
    try {
      const result = await api.rejectUnitCustody(item.id, { reason: reason.trim(), expectedRevision: item.revision }, key.get());
      key.reset();
      onDone(rejectSummary(result, item.unit.unitCode));
    } catch (e) {
      if (e.status && e.status < 500) key.reset();
      setError(fgErrorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Tolak Barang Jadi ${item.unit.unitCode}`} description="Alasan wajib diisi. Histori tersimpan dan kasus kembali ke Production untuk tindakan koreksi.">
      <div className="space-y-3">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Alasan penolakan" placeholder="Contoh: cover sobek di sudut kiri, ukuran tidak sesuai pesanan"
          className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
        {error && <p role="alert" className="text-[12.5px] text-red">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
        <Button variant="destructive" onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : "Tolak Barang Jadi"}</Button>
      </div>
    </Modal>
  );
}

export default function WarehouseFinishedGoods() {
  const [tab, setTab] = useState("OFFERED");
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acceptTarget, setAcceptTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getUnitCustodyHandoffs({ status: tab, direction: "FINISHED_GOODS" })
      .then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat antrean"))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const kosong = !loading && items && items.length === 0;
  const copy = fgEmptyStateCopy({ readerMode, tabKey: tab });
  const handleDone = (message) => { setAcceptTarget(null); setRejectTarget(null); setNotice(message); load(); };

  return (
    <PageContainer>
      <PageHeader
        title="Terima Barang Jadi"
        subtitle="Serah-terima barang jadi dari Produksi ke Gudang setelah QC dan seluruh tahap produksi selesai."
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring status barang jadi" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {FG_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setNotice(""); }}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}>
              {t.label}
            </button>
          ))}
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} unit</span>}
        </div>

        {notice && <div className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-40 animate-pulse bg-inset" />)}</div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0"><EmptyState icon={ClipboardCheck} title={copy.title} description={copy.description} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(items || []).map((item) => <FgCard key={item.id} item={item} onAccept={setAcceptTarget} onReject={setRejectTarget} />)}
          </div>
        )}
      </PageBody>

      {acceptTarget && <AcceptModal item={acceptTarget} onClose={() => setAcceptTarget(null)} onDone={handleDone} />}
      {rejectTarget && <RejectModal item={rejectTarget} onClose={() => setRejectTarget(null)} onDone={handleDone} />}
    </PageContainer>
  );
}
