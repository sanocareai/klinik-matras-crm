import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { AksiLain, BannerKonflik, KolomHitung, LencanaStatus, nilaiKolom, satuan, teksPetugas } from "@/features/warehouse/opname/BarisHitung.jsx";
import PanelDiLuarCakupan from "@/features/warehouse/opname/PanelDiLuarCakupan.jsx";
import { MODE_LABEL, TAB, bekukanAntrean, hitungTab, saringBaris, sudahDihitung, susunItemSimpan, teksProgres, terapkanHasilSimpan } from "@/features/warehouse/opname/opnameLogic.js";

// HALAMAN KERJA HITUNG (Stock Opname sesi model 2): progres total & per kelompok, tab Belum/Sudah dihitung/Perlu diperiksa, pencarian, simpan bertahap (sesi tidak diselesaikan, saldo tidak berubah),
// konflik antar-petugas lewat revisi per baris. Desktop = daftar; HP = SATU kartu bahan + "Simpan & berikutnya". Kolom kosong = belum dihitung; 0 hanya bila diketik 0.
const PATH = "/warehouse/stock-count";
function useSempit(px = 640) {
  const [s, setS] = useState(() => typeof window !== "undefined" && window.matchMedia?.(`(max-width: ${px - 1}px)`).matches);
  useEffect(() => { const m = window.matchMedia?.(`(max-width: ${px - 1}px)`); if (!m) return undefined; const f = () => setS(m.matches); f(); m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f); }, [px]);
  return s;
}

export default function WarehouseOpnameKerja() {
  const { id } = useParams(); const navigate = useNavigate(); const sempit = useSempit();
  const [data, setData] = useState(null); const [baris, setBaris] = useState([]); const [draf, setDraf] = useState({}); const [konflik, setKonflik] = useState({}); const [galatBaris, setGalatBaris] = useState({});
  const [tab, setTab] = useState("belum"); const [q, setQ] = useState(""); const [kelompok, setKelompok] = useState(""); const [memuat, setMemuat] = useState(true); const [galat, setGalat] = useState(""); const [sibuk, setSibuk] = useState(false);
  const [info, setInfo] = useState(""); const [batas, setBatas] = useState(100); const [mode, setMode] = useState("kartu"); const [antrean, setAntrean] = useState([]); const [pos, setPos] = useState(0);
  const drafRef = useRef(draf); drafRef.current = draf; const kartuRef = useRef(null);

  const muat = useCallback(async (tenang = false) => {
    if (!tenang) setMemuat(true);
    try { const d = await api.getKerjaOpname(id); setData(d); setBaris(d.baris); setGalat(""); } catch (e) { setGalat(e.message || "Gagal memuat sesi"); } finally { setMemuat(false); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);
  useEffect(() => { // segarkan tenang tiap 60 dtk (hanya bila tak ada angka belum disimpan) dan saat tab kembali terlihat: melihat hitungan petugas lain
    const f = () => { if (document.visibilityState === "visible" && Object.keys(drafRef.current).length === 0) muat(true); };
    const t = setInterval(f, 60_000); document.addEventListener("visibilitychange", f); return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); };
  }, [muat]);
  useEffect(() => { const f = (e) => { if (Object.keys(drafRef.current).length) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, []);

  const penyaring = useMemo(() => ({ tab, q, kelompok }), [tab, q, kelompok]);
  const tampil = useMemo(() => saringBaris(baris, penyaring), [baris, penyaring]);
  const jumlahTab = useMemo(() => hitungTab(baris), [baris]);
  useEffect(() => { setAntrean(bekukanAntrean(baris, penyaring)); setPos(0); setBatas(100); }, [tab, q, kelompok, data?.dimuatPada]); // eslint-disable-line react-hooks/exhaustive-deps -- antrean dibekukan saat penyaring berubah / muat ulang
  const bisa = !!data?.bisaMenghitung;
  useEffect(() => { if (sempit && mode === "kartu") kartuRef.current?.scrollIntoView?.({ block: "start" }); }, [pos, antrean, mode, sempit]); // kartu bahan selalu di atas layar (tidak tertutup bilah aksi di dasar)
  const ubahDraf = (lineId, patch) => setDraf((d) => ({ ...d, [lineId]: { ...d[lineId], ...patch } }));
  const jumlahDraf = Object.keys(draf).length;

  async function simpan(lineIds = null) {
    const sumber = lineIds ? Object.fromEntries(Object.entries(draf).filter(([k]) => lineIds.includes(k))) : draf;
    const { items, galat: g } = susunItemSimpan(baris, sumber);
    setGalatBaris(g); if (!items.length) { if (!Object.keys(g).length) setInfo("Tidak ada perubahan untuk disimpan."); return { ok: Object.keys(g).length === 0 }; }
    setSibuk(true); setGalat(""); setInfo("");
    try {
      const r = await api.simpanHasilOpname(id, items);
      const t = terapkanHasilSimpan(baris, draf, r.hasil);
      setBaris(t.baris); setDraf(t.draf); setKonflik((k) => ({ ...k, ...t.konflik })); setGalatBaris((x) => ({ ...x, ...t.galatBaris }));
      setData((d) => ({ ...d, progres: { ...d.progres, ...r.progres, perKelompok: r.progres.perKelompok } }));
      const ok = r.hasil.filter((h) => h.status === "DISIMPAN").length; const kon = r.hasil.filter((h) => h.status === "KONFLIK").length;
      setInfo(`${ok} bahan tersimpan${kon ? `, ${kon} bentrok dengan petugas lain` : ""}.`);
      return { ok: kon === 0 && Object.keys(t.galatBaris).length === 0 && Object.keys(g).length === 0 };
    } catch (e) { setGalat(e.message || "Gagal menyimpan"); return { ok: false }; } finally { setSibuk(false); }
  }
  const pakaiMereka = (lineId) => { const s = konflik[lineId]; setBaris((bs) => bs.map((b) => (b.id === lineId ? { ...b, counted: s.counted, countedAt: s.countedAt, countedBy: s.oleh, revision: s.revision, perluPeriksa: s.revision >= 2 } : b))); setDraf((d) => { const n = { ...d }; delete n[lineId]; return n; }); setKonflik((k) => { const n = { ...k }; delete n[lineId]; return n; }); };
  const timpa = (lineId) => { const s = konflik[lineId]; setBaris((bs) => bs.map((b) => (b.id === lineId ? { ...b, counted: s.counted, countedAt: s.countedAt, countedBy: s.oleh, revision: s.revision } : b))); setKonflik((k) => { const n = { ...k }; delete n[lineId]; return n; }); };
  const keluarkan = async (lineId, alasan) => { try { await api.keluarkanBarisOpname(id, lineId, alasan); await muat(true); } catch (e) { setGalat(e.message); } };
  const kembalikan = async (lineId) => { try { await api.kembalikanBarisOpname(id, lineId); await muat(true); } catch (e) { setGalat(e.message); } };
  const mulaiHitung = async () => { setSibuk(true); try { await api.startStockCount(id); await muat(true); } catch (e) { setGalat(e.message); } finally { setSibuk(false); } };
  const serahkan = async () => { setSibuk(true); setGalat(""); try { if (jumlahDraf) { const r = await simpan(); if (!r.ok) return; } await api.submitStockCount(id); navigate(`${PATH}/${id}`); } catch (e) { setGalat(e.message); } finally { setSibuk(false); } };
  const fokusBerikut = (i) => { const el = document.querySelectorAll('[data-testid="kolom-hitung"]')[i + 1]; el?.focus(); };

  if (memuat && !data) return <PageContainer><PageBody><p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3" aria-busy="true"><Loader2 size={14} className="animate-spin" /> Memuat sesi hitung…</p></PageBody></PageContainer>;
  if (!data) return <PageContainer><PageBody><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-kerja">{galat}</p><Link to={PATH} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent"><ArrowLeft size={13} /> Kembali ke Stock Opname</Link></PageBody></PageContainer>;

  const p = data.progres; const seluruh = !p.belum && p.total > 0; const kartuB = antrean[pos] ? baris.find((b) => b.id === antrean[pos]) : null;
  const banner = data.status === "SCHEDULED" ? "Sesi belum dimulai." : data.status !== "IN_PROGRESS" ? `Sesi berstatus ${data.status === "WAITING_REVIEW" ? "Menunggu tinjauan" : data.status === "COMPLETED" ? "Selesai" : "Dibatalkan"}: hitungan tidak bisa diubah di sini.` : !data.izin.tulis ? "Akun Anda hanya dapat melihat hitungan (tidak punya izin menghitung)." : "";

  const barisUI = (b, i) => (
    <li key={b.id} className={cn("rounded-btn border bg-surface px-3 py-2", konflik[b.id] ? "border-orange" : "border-line")} data-testid="baris-hitung" data-kode={b.kode} data-status={sudahDihitung(b) ? "sudah" : "belum"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-56"><div className="text-[13.5px] font-semibold text-ink [overflow-wrap:anywhere]">{b.nama}</div><div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink3">{b.kode} · {b.kelompokLabel}<LencanaStatus b={b} /></div></div>
        {!b.excluded && <KolomHitung b={b} draf={draf[b.id]} bisa={bisa} onUbah={(pt) => ubahDraf(b.id, pt)} onEnter={() => fokusBerikut(i)} label={`Jumlah fisik ${b.kode}`} />}
        <div className="basis-44 text-[11.5px] text-ink3" data-testid="petugas-baris">{teksPetugas(b)}</div>
        <AksiLain ringkas countId={id} b={b} bisa={bisa} ragu={draf[b.id]?.ragu ?? b.ditandaRagu} onRagu={(v) => ubahDraf(b.id, { ragu: v })} onKeluar={(a) => keluarkan(b.id, a)} onKembalikan={() => kembalikan(b.id)} />
      </div>
      {konflik[b.id] && <div className="mt-2"><BannerKonflik konflik={konflik[b.id]} onPakai={() => pakaiMereka(b.id)} onTimpa={() => timpa(b.id)} /></div>}
      {draf[b.id] && sudahDihitung(b) && draf[b.id].teks !== undefined && nilaiKolom(b, draf[b.id]) !== String(b.counted) && (
        <label className="mt-2 block text-[12px] text-ink2">Alasan koreksi (wajib)<input value={draf[b.id].alasan ?? ""} onChange={(e) => ubahDraf(b.id, { alasan: e.target.value })} placeholder="mis. hitung ulang di rak B" data-testid="alasan-koreksi" className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent max-sm:min-h-11" /></label>)}
      {galatBaris[b.id] && <p role="alert" className="m-0 mt-1.5 text-[12px] text-red" data-testid="galat-baris">{galatBaris[b.id]}</p>}
    </li>
  );

  const kartuHP = kartuB ? (
    <div ref={kartuRef} className="scroll-mt-[72px]"><Card key={kartuB.id} className="space-y-3 p-4" data-testid="kartu-hp">
      <p className="m-0 text-[12px] font-semibold text-ink3" data-testid="posisi-kartu">{pos + 1} dari {antrean.length} di daftar ini</p>
      <div><h2 className="m-0 text-[18px] font-bold leading-snug text-ink [overflow-wrap:anywhere]" data-testid="nama-kartu">{kartuB.nama}</h2><p className="m-0 text-[13px] text-ink2">{kartuB.kode} · {kartuB.kelompokLabel} · satuan <b>{satuan(kartuB.satuan)}</b></p></div>
      <LencanaStatus b={kartuB} />
      {!kartuB.excluded && <KolomHitung b={kartuB} draf={draf[kartuB.id]} bisa={bisa} large autoFocus onUbah={(pt) => ubahDraf(kartuB.id, pt)} onEnter={async () => { const r = await simpan([kartuB.id]); if (r.ok) setPos((x) => Math.min(antrean.length, x + 1)); }} label={`Jumlah fisik ${kartuB.kode}`} />}
      <p className="m-0 text-[11.5px] text-ink3">{teksPetugas(kartuB)}. Kosongkan bila belum dihitung; ketik 0 bila memang tidak ada.</p>
      {konflik[kartuB.id] && <BannerKonflik konflik={konflik[kartuB.id]} onPakai={() => pakaiMereka(kartuB.id)} onTimpa={() => timpa(kartuB.id)} />}
      {draf[kartuB.id] && sudahDihitung(kartuB) && nilaiKolom(kartuB, draf[kartuB.id]) !== String(kartuB.counted) && (
        <label className="block text-[12px] text-ink2">Alasan koreksi (wajib)<input value={draf[kartuB.id].alasan ?? ""} onChange={(e) => ubahDraf(kartuB.id, { alasan: e.target.value })} data-testid="alasan-koreksi" className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[16px] outline-none focus:border-accent max-sm:min-h-11" /></label>)}
      {galatBaris[kartuB.id] && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-baris">{galatBaris[kartuB.id]}</p>}
      {info && <p className="m-0 text-[12px] text-ink2" data-testid="info-simpan" role="status">{info}</p>}
      <AksiLain countId={id} b={kartuB} bisa={bisa} ragu={draf[kartuB.id]?.ragu ?? kartuB.ditandaRagu} onRagu={(v) => ubahDraf(kartuB.id, { ragu: v })} onKeluar={(a) => keluarkan(kartuB.id, a)} onKembalikan={() => kembalikan(kartuB.id)} />
    </Card></div>
  ) : (
    <Card className="space-y-2 p-4 text-center" data-testid="kartu-selesai"><CheckCircle2 size={22} className="mx-auto text-green" aria-hidden /><p className="m-0 text-[14px] font-semibold text-ink">{tampil.length === 0 ? "Tidak ada bahan di daftar ini." : "Semua bahan di daftar ini sudah dilewati/disimpan."}</p><p className="m-0 text-[12px] text-ink3">Ganti tab atau pencarian untuk bahan lainnya.</p></Card>
  );

  return (
    <PageContainer>
      <PageHeader title={data.countNumber} subtitle={<span data-testid="subjudul-kerja">{MODE_LABEL[data.scopeMode] ?? "Hitungan"}{sempit ? "" : ` · ${teksProgres(p)}`}</span>}
        actions={<><Link to={`${PATH}/${id}`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent max-sm:min-h-11 max-sm:items-center" data-testid="ke-detail"><ArrowLeft size={13} /> Halaman sesi</Link><Button variant="ghost" size="sm" onClick={() => muat(true)} className="max-sm:min-h-11" data-testid="muat-ulang-kerja"><RefreshCw size={14} /> Muat ulang</Button></>} />
      <PageBody>
        {galat && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-halaman">{galat}</div>}
        {banner && <div className="flex flex-wrap items-center gap-2 rounded-btn bg-inset px-3 py-2.5 text-[12.5px] text-ink2" data-testid="banner-status">{banner}{data.status === "SCHEDULED" && data.izin.tulis && <Button size="sm" onClick={mulaiHitung} disabled={sibuk} className="max-sm:min-h-11" data-testid="mulai-hitung">Mulai hitung</Button>}</div>}

        <Card className="space-y-2.5 p-4" data-testid="progres">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="m-0 text-[15px] font-semibold text-ink" data-testid="teks-progres">{teksProgres(p)}</h2><span className="text-[12px] text-ink3">{data.blindCount ? (sempit ? "Blind count" : "Blind count: saldo sistem disembunyikan") : "Saldo sistem tidak ditampilkan di halaman hitung"}</span></div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={p.persen} aria-valuemin={0} aria-valuemax={100} aria-label="Progres hitung"><div className="h-full bg-accent transition-all" style={{ width: `${p.persen}%` }} /></div>
          {sempit ? (
            <details data-testid="progres-kelompok"><summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-semibold text-accent">Per kelompok</summary><div className="mt-1 flex flex-wrap gap-1.5">            <button type="button" onClick={() => setKelompok("")} className={cn("rounded-chip px-2.5 py-1 text-[12px] max-sm:min-h-9", kelompok === "" ? "bg-accent text-white" : "bg-inset text-ink2")}>Semua</button>
            {p.perKelompok.map((k) => <button key={k.kode} type="button" onClick={() => setKelompok(kelompok === k.kode ? "" : k.kode)} data-testid={`kel-${k.kode}`} className={cn("rounded-chip px-2.5 py-1 text-[12px] max-sm:min-h-9", kelompok === k.kode ? "bg-accent text-white" : k.dihitung === k.total ? "bg-greenbg text-green" : "bg-inset text-ink2")}>{k.label} {k.dihitung}/{k.total}</button>)}</div></details>
          ) : (
            <div className="flex flex-wrap gap-1.5" data-testid="progres-kelompok">
              <button type="button" onClick={() => setKelompok("")} className={cn("rounded-chip px-2.5 py-1 text-[12px] max-sm:min-h-9", kelompok === "" ? "bg-accent text-white" : "bg-inset text-ink2")}>Semua</button>
              {p.perKelompok.map((k) => <button key={k.kode} type="button" onClick={() => setKelompok(kelompok === k.kode ? "" : k.kode)} data-testid={`kel-${k.kode}`} className={cn("rounded-chip px-2.5 py-1 text-[12px] max-sm:min-h-9", kelompok === k.kode ? "bg-accent text-white" : k.dihitung === k.total ? "bg-greenbg text-green" : "bg-inset text-ink2")}>{k.label} {k.dihitung}/{k.total}</button>)}
            </div>
            )}
        </Card>

        <PanelDiLuarCakupan countId={id} daftar={data.diLuarCakupan} bisa={data.izin.tulis && ["SCHEDULED", "IN_PROGRESS"].includes(data.status)} onSelesai={() => muat(true)} />

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Saring bahan" className="flex flex-wrap gap-1.5">
            {TAB.filter((t) => t.kunci !== "keluar" || jumlahTab.keluar > 0).map((t) => <button key={t.kunci} role="tab" type="button" aria-selected={tab === t.kunci} onClick={() => setTab(t.kunci)} data-testid={`tab-${t.kunci}`} className={cn("rounded-btn px-3 py-1.5 text-[12.5px] font-semibold max-sm:min-h-11", tab === t.kunci ? "bg-accent text-white" : "bg-inset text-ink2 hover:bg-hovertint")}>{t.label} <span className="tabular-nums">{jumlahTab[t.kunci]}</span></button>)}
          </div>
          <div className="relative min-w-[200px] flex-1"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama bahan…" aria-label="Cari bahan" data-testid="cari-kerja" className="w-full rounded-btn border border-line bg-surface py-2 pl-8 pr-2.5 text-[13px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]" /></div>
          {sempit && <div className="flex gap-1.5"><Button size="sm" variant={mode === "kartu" ? "primary" : "secondary"} onClick={() => setMode("kartu")} className="min-h-11" data-testid="mode-kartu">Kartu</Button><Button size="sm" variant={mode === "daftar" ? "primary" : "secondary"} onClick={() => setMode("daftar")} className="min-h-11" data-testid="mode-daftar">Daftar</Button></div>}
        </div>

        {sempit && mode === "kartu" ? kartuHP : (
          <>
            <p className="m-0 text-[12px] text-ink3" data-testid="jumlah-tampil">{tampil.length} bahan ditampilkan</p>
            {tampil.length === 0 ? <Card className="p-6 text-center text-[13px] text-ink3" data-testid="daftar-kosong">{tab === "belum" && !q && !kelompok ? "Semua bahan sudah dihitung. Serahkan hitungan di bawah." : "Tidak ada bahan yang cocok."}</Card>
              : <ul className="m-0 list-none space-y-2 p-0" data-testid="daftar-hitung">{tampil.slice(0, batas).map((b, i) => barisUI(b, i))}</ul>}
            {tampil.length > batas && <Button variant="secondary" onClick={() => setBatas((x) => x + 100)} className="max-sm:min-h-11" data-testid="tampilkan-lagi">Tampilkan lagi ({tampil.length - batas} lainnya)</Button>}
          </>
        )}

        {data.status === "IN_PROGRESS" && data.izin.tulis && (
          <Card className="flex flex-wrap items-center gap-3 p-4" data-testid="serahkan-kartu">
            <div className="min-w-0 flex-1 basis-60 text-[12.5px] text-ink2">{seluruh ? "Semua bahan sudah dihitung. Hitungan siap diserahkan untuk diperiksa petugas lain dan ditinjau penyetuju." : `Masih ${p.belum} bahan belum dihitung. Hitungan baru bisa diserahkan bila semuanya terisi (atau bahan yang tidak ada dikeluarkan dari sesi dengan alasan).`}</div>
            <Button onClick={serahkan} disabled={!seluruh || sibuk} className="max-sm:min-h-11 max-sm:w-full" data-testid="serahkan-hitungan">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} Serahkan hitungan</Button>
          </Card>
        )}
        <div className={sempit && mode === "kartu" ? "h-32" : "h-16"} aria-hidden />
      </PageBody>
      {sempit && mode === "kartu" && kartuB && (
        <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur" data-testid="bilah-kartu">
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Button variant="secondary" onClick={() => setPos((x) => Math.max(0, x - 1))} disabled={pos === 0} className="min-h-12" data-testid="kartu-sebelumnya">Sebelumnya</Button>
            {bisa ? <Button onClick={async () => { const r = await simpan([kartuB.id]); if (r.ok) setPos((x) => Math.min(antrean.length, x + 1)); }} disabled={sibuk} className="min-h-12" data-testid="simpan-berikutnya">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} Simpan &amp; berikutnya</Button>
              : <Button onClick={() => setPos((x) => Math.min(antrean.length, x + 1))} className="min-h-12">Berikutnya</Button>}
          </div>
          {bisa && <Button variant="ghost" onClick={() => setPos((x) => Math.min(antrean.length, x + 1))} className="mt-1 min-h-11 w-full" data-testid="lewati">Lewati (hitung nanti)</Button>}
        </div>
      )}
      {!(sempit && mode === "kartu") && (jumlahDraf > 0 || info) && (
        <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur max-sm:pb-[max(0.625rem,env(safe-area-inset-bottom))]" data-testid="bilah-simpan" role="status">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2">
            {jumlahDraf > 0 ? <><Badge variant="orange" data-testid="jumlah-draf">{jumlahDraf} belum disimpan</Badge>
              <Button size="sm" onClick={() => simpan()} disabled={sibuk || !bisa} className="max-sm:min-h-11" data-testid="simpan-perubahan">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} Simpan perubahan</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraf({}); setGalatBaris({}); setInfo(""); }} className="max-sm:min-h-11" data-testid="buang-perubahan">Buang</Button></> : null}
            {info && <span className="text-[12px] text-ink2" data-testid="info-simpan">{info}</span>}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
