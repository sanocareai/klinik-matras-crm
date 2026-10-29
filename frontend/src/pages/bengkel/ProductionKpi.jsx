import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/api.js";
import { PageBody, PageContainer, PageHeader } from "@/components/ui/page.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import LaporanProduksi from "@/features/production/laporan/LaporanProduksi.jsx";
import { normalisasiTab } from "@/features/production/laporan/laporanModel.js";
import { reportQuery, emptyFilters } from "@/features/production/reporting.js";
import { makeRange, toApiParams } from "@/lib/dateRange.js";

// KPI & Laporan → LAPORAN PRODUKSI TERPADU (empat tab: Ringkasan · Biaya per Order · Kinerja Produksi · Bahan & Gudang), lihat features/production/laporan/.
// Halaman ini tinggal pemilih izin: pemegang laporan penuh/Gudang → Laporan Produksi; pemegang izin "ringkasan sendiri" saja (PIC/dokumentasi/QC, rute /produksi/ringkasan-saya) → ringkasan pekerjaan sendiri.
// Rute lama (/bengkel/kpi, /warehouse/kpi) dan kunci tab lama (?tab=meja|pic|gudang|laporan) tetap bekerja (dipetakan ke tab baru).
export default function ProductionKpi({ defaultTab = "ringkasan" }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.getLaporanMeta().then(setMeta).catch((e) => setErr(e.message)); }, []);
  if (err) return <PageContainer fluid><PageBody><div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" role="alert">{err}</div></PageBody></PageContainer>;
  if (!meta) return <PageContainer fluid><PageBody><p className="m-0 text-[12.5px] text-ink3">Memuat laporan…</p></PageBody></PageContainer>;
  const cap = meta.capabilities;
  if (cap.ringkasan || cap.bahanGudang || cap.biayaOrder) return <LaporanProduksi defaultTab={normalisasiTab(defaultTab)} metaAwal={meta} />;
  if (cap.self) return <RingkasanSaya />;
  return <PageContainer fluid><PageBody><p className="m-0 text-[13px] text-ink3">Anda tidak punya akses ke laporan produksi.</p></PageBody></PageContainer>;
}

// Ringkasan pekerjaan SENDIRI (PIC/dokumentasi/QC): hanya pekerjaan pengguna, tanpa harga/pembayaran. Periode memakai DateRangePicker standar app.
function RingkasanSaya() {
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const period = useMemo(() => toApiParams(range), [range]);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let hidup = true; setError("");
    api.getProductionReport("my-summary", reportQuery(period, emptyFilters())).then((d) => hidup && setDoc(d)).catch((e) => hidup && setError(e.message));
    return () => { hidup = false; };
  }, [period]);
  return (
    <PageContainer fluid>
      <PageHeader title="Ringkasan Saya" subtitle="Pekerjaan Anda sendiri pada periode ini." />
      <PageBody>
        <div className="min-w-0" data-testid="period-picker"><DateRangePicker value={range} onChange={setRange} showCompare={false} allowAll={false} /></div>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" role="alert">{error}</div>}
        {doc?.pekerjaan && <MyPanel doc={doc} />}
      </PageBody>
    </PageContainer>
  );
}

function MyPanel({ doc }) {
  const p = doc.pekerjaan;
  const cards = [["Ditugaskan", p.ditugaskan], ["Selesai", p.selesai], ["Berjalan", p.berjalan], ["Terlambat", p.terlambat], ["Pengiriman dokumentasi", doc.dokumentasi.pengirimanDokumentasi], ["Unit didokumentasi", doc.dokumentasi.unitDidokumentasi], ["Inspeksi QC", doc.qc.inspeksiDilakukan]];
  return (
    <div className="space-y-4" data-testid="panel-saya">
      <p className="m-0 text-[12px] text-ink3">{doc.scope} · periode {doc.period.from} s/d {doc.period.to} ({doc.timezone}). Hanya pekerjaan Anda sendiri; tanpa harga/pembayaran.</p>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-card bg-surface p-3"><p className="m-0 text-[11.5px] text-ink3">{label}</p><p className="m-0 mt-1 text-[22px] font-bold tabular-nums text-ink">{value}</p></div>)}
      </div>
      {doc.unit?.length > 0 && (
        <div className="rounded-card bg-surface p-3"><h3 className="m-0 mb-2 text-[13.5px] font-bold text-ink">Unit berjalan</h3>
          <ul className="m-0 list-none divide-y divide-line p-0">{doc.unit.map((u) => <li key={u.runId} className="flex items-center justify-between gap-2 py-2 text-[13px]"><b>{u.unitCode}</b><span className="text-ink3">{u.status}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
