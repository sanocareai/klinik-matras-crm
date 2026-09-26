import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, KartuAngka, JudulKartu, TombolAksi, Penjelasan, Pilihan, Uang, formatUang, tanggalJam,
} from "@/features/finance/shared.jsx";
import { usePinStepUp, perluPin, lupakanStepUp } from "@/features/finance/KoreksiAman.jsx";
import {
  CATATAN_PERIODIK, JUDUL_KOLOM, bacaTempelan, LABEL_STATUS_SNAPSHOT, tanggalIndonesia, tindakanTersedia, ringkasPenyesuaian,
} from "@/features/finance/persediaanAwalLogika.js";

// TUTUP STOK PERIODIK & MULAI PERPETUAL (B3.6). Alur: isi snapshot stok fisik akhir hari sebelum cutover → diperiksa Finance
// dan Gudang (orang berbeda) → pratinjau jurnal → Owner memposting sekali dengan PIN + alasan. Semua aturan ditegakkan server.

const angka = (v) => Number(v || 0).toLocaleString("id-ID", { maximumFractionDigits: 4 });

export default function FinancePersediaanAwal() {
  const [data, setData] = useState(null);
  const [laporan, setLaporan] = useState(null);
  const [kesiapan, setKesiapan] = useState(null);
  const [pilih, setPilih] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pratinjau, setPratinjau] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const { minta, dialogPin } = usePinStepUp();

  const muat = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, l, ks] = await Promise.all([api.getPersediaanAwal(), api.getPersediaanAwalPengecualian(), api.getPersediaanAwalKesiapan().catch(() => null)]);
      setData(d); setLaporan(l); setKesiapan(ks);
      const aktif = d.snapshot.find((s) => ["DRAFT", "DIPERIKSA", "DIPOSTING"].includes(s.status));
      setPilih((p) => p || aktif?.id || null);
    } catch (e) { setError(e.message || "Gagal memuat"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const muatDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); setPratinjau(null); return; }
    try {
      const [d, p] = await Promise.all([api.getPersediaanAwalDetail(id), api.getPersediaanAwalPratinjau(id)]);
      setDetail(d); setPratinjau(p);
    } catch (e) { setPesan({ jenis: "galat", teks: e.message }); }
  }, []);
  useEffect(() => { muatDetail(pilih); }, [pilih, muatDetail]);

  async function aksi(fn, sukses) {
    setPesan(null);
    try {
      const r = await fn();
      if (sukses) setPesan({ jenis: "ok", teks: sukses });
      await muat(); await muatDetail(pilih || r?.id);
      return r;
    } catch (e) {
      setPesan({ jenis: "galat", teks: e.message, detail: e.detail });
      return null;
    }
  }

  async function denganPin(fn) {
    for (let i = 0; i < 2; i++) {
      const token = await minta();
      if (!token) return null;
      try { return await fn(token); } catch (e) { if (perluPin(e) && i === 0) { lupakanStepUp(); continue; } throw e; }
    }
    return null;
  }

  const k = data?.kebijakan;
  const snap = detail?.snapshot;
  const t = tindakanTersedia(snap, data?.bisa);
  const bisaBuat = data?.bisa?.tulis && !data?.snapshot.some((s) => ["DRAFT", "DIPERIKSA", "DIPOSTING"].includes(s.status));

  return (
    <HalamanFinance
      title="Tutup Stok & Persediaan Awal"
      subtitle="Stok opname akhir metode periodik menjadi persediaan awal metode perpetual."
      loading={loading} error={error} onRetry={muat}
      actions={bisaBuat ? (
        <TombolAksi onClick={() => aksi(async () => { const r = await api.createPersediaanAwal({}); setPilih(r.id); return r; }, "Draf snapshot dibuat.")}>
          <Plus size={14} /> Buat snapshot stok
        </TombolAksi>
      ) : null}
    >
      {k && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KartuAngka label="Sebelum cutover" value="Periodik" sub={`s.d. ${tanggalIndonesia(k.tanggalHitung)}`} info={CATATAN_PERIODIK} />
            <KartuAngka label="Mulai perpetual" value={tanggalIndonesia(k.cutover)} sub="Lewat penerimaan & pengeluaran Gudang" />
            <KartuAngka label="Waktu hitung fisik" value={tanggalIndonesia(k.tanggalHitung)} sub="pukul 23:59 WIB" />
            <KartuAngka label="Tanggal cutover" value={k.terkunci ? "Terkunci" : "Belum terkunci"} tone={k.terkunci ? "green" : "orange"}
              sub={k.terkunci ? `Persediaan awal ${k.pembukaAktif?.number}` : "Terkunci setelah persediaan awal diposting"} />
          </div>
          <Penjelasan>
            <strong>{CATATAN_PERIODIK}</strong> Setelah persediaan awal diposting: penerimaan Gudang <strong>Dr 1-1400 / Cr 2-1150</strong>,
            bahan keluar <strong>Dr 5-1100 / Cr 1-1400</strong>, tagihan supplier <strong>Dr 2-1150 ± selisih / Cr 2-1100</strong>.
            Harga per unit diisi dari faktur/tagihan — harga referensi master hanya pembanding.
          </Penjelasan>
        </>
      )}

      {pesan && (
        <div className={pesan.jenis === "ok" ? "rounded-xl bg-greenbg px-4 py-3 text-[13px] text-green" : "rounded-xl bg-redbg px-4 py-3 text-[13px] text-red"} role="status">
          {pesan.teks}
          {Array.isArray(pesan.detail) && pesan.detail.length > 0 && (
            <ul className="mt-1 list-disc pl-5">{pesan.detail.slice(0, 20).map((d, i) => <li key={i}>{d.pesan}</li>)}</ul>
          )}
        </div>
      )}

      {kesiapan && <KartuKesiapan ks={kesiapan} />}

      {laporan && <LaporanPengecualian l={laporan} />}

      {data?.snapshot?.length > 0 && (
        <Card>
          <JudulKartu title="Snapshot stok" description="Satu snapshot aktif per tanggal cutover. Snapshot yang dibalik/dibatalkan tetap tersimpan untuk audit." />
          <CardContent className="flex flex-wrap gap-2">
            {data.snapshot.map((s) => {
              const [lbl, nada] = LABEL_STATUS_SNAPSHOT[s.status] || [s.status, "neutral"];
              return (
                <button key={s.id} type="button" onClick={() => setPilih(s.id)}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-left text-[13px] ${pilih === s.id ? "border-accent bg-accentbg" : "border-line bg-surface"}`}>
                  <span className="font-mono text-[12px]">{s.number}</span> <Badge variant={nada}>{lbl}</Badge>
                  <span className="block text-[11px] text-ink3">cutover {tanggalIndonesia(s.cutover)}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {snap && (
        <DetailSnapshot
          detail={detail} pratinjau={pratinjau} tindakan={t}
          onIsi={(baris, mode) => aksi(() => api.isiPersediaanAwal(snap.id, baris, mode), "Baris snapshot disimpan.")}
          onHapus={(lineId) => aksi(() => api.hapusBarisPersediaanAwal(snap.id, lineId))}
          onPeriksa={(peran) => aksi(() => api.periksaPersediaanAwal(snap.id, peran), `Pemeriksaan ${peran === "FINANCE" ? "Finance" : "Gudang"} tercatat.`)}
          onBukaKembali={() => aksi(() => api.bukaKembaliPersediaanAwal(snap.id), "Snapshot dibuka kembali — pemeriksaan dikosongkan.")}
          onBatal={() => aksi(() => api.batalPersediaanAwal(snap.id), "Draf dibatalkan.")}
          onPosting={(alasan) => aksi(() => denganPin((tok) => api.postingPersediaanAwal(snap.id, alasan, tok)), "Persediaan awal diposting. Tanggal cutover kini terkunci.")}
          onBalik={(alasan) => aksi(() => denganPin((tok) => api.balikPersediaanAwal(snap.id, alasan, tok)), "Jurnal persediaan awal dibalik.")}
        />
      )}
      {dialogPin}
    </HalamanFinance>
  );
}

function KartuKesiapan({ ks }) {
  const go = ks.keputusan === "GO";
  return (
    <Card data-testid="kesiapan">
      <JudulKartu title="Kesiapan cutover" description={`Gate ${ks.gateLabel || "—"} — semua syarat harus terpenuhi (GO); jika tidak, NO-GO.`} />
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={go ? "success" : "danger"} data-testid="keputusan">{go ? "GO" : "NO-GO"}</Badge>
          <span className="text-[12.5px] text-ink2">{go ? "Semua syarat terpenuhi." : `${ks.sisaSyarat} syarat belum terpenuhi.`}</span>
        </div>
        <ul className="space-y-1.5 text-[13px]">
          {ks.syarat.map((s) => (
            <li key={s.kode} className="flex items-start gap-2">
              <span className={s.ok ? "text-green" : "text-red"} aria-hidden>{s.ok ? "✓" : "✗"}</span>
              <span className="min-w-0"><span className="font-medium text-ink">{s.label}</span><span className="block text-[12px] text-ink3">{s.detail}</span></span>
            </li>
          ))}
        </ul>
        {ks.snapshot?.adaSnapshot && (
          <p className="text-[12px] text-ink3">Material fisik positif {ks.snapshot.materialFisikPositif} · qty 0 {ks.snapshot.materialQtyNol} (tercatat, tidak masuk jurnal) · nilai anomali {formatUang(Number(ks.snapshot.anomali.nilai))}</p>
        )}
        {ks.rekomendasi && <p className="rounded-xl bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="rekomendasi-cutover">{ks.rekomendasi.pesan}</p>}
      </CardContent>
    </Card>
  );
}

function LaporanPengecualian({ l }) {
  const kartu = [
    { label: "Stok sistem negatif", value: l.stokNegatif.jumlah, sub: `nilai referensi ${formatUang(Number(l.stokNegatif.nilaiReferensi))}`, tone: l.stokNegatif.jumlah ? "red" : "default", daftar: l.stokNegatif.daftar },
    { label: "Harga referensi tidak wajar", value: l.hargaReferensiAnomali.jumlah, sub: "Jangan dipakai sebagai harga opname", tone: l.hargaReferensiAnomali.jumlah ? "orange" : "default", daftar: l.hargaReferensiAnomali.daftar },
    { label: "Stok tanpa harga valid", value: l.tanpaHargaValid.jumlah, sub: "Perlu harga dari faktur/tagihan", tone: l.tanpaHargaValid.jumlah ? "orange" : "default", daftar: l.tanpaHargaValid.daftar },
    { label: "Pemakaian belum tercatat", value: l.pemakaianBelumLengkap ? `${l.pemakaianBelumLengkap.jumlahHari ?? "—"} hari` : "Lengkap", sub: l.pemakaianBelumLengkap ? `sejak ${tanggalIndonesia(l.pemakaianBelumLengkap.belumTercatatDari)}` : "s.d. hari sebelum cutover", tone: l.pemakaianBelumLengkap ? "orange" : "green" },
  ];
  return (
    <Card>
      <JudulKartu title="Laporan pengecualian" description="Masalah data Gudang menjelang cutover. Tidak mengubah data — stok opname fisik yang menentukan persediaan awal."
        info={l.catatan} />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kartu.map((x) => <KartuAngka key={x.label} label={x.label} value={x.value} sub={x.sub} tone={x.tone} />)}
        </div>
        {l.pemakaianBelumLengkap && <p className="text-[12.5px] text-orange">{l.pemakaianBelumLengkap.pesan}</p>}
        {kartu.filter((x) => x.daftar?.length).map((x) => (
          <details key={x.label} className="rounded-xl bg-inset px-3 py-2 text-[12.5px]">
            <summary className="cursor-pointer font-medium text-ink">{x.label} ({x.daftar.length})</summary>
            <ul className="mt-2 space-y-1">
              {x.daftar.slice(0, 50).map((m) => (
                <li key={m.kode} className="flex flex-wrap justify-between gap-x-3 border-b border-line pb-1 last:border-0">
                  <span className="min-w-0"><span className="font-mono text-[11.5px]">{m.kode}</span> · {m.nama}</span>
                  <span className="tabular-nums text-ink2">{m.qtySistem != null ? `${angka(m.qtySistem)} ${m.satuan}` : ""}{m.nilaiReferensi ? ` · ref ${formatUang(Number(m.nilaiReferensi))}` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function DetailSnapshot({ detail, pratinjau, tindakan, onIsi, onHapus, onPeriksa, onBukaKembali, onBatal, onPosting, onBalik }) {
  const s = detail.snapshot;
  const v = detail.validasi;
  const [tempel, setTempel] = useState("");
  const [mode, setMode] = useState("ganti");
  const [alasan, setAlasan] = useState("");
  const baris = useMemo(() => bacaTempelan(tempel), [tempel]);
  const galatTempel = baris.find((b) => b.galatTempel)?.galatTempel;
  const [lbl, nada] = LABEL_STATUS_SNAPSHOT[s.status] || [s.status, "neutral"];
  const total = Number(s.totalValue ?? v.ringkasan.totalNilai);

  return (
    <>
      <Card>
        <JudulKartu title={`Snapshot ${s.number}`} description={`Stok fisik per ${tanggalIndonesia(pratinjau?.tanggalJurnal)} 23:59 WIB untuk cutover ${tanggalIndonesia(s.cutover)}.`} />
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KartuAngka label="Status" value={<Badge variant={nada}>{lbl}</Badge>} sub={s.contentHash ? `hash ${s.contentHash.slice(0, 12)}…` : "isi belum dikunci"} />
            <KartuAngka label="Nilai stok fisik" value={formatUang(total)} sub={`${v.ringkasan.jumlahBaris} material`} />
            <KartuAngka label="Pemeriksa Finance" value={s.pemeriksaFinance || "Belum"} sub={s.financeCheckedAt ? tanggalJam(s.financeCheckedAt) : "—"} tone={s.pemeriksaFinance ? "green" : "orange"} />
            <KartuAngka label="Pemeriksa Gudang" value={s.pemeriksaGudang || "Belum"} sub={s.warehouseCheckedAt ? tanggalJam(s.warehouseCheckedAt) : "—"} tone={s.pemeriksaGudang ? "green" : "orange"} />
          </div>
          <p className="text-[12px] text-ink3">Pencatat: {s.pencatat || "—"} · dibuat {tanggalJam(s.createdAt)}
            {s.diposting && <> · diposting {s.diposting} {tanggalJam(s.postedAt)} ({s.jurnal?.entryNumber || "tanpa jurnal"})</>}
            {s.dibalik && <> · dibalik {s.dibalik} {tanggalJam(s.reversedAt)}</>}</p>

          {v.blocker.length > 0 && (
            <div className="rounded-xl bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="blocker">
              <p className="font-semibold">{v.blocker.length} masalah memblokir pemeriksaan & posting</p>
              <ul className="mt-1 list-disc pl-5">{v.blocker.slice(0, 30).map((b, i) => <li key={i}>{b.pesan}</li>)}</ul>
            </div>
          )}
          {v.peringatan.length > 0 && (
            <div className="rounded-xl bg-orangebg px-3 py-2 text-[12.5px] text-orange">
              <ul className="list-disc pl-5">{v.peringatan.slice(0, 20).map((b, i) => <li key={i}>{b.pesan}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {tindakan.includes("periksaFinance") && <TombolAksi variant="secondary" disabled={v.blocker.length > 0} onClick={() => onPeriksa("FINANCE")}><ClipboardCheck size={14} /> Periksa sebagai Finance</TombolAksi>}
            {tindakan.includes("periksaGudang") && <TombolAksi variant="secondary" disabled={v.blocker.length > 0} onClick={() => onPeriksa("GUDANG")}><ClipboardCheck size={14} /> Periksa sebagai Gudang</TombolAksi>}
            {tindakan.includes("bukaKembali") && <TombolAksi variant="neutral" confirmText="Buka kembali snapshot? Kedua pemeriksaan akan dikosongkan." onClick={onBukaKembali}>Buka kembali</TombolAksi>}
            {tindakan.includes("batal") && <TombolAksi variant="ghost" confirmText="Batalkan draf ini? Draf tetap tersimpan sebagai Dibatalkan." onClick={onBatal}>Batalkan draf</TombolAksi>}
          </div>
        </CardContent>
      </Card>

      {tindakan.includes("isi") && (
        <Card>
          <JudulKartu title="Isi stok fisik" description="Salin dari spreadsheet lalu tempel. Satu material satu baris. Kuantitas negatif dan kode ganda ditolak. Qty 0 boleh tanpa harga dan sumber harga (tercatat sebagai hasil hitung, tidak masuk jurnal); qty di atas 0 wajib harga dan dokumen sumbernya." />
          <CardContent className="space-y-3">
            <p className="text-[12px] text-ink3">Urutan kolom: {JUDUL_KOLOM.join(" · ")}. Sumber harga: FAKTUR, TAGIHAN, PEMBELIAN, atau LAINNYA (wajib keterangan).</p>
            <textarea value={tempel} onChange={(e) => setTempel(e.target.value)} rows={6} aria-label="Tempel baris stok"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12px]" placeholder={"BUSA-A\t10\tSHEET\t10000\tFAKTUR\tINV-001"} />
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Cara simpan">
                <Pilihan value={mode} onChange={setMode}><option value="ganti">Ganti semua baris</option><option value="tambah">Tambahkan ke baris yang ada</option></Pilihan>
              </Field>
              <TombolAksi disabled={baris.length === 0 || !!galatTempel} onClick={async () => { const r = await onIsi(baris, mode); if (r) setTempel(""); }}>
                Simpan {baris.length} baris
              </TombolAksi>
            </div>
            {galatTempel && <p className="text-[12.5px] text-red">{galatTempel}</p>}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <JudulKartu title="Baris stok fisik" description="Qty sistem & harga referensi hanya pembanding — tidak dipakai untuk nilai." />
        {detail.baris.length === 0 ? (
          <CardContent><p className="py-4 text-center text-[13px] text-ink3">Belum ada baris.</p></CardContent>
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap className="dh-table">
                <Table fixed>
                  <THead><TR>
                    <TH>Material</TH><TH numeric width={96}>Qty fisik</TH><TH width={72}>Satuan</TH><TH numeric width={112}>Harga/unit</TH>
                    <TH numeric width={124}>Nilai</TH><TH width={170}>Sumber harga</TH><TH numeric width={96}>Qty sistem</TH><TH numeric width={104}>Harga ref.</TH>
                    {tindakan.includes("isi") && <TH width={48} />}
                  </TR></THead>
                  <TBody>
                    {detail.baris.map((b) => (
                      <TR key={b.id}>
                        <TD><span className="block truncate" title={`${b.kode} — ${b.nama}`}><span className="font-mono text-[11.5px]">{b.kode}</span> · {b.nama}</span></TD>
                        <TD numeric>{angka(b.qty)}</TD>
                        <TD className={b.satuan !== b.satuanMaterial ? "text-red" : ""}>{b.satuan}</TD>
                        <TD numeric><Uang value={Number(b.harga)} /></TD>
                        <TD numeric><Uang value={Number(b.nilai)} className="font-semibold" /></TD>
                        <TD><span className="block truncate" title={[b.sumberLabel, b.referensi, b.penjelasanHarga].filter(Boolean).join(" · ")}>{b.sumberLabel}{b.referensi ? ` · ${b.referensi}` : ""}</span></TD>
                        <TD numeric className={Number(b.qtySistem) !== Number(b.qty) ? "text-orange" : "text-ink3"}>{angka(b.qtySistem)}</TD>
                        <TD numeric className="text-ink3">{b.hargaReferensi != null ? <Uang value={b.hargaReferensi} /> : "—"}</TD>
                        {tindakan.includes("isi") && <TD><TombolAksi size="icon" variant="ghost" aria-label={`Hapus ${b.kode}`} onClick={() => onHapus(b.id)}><Trash2 size={14} /></TombolAksi></TD>}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
            <div className="space-y-2 p-3 md:hidden">
              {detail.baris.map((b) => (
                <div key={b.id} className="rounded-xl border border-line bg-surface p-3 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block font-mono text-[11.5px] text-ink3">{b.kode}</span><span className="block break-words">{b.nama}</span></span>
                    <Uang value={Number(b.nilai)} className="shrink-0 font-semibold" />
                  </div>
                  <p className="mt-1 text-[12px] text-ink2">{angka(b.qty)} {b.satuan} × {formatUang(Number(b.harga))} · sistem {angka(b.qtySistem)}</p>
                  <p className="text-[12px] text-ink3 break-words">{b.sumberLabel}{b.referensi ? ` · ${b.referensi}` : ""}</p>
                  {tindakan.includes("isi") && <TombolAksi variant="ghost" className="mt-1" onClick={() => onHapus(b.id)}><Trash2 size={14} /> Hapus</TombolAksi>}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {pratinjau && (
        <Card>
          <JudulKartu title="Pratinjau jurnal persediaan awal" description="Pratinjau saja — belum ada jurnal yang dibuat sampai Owner memposting." />
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KartuAngka label="Nilai stok fisik" value={formatUang(Number(pratinjau.nilaiStokFisik))} />
              <KartuAngka label="Saldo 1-1400 buku" value={formatUang(Number(pratinjau.saldoBukuSebelum))} sub={`s.d. ${tanggalIndonesia(pratinjau.tanggalJurnal)}`} />
              <KartuAngka label="Penyesuaian" value={formatUang(Number(pratinjau.penyesuaian))} tone={Number(pratinjau.penyesuaian) < 0 ? "red" : "default"} />
              <KartuAngka label="Saldo 1-1400 sesudah" value={formatUang(Number(pratinjau.saldoSesudah))} tone="green" />
            </div>
            <p className="text-[12.5px] text-ink2">{ringkasPenyesuaian(pratinjau)}</p>
            {pratinjau.baris.length > 0 && (
              <TableWrap><Table>
                <THead><TR><TH>Akun</TH><TH numeric>Debit</TH><TH numeric>Kredit</TH></TR></THead>
                <TBody>
                  {pratinjau.baris.map((b, i) => (
                    <TR key={i}>
                      <TD><span className="font-mono text-[12px]">{b.akun?.kode}</span> {b.akun?.nama}<span className="block text-[11px] text-ink3">{b.keterangan}</span></TD>
                      <TD numeric>{Number(b.debit) ? <Uang value={Number(b.debit)} /> : "—"}</TD>
                      <TD numeric>{Number(b.kredit) ? <Uang value={Number(b.kredit)} /> : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table></TableWrap>
            )}
            <p className={pratinjau.seimbang ? "text-[12.5px] text-green" : "text-[12.5px] text-red"}>
              {pratinjau.seimbang ? "Seimbang" : "Tidak seimbang"} · Debit {formatUang(Number(pratinjau.totalDebit))} = Kredit {formatUang(Number(pratinjau.totalKredit))} · tanggal jurnal {tanggalIndonesia(pratinjau.tanggalJurnal)}
            </p>

            {(tindakan.includes("posting") || tindakan.includes("balik")) && (
              <div className="space-y-2 rounded-xl bg-inset p-3">
                <Field label={tindakan.includes("posting") ? "Alasan posting (wajib)" : "Alasan pembalikan (wajib)"} required>
                  <textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px]" />
                </Field>
                {tindakan.includes("posting") && (
                  <TombolAksi disabled={!alasan.trim()} confirmText={`Posting persediaan awal ${formatUang(Number(pratinjau.saldoSesudah))}? Jurnal hanya dibuat sekali dan tanggal cutover akan terkunci.`}
                    onClick={() => onPosting(alasan.trim())}><Lock size={14} /> Posting persediaan awal (PIN Owner)</TombolAksi>
                )}
                {tindakan.includes("balik") && (
                  <TombolAksi variant="destructive" disabled={!alasan.trim()} confirmText="Balik jurnal persediaan awal? Saldo Persediaan Bahan Baku berkurang dan tanggal cutover tidak lagi terkunci."
                    onClick={() => onBalik(alasan.trim())}>Balik jurnal persediaan awal (PIN Owner)</TombolAksi>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
