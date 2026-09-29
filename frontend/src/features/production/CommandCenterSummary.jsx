import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

// P9B — Ringkasan Produksi V2 (Command Center): KPI + Butuh Perhatian + aktivitas PIC/meja hari ini, SEMUA dari SATU
// payload (GET /production-v2/command-center) yang JUGA dipakai kolom pipeline Rencana Produksi (ProductionPlannerV2.jsx)
// — tidak ada penghitungan bayangan di sini, murni menampilkan apa yang server kirim. Inert (bukan error) saat
// readerMode OFF atau unit di luar cohort — konsisten dengan seluruh Production V2 lainnya.
// SENGAJA disisipkan ke halaman "Ringkasan" yang SUDAH ADA (bukan halaman/menu baru) — lihat ProductionRingkasan.jsx.

const KPI_TILES = [
  ["akanMasuk", "Akan Masuk"], ["dalamPerjalanan", "Dalam Perjalanan"], ["belumDijadwalkan", "Belum Dijadwalkan"],
  ["dijadwalkanHariIni", "Dijadwalkan Hari Ini"], ["sedangDikerjakan", "Sedang Dikerjakan"], ["menungguBahan", "Menunggu Bahan"],
  ["menungguQc", "Menunggu QC"], ["terlambat", "Terlambat"], ["siapKirim", "Siap Kirim"],
];
const ATTENTION_LABEL = { critical: "Kritis", warning: "Perhatian" };

function AttentionRow({ item }) {
  const tone = item.severity === "critical" ? "red" : "orange";
  return (
    <li className="flex items-start gap-2.5 px-4 py-3">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone === "red" ? "bg-red" : "bg-orange"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={tone}>{ATTENTION_LABEL[item.severity] || item.severity}</Badge>
          {item.orderNumber && <span className="text-[11px] text-ink3">{item.orderNumber}</span>}
        </div>
        <p className="mt-0.5 text-[12.5px] text-ink2">{item.text}</p>
      </div>
      {item.runId && <Button size="sm" variant="secondary" asChild><Link to={`/bengkel/production-v2?runId=${item.runId}`}>Buka</Link></Button>}
    </li>
  );
}

export default function CommandCenterSummary() {
  const [cc, setCc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true); setError("");
    return api.getProductionV2CommandCenter().then(setCc).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !cc) {
    return <Card className="flex items-center justify-center gap-2 p-8 text-ink2"><Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat Ringkasan Produksi V2…</span></Card>;
  }
  if (error && !cc) return <Card className="p-4 text-[12.5px] text-red">{error}</Card>;
  if (!cc || cc.readerMode === "OFF") return null; // inert: unit belum masuk cohort Production V2 — bagian ini diam-diam tidak tampil, bukan galat.

  const attention = cc.attention || [];
  const shown = attention.slice(0, 8);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-ink">Ringkasan Produksi V2</h2>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Muat Ulang</Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="p-3 text-center"><p className="text-[22px] font-bold leading-none text-ink">{cc.kpi.selesaiHariIni}<span className="text-[13px] text-ink3">/{cc.kpi.target}</span></p><p className="mt-1 text-[11px] text-ink3">Selesai Hari Ini / Target</p></Card>
        <Card className="p-3 text-center"><p className="text-[22px] font-bold leading-none text-ink">{cc.kpi.sisaPekerjaan}</p><p className="mt-1 text-[11px] text-ink3">Sisa Target Hari Ini</p></Card>
        {KPI_TILES.map(([k, label]) => (
          <Card key={k} className="p-3 text-center">
            <p className={`text-[22px] font-bold leading-none ${(k === "terlambat" || k === "menungguBahan") && cc.kpi[k] > 0 ? "text-red" : "text-ink"}`}>{cc.kpi[k] ?? 0}</p>
            <p className="mt-1 text-[11px] text-ink3">{label}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><AlertTriangle size={16} className="text-orange" aria-hidden /><h3 className="text-[13px] font-bold text-ink">Butuh Perhatian</h3></div>
        {attention.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-green"><ShieldCheck size={18} aria-hidden /> Tidak ada yang butuh perhatian saat ini — operasional produksi V2 berjalan normal.</div>
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-line p-0">{shown.map((item, i) => <AttentionRow key={`${item.code}-${item.runId || item.unitCode}-${i}`} item={item} />)}</ul>
            {attention.length > shown.length && <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink3">+{attention.length - shown.length} isu lainnya</p>}
          </>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Aktivitas PIC &amp; Meja Hari Ini</h3></div>
        {(!cc.picActivity || cc.picActivity.length === 0) ? (
          <p className="px-4 py-4 text-[12.5px] text-ink3">Belum ada PIC dengan unit aktif hari ini.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {cc.picActivity.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="font-semibold text-ink">{p.name}</span>
                <span className="text-ink3">{p.stationLabel || "—"}</span>
                <span className="tabular-nums text-ink2">{p.active} aktif · {p.completedToday} selesai hari ini</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
