import React, { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { KBJ_ALASAN_MIN } from "@/features/production/konfirmasiBarangJadiLogic.js";
import { AO_JUDUL, AO_LABEL_RUN_BELUM_DITUTUP, AO_PERNYATAAN, aoBolehKirim, aoKunciBaru, aoSaklarMengizinkan, aoUnitBisaDiOverride } from "@/features/production/adminOverrideSiapKirimLogic.js";

// ADMIN OVERRIDE: SIAP KIRIM SAAT PENCATATAN PRODUKSI BELUM SELESAI — keputusan Admin/Owner per unit. Pencatatan Production Run masih dalam pengembangan, jadi unit yang ditetapkan siap
// untuk proses pengiriman perlu bisa masuk Route Planner walau Run masih ACTIVE. Run/tahap Produksi dibiarkan (tidak ditutup, tidak diubah); QC/foto/serah terima Gudang/stok TIDAK dibuat.
// Ini BUKAN hasil pemeriksaan: layar ini tidak mengklaim pemeriksaan fisik atau QC. Server menegakkan izin dan semua syarat; layar mengumpulkan kode unit, lokasi pengambilan, alasan,
// dan pernyataan override setelah menampilkan pratinjau server (termasuk nasib unit lain pada order).
export function AdminOverrideDialog({ unitId, onClose, onDone }) {
  const [pv, setPv] = useState(null); const [muat, setMuat] = useState(true);
  const [kodeDiketik, setKodeDiketik] = useState(""); const [locationId, setLocationId] = useState(""); const [alasan, setAlasan] = useState(""); const [konfirmasi, setKonfirmasi] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [hasil, setHasil] = useState(null);
  const [kunci, setKunci] = useState(() => aoKunciBaru());

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
  const bolehKirim = aoBolehKirim({ eligible: pv?.eligible, aktif: aoSaklarMengizinkan(pv), kodeDiketik, kodeUnit: kode, locationId, alasan, konfirmasi, sibuk });
  // Muat ulang induk HANYA saat dialog ditutup supaya hasil sempat terbaca (panel induk bisa hilang begitu unit Siap Kirim).
  const tutup = () => { onClose(); if (hasil) onDone?.(); };
  async function kirim() {
    setSibuk(true); setGalat("");
    try {
      const res = await api.releaseProductionV2UnitForDelivery(unitId, {
        expectedRevision: pv.run.revision, unitCode: kodeDiketik.trim(), locationId, reason: alasan.trim().replace(/\s+/g, " "), adminOverrideConfirmed: true,
      }, kunci);
      setHasil(res);
    } catch (e) {
      setGalat(friendlyError(e));
      setKunci(aoKunciBaru()); // kegagalan: percobaan berikutnya memakai kunci baru
    } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && tutup()}
      title={`${AO_JUDUL}${kode ? ` — ${kode}` : ""}`}
      description="Keputusan Admin/Owner untuk satu unit — bukan hasil pemeriksaan atau QC. Run dan tahap Produksi dibiarkan."
      className="w-[580px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="ao-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={tutup} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="ao-tutup">Tutup</Button>
            {!hasil && (
              <Button variant="primary" disabled={!bolehKirim} onClick={kirim} className="max-sm:min-h-11 max-sm:px-4" data-testid="ao-konfirmasi">
                {sibuk ? "Memproses…" : "Tetapkan Siap Kirim (override)"}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {muat && <p className="m-0 text-[13px] text-ink3" data-testid="ao-memuat">Memeriksa keadaan unit…</p>}
      {!muat && pv && (
        <div className="space-y-3 text-[12.5px]" data-testid="ao-isi">
          {hasil ? (
            <div role="status" data-testid="ao-sukses" className="rounded-lg bg-greenbg px-3 py-2 text-green">
              <p className="m-0 font-semibold">Unit ditetapkan Siap Kirim lewat Admin override{hasil.orderStatus ? `; order ${hasil.orderStatus === "READY" ? "Siap Kirim" : hasil.orderStatus}` : ""}.</p>
              <p className="m-0 mt-0.5">Lokasi pengambilan: {hasil.pickupLocation?.code}. Diputuskan oleh {hasil.decidedBy?.name}. {AO_LABEL_RUN_BELUM_DITUTUP}. Tidak ada QC, foto, serah terima Gudang, atau stok yang dibuat.</p>
            </div>
          ) : (
            <>
              {!aoSaklarMengizinkan(pv) && (
                <div className="rounded-lg bg-orangebg px-3 py-2 text-orange" data-testid="ao-saklar-mati">
                  <p className="m-0 font-semibold">Admin override belum diaktifkan</p>
                  <p className="m-0 mt-0.5">{pv?.saklar?.enabled ? `Override sedang dibatasi untuk unit tertentu (${(pv.saklar.unitCodes ?? []).join(", ")}); unit ini belum termasuk.` : "Owner/Admin mengaktifkannya di Pengaturan Produksi › Alur Kerja. Tidak ada yang berubah sebelum itu."}</p>
                </div>
              )}
              {!pv.eligible && (
                <div className="rounded-lg bg-orangebg px-3 py-2 text-orange" data-testid="ao-penghalang">
                  <p className="m-0 font-semibold">Belum bisa ditetapkan Siap Kirim</p>
                  <ul className="m-0 mt-1 list-disc pl-4">{(pv.blockers ?? []).map((b) => <li key={b.code}>{b.text}</li>)}</ul>
                </div>
              )}
              <div className="rounded-lg bg-inset px-3 py-2" data-testid="ao-pratinjau">
                <p className="m-0 font-semibold text-ink">Yang akan terjadi</p>
                <ul className="m-0 mt-1 list-disc pl-4 text-ink2">
                  <li>Unit <b>{pv.unit.unitCode}</b> ({pv.unit.status}) menjadi <b>Siap Kirim</b>; order {pv.order.orderNumber} ({pv.order.status}) disinkronkan otomatis.</li>
                  <li>{AO_LABEL_RUN_BELUM_DITUTUP}: Run, tahap 10–12, dan bukti tahap <b>tidak diubah</b> — administrasi bisa dituntaskan kemudian.</li>
                  <li>Tidak ada QC, foto, serah terima Gudang, atau pergerakan stok yang dibuat. Tidak ada klaim pemeriksaan fisik atau QC.</li>
                  {(pv.siblings ?? []).length > 1 && <li data-testid="ao-unit-lain">Unit lain pada order ini TIDAK ikut ditetapkan: {pv.siblings.filter((s) => !s.thisUnit).map((s) => `${s.unitCode} (${s.status})`).join(", ")}.</li>}
                  <li>{(pv.deliveryJobs ?? []).length ? `Job pengiriman yang sudah ada dipakai (${pv.deliveryJobs.length}); tidak ada job ganda.` : "Job pengiriman dibuat otomatis (belum terjadwal, tanpa driver)."}</li>
                </ul>
              </div>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Ketik ulang kode unit <span className="font-mono text-ink3">({kode})</span></span>
                <input data-testid="ao-kode" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent" value={kodeDiketik} onChange={(e) => setKodeDiketik(e.target.value)} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Lokasi pengambilan <span className="font-normal text-ink3">(tempat unit diambil untuk pengiriman; tampil di Route Planner dan app Driver)</span></span>
                <select data-testid="ao-lokasi" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— pilih lokasi —</option>
                  {(pv.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name ?? l.zone}</option>)}
                </select>
                {(pv.locations ?? []).length === 0 && <span className="mt-1 block text-orange" data-testid="ao-lokasi-kosong">Belum ada lokasi area barang jadi/dispatch aktif — minta Gudang menambahkannya.</span>}
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Alasan override <span className="font-normal text-ink3">(minimal {KBJ_ALASAN_MIN} karakter; tercatat bersama nama dan waktu Anda)</span></span>
                <textarea data-testid="ao-alasan" className="min-h-[72px] w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} />
              </label>
              <label className="flex min-h-[40px] items-start gap-2 text-ink">
                <input data-testid="ao-verif" type="checkbox" className="mt-0.5 h-4 w-4" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} />
                <span>{AO_PERNYATAAN}</span>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// Tombol + dialog untuk SATU unit (dipakai Unit 360 dan panel Sales). Hanya Admin/Owner (isAdmin) dan unit yang masih dikerjakan Produksi.
export function AdminOverrideTombol({ unitId, unitStatus, isAdmin, onDone, label = "Admin override: Siap Kirim", className = "" }) {
  const [buka, setBuka] = useState(false);
  if (!isAdmin || !aoUnitBisaDiOverride({ status: unitStatus })) return null;
  return (
    <>
      <Button size="sm" variant="secondary" className={`min-h-[40px] ${className}`} data-testid="ao-buka" onClick={() => setBuka(true)}>
        <PackageCheck size={14} aria-hidden /> {label}
      </Button>
      {buka && <AdminOverrideDialog unitId={unitId} onClose={() => setBuka(false)} onDone={onDone} />}
    </>
  );
}

// Panel di Unit 360 (tab Pekerjaan): penjelasan singkat + tombol; atau banner jujur bila unit sudah di-override.
export function AdminOverrideUnit360({ d, isAdmin, onDone }) {
  const rel = d.production?.deliveryRelease ?? null;
  if (rel) {
    return (
      <div role="status" data-testid="ao-banner" className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">
        <p className="m-0 font-semibold">{rel.label ?? AO_LABEL_RUN_BELUM_DITUTUP}</p>
        <p className="m-0 mt-0.5">Lokasi pengambilan {rel.pickupLocationCode ?? "—"} · diputuskan oleh {rel.decidedByName ?? "—"}. Alasan: {rel.reason ?? "—"}. Tahap yang belum tercatat tidak diubah; Run ditutup administratif kemudian lewat Selesaikan Produksi.</p>
      </div>
    );
  }
  if (!isAdmin || !aoUnitBisaDiOverride({ status: d.identity?.status })) return null;
  return (
    <div data-testid="ao-panel" className="rounded-btn border border-line p-3 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Pencatatan produksi belum selesai, tapi unit perlu masuk pengiriman?</p>
      <p className="m-0 mt-0.5 text-ink3">Keputusan Admin/Owner, bukan hasil pemeriksaan atau QC: unit ditetapkan Siap Kirim sementara Run dan tahap tidak diubah. Tidak ada QC, foto, serah terima Gudang, atau stok yang dibuat.</p>
      <div className="mt-2"><AdminOverrideTombol unitId={d.identity.unitId ?? d.identity.id} unitStatus={d.identity.status} isAdmin={isAdmin} onDone={onDone} /></div>
    </div>
  );
}

// Panel di Sales (drawer order): tombol per unit yang masih dikerjakan Produksi. Hanya Admin/Owner; tidak tampil bila tidak ada unit yang memenuhi syarat.
// Daftar Order (Sales) tidak membawa unit: dimuat sendiri lewat GET /orders/:id/units (hanya untuk Admin/Owner dan order yang belum terkirim/batal).
export function AdminOverrideOrderPanel({ order, isAdmin, onDone }) {
  const [unitMuat, setUnitMuat] = useState(null); const [versi, setVersi] = useState(0);
  const orderId = order?.id; const orderStatus = order?.status;
  useEffect(() => {
    if (!isAdmin || !orderId || Array.isArray(order?.units) || ["DELIVERED", "CANCELLED"].includes(orderStatus)) { setUnitMuat(null); return undefined; }
    let batal = false;
    api.getOrderUnitsList(orderId).then((r) => { if (!batal) setUnitMuat(Array.isArray(r) ? r : []); }).catch(() => { if (!batal) setUnitMuat([]); });
    return () => { batal = true; };
  }, [isAdmin, orderId, orderStatus, versi]);
  const unit = (Array.isArray(order?.units) ? order.units : (unitMuat ?? [])).filter(aoUnitBisaDiOverride);
  if (!isAdmin || unit.length === 0) return null;
  return (
    <div data-testid="ao-order-panel" className="rounded-xl border border-line bg-surface p-3 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Pencatatan produksi belum selesai, tapi unit perlu masuk pengiriman?</p>
      <p className="m-0 mt-0.5 text-ink3">Dropdown status ditolak selama Production Run masih berjalan. Admin/Owner dapat memakai override per unit — keputusan Admin, bukan hasil pemeriksaan atau QC; Run Produksi tidak diubah.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {unit.map((u, i) => <AdminOverrideTombol key={u.id} unitId={u.id} unitStatus={u.status} isAdmin={isAdmin} onDone={() => { setVersi((v) => v + 1); onDone?.(); }} label={unit.length > 1 ? `Unit ${i + 1}: Admin override Siap Kirim` : undefined} />)}
      </div>
    </div>
  );
}

export default AdminOverrideDialog;
