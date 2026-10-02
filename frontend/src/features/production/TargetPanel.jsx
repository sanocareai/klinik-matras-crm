import React, { useCallback, useEffect, useState } from "react";
import { Target } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { targetFormError } from "./reporting.js";

// P11.1 — target harian Produksi V2 yang tersimpan historis. Semua pengguna laporan penuh melihat riwayat; hanya Admin/Owner (server menegakkan
// izin production_target:write) yang melihat formulir. Target berlaku mulai tanggal yang dipilih; baris tidak pernah diubah/dihapus (koreksi = baris baru).
export default function TargetPanel({ canWrite, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ effectiveFrom: "", targetUnits: "", reason: "" });

  const load = useCallback(() => api.getProductionTargets().then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data && !form.effectiveFrom) setForm((f) => ({ ...f, effectiveFrom: data.today })); }, [data, form.effectiveFrom]);

  const submit = async (e) => {
    e.preventDefault();
    const problem = targetFormError(form, data);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      await api.setProductionTarget({ effectiveFrom: form.effectiveFrom, targetUnits: Number(form.targetUnits), reason: form.reason.trim() });
      setForm((f) => ({ ...f, targetUnits: "", reason: "" }));
      await load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (!data) return error ? <div className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{error}</div> : null;
  const table = {
    key: "targets", title: "Riwayat target harian",
    columns: ["Berlaku mulai", "Target/hari", "Alasan", "Diatur oleh", "Dicatat"], rows: data.rows,
  };
  return (
    <Card className="min-w-0 space-y-3 p-3" data-testid="target-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Target size={16} className="text-accent" aria-hidden />
        <h3 className="m-0 text-[13.5px] font-bold text-ink">Target harian</h3>
        <span className="text-[12px] text-ink3" data-testid="target-current">
          Hari ini <b className="text-ink">{data.currentTarget}</b> unit/hari ({data.currentSource === "tercatat" ? "target tercatat" : `konfigurasi sistem — belum ada target tercatat`})
        </span>
      </div>
      <p className="m-0 text-[11.5px] text-ink3">Target berlaku mulai tanggal yang dipilih dan dipakai laporan untuk hari-hari itu. Riwayat tidak dapat diubah atau dihapus; koreksi = entri baru dengan alasan. Hari tanpa target tercatat memakai konfigurasi sistem ({data.fallback}/hari).</p>
      {canWrite && (
        <form onSubmit={submit} className="grid grid-cols-2 gap-2 md:grid-cols-[10rem_8rem_minmax(0,1fr)_auto] md:items-end" data-testid="target-form">
          <label className="min-w-0 text-[11px] font-medium text-ink3">Berlaku mulai
            <input type="date" className="mt-0.5 h-9 w-full rounded-btn border border-line bg-transparent px-2.5 text-[13px] text-ink" min={data.minEffectiveDate} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} required data-testid="target-date" />
          </label>
          <label className="min-w-0 text-[11px] font-medium text-ink3">Target (unit/hari)
            <input type="number" inputMode="numeric" min={1} max={data.maxTargetUnits} className="mt-0.5 h-9 w-full rounded-btn border border-line bg-transparent px-2.5 text-[13px] text-ink" value={form.targetUnits} onChange={(e) => setForm({ ...form, targetUnits: e.target.value })} required data-testid="target-units" />
          </label>
          <label className="col-span-2 min-w-0 text-[11px] font-medium text-ink3 md:col-span-1">Alasan (wajib)
            <input type="text" maxLength={300} className="mt-0.5 h-9 w-full rounded-btn border border-line bg-transparent px-2.5 text-[13px] text-ink" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="mis. tambah satu shift Corner" required data-testid="target-reason" />
          </label>
          <Button type="submit" size="sm" className="col-span-2 min-h-[36px] md:col-span-1" disabled={busy} data-testid="target-submit" data-mutates>{busy ? "Menyimpan…" : "Simpan target"}</Button>
        </form>
      )}
      {error && <div className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert" data-testid="target-error">{error}</div>}
      {data.rows.length === 0 ? (
        <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink3">Belum ada target tercatat — laporan memakai konfigurasi sistem.</p>
      ) : (
        <TableWrap>
          <Table>
            <THead><TR>{table.columns.map((c) => <TH key={c}>{c}</TH>)}</TR></THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.id}>
                  <TD>{r.effectiveFrom}</TD><TD numeric>{r.targetUnits}</TD><TD>{r.reason}</TD><TD>{r.actorName || "—"}</TD>
                  <TD>{new Date(new Date(r.createdAt).getTime() + 7 * 3600_000).toISOString().replace("T", " ").slice(0, 16)} WIB</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
