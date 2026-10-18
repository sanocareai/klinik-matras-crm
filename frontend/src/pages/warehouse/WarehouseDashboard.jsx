import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import { api } from "@/api.js";

// BERANDA GUDANG — satu halaman "yang perlu dikerjakan hari ini" (Okt 2026). Semua angka dan contoh dihitung server dari dokumen nyata (GET /inventory/beranda);
// halaman ini tidak menghitung ulang dan tidak punya angka contoh. Setiap kartu membuka daftar yang relevan. Angka stok (saldo, habis, minimum) sengaja TIDAK di sini:
// itu ada di Stok & Lokasi dengan sumber dan batasnya, supaya Beranda tidak terkesan punya "dashboard" kedua.
const URUTAN_ALUR = ["AKAN_DATANG", "PERLU_DICATAT_TIBA", "BELUM_MASUK_STOK"];
const KETERANGAN_ALUR = { AKAN_DATANG: "1 · PO ditunggu", PERLU_DICATAT_TIBA: "2 · Jadwal jatuh tempo", BELUM_MASUK_STOK: "3 · Diperiksa & masuk stok" };

function KartuTugas({ t, definisi }) {
  return (
    <Card className="flex flex-col p-4" data-testid={`tugas-${t.kode}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {KETERANGAN_ALUR[t.kode] && <div className="text-[10.5px] font-bold uppercase tracking-wide text-ink3">{KETERANGAN_ALUR[t.kode]}</div>}
          <h2 className="m-0 text-[14px] font-semibold text-ink">{t.judul}</h2>
        </div>
        <span className={`text-[28px] font-bold leading-none tabular-nums ${t.ada ? "text-ink" : "text-ink3"}`} data-testid={`jumlah-${t.kode}`}>{t.jumlah}</span>
      </div>
      <p className="mb-0 mt-1.5 text-[12.5px] leading-snug text-ink2" title={definisi?.[t.kode]}>
        {!t.ada && <CheckCircle2 size={13} className="mr-1 inline text-green" aria-hidden />}{t.rincian}
      </p>
      {t.contoh?.length > 0 && (
        <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0">
          {t.contoh.map((c) => (
            <li key={c.id} className="rounded-btn bg-inset px-2.5 py-1.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="whitespace-nowrap font-semibold text-ink">{c.judul}</span>{c.status && <Badge variant="neutral" className="h-auto whitespace-normal text-left leading-tight">{c.status}</Badge>}</div>
              <div className="text-[11.5px] text-ink2">{c.sub}</div>
            </li>
          ))}
          {t.jumlah > t.contoh.length && <li className="px-1 text-[11.5px] text-ink3">+ {t.jumlah - t.contoh.length} lainnya di daftar</li>}
        </ul>
      )}
      <div className="mt-auto pt-3">
        <Link to={t.tautan} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent max-sm:min-h-11 max-sm:items-center" data-testid={`tautan-${t.kode}`}>{t.tautanLabel} <ArrowRight size={13} aria-hidden /></Link>
      </div>
    </Card>
  );
}

export default function WarehouseDashboard() {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getBerandaGudang().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const tugas = data?.tugas ?? [];
  const alur = URUTAN_ALUR.map((k) => tugas.find((t) => t.kode === k)).filter(Boolean);
  const lain = tugas.filter((t) => !URUTAN_ALUR.includes(t.kode));
  const adaKerja = tugas.some((t) => t.ada);

  return (
    <PageContainer>
      <PageHeader
        title="Beranda Gudang"
        subtitle="Yang perlu dikerjakan hari ini — dari dokumen nyata, bukan perkiraan."
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {loading && !data && <div className="text-[13px] text-ink3" aria-busy="true">Memuat tugas hari ini…</div>}
        {data && (
          <>
            {!adaKerja && <div className="flex items-center gap-2 rounded-btn bg-greenbg px-3 py-2.5 text-[13px] text-green" data-testid="tidak-ada-tugas"><CheckCircle2 size={15} aria-hidden /> Tidak ada pekerjaan yang menunggu saat ini.</div>}
            <section aria-label="Alur penerimaan barang" className="space-y-2">
              <div className="text-[12px] text-ink2"><span className="font-semibold text-ink">Penerimaan barang:</span> PO → jadwal kedatangan → barang tiba → pemeriksaan → masuk stok. Barang yang baru terjadwal belum tiba dan belum memengaruhi stok.</div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{alur.map((t) => <KartuTugas key={t.kode} t={t} definisi={data.definisi} />)}</div>
            </section>
            <section aria-label="Permintaan dan keputusan" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {lain.map((t) => <KartuTugas key={t.kode} t={t} definisi={data.definisi} />)}
            </section>
            <ActiveComplaintsWidget currentOwner="WAREHOUSE" title="Kasus Komplain Butuh Material" />
            <p className="m-0 text-[11.5px] text-ink3" data-testid="catatan-beranda">
              Dihitung {new Date(data.dihitungPada).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}. Angka stok per bahan, bahan yang belum punya catatan, dan batas minimum ada di <Link to="/warehouse/inventory" className="font-semibold text-accent">Stok &amp; Lokasi</Link>.
            </p>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
