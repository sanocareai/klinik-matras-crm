import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveAs } from "file-saver";
import { Loader2, FileSpreadsheet, ChevronRight, AlertTriangle, Info, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { formatRupiahShort } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { HalamanFinance, KartuAngka, formatUang, PeriodePicker, periodeDefault, JudulKartu } from "@/features/finance/shared.jsx";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";

// LAPORAN DIVISI (Fase 2). SEMUA angka, status, alert, proyeksi, kelompok, dan baris dokumen datang dari server (/api/laporan-divisi) — komponen ini TIDAK menghitung apa pun.
// Satu komponen untuk Finance (semua divisi) dan workspace divisi (scopeTetap = hanya divisinya). Scope & izin ditegakkan di server; tampilan hanya mengikuti respons.
// Export Excel = tab yang sedang dibuka (+ divisi + filter aktif), dibangun server dari payload yang sama.

const SUBTAB = [
  { key: "ringkasan", label: "Ringkasan" }, { key: "kategori", label: "Kategori" }, { key: "tren", label: "Tren Bulanan" },
  { key: "dokumen", label: "Transaksi" }, { key: "komitmen", label: "Komitmen" }, { key: "anggaran", label: "Anggaran" },
];
const STATUS_DOK = [["", "Semua status"], ["DISETUJUI", "Disetujui"], ["DIBAYAR", "Dibayar"], ["MENUNGGU_APPROVAL", "Menunggu persetujuan"]];
const LABEL_TAHAP = { EKSPLISIT: "Divisi tertulis di dokumen", RELASI: "Relasi dokumen sumber", KATEGORI: "Pemetaan kategori", SHARED: "Biaya bersama", TIDAK_TERKLASIFIKASI: "Tidak terklasifikasi", BUKAN_BIAYA: "Bukan biaya divisi" };
const RUTE_DOKUMEN = { pengeluaran: "/finance/expenses", pembelian: "/finance/purchases", "supplier-utang": "/finance/suppliers", "uang-muka": "/finance/uang-muka" };
const NAMA_MODUL = { pengeluaran: "Pengeluaran", pembelian: "Pembelian", "supplier-utang": "Supplier & Utang", "uang-muka": "Uang Muka", "armada-biaya": "Biaya Kendaraan", "ad-spend": "Belanja Iklan", "material-issue": "Material Issue", "stock-movement": "Pergerakan Stok", "stock-count": "Stock Opname", "goods-receipt": "Penerimaan Barang" };
const bulanLabel = (b) => { try { return new Date(`${b}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" }); } catch { return b; } };
const bulanIni = () => periodeDefault().from.slice(0, 7);
const rpBertanda = (n) => (n < 0 ? `−${formatUang(Math.abs(n))}` : formatUang(n));

// Panel: permukaan "glass" Finance (sama dengan FilterBar) tanpa padding ganda Card p-6 + CardContent.
function Panel({ className, children, ...p }) {
  return <div className={cn("fin-glass px-4 py-3", className)} {...p}>{children}</div>;
}
// Pemberitahuan merah (over-budget / galat). Warna dari token (--red-bg), bukan utilitas bg-* yang kadang tidak ter-generate.
function Pemberitahuan({ className, children }) {
  return <div role="alert" className={cn("rounded-card px-4 py-3", className)} style={{ background: "var(--red-bg)" }}>{children}</div>;
}

function Chip({ aktif, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={aktif}
      className={cn("shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors max-sm:min-h-11", aktif ? "bg-accent text-white" : "bg-inset text-ink2 hover:bg-hovertint")}>
      {children}
    </button>
  );
}

function BarisRincian({ judul, sub, aktual, kas, onClick, kanan }) {
  const klik = typeof onClick === "function";
  return (
    <button type="button" disabled={!klik} onClick={onClick} className={cn("flex w-full items-start gap-2 border-b border-line/60 px-3 py-2.5 text-left last:border-0 max-sm:min-h-11", klik ? "cursor-pointer hover:bg-hovertint" : "cursor-default")}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-snug text-ink">{judul}</span>
        {sub && <span className="mt-0.5 block text-[12px] leading-snug text-ink3">{sub}</span>}
      </span>
      <span className="shrink-0 text-right text-[12.5px] tabular-nums text-ink2">
        <span className="block font-semibold text-ink">{formatUang(aktual)}</span>
        {kas != null && <span className="block text-ink3">Kas {formatUang(kas)}</span>}
        {kanan}
      </span>
      <span className="w-4 shrink-0 pt-0.5 text-ink3">{klik ? <ChevronRight size={14} aria-hidden /> : null}</span>
    </button>
  );
}

function KartuDivisi({ d, onBuka }) {
  const progres = d.anggaran ? Math.min(Math.max((d.aktual / d.anggaran) * 100, 0), 100) : 0;
  return (
    <button type="button" onClick={() => onBuka(d.scope)} data-testid={`kartu-divisi-${d.scope}`} className="rounded-card bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-popover max-sm:min-h-11">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-bold text-ink">{d.label}</p>
        {d.alert && <Badge variant="red">Melebihi anggaran</Badge>}
      </div>
      <p className="mt-2 text-[12px] text-ink3">Aktual (Beban Diakui)</p>
      <p className="text-[20px] font-bold tabular-nums text-ink">{formatUang(d.aktual)}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-ink2">
        <span>Kas keluar<b className="block tabular-nums text-ink">{formatUang(d.kasKeluar)}</b></span>
        <span>Komitmen<b className="block tabular-nums text-ink">{formatUang(d.komitmen.belumDibukukan + d.komitmen.dibukukanBelumDibayar)}</b></span>
      </div>
      {d.anggaran == null ? (
        <p className="mt-2 text-[12px] text-ink3">Belum ada anggaran</p>
      ) : (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset"><div className={cn("h-full rounded-full", d.alert ? "bg-red" : "bg-accent")} style={{ width: `${progres}%` }} /></div>
          <p className={cn("mt-1 text-[12px]", d.alert ? "font-semibold text-red" : "text-ink3")}>{formatUang(d.aktual)} dari {formatUang(d.anggaran)} ({d.persenTerpakai}%)</p>
        </div>
      )}
    </button>
  );
}

export default function LaporanDivisi({ scopeTetap = null, judul = "Laporan Biaya Divisi" }) {
  const navigate = useNavigate();
  const [akses, setAkses] = useState(null);
  const [aksesGalat, setAksesGalat] = useState(null);
  const [periode, setPeriode] = useState(periodeDefault);
  const [pilihan, setPilihan] = useState(scopeTetap || "SEMUA");
  const [sub, setSub] = useState("ringkasan");
  const [kategori, setKategori] = useState("");
  const [status, setStatus] = useState("");
  const [proyek, setProyek] = useState("");
  const [lap, setLap] = useState(null);
  const [dok, setDok] = useState(null);
  const [kelompokDoc, setKelompokDoc] = useState(null);
  const [anggaran, setAnggaran] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sibukExport, setSibukExport] = useState(false);
  const [pesan, setPesan] = useState(null);

  useEffect(() => {
    let batal = false;
    api.getLaporanDivisiAkses().then((a) => { if (!batal) setAkses(a); }).catch((e) => { if (!batal) setAksesGalat(e.message || "Gagal memuat akses"); });
    return () => { batal = true; };
  }, []);

  const scopesDiizinkan = useMemo(() => (akses?.divisi || []).map((d) => d.scope), [akses]);
  const finance = akses?.level === "SEMUA";
  const scopeAktif = pilihan === "SEMUA" ? null : pilihan;
  const param = useMemo(() => ({ from: periode.from, to: periode.to, ...(scopeAktif ? { divisi: scopeAktif } : (scopeTetap ? { divisi: scopeTetap } : {})), kategori, status, proyek }), [periode, scopeAktif, scopeTetap, kategori, status, proyek]);

  const muat = useCallback(async () => {
    if (!akses?.sakelar?.aktif || scopesDiizinkan.length === 0) return;
    setLoading(true); setError(null);
    try {
      const l = await api.getLaporanDivisi(param);
      setLap(l);
      const divTunggal = scopeAktif || scopeTetap;
      if (divTunggal && sub === "dokumen") setDok(await api.getLaporanDivisiDokumen({ ...param, divisi: divTunggal, ...(kelompokDoc ? { kelompok: kelompokDoc.kode } : {}) }));
      else if (divTunggal && sub === "komitmen") setDok(await api.getLaporanDivisiDokumen({ ...param, divisi: divTunggal }));
      else setDok(null);
      if (sub === "anggaran") setAnggaran((await api.getLaporanDivisiAnggaran({ from: periode.from, to: periode.to, ...(divTunggal ? { divisi: divTunggal } : {}) })).anggaran);
    } catch (e) {
      setError(e.message || "Gagal memuat laporan");
    } finally { setLoading(false); }
  }, [akses, scopesDiizinkan.length, param, scopeAktif, scopeTetap, sub, kelompokDoc, periode.from, periode.to]);
  useEffect(() => { muat(); }, [muat]);

  const divTunggal = scopeAktif || scopeTetap;
  const dataDiv = lap && divTunggal ? lap.divisi.find((d) => d.scope === divTunggal) : null;

  async function exportExcel() {
    setSibukExport(true); setPesan(null);
    try {
      const { blob, namaFile } = await api.exportLaporanDivisi({ from: periode.from, to: periode.to, divisi: divTunggal ? [divTunggal] : scopesDiizinkan, tab: sub, filter: { kategori, status, proyek } });
      saveAs(blob, namaFile);
    } catch (e) { setPesan(e.message); } finally { setSibukExport(false); }
  }

  // ── keadaan akses ──
  if (aksesGalat) return <HalamanFinance title={judul} loading={false} error={aksesGalat} onRetry={() => window.location.reload()} />;
  if (!akses) return <HalamanFinance title={judul} subtitle="Memeriksa akses…" loading error={null} />;
  if (!akses.sakelar.aktif) {
    return (
      <HalamanFinance title={judul} subtitle="Biaya per divisi: aktual, kas keluar, komitmen, dan anggaran.">
        <Card><CardContent className="py-10"><EmptyState icon={Lock} title="Laporan Divisi belum diaktifkan" description="Fitur ini dibuka bertahap oleh Admin Finance. Hubungi Admin Finance bila Anda membutuhkannya." /></CardContent></Card>
      </HalamanFinance>
    );
  }
  if (scopesDiizinkan.length === 0 || (scopeTetap && !scopesDiizinkan.includes(scopeTetap))) {
    return (
      <HalamanFinance title={judul}>
        <Card><CardContent className="py-10"><EmptyState icon={Lock} title="Anda belum memiliki akses laporan ini" description="Laporan biaya divisi hanya untuk Finance, leader divisi, dan anggota divisi yang sudah dibuka workspace-nya." /></CardContent></Card>
      </HalamanFinance>
    );
  }

  const tampilKartu = dataDiv ? [
    { metrik: "anggaran_divisi", label: "Anggaran", value: dataDiv.anggaran == null ? "Belum ada anggaran" : formatUang(dataDiv.anggaran), sub: dataDiv.anggaran == null ? "Belum ada versi disetujui" : "Versi disetujui" },
    { metrik: "beban_diakui", label: "Aktual (Beban Diakui)", value: formatUang(dataDiv.aktual), sub: `${dataDiv.nDokumen} dokumen` },
    { metrik: "uang_keluar_kas", label: "Kas Keluar", value: formatUang(dataDiv.kasKeluar), sub: "Uang yang benar-benar keluar" },
    { metrik: "komitmen_belum_dibayar", label: "Komitmen", value: formatUang(dataDiv.komitmen.belumDibukukan + dataDiv.komitmen.dibukukanBelumDibayar), sub: `${formatUang(dataDiv.komitmen.belumDibukukan)} menunggu persetujuan · ${formatUang(dataDiv.komitmen.dibukukanBelumDibayar)} belum dibayar` },
    { metrik: "sisa_anggaran_divisi", label: "Sisa Anggaran", value: dataDiv.sisaAnggaran == null ? "Belum ada anggaran" : rpBertanda(dataDiv.sisaAnggaran), tone: dataDiv.alert ? "red" : "default", sub: dataDiv.persenTerpakai != null ? `${dataDiv.persenTerpakai}% terpakai` : undefined },
    { label: "Proyeksi Akhir Bulan", value: dataDiv.proyeksi.nilai == null ? "—" : formatUang(dataDiv.proyeksi.nilai), sub: dataDiv.proyeksi.nilai == null ? dataDiv.proyeksi.alasan : `Rata-rata harian × ${dataDiv.proyeksi.hariBulan} hari`, info: "Perkiraan Aktual sampai akhir bulan berdasarkan rata-rata harian bulan berjalan. Hanya untuk satu bulan kalender penuh yang sedang berjalan; bukan angka final." },
  ] : [];

  return (
    <HalamanFinance
      title={scopeTetap ? `${judul} — ${akses.divisi.find((d) => d.scope === scopeTetap)?.label ?? ""}` : judul}
      subtitle="Aktual (beban diakui), kas keluar, komitmen belum dibayar, dan anggaran per divisi — angka dari server dengan definisi yang sama di semua laporan."
      loading={false} error={error} onRetry={muat}
      actions={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodePicker from={periode.from} to={periode.to} onChange={(p) => { setPeriode(p); }} />
          <Button size="sm" variant="outline" onClick={exportExcel} disabled={sibukExport || loading}>
            {sibukExport ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel
          </Button>
        </div>
      )}
    >
      {pesan && <Pemberitahuan className="text-[13px] text-ink">{pesan}</Pemberitahuan>}

      {/* pilih divisi (Finance / pengguna multi-divisi) */}
      {!scopeTetap && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Divisi">
          {finance && <Chip aktif={pilihan === "SEMUA"} onClick={() => { setPilihan("SEMUA"); setKelompokDoc(null); }}>Semua divisi</Chip>}
          {akses.divisi.filter((d) => finance || d.scope !== "SEMUA").map((d) => <Chip key={d.scope} aktif={pilihan === d.scope} onClick={() => { setPilihan(d.scope); setKelompokDoc(null); }}>{d.label}</Chip>)}
        </div>
      )}

      {/* sub-tab = tab export */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Bagian laporan">
        {SUBTAB.map((t) => <Chip key={t.key} aktif={sub === t.key} onClick={() => setSub(t.key)}>{t.label}</Chip>)}
      </div>

      {/* filter */}
      <Panel className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(finance || akses.level === "LEADER") && (
            <label className="text-[12px] text-ink3">Kategori
              <select value={kategori} onChange={(e) => setKategori(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-surface px-2 text-[13px] text-ink">
                <option value="">Semua kategori</option>
                {akses.kategori.filter((k) => !divTunggal || true).map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
              </select>
            </label>
          )}
          <label className="text-[12px] text-ink3">Status dokumen
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-surface px-2 text-[13px] text-ink">
              {STATUS_DOK.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-ink3">Proyek / campaign
            <Input value={proyek} onChange={(e) => setProyek(e.target.value)} placeholder="mis. META_ADS" className="mt-1 h-10" />
          </label>
      </Panel>

      {loading && !lap && <div className="flex items-center gap-2 py-8 text-[13px] text-ink2"><Loader2 size={14} className="animate-spin" /> Memuat laporan…</div>}

      {lap && (
        <>
          {lap.ringkasan.alert.length > 0 && (
            <Pemberitahuan className="space-y-1">
              {lap.ringkasan.alert.map((a) => <p key={a.scope} className="flex items-start gap-2 text-[13px] text-ink"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-red" /><span><b>{a.label}:</b> {a.pesan}</span></p>)}
            </Pemberitahuan>
          )}

          {/* ═══ RINGKASAN ═══ */}
          {sub === "ringkasan" && !divTunggal && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KartuAngka label="Aktual (Beban Diakui)" metrik="beban_diakui" value={formatUang(lap.ringkasan.aktual)} sub={`${lap.divisi.length} kelompok`} />
                <KartuAngka label="Kas Keluar" metrik="uang_keluar_kas" value={formatUang(lap.ringkasan.kasKeluar)} sub="Uang yang benar-benar keluar" />
                <KartuAngka label="Komitmen" metrik="komitmen_belum_dibayar" value={formatUang(lap.ringkasan.komitmenBelumDibukukan + lap.ringkasan.komitmenDibukukanBelumDibayar)} sub="Belum beban / belum kas keluar" />
                <KartuAngka label="Anggaran" metrik="anggaran_divisi" value={lap.ringkasan.anggaran == null ? "Belum ada anggaran" : formatUang(lap.ringkasan.anggaran)} sub={lap.ringkasan.divisiTanpaAnggaran > 0 ? `${lap.ringkasan.divisiTanpaAnggaran} divisi belum beranggaran` : undefined} />
              </div>
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink3">Perbandingan antar-divisi · sentuh untuk membuka</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {lap.divisi.filter((d) => d.scope !== "SHARED" && d.scope !== "TIDAK_TERKLASIFIKASI").map((d) => <KartuDivisi key={d.scope} d={d} onBuka={(s) => { setPilihan(s); }} />)}
                </div>
              </div>
              {finance && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {["SHARED", "TIDAK_TERKLASIFIKASI"].map((s) => { const d = lap.divisi.find((x) => x.scope === s); return d ? (
                    <Panel key={s} data-testid={`kartu-${s}`} className="space-y-1 py-4">
                      <p className="text-[14px] font-bold text-ink">{d.label}</p>
                      <p className="text-[12px] leading-snug text-ink2">{s === "SHARED" ? "Biaya kantor/administrasi umum yang tidak milik satu divisi. Tetap bersama sampai ada alokasi resmi." : "Biaya yang divisinya TIDAK terbukti dari dokumen sumber. Tidak pernah ditebak dari pembuat transaksi."}</p>
                      <p className="text-[20px] font-bold tabular-nums text-ink">{formatUang(d.aktual)}</p>
                      <p className="text-[12px] text-ink3">Kas keluar {formatUang(d.kasKeluar)} · {d.nDokumen} dokumen</p>
                      <Button size="sm" variant="neutral" onClick={() => { setPilihan(s); setSub("dokumen"); }}>Lihat dokumen</Button>
                    </Panel>
                  ) : null; })}
                </div>
              )}
              {lap.jembatan && (
                <Panel className="space-y-1  text-[12.5px] text-ink2">
                  <p className="font-semibold text-ink">Jembatan ke buku besar (hanya Finance)</p>
                  <p>Aktual semua kelompok {formatUang(lap.jembatan.aktual.totalKelompok)} + di luar divisi {formatUang(lap.jembatan.aktual.diLuarDivisi)} = Beban Diakui ledger {formatUang(lap.jembatan.aktual.ledger)} · selisih {rpBertanda(lap.jembatan.aktual.residual)}</p>
                  <p>Kas keluar kelompok {formatUang(lap.jembatan.kasKeluar.totalKelompok)} + di luar divisi {formatUang(lap.jembatan.kasKeluar.diLuarDivisi)} = Arus Kas {formatUang(lap.jembatan.kasKeluar.arusKas)} · selisih {rpBertanda(lap.jembatan.kasKeluar.residual)}</p>
                  <Badge variant={lap.jembatan.status.perhitungan === "COCOK" ? "green" : "red"}>{lap.jembatan.status.perhitungan === "COCOK" ? "Perhitungan cocok" : "Perhitungan tidak cocok"}</Badge>
                </Panel>
              )}
            </>
          )}

          {sub === "ringkasan" && dataDiv && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="kartu-utama">
                {tampilKartu.map((k) => <KartuAngka key={k.label} {...k} />)}
              </div>
              {dataDiv.persediaan && (
                <Panel className="space-y-1  text-[12.5px] text-ink2">
                  <p className="font-semibold text-ink">Persediaan Gudang (bukan beban)</p>
                  <p>Nilai penerimaan {formatUang(dataDiv.persediaan.nilaiPenerimaan)} · nilai pemakaian {formatUang(dataDiv.persediaan.nilaiPemakaian)}. Penerimaan menambah aset persediaan; hanya pemakaian yang menjadi beban (di Produksi).</p>
                </Panel>
              )}
              <Card>
                <JudulKartu title="Rincian kelompok biaya" description="Kelompok bernilai nol digabung ke “Komponen lain”." />
                <CardContent className="p-0">
                  {dataDiv.kelompok.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">Tidak ada data sesuai periode dan filter.</p>}
                  {dataDiv.kelompok.map((g) => <BarisRincian key={g.kunci} judul={g.label} sub={`${g.nDokumen} dokumen`} aktual={g.aktual} kas={g.kasKeluar} />)}
                  {(dataDiv.komponenLain.aktual !== 0 || dataDiv.komponenLain.kasKeluar !== 0 || dataDiv.komponenLain.daftar.length > 0) && (
                    <BarisRincian judul="Komponen lain" sub={dataDiv.komponenLain.daftar.length ? `Rp0: ${dataDiv.komponenLain.daftar.join(" · ")}` : undefined} aktual={dataDiv.komponenLain.aktual} kas={dataDiv.komponenLain.kasKeluar} />
                  )}
                </CardContent>
              </Card>
              {finance && dataDiv.tahap && (
                <Panel className="text-[12.5px] text-ink2">
                  <p className="font-semibold text-ink">Dasar atribusi (hanya Finance)</p>
                  <ul className="mt-1 space-y-0.5">{dataDiv.tahap.map((t) => <li key={t.tahap}>{LABEL_TAHAP[t.tahap] ?? t.tahap}: {t.n} dokumen · {formatUang(t.aktual)}</li>)}</ul>
                  {dataDiv.konflik > 0 && <p className="mt-1 text-ink">{dataDiv.konflik} dokumen punya petunjuk divisi yang bertentangan — atribusi mengikuti prioritas (eksplisit → relasi → kategori) dan perlu ditinjau.</p>}
                </Panel>
              )}
            </>
          )}

          {/* ═══ KATEGORI ═══ */}
          {sub === "kategori" && (
            divTunggal && dataDiv ? (
              dataDiv.rinci ? (
                <Card><JudulKartu title="Rincian per kategori" description="Sentuh kategori untuk melihat dokumen sumbernya." />
                  <CardContent className="p-0">
                    {dataDiv.perKategori.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">Tidak ada data sesuai periode dan filter.</p>}
                    {dataDiv.perKategori.map((k) => <BarisRincian key={k.kode} judul={k.nama} sub={`${k.nDokumen} dokumen${k.anggaran != null ? ` · anggaran ${formatUang(k.anggaran)}` : ""}`} aktual={k.aktual} kas={k.kasKeluar}
                      onClick={() => { setKelompokDoc({ kode: k.kode, nama: k.nama }); setSub("dokumen"); }} />)}
                  </CardContent></Card>
              ) : <Card><CardContent className="py-6 text-[13px] text-ink2">Rincian kategori hanya untuk Finance dan leader divisi. Anda melihat ringkasan divisi.</CardContent></Card>
            ) : <Card><CardContent className="py-6 text-[13px] text-ink2">Pilih satu divisi di atas untuk melihat rincian kategorinya.</CardContent></Card>
          )}

          {/* ═══ TREN ═══ */}
          {sub === "tren" && (
            divTunggal && dataDiv ? (
              <Card><JudulKartu title="Tren bulanan" description="Aktual vs anggaran per bulan (WIB)." />
                <CardContent>
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dataDiv.tren.map((t) => ({ ...t, label: bulanLabel(t.bulan), anggaran: t.anggaran ?? 0 }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={(v) => formatRupiahShort(v)} tick={{ fontSize: 11 }} width={52} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v) => formatUang(v)} />
                        <Legend />
                        <Bar dataKey="aktual" name="Aktual" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="kasKeluar" name="Kas keluar" fill="var(--text-tertiary)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="anggaran" name="Anggaran" fill="var(--green)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
                <CardContent className="p-0">
                  {dataDiv.tren.map((t) => <BarisRincian key={t.bulan} judul={bulanLabel(t.bulan)} sub={t.anggaran == null ? "Belum ada anggaran" : `Anggaran ${formatUang(t.anggaran)}`} aktual={t.aktual} kas={t.kasKeluar} />)}
                </CardContent>
              </Card>
            ) : <Card><CardContent className="py-6 text-[13px] text-ink2">Pilih satu divisi di atas untuk melihat tren bulanannya.</CardContent></Card>
          )}

          {/* ═══ TRANSAKSI & KOMITMEN (drill-down dokumen sumber) ═══ */}
          {(sub === "dokumen" || sub === "komitmen") && (
            !divTunggal ? <Card><CardContent className="py-6 text-[13px] text-ink2">Pilih satu divisi di atas untuk melihat dokumen sumbernya.</CardContent></Card>
              : !dok ? <div className="flex items-center gap-2 py-6 text-[13px] text-ink2"><Loader2 size={14} className="animate-spin" /> Memuat dokumen…</div>
              : sub === "dokumen" ? (
                <Card>
                  <JudulKartu title="Dokumen sumber" description={kelompokDoc ? `Disaring: ${kelompokDoc.nama}` : "Semua dokumen biaya divisi pada periode ini."} />
                  <CardContent className="space-y-2 pb-1">
                    {kelompokDoc && <Button size="sm" variant="neutral" onClick={() => setKelompokDoc(null)}>Hapus saringan kategori</Button>}
                    {dok.terpotong && <p className="text-[12px] text-ink3">Menampilkan 500 dokumen teratas; Export Excel memuat seluruhnya.</p>}
                  </CardContent>
                  <CardContent className="p-0">
                    {dok.baris.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">Tidak ada data sesuai periode dan filter.</p>}
                    {dok.baris.map((b, i) => (
                      <div key={`${b.entryId}-${i}`} className="border-b border-line/60 px-3 py-2.5 last:border-0" data-testid="baris-dokumen">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-[13px] font-semibold leading-snug text-ink">{b.dokumen?.nomor ?? b.nomor}<span className="ml-1.5 text-[11.5px] font-normal text-ink3">{NAMA_MODUL[b.dokumen?.modul] ?? b.sumber}</span></span>
                          <span className="shrink-0 text-right text-[12.5px] tabular-nums"><b className="block text-ink">{formatUang(b.aktual)}</b><span className="text-ink3">Kas {formatUang(b.kasKeluar)}</span></span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-ink2">{formatTanggalPendek(b.tanggal)} · {b.kategori?.nama ?? "Tanpa kategori"} · jurnal {b.nomor}{b.balik ? " (pembalik)" : ""}</p>
                        <p className="mt-0.5 text-[11.5px] leading-snug text-ink3">Atribusi: {LABEL_TAHAP[b.tahap] ?? b.tahap} — {b.aturan}</p>
                        {finance && RUTE_DOKUMEN[b.dokumen?.modul] && <Button size="sm" variant="tertiary" className="mt-1 px-0" onClick={() => navigate(RUTE_DOKUMEN[b.dokumen.modul])}>Buka di Finance <ChevronRight size={13} /></Button>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <JudulKartu title="Komitmen belum dibayar" description="Dokumen yang diajukan/disetujui tetapi uangnya belum keluar. Menunggu persetujuan = belum beban, belum kas keluar." />
                  <CardContent className="p-0">
                    {dok.komitmen.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">Tidak ada data sesuai periode dan filter.</p>}
                    {dok.komitmen.map((k) => (
                      <div key={`${k.modul}-${k.id}`} className="border-b border-line/60 px-3 py-2.5 last:border-0">
                        <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-semibold text-ink">{k.nomor ?? "—"}<span className="ml-1.5 text-[11.5px] font-normal text-ink3">{NAMA_MODUL[k.modul] ?? k.modul}</span></span><b className="shrink-0 text-[12.5px] tabular-nums text-ink">{formatUang(k.jumlah)}</b></div>
                        <p className="mt-0.5 text-[12px] text-ink2">{formatTanggalPendek(k.tanggal)} · {k.kategori?.nama ?? "Tanpa kategori"} · {k.jenis === "BELUM_DIBUKUKAN" ? "menunggu persetujuan (belum beban, belum kas keluar)" : "sudah dibukukan, belum dibayar (belum kas keluar)"}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )
          )}

          {/* ═══ ANGGARAN ═══ */}
          {sub === "anggaran" && <PanelAnggaran akses={akses} divTunggal={divTunggal} anggaran={anggaran} periode={periode} dataDiv={dataDiv} onBerubah={muat} />}

          {/* ═══ DEFINISI ═══ */}
          <Panel data-testid="definisi-laporan" className="space-y-2 text-[12.5px] leading-relaxed text-ink2">
              <p className="flex items-center gap-1.5 font-semibold text-ink"><Info size={14} className="text-accent" />Definisi angka & alasan bisa berbeda dari laporan lain</p>
              <p><b>Aktual</b> = beban yang diakui di jurnal (tanggal buku). <b>Kas Keluar</b> = uang yang benar-benar keluar dari kas/bank. Keduanya berbeda: tagihan supplier menjadi Aktual saat disetujui tetapi baru menjadi Kas Keluar saat dibayar; uang muka menjadi Kas Keluar saat diberikan dan menjadi Aktual saat dipertanggungjawabkan.</p>
              <p><b>Komitmen</b> belum menjadi beban atau kas keluar: dokumen yang menunggu persetujuan belum dijurnal sama sekali; yang sudah dibukukan tetapi belum dibayar sudah menjadi Aktual (bila beban) tetapi belum Kas Keluar. Satu transaksi sumber hanya dihitung sekali pada tiap konsep.</p>
              <p>Basis tanggal: {lap.basis.aktual} (Aktual), {lap.basis.kasKeluar} (Kas Keluar), {lap.basis.komitmen} (Komitmen), {lap.basis.anggaran} (Anggaran); zona waktu {lap.basis.zonaWaktu}. Filter aktif: periode {formatTanggalPendek(lap.periode.from)}–{formatTanggalPendek(lap.periode.to)}{kategori ? ` · kategori ${kategori}` : ""}{status ? ` · status ${status}` : ""}{proyek ? ` · proyek ${proyek}` : ""}.</p>
              <p><b>Tidak termasuk:</b> {lap.tidakTermasuk.join("; ")}.</p>
              {lap.sensitifDisaring && <p>Sebagian dokumen sensitif (gaji, kasbon, investor) tidak ditampilkan untuk akun Anda.</p>}
          </Panel>
          <KenapaBeda metrik={["beban_diakui", "uang_keluar_kas", "komitmen_belum_dibayar", "anggaran_divisi", "sisa_anggaran_divisi", "biaya_tidak_terklasifikasi"]} />
        </>
      )}
    </HalamanFinance>
  );
}

// ── Anggaran: daftar versi + (Finance/leader) buat draf + (penyetuju) setujui ──
function PanelAnggaran({ akses, divTunggal, anggaran, periode, dataDiv, onBerubah }) {
  const [form, setForm] = useState({ periode: periode.from.slice(0, 7), kategori: "", proyek: "", nominal: "", alasan: "" });
  const [galat, setGalat] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const boleh = divTunggal && akses.divisi.find((d) => d.scope === divTunggal)?.rinci;
  async function simpan() {
    setSibuk(true); setGalat(null);
    try {
      await api.simpanAnggaranDivisi({ division: divTunggal, period: form.periode, categoryId: akses.kategori.find((k) => k.kode === form.kategori)?.id ?? null, projectKey: form.proyek || null, amount: Number(String(form.nominal).replace(/\./g, "")), reason: form.alasan || null });
      setForm((f) => ({ ...f, nominal: "", alasan: "" })); await onBerubah();
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }
  return (
    <>
      <Card>
        <JudulKartu title="Versi anggaran" description="Hanya versi DISETUJUI yang berlaku. Belum ada anggaran = “Belum ada anggaran”, bukan Rp0." />
        <CardContent className="p-0">
          {!divTunggal && <p className="px-4 py-5 text-[13px] text-ink3">Pilih satu divisi di atas untuk melihat dan mengatur anggarannya.</p>}
          {divTunggal && anggaran && anggaran.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">Belum ada anggaran untuk periode ini.</p>}
          {(anggaran || []).map((a) => (
            <div key={a.id} className="border-b border-line/60 px-3 py-2.5 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{a.period} · {a.kategori?.nama ?? (a.projectKey ? `Proyek ${a.projectKey}` : "Total divisi")} <span className="font-normal text-ink3">v{a.version}</span></span>
                <b className="shrink-0 text-[12.5px] tabular-nums text-ink">{formatUang(a.amount)}</b>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink3">
                <Badge variant={a.status === "DISETUJUI" ? "green" : a.status === "DRAF" ? "orange" : "neutral"}>{a.status === "DISETUJUI" ? "Disetujui" : a.status === "DRAF" ? "Draf" : "Digantikan"}</Badge>
                dibuat {a.createdByName ?? "—"}{a.approvedByName ? ` · disetujui ${a.approvedByName}` : ""}{a.reason ? ` · alasan: ${a.reason}` : ""}
                {a.status === "DRAF" && akses.bolehSetujuiAnggaran && <Button size="sm" variant="secondary" onClick={async () => { try { await api.setujuiAnggaranDivisi(a.id); await onBerubah(); } catch (e) { setGalat(e.message); } }}>Setujui</Button>}
                {a.status === "DRAF" && <Button size="sm" variant="neutral" onClick={async () => { try { await api.hapusAnggaranDivisi(a.id); await onBerubah(); } catch (e) { setGalat(e.message); } }}>Hapus draf</Button>}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      {boleh && (
        <Panel className="space-y-2">
          <p className="text-[13px] font-semibold text-ink">Buat draf anggaran {dataDiv?.label ?? ""}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[12px] text-ink3">Bulan<Input type="month" value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })} className="mt-1 h-10" /></label>
            <label className="text-[12px] text-ink3">Kategori (opsional)
              <select value={form.kategori} onChange={(e) => setForm({ ...form, kategori: e.target.value })} className="mt-1 h-10 w-full rounded-btn border border-line bg-surface px-2 text-[13px] text-ink"><option value="">Total divisi</option>{akses.kategori.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}</select>
            </label>
            <label className="text-[12px] text-ink3">Proyek / campaign (opsional)<Input value={form.proyek} onChange={(e) => setForm({ ...form, proyek: e.target.value })} className="mt-1 h-10" /></label>
            <label className="text-[12px] text-ink3">Nominal (Rp)<Input inputMode="numeric" value={form.nominal} onChange={(e) => setForm({ ...form, nominal: e.target.value.replace(/[^\d]/g, "") })} className="mt-1 h-10" /></label>
          </div>
          <label className="block text-[12px] text-ink3">Alasan (wajib untuk versi berikutnya)<Input value={form.alasan} onChange={(e) => setForm({ ...form, alasan: e.target.value })} className="mt-1 h-10" /></label>
          {galat && <p role="alert" className="text-[12.5px] text-red">{galat}</p>}
          <Button size="sm" onClick={simpan} disabled={sibuk || !form.nominal}>{sibuk ? "Menyimpan…" : "Simpan draf"}</Button>
          <p className="text-[11.5px] text-ink3">Draf tidak berlaku sampai disetujui Finance (penyetuju berbeda dari pembuat). Menyetujui versi baru menggantikan versi lama; riwayat tidak dihapus.</p>
        </Panel>
      )}
    </>
  );
}
