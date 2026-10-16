import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { api } from "@/api.js";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { KOLOM_TARGET, bodyTarget } from "../iklanCampaignLogic.js";

// Panel ADMIN: impor spend harian (CSV Ads Manager, dry-run dulu), target KPI, monitoring. Sistem TIDAK mengubah campaign/ad set/ads/budget Meta.

const rp = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
const WARNA = { OK: "text-green", WARN: "text-orange", CRIT: "text-red" };

export function ImporSpend({ onSelesai }) {
  const [berkas, setBerkas] = useState(null);
  const [akun, setAkun] = useState("");
  const [total, setTotal] = useState("");
  const [hasil, setHasil] = useState(null);
  const [galat, setGalat] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const kirim = async (komit) => {
    setSibuk(true); setGalat(null);
    try {
      const csv = await berkas.text();
      const r = await api.importAtribusiSpend({ csv, accountId: akun.trim(), namaBerkas: berkas.name, totalSumber: total.trim() || undefined, dryRun: !komit, ...(komit ? { zonaWaktuAkun: "Asia/Jakarta" } : {}) });
      setHasil(r);
      if (komit) onSelesai?.();
    } catch (e) { setHasil(null); setGalat(e?.message || "Gagal memproses"); }
    finally { setSibuk(false); }
  };
  const bisa = berkas && /^\d{5,32}$/.test(akun.trim().replace(/^act_/i, "")) && !sibuk;
  return (
    <Card><CardContent className="flex flex-col gap-3 text-[12.5px]">
      <p className="font-semibold text-ink">Impor spend harian (CSV Ads Manager)</p>
      <p className="t-secondary">Ekspor level <b>Ad</b>, rincian harian, kolom: Day, Account ID, Campaign/Ad set/Ad ID, Amount spent (IDR). Pratinjau dulu (tidak menulis); commit hanya bila akun iklan berzona WIB. Isi "total sumber" dari Ads Manager agar total diverifikasi.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">CSV<input type="file" accept=".csv,text/csv" onChange={(e) => { setBerkas(e.target.files?.[0] || null); setHasil(null); }} /></label>
        <label className="flex flex-col gap-1">Account ID<input className="input" value={akun} onChange={(e) => setAkun(e.target.value)} placeholder="angka, tanpa act_" /></label>
        <label className="flex flex-col gap-1">Total sumber (Rp, opsional)<input className="input" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="1234567.50" /></label>
        <button className="btn btn-ghost btn-sm" disabled={!bisa} onClick={() => kirim(false)}>{sibuk ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Pratinjau</button>
        <button className="btn btn-sm" disabled={!bisa || !hasil || !hasil.dryRun || hasil.ringkasan.ditolak + hasil.ringkasan.konflik > 0 || hasil.rekonsiliasi?.cocok === false} onClick={() => kirim(true)}>Commit (akun berzona WIB)</button>
      </div>
      {galat && <p className="text-red">{galat}</p>}
      {hasil && (
        <div className="rounded-btn bg-inset p-3">
          <p><b>{hasil.dryRun ? "Pratinjau (belum tersimpan)" : "Tersimpan"}</b> — baru {hasil.ringkasan.baru}, berubah {hasil.ringkasan.berubah}, tidak berubah {hasil.ringkasan.tidakBerubah}, ditolak {hasil.ringkasan.ditolak}, konflik {hasil.ringkasan.konflik}, Ad ID tanpa mapping {hasil.ringkasan.adIdTidakTerpetakan}</p>
          <p>Total impor {rp(hasil.rekonsiliasi.totalImpor)}{hasil.rekonsiliasi.totalSumber != null && <> · sumber {rp(hasil.rekonsiliasi.totalSumber)} · selisih <b className={hasil.rekonsiliasi.cocok ? "text-green" : "text-red"}>{rp(hasil.rekonsiliasi.selisih)}</b></>}</p>
          {(hasil.ditolak?.length > 0 || hasil.konflik?.length > 0) && (
            <ul className="mt-1 list-disc pl-5">{[...hasil.ditolak, ...hasil.konflik].slice(0, 8).map((x, i) => <li key={i}>baris {x.baris ?? "?"} · {x.alasan}</li>)}</ul>
          )}
        </div>
      )}
    </CardContent></Card>
  );
}

export function PanelTarget({ onSimpan }) {
  const [nilai, setNilai] = useState(null);
  const [pesan, setPesan] = useState(null);
  useEffect(() => { api.getAtribusiTarget().then((r) => setNilai(Object.fromEntries(KOLOM_TARGET.map(({ k }) => [k, r.target[k] ?? ""])))).catch(() => setPesan("Gagal memuat target")); }, []);
  const simpan = async () => {
    const { body, galat } = bodyTarget(nilai);
    if (galat) { setPesan(galat); return; }
    try { await api.putAtribusiTarget(body); setPesan("Target tersimpan. Hanya memengaruhi label evaluasi; iklan dan budget tidak diubah."); onSimpan?.(); } catch (e) { setPesan(e?.message || "Gagal menyimpan"); }
  };
  if (!nilai) return <Card><CardContent className="text-[12.5px] text-ink3">{pesan || "Memuat target…"}</CardContent></Card>;
  return (
    <Card><CardContent className="flex flex-col gap-3 text-[12.5px]">
      <p className="font-semibold text-ink">Target KPI (diisi Owner)</p>
      <p className="t-secondary">Kosong = tidak ada target (tidak ada evaluasi/warna). Sistem hanya memberi label DATA_KURANG / PANTAU / BAIK / PERLU_REVIEW — tidak pernah mematikan iklan atau mengubah budget.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {KOLOM_TARGET.map(({ k, label }) => (
          <label key={k} className="flex flex-col gap-1">{label}<input className="input" value={nilai[k]} onChange={(e) => setNilai((v) => ({ ...v, [k]: e.target.value }))} /></label>
        ))}
      </div>
      <div className="flex items-center gap-3"><button className="btn btn-sm" onClick={simpan}>Simpan target</button>{pesan && <span className="t-secondary">{pesan}</span>}</div>
    </CardContent></Card>
  );
}

export function PanelMonitor() {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState(null);
  const muat = useCallback(() => { setGalat(null); api.getAtribusiMonitor().then(setD).catch((e) => setGalat(e?.message || "Gagal memuat monitoring")); }, []);
  useEffect(() => { muat(); }, [muat]);
  if (galat) return <Card><CardContent className="text-[12.5px] text-red">{galat}</CardContent></Card>;
  if (!d) return <Card><CardContent className="text-[12.5px] text-ink3">Memuat monitoring…</CardContent></Card>;
  const s = d.snapshot;
  return (
    <Card><CardContent className="flex flex-col gap-3 text-[12.5px]">
      <div className="flex items-center justify-between"><p className="font-semibold text-ink">Monitoring atribusi: <span className={cn(d.kodeKeluar === 0 ? "text-green" : d.kodeKeluar === 1 ? "text-orange" : "text-red")}>{d.status}</span></p><button className="btn btn-ghost btn-sm" onClick={muat}>Refresh</button></div>
      <p className="t-secondary">Inbound 15 menit: {s.inbound.per15Menit} · 1 jam: {s.inbound.perJam} · terakhir {s.inbound.menitSejakTerakhir ?? "—"} menit lalu · touch 24 jam: {s.touch.jam24} · UNMAPPED {s.touch.unmapped} · UNKNOWN 7 hari {s.touch.unknown7Hari ?? 0} · referensi {s.referensi.jumlah}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {d.alarm.map((a) => <li key={a.key}><b className={WARNA[a.level]}>{a.level}</b> {a.key.replace(/_/g, " ")} — <span className="t-secondary">{a.pesan}</span></li>)}
      </ul>
    </CardContent></Card>
  );
}
