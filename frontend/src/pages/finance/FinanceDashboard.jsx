import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ArrowRight, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import { api } from "@/api.js";
import { formatRupiahShort } from "@/utils/format.js";
import {
  HalamanFinance, KartuAngka, JudulKartu, Uang, formatUang, CatatanLaporan, Penjelasan,
  PeriodePicker, periodeDefault, tanggalPendek, tanggalJam,
  LABEL_SUMBER_JURNAL,
} from "@/features/finance/shared.jsx";

// Dashboard Finance — SATU layar yang menjawab empat pertanyaan yang
// benar-benar ditanyakan tiap pagi:
//   1. Uang kita sekarang berapa & di mana? (saldo per rekening)
//   2. Bulan ini untung atau rugi? (laba rugi ringkas)
//   3. Siapa berutang ke kita & kita berutang ke siapa? (piutang/utang)
//   4. Apa yang menunggu saya hari ini? (antrean verifikasi & approval)
//
// Yang SENGAJA TIDAK ditampilkan: omzet (SUM Order.value). Angka itu sudah
// ada di Dashboard Sales & Kendali, dan menaruhnya di sebelah "pendapatan"
// akuntansi cuma akan membuat dua angka berbeda untuk hal yang terdengar
// sama — persis kebingungan yang modul ini dibangun untuk menghilangkan.

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [periode, setPeriode] = useState(periodeDefault);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinanceDashboard(periode));
    } catch (e) {
      setError(e.message || "Gagal memuat dashboard keuangan");
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => { muat(); }, [muat]);

  const lr = data?.labaRugi;
  const antrean = data?.antrean;

  return (
    <HalamanFinance
      title="Ringkasan Keuangan"
      subtitle="Posisi kas, laba rugi berjalan, piutang & utang, dan pekerjaan yang menunggu diverifikasi."
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
      loading={loading}
      error={error}
      onRetry={muat}
    >
      {data && (
        <>
          {/* Command center — pola SAMA dengan Bengkel/Armada/Kendali/B2B
              (D-180, menyusul rollout kaca/hero yang sama). tone="blue"
              mengikuti konvensi workspace BARU pasca-unifikasi 1 Agustus
              2026 (lihat B2BOrders.jsx) — bukan warna baru per divisi.
              SELURUH angka di stats/health diambil langsung dari respons
              API, tidak ada yang dikarang: kalau finance belum disiapkan
              (totalKas 0 & belum ada rekening), tile-nya tetap tampil apa
              adanya (Rp0), bukan disembunyikan atau diganti data contoh. */}
          <WorkspaceHero
            tone="blue"
            title="Posisi Keuangan"
            subtitle={`Periode ${tanggalPendek(periode.from)} – ${tanggalPendek(periode.to)}.`}
            health={
              data.catatan.gapTerbuka > 0
                ? { label: `${data.catatan.gapTerbuka} transaksi belum lengkap`, tone: "warn" }
                : { label: "Semua transaksi terbukukan", tone: "ok" }
            }
            stats={[
              { label: "Kas & Bank", value: formatUang(data.totalKas), hint: `${data.kasBank.length} rekening` },
              {
                label: "Laba Bersih Periode", value: formatUang(data.labaRugi.labaBersih),
                hint: data.labaRugi.marginBersih != null ? `Margin ${data.labaRugi.marginBersih.toFixed(1)}%` : undefined,
              },
              { label: "Piutang", value: formatUang(data.piutang.total) },
              { label: "Utang Usaha", value: formatUang(data.utang.total) },
            ]}
          />

          <CatatanLaporan catatan={data.catatan} />

          {/* Bagan akun belum dipasang = modul belum bisa membukukan apa pun.
              Langkah pertamanya harus jelas, bukan tabel kosong tanpa arah. */}
          {data.totalKas === 0 && data.kasBank.length === 0 && (
            <Card className="bg-accentbg">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-ink">Finance belum disiapkan</p>
                  <p className="mt-1 text-[13px] text-ink2">
                    Belum ada rekening kas/bank terdaftar, jadi pembayaran yang masuk belum bisa dibukukan.
                    Mulai dari Bagan Akun, lalu daftarkan rekening & petakan metode pembayarannya.
                  </p>
                </div>
                <Button size="sm" onClick={() => navigate("/finance/accounts")}>
                  Siapkan Sekarang <ArrowRight size={14} />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Kas & bank ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KartuAngka
              label="Total Kas & Bank"
              value={formatUang(data.totalKas)}
              sub={`${data.kasBank.length} rekening aktif`}
              onClick={() => navigate("/finance/cash")}
              info="Uang yang benar-benar dipegang perusahaan sekarang — jumlah seluruh rekening kas, bank, dan e-wallet yang berstatus Aktif. Klik untuk lihat rinciannya per rekening."
            />
            <KartuAngka
              label="Laba Bersih Periode"
              value={formatUang(lr?.labaBersih ?? 0)}
              tone={(lr?.labaBersih ?? 0) < 0 ? "red" : "green"}
              sub={lr?.marginBersih != null ? `Margin ${lr.marginBersih.toFixed(1)}%` : "Belum ada pendapatan"}
              onClick={() => navigate("/finance/reports")}
              info="Pendapatan dikurangi seluruh beban (HPP + operasional) untuk periode yang dipilih. DP yang belum diserahkan ke pelanggan TIDAK dihitung sebagai pendapatan di sini."
            />
            <KartuAngka
              label="Piutang Usaha"
              value={formatUang(data.piutang.total)}
              tone={data.piutang.ringkasan?.["90_plus"] > 0 ? "red" : "default"}
              sub={`${data.piutang.teratas.length ? `${data.piutang.teratas.length}+ order belum lunas` : "Tidak ada tagihan terbuka"}`}
              onClick={() => navigate("/finance/receivables")}
              info="Total tagihan yang belum dibayar lunas oleh pelanggan, tapi HANYA untuk order yang sudah diserahkan (barang/jasanya sudah diterima pelanggan). Order yang belum diserahkan tidak dihitung sebagai piutang."
            />
            <KartuAngka
              label="Utang Usaha"
              value={formatUang(data.utang.total)}
              sub="Tagihan supplier belum dibayar"
              onClick={() => navigate("/finance/suppliers")}
              info="Total tagihan dari supplier yang sudah disetujui tapi belum kita bayar — kebalikan dari piutang."
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* ── Saldo per rekening ── */}
            <Card className="lg:col-span-1">
              <JudulKartu
                title="Saldo per Rekening"
                description="Menurut buku besar, bukan menurut koran bank."
                info="Angka ini dihitung dari jurnal yang tercatat di sistem, bukan ditarik langsung dari aplikasi bank. Kalau ada selisih dengan mutasi bank asli (transfer belum masuk, biaya admin belum tercatat), itu wajar — cocokkan lewat halaman Rekonsiliasi Bank."
              />
              <CardContent>
                {data.kasBank.length === 0 ? (
                  <EmptyState
                    icon={Wallet}
                    title="Belum ada rekening"
                    description="Daftarkan kas & rekening bank supaya uang masuk/keluar punya tempat."
                    action={<Button size="sm" onClick={() => navigate("/finance/cash")}>Tambah Rekening</Button>}
                  />
                ) : (
                  <>
                    <ul className="space-y-2.5">
                      {data.kasBank.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                            <span className="text-[12px] text-ink3">
                              {r.kind === "KAS" ? "Kas tunai" : r.kind === "BANK" ? (r.bankName || "Bank") : "E-wallet"}
                              {r.accountNumber ? ` · ${r.accountNumber}` : ""}
                            </span>
                          </span>
                          <Uang value={r.saldo} className="text-[13px] font-bold" />
                        </li>
                      ))}
                    </ul>
                    {/* Pelengkap visual daftar di atas — data SAMA PERSIS
                        (data.kasBank), bukan sumber terpisah. */}
                    <div className="mt-4 border-t border-line pt-3" style={{ height: Math.max(80, data.kasBank.length * 30) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.kasBank} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                          <XAxis type="number" hide />
                          <YAxis
                            type="category" dataKey="name" width={92}
                            tick={{ fontSize: 10.5, fill: "var(--text-tertiary)" }}
                            axisLine={false} tickLine={false}
                            tickFormatter={(v) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                          />
                          <Tooltip
                            formatter={(v) => [formatRupiahShort(v), "Saldo"]}
                            labelFormatter={(name) => name}
                            contentStyle={{ borderRadius: 12, border: "1px solid var(--hairline)", fontSize: 12, background: "var(--bg-surface)" }}
                          />
                          <Bar dataKey="saldo" radius={[0, 6, 6, 0]} maxBarSize={14}>
                            {data.kasBank.map((r) => (
                              <Cell key={r.id} fill={r.saldo < 0 ? "var(--red)" : "var(--accent)"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Laba rugi ringkas ── */}
            <Card className="lg:col-span-2">
              <JudulKartu
                title={`Laba Rugi ${tanggalPendek(periode.from)} – ${tanggalPendek(periode.to)}`}
                description="Pendapatan diakui saat order DISERAHKAN — DP yang belum diserahkan tidak masuk sini."
                info="Kenapa DP tidak langsung dihitung untung: uang yang masuk sebelum barang/jasa diserahkan masih bisa direfund atau order-nya batal. Menganggapnya untung dari awal akan membuat laporan bulan ini terlihat lebih bagus dari kenyataan, lalu 'turun' lagi kalau ternyata batal."
              />
              <CardContent>
                <dl className="space-y-2 text-[13px]">
                  <Baris label="Pendapatan" value={lr?.pendapatanBruto} />
                  {lr?.retur > 0 && <Baris label="Retur & potongan" value={-lr.retur} />}
                  <Baris label="Pendapatan bersih" value={lr?.pendapatanBersih} tebal />
                  <Baris label="Beban pokok (HPP)" value={-(lr?.bebanPokok ?? 0)} />
                  <Baris label="Laba kotor" value={lr?.labaKotor} tebal />
                  <Baris label="Beban operasional" value={-(lr?.bebanOperasional ?? 0)} />
                  <div className="border-t border-line pt-2">
                    <Baris label="Laba bersih" value={lr?.labaBersih} tebal besar />
                  </div>
                </dl>
                <Button variant="tertiary" size="sm" className="mt-3 px-0" onClick={() => navigate("/finance/reports")}>
                  Lihat laporan lengkap <ArrowRight size={14} />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* ── Antrean pekerjaan ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KartuAngka
              label="Pembayaran Belum Diverifikasi"
              value={antrean.jumlahPembayaranBelumVerifikasi}
              tone={antrean.jumlahPembayaranBelumVerifikasi > 0 ? "orange" : "default"}
              sub={data.gate.enabled ? "Menahan status bayar di CRM" : "Tidak menahan status bayar"}
              onClick={() => navigate("/finance/payments")}
              info="Uang yang tercatat diterima sales/driver tapi belum dicocokkan dengan setoran nyata di rekening. Klik untuk memverifikasi satu per satu."
            />
            <KartuAngka
              label="Pengeluaran Menunggu"
              value={antrean.pengeluaranMenunggu}
              tone={antrean.pengeluaranMenunggu > 0 ? "orange" : "default"}
              sub="Perlu persetujuan"
              onClick={() => navigate("/finance/expenses")}
              info="Pengeluaran yang sudah diajukan tim tapi belum disetujui — belum masuk buku besar sampai disetujui."
            />
            <KartuAngka
              label="Pembelian Menunggu"
              value={antrean.pembelianMenunggu ?? 0}
              tone={antrean.pembelianMenunggu > 0 ? "orange" : "default"}
              sub="Perlu persetujuan"
              onClick={() => navigate("/finance/purchases")}
              info="Pembelian bahan baku/aset/uang muka yang sudah diajukan tapi belum disetujui — belum masuk buku besar sampai disetujui."
            />
            <KartuAngka
              label="Tagihan Supplier Menunggu"
              value={antrean.tagihanMenunggu}
              tone={antrean.tagihanMenunggu > 0 ? "orange" : "default"}
              sub="Perlu persetujuan"
              onClick={() => navigate("/finance/suppliers")}
              info="Tagihan dari supplier yang sudah diinput tapi belum disetujui — belum tercatat sebagai utang sampai disetujui."
            />
            <KartuAngka
              label="Data Belum Lengkap"
              value={data.catatan.gapTerbuka}
              tone={data.catatan.gapTerbuka > 0 ? "red" : "default"}
              sub="Transaksi belum masuk buku besar"
              onClick={() => navigate("/finance/settings")}
              info="Transaksi yang seharusnya dibukukan tapi tertahan karena datanya belum lengkap (mis. rekening belum dipetakan, harga bahan belum diisi). Sistem TIDAK menebak angkanya — lebih baik terlihat sebagai pekerjaan tertunda daripada laporan yang diam-diam salah."
            />
          </div>

          {/* Gerbang verifikasi — dijelaskan apa adanya supaya tidak ada yang
              mengira antrean ini sudah menahan status bayar padahal tidak. */}
          <Penjelasan>
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              <ShieldCheck size={14} className="text-accent" />
              Gerbang verifikasi pembayaran: {data.gate.enabled ? "AKTIF" : "TIDAK AKTIF"}
            </span>
            <p className="mt-1">
              {data.gate.enabled
                ? "Status bayar order di CRM hanya bergerak setelah pembayaran diverifikasi finance. " +
                  "Pembayaran yang tercatat sebelum gerbang ini dinyalakan tetap dihitung apa adanya."
                : "Status bayar order di CRM mengikuti SELURUH pembayaran yang tercatat, terverifikasi atau belum — " +
                  "persis seperti sebelum modul Finance ada. Verifikasi di sini murni pencocokan setoran. " +
                  "Nyalakan gerbangnya di Pengaturan kalau tim sudah siap."}
            </p>
          </Penjelasan>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* ── Piutang tertua ── */}
            <Card className="overflow-hidden">
              <JudulKartu
                title="Piutang Paling Lama"
                description="Order yang sudah diserahkan tapi belum lunas."
                info="Diurutkan dari yang paling lama menunggak — semakin lama umurnya, semakin besar risiko tidak tertagih. Jatuh tempo lebih dari 60 hari ditandai merah, lebih baik segera ditindaklanjuti."
              />
              {data.piutang.teratas.length === 0 ? (
                <CardContent><p className="py-4 text-[13px] text-ink3">Tidak ada piutang terbuka.</p></CardContent>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Order</TH><TH>Pelanggan</TH><TH numeric>Sisa</TH><TH numeric>Umur</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {data.piutang.teratas.map((b) => (
                        <TR key={b.orderId}>
                          <TD className="font-medium">{b.orderNumber || "—"}</TD>
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

            {/* ── Jurnal terakhir ── */}
            <Card className="overflow-hidden">
              <JudulKartu
                title="Jurnal Terakhir"
                description="8 pencatatan terbaru di buku besar."
                info="Setiap transaksi keuangan (pembayaran, pengeluaran, refund, dst) otomatis mencatat satu jurnal double-entry di sini — ini bukti bahwa sistem benar-benar membukukannya, bukan sekadar menyimpan angka."
              />
              {data.jurnalTerakhir.length === 0 ? (
                <CardContent><p className="py-4 text-[13px] text-ink3">Belum ada jurnal.</p></CardContent>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TR><TH>Tanggal</TH><TH>Keterangan</TH><TH>Sumber</TH><TH numeric>Nilai</TH></TR>
                    </THead>
                    <TBody>
                      {data.jurnalTerakhir.map((e) => (
                        <TR key={e.id} clickable onClick={() => navigate("/finance/journal")}>
                          <TD className="whitespace-nowrap">{tanggalPendek(e.date)}</TD>
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

          {/* ── Antrean verifikasi (daftar nyata, bukan cuma angka) ── */}
          {antrean.pembayaranBelumVerifikasi.length > 0 && (
            <Card className="overflow-hidden">
              <JudulKartu
                title="Pembayaran Menunggu Verifikasi"
                description="Uang yang tercatat diterima sales/driver dan perlu dicocokkan dengan setoran nyata."
                info="Ini bukan berarti uangnya hilang atau bermasalah — cuma belum ada yang mengonfirmasi kalau setoran itu memang sudah benar-benar masuk ke rekening perusahaan. Klik salah satu baris untuk memverifikasi."
              />
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Waktu</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Dicatat oleh</TH>
                      <TH>Metode</TH><TH numeric>Nominal</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {antrean.pembayaranBelumVerifikasi.slice(0, 10).map((p) => (
                      <TR key={p.id} clickable onClick={() => navigate("/finance/payments")}>
                        <TD className="whitespace-nowrap">{tanggalJam(p.createdAt)}</TD>
                        <TD className="font-medium">{p.orderNumber || "—"}</TD>
                        <TD className="max-w-[160px] truncate">{p.customerName || "—"}</TD>
                        <TD>{p.recordedBy?.name || "—"}</TD>
                        <TD><Badge variant="neutral">{p.method}</Badge></TD>
                        <TD numeric><Uang value={p.amount} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </Card>
          )}
        </>
      )}
    </HalamanFinance>
  );
}

function Baris({ label, value, tebal, besar }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={tebal ? "font-bold text-ink" : "text-ink2"}>{label}</dt>
      <dd className={besar ? "text-[16px] font-bold" : tebal ? "font-bold" : ""}>
        <Uang value={value ?? 0} />
      </dd>
    </div>
  );
}
