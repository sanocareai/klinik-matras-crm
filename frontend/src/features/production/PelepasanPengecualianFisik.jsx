import React, { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { KBJ_ALASAN_MIN } from "@/features/production/konfirmasiBarangJadiLogic.js";
import { PF_LABEL_RUN_BELUM_DITUTUP, pfBolehKirim, pfKunciBaru, pfUnitBisaDilepas } from "@/features/production/pelepasanFisikLogic.js";

// TANDAI SIAP KIRIM BERDASARKAN PEMERIKSAAN FISIK — pengecualian operasional Admin/Owner. Barang fisik sudah jadi, tetapi Run/tahap Produksi dibiarkan dulu (tidak ditutup, tidak diubah).
// Unit dilepas ke Siap Kirim dan bisa masuk Route Planner; QC/foto/serah terima Gudang/stok TIDAK dibuat. Server menegakkan izin dan semua syarat; layar ini mengumpulkan kode unit,
// lokasi barang yang sebenarnya, alasan, pemeriksa, dan pernyataan pemeriksaan fisik setelah menampilkan pratinjau server (termasuk nasib unit lain pada order).
export function PelepasanPengecualianDialog({ unitId, onClose, onDone }) {
  const [pv, setPv] = useState(null); const [muat, setMuat] = useState(true);
  const [kodeDiketik, setKodeDiketik] = useState(""); const [locationId, setLocationId] = useState(""); const [alasan, setAlasan] = useState(""); const [inspectorUserId, setInspectorUserId] = useState(""); const [verif, setVerif] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [hasil, setHasil] = useState(null);
  const [kunci, setKunci] = useState(() => pfKunciBaru());

  useEffect(() => {
    let batal = false;
    (async () => {
      try { const a = await api.getProductionV2DeliveryRelease(unitId); if (!batal) setPv(a); }
      catch (e) { if (!batal) setGalat(friendlyError(e)); }
      finally { if (!batal) setMuat(false); }
    })();
    return () => { batal = true; };
  }, [unitId]);

  const kode = pv?.unit?.unitCode ?? "";
  const bolehKirim = pfBolehKirim({ eligible: pv?.eligible, kodeDiketik, kodeUnit: kode, locationId, alasan, verif, sibuk });
  // Muat ulang induk HANYA saat dialog ditutup supaya hasil sempat terbaca (panel induk bisa hilang begitu unit Siap Kirim).
  const tutup = () => { onClose(); if (hasil) onDone?.(); };
  async function kirim() {
    setSibuk(true); setGalat("");
    try {
      const res = await api.releaseProductionV2UnitForDelivery(unitId, {
        expectedRevision: pv.run.revision, unitCode: kodeDiketik.trim(), locationId, reason: alasan.trim().replace(/\s+/g, " "), physicalVerified: true, ...(inspectorUserId ? { inspectorUserId } : {}),
      }, kunci);
      setHasil(res);
    } catch (e) {
      setGalat(friendlyError(e));
      setKunci(pfKunciBaru()); // kegagalan: percobaan berikutnya memakai kunci baru
    } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && tutup()}
      title={`Tandai Siap Kirim berdasarkan pemeriksaan fisik${kode ? ` — ${kode}` : ""}`}
      description="Pengecualian Admin/Owner. Run dan tahap Produksi dibiarkan; hanya unit yang dilepas untuk pengiriman."
      className="w-[580px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="pf-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={tutup} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="pf-tutup">Tutup</Button>
            {!hasil && (
              <Button variant="primary" disabled={!bolehKirim} onClick={kirim} className="max-sm:min-h-11 max-sm:px-4" data-testid="pf-konfirmasi">
                {sibuk ? "Memproses…" : "Tandai Siap Kirim"}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {muat && <p className="m-0 text-[13px] text-ink3" data-testid="pf-memuat">Memeriksa keadaan unit…</p>}
      {!muat && pv && (
        <div className="space-y-3 text-[12.5px]" data-testid="pf-isi">
          {hasil ? (
            <div role="status" data-testid="pf-sukses" className="rounded-lg bg-greenbg px-3 py-2 text-green">
              <p className="m-0 font-semibold">Unit dilepas — Siap Kirim{hasil.orderStatus ? `; order ${hasil.orderStatus === "READY" ? "Siap Kirim" : hasil.orderStatus}` : ""}.</p>
              <p className="m-0 mt-0.5">Lokasi: {hasil.lokasi?.code}. Pemeriksa: {hasil.inspector?.name}. {PF_LABEL_RUN_BELUM_DITUTUP}. Tidak ada QC, foto, serah terima Gudang, atau stok yang dibuat.</p>
            </div>
          ) : (
            <>
              {!pv.eligible && (
                <div className="rounded-lg bg-orangebg px-3 py-2 text-orange" data-testid="pf-penghalang">
                  <p className="m-0 font-semibold">Belum bisa ditandai Siap Kirim</p>
                  <ul className="m-0 mt-1 list-disc pl-4">{(pv.blockers ?? []).map((b) => <li key={b.code}>{b.text}</li>)}</ul>
                </div>
              )}
              <div className="rounded-lg bg-inset px-3 py-2" data-testid="pf-pratinjau">
                <p className="m-0 font-semibold text-ink">Yang akan terjadi</p>
                <ul className="m-0 mt-1 list-disc pl-4 text-ink2">
                  <li>Unit <b>{pv.unit.unitCode}</b> ({pv.unit.status}) menjadi <b>Siap Kirim</b>; order {pv.order.orderNumber} ({pv.order.status}) disinkronkan otomatis.</li>
                  <li>{PF_LABEL_RUN_BELUM_DITUTUP}: Run, tahap 10–12, dan bukti tahap <b>tidak diubah</b> — administrasi bisa dituntaskan kemudian.</li>
                  <li>Tidak ada QC, foto, serah terima Gudang, atau pergerakan stok yang dibuat.</li>
                  {(pv.siblings ?? []).length > 1 && <li data-testid="pf-unit-lain">Unit lain pada order ini TIDAK ikut dilepas: {pv.siblings.filter((s) => !s.thisUnit).map((s) => `${s.unitCode} (${s.status})`).join(", ")}.</li>}
                  <li>{(pv.deliveryJobs ?? []).length ? `Job pengiriman yang sudah ada dipakai (${pv.deliveryJobs.length}); tidak ada job ganda.` : "Job pengiriman dibuat otomatis (belum terjadwal, tanpa driver)."}</li>
                </ul>
              </div>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Ketik ulang kode unit <span className="font-mono text-ink3">({kode})</span></span>
                <input data-testid="pf-kode" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent" value={kodeDiketik} onChange={(e) => setKodeDiketik(e.target.value)} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Lokasi barang yang sebenarnya</span>
                <select data-testid="pf-lokasi" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— pilih lokasi —</option>
                  {(pv.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name ?? l.zone}</option>)}
                </select>
                {(pv.locations ?? []).length === 0 && <span className="mt-1 block text-orange" data-testid="pf-lokasi-kosong">Belum ada lokasi area barang jadi/dispatch aktif — minta Gudang menambahkannya.</span>}
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Pemeriksa fisik <span className="font-normal text-ink3">(kosong = Anda sendiri)</span></span>
                <select data-testid="pf-pemeriksa" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={inspectorUserId} onChange={(e) => setInspectorUserId(e.target.value)}>
                  <option value="">Saya sendiri</option>
                  {(pv.inspectors ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Alasan pengecualian <span className="font-normal text-ink3">(minimal {KBJ_ALASAN_MIN} karakter; tercatat bersama nama dan waktu Anda)</span></span>
                <textarea data-testid="pf-alasan" className="min-h-[72px] w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} />
              </label>
              <label className="flex min-h-[40px] items-start gap-2 text-ink">
                <input data-testid="pf-verif" type="checkbox" className="mt-0.5 h-4 w-4" checked={verif} onChange={(e) => setVerif(e.target.checked)} />
                <span>Barang sudah diperiksa langsung dan benar-benar jadi; saya memahami Run Produksi belum ditutup.</span>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// Tombol + dialog untuk SATU unit (dipakai Unit 360 dan panel Sales). Hanya Admin/Owner (isAdmin) dan unit yang masih dikerjakan Produksi.
export function PelepasanUnitTombol({ unitId, unitStatus, isAdmin, onDone, label = "Tandai Siap Kirim berdasarkan pemeriksaan fisik", className = "" }) {
  const [buka, setBuka] = useState(false);
  if (!isAdmin || !pfUnitBisaDilepas({ status: unitStatus })) return null;
  return (
    <>
      <Button size="sm" variant="secondary" className={`min-h-[40px] ${className}`} data-testid="pf-buka" onClick={() => setBuka(true)}>
        <PackageCheck size={14} aria-hidden /> {label}
      </Button>
      {buka && <PelepasanPengecualianDialog unitId={unitId} onClose={() => setBuka(false)} onDone={onDone} />}
    </>
  );
}

// Panel di Unit 360 (tab Pekerjaan): penjelasan singkat + tombol; atau banner "Run belum ditutup" bila unit sudah dilepas.
export function PelepasanUnit360({ d, isAdmin, onDone }) {
  const rel = d.production?.deliveryRelease ?? null;
  if (rel) {
    return (
      <div role="status" data-testid="pf-banner" className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">
        <p className="m-0 font-semibold">{rel.label ?? PF_LABEL_RUN_BELUM_DITUTUP}</p>
        <p className="m-0 mt-0.5">Lokasi {rel.locationCode ?? "—"} · pemeriksa {rel.inspectorName ?? "—"} · dilepas oleh {rel.releasedByName ?? "—"}. Alasan: {rel.reason ?? "—"}. Tahap 10–12 tidak dicatat; tuntaskan administrasi Run lewat Konfirmasi Barang Jadi bila sudah siap.</p>
      </div>
    );
  }
  if (!isAdmin || !pfUnitBisaDilepas({ status: d.identity?.status })) return null;
  return (
    <div data-testid="pf-panel" className="rounded-btn border border-line p-3 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Barang sudah jadi tapi Run ingin dibiarkan dulu?</p>
      <p className="m-0 mt-0.5 text-ink3">Pengecualian Admin/Owner: unit dilepas untuk pengiriman berdasarkan pemeriksaan fisik. Run dan tahap tidak diubah; tidak ada QC, foto, serah terima Gudang, atau stok yang dibuat.</p>
      <div className="mt-2"><PelepasanUnitTombol unitId={d.identity.unitId ?? d.identity.id} unitStatus={d.identity.status} isAdmin={isAdmin} onDone={onDone} /></div>
    </div>
  );
}

// Panel di Sales (drawer order): daftar unit order yang masih dikerjakan Produksi + tombol per unit. Hanya Admin/Owner; tidak tampil bila tidak ada unit yang memenuhi syarat.
// Daftar order (Sales) tidak membawa unit: dimuat sendiri lewat GET /orders/:id/units (hanya untuk Admin/Owner dan order yang belum terkirim/batal).
export function PelepasanOrderPanel({ order, isAdmin, onDone }) {
  const [unitMuat, setUnitMuat] = useState(null); const [versi, setVersi] = useState(0);
  const orderId = order?.id; const orderStatus = order?.status;
  useEffect(() => {
    if (!isAdmin || !orderId || Array.isArray(order?.units) || ["DELIVERED", "CANCELLED"].includes(orderStatus)) { setUnitMuat(null); return undefined; }
    let batal = false;
    api.getOrderUnitsList(orderId).then((r) => { if (!batal) setUnitMuat(Array.isArray(r) ? r : []); }).catch(() => { if (!batal) setUnitMuat([]); });
    return () => { batal = true; };
  }, [isAdmin, orderId, orderStatus, versi]);
  const unit = (Array.isArray(order?.units) ? order.units : (unitMuat ?? [])).filter(pfUnitBisaDilepas);
  if (!isAdmin || unit.length === 0) return null;
  return (
    <div data-testid="pf-order-panel" className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Barang fisik sudah jadi, tapi status Produksi belum?</p>
      <p className="m-0 mt-0.5 text-ink3">Dropdown status ditolak selama Production Run masih berjalan. Admin/Owner dapat menandai unit Siap Kirim berdasarkan pemeriksaan fisik — Run Produksi tidak diubah.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {unit.map((u, i) => <PelepasanUnitTombol key={u.id} unitId={u.id} unitStatus={u.status} isAdmin={isAdmin} onDone={() => { setVersi((v) => v + 1); onDone?.(); }} label={unit.length > 1 ? `Unit ${i + 1}: Tandai Siap Kirim (pemeriksaan fisik)` : undefined} />)}
      </div>
    </div>
  );
}

export default PelepasanPengecualianDialog;
