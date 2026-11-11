import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { api } from "@/api.js";
import { HalamanFinance } from "@/features/finance/shared.jsx";
import { HASIL_TEKS, STATUS_TEKS, alasanTahan, bedaKeras, butuhKonfirmasi, butuhKonfirmasiHarga, kabarkanPengajuan, teksBaris, waktuSingkat } from "@/features/production/pengajuan/pengajuanModel.js";

// VERIFIKASI PEMAKAIAN BAHAN (ADMIN) — pengajuan pemakaian dari non-ADMIN (catat pemakaian, perubahan, Aplikasi Meja) dan koreksi pemakaian berpersetujuan.
// Server menjalankan ulang SEMUA pemeriksaan per pengajuan (saldo, satuan, dasar harga, sumber, duplikat, pengaman SO, idempotensi); yang bermasalah DITAHAN dan hasil tiap pengajuan
// ditampilkan. Pengaju tidak bisa memverifikasi pengajuannya sendiri. Finance bukan penyetuju operasional bahan.
const INPUT = "h-10 w-full rounded-btn border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink3";

export default function VerifikasiPemakaian() {
  const [tab, setTab] = useState("pemakaian");
  const [data, setData] = useState(null); const [koreksi, setKoreksi] = useState(null); const [error, setError] = useState(null);
  const muat = useCallback(async () => {
    try {
      const [p, k] = await Promise.all([api.daftarPengajuanPemakaian({ status: "DIAJUKAN,DITAHAN" }), api.daftarKoreksiPemakaian({ status: "PENDING_APPROVAL" })]);
      setData(p); setKoreksi(k.koreksi || []); setError(null);
    } catch (e) { setError(e.message || "Gagal memuat"); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const n = data?.pengajuan?.length ?? 0;
  return (
    <HalamanFinance title="Verifikasi Pemakaian Bahan" subtitle="Pemakaian yang dilaporkan non-ADMIN. Stok dan HPP baru berubah setelah Anda verifikasi; setiap pengajuan diperiksa ulang saat itu."
      loading={!data && !error} error={error} onRetry={muat}>
      {data && !data.bolehVerifikasi && <p className="mb-3 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-ink" data-testid="vp-bukan-admin">Halaman ini untuk peran ADMIN. Anda hanya dapat melihat daftarnya.</p>}
      {data && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pemakaian" data-testid="vp-tab-pemakaian">Pemakaian ({n})</TabsTrigger>
            <TabsTrigger value="koreksi" data-testid="vp-tab-koreksi">Koreksi pemakaian ({koreksi?.length ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="pemakaian"><DaftarPengajuan data={data} onUbah={muat} /></TabsContent>
          <TabsContent value="koreksi"><DaftarKoreksi koreksi={koreksi || []} userId={data.userId} boleh={data.bolehVerifikasi} onUbah={muat} /></TabsContent>
        </Tabs>
      )}
    </HalamanFinance>
  );
}

function DaftarPengajuan({ data, onUbah }) {
  const daftar = data.pengajuan || []; const boleh = data.bolehVerifikasi;
  const [pilih, setPilih] = useState(() => new Set()); const [isian, setIsian] = useState({}); const [catatan, setCatatan] = useState("");
  const [tolakBuka, setTolakBuka] = useState(false); const [alasanTolak, setAlasanTolak] = useState("");
  const [sibuk, setSibuk] = useState(false); const [hasil, setHasil] = useState(null); const [galat, setGalat] = useState("");
  const milikSaya = (p) => p.diajukanOleh === data.userId;
  const bisaDipilih = daftar.filter((p) => boleh && !milikSaya(p));
  useEffect(() => { setPilih((s) => new Set([...s].filter((id) => daftar.some((p) => p.id === id)))); }, [daftar]);
  const semua = bisaDipilih.length > 0 && bisaDipilih.every((p) => pilih.has(p.id));
  const ubahPilih = (id, on) => setPilih((s) => { const t = new Set(s); if (on) t.add(id); else t.delete(id); return t; });
  const set = (id, k, v) => setIsian((x) => ({ ...x, [id]: { ...(x[id] || {}), [k]: v } }));
  const dipilih = daftar.filter((p) => pilih.has(p.id));
  const kurangIsian = dipilih.filter((p) => (butuhKonfirmasiHarga(p) && String(isian[p.id]?.konfirmasiHarga || "").trim().length < 5));

  async function verifikasi() {
    setSibuk(true); setGalat(""); setHasil(null);
    try {
      const r = await api.verifikasiPengajuanPemakaian({ item: dipilih.map((p) => ({ id: p.id, konfirmasi: isian[p.id]?.konfirmasi?.trim() || undefined, konfirmasiHarga: isian[p.id]?.konfirmasiHarga?.trim() || undefined })), catatan: catatan.trim() || null });
      setHasil({ jenis: "verifikasi", ...r }); setPilih(new Set()); kabarkanPengajuan(); await onUbah();
    } catch (e) { setGalat(e.message || "Gagal memverifikasi"); } finally { setSibuk(false); }
  }
  async function tolak() {
    setSibuk(true); setGalat(""); setHasil(null);
    try { const r = await api.tolakPengajuanPemakaian({ ids: dipilih.map((p) => p.id), alasan: alasanTolak.trim() }); setHasil({ jenis: "tolak", ...r }); setPilih(new Set()); setTolakBuka(false); setAlasanTolak(""); kabarkanPengajuan(); await onUbah(); }
    catch (e) { setGalat(e.message || "Gagal menolak"); } finally { setSibuk(false); }
  }
  const nama = useMemo(() => new Map(daftar.map((p) => [p.id, p])), [daftar]);

  return (
    <div className="space-y-3 pb-28" data-testid="vp-daftar">
      {hasil && <HasilPerPengajuan hasil={hasil} nama={nama} onTutup={() => setHasil(null)} />}
      {galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{galat}</p>}
      {!daftar.length && <Card><CardContent className="py-10 text-center text-[14px] text-ink2" data-testid="vp-kosong"><CheckCircle2 size={22} className="mx-auto mb-2 text-green" aria-hidden />Tidak ada pengajuan yang menunggu.</CardContent></Card>}
      {daftar.length > 0 && boleh && (
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-ink2"><input type="checkbox" className="h-5 w-5" checked={semua} onChange={(e) => setPilih(e.target.checked ? new Set(bisaDipilih.map((p) => p.id)) : new Set())} data-testid="vp-pilih-semua" />Pilih semua yang bisa Anda verifikasi ({bisaDipilih.length})</label>
      )}
      {daftar.map((p) => <KartuPengajuan key={p.id} p={p} boleh={boleh} milikSaya={milikSaya(p)} terpilih={pilih.has(p.id)} onPilih={(on) => ubahPilih(p.id, on)} isian={isian[p.id] || {}} onIsi={(k, v) => set(p.id, k, v)} />)}

      {boleh && dipilih.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 shadow-lg" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }} data-testid="vp-aksi">
          <div className="mx-auto max-w-3xl space-y-2">
            {tolakBuka ? (
              <>
                <input value={alasanTolak} onChange={(e) => setAlasanTolak(e.target.value)} maxLength={500} placeholder="Alasan penolakan (wajib, min. 5 karakter) — stok & HPP tidak berubah" aria-label="Alasan penolakan" className={INPUT} data-testid="vp-alasan-tolak" />
                <div className="flex gap-2"><Button variant="secondary" className="min-h-[44px] flex-1" onClick={() => setTolakBuka(false)} disabled={sibuk}>Kembali</Button>
                  <Button className="min-h-[44px] flex-1 bg-red text-white" onClick={tolak} disabled={sibuk || alasanTolak.trim().length < 5} data-testid="vp-kirim-tolak"><XCircle size={16} aria-hidden /> Tolak {dipilih.length}</Button></div>
              </>
            ) : (
              <>
                <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} placeholder="Catatan verifikasi (opsional), mis. dicek fisik di meja" aria-label="Catatan verifikasi" className={INPUT} data-testid="vp-catatan" />
                {kurangIsian.length > 0 && <p className="m-0 text-[12px] text-red" data-testid="vp-kurang-isian">{kurangIsian.length} pengajuan berharga ambigu belum diberi alasan dasar harga — akan DITAHAN, bukan disahkan.</p>}
                <div className="flex gap-2"><Button variant="secondary" className="min-h-[44px] flex-1" onClick={() => setTolakBuka(true)} disabled={sibuk} data-testid="vp-tolak">Tolak…</Button>
                  <Button className="min-h-[44px] flex-[2]" onClick={verifikasi} disabled={sibuk} data-testid="vp-verifikasi"><ShieldCheck size={16} aria-hidden /> {sibuk ? "Memeriksa…" : `Verifikasi ${dipilih.length} pengajuan`}</Button></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KartuPengajuan({ p, boleh, milikSaya, terpilih, onPilih, isian, onIsi }) {
  const [rinci, setRinci] = useState(false); const [riwayat, setRiwayat] = useState(null);
  const r = p.ringkasan || {}; const tahan = alasanTahan(p);
  useEffect(() => { if (rinci && !riwayat) api.riwayatPengajuanPemakaian(p.id).then((d) => setRiwayat(d.events || [])).catch(() => setRiwayat([])); }, [rinci, riwayat, p.id]);
  return (
    <article className={`rounded-card border bg-surface p-3 ${terpilih ? "border-accent ring-1 ring-accent/40" : p.status === "DITAHAN" ? "border-red/40" : "border-line"}`} data-testid="vp-kartu" data-status={p.status}>
      <div className="flex items-start gap-3">
        {boleh && <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={terpilih} disabled={milikSaya} onChange={(e) => onPilih(e.target.checked)} aria-label={`Pilih pengajuan ${p.unitKode}`} data-testid="vp-pilih" />}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-semibold text-ink">{p.orderNomor || "—"} · {p.unitKode}</p>
          <p className="m-0 text-[12px] text-ink3">{p.jalurLabel}{r.pembetulan ? " · pembetulan unit terkirim" : ""}{r.tanggal ? ` · tanggal pemakaian ${r.tanggal}` : ""}</p>
          <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0" data-testid="vp-baris">
            {(r.baris || []).map((b, i) => <li key={i} className="text-[13.5px] text-ink">{teksBaris(b)}</li>)}
            {!(r.baris || []).length && <li className="text-[13px] text-ink2">{r.teks || (r.racikan ? "Racikan saja" : "—")}</li>}
          </ul>
          {(r.alasan || r.catatan) && <p className="m-0 mt-1 text-[12.5px] text-ink2">“{r.alasan || r.catatan}”</p>}
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink3"><Clock3 size={12} aria-hidden />{p.pengaju || "—"} · {waktuSingkat(p.diajukanPada)} · <span className={p.status === "DITAHAN" ? "font-medium text-red" : "text-orange"}>{STATUS_TEKS[p.status]}</span>{p.hargaAmbigu && <span className="font-medium text-orange">· harga berubah pada hari pemakaian</span>}</p>
          {milikSaya && <p className="m-0 mt-1 text-[12px] text-ink2" data-testid="vp-milik-saya">Pengajuan Anda — perlu diverifikasi ADMIN lain.</p>}
          {tahan.length > 0 && <div className="mt-2 rounded-btn bg-redbg px-2.5 py-2 text-[12.5px] text-red" data-testid="vp-alasan-tahan"><p className="m-0 flex items-center gap-1 font-semibold"><ShieldAlert size={13} aria-hidden />Ditahan untuk diperiksa</p><ul className="m-0 mt-0.5 list-disc pl-5">{tahan.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {bedaKeras(p) && <p className="m-0 mt-1.5 text-[12px] text-ink2" data-testid="vp-keras">Perbedaan ini tidak bisa disahkan dengan alasan. Tolak, lalu pengaju mengubah atau mengajukan ulang dengan dasar terbaru.</p>}
          {boleh && !milikSaya && (butuhKonfirmasi(p) || butuhKonfirmasiHarga(p)) && (
            <div className="mt-2 space-y-1.5">
              {butuhKonfirmasi(p) && <input value={isian.konfirmasi || ""} onChange={(e) => onIsi("konfirmasi", e.target.value)} maxLength={300} placeholder="Harga Berlaku berubah — alasan Anda menerima harga baru (wajib)" aria-label={`Konfirmasi pemeriksaan ${p.unitKode}`} className={INPUT} data-testid="vp-konfirmasi" />}
              {butuhKonfirmasiHarga(p) && <input value={isian.konfirmasiHarga || ""} onChange={(e) => onIsi("konfirmasiHarga", e.target.value)} maxLength={300} placeholder="Dasar harga (wajib) — mis. dipakai sore, harga baru berlaku" aria-label={`Dasar harga ${p.unitKode}`} className={INPUT} data-testid="vp-konfirmasi-harga" />}
            </div>
          )}
          <button type="button" className="mt-1.5 flex min-h-[36px] items-center gap-1 text-[12.5px] font-medium text-accent" onClick={() => setRinci((v) => !v)} aria-expanded={rinci} data-testid="vp-rinci"><ChevronDown size={14} className={rinci ? "rotate-180" : ""} aria-hidden />{rinci ? "Sembunyikan rincian" : "Rincian & riwayat"}</button>
          {rinci && (
            <div className="mt-1 space-y-1 rounded-btn bg-inset px-2.5 py-2 text-[12px] text-ink2" data-testid="vp-rincian">
              <p className="m-0">Status unit: {p.statusUnit || "—"} · Peran pengaju: {(p.peranPengaju || []).join(", ") || "—"}</p>
              <p className="m-0">Saat diverifikasi, server memeriksa ulang saldo, satuan, Harga Berlaku, sumber bahan, catatan ganda, dan pengaman SO. Jika berubah sejak diajukan, pengajuan DITAHAN.</p>
              {riwayat === null ? <p className="m-0">Memuat riwayat…</p> : riwayat.map((e) => <p key={e.id} className="m-0">{waktuSingkat(e.createdAt)} · {e.kind}{e.reason ? ` — ${e.reason}` : ""}</p>)}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function HasilPerPengajuan({ hasil, nama, onTutup }) {
  const rows = hasil.hasil || [];
  return (
    <section className="rounded-card border border-line bg-surface p-3" role="status" data-testid="vp-hasil">
      <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-[14px] font-semibold text-ink">{hasil.jenis === "tolak" ? "Hasil penolakan" : `Hasil verifikasi: ${hasil.ringkas?.disetujui ?? 0} disahkan · ${hasil.ringkas?.ditahan ?? 0} ditahan · ${hasil.ringkas?.gagal ?? 0} tidak diproses`}</h3>
        <button type="button" className="min-h-[36px] text-[12.5px] text-accent" onClick={onTutup}>Tutup</button></div>
      <ul className="m-0 mt-2 list-none space-y-1 p-0">
        {rows.map((h) => { const p = nama.get(h.id); return (
          <li key={h.id} className={`rounded-btn px-2.5 py-1.5 text-[12.5px] ${h.status === "DISETUJUI" || h.status === "DITOLAK" ? "bg-greenbg text-green" : h.status === "DITAHAN" ? "bg-orangebg text-ink" : "bg-redbg text-red"}`} data-testid="vp-hasil-baris" data-status={h.status}>
            <b>{p ? `${p.orderNomor || ""} ${p.unitKode}`.trim() : h.id.slice(0, 8)}</b> — {h.status === "DITOLAK" ? "Ditolak (stok & HPP tidak berubah)" : HASIL_TEKS[h.status] || h.status}{h.ulang ? " (sudah disahkan sebelumnya)" : ""}
            {(h.beda || []).length > 0 && <span>: {h.beda.map((b) => b.pesan).join("; ")}</span>}{h.pesan && <span>: {h.pesan}</span>}
          </li>); })}
      </ul>
    </section>
  );
}

function DaftarKoreksi({ koreksi, userId, boleh, onUbah }) {
  const [buka, setBuka] = useState(null); const [catatan, setCatatan] = useState(""); const [sibuk, setSibuk] = useState(false); const [pesan, setPesan] = useState(null);
  async function putuskan(k, setuju) {
    setSibuk(true); setPesan(null);
    try { if (setuju) await api.setujuiKoreksiPemakaian(k.id, { catatan: catatan.trim() || undefined }); else await api.tolakKoreksiPemakaian(k.id, { catatan: catatan.trim() }); setPesan({ ok: true, teks: `${k.nomor} ${setuju ? "disetujui dan diterapkan" : "ditolak (stok tidak berubah)"}.` }); setBuka(null); setCatatan(""); await onUbah(); }
    catch (e) { setPesan({ ok: false, teks: e.message || "Gagal" }); } finally { setSibuk(false); }
  }
  return (
    <div className="space-y-3" data-testid="vp-koreksi">
      <p className="m-0 text-[12.5px] text-ink2">Koreksi pemakaian berpersetujuan: angka lama tetap berlaku sampai disetujui ADMIN lain dari pemohon. ADMIN yang ingin mengoreksi langsung memakai “Ubah jumlah” di tabel pemakaian unit (tercatat dengan alasan).</p>
      {pesan && <p role="status" className={`m-0 rounded-btn px-3 py-2 text-[13px] ${pesan.ok ? "bg-greenbg text-green" : "bg-redbg text-red"}`}>{pesan.teks}</p>}
      {!koreksi.length && <Card><CardContent className="py-8 text-center text-[14px] text-ink2">Tidak ada koreksi pemakaian yang menunggu.</CardContent></Card>}
      {koreksi.map((k) => { const c = k.perubahan || {}; const sendiri = k.pemohon?.id === userId; return (
        <article key={k.id} className="rounded-card border border-line bg-surface p-3" data-testid="vp-koreksi-kartu">
          <p className="m-0 text-[14px] font-semibold text-ink">{k.nomor} · {k.nomorDokumen}</p>
          <p className="m-0 text-[13.5px] text-ink">{c.bahan?.nama || c.bahan?.kode || "Bahan"}: {c.sebelum?.pemakaianBersih ?? "—"} → {c.sesudah?.pemakaianBersih ?? "—"} {c.bahan?.satuan || ""}</p>
          <p className="m-0 text-[12.5px] text-ink2">“{k.alasan}” · {k.pemohon?.name || "—"} · {waktuSingkat(k.diajukanPada)}</p>
          {sendiri && <p className="m-0 mt-1 text-[12px] text-ink2">Koreksi Anda — perlu disetujui ADMIN lain.</p>}
          {boleh && !sendiri && (buka === k.id ? (
            <div className="mt-2 space-y-2">
              <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} placeholder="Catatan keputusan (wajib untuk menolak)" aria-label="Catatan keputusan" className={INPUT} />
              <div className="flex gap-2"><Button variant="secondary" className="min-h-[44px] flex-1" disabled={sibuk || catatan.trim().length < 5} onClick={() => putuskan(k, false)}>Tolak</Button>
                <Button className="min-h-[44px] flex-1" disabled={sibuk} onClick={() => putuskan(k, true)} data-testid="vp-koreksi-setujui">Setujui & terapkan</Button></div>
            </div>
          ) : <Button variant="secondary" size="sm" className="mt-2 min-h-[40px]" onClick={() => { setBuka(k.id); setCatatan(""); }} data-testid="vp-koreksi-putuskan">Periksa & putuskan</Button>)}
        </article>); })}
    </div>
  );
}
