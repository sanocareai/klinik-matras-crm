import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePeriodeFinance } from "@/lib/periodeBersama.js";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";
import { HalamanFinance, PeriodePicker, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { StripStatus, KpiKartu, TindakLanjut, SaldoRekening, LabaRugiPanel } from "@/features/finance/RingkasanPanels.jsx";
import { TagihanPelanggan, PencatatanTerbaru, PanelPendukung } from "@/features/finance/RingkasanBawah.jsx";
import { IkKasBank } from "@/components/financeIcons.jsx";
import { IkGrafik, IkStruk, IkPelangganNav } from "@/components/sanssIcons.jsx";
import { CATATAN_POSISI, LABEL_POSISI, susunTindakLanjut } from "@/features/finance/ringkasanTampilan.js";
import { hitungKualitasData, margin as hitungMargin, pisahkanPiutang, ringkasAging } from "@/features/finance/ringkasanKualitas.js";

// Ringkasan Keuangan — urutan layar (atas → bawah), redesain menyeluruh 1 Nov 2026 (gaya: styles/sanss-finance.css):
//   1. Judul, periode, strip status data  2. Empat KPI  3. Perlu ditindaklanjuti (pencatatan, saldo, persetujuan, bukti)  4. Saldo rekening
//   5. Laba rugi sementara + Tagihan pelanggan  6. Pencatatan terbaru + pemeriksaan/penjelasan (dibuka saat dibutuhkan)
//
// Halaman ini HANYA membaca. Semua angka datang dari API yang sudah ada (jurnal yang sudah dibukukan); tidak ada perhitungan akuntansi baru di sini.
// Sumber tambahan yang boleh gagal tanpa merobohkan halaman: saldo terkonfirmasi, order yang belum diakui, dan antrean bukti (ditandai "tidak tersedia", bukan 0).
// Cakupan waktu: KPI saldo/tagihan/utang = posisi terbaru; laba = periode terpilih; antrean pekerjaan = semua periode (backend tidak memfilternya).

export default function FinanceDashboard() {
  const navigate = useNavigate();
  const [periode, setPeriode] = usePeriodeFinance();
  const [data, setData] = useState(null);
  const [riil, setRiil] = useState(null);
  const [backfill, setBackfill] = useState(null);
  const [bukti, setBukti] = useState(null);
  const [galatBukti, setGalatBukti] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Hanya respons permintaan TERAKHIR yang boleh mengisi layar: respons periode lama yang terlambat tidak boleh menimpa periode yang baru dipilih.
  const urutan = useRef(0);

  const muat = useCallback(async () => {
    const saya = ++urutan.current;
    setLoading(true);
    setError(null);
    try {
      const [d, r, b, k] = await Promise.allSettled([api.getFinanceDashboard(periode), api.getFinanceSaldoRiil(), api.getFinanceRekonBackfill(), api.getFinanceReceiptReview()]);
      if (saya !== urutan.current) return;
      if (d.status === "rejected") throw d.reason;
      setData(d.value);
      setRiil(r.status === "fulfilled" ? r.value : null);
      setBackfill(b.status === "fulfilled" ? b.value : null);
      setBukti(k.status === "fulfilled" ? k.value : null);
    } catch (e) {
      if (saya !== urutan.current) return;
      setData(null);
      setError(e.message || "Gagal memuat ringkasan keuangan");
    } finally {
      if (saya === urutan.current) setLoading(false);
    }
  }, [periode]);

  useEffect(() => { muat(); }, [muat]);

  // Setelah memeriksa/memverifikasi satu bukti, hanya antrean bukti yang dimuat ulang.
  const aksiBukti = useCallback(async (fn) => {
    try {
      setGalatBukti(null);
      await fn();
      setBukti(await api.getFinanceReceiptReview());
    } catch (e) {
      setGalatBukti(e.message);
    }
  }, []);

  const kualitas = useMemo(() => (data ? hitungKualitasData({ antrean: data.antrean, catatan: data.catatan, backfill, riil }) : null), [data, backfill, riil]);
  const piutang = useMemo(() => (data ? pisahkanPiutang(data) : null), [data]);
  const aging = useMemo(() => (data ? ringkasAging(data.piutang) : null), [data]);
  const kelompok = useMemo(() => (data ? susunTindakLanjut({ antrean: data.antrean, kualitas, riil, bukti }) : []), [data, kualitas, riil, bukti]);
  const lr = data?.labaRugi;
  const marginInfo = kualitas && lr ? hitungMargin(kualitas, lr) : null;
  const periodeLabel = data ? `${tanggalPendek(data.periode?.from ?? periode.from)}–${tanggalPendek(data.periode?.to ?? periode.to)}` : "";

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Ringkasan Keuangan"
      subtitle={loading ? `Memuat data periode ${tanggalPendek(periode.from)}–${tanggalPendek(periode.to)}…` : data ? `Periode ${periodeLabel} · posisi keuangan dan hal yang perlu ditindaklanjuti.` : "Posisi keuangan dan hal yang perlu ditindaklanjuti."}
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

          {/* ── Empat KPI. Saldo/tagihan/utang = posisi tanggal buku hari ini WIB menurut server (tanggalnya tidak dikirim → tidak ditampilkan; tidak memakai jam perangkat); laba = rentang periode dari server. ── */}
          <section aria-label="Angka utama" className="fin-kpi-grid">
            <KpiKartu
              nada="biru" Ikon={IkKasBank} label="Saldo kas & bank" metrik="kas_bank_buku"
              nilai={formatUang(data.totalKas)} ket="Posisi terbaru"
              info={`Menurut pembukuan: jumlah saldo ${data.kasBank.length} rekening kas, bank, dan e-wallet aktif menurut jurnal di buku besar. Bukan saldo koran bank.`}
              catatanTanggal={`${LABEL_POSISI}. ${CATATAN_POSISI}`}
              onClick={() => navigate("/finance/cash")}
            />
            <KpiKartu
              nada="muda" Ikon={IkGrafik} label="Laba sementara" metrik="laba_bersih_sementara"
              nilai={formatUang(lr?.labaBersih ?? 0)} ket={`Periode terpilih · ${periodeLabel}`}
              penanda={(lr?.labaBersih ?? 0) < 0 ? "Rugi sementara" : null}
              info="Dari transaksi yang sudah dibukukan: pendapatan yang SUDAH dibukukan dikurangi seluruh biaya yang sudah dibukukan. Order yang sudah selesai tetapi belum diakui pendapatannya belum ikut; dampak data yang belum lengkap bisa berbeda pada saldo, biaya, dan laba. DP yang belum diserahkan tidak dihitung sebagai pendapatan."
              onClick={() => navigate("/finance/reports")}
            />
            <KpiKartu
              nada="lavender" Ikon={IkStruk} label="Tagihan pelanggan" metrik="piutang_usaha"
              nilai={formatUang(piutang.bukuBesar)} ket="Piutang · posisi terbaru"
              penanda={data.piutang.ringkasan?.["90_plus"] > 0 ? "Ada tagihan berumur > 90 hari" : null}
              info="Piutang dalam pembukuan: saldo Piutang Usaha menurut jurnal. Terdiri dari tagihan operasional (belum lunas menurut CRM) dan order yang sudah lunas di CRM tetapi pembayarannya belum diverifikasi. Bukan sama dengan pembayaran yang belum tercatat."
              catatanTanggal={`${LABEL_POSISI}. ${CATATAN_POSISI}`}
              onClick={() => navigate("/finance/receivables")}
            />
            <KpiKartu
              nada="lime" Ikon={IkPelangganNav} label="Tagihan supplier" metrik="utang_supplier"
              nilai={formatUang(data.utang.total)} ket="Utang usaha · posisi terbaru"
              info="Utang usaha: total tagihan supplier yang sudah disetujui tetapi belum dibayar — kebalikan dari piutang."
              catatanTanggal={`${LABEL_POSISI}. ${CATATAN_POSISI}`}
              onClick={() => navigate("/finance/suppliers")}
            />
          </section>

          <TindakLanjut kelompok={kelompok} bukti={bukti} galatBukti={galatBukti} aksiBukti={aksiBukti} navigate={navigate} />

          <SaldoRekening data={data} riil={riil} navigate={navigate} />

          <div className="fin-dua">
            <LabaRugiPanel lr={lr} penanda={data?.labaRugiPenanda} marginInfo={marginInfo} periodeLabel={periodeLabel} navigate={navigate} />
            <TagihanPelanggan piutang={piutang} aging={aging} teratas={data.piutang.teratas} navigate={navigate} />
          </div>

          <div className="fin-dua">
            <PencatatanTerbaru jurnal={data.jurnalTerakhir} navigate={navigate} />
            <PanelPendukung gate={data.gate} periode={periode} />
          </div>
        </div>
      )}
    </HalamanFinance>
  );
}
