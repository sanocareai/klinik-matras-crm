import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, HandCoins, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { urutKomponen, kalimatSelisih, keSen, LABEL_SUMBER_SALDO } from "@/features/finance/rekonBankLogic.js";

// PANEL REKONSILIASI — saldo buku vs saldo rekening koran (atau hitung fisik untuk Uang Kas), selisihnya, dan PENJELASAN tiap bagian selisih. Semua angka dihitung server.
// Periode hanya bisa SELESAI bila "selisih belum dijelaskan" Rp0, tidak ada exception terbuka, dan snapshot valid. Panel tidak pernah membuat jurnal.

export default function PanelRekon({ rek, sampai, sakelar, onBerubah }) {
  const [panel, setPanel] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [saldoManual, setSaldoManual] = useState("");
  const [tinjau, setTinjau] = useState(null); // { lineId, nomor, catatan, galat }
  const [batalPeriode, setBatalPeriode] = useState(null);
  const [opname, setOpname] = useState({ tanggal: sampai, jumlah: "", catatan: "" });
  const [kerja, setKerja] = useState(false);
  const permintaan = useRef(0);
  const kas = rek.jenis === "KAS" || rek.kind === "KAS";

  const muat = useCallback(async () => {
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const p = await api.getRekonPanel(rek.id, { to: sampai, saldoBankAkhir: saldoManual.trim() ? saldoManual.trim().replace(/\./g, "").replace(",", ".") : undefined });
      if (no === permintaan.current) setPanel(p);
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat rekonsiliasi");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [rek.id, sampai, saldoManual]);
  useEffect(() => { muat(); }, [muat]);
  useEffect(() => { setOpname((o) => ({ ...o, tanggal: sampai })); }, [sampai]);

  async function aksi(fn, sukses) {
    setKerja(true); setGalat(null); setPesan(null);
    try { const r = await fn(); setPesan(sukses(r)); await muat(); onBerubah?.(); return true; }
    catch (e) { setGalat(e.code === "SAKELAR_MATI" ? "Rekonsiliasi Bank V2 belum diaktifkan. Admin/Owner menyalakannya di Finance › Pengaturan." : e.message); return false; }
    finally { setKerja(false); }
  }
  const selesaikan = () => aksi(() => api.selesaikanPeriodeRekon(rek.id, { to: sampai, saldoBankAkhir: saldoManual.trim() ? saldoManual.trim().replace(/\./g, "").replace(",", ".") : undefined }), () => `Periode sampai ${tanggalPendek(sampai)} diselesaikan.`);
  async function simpanTinjau() { if (await aksi(() => api.tinjauExceptionRekening(tinjau.lineId, tinjau.catatan), () => `${tinjau.nomor} ditandai sudah ditinjau.`)) setTinjau(null); }
  async function simpanBatal() { if (await aksi(() => api.batalkanPeriodeRekon(batalPeriode.id, batalPeriode.alasan), () => "Periode dinyatakan tidak berlaku (riwayat tetap).")) setBatalPeriode(null); }
  const simpanOpname = () => aksi(() => api.catatOpnameKas(rek.id, { tanggal: opname.tanggal, jumlah: opname.jumlah.replace(/\./g, "").replace(",", "."), catatan: opname.catatan || undefined }), () => "Hitung fisik kas dicatat.");

  const p = panel;
  const komponen = urutKomponen(p);
  const selisihN = p?.selisih != null ? keSen(p.selisih) : null;
  const belumN = p?.belumDijelaskan != null ? keSen(p.belumDijelaskan) : null;

  return (
    <>
      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p role="alert" className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={() => setGalat(null)}>Tutup</Button></CardContent></Card>}
      {pesan && <Card className="bg-greenbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{pesan}</p><Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button></CardContent></Card>}
      {p && !p.sakelarAktif && (
        <Card className="bg-orangebg"><CardContent className="flex items-start gap-3 py-3 text-[13px] text-ink"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" aria-hidden /><p>Rekonsiliasi Bank V2 belum diaktifkan: panel ini hanya membaca (saldo buku dan exception). Impor rekening koran, pencocokan, dan penyelesaian periode menunggu Admin/Owner menyalakannya di Finance › Pengaturan.</p></CardContent></Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Saldo Buku" metrik="saldo_buku_rekening" value={formatUang(p?.saldoBuku ?? 0)} sub={`per ${tanggalPendek(sampai)}`} info={p?.definisi?.saldoBuku} />
        <KartuAngka
          label={kas ? "Saldo Fisik (opname)" : "Saldo Rekening Koran"} metrik="saldo_bank_rekening" value={p?.saldoBank != null ? formatUang(p.saldoBank) : "Belum diketahui"}
          sub={p?.saldoBank != null ? `${LABEL_SUMBER_SALDO[p.sumberSaldoBank] || ""}${p.tanggalSaldoBank ? ` · per ${tanggalPendek(p.tanggalSaldoBank)}` : ""}` : kas ? "catat hitung fisik di bawah" : "impor rekening koran atau isi manual"}
          info={p?.definisi?.saldoBank}
        />
        <KartuAngka label="Selisih (buku − bank)" metrik="selisih_buku_bank" value={p?.selisih != null ? formatUang(p.selisih) : "—"} tone={selisihN == null ? "default" : selisihN === 0 ? "green" : "red"} sub={kalimatSelisih(p, formatUang)} info={p?.definisi?.selisih} />
        <KartuAngka label="Selisih belum dijelaskan" metrik="selisih_belum_dijelaskan" value={p?.belumDijelaskan != null ? formatUang(p.belumDijelaskan) : "—"} tone={belumN == null ? "default" : belumN === 0 ? "green" : "red"} sub={belumN === 0 ? "semua selisih ada penjelasannya" : belumN == null ? "" : "perlu rekening koran lengkap"} info={p?.definisi?.belumDijelaskan} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {!kas && (
          <Field label="Saldo rekening koran (opsional)" hint="Isi bila berkas impor tidak punya kolom saldo. Mengganti saldo dari berkas.">
            <Input inputMode="decimal" value={saldoManual} onChange={(e) => setSaldoManual(e.target.value)} placeholder="mis. 40.509.998" className="w-[200px]" />
          </Field>
        )}
        <TombolExportExcel
          modul="rekonsiliasi-rekening" disabled={!p}
          label="Export Rekonsiliasi (lengkap)"
          ambilBody={() => ({ periode: { to: sampai }, filter: { cashAccountId: rek.id, saldoBankAkhir: saldoManual.trim() ? saldoManual.trim().replace(/\./g, "").replace(",", ".") : undefined }, filterLabel: labelFilterAktif([["Rekening", rek.name], ["Sampai", sampai]]) })}
        />
      </div>

      {!kas && p && (
        <Card className="overflow-hidden">
          <JudulKartu title="Penjelasan selisih" description="Selisih buku − bank diurai menjadi bagian-bagian yang bisa ditelusuri. Total bagian + selisih belum dijelaskan = selisih." />
          <CardContent className="space-y-2 pb-4">
            {!p.adaDataBank && <Penjelasan>Belum ada rekening koran yang diimpor, jadi selisih belum bisa diurai transaksi per transaksi. Impor mutasi bank di tab Mutasi Rekening.</Penjelasan>}
            <ul className="list-none p-0 space-y-1.5" data-testid="komponen-selisih">
              {komponen.map((k) => (
                <li key={k.kunci} className="grid grid-cols-[1fr_auto] items-start gap-x-3 rounded-lg bg-inset px-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{k.label}</span>{k.jumlah != null && k.jumlah > 0 && <span className="ml-2 text-ink3">{k.jumlah} baris</span>}
                    {k.definisi && <span className="block text-[12px] leading-snug text-ink3">{k.definisi}</span>}
                  </span>
                  <Uang value={k.efek ?? "0"} className={`font-semibold ${keSen(k.efek) === 0 ? "text-ink3" : ""}`} />
                </li>
              ))}
              <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-3 py-2 text-[13px] font-semibold ring-1 ring-line">
                <span>Selisih belum dijelaskan</span><Uang value={p.belumDijelaskan ?? "0"} className={belumN === 0 ? "text-green" : "text-red"} />
              </li>
            </ul>

            {p.komponen.bankBelumDibukukan.jumlah > 0 && (
              <DaftarBaris judul="Transaksi di bank yang belum ada di buku" baris={p.komponen.bankBelumDibukukan.baris} sisi="bank" total={p.komponen.bankBelumDibukukan.efek} />
            )}
            {p.komponen.bukuBelumMuncul.jumlah > 0 && <DaftarBaris judul="Tercatat di buku, belum muncul di bank" baris={p.komponen.bukuBelumMuncul.baris} sisi="buku" total={p.komponen.bukuBelumMuncul.efek} />}
            {p.komponen.perbedaanCutoff.jumlah > 0 && <DaftarBaris judul="Perbedaan cutoff (setelah data bank terakhir)" baris={p.komponen.perbedaanCutoff.baris} sisi="buku" total={p.komponen.perbedaanCutoff.efek} />}
          </CardContent>
        </Card>
      )}

      {p?.skenarioJurnalTanpaRekening?.length > 0 && (
        <Card className="bg-orangebg">
          <CardContent className="space-y-2 py-3 text-[13px] text-ink">
            <p className="flex items-center gap-2 font-semibold"><Eye size={15} /> Skenario (belum ditautkan ke rekening mana pun)</p>
            {p.skenarioJurnalTanpaRekening.map((s) => (
              <p key={s.nomor}>
                Jurnal <strong>{s.nomor}</strong> ({s.keterangan}, {formatUang(s.nilai)}) tidak menyebut rekening. <em>Bila</em> terbukti milik rekening ini, saldo buku menjadi {formatUang(s.jikaMilikRekeningIni.saldoBuku)}
                {s.jikaMilikRekeningIni.selisihBukuMinusBank != null && <> dan selisih menjadi <strong>{formatUang(s.jikaMilikRekeningIni.selisihBukuMinusBank)}</strong></>}. Sistem tidak menebak — rekeningnya dilengkapi lewat jurnal koreksi (balik + pengganti).
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {p && (
        <Card className="overflow-hidden">
          <JudulKartu title="Exception" description="Hal yang harus beres (atau ditinjau dengan catatan) sebelum periode bisa diselesaikan." />
          <CardContent className="space-y-2 pb-4">
            {p.exception.length === 0 ? <p className="flex items-center gap-2 py-3 text-[13px] text-green"><CheckCircle2 size={15} /> Tidak ada exception.</p> : p.exception.map((e, i) => (
              <div key={`${e.kode}-${e.ref}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid={`exception-${e.kode}`}>
                <span className="min-w-0 flex-1"><Badge variant={e.terbuka ? "red" : "neutral"} className="mr-2 normal-case">{e.terbuka ? "Terbuka" : "Ditinjau"}</Badge>{e.pesan}</span>
                {e.kode === "JURNAL_TANPA_REKENING" && e.terbuka && <Button size="sm" variant="neutral" disabled={!sakelar} onClick={() => setTinjau({ lineId: e.ref, nomor: e.nomor, catatan: "" })}>Tandai ditinjau</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {kas && p && (
        <Card className="overflow-hidden">
          <JudulKartu title="Hitung fisik kas (opname)" description="Uang Kas tidak punya rekening koran. Hitung uang tunai di tangan, catat di sini. Catatan tidak bisa diubah." />
          <CardContent className="space-y-3 pb-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[170px_200px_1fr_auto] sm:items-end">
              <Field label="Tanggal hitung"><Input type="date" value={opname.tanggal} onChange={(e) => setOpname((o) => ({ ...o, tanggal: e.target.value }))} /></Field>
              <Field label="Jumlah uang fisik (Rp)"><Input inputMode="decimal" value={opname.jumlah} onChange={(e) => setOpname((o) => ({ ...o, jumlah: e.target.value }))} placeholder="mis. 480.000" /></Field>
              <Field label="Catatan (opsional)"><Input value={opname.catatan} onChange={(e) => setOpname((o) => ({ ...o, catatan: e.target.value }))} /></Field>
              <Button size="sm" onClick={simpanOpname} disabled={!sakelar || kerja || !opname.jumlah.trim()}><HandCoins size={14} /> Catat</Button>
            </div>
            {p.riwayatOpname?.length > 0 && (
              <ul className="list-none p-0 space-y-1" data-testid="riwayat-opname">
                {p.riwayatOpname.map((o) => <li key={o.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-inset px-3 py-1.5 text-[12.5px]"><span>{tanggalPendek(o.tanggal)} · {o.oleh || "—"}{o.catatan ? ` · ${o.catatan}` : ""}</span><strong className="tabular-nums">{formatUang(o.jumlah)}</strong></li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {p && (
        <Card className="overflow-hidden">
          <JudulKartu title="Penyelesaian periode" description="Periode yang selesai terkunci: pencocokan dan impor yang dipakainya tidak bisa diubah kecuali periodenya dibatalkan (dengan alasan)." />
          <CardContent className="space-y-3 pb-4">
            <ul className="list-none p-0 space-y-1.5" data-testid="syarat-periode">
              {p.syarat.map((s) => (
                <li key={s.kode} className="flex items-start gap-2 text-[13px]">
                  {s.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green" aria-hidden /> : <XCircle size={15} className="mt-0.5 shrink-0 text-red" aria-hidden />}
                  <span className={s.ok ? "text-ink2" : "text-ink"}>{s.teks}</span>
                </li>
              ))}
            </ul>
            <Button size="sm" onClick={selesaikan} disabled={!sakelar || kerja || !p.bisaSelesai}><ShieldCheck size={14} /> Selesaikan periode sampai {tanggalPendek(sampai)}</Button>
            {p.periode.length > 0 && (
              <ul className="list-none p-0 space-y-1.5" data-testid="daftar-periode">
                {p.periode.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1">
                      <Badge variant={r.berlaku ? "green" : "neutral"} className="mr-2 normal-case">{r.berlaku ? "Berlaku" : r.dibatalkan ? "Dibatalkan" : "Snapshot rusak"}</Badge>
                      s/d {tanggalPendek(r.sampai)} · buku {formatUang(r.saldoBuku)} · {r.sumber === "OPNAME_FISIK" ? "fisik" : "bank"} {formatUang(r.saldoBank)} · {r.diselesaikanOleh?.name || "—"} · {tanggalJam(r.diselesaikanPada)}
                      {r.snapshotRusak && <span className="block text-orange">Jurnal berubah setelah periode selesai — snapshot tidak berlaku lagi.</span>}
                      {r.alasanBatal && <span className="block text-ink3">Alasan batal: {r.alasanBatal}</span>}
                    </span>
                    {!r.dibatalkan && <Button size="sm" variant="neutral" disabled={!sakelar} onClick={() => setBatalPeriode({ id: r.id, alasan: "" })}>Batalkan periode</Button>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {memuat && !p && <p className="py-6 text-center text-[13px] text-ink3">Memuat…</p>}

      <Modal
        open={!!tinjau} onOpenChange={(v) => !v && setTinjau(null)} title={`Tandai ${tinjau?.nomor ?? ""} sudah ditinjau`} description="Tidak mengubah jurnal. Hanya mencabut statusnya sebagai penghalang periode; tetap tampil sebagai ditinjau."
        footer={<><Button size="sm" variant="neutral" onClick={() => setTinjau(null)}>Kembali</Button><Button size="sm" onClick={simpanTinjau} disabled={(tinjau?.catatan || "").trim().length < 10}>Simpan tinjauan</Button></>}
      >
        {tinjau && <Field label="Catatan tinjauan" required hint="Minimal 10 karakter. Jelaskan temuan/keputusan."><Input value={tinjau.catatan} onChange={(e) => setTinjau((t) => ({ ...t, catatan: e.target.value }))} /></Field>}
      </Modal>
      <Modal
        open={!!batalPeriode} onOpenChange={(v) => !v && setBatalPeriode(null)} title="Batalkan periode rekonsiliasi" description="Periode dinyatakan tidak berlaku; riwayat tetap tersimpan dan pencocokan bisa diubah lagi."
        footer={<><Button size="sm" variant="neutral" onClick={() => setBatalPeriode(null)}>Kembali</Button><Button size="sm" onClick={simpanBatal} disabled={(batalPeriode?.alasan || "").trim().length < 10}>Batalkan periode</Button></>}
      >
        {batalPeriode && <Field label="Alasan" required hint="Minimal 10 karakter."><Input value={batalPeriode.alasan} onChange={(e) => setBatalPeriode((t) => ({ ...t, alasan: e.target.value }))} /></Field>}
      </Modal>
    </>
  );
}

function DaftarBaris({ judul, baris, sisi, total }) {
  return (
    <div className="rounded-lg ring-1 ring-line">
      <p className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] font-semibold text-ink"><span>{judul}</span><Uang value={total} className="tabular-nums" /></p>
      <ul className="list-none p-0 divide-y divide-line">
        {baris.slice(0, 50).map((b) => (
          <li key={b.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-3 py-1.5 text-[12.5px]">
            <span className="whitespace-nowrap text-ink3">{tanggalPendek(b.tanggalBuku ?? b.tanggal)}</span>
            <span className="min-w-0 truncate text-ink">{b.deskripsi}{sisi === "buku" && b.nomor ? <span className="ml-2 font-mono text-ink3">{b.nomor}</span> : null}</span>
            <span className={`whitespace-nowrap tabular-nums ${b.masuk ? "text-green" : "text-orange"}`}>{b.masuk ? `+${formatUang(b.masuk)}` : `−${formatUang(b.keluar)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
