import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { friendlyError } from "@/features/production/experience.js";

// Pengaturan Produksi › Alur Kerja (slice 2): lokasi workshop bawaan ("Unit Tiba di Workshop" satu aksi), mode adaptasi untuk run BARU, dan pemetaan Layanan Sales → layanan produksi
// (dipakai Diagnosis agar operator tidak memilih layanan lagi). Menulis hanya ADMIN/OWNER (production_settings:write — server menegakkan); Production Lead hanya melihat.
const SELECT = "h-9 min-w-[200px] rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-60";

const PROBLEM_TEXT = {
  NOT_CONFIGURED: "Belum dikonfigurasi — “Unit Tiba di Workshop” tidak bisa dipakai sampai Admin memilih lokasi.",
  MISSING: "Lokasi yang tersimpan tidak ditemukan — pilih lokasi lain.",
  INACTIVE: "Lokasi yang tersimpan nonaktif — aktifkan atau pilih lokasi lain.",
  WRONG_TYPE: "Lokasi bukan area Receiving/WIP — pilih lokasi yang sesuai.",
};

export default function ProductionWorkflowSettings() {
  const [s, setS] = useState(null); const [maps, setMaps] = useState(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([api.getProductionV2Settings(), api.getProductionV2ServiceMappings()]); setS(a); setMaps(b); setError(""); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (key, fn, ok) => { setBusy(key); setError(""); setNotice(""); try { await fn(); setNotice(ok); await load(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(""); } };
  const canWrite = !!s?.canWrite;
  const loc = s?.workshopLocation;
  const unmapped = (maps?.items || []).filter((i) => !i.mapped && i.kind === "SERVICE").length;

  return (
    <PageContainer>
      <PageHeader title="Alur Kerja" subtitle="Lokasi tiba di workshop, mode adaptasi, dan pemetaan layanan Sales ke layanan produksi." />
      <PageBody>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {!canWrite && s && <p data-testid="workflow-readonly" className="m-0 text-[12px] text-ink3">Hanya Admin/Owner yang dapat mengubah pengaturan ini; Anda dapat melihatnya.</p>}

        <Card className="space-y-2 p-4" data-testid="workshop-location-card">
          <h3 className="m-0 text-[14px] font-bold text-ink">Lokasi workshop bawaan</h3>
          <p className="m-0 text-[12.5px] text-ink3">Dipakai tombol “Unit Tiba di Workshop” (satu aksi, tanpa pilihan lokasi). Tidak pernah dipilih otomatis.</p>
          {loc && (
            <p data-testid="workshop-location-state" className={`m-0 rounded-btn px-3 py-2 text-[12.5px] ${loc.valid ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`}>
              {loc.valid ? `Lokasi aktif: ${loc.location.code}${loc.location.zone ? ` (${loc.location.zone})` : ""}` : PROBLEM_TEXT[loc.problem] || "Lokasi belum valid."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Lokasi workshop bawaan" data-testid="workshop-location-select" className={SELECT} disabled={!canWrite || !!busy} value={loc?.location?.id || ""}
              onChange={(e) => e.target.value && run("loc", () => api.setProductionV2WorkshopLocation(e.target.value), "Lokasi workshop bawaan tersimpan.")}>
              <option value="">— pilih lokasi Receiving/WIP —</option>
              {(s?.locationChoices || []).map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` (${l.zone})` : ""}</option>)}
            </select>
          </div>
          {s && s.locationChoices.length === 0 && <p className="m-0 text-[12px] text-orange">Belum ada lokasi Receiving/WIP aktif. Minta Gudang mengaktifkan satu lokasi.</p>}
        </Card>

        <Card className="space-y-2 p-4" data-testid="adaptation-default-card">
          <h3 className="m-0 text-[14px] font-bold text-ink">Mode adaptasi untuk run baru</h3>
          <p className="m-0 text-[12.5px] text-ink3">Bila aktif, run yang dibuka SETELAH ini mencatat kebijakan adaptasi: tahap boleh dilewati (dicatat “Dilewati — Adaptasi sistem”), QC dan penerimaan barang jadi Gudang tidak diwajibkan (QC dicatat tidak dilakukan, bukan lulus). <b>Run yang sudah ada tidak berubah.</b></p>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input data-testid="adaptation-default-toggle" type="checkbox" disabled={!canWrite || !!busy} checked={!!s?.adaptationDefault?.enabled}
            onChange={(e) => run("adapt", () => api.setProductionV2AdaptationDefault(e.target.checked), e.target.checked ? "Mode adaptasi aktif untuk run baru." : "Mode adaptasi dimatikan untuk run baru.")} /> Aktif untuk run baru</label>
        </Card>

        <Card className="space-y-2 p-4" data-testid="qc-gate-default-card">
          <h3 className="m-0 text-[14px] font-bold text-ink">Gerbang QC untuk run baru</h3>
          <p className="m-0 text-[12.5px] text-ink3">Bawaan <b>nonaktif</b> (kebijakan lama) sampai Admin mengaktifkannya. Bila aktif, run LAYANAN yang dibuka SETELAH ini dipin ke versi yang dipilih saat lahir: <b>V1</b> = catatan PIC QC sebelum bongkar; <b>V2</b> = V1 + gerbang perakitan (uji fondasi baru, hasil aktual, uji kasur jadi). Mengubah bawaan <b>tidak mengubah run yang sudah ada</b>; menerapkan ke run berjalan hanya lewat aksi eksplisit beralasan yang tercatat di run itu.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink"><input data-testid="qc-gate-default-toggle" type="checkbox" disabled={!canWrite || !!busy} checked={!!s?.qcGateDefault?.enabled}
              onChange={(e) => run("qcgate", () => api.setProductionV2QcGateDefault(e.target.checked, e.target.checked ? (s?.qcGateDefault?.policy || "QC_GATE_V2") : undefined), e.target.checked ? "Gerbang QC aktif untuk run baru." : "Gerbang QC dimatikan untuk run baru (run yang sudah ada tidak berubah).")} /> Aktif untuk run baru</label>
            <select data-testid="qc-gate-default-version" aria-label="Versi gerbang QC untuk run baru" className={SELECT} disabled={!canWrite || !!busy || !s?.qcGateDefault?.enabled} value={s?.qcGateDefault?.policy || "QC_GATE_V2"}
              onChange={(e) => run("qcgatev", () => api.setProductionV2QcGateDefault(true, e.target.value), "Versi gerbang QC untuk run baru diperbarui.")}>
              <option value="QC_GATE_V1">V1 — QC sebelum bongkar</option>
              <option value="QC_GATE_V2">V2 — V1 + gerbang perakitan</option>
            </select>
            <span className="text-[12px] text-ink3" data-testid="qc-gate-default-state">{s?.qcGateDefault?.enabled ? `Aktif: ${s.qcGateDefault.policy}` : "Nonaktif (kebijakan lama)"}</span>
          </div>
        </Card>

        <Card className="space-y-2 p-4" data-testid="service-mapping-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-[14px] font-bold text-ink">Pemetaan layanan Sales → layanan produksi</h3>
            {maps && <Badge variant={unmapped ? "orange" : "green"} data-testid="mapping-unmapped">{unmapped ? `${unmapped} layanan belum dipetakan` : "Semua layanan terpetakan"}</Badge>}
          </div>
          <p className="m-0 text-[12.5px] text-ink3">Diagnosis memakai pemetaan ini; operator tidak memilih layanan lagi. Layanan yang belum dipetakan tidak ditebak dari namanya — Diagnosis berhenti dengan arahan ke halaman ini.</p>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {(maps?.items || []).filter((i) => i.kind === "SERVICE").map((i) => (
              <li key={i.id} data-testid="mapping-row" data-mapped={i.mapped ? "1" : "0"} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-[13px] text-ink">{i.name}</span>
                <select aria-label={`Layanan produksi untuk ${i.name}`} className={SELECT} disabled={!canWrite || !!busy} value={i.service?.id || ""}
                  onChange={(e) => run(`map-${i.id}`, () => api.setProductionV2ServiceMapping(i.id, e.target.value || null), "Pemetaan tersimpan.")}>
                  <option value="">— belum dipetakan —</option>
                  {(maps?.services || []).map((sv) => <option key={sv.id} value={sv.id}>{sv.labelId}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      </PageBody>
    </PageContainer>
  );
}
