import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowRight, Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, KartuAngka, JudulKartu, Uang, formatUang, Penjelasan,
  PeriodePicker, periodeDefault, tanggalPendek, tanggalJam,
  LABEL_SUMBER_JURNAL,
} from "@/features/finance/shared.jsx";
import BuktiReview from "@/features/finance/BuktiReview.jsx";
import { hitungKualitasData, margin as hitungMargin, pisahkanPiutang, ringkasAging, LABEL_BANNER, LABEL_REKONSILIASI } from "@/features/finance/ringkasanKualitas.js";

// Ringkasan Keuangan — urutan layar (atas → bawah):
//   1. Kualitas data (banner + butir yang harus diselesaikan) — angka di bawahnya SEMENTARA, bukan laporan final
//   2. KPI ringkas (satu baris; tanpa hero ganda)
//   3. Kas & Bank: saldo buku vs saldo riil terkonfirmasi vs selisih rekonsiliasi (pada cutoff yang sama)  |  Laba rugi sementara
//   4. Piutang: tiga jenis yang TIDAK boleh dicampur + aging
//   5. Antrean pekerjaan, lalu daftar rinci
//
// Halaman ini HANYA membaca. Semua angka datang dari API yang sudah ada (jurnal yang sudah dibukukan); tidak ada perhitungan akuntansi baru di sini.
// Sumber tambahan yang boleh gagal tanpa merobohkan halaman: saldo riil terkonfirmasi & daftar order yang belum diakui (ditandai "tidak tersedia", bukan 0).

const TANPA_DATA = "Tidak tersedia";

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [periode, setPeriode] = useState(periodeDefault);
  const [data, setData] = useState(null);
  const [riil, setRiil] = useState(null);
  const [backfill, setBackfill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, r, b] = await Promise.allSettled([api.getFinanceDashboard(periode), api.getFinanceSaldoRiil(), api.getFinanceRekonBackfill()]);
      if (d.status === "rejected") throw d.reason;
      setData(d.value);
      setRiil(r.status === "fulfilled" ? r.value : null);
      setBackfill(b.status === "fulfilled" ? b.value : null);
    } catch (e) {
      setError(e.message || "Gagal memuat ringkasan keuangan");
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => { muat(); }, [muat]);

  const kualitas = useMemo(() => (data ? hitungKualitasData({ antrean: data.antrean, catatan: data.catatan, backfill, riil }) : null), [data, backfill, riil]);
  const piutang = useMemo(() => (data ? pisahkanPiutang(data) : null), [data]);
  const aging = useMemo(() => (data ? ringkasAging(data.piutang) : null), [data]);
  const lr = data?.labaRugi;
  const antrean = data?.antrean;
  const marginInfo = kualitas && lr ? hitungMargin(kualitas, lr) : null;

  return (
    <HalamanFinance
      title="Ringkasan Keuangan"
      subtitle={data ? `Periode ${tanggalPendek(periode.from)} – ${tanggalPendek(periode.to)} · dihitung dari jurnal yang sudah dibukukan.` : "Posisi kas, laba rugi sementara, piutang & utang, dan pekerjaan yang menunggu."}
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
      loading={loading}
      error={error}
      onRetry={muat}
    >
      {data && (
        <div className="space-y-5">
          <BannerKualitas kualitas={kualitas} catatan={data.catatan} navigate={navigate} />

          {data.totalKas === 0 && data.kasBank.length === 0 && (
            <Card className="bg-accentbg">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-ink">Finance belum disiapkan</p>
                  <p className="mt-1 text-[13px] text-ink2">Belum ada rekening kas/bank terdaftar, jadi pembayaran yang masuk belum bisa dibukukan. Mulai dari Bagan Akun, lalu daftarkan rekening & petakan metode pembayarannya.</p>
                </div>
                <Button size="sm" onClick={() => navigate("/finance/accounts")}>Siapkan Sekarang <ArrowRight size={14} /></Button>
              </CardContent>
            </Card>
          )}

          {/* ── KPI ringkas: SATU baris (hero & kartu ganda dihapus) ── */}
          <section aria-label="Angka utama" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KartuAngka
              label="Kas & Bank (menurut buku)"
              value={formatUang(data.totalKas)}
              sub={`${data.kasBank.length} rekening · bukan saldo koran bank`}
              onClick={() => navigate("/finance/cash")}
              info="Jumlah saldo seluruh rekening kas, bank, dan e-wallet aktif menurut jurnal di buku besar. Bandingkan dengan saldo riil terkonfirmasi di bagian Kas & Bank di bawah."
            />
            <KartuAngka
              label="Laba Bersih Sementara"
              value={formatUang(lr?.labaBersih ?? 0)}
              tone={(lr?.labaBersih ?? 0) < 0 ? "red" : "default"}
              sub="Dari jurnal yang sudah dibukukan · belum final"
              onClick={() => navigate("/finance/reports")}
              info="Pendapatan yang SUDAH dibukukan dikurangi seluruh beban yang sudah dibukukan. Order yang sudah selesai tetapi belum diakui pendapatannya belum ikut, sehingga angka ini bisa lebih rendah dari kenyataan. DP yang belum diserahkan tidak dihitung sebagai pendapatan."
            />
            <KartuAngka
              label="Piutang Menurut Buku Besar"
              value={formatUang(piutang.bukuBesar)}
              tone={data.piutang.ringkasan?.["90_plus"] > 0 ? "red" : "default"}
              sub="Saldo akun Piutang Usaha di buku besar"
              onClick={() => navigate("/finance/receivables")}
              info="Saldo Piutang Usaha menurut jurnal. Terdiri dari tagihan operasional (belum lunas menurut CRM) dan order yang sudah lunas di CRM tetapi pembayarannya belum diverifikasi. Bukan sama dengan pembayaran yang belum tercatat — lihat bagian Piutang di bawah."
            />
            <KartuAngka
              label="Utang Usaha"
              value={formatUang(data.utang.total)}
              sub="Tagihan supplier belum dibayar"
              onClick={() => navigate("/finance/suppliers")}
              info="Total tagihan supplier yang sudah disetujui tetapi belum dibayar — kebalikan dari piutang."
            />
          </section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <KasBank data={data} riil={riil} navigate={navigate} className="lg:col-span-3" />
            <Card className="lg:col-span-2">
              <JudulKartu
                title="Laba Rugi Sementara"
                description="Dari jurnal yang sudah dibukukan. Pendapatan diakui saat order diserahterimakan."
                info="Kenapa DP tidak langsung dihitung untung: uang yang masuk sebelum barang/jasa diserahkan masih bisa direfund atau order-nya batal. Angka ini sementara karena masih ada order selesai yang pendapatannya belum dibukukan."
              />
              <CardContent>
                <dl className="space-y-2 text-[13px]">
                  <Baris label="Pendapatan tercatat" value={lr?.pendapatanBruto} />
                  {lr?.retur > 0 && <Baris label="Retur & potongan" value={-lr.retur} />}
                  <Baris label="Pendapatan bersih" value={lr?.pendapatanBersih} tebal />
                  <Baris label="Beban pokok (HPP)" value={-(lr?.bebanPokok ?? 0)} />
                  <Baris label="Laba kotor" value={lr?.labaKotor} tebal />
                  <Baris label="Beban operasional" value={-(lr?.bebanOperasional ?? 0)} />
                  <div className="border-t border-line pt-2"><Baris label="Laba bersih sementara" value={lr?.labaBersih} tebal besar /></div>
                </dl>
                <p className="mt-3 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2" data-testid="catatan-margin">
                  {marginInfo?.tampil
                    ? <>Margin bersih {marginInfo.nilai.toFixed(1)}%.</>
                    : <>{marginInfo?.alasan ?? "Margin tidak ditampilkan"}. Margin baru ditampilkan setelah data pendapatan lengkap.</>}
                </p>
                <Button variant="tertiary" size="sm" className="mt-2 px-0" onClick={() => navigate("/finance/reports")}>Lihat laporan lengkap <ArrowRight size={14} /></Button>
              </CardContent>
            </Card>
          </div>

          {/* ── Piutang: tiga jenis yang berbeda + aging ── */}
          <section aria-label="Piutang dan tagihan" className="space-y-3">
            <h2 className="text-[14px] font-bold text-ink">Piutang, tagihan, dan pembayaran — tiga hal yang berbeda</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <KartuAngka
                label="Piutang Menurut Buku Besar"
                value={formatUang(piutang.bukuBesar)}
                sub={`Termasuk ${formatUang(piutang.menungguVerifikasi.total)} (${piutang.menungguVerifikasi.jumlah} order lunas di CRM, menunggu verifikasi)`}
                onClick={() => navigate("/finance/receivables")}
                info="Saldo Piutang Usaha di buku besar: pendapatan yang sudah diakui tetapi belum dilunasi menurut jurnal."
              />
              <KartuAngka
                label="Tagihan Operasional"
                value={formatUang(piutang.operasional)}
                sub="Order sudah diserahkan, belum lunas menurut CRM"
                onClick={() => navigate("/finance/invoices")}
                info="Daftar tagihan yang harus ditagih tim (order diserahkan, belum lunas). Bagian dari piutang buku besar; tidak termasuk order yang sudah lunas di CRM."
              />
              <KartuAngka
                label="Pembayaran Belum Tercatat"
                value={piutang.pembayaranBelumTercatat.jumlah === null ? TANPA_DATA : `${piutang.pembayaranBelumTercatat.jumlah.toLocaleString("id-ID")} order`}
                tone={piutang.pembayaranBelumTercatat.jumlah > 0 ? "orange" : "default"}
                sub={piutang.pembayaranBelumTercatat.total === null ? undefined : `Senilai ${formatUang(piutang.pembayaranBelumTercatat.total)} · lunas di CRM, belum ada catatan pembayaran & rekening`}
                onClick={() => navigate("/finance/payments")}
                info="Uang yang menurut CRM sudah diterima (status Lunas) tetapi belum punya catatan pembayaran dan rekening, sehingga belum ada jurnal kas. Ini BUKAN piutang dan tidak dijumlahkan dengan piutang."
              />
            </div>
            <AgingKartu aging={aging} />
          </section>

          {/* ── Antrean pekerjaan ── */}
          <section aria-label="Antrean pekerjaan" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KartuAngka label="Pembayaran Belum Diverifikasi" value={antrean.jumlahPembayaranBelumVerifikasi} tone={antrean.jumlahPembayaranBelumVerifikasi > 0 ? "orange" : "default"} sub="Perlu dicocokkan dengan setoran" onClick={() => navigate("/finance/payments")}
              info="Uang yang tercatat diterima sales/driver tetapi belum dicocokkan dengan setoran nyata di rekening." />
            <KartuAngka label="Pengeluaran Menunggu" value={antrean.pengeluaranMenunggu} tone={antrean.pengeluaranMenunggu > 0 ? "orange" : "default"} sub="Perlu persetujuan" onClick={() => navigate("/finance/expenses")}
              info="Pengeluaran yang sudah diajukan tetapi belum disetujui — belum masuk buku besar." />
            <KartuAngka label="Pembelian Menunggu" value={antrean.pembelianMenunggu ?? 0} tone={antrean.pembelianMenunggu > 0 ? "orange" : "default"} sub="Perlu persetujuan" onClick={() => navigate("/finance/purchases")}
              info="Pembelian bahan/aset/uang muka yang belum disetujui — belum masuk buku besar." />
            <KartuAngka label="Tagihan Supplier Menunggu" value={antrean.tagihanMenunggu} tone={antrean.tagihanMenunggu > 0 ? "orange" : "default"} sub="Perlu persetujuan" onClick={() => navigate("/finance/suppliers")}
              info="Tagihan supplier yang sudah diinput tetapi belum disetujui — belum tercatat sebagai utang." />
            <KartuAngka label="Refund Menunggu" value={antrean.refundMenunggu ?? 0} tone={antrean.refundMenunggu > 0 ? "orange" : "default"} sub="Perlu persetujuan" onClick={() => navigate("/finance/payments")}
              info="Permintaan refund yang belum disetujui — belum keluar dari kas." />
          </section>

          <BuktiReview />

          <Penjelasan>
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <ShieldCheck size={14} className="text-accent" />
              Gerbang verifikasi pembayaran: {data.gate.enabled ? "AKTIF" : "TIDAK AKTIF"}
            </span>
            <p className="mt-1">
              {data.gate.enabled
                ? "Status bayar order di CRM hanya bergerak setelah pembayaran diverifikasi finance. Pembayaran yang tercatat sebelum gerbang ini dinyalakan tetap dihitung apa adanya."
                : "Status bayar order di CRM mengikuti SELURUH pembayaran yang tercatat, terverifikasi atau belum. Verifikasi di sini murni pencocokan setoran. Nyalakan gerbangnya di Pengaturan kalau tim sudah siap."}
            </p>
          </Penjelasan>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <JudulKartu
                title="Piutang Paling Lama"
                description="Order sudah diserahkan tetapi belum lunas, dari yang tertua."
                info="Umur dihitung dari jatuh tempo invoice; bila invoice tidak punya jatuh tempo, dari tanggal order dibuat. Lebih dari 60 hari ditandai merah."
              />
              {data.piutang.teratas.length === 0 ? (
                <CardContent><p className="py-4 text-[13px] text-ink3">Tidak ada piutang terbuka.</p></CardContent>
              ) : (
                <TableWrap className="dh-table">
                  <Table>
                    <THead><TR><TH sticky>Order</TH><TH>Pelanggan</TH><TH numeric>Sisa</TH><TH numeric>Umur</TH></TR></THead>
                    <TBody>
                      {data.piutang.teratas.map((b) => (
                        <TR key={b.orderId}>
                          <TD sticky className="font-medium">{b.orderNumber || "—"}</TD>
                          <TD className="max-w-[160px] truncate">{b.customerName}</TD>
                          <TD numeric><Uang value={b.sisaTagihan} /></TD>
                          <TD numeric>
                            {b.hariLewat > 0
                              ? <Badge variant={b.hariLewat > 60 ? "red" : b.hariLewat > 30 ? "orange" : "neutral"}>{b.hariLewat} hari</Badge>
                              : <span className="text-ink3">belum jatuh tempo</span>}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>

            <Card className="overflow-hidden">
              <JudulKartu title="Jurnal Terakhir" description="8 pencatatan terbaru di buku besar." info="Setiap transaksi keuangan otomatis mencatat satu jurnal double-entry — bukti bahwa sistem benar-benar membukukannya." />
              {data.jurnalTerakhir.length === 0 ? (
                <CardContent><p className="py-4 text-[13px] text-ink3">Belum ada jurnal.</p></CardContent>
              ) : (
                <TableWrap className="dh-table">
                  <Table>
                    <THead><TR><TH sticky>Tanggal</TH><TH>Keterangan</TH><TH>Sumber</TH><TH numeric>Nilai</TH></TR></THead>
                    <TBody>
                      {data.jurnalTerakhir.map((e) => (
                        <TR key={e.id} clickable onClick={() => navigate("/finance/journal")}>
                          <TD sticky className="whitespace-nowrap">{tanggalPendek(e.date)}</TD>
                          <TD className="max-w-[240px] truncate">{e.description}</TD>
                          <TD><Badge variant="neutral">{LABEL_SUMBER_JURNAL[e.source] || e.source}</Badge></TD>
                          <TD numeric><Uang value={e.total} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          </div>

          {antrean.pembayaranBelumVerifikasi.length > 0 && (
            <Card className="overflow-hidden">
              <JudulKartu title="Pembayaran Menunggu Verifikasi" description="Uang yang tercatat diterima sales/driver dan perlu dicocokkan dengan setoran nyata."
                info="Belum ada yang mengonfirmasi bahwa setoran itu sudah masuk ke rekening perusahaan. Klik salah satu baris untuk memverifikasi." />
              <TableWrap className="dh-table">
                <Table fixed>
                  <THead>
                    <TR>
                      <TH sticky width={140} className="whitespace-nowrap">Waktu</TH>
                      <TH width={140}>Order</TH>
                      <TH>Pelanggan</TH>
                      <TH width={140} hideBelow="wide">Dicatat oleh</TH>
                      <TH width={110}>Metode</TH>
                      <TH numeric width={130}>Nominal</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {antrean.pembayaranBelumVerifikasi.slice(0, 10).map((p) => (
                      <TR key={p.id} clickable onClick={() => navigate("/finance/payments")}>
                        <TD sticky className="whitespace-nowrap">{tanggalJam(p.createdAt)}</TD>
                        <TD truncate className="font-medium">{p.orderNumber || "—"}</TD>
                        <TD truncate>{p.customerName || "—"}</TD>
                        <TD hideBelow="wide" truncate>{p.recordedBy?.name || "—"}</TD>
                        <TD><Badge variant="neutral">{p.method}</Badge></TD>
                        <TD numeric><Uang value={p.amount} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </Card>
          )}
        </div>
      )}
    </HalamanFinance>
  );
}

// ─── Bagian ───────────────────────────────────────────────────────────────

function BannerKualitas({ kualitas, catatan, navigate }) {
  const bermasalah = kualitas.belumFinal;
  const Ikon = bermasalah ? AlertTriangle : CheckCircle2;
  return (
    <Card className={bermasalah ? "bg-orangebg" : "bg-greenbg"} role="status" aria-live="polite" data-testid="banner-kualitas">
      <CardContent className="space-y-3 py-4">
        <div className="flex gap-3">
          <Ikon size={18} className={`mt-0.5 shrink-0 ${bermasalah ? "text-orange" : "text-green"}`} />
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">{bermasalah ? "Angka sementara — belum final" : "Data lengkap menurut pemeriksaan otomatis"}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink2">
              {bermasalah ? <>{LABEL_BANNER} Semua angka di halaman ini dihitung dari <b>jurnal yang sudah dibukukan</b>, bukan laporan final.</> : "Semua angka di halaman ini dihitung dari jurnal yang sudah dibukukan."}
            </p>
            {catatan?.pesan?.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink2">{catatan.pesan.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>
        </div>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-4" aria-label="Hal yang perlu diselesaikan">
          {kualitas.butir.map((b) => <ButirKualitas key={b.id} b={b} navigate={navigate} />)}
        </ul>
      </CardContent>
    </Card>
  );
}

function ButirKualitas({ b, navigate }) {
  const tanpaData = b.jumlah === null;
  const bersih = !tanpaData && b.jumlah === 0;
  const angka = tanpaData ? TANPA_DATA : b.satuan === "rupiah" ? formatUang(b.jumlah) : b.jumlah.toLocaleString("id-ID");
  return (
    <li>
      <button
        type="button" onClick={() => navigate(b.tujuan)} title={b.hint}
        className="flex h-full w-full flex-col rounded-lg border border-line bg-surface px-3 py-2 text-left outline-none transition-colors hover:bg-inset focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className={`text-[20px] font-bold leading-tight tabular-nums ${tanpaData ? "text-ink3 text-[14px]" : bersih ? "text-green" : "text-orange"}`}>{angka}</span>
        <span className="mt-0.5 text-[12px] font-medium text-ink">{b.label}</span>
        <span className="mt-0.5 text-[11px] leading-snug text-ink3">
          {tanpaData ? "Data tidak dapat dimuat" : b.nilai && b.satuan !== "rupiah" ? `Senilai ${formatUang(b.nilai)}` : bersih ? "Tidak ada" : b.satuan === "rupiah" ? "Menunggu rekening koran" : "Perlu ditindaklanjuti"}
        </span>
      </button>
    </li>
  );
}

const STATUS_REKENING = {
  SESUAI: { label: "Sesuai", variant: "green" },
  SELISIH: { label: "Ada selisih", variant: "orange" },
  BELUM_DIKONFIRMASI: { label: "Belum dikonfirmasi", variant: "neutral" },
  TIDAK_ADA_SALDO_RIIL: { label: "Tanpa saldo riil", variant: "neutral" },
};

function KasBank({ data, riil, navigate, className }) {
  const petaRiil = new Map((riil?.rekening ?? []).map((r) => [r.id, r]));
  return (
    <Card className={className}>
      <JudulKartu
        title="Kas & Bank"
        description="Saldo buku, saldo riil terkonfirmasi, dan selisih rekonsiliasi."
        info="Saldo buku dihitung dari jurnal. Saldo riil adalah konfirmasi owner (bukan rekening koran). Selisih dihitung pada tanggal buku cutoff yang sama, jadi mutasi setelah cutoff tidak ikut memengaruhi selisih."
      />
      <CardContent>
        {data.kasBank.length === 0 ? (
          <EmptyState icon={Wallet} title="Belum ada rekening" description="Daftarkan kas & rekening bank supaya uang masuk/keluar punya tempat."
            action={<Button size="sm" onClick={() => navigate("/finance/cash")}>Tambah Rekening</Button>} />
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] gap-3 border-b border-line pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink3 sm:grid">
              <span>Rekening</span><span className="text-right">Saldo buku</span><span className="text-right">Saldo riil terkonfirmasi</span><span className="text-right">Selisih rekonsiliasi</span>
            </div>
            <ul className="divide-y divide-line" data-testid="tabel-kas-bank">
              {data.kasBank.map((r) => {
                const x = petaRiil.get(r.id);
                const st = x ? STATUS_REKENING[x.status] : null;
                const bukuBerbeda = x && Math.abs(Number(x.saldoBuku) - Number(r.saldo)) >= 1;
                return (
                  <li key={r.id} className="grid grid-cols-2 gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] sm:items-center">
                    <span className="col-span-2 min-w-0 sm:col-span-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                      <span className="text-[12px] text-ink3">{r.kind === "KAS" ? "Kas tunai" : r.kind === "BANK" ? (r.bankName || "Bank") : "E-wallet"}{r.accountNumber ? ` · ${r.accountNumber}` : ""}</span>
                    </span>
                    <Sel label="Saldo buku">
                      <Uang value={r.saldo} className="text-[13px] font-bold" />
                      {bukuBerbeda && <span className="block text-[11px] text-ink3">Per cutoff: {formatUang(x.saldoBuku)}</span>}
                    </Sel>
                    <Sel label="Saldo riil terkonfirmasi">
                      {x && x.saldoRiil !== null ? <Uang value={x.saldoRiil} className="text-[13px] font-bold" /> : <span className="text-[12px] text-ink3">{riil ? "Belum dikonfirmasi" : TANPA_DATA}</span>}
                    </Sel>
                    <Sel label="Selisih rekonsiliasi" className="col-span-2 sm:col-span-1">
                      {x && x.selisih !== null ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <Uang value={x.selisih} className={`text-[13px] font-bold ${x.selisih > 0 ? "text-orange" : ""}`} />
                          {st && <Badge variant={st.variant}>{st.label}</Badge>}
                        </span>
                      ) : st ? <Badge variant={st.variant}>{st.label}</Badge> : <span className="text-[12px] text-ink3">—</span>}
                    </Sel>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 space-y-1 rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2">
              <p className="font-medium text-ink">{LABEL_REKONSILIASI}</p>
              {riil && <p>Cutoff: {riil.cutoffLabel} (tanggal buku {tanggalPendek(riil.tanggalBuku)}). Selisih positif = saldo buku lebih tinggi dari saldo riil. Sumber saldo riil: {riil.sumber.toLowerCase()}.</p>}
              {!riil && <p>Data saldo riil terkonfirmasi tidak dapat dimuat.</p>}
            </div>
            <Button variant="tertiary" size="sm" className="mt-1 px-0" onClick={() => navigate("/finance/reconciliation")}>Buka rekonsiliasi <ArrowRight size={14} /></Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Sel({ label, children, className = "" }) {
  return (
    <span className={`min-w-0 sm:text-right ${className}`}>
      <span className="block text-[11px] text-ink3 sm:hidden">{label}</span>
      {children}
    </span>
  );
}

const WARNA_AGING = {
  belum: "var(--green)",
  "1_30": "color-mix(in srgb, var(--orange) 40%, transparent)",
  "31_60": "color-mix(in srgb, var(--orange) 65%, transparent)",
  "61_90": "var(--orange)",
  "90_plus": "var(--red)",
};

function AgingKartu({ aging }) {
  return (
    <Card>
      <JudulKartu
        title="Aging Piutang (tagihan operasional)"
        description="Umur tagihan yang belum lunas menurut CRM."
        info="Umur dihitung dari jatuh tempo invoice; bila invoice tidak punya jatuh tempo, dari tanggal order dibuat."
      />
      <CardContent>
        {aging.total === 0 ? (
          <p className="text-[13px] text-ink3">Tidak ada tagihan operasional terbuka.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metrik label="Belum jatuh tempo" nilai={formatUang(aging.belumJatuhTempo)} />
              <Metrik label="Lewat jatuh tempo" nilai={formatUang(aging.lewatJatuhTempo)} tone={aging.lewatJatuhTempo > 0 ? "orange" : undefined}
                sub={aging.rincian.filter((x) => x.nilai > 0).map((x) => `${x.label}: ${formatUang(x.nilai)}`).join(" · ") || undefined} />
              <Metrik label="Tertua" nilai={aging.tertua ? `${aging.tertua.hari} hari` : "—"} tone={aging.tertua?.hari > 60 ? "red" : undefined}
                sub={aging.tertua ? `${aging.tertua.order ?? "Order"} · ${formatUang(aging.tertua.sisa)}${aging.tertua.dariTanggalOrder ? " · dihitung dari tanggal order" : ""}` : "Tidak ada yang lewat jatuh tempo"} />
            </div>
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-inset" role="img"
              aria-label={`Komposisi umur: ${aging.bagian.filter((x) => x.nilai > 0).map((x) => `${x.label} ${x.persen}%`).join(", ")}`}>
              {aging.bagian.filter((x) => x.nilai > 0).map((x) => <span key={x.key} style={{ width: `${x.persen}%`, background: WARNA_AGING[x.key] }} title={`${x.label}: ${formatUang(x.nilai)}`} />)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metrik({ label, nilai, sub, tone }) {
  return (
    <div className="rounded-lg bg-inset px-3 py-2.5">
      <p className="text-[12px] text-ink3">{label}</p>
      <p className={`mt-0.5 text-[18px] font-bold tabular-nums ${tone === "red" ? "text-red" : tone === "orange" ? "text-orange" : "text-ink"}`}>{nilai}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-ink3">{sub}</p>}
    </div>
  );
}

function Baris({ label, value, tebal, besar }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={tebal ? "font-bold text-ink" : "text-ink2"}>{label}</dt>
      <dd className={besar ? "text-[16px] font-bold" : tebal ? "font-bold" : ""}><Uang value={value ?? 0} /></dd>
    </div>
  );
}
