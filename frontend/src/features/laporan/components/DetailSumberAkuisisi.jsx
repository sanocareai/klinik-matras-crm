import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, ExternalLink, Info } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import LogoSumber from "./LogoSumber.jsx";
import { verifikasiLabel, angka, formatPersen, rupiah, selBiayaSumber, statusBiayaTeks, sementaraTeks, teksPengecualian, BUKTI_LABEL, DASAR_BIAYA_LABEL, PENYEBUT_LABEL, selBiaya } from "../akuisisiLogic.js";
import { ringkasAsalBiaya, daftarPemilihan } from "../biayaIklanLogic.js";
import { jalurRincian, LABEL_PELANGGAN, teksPeriode } from "../periodeLaporan.js";

// Rincian SATU sumber. Membaca objek server yang sama dengan kartu/tabel/ekspor (satu definisi). Tidak ada tabel palsu: bagian yang tidak punya data diganti penjelasan.
const Baris = ({ k, v, sub, tebal }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1.5 last:border-0">
    <dt className="t-secondary text-[12.5px]">{k}</dt>
    <dd className={cn("m-0 text-right tabular-nums text-ink", tebal ? "text-[15px] font-semibold" : "text-[13px] font-medium")}>{v}{sub && <span className="t-secondary block text-[11px] font-normal">{sub}</span>}</dd>
  </div>
);
const Bagian = ({ judul, tip, children, className }) => (
  <Card className={cn("flex flex-col gap-1 !p-4", className)}>
    <h3 className="mb-1 inline-flex items-center gap-1 text-[14px] font-semibold text-ink">{judul}{tip && <InfoTooltip text={tip} />}</h3>
    <dl className="m-0">{children}</dl>
  </Card>
);
const Sel = ({ c }) => <span className={c.kosong ? "text-ink3" : ""}>{c.teks}</span>;

export default function DetailSumberAkuisisi({ s, lap, periode, onKembali, onBukaIklan, tanpaJejak = false, sisipanAtas = null }) {
  const b = s.biaya || {};
  const organik = s.jenis === "ORGANIK";
  const jalur = jalurRincian(s.id);
  const kc = s.biayaCampaignTerbukti;
  const asal = ringkasAsalBiaya(b.cakupan);
  const qs = periode?.ok ? `&from=${periode.dari}&to=${periode.sampai}` : "";
  const cpa = selBiayaSumber(s, "cpa"), booked = selBiayaSumber(s, "bookedRoas"), cash = selBiayaSumber(s, "cashRoas"), spend = selBiayaSumber(s, "spend"), cpl = selBiayaSumber(s, "cpl");
  const sementara = sementaraTeks(b);
  return (
    <div className="flex flex-col gap-4" data-testid="detail-sumber">
      {!tanpaJejak && <nav aria-label="Jejak" className="flex flex-wrap items-center gap-1 text-[13px]">
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={onKembali}><ArrowLeft size={14} /> Semua sumber</button>
        <ChevronRight size={14} className="text-ink3" /><span className="text-ink3">Akuisisi</span><ChevronRight size={14} className="text-ink3" /><span className="font-semibold text-ink" aria-current="page">{s.label}</span>
      </nav>}

      <div className="flex flex-wrap items-center gap-3">
        <LogoSumber id={s.id} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold leading-tight text-ink">{s.label}</h2>
          <p className="t-secondary text-[12.5px]">{BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"} · Periode lead masuk (WIB): <b>{periode?.ok ? teksPeriode(periode.dari, periode.sampai) : "—"}</b></p>
        </div>
        {s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil (&lt; {s.ambangSampel} lead)</Badge>}
      </div>

      {sisipanAtas}
      {sisipanAtas && <h3 className="-mb-2 text-[15px] font-semibold text-ink">Ringkasan label CRM <span className="t-secondary text-[12.5px] font-normal">· basis berbeda dari atribusi campaign di atas — jangan dipertukarkan</span></h3>}

      <div className="grid gap-3 md:grid-cols-2">
        <Bagian judul="Funnel label CRM: lead → lunas" tip="Customer unik. Lead = semua customer berlabel sumber ini yang dibuat di periode (spam ikut terhitung); lead sah = bukan spam/internal/B2B/karyawan. Ber-order ≠ sudah membayar.">
          <Baris k="Total lead label CRM (termasuk spam)" v={angka(s.lead)} sub={`${angka(s.leadSah)} sah · ${angka(s.spam)} spam (${formatPersen(s.spamPersen?.nilai)})`} tebal />
          <Baris k="Customer ber-order" v={angka(s.berOrder)} sub={`${formatPersen(s.konversiOrder?.nilai)} = ${angka(s.konversiOrder?.pembilang)} dari ${angka(s.konversiOrder?.penyebut)} ${PENYEBUT_LABEL[s.konversiOrder?.penyebutJenis] || "total lead"}`} />
          <Baris k="Konversi non-spam (label CRM)" v={formatPersen(s.konversiOrderNonSpam?.nilai)} sub={`${angka(s.konversiOrderNonSpam?.pembilang)} dari ${angka(s.konversiOrderNonSpam?.penyebut)} ${PENYEBUT_LABEL.LEAD_SAH_NON_SPAM}`} />
          <Baris k="Customer membayar" v={angka(s.membayar)} sub="≥ 1 pembayaran sah di ledger (terbukti ledger; cakupan ledger terpisah)" />
          <Baris k="Customer lunas terbukti ledger" v={angka(s.lunas)} sub="ledger menutup seluruh tagihan" />
          <p className="t-secondary mt-1 text-[11.5px]">{teksPengecualian(s)}</p>
        </Bagian>

        <Bagian judul="Pembayaran customer" tip="Pernah DP, DP saat ini, dan lunas bisa tumpang tindih (customer DP lalu lunas). Jangan dijumlahkan; pakai pembagian saling lepas.">
          <Baris k="Pernah DP" v={angka(s.pernahDp)} /><Baris k="DP saat ini" v={angka(s.dpSaatIni)} /><Baris k="Lunas" v={angka(s.lunas)} />
          <p className="t-secondary my-1 text-[11.5px]">Tumpang tindih — jangan dijumlahkan. Pembagian saling lepas (= {angka(s.kategoriEksklusif?.jumlah)} dari {angka(s.berOrder)} ber-order):</p>
          <Baris k="Lunas" v={angka(s.kategoriEksklusif?.lunas)} /><Baris k="DP" v={angka(s.kategoriEksklusif?.dpSaatIni)} />
          <Baris k="Tidak diketahui" v={angka(s.kategoriEksklusif?.tidakDiketahui)} sub="status bayar LUNAS/DP tersimpan tanpa pembayaran di ledger" /><Baris k="Belum bayar" v={angka(s.kategoriEksklusif?.belumBayar)} />
        </Bagian>

        <Bagian judul="Nilai order & uang tercatat" tip="Nilai order = Σ nilai order eligible kohort lead (nilai SAAT INI, bukan histori). Pembayaran bersih = pembayaran sah di ledger − refund disetujui. Keduanya BERBEDA: jangan dicampur.">
          <Baris k="Nilai order (kohort lead)" v={rupiah(s.uang?.nilaiOrderSaatIni)} sub="dari order eligible; bukan uang masuk" tebal />
          <Baris k="Pembayaran tercatat bersih" v={rupiah(s.uang?.uangBersih)} sub={`ledger ${rupiah(s.uang?.uangLedger)} − refund ${rupiah(s.uang?.refund)}`} tebal />
          <Baris k="Order eligible" v={angka(s.order?.eligible)} sub={`${angka(s.order?.berLedger)} punya pembayaran di ledger (${formatPersen(s.order?.persenBerLedger)})`} />
          <p className="t-secondary mt-1 text-[11.5px]">Cakupan ledger tidak 100%: pembayaran di luar sistem tidak terlihat, sehingga pembayaran tercatat adalah batas bawah.</p>
        </Bagian>

        <Bagian judul={`Biaya & efisiensi — ${DASAR_BIAYA_LABEL}`} tip="Biaya sumber untuk periode yang sama ÷ hasil kohort berlabel sumber ini. BUKAN CPA campaign: tidak ada bukti klik per iklan. CPA = biaya ÷ customer UNIK lunas. Booked ROAS = nilai order ÷ biaya; Cash ROAS = pembayaran bersih ÷ biaya.">
          {organik ? (
            <p className="text-[13px] text-ink2">Biaya tidak tersedia — sumber organik tidak punya biaya iklan yang dialokasikan (bukan Rp0).</p>
          ) : (
            <>
              <Baris k="Status biaya" v={statusBiayaTeks(b.status)} sub={asal.join(" · ") || null} />
              {b.cakupan?.verifikasi && <Baris k="Verifikasi kelengkapan" v={verifikasiLabel(b.cakupan.verifikasi)} sub={b.cakupan.verifikasi.catatan} />}
              <Baris k="Biaya iklan" v={<Sel c={spend} />} sub={spend.alasan} tebal />
              <Baris k="Biaya per lead" v={<Sel c={cpl} />} sub={cpl.alasan} />
              <Baris k="CPA lunas" v={<Sel c={cpa} />} sub={cpa.alasan} tebal />
              <Baris k="Booked ROAS" v={<Sel c={booked} />} sub={booked.alasan} />
              <Baris k="Cash ROAS" v={<Sel c={cash} />} sub={cash.alasan} />
              <ul aria-label="Sumber biaya yang dipakai dan alasannya" className="mt-1 space-y-0.5 text-[11.5px]">
                {daftarPemilihan(b.cakupan).map((p) => <li key={p.kunci} className={p.peringatan ? "text-orange" : "t-secondary"}>{p.hari != null ? <b>{p.hari} hari · </b> : null}{p.teks}</li>)}
              </ul>
              {sementara && <p className="mt-1 flex items-start gap-1.5 text-[12px] text-orange"><Info size={13} className="mt-0.5 shrink-0" /> SEMENTARA — {sementara}. Bukan CPA final.</p>}
              {(b.cakupan?.hariHilang || []).length > 0 && <p className="t-secondary mt-1 text-[11.5px]">Hari belum ada biaya: {b.cakupan.hariHilang.slice(0, 14).join(", ")}{b.cakupan.hariHilang.length > 14 ? ` … (+${b.cakupan.hariHilang.length - 14})` : ""}</p>}
              {(b.cakupan?.biayaBulananPengaturan || []).length > 0 && <p className="t-secondary mt-1 text-[11.5px]">Biaya bulanan Pengaturan Sales: {b.cakupan.biayaBulananPengaturan.map((x) => `${String(x.bulan).padStart(2, "0")}/${x.tahun} ${rupiah(x.nominal)}${x.dipakai ? " (dipakai)" : " (tidak dipakai)"}`).join("; ")}</p>}
              {(b.entri || []).length > 0 && (
                <div className="mt-2"><p className="mb-1 text-[12px] font-semibold text-ink">Entri manual pada periode</p>
                  <ul className="space-y-0.5 text-[12px] text-ink2">{b.entri.map((e) => <li key={e.id}>{e.jenis === "HARIAN" ? e.dari : `${e.dari} – ${e.sampai}`} · {rupiah(e.nominal)}{e.gantiDetailAd ? " · ganti detail Ad" : ""}{e.akun ? ` · akun ${e.akun}` : ""} <span className="t-secondary">(rev {e.revisi})</span></li>)}</ul>
                </div>
              )}
            </>
          )}
        </Bagian>
      </div>

      <Bagian judul="Rincian lebih dalam" className="gap-2">
        <p className="text-[12.5px] text-ink2">{jalur.penjelasan}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {jalur.campaign && onBukaIklan && <button type="button" className="btn btn-primary btn-sm" onClick={onBukaIklan}>Lihat per campaign → ad set → ad</button>}
          <Link className="btn btn-ghost btn-sm" to={`/customers?source=${encodeURIComponent(LABEL_PELANGGAN[s.id] || "OTHER")}${qs}`}><ExternalLink size={13} /> Daftar customer sumber ini</Link>
        </div>
        {s.id === "META" && kc && (
          <div className="mt-2 rounded-btn bg-inset p-3 text-[12.5px] text-ink2">
            <p className="font-semibold text-ink">Angka campaign terbukti (terpisah dari atribusi label CRM) <InfoTooltip text="Hanya campaign dengan touch CTWA terbukti dan pemetaan Ad ID. Dasar dan penyebutnya berbeda dari angka di atas; keduanya tidak boleh dipertukarkan." /></p>
            <p>Spend {selBiaya(kc, "spend").teks} · CPA {selBiaya(kc, "cpa").teks} · Booked ROAS {selBiaya(kc, "bookedRoas").teks} · Cash ROAS {selBiaya(kc, "cashRoas").teks} <span className="t-secondary">· status {statusBiayaTeks(kc.status)}</span></p>
            <p className="t-secondary">Label CRM {angka(s.lead)} lead vs atribusi terbukti {angka(lap?.status?.atribusi?.metaAkuisisiTerbukti)} — selisih berarti sebagian lead berlabel Meta belum punya bukti klik.</p>
          </div>
        )}
      </Bagian>
    </div>
  );
}
