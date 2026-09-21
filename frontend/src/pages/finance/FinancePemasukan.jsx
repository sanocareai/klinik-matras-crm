import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
const PERINGATAN_PENDAPATAN_2026 = "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.";
import { HalamanFinance, KartuAngka, JudulKartu, Penjelasan, PeriodePicker, periodeDefault, tanggalPendek } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";

// PEMASUKAN TERPADU — agregator (READ-MODEL). Semua angka & klasifikasi dihitung SERVER; halaman ini hanya menata. Tidak ada tombol "buat pemasukan umum":
// pencatatan baru hanya lewat Pemasukan Lain (validasi akun di server). Uang dari server berupa STRING desimal → diformat tanpa float.

/** "-1234567.50" → "(Rp1.234.567,50)" tanpa mengubah ke Number (aman untuk nominal besar). */
export function teksRp(s, { sen = true } = {}) {
  if (s === null || s === undefined || s === "") return "—";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s));
  if (!m) return String(s);
  const [, neg, bulat, des = "00"] = m;
  const grup = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const teks = `Rp${grup}${sen && /[1-9]/.test(des) ? `,${des.padEnd(2, "0").slice(0, 2)}` : ""}`;
  return neg ? `(${teks})` : teks;
}
const Rp = ({ v }) => <span className={`tabular-nums ${String(v).startsWith("-") ? "text-red" : ""}`}>{teksRp(v)}</span>;

const TAB = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "pendapatan", label: "Pendapatan Penjualan", kategori: "PENDAPATAN" },
  { id: "pembayaran", label: "Pembayaran Masuk", kategori: "PEMBAYARAN" },
  { id: "lain", label: "Pemasukan Lain", kategori: "LAIN" },
  { id: "dana", label: "Dana Masuk Bukan Pendapatan", kategori: "DANA" },
  { id: "historis", label: "Data Sebelum Sistem", kategori: "HISTORIS" },
];
const NADA = { success: "green", warning: "orange", danger: "red", neutral: "neutral", info: "neutral" };

function BadgeStatus({ label, nada }) {
  return <Badge variant={NADA[nada] ?? "neutral"}>{label}</Badge>;
}

// ── DAFTAR TERKLASIFIKASI ──────────────────────────────────────────────────────────────────────────────────────
function Daftar({ periode, kategori, opsi, onBuka, judulKosong }) {
  const [q, setQ] = useState("");
  const [pihak, setPihak] = useState("");
  const [rekening, setRekening] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const qT = useTertunda(q);
  const pihakT = useTertunda(pihak);

  useEffect(() => { setPage(1); }, [periode.from, periode.to, kategori, qT, pihakT, rekening, status]);
  const muat = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api.getFinancePemasukan({ from: periode.from, to: periode.to, kategori, q: qT, pihak: pihakT, rekening, status, page, limit: 25 })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [periode.from, periode.to, kategori, qT, pihakT, rekening, status, page]);
  useEffect(() => { muat(); }, [muat]);

  const statusOpsi = (opsi?.status ?? []).map((s) => [s.id, s.label]);
  const rekOpsi = (opsi?.rekening ?? []).map((r) => [r.id, r.name]);
  return (
    <div className="space-y-3">
      <FilterBar
        q={q} onQ={setQ} placeholder="Cari nomor, keterangan, nominal…"
        filters={[
          { key: "rek", label: "Rekening", value: rekening, onChange: setRekening, options: rekOpsi },
          { key: "st", label: "Status", value: status, onChange: setStatus, options: statusOpsi },
        ]}
        ringkasan={data ? `${data.total} baris · total ${teksRp(data.totalNilai)}` : ""}
        onReset={() => { setQ(""); setPihak(""); setRekening(""); setStatus(""); }}
      />
      <Input value={pihak} onChange={(e) => setPihak(e.target.value)} placeholder="Cari pelanggan / pembayar…" className="max-w-xs" aria-label="Cari pelanggan atau pembayar" />
      {data?.terpotong && <Penjelasan>Data sangat besar; daftar dipotong server. Persempit periode.</Penjelasan>}
      {error && <Card><CardContent className="py-6 text-red">Gagal memuat: {error} <Button size="sm" onClick={muat}>Coba lagi</Button></CardContent></Card>}
      <Card>
        <TableWrap>
          <Table>
            <THead><TR><TH>Tanggal</TH><TH>Nomor</TH><TH>Sumber</TH><TH>Pelanggan/Pembayar</TH><TH>Keterangan</TH><TH>Rekening</TH><TH className="text-right">Nilai</TH><TH>Status</TH><TH>Klasifikasi</TH></TR></THead>
            <TBody>
              {loading && !data ? <TR><TD colSpan={9} className="py-8 text-center text-ink3">Memuat…</TD></TR> : null}
              {data && data.items.length === 0 ? <TR><TD colSpan={9} className="py-8 text-center text-ink3">{judulKosong ?? "Tidak ada data pada periode ini."}</TD></TR> : null}
              {(data?.items ?? []).map((b) => (
                <TR key={b.key} className="cursor-pointer hover:bg-inset" onClick={() => onBuka(b)}>
                  <TD className="whitespace-nowrap">{tanggalPendek(b.tanggal)}</TD>
                  <TD className="whitespace-nowrap font-medium">{b.nomor}</TD>
                  <TD>{b.sumberLabel}</TD>
                  <TD>{b.pihak ?? "—"}</TD>
                  <TD className="max-w-[260px] truncate" title={b.keterangan}>{b.keterangan}</TD>
                  <TD>{b.rekening ?? "—"}</TD>
                  <TD className="text-right"><Rp v={b.nilai} /></TD>
                  <TD><BadgeStatus label={b.statusLabel} nada={b.nada} /></TD>
                  <TD>
                    <div className="text-[12px]">{b.kategoriLabel}</div>
                    <div className="text-[11px] text-ink3">{b.subLabel}</div>
                    {b.perluTinjau && <Badge variant="orange">Perlu ditinjau</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
      {data && (data.page > 1 || data.adaLagi) && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-[12px] text-ink2">Halaman {data.page}</span>
          <Button size="sm" variant="outline" disabled={!data.adaLagi} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></Button>
        </div>
      )}
    </div>
  );
}

// ── RINGKASAN ──────────────────────────────────────────────────────────────────────────────────────────────────
function Ringkasan({ periode, ke }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const muat = useCallback(async () => {
    setError(null);
    try { setR(await api.getFinancePemasukanRingkasan({ from: periode.from, to: periode.to })); } catch (e) { setError(e.message); }
  }, [periode.from, periode.to]);
  useEffect(() => { muat(); }, [muat]);
  if (error) return <Card><CardContent className="py-6 text-red">Gagal memuat ringkasan: {error} <Button size="sm" onClick={muat}>Coba lagi</Button></CardContent></Card>;
  if (!r) return <Card><CardContent className="py-8 text-center text-ink3">Memuat ringkasan…</CardContent></Card>;
  const celah = r.cutoff?.celahPengakuan;
  return (
    <div className="space-y-4">
      <Penjelasan>
        <strong>Pendapatan</strong> = penjualan yang sudah diakui (order diserahkan), belum tentu sudah dibayar. <strong>Uang masuk</strong> = pembayaran yang benar-benar diterima.
        Keduanya dua metrik berbeda dan <strong>tidak dijumlahkan</strong> (akan menghitung penjualan yang sama dua kali).
      </Penjelasan>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KartuAngka label="Pendapatan dari sistem" value={teksRp(r.pendapatanSistem.nilai)} sub={`${r.pendapatanSistem.jumlah} pengakuan · retur ${teksRp(r.pendapatanSistem.retur)}`} onClick={() => ke("pendapatan")} info="Penjualan yang sudah diakui di buku besar pada periode ini, dikurangi retur/potongan." />
        <KartuAngka label="Pendapatan historis (sebelum sistem)" value={teksRp(r.pendapatanHistoris.nilai)} sub={`${r.pendapatanHistoris.jumlah} baris · ${r.pendapatanHistoris.perluDitinjau.jumlah} perlu ditinjau`} onClick={() => ke("historis")} info={r.labelHistoris} />
        <KartuAngka label="Total pendapatan gabungan" value={teksRp(r.pendapatanGabungan.nilai)} sub="sistem + historis (setelah deduplikasi)" info={r.pendapatanGabungan.catatan} />
        <KartuAngka label="Piutang masih tersisa" value={teksRp(r.piutangTersisa.nilai)} sub={`${r.piutangTersisa.jumlahOrder} order · per ${tanggalPendek(r.piutangTersisa.perTanggal)}`} info="Sisa tagihan yang belum tertagih menurut buku besar (posisi akhir periode, bukan arus)." />
        <KartuAngka label="Pembayaran masuk terverifikasi" value={teksRp(r.pembayaranMasuk.terverifikasi.nilai)} sub={`${r.pembayaranMasuk.terverifikasi.jumlah} pembayaran`} tone="green" onClick={() => ke("pembayaran")} />
        <KartuAngka label="Menunggu verifikasi" value={teksRp(r.pembayaranMasuk.menunggu.nilai)} sub={`${r.pembayaranMasuk.menunggu.jumlah} pembayaran`} tone="orange" onClick={() => ke("pembayaran")} />
        <KartuAngka label="Pemasukan lain" value={teksRp(r.pemasukanLain.nilai)} sub={`${r.pemasukanLain.jumlah} catatan`} onClick={() => ke("lain")} />
        <KartuAngka label="Dana masuk bukan pendapatan" value={teksRp(r.danaMasukBukanPendapatan.nilai)} sub={`${r.danaMasukBukanPendapatan.jumlah} catatan`} onClick={() => ke("dana")} info="Setoran modal dan pinjaman/pendanaan pihak ketiga. Bukan pendapatan." />
      </div>
      {r.danaMasukBukanPendapatan.rincian.length > 0 && (
        <Card><JudulKartu title="Rincian dana masuk bukan pendapatan" /><CardContent className="space-y-1 text-[13px]">
          {r.danaMasukBukanPendapatan.rincian.map((x) => <div key={x.sub} className="flex justify-between"><span>{x.label} ({x.jumlah})</span><Rp v={x.nilai} /></div>)}
        </CardContent></Card>
      )}
      {(r.pembayaranMasuk.belumDibukukan.jumlah > 0 || r.perluDitinjau.jumlah > 0) && (
        <Card className="border-orange"><CardContent className="flex gap-3 py-4 text-[13px]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" />
          <div>
            <p className="font-semibold">Perlu ditinjau: {r.perluDitinjau.jumlah} baris ({teksRp(r.perluDitinjau.nilai)})</p>
            <p className="text-ink2">Tidak dihitung ke kategori mana pun sampai ditinjau. {r.pembayaranMasuk.belumDibukukan.jumlah > 0 && `${r.pembayaranMasuk.belumDibukukan.jumlah} pembayaran terverifikasi (${teksRp(r.pembayaranMasuk.belumDibukukan.nilai)}) belum masuk buku besar karena rekening belum dipetakan — selesaikan lewat Data belum lengkap.`}</p>
          </div>
        </CardContent></Card>
      )}
      <Card><JudulKartu title="Dikecualikan dari pemasukan" description="Tampil untuk transparansi; bukan pendapatan maupun dana masuk eksternal." /><CardContent className="space-y-1 text-[13px]">
        <div className="flex justify-between"><span>Transfer antar-rekening ({r.dikecualikan.transfer.jumlah})</span><Rp v={r.dikecualikan.transfer.nilai} /></div>
        <div className="flex justify-between"><span>Saldo awal / koreksi saldo ({r.dikecualikan.saldoAwal.jumlah})</span><Rp v={r.dikecualikan.saldoAwal.nilai} /></div>
        <div className="flex justify-between"><span>Pembalikan pengeluaran ({r.dikecualikan.pembalikanBiaya.jumlah})</span><Rp v={r.dikecualikan.pembalikanBiaya.nilai} /></div>
      </CardContent></Card>
      {celah && (
        <Card><JudulKartu title="Celah pengakuan pendapatan (informasi)" /><CardContent className="text-[13px] text-ink2">
          <p>Cutoff sistem: <strong>{tanggalPendek(r.cutoff.tanggal)}</strong>. {r.cutoff.dasar}</p>
          <p className="mt-2">Order sistem {tanggalPendek(celah.dari)} – {tanggalPendek(celah.sampai)}: <strong>{celah.jumlahOrder} order senilai {teksRp(celah.nilaiOrder)}</strong> belum memiliki pengakuan pendapatan di buku besar. {celah.catatan}</p>
        </CardContent></Card>
      )}
      <Penjelasan>{r.labelHistoris}</Penjelasan>
      {r.terpotong && <Penjelasan>Data sangat besar; sebagian dipotong server. Persempit periode.</Penjelasan>}
    </div>
  );
}

// ── DATA SEBELUM SISTEM ────────────────────────────────────────────────────────────────────────────────────────
function DataSebelumSistem({ periode, opsi, onBuka }) {
  const [cutoff, setCutoff] = useState(null);
  const [batches, setBatches] = useState(null);
  const [detail, setDetail] = useState(null);
  const [statusBaris, setStatusBaris] = useState("");
  const [rekon, setRekon] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [sumber, setSumber] = useState("Notion");
  const berkas = useRef(null);
  const boleh = opsi?.dataSebelumSistem?.boleh;

  const muat = useCallback(async () => {
    try { const [c, b] = await Promise.all([api.getLegacyCutoff(), api.getLegacyBatches()]); setCutoff(c); setBatches(b.items); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  async function jalan(fn, sukses) {
    if (sibuk) return;
    setSibuk(true); setPesan(null);
    try { const h = await fn(); setPesan({ teks: sukses ?? h?.pesan ?? "Selesai" }); await muat(); return h; }
    catch (e) { setPesan({ galat: true, teks: e.message }); }
    finally { setSibuk(false); }
  }
  async function unggah() {
    const f = berkas.current?.files?.[0];
    if (!f) { setPesan({ galat: true, teks: "Pilih berkas CSV atau XLSX ekspor Notion dulu." }); return; }
    const fd = new FormData(); fd.append("file", f); fd.append("sumber", sumber);
    const h = await jalan(() => api.uploadLegacyBatch(fd));
    if (h?.batch) await bukaBatch(h.batch.id);
    if (berkas.current) berkas.current.value = "";
  }
  async function bukaBatch(id, st = statusBaris) {
    try { setDetail(await api.getLegacyBatch(id, { status: st, limit: 100 })); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }
  async function batal(b) {
    const alasan = window.prompt("Alasan membatalkan impor ini (wajib):");
    if (!alasan?.trim()) return;
    await jalan(() => api.batalLegacyBatch(b.id, alasan.trim()), "Impor dibatalkan. Baris tidak lagi dihitung.");
    setDetail(null);
  }
  async function putuskan(baris, keputusan) {
    await jalan(() => api.keputusanLegacyBaris(baris.id, keputusan), keputusan === "TERIMA" ? "Baris diterima dan dihitung." : "Baris diabaikan.");
    if (detail) await bukaBatch(detail.batch.id);
  }
  async function bukaRekon() {
    try { const [r, p] = await Promise.all([api.getLegacyRekonsiliasi(), api.getLegacyProposal()]); setRekon(r); setProposal(p); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }

  return (
    <div className="space-y-4">
      <Penjelasan>{opsi?.labelHistoris ?? "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui."}</Penjelasan>
      {cutoff && (
        <Card><CardContent className="py-4 text-[13px]">
          <p><strong>Cutoff sistem:</strong> {cutoff.tanggal ? tanggalPendek(cutoff.tanggal) : "belum ada order di sistem"}. {cutoff.dasar}</p>
          <p className="mt-1 text-ink2">Baris arsip bertanggal pada/setelah cutoff tidak dihitung dari arsip (periode itu harus berasal dari order/invoice sistem).</p>
        </CardContent></Card>
      )}
      {pesan && <div role="status" className={`rounded-lg border px-3 py-2 text-[13px] ${pesan.galat ? "border-red text-red" : "border-green text-green"}`}>{pesan.teks}</div>}

      <Card><JudulKartu title="Impor arsip (CSV / XLSX)" description="Bukan input bebas: unggah ekspor Notion → pratinjau & validasi → impor. Tidak membuat jurnal, invoice, piutang, atau mengubah saldo Kas & Bank." />
        <CardContent className="space-y-3">
          {boleh ? (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={berkas} type="file" accept=".csv,.xlsx" aria-label="Berkas CSV atau XLSX" className="text-[13px]" />
              <Input value={sumber} onChange={(e) => setSumber(e.target.value)} placeholder="Sumber data" className="w-40" aria-label="Sumber data" />
              <Button onClick={unggah} disabled={sibuk}><Upload size={14} className="mr-1" /> Unggah & pratinjau</Button>
            </div>
          ) : <p className="text-[13px] text-ink2">Akun Anda hanya dapat melihat. Impor arsip butuh izin mencatat.</p>}
          <p className="text-[12px] text-ink3">Kolom dikenali dari judul: tanggal transaksi, nomor/resi, pelanggan, keterangan, nominal, status pembayaran, tanggal pembayaran, metode pembayaran, sumber data. Nomor boleh kosong (sistem membuat ID legacy yang stabil).</p>
        </CardContent>
      </Card>

      <Card><JudulKartu title="Batch impor" /><TableWrap><Table>
        <THead><TR><TH>Berkas</TH><TH>Waktu</TH><TH>Status</TH><TH className="text-right">Baris</TH><TH>Siap</TH><TH>Tinjau</TH><TH>Duplikat</TH><TH>Di luar</TH><TH>Tidak valid</TH><TH className="text-right">Nilai siap</TH><TH /></TR></THead>
        <TBody>
          {(batches ?? []).length === 0 && <TR><TD colSpan={11} className="py-6 text-center text-ink3">Belum ada impor.</TD></TR>}
          {(batches ?? []).map((b) => (
            <TR key={b.id}>
              <TD className="font-medium">{b.fileName}<div className="text-[11px] text-ink3">{b.sumberData}</div></TD>
              <TD className="whitespace-nowrap">{tanggalPendek(b.dibuatPada)}</TD>
              <TD><Badge variant={b.status === "IMPORTED" ? "green" : b.status === "CANCELLED" ? "gray" : "orange"}>{{ PREVIEW: "Pratinjau", IMPORTED: "Diimpor", CANCELLED: "Dibatalkan", POSTED: "Diposting" }[b.status]}</Badge></TD>
              <TD className="text-right">{b.totalRows}</TD>
              <TD>{b.perStatus.SIAP ?? 0}</TD><TD>{b.perStatus.PERLU_DITINJAU ?? 0}</TD><TD>{b.perStatus.DUPLIKAT ?? 0}</TD><TD>{b.perStatus.DI_LUAR_PERIODE ?? 0}</TD><TD>{b.perStatus.TIDAK_VALID ?? 0}</TD>
              <TD className="text-right"><Rp v={b.nilaiSiap} /></TD>
              <TD className="whitespace-nowrap">
                <Button size="sm" variant="outline" onClick={() => bukaBatch(b.id)}>Lihat</Button>{" "}
                {boleh && b.status === "PREVIEW" && <Button size="sm" disabled={sibuk} onClick={() => jalan(() => api.imporLegacyBatch(b.id), "Batch diimpor ke register (non-posting).")}>Impor</Button>}{" "}
                {boleh && (b.status === "PREVIEW" || b.status === "IMPORTED") && <Button size="sm" variant="outline" disabled={sibuk} onClick={() => batal(b)}>Batalkan</Button>}
              </TD>
            </TR>
          ))}
        </TBody></Table></TableWrap></Card>

      <Card><JudulKartu title="Rekonsiliasi & simulasi" description="Total per bulan Januari sampai cutoff, dibandingkan dengan jurnal saat ini. Hanya laporan — tidak ada yang diposting." />
        <CardContent className="space-y-3">
          <Button size="sm" variant="outline" onClick={bukaRekon}>Tampilkan rekonsiliasi</Button>
          {rekon && (
            <>
              <TableWrap><Table>
                <THead><TR><TH>Bulan</TH><TH className="text-right">Pendapatan</TH><TH className="text-right">Lunas</TH><TH className="text-right">Belum dibayar</TH><TH className="text-right">Tidak diketahui</TH><TH>Tinjau</TH><TH>Duplikat</TH><TH className="text-right">Jurnal saat ini</TH><TH className="text-right">Selisih</TH></TR></THead>
                <TBody>
                  {rekon.perBulan.map((b) => (
                    <TR key={b.bulan}><TD>{b.bulan}</TD><TD className="text-right"><Rp v={b.pendapatan} /></TD><TD className="text-right"><Rp v={b.lunas} /></TD><TD className="text-right"><Rp v={b.belumBayar} /></TD><TD className="text-right"><Rp v={b.tidakDiketahui} /></TD><TD>{b.perluDitinjau.jumlah}</TD><TD>{b.duplikat.jumlah}{b.duplikat.kemungkinanCocokOrderSistem ? ` (${b.duplikat.kemungkinanCocokOrderSistem} mirip order)` : ""}</TD><TD className="text-right"><Rp v={b.jurnalSaatIni} /></TD><TD className="text-right"><Rp v={b.selisihTerhadapJurnal} /></TD></TR>
                  ))}
                  <TR className="font-semibold"><TD>Total</TD><TD className="text-right"><Rp v={rekon.total.pendapatan} /></TD><TD className="text-right"><Rp v={rekon.total.lunas} /></TD><TD className="text-right"><Rp v={rekon.total.belumBayar} /></TD><TD className="text-right"><Rp v={rekon.total.tidakDiketahui} /></TD><TD /><TD /><TD className="text-right"><Rp v={rekon.total.jurnalSaatIni} /></TD><TD className="text-right"><Rp v={rekon.total.selisihTerhadapJurnal} /></TD></TR>
                </TBody></Table></TableWrap>
              <Penjelasan>{rekon.simulasi.catatan} Dampak simulasi: laba/pendapatan +{teksRp(rekon.simulasi.labaRugi.pendapatanBertambah)}, piutang +{teksRp(rekon.simulasi.piutang.bertambah)}, kas {teksRp(rekon.simulasi.kas.berubah)} (tidak berubah), ekuitas +{teksRp(rekon.simulasi.ekuitas.berubah)}.</Penjelasan>
              {proposal && (
                <details className="text-[13px]"><summary className="cursor-pointer font-semibold">{proposal.status} — proposal jurnal migrasi</summary>
                  <p className="mt-2 text-ink2">{proposal.persetujuan}</p>
                  <ul className="mt-1 list-disc pl-5 text-ink2">{proposal.prinsip.map((p) => <li key={p}>{p}</li>)}</ul>
                  {proposal.jurnal.map((j) => (
                    <div key={j.bulan} className="mt-2"><p className="font-medium">{j.bulan}</p>
                      {j.lines.map((l, i) => <div key={i} className="flex justify-between"><span>{l.akun} {l.nama}{l.catatan ? ` — ${l.catatan}` : ""}</span><span className="tabular-nums">D {teksRp(l.debit)} / K {teksRp(l.kredit)}</span></div>)}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 text-[14px] font-semibold">Baris arsip yang dihitung / perlu ditinjau pada periode terpilih</h3>
        <Daftar periode={periode} kategori="HISTORIS" opsi={{ ...opsi, status: [{ id: "SIAP", label: "Siap" }, { id: "PERLU_DITINJAU", label: "Perlu ditinjau" }, { id: "DUPLIKAT", label: "Duplikat" }] }} onBuka={onBuka} judulKosong="Belum ada data arsip pada periode ini (unggah & impor dulu)." />
      </div>

      {detail && (
        <Modal open onOpenChange={(v) => { if (!v) setDetail(null); }} title={`Batch: ${detail.batch.fileName}`} className="max-w-5xl">
          <div className="space-y-3 text-[13px]">
            <p>Status <strong>{detail.batch.status}</strong> · cutoff {tanggalPendek(detail.batch.cutoff)} · {detail.ringkasan.jumlah} baris · siap {detail.ringkasan.perStatus.SIAP} ({teksRp(detail.ringkasan.nilaiSiap)}) · tinjau {detail.ringkasan.perStatus.PERLU_DITINJAU} · duplikat {detail.ringkasan.perStatus.DUPLIKAT} · di luar periode {detail.ringkasan.perStatus.DI_LUAR_PERIODE} · tidak valid {detail.ringkasan.perStatus.TIDAK_VALID}</p>
            <select value={statusBaris} onChange={(e) => { setStatusBaris(e.target.value); bukaBatch(detail.batch.id, e.target.value); }} className="rounded-lg border px-2 py-1" aria-label="Filter status baris">
              <option value="">Semua status</option><option value="SIAP">Siap</option><option value="PERLU_DITINJAU">Perlu ditinjau</option><option value="DUPLIKAT">Duplikat</option><option value="DI_LUAR_PERIODE">Di luar periode</option><option value="TIDAK_VALID">Tidak valid</option>
            </select>
            <TableWrap><Table>
              <THead><TR><TH>#</TH><TH>Tanggal</TH><TH>Nomor</TH><TH>Pelanggan</TH><TH className="text-right">Nilai</TH><TH>Bayar</TH><TH>Status</TH><TH>Alasan</TH><TH /></TR></THead>
              <TBody>
                {detail.items.map((b) => (
                  <TR key={b.id}>
                    <TD>{b.rowNo}</TD><TD className="whitespace-nowrap">{b.tanggal ? tanggalPendek(b.tanggal) : "—"}</TD><TD>{b.nomorLama ?? <span className="text-ink3">{b.legacyId}</span>}</TD><TD>{b.pelanggan ?? "—"}</TD>
                    <TD className="text-right">{b.nilai === null ? "—" : <Rp v={b.nilai} />}</TD><TD>{b.payLabel}</TD><TD><BadgeStatus label={b.keputusan === "ABAIKAN" ? "Diabaikan" : b.keputusan === "TERIMA" ? "Diterima" : b.statusLabel} nada={b.nada} /></TD>
                    <TD className="max-w-[260px] text-[12px] text-ink2">{b.alasan}</TD>
                    <TD className="whitespace-nowrap">
                      {boleh && detail.batch.status === "IMPORTED" && b.status === "PERLU_DITINJAU" && !b.keputusan && (<><Button size="sm" disabled={sibuk} onClick={() => putuskan(b, "TERIMA")}>Terima</Button>{" "}<Button size="sm" variant="outline" disabled={sibuk} onClick={() => putuskan(b, "ABAIKAN")}>Abaikan</Button></>)}
                    </TD>
                  </TR>
                ))}
              </TBody></Table></TableWrap>
            {detail.adaLagi && <p className="text-ink3">Menampilkan 100 baris pertama dari {detail.total}. Gunakan filter status untuk mempersempit.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── HALAMAN ────────────────────────────────────────────────────────────────────────────────────────────────────
export default function FinancePemasukan() {
  const nav = useNavigate();
  const [periode, setPeriode] = useState(periodeDefault());
  const [tab, setTab] = useState("ringkasan");
  const [opsi, setOpsi] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailGalat, setDetailGalat] = useState(null);

  useEffect(() => { api.getFinancePemasukanOpsi().then(setOpsi).catch((e) => setError(e.message)); }, []);
  const aktif = TAB.find((t) => t.id === tab);

  async function buka(b) {
    setDetail({ memuat: true, baris: b }); setDetailGalat(null);
    try { setDetail({ baris: b, ...(await api.getFinancePemasukanDetail(b.jenis, b.id)) }); }
    catch (e) { setDetailGalat(e.message); }
  }
  const tautan = detail?.baris?.tautan;

  return (
    <HalamanFinance
      title="Pemasukan" subtitle="Satu tempat untuk melihat seluruh arus pemasukan — tanpa menciptakan transaksi atau jurnal baru."
      actions={<div className="flex items-center gap-2"><PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />{opsi?.aksiCatat?.boleh && <Button size="sm" variant="outline" onClick={() => nav("/finance/other-income")}>Catat Pemasukan Lain</Button>}</div>}
      loading={false} error={error} onRetry={() => window.location.reload()}
    >
      <div role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"><strong>Angka belum final.</strong> {PERINGATAN_PENDAPATAN_2026}</div>
      <div role="tablist" aria-label="Kategori pemasukan" className="mb-4 flex flex-wrap gap-2">
        {TAB.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-full border px-3 py-1.5 text-[13px] ${tab === t.id ? "border-blue bg-blue text-white" : "text-ink2 hover:bg-inset"}`}>{t.label}</button>
        ))}
      </div>
      {tab !== "ringkasan" && aktif?.kategori && opsi && (
        <Penjelasan className="mb-3">{opsi.kategori.find((k) => k.id === aktif.kategori)?.penjelasan}</Penjelasan>
      )}
      {tab === "ringkasan" && <Ringkasan periode={periode} ke={setTab} />}
      {["pendapatan", "pembayaran", "lain", "dana"].includes(tab) && <Daftar key={tab} periode={periode} kategori={aktif.kategori} opsi={opsi} onBuka={buka} />}
      {tab === "historis" && <DataSebelumSistem periode={periode} opsi={opsi} onBuka={buka} />}

      {detail && (
        <Modal open onOpenChange={(v) => { if (!v) setDetail(null); }} title={`${detail.baris.nomor} — ${detail.baris.kategoriLabel}`}>
          <div className="space-y-3 text-[13px]">
            {detailGalat && <p className="text-red">Gagal memuat detail: {detailGalat}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-ink3">Tanggal</span><div>{tanggalPendek(detail.baris.tanggal)}</div></div>
              <div><span className="text-ink3">Nilai</span><div><Rp v={detail.baris.nilai} /></div></div>
              <div><span className="text-ink3">Sumber</span><div>{detail.baris.sumberLabel}</div></div>
              <div><span className="text-ink3">Rekening</span><div>{detail.baris.rekening ?? "—"}</div></div>
              <div className="col-span-2"><span className="text-ink3">Keterangan</span><div>{detail.baris.keterangan}</div></div>
            </div>
            <div>
              <p className="font-semibold">Klasifikasi akuntansi (dihitung server)</p>
              {(detail.klasifikasi ?? [{ kategoriLabel: detail.baris.kategoriLabel, subLabel: detail.baris.subLabel, nilai: detail.baris.nilai, catatan: detail.baris.catatan }]).map((k, i) => (
                <div key={i} className="mt-1 rounded-lg border p-2"><div>{k.kategoriLabel}{k.subLabel ? ` — ${k.subLabel}` : ""}: <Rp v={k.nilai} /></div>{k.catatan && <div className="text-orange">{k.catatan}</div>}</div>
              ))}
              {detail.penjelasan && <p className="mt-1 text-ink2">{detail.penjelasan}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {tautan?.jurnal && <Button size="sm" variant="outline" onClick={() => nav("/finance/journal")}>Jurnal {tautan.jurnal.nomor}</Button>}
              {tautan?.invoice && <Button size="sm" variant="outline" onClick={() => nav("/finance/invoices")}>Invoice {tautan.invoice.nomor}</Button>}
              {tautan?.pembayaran && <Button size="sm" variant="outline" onClick={() => nav("/finance/payments")}>Pembayaran</Button>}
              {tautan?.dokumen?.modul === "pemasukan" && <Button size="sm" variant="outline" onClick={() => nav("/finance/other-income")}>Pemasukan Lain</Button>}
            </div>
          </div>
        </Modal>
      )}
    </HalamanFinance>
  );
}
