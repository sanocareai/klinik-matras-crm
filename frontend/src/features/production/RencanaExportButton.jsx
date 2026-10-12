import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { mejaLabel } from "@/features/production/unitCardModel.js";
import { rolesOf } from "@/lib/roles.js";
import { buildExportBody } from "@/utils/exportRencanaProduksi.js";

// Export Excel Rencana Produksi (.xlsx) — snapshot BACA-SAJA. Data dari server (POST /production-v2/rencana/export, view papan yang sama); berkas dibuat oleh utils/exportRencanaProduksi.js
// (utilitas bersama dengan Export Order Sales). Tidak membaca teks kartu dari layar dan tidak mengubah jadwal. "Kartu yang sedang terlihat" = id kartu di layar (Meja + backlog yang termuat).
const readUser = () => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } };
export const canIncludeOrderValue = () => rolesOf(readUser()).some((r) => r === "ADMIN" || r === "OWNER");

export default function RencanaExportButton({ date, stations = [], visibleRunIds = [], visibleUnitIds = [], dateLabel = "", disabled = false, onDone = null }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("papan");
  const [from, setFrom] = useState(date); const [to, setTo] = useState(date);
  const [mejaMode, setMejaMode] = useState("semua"); const [mejaSel, setMejaSel] = useState([]);
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [includeUnscheduled, setIncludeUnscheduled] = useState(true);
  const [includeValue, setIncludeValue] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState("");
  const adminOwner = useMemo(() => canIncludeOrderValue(), []);

  function openDialog() { setFrom(date); setTo(date); setError(""); setDone(""); setOpen(true); }
  function toggleMeja(code) { setMejaSel((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code])); }
  const rangeInvalid = scope === "rentang" && (!from || !to || to < from);
  const mejaInvalid = !visibleOnly && mejaMode === "tertentu" && mejaSel.length === 0;

  async function submit() {
    setBusy(true); setError(""); setDone("");
    try {
      const body = buildExportBody({ scope, date, from, to, mejaMode: visibleOnly ? "semua" : mejaMode, mejaSel, visibleOnly, includeUnscheduled: visibleOnly ? false : includeUnscheduled, includeValue: adminOwner && includeValue, visibleRunIds, visibleUnitIds });
      const data = await api.exportRencanaProduksi(body);
      if (data.readerMode === "OFF") throw new Error("Rencana produksi belum diaktifkan — tidak ada data untuk diexport.");
      if (!data.rows?.length) throw new Error("Tidak ada unit pada cakupan ini. Ubah tanggal, Meja, atau filter.");
      const { exportRencanaProduksi } = await import("@/utils/exportRencanaProduksi.js");
      const name = await exportRencanaProduksi(data);
      const msg = `${name} diunduh (${data.rows.length} unit${data.meta.truncated ? `, dipotong di ${data.meta.maxRows}` : ""}).`;
      setDone(msg); onDone?.(msg);
    } catch (e) { setError(e?.message ? friendlyError(e) : "Export gagal."); } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="neutral" size="sm" className="min-h-[40px]" data-testid="export-excel-open" disabled={disabled} onClick={openDialog}><Download size={14} aria-hidden /> Export Excel</Button>
      {open && (
        <Modal open onOpenChange={(v) => !v && !busy && setOpen(false)} title="Export Excel — Target Produksi"
          description="Snapshot baca-saja dari server. File tidak bisa dipakai untuk mengubah jadwal."
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="neutral" onClick={() => setOpen(false)} disabled={busy}>Tutup</Button>
              <Button data-testid="export-submit" onClick={submit} disabled={busy || rangeInvalid || mejaInvalid}>{busy ? "Menyiapkan…" : "Unduh .xlsx"}</Button>
            </div>
          }>
          <div className="space-y-4 px-6 pb-2" data-testid="export-excel-dialog">
            <fieldset className="min-w-0 space-y-2 border-0 p-0" disabled={visibleOnly}>
              <legend className="mb-1 text-[12.5px] font-semibold text-ink2">Tanggal</legend>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="export-scope" data-testid="export-scope-board" checked={scope === "papan"} onChange={() => setScope("papan")} /> Tanggal papan saat ini{dateLabel ? ` (${dateLabel})` : ""}</label>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="export-scope" data-testid="export-scope-range" checked={scope === "rentang"} onChange={() => setScope("rentang")} /> Rentang tanggal</label>
              {scope === "rentang" && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <input type="date" aria-label="Dari tanggal" data-testid="export-from" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-[38px] rounded-btn border border-line bg-surface px-2 text-[13px] text-ink" />
                  <span className="text-[12.5px] text-ink3">s.d.</span>
                  <input type="date" aria-label="Sampai tanggal" data-testid="export-to" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="min-h-[38px] rounded-btn border border-line bg-surface px-2 text-[13px] text-ink" />
                </div>
              )}
              {rangeInvalid && <p role="alert" className="m-0 pl-6 text-[12px] text-red" data-testid="export-range-error">Tanggal akhir tidak boleh sebelum tanggal awal.</p>}
            </fieldset>
            <fieldset className="min-w-0 space-y-2 border-0 p-0" disabled={visibleOnly}>
              <legend className="mb-1 text-[12.5px] font-semibold text-ink2">Meja</legend>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="export-meja" data-testid="export-meja-all" checked={mejaMode === "semua"} onChange={() => setMejaMode("semua")} /> Semua Meja</label>
              <label className="flex items-center gap-2 text-[13px] text-ink"><input type="radio" name="export-meja" data-testid="export-meja-some" checked={mejaMode === "tertentu"} onChange={() => setMejaMode("tertentu")} /> Meja tertentu</label>
              {mejaMode === "tertentu" && (
                <div className="flex flex-wrap gap-3 pl-6">
                  {stations.map((code) => <label key={code} className="flex items-center gap-1.5 text-[13px] text-ink"><input type="checkbox" data-testid={`export-meja-${code}`} checked={mejaSel.includes(code)} onChange={() => toggleMeja(code)} /> {mejaLabel(code)}</label>)}
                </div>
              )}
              {mejaMode === "semua" && !visibleOnly && (
                <label className="flex items-center gap-2 pl-6 text-[13px] text-ink"><input type="checkbox" data-testid="export-include-unscheduled" checked={includeUnscheduled} onChange={(e) => setIncludeUnscheduled(e.target.checked)} /> Sertakan unit “Belum Dijadwalkan” (di akhir daftar)</label>
              )}
            </fieldset>
            <label className="flex items-start gap-2 text-[13px] text-ink"><input type="checkbox" className="mt-1" data-testid="export-visible-only" checked={visibleOnly} onChange={(e) => setVisibleOnly(e.target.checked)} />
              <span>Hanya kartu yang sedang terlihat berdasarkan filter <span className="block text-[12px] text-ink3">{visibleRunIds.length} kartu di Meja/Belum Dijadwalkan + {visibleUnitIds.length} kartu ringkas. Tanggal dan Meja di atas diabaikan.</span></span></label>
            {adminOwner && (
              <label className="flex items-start gap-2 text-[13px] text-ink"><input type="checkbox" className="mt-1" data-testid="export-include-value" checked={includeValue} onChange={(e) => setIncludeValue(e.target.checked)} />
                <span>Sertakan nilai order <span className="block text-[12px] text-ink3">Menambah kolom Nilai Order (Rupiah). Jangan dibagikan ke grup umum.</span></span></label>
            )}
            {error && <p role="alert" data-testid="export-error" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
            {done && <p role="status" data-testid="export-done" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{done}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
