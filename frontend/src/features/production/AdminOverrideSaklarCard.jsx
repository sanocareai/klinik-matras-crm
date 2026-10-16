import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { aoAlasanSaklarValid, aoParseKodeUnit, aoRingkasSaklar } from "@/features/production/adminOverrideSiapKirimLogic.js";

// SAKLAR + LAPORAN "Admin override: Siap Kirim saat pencatatan produksi belum selesai" (Pengaturan Produksi › Alur Kerja; hanya Admin/Owner).
// Saklar bawaan NONAKTIF (fail-closed). Mematikannya HANYA menghentikan override BARU: unit yang sudah dilepas, Run, dan audit tidak berubah; job/rute yang telanjur terbentuk ditangani lewat laporan di bawah
// (tindakan aman per keadaan) dan prosedur docs/RUNBOOK-ADMIN-OVERRIDE-SIAP-KIRIM.md — bukan lewat rollback kode.
export default function AdminOverrideSaklarCard({ canWrite = false }) {
  const [sw, setSw] = useState(null); const [rap, setRap] = useState(null);
  const [alasan, setAlasan] = useState(""); const [kodeUnit, setKodeUnit] = useState("");
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [info, setInfo] = useState("");
  const muat = useCallback(async () => {
    try { const [a, b] = await Promise.all([api.getAdminOverrideSwitch(), api.getAdminOverrideReport()]); setSw(a); setRap(b); setGalat(""); }
    catch (e) { setGalat(friendlyError(e)); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const ubah = async (enabled) => {
    setSibuk(true); setGalat(""); setInfo("");
    try {
      await api.setAdminOverrideSwitch({ enabled, unitCodes: enabled ? aoParseKodeUnit(kodeUnit) : (sw?.unitCodes ?? []), reason: alasan.trim().replace(/\s+/g, " ") });
      setInfo(enabled ? "Admin override diaktifkan." : "Override BARU dihentikan. Unit yang sudah dilepas tidak berubah."); setAlasan(""); await muat();
    } catch (e) { setGalat(friendlyError(e)); } finally { setSibuk(false); }
  };
  const ringkas = aoRingkasSaklar(sw);
  return (
    <Card className="space-y-2 p-4" data-testid="ao-saklar-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[14px] font-bold text-ink">Admin override: Siap Kirim saat pencatatan produksi belum selesai</h3>
        {sw && <Badge variant={ringkas.aktif ? "orange" : "green"} data-testid="ao-saklar-status">{ringkas.label}</Badge>}
      </div>
      <p className="m-0 text-[12.5px] text-ink3">
        Keputusan Admin/Owner per unit, bukan hasil pemeriksaan atau QC. Bawaan <b>nonaktif</b>. Mematikan saklar hanya menghentikan override <b>baru</b> — unit yang sudah dilepas, Run, dan audit tidak berubah.
      </p>
      {galat && <p role="alert" data-testid="ao-saklar-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
      {info && <p role="status" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{info}</p>}
      {canWrite && (
        <div className="space-y-2">
          <label className="block text-[12.5px] text-ink">Batasi ke kode unit tertentu <span className="text-ink3">(opsional, pisahkan dengan koma; kosong = semua unit yang memenuhi syarat)</span>
            <input data-testid="ao-saklar-unit" className="mt-1 h-9 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={kodeUnit} onChange={(e) => setKodeUnit(e.target.value)} disabled={sibuk} />
          </label>
          <label className="block text-[12.5px] text-ink">Alasan perubahan saklar <span className="text-ink3">(minimal 10 karakter; tercatat bersama nama dan waktu Anda)</span>
            <input data-testid="ao-saklar-alasan" className="mt-1 h-9 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={alasan} maxLength={300} onChange={(e) => setAlasan(e.target.value)} disabled={sibuk} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" data-testid="ao-saklar-aktifkan" disabled={sibuk || !aoAlasanSaklarValid(alasan)} onClick={() => ubah(true)}>Aktifkan override</Button>
            <Button size="sm" variant="danger" data-testid="ao-saklar-hentikan" disabled={sibuk || !aoAlasanSaklarValid(alasan) || !ringkas.aktif} onClick={() => ubah(false)}>Hentikan override baru</Button>
          </div>
        </div>
      )}
      {rap && (
        <div className="space-y-1.5" data-testid="ao-laporan">
          <p className="m-0 text-[12.5px] font-semibold text-ink">Override yang sudah terjadi: {rap.ringkas.total} · Run belum ditutup: {rap.ringkas.runBelumDitutup} · job yang bisa ditangani: {rap.ringkas.jobBisaDitangani} · job sedang berjalan: {rap.ringkas.jobSedangBerjalan}</p>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {rap.items.map((i) => (
              <li key={i.runId} data-testid="ao-laporan-baris" className="py-2 text-[12.5px] text-ink2">
                <span className="font-mono text-ink">{i.unit.unitCode}</span> · unit {i.unit.status} · order {i.order?.orderNumber} ({i.order?.status}) · lokasi {i.pickupLocation?.code ?? "—"} · diputuskan {i.decidedBy?.name ?? "—"}
                {i.tanpaJob && <div className="text-ink3">Belum ada job pengiriman. {i.tanpaJob.tindakan}</div>}
                {i.jobs.map((j) => <div key={j.id} className="text-ink3">Job {j.status}{j.route ? ` · rute ${j.route.code} (${j.route.status})` : " · tanpa rute"}{j.driver ? ` · driver ${j.driver.name}` : ""} — {j.tindakan}</div>)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
