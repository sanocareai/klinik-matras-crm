import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, KartuAngka, JudulKartu, Uang, formatUang, Penjelasan,
  PeriodePicker, periodeDefault, tanggalPendek, tanggalJam,
  LABEL_SUMBER_JURNAL,
} from "@/features/finance/shared.jsx";
import BuktiReview from "@/features/finance/BuktiReview.jsx";
import { KenapaBeda, AuditKonsistensi } from "@/features/finance/kontrak.jsx";
import { StripStatus, KpiKartu, PerluDibereskan, SaldoRekening, LabaRugiPanel } from "@/features/finance/RingkasanPanels.jsx";
import { todayWIB } from "@/lib/dateRange.js";
import { hitungKualitasData, margin as hitungMargin, pisahkanPiutang, ringkasAging } from "@/features/finance/ringkasanKualitas.js";

// Ringkasan Keuangan — urutan layar (atas → bawah), desain baru 31 Okt 2026 (gaya: styles/sanss-finance.css, panel: features/finance/RingkasanPanels.jsx):
//   1. Judul + periode  2. Strip status data (ringkas; penjelasan penuh di "Lihat rincian")  3. Empat KPI  4. Perlu dibereskan  5. Saldo rekening  6. Laba rugi sementara
//   Lalu rincian lama TETAP ada di bawahnya: penjelasan angka, piutang (tiga jenis + aging), antrean pekerjaan, audit, daftar rinci.
//
// Halaman ini HANYA membaca. Semua angka datang dari API yang sudah ada (jurnal yang sudah dibukukan); tidak ada perhitungan akuntansi baru di sini.
// Sumber tambahan yang boleh gagal tanpa merobohkan halaman: saldo riil terkonfirmasi & daftar order yang belum diakui (ditandai "tidak tersedia", bukan 0).

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
  // Server menghitung saldo/piutang/utang pada tanggal buku hari ini (WIB); tanggalnya tidak ikut dikirim, jadi tanggal yang sama dihitung di sini.
  const posisi = useMemo(() => todayWIB().format("YYYY-MM-DD"), []);

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Ringkasan Keuangan"
      subtitle={data ? `Periode ${tanggalPendek(periode.from)} – ${tanggalPendek(periode.to)} · dihitung dari jurnal yang sudah dibukukan.` : "Posisi kas, laba rugi sementara, piutang & utang, dan pekerjaan yang menunggu."}
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
      loading={loading}
      error={error}
      onRetry={muat}
    >
      {data && (
        <div className="fin-ring">
          <StripStatus kualitas={kualitas} catatan={data.catatan} />

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

          {/* ── Empat KPI. Saldo/tagihan/utang = posisi tanggal buku hari ini (WIB, sama dengan server); laba = rentang periode yang dipilih. ── */}
          <section aria-label="Angka utama" className="fin-kpi-grid">
            <KpiKartu
              nada="biru" label="Saldo kas & bank" metrik="kas_bank_buku"
              nilai={formatUang(data.totalKas)} ket="Menurut pembukuan" tanggal={`Per ${tanggalPendek(posisi)}`}
              onClick={() => navigate("/finance/cash")}
              info={`Jumlah saldo seluruh rekening kas, bank, dan e-wallet aktif menurut jurnal di buku besar (${data.kasBank.length} rekening). Bukan saldo koran bank.`}
            />
            <KpiKartu
              nada="muda" label="Laba sementara" metrik="laba_bersih_sementara"
              nilai={formatUang(lr?.labaBersih ?? 0)} ket="Dari transaksi yang sudah dibukukan" tanggal={`${tanggalPendek(data.periode?.from ?? periode.from)}–${tanggalPendek(data.periode?.to ?? periode.to)}`}
              penanda={(lr?.labaBersih ?? 0) < 0 ? "Rugi sementara" : null}
              onClick={() => navigate("/finance/reports")}
              info="Pendapatan yang SUDAH dibukukan dikurangi seluruh biaya yang sudah dibukukan. Order yang sudah selesai tetapi belum diakui pendapatannya belum ikut; dampak data yang belum lengkap bisa berbeda pada saldo, biaya, dan laba. DP yang belum diserahkan tidak dihitung sebagai pendapatan."
            />
            <KpiKartu
              nada="lavender" label="Tagihan pelanggan" metrik="piutang_usaha"
              nilai={formatUang(piutang.bukuBesar)} ket="Piutang dalam pembukuan" tanggal={`Per ${tanggalPendek(posisi)}`}
              penanda={data.piutang.ringkasan?.["90_plus"] > 0 ? "Ada tagihan lewat 90 hari" : null}
              onClick={() => navigate("/finance/receivables")}
              info="Saldo Piutang Usaha menurut jurnal. Terdiri dari tagihan operasional (belum lunas menurut CRM) dan order yang sudah lunas di CRM tetapi pembayarannya belum diverifikasi. Bukan sama dengan pembayaran yang belum tercatat."
            />
            <KpiKartu
              nada="lime" label="Tagihan supplier" metrik="utang_supplier"
              nilai={formatUang(data.utang.total)} ket="Utang usaha" tanggal={`Per ${tanggalPendek(posisi)}`}
              onClick={() => navigate("/finance/suppliers")}
              info="Total tagihan supplier yang sudah disetujui tetapi belum dibayar — kebalikan dari piutang."
            />
          </section>

          <PerluDibereskan kualitas={kualitas} navigate={navigate} />

          <SaldoRekening data={data} riil={riil} posisi={posisi} navigate={navigate} />

          <LabaRugiPanel lr={lr} penanda={data?.labaRugiPenanda} marginInfo={marginInfo} navigate={navigate} />

          <KenapaBeda metrik={["uang_masuk_terverifikasi", "kas_masuk_pelanggan", "pendapatan_diakui", "piutang_usaha", "uang_keluar_kas", "beban_diakui"]} from={periode.from} to={periode.to} denganJembatan />

          {/* ── Piutang: tiga jenis yang berbeda + aging ── */}
          <section aria-label="Piutang dan tagihan" className="space-y-3">
            <h2 className="text-[14px] font-bold text-ink">Piutang, tagihan, dan pembayaran — tiga hal yang berbeda</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <KartuAngka
                label="Piutang Menurut Buku Besar" metrik="piutang_usaha"
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
                label="Pembayaran Belum Tercatat di Pembukuan" metrik="klaim_lunas_menunggu"
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

          <AuditKonsistensi />

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

// ─── Bagian rincian lama (dipertahankan) ───────────────────────────────────

const TANPA_DATA = "Tidak tersedia";

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
