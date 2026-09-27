import React, { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, PackageCheck, PackageX, RefreshCw, Truck, Undo2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { LOCATION_TYPE_REAL } from "@/features/warehouse/inventoryReal.js";
import {
  CUSTODY_TABS, directionLabel, emptyStateCopy, isCustodyDecisionPending, locationsAllowedForDirection, statusBadgeFor,
} from "@/features/warehouse/unitCustody.js";

// Custody unit V2 (Production Workshop + Warehouse V2, P1–P2) — antrean serah-terima Delivery <-> Gudang.
// Data hanya muncul bila reader V2 (production_v2_reader) diaktifkan server untuk cohort unit terkait; di luar
// itu antrean SELALU kosong (fail-closed), bukan error — lihat routes/unitCustody.js. Halaman ini TIDAK
// mengaktifkan/mengubah flag apa pun; hanya membaca keputusan server (readerMode) untuk pesan yang jujur.
// Driver Mobile / Delivery Control Mobile tidak disentuh oleh slice ini. Logika murni (badge/filter lokasi/
// empty state) ada di features/warehouse/unitCustody.js, diuji lewat tests/unitCustody.test.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function CustodyCard({ item, onAccept, onReject }) {
  const badge = statusBadgeFor(item.status);
  const isPending = isCustodyDecisionPending(item.status);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
          <p className="text-[12px] text-ink3">
            {item.unit.orderNumber ? `Order ${item.unit.orderNumber}` : "Tanpa nomor order"}
            {item.unit.merk ? ` · ${item.unit.merk}` : ""}
          </p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-ink3">
        {item.direction === "INBOUND" ? <Truck size={13} /> : <Undo2 size={13} />}
        <span>{directionLabel(item.direction)}</span>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Ditawarkan</dt><dd className="text-ink">{waktu(item.offeredAt)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Sumber Job</dt><dd className="text-ink">{item.deliveryJob?.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}</dd></div>
        {item.location && (
          <div className="flex justify-between"><dt className="text-ink3">Lokasi</dt><dd className="text-ink">{item.location.code}</dd></div>
        )}
        {item.reason && (
          <div className="flex justify-between gap-2"><dt className="shrink-0 text-ink3">Alasan</dt><dd className="text-right text-ink">{item.reason}</dd></div>
        )}
      </dl>
      {isPending && (
        <div className="mt-1 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAccept(item)}><PackageCheck size={14} /> Terima</Button>
          <Button size="sm" variant="ghost" className="flex-1" onClick={() => onReject(item)}><PackageX size={14} /> Tolak</Button>
        </div>
      )}
    </Card>
  );
}

function AcceptModal({ item, onClose, onDone }) {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getStorageLocations()
      .then((d) => setLocations(locationsAllowedForDirection(d.locations, item.direction)))
      .catch((e) => setError(e.message));
  }, [item.direction]);

  const submit = async () => {
    if (!locationId) { setError("Pilih lokasi penyimpanan terlebih dahulu"); return; }
    setSaving(true); setError("");
    try {
      const result = await api.acceptUnitCustody(item.id, { locationId, expectedRevision: item.revision });
      onDone(result.replayed ? "Sudah diproses sebelumnya (tidak ada perubahan ganda)." : `Unit ${item.unit.unitCode} diterima ke Gudang.`);
    } catch (e) {
      if (e.status === 409) setError("Data sudah berubah (mungkin diproses petugas lain) — muat ulang antrean.");
      else setError(e.message || "Gagal menerima unit");
    } finally { setSaving(false); }
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Terima Unit ${item.unit.unitCode}`} description="Pilih lokasi penyimpanan tujuan sebelum menerima unit ini dari Delivery.">
      <div className="space-y-3">
        {locations === null ? (
          <p className="text-[12.5px] text-ink3">Memuat daftar lokasi…</p>
        ) : locations.length === 0 ? (
          <p className="text-[12.5px] text-red">Tidak ada lokasi penyimpanan aktif yang sesuai untuk serah-terima ini. Hubungi Admin Gudang.</p>
        ) : (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink"
          >
            <option value="">— Pilih lokasi —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} · {LOCATION_TYPE_REAL[l.locationType] || l.locationType}{l.warehouse?.name ? ` (${l.warehouse.name})` : ""}</option>
            ))}
          </select>
        )}
        {error && <p className="text-[12.5px] text-red">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
        <Button onClick={submit} disabled={saving || !locations?.length}>{saving ? "Menyimpan…" : "Terima Unit"}</Button>
      </div>
    </Modal>
  );
}

function RejectModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 3) { setError("Alasan penolakan wajib diisi (minimal 3 karakter)"); return; }
    setSaving(true); setError("");
    try {
      const result = await api.rejectUnitCustody(item.id, { reason: reason.trim(), expectedRevision: item.revision });
      onDone(result.replayed ? "Sudah diproses sebelumnya (tidak ada perubahan ganda)." : `Unit ${item.unit.unitCode} ditolak dan masuk Riwayat.`);
    } catch (e) {
      if (e.status === 409) setError("Data sudah berubah (mungkin diproses petugas lain) — muat ulang antrean.");
      else setError(e.message || "Gagal menolak unit");
    } finally { setSaving(false); }
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Tolak Unit ${item.unit.unitCode}`} description="Alasan penolakan wajib diisi — riwayat unit tetap tersimpan, tidak dihapus.">
      <div className="space-y-3">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Contoh: kondisi unit rusak parah, unit tidak sesuai dokumen"
          className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink"
        />
        {error && <p className="text-[12.5px] text-red">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
        <Button variant="destructive" onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : "Tolak Unit"}</Button>
      </div>
    </Modal>
  );
}

export default function WarehouseUnitCustody() {
  const [tab, setTab] = useState("OFFERED");
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acceptTarget, setAcceptTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getUnitCustodyHandoffs({ status: tab })
      .then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat antrean"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && items && items.length === 0;
  const emptyCopy = emptyStateCopy({ readerMode, tabKey: tab });

  const handleDone = (message) => { setAcceptTarget(null); setRejectTarget(null); setNotice(message); load(); };

  return (
    <PageContainer>
      <PageHeader
        title="Antrean Penerimaan Unit"
        subtitle="Serah-terima unit fisik antara Delivery dan Gudang (custody Production Workshop V2)."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />
      <PageBody>
        <div role="tablist" aria-label="Saring status custody" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {CUSTODY_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}
            >
              {t.label}
            </button>
          ))}
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} unit</span>}
        </div>

        {notice && <div className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => <Card key={n} className="h-40 animate-pulse bg-inset" />)}
          </div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0">
            <EmptyState icon={ClipboardCheck} title={emptyCopy.title} description={emptyCopy.description} />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <CustodyCard key={item.id} item={item} onAccept={setAcceptTarget} onReject={setRejectTarget} />
            ))}
          </div>
        )}
      </PageBody>

      {acceptTarget && <AcceptModal item={acceptTarget} onClose={() => setAcceptTarget(null)} onDone={handleDone} />}
      {rejectTarget && <RejectModal item={rejectTarget} onClose={() => setRejectTarget(null)} onDone={handleDone} />}
    </PageContainer>
  );
}
