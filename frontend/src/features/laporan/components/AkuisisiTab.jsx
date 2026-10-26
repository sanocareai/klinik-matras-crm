import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, GitCompare, Info, Loader2, RefreshCw, Wallet } from "lucide-react";
import { api } from "@/api.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { todayWIB } from "@/lib/dateRange.js";
import { cn } from "@/lib/utils.js";
import {
  METRIK_URUT, urutkan, tampilMetrik, selBiayaSumber, selTotalBerbayar, penandaPerSumber, bannerUtama, statusMembayar, peringatanUrut, delta, deltaTeks, angka, formatPersen, rupiah, BUKTI_LABEL,
  teksSorotan, teksPengecualianTotal, NOTA_AMBANG, teksCutoff, sementaraTeks, ringkasBiayaBerbayar, statusBiayaTeks, buatCsvAkuisisi, namaBerkasCsv, sumberBerbiaya, DASAR_BIAYA_LABEL,
} from "../akuisisiLogic.js";
import { periodeTab } from "../periodeLaporan.js";
import LogoSumber from "./LogoSumber.jsx";
import BannerPeriode from "./BannerPeriode.jsx";
import DetailSumberAkuisisi from "./DetailSumberAkuisisi.jsx";
import KelolaBiayaIklan from "./KelolaBiayaIklan.jsx";

// ═══ PERFORMA AKUISISI (ADMIN) ════════════════════════════════════════════════════════════════════
// Sumber: GET /api/atribusi/iklan/sumber (baca-saja). Sumber = LABEL CRM; hanya Meta punya atribusi per klik terbukti. Klien tidak menghitung apa pun: ia menampilkan, mengurutkan, dan memformat
// angka dari server. Periode = filter global Laporan (SATU state: lihat periodeLaporan.js). CPA/ROAS sumber = "Atribusi label CRM" (biaya sumber ÷ kohort label CRM), BUKAN CPA campaign.
// null (—) selalu disertai alasan; organik = "biaya tidak tersedia", bukan Rp0.

const NADA = { peringatan: "text-orange", baik: "text-green" };
const TIP = {
  sumber: "Sumber = label CRM (Customer.leadSource). Bukan bukti per klik: hanya Meta yang juga punya atribusi terbukti (touch CTWA).",
  lead: "Customer baru yang dibuat di periode dengan label sumber itu. Spam ikut terhitung di sini; lead sah = bukan spam/internal/B2B/karyawan.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer dengan ≥ 1 pembayaran sah di ledger. Batas bawah: pembayaran di luar sistem tidak terlihat.",
  lunas: "Customer dengan order yang ledger-nya menutup seluruh tagihan (setelah refund disetujui).",
  nilai: "Σ nilai order eligible dari kohort lead periode ini (nilai SAAT INI). Bukan uang masuk.",
  bayar: "Pembayaran sah di ledger dikurangi refund disetujui, untuk kohort lead periode ini. Bukan nilai order.",
  biaya: "Total biaya sumber berbayar pada periode yang sama. Hanya dihitung bila SEMUA sumber berbayar terisi SETIAP hari (detail Ad, entri harian, atau total rentang); selain itu —. 'Terisi setiap hari' BUKAN verifikasi independen: kelengkapan per-Ad hanya dapat dibandingkan dengan total kontrol yang diinput Admin.",
  cpa: "Biaya sumber ÷ customer UNIK lunas (kohort lead periode ini). Dasar: Atribusi label CRM — bukan CPA campaign. 'Sementara' bila ledger parsial atau kohort < 30 hari.",
  booked: "Booked ROAS = nilai order ÷ biaya. Belum tentu uang diterima.",
  cash: "Cash ROAS = pembayaran tercatat bersih ÷ biaya. Batas bawah bila ledger tidak lengkap.",
  konversi: "UTAMA: customer ber-order ÷ TOTAL lead (termasuk spam). Kolom 'non-spam' = ber-order ÷ lead sah (metrik terpisah). Pembilang dan penyebut ditampilkan. 'Sampel kecil' = < 30 lead — aturan tampilan sementara, bukan uji signifikansi.",
};

function Kartu({ judul, nilai, sub, nada, tip, aksi, badge, kecil = false }) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 !p-4">
      <span className="t-secondary inline-flex items-center gap-1 text-[12.5px]">{judul}{tip && <InfoTooltip text={tip} />}{badge}</span>
      <span className={cn("font-semibold leading-tight tabular-nums text-ink", kecil ? "whitespace-nowrap text-[19px] sm:text-[20px]" : "text-[24px] [overflow-wrap:anywhere] sm:text-[26px]", nada)}>{nilai}</span>
      {sub && <span className="t-secondary text-[12px]">{sub}</span>}
      {aksi}
    </Card>
  );
}
const SelBiaya = ({ c, organik }) => (
  <td className={cn("px-3 py-2 text-right tabular-nums", c.kosong && "text-ink3")}>
    {organik ? <span className="text-[11px]">tidak tersedia</span> : <>{c.teks}{c.sementara && <span className="block text-[10.5px] text-orange">sementara</span>}{c.alasan && <span className="block text-[10.5px]">{c.alasan}</span>}</>}
  </td>
);
const Sementara = () => <Badge variant="orange" className="normal-case">Sementara</Badge>;

function KartuSumber({ s, metrik, metrikLabel, penanda, delta: d, onBuka }) {
  const [lebih, setLebih] = useState(false);
  const t = tampilMetrik(s, metrik);
  const cpa = selBiayaSumber(s, "cpa"), cash = selBiayaSumber(s, "cashRoas"), booked = selBiayaSumber(s, "bookedRoas"), spend = selBiayaSumber(s, "spend");
  const baris = [["Lead", angka(s.lead)], ["Spam", formatPersen(s.spamPersen?.nilai)], ["Ber-order", angka(s.berOrder)], ["Membayar / lunas", `${angka(s.membayar)} / ${angka(s.lunas)}`],
    ["Nilai order", rupiah(s.uang?.nilaiOrderSaatIni)], ["Pembayaran bersih", rupiah(s.uang?.uangBersih)], ["Biaya iklan", s.jenis === "ORGANIK" ? "tidak tersedia" : spend.teks]];
  return (
    <Card className="flex h-full min-w-0 flex-col gap-2 !p-3 sm:!p-4" data-testid={`kartu-${s.id}`}>
      <button type="button" onClick={onBuka} className="flex items-center gap-3 text-left" aria-label={`Buka rincian ${s.label}`}>
        <LogoSumber id={s.id} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{s.label}</span>
          <span className="t-secondary block text-[11px]">{BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-ink3" />
      </button>
      {((penanda || []).length > 0 || s.sampelKecil) && (
        <div className="flex flex-wrap items-center gap-1">
          {(penanda || []).map((p) => <Badge key={p.id} variant="green" className="normal-case" title={teksSorotan(p)}>{p.label}</Badge>)}
          {s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}
        </div>
      )}
      <div>
        <p className="t-secondary text-[12px]">{metrikLabel}</p>
        <span className={cn("text-[22px] font-semibold tabular-nums leading-tight sm:text-[24px]", t.kosong ? "text-ink3" : "text-ink")}>{t.utama}</span>
        {d != null && <span className="t-secondary ml-2 text-[12px]">{deltaTeks(d)} vs sebelumnya</span>}
        {t.sub && <p className="t-secondary text-[12px]">{t.sub}</p>}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] [&_dd]:m-0">
        {baris.map(([k, v]) => <div key={k} className="min-w-0"><dt className="t-secondary">{k}</dt><dd className="truncate font-medium tabular-nums text-ink" title={String(v)}>{v}</dd></div>)}
      </dl>
      <button type="button" className="inline-flex items-center gap-1 self-start text-[12px] text-accent hover:underline" aria-expanded={lebih} onClick={() => setLebih((v) => !v)}>
        {lebih ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {lebih ? "Sembunyikan detail" : "Detail konversi & efisiensi"}
      </button>
      {lebih && (
        <div className="flex flex-col gap-1 rounded-btn bg-inset p-2.5 text-[12px] text-ink2">
          {(penanda || []).filter((p) => p.jenis === "KONVERSI_BER_ORDER_PER_TOTAL_LEAD").map((p) => (
            <p key={p.id} className="t-secondary text-[11px] leading-snug">Konversi ber-order {formatPersen(p.nilai)} = {angka(p.pembilang)} dari {angka(p.penyebut)} total lead (termasuk spam). Ambang {s.ambangSampel} lead = aturan tampilan sementara; bukan uji signifikansi, bukan pemenang pasti.</p>
          ))}
          <p>Konversi ÷ lead: <b>{formatPersen(s.konversiOrder?.nilai)}</b> ({s.konversiOrder?.pembilang}/{s.konversiOrder?.penyebut}) · non-spam <b>{formatPersen(s.konversiOrderNonSpam?.nilai)}</b> ({s.konversiOrderNonSpam?.pembilang}/{s.konversiOrderNonSpam?.penyebut})</p>
          {s.jenis === "ORGANIK" ? <p>Biaya tidak tersedia (organik).</p> : (
            <p>{DASAR_BIAYA_LABEL}: CPA lunas <b className={cpa.kosong ? "text-ink3" : ""}>{cpa.teks}</b>{cpa.alasan && <span className="t-secondary"> ({cpa.alasan})</span>} · Booked <b className={booked.kosong ? "text-ink3" : ""}>{booked.teks}</b> · Cash <b className={cash.kosong ? "text-ink3" : ""}>{cash.teks}</b>{sementaraTeks(s.biaya) && <span className="text-orange"> · sementara</span>}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function AkuisisiTab({ range, onUbahRentang, sumberId, onPilihSumber, onKembaliSumber, onBukaIklan }) {
  const hariIni = useMemo(() => todayWIB().format("YYYY-MM-DD"), []);
  const periode = useMemo(() => periodeTab(range, hariIni), [range, hariIni]);
  const [metrik, setMetrik] = useState("berOrder");
  const [bandingkan, setBandingkan] = useState(false);
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [lihatCatatan, setLihatCatatan] = useState(false);
  const [kelola, setKelola] = useState(null);   // null | { sumber }

  const muat = useCallback(async () => {
    if (!periode.ok) { setLap(null); setGalat(null); return; }
    setMemuat(true); setGalat(null);
    try {
      setLap(await api.getAtribusiSumber({ dari: periode.dari, sampai: periode.sampai, ...(bandingkan ? { pembanding: "1" } : {}) }));
    } catch (e) {
      setLap(null);
      setGalat(e?.status === 429 ? "Laporan sedang dihitung untuk permintaan lain — coba lagi sebentar." : (e?.message || "Gagal memuat performa akuisisi."));
    } finally { setMemuat(false); }
  }, [periode.ok, periode.dari, periode.sampai, bandingkan]);
  useEffect(() => { muat(); }, [muat]);

  const urut = useMemo(() => urutkan(lap?.sumber || [], metrik), [lap, metrik]);
  const penanda = useMemo(() => penandaPerSumber(lap?.sorotan), [lap]);
  const banner = bannerUtama(lap);
  const bayar = statusMembayar(lap);
  const catatan = useMemo(() => peringatanUrut(lap), [lap]);
  const t = lap?.total;
  const bb = t?.berbayar;
  const rb = ringkasBiayaBerbayar(lap);
  const cpaT = selTotalBerbayar(bb, "cpa"), bookedT = selTotalBerbayar(bb, "bookedRoas"), cashT = selTotalBerbayar(bb, "cashRoas"), spendT = selTotalBerbayar(bb, "spend");
  const terpilih = sumberId ? (lap?.sumber || []).find((x) => x.id === sumberId) : null;

  function ekspor() {
    const csv = buatCsvAkuisisi(lap); if (!csv) return;
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = namaBerkasCsv(lap); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const aksiBiaya = (
    <button type="button" className="btn btn-primary btn-sm" onClick={() => setKelola({ sumber: terpilih && sumberBerbiaya(terpilih) ? terpilih.id : "TIKTOK" })}><Wallet size={14} /> Kelola biaya iklan</button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-[22px] font-semibold leading-tight text-ink">Performa Akuisisi</h2>
          <BannerPeriode periode={periode} hariIni={hariIni} onUbahRentang={onUbahRentang} cutoff={teksCutoff(lap)} ringkas={!!terpilih} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={muat} disabled={memuat || !periode.ok}>{memuat ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</button>
          {!terpilih && <button className={cn("btn btn-sm", bandingkan ? "btn-primary" : "btn-ghost")} aria-pressed={bandingkan} onClick={() => setBandingkan((v) => !v)} disabled={!periode.ok}><GitCompare size={14} /> Bandingkan</button>}
          <button className="btn btn-ghost btn-sm" onClick={ekspor} disabled={!lap}><Download size={14} /> Ekspor CSV</button>
          {aksiBiaya}
        </div>
      </div>

      {galat && <Card><p className="flex items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat}</p></Card>}
      {periode.ok && !lap && memuat && <Card><p className="flex items-center gap-2 text-sm text-ink3"><Loader2 size={16} className="animate-spin" /> Memuat…</p></Card>}
      {banner && !terpilih && <div role="status" className="flex items-center gap-2 rounded-card bg-orangebg px-4 py-2.5 text-[13px] font-medium text-orange"><AlertTriangle size={16} /> {banner}</div>}

      {lap && sumberId && !terpilih && (
        <Card className="flex flex-col gap-2 !p-4"><p className="text-[13px] text-ink2">Sumber “{sumberId}” tidak dikenal pada laporan ini.</p><button className="btn btn-ghost btn-sm self-start" onClick={onKembaliSumber}>Kembali ke semua sumber</button></Card>
      )}

      {lap && terpilih && (
        <DetailSumberAkuisisi s={terpilih} lap={lap} periode={periode} onKembali={onKembaliSumber} onBukaIklan={onBukaIklan} />
      )}

      {lap && !terpilih && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kartu judul="Lead masuk" nilai={angka(t.lead)} sub={`${angka(t.leadSah)} sah · ${angka(t.spam)} spam`} tip={TIP.lead} />
            <Kartu judul="Customer ber-order" nilai={angka(t.berOrder)} sub={`dari ${angka(t.leadSah)} lead sah`} tip={TIP.berOrder} />
            <Kartu judul="Customer membayar" nilai={bayar.lengkap ? angka(t.membayar) : "Belum lengkap"} nada={bayar.lengkap ? "" : NADA.peringatan}
              sub={bayar.lengkap ? "pembayaran sah di ledger" : `≥ ${angka(t.membayar)} terbukti · ${bayar.teks}`} tip={TIP.membayar} />
            <Kartu judul="Customer lunas" nilai={bayar.lengkap ? angka(t.lunas) : `≥ ${angka(t.lunas)}`} sub="ledger menutup seluruh tagihan" tip={TIP.lunas} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="kartu-uang">
            <Kartu kecil judul="Nilai order" nilai={rupiah(t.nilaiOrderSaatIni)} sub="kohort lead · nilai saat ini" tip={TIP.nilai} />
            <Kartu kecil judul="Pembayaran tercatat bersih" nilai={rupiah(t.uangBersih)} sub="ledger − refund · bukan nilai order" tip={TIP.bayar} />
            <Kartu kecil judul="Biaya iklan (berbayar)" nilai={spendT.teks} nada={spendT.kosong ? "text-ink3" : ""} sub={spendT.kosong ? (spendT.alasan || "belum lengkap") : `${rb?.jumlah ?? 0} sumber berbayar`} tip={TIP.biaya}
              aksi={spendT.kosong && rb?.belum?.length ? <span className="t-secondary text-[11px]">{rb.belum.map((x) => `${x.id}: ${statusBiayaTeks(x.status).toLowerCase()}`).join(" · ")}</span> : null} />
            <Kartu kecil judul="CPA lunas" nilai={cpaT.teks} nada={cpaT.kosong ? "text-ink3" : ""} sub={cpaT.kosong ? cpaT.alasan : DASAR_BIAYA_LABEL} tip={TIP.cpa} badge={cpaT.sementara ? <Sementara /> : null} />
            <Kartu kecil judul="Booked ROAS" nilai={bookedT.teks} nada={bookedT.kosong ? "text-ink3" : ""} sub={bookedT.kosong ? bookedT.alasan : "nilai order ÷ biaya"} tip={TIP.booked} badge={bookedT.sementara ? <Sementara /> : null} />
            <Kartu kecil judul="Cash ROAS" nilai={cashT.teks} nada={cashT.kosong ? "text-ink3" : ""} sub={cashT.kosong ? cashT.alasan : "pembayaran bersih ÷ biaya"} tip={TIP.cash} badge={cashT.sementara ? <Sementara /> : null} />
          </div>
          <p className="t-secondary -mt-2 text-[12px]">Cakupan ledger: <b>{formatPersen(lap.status?.ledger?.persen)}</b> order eligible punya pembayaran di ledger · {catatan.length} catatan data{" "}
            <button className="text-accent hover:underline" onClick={() => setLihatCatatan((v) => !v)}>{lihatCatatan ? "sembunyikan" : "lihat detail →"}</button></p>

          {lihatCatatan && (
            <Card className="flex flex-col gap-2 !p-4">
              {catatan.map((w, i) => (
                <p key={`${w.kode}-${i}`} className="flex items-start gap-2 text-[12.5px] text-ink2"><Info size={14} className="mt-0.5 shrink-0 text-accent" /> <span><b>{w.kode.replace(/_/g, " ").toLowerCase()}</b> — {w.pesan}</span></p>
              ))}
              <p className="t-secondary text-[12px]">Status: biaya Meta <b>{lap.status?.spend}</b> · atribusi mulai <b>{lap.status?.atribusi?.mulaiHari || "belum ada"}</b> · Meta label CRM {angka(lap.status?.atribusi?.metaLabelCrm)} vs terbukti {angka(lap.status?.atribusi?.metaAkuisisiTerbukti)}</p>
            </Card>
          )}

          <section aria-label="Sumber" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-[16px] font-semibold text-ink">Sumber</h3>
                <p className="t-secondary text-[12.5px]">Urut berdasarkan <b>{METRIK_URUT.find((m) => m.id === metrik)?.label?.toLowerCase()}</b>; sumber dengan sampel kecil (&lt; 30 lead) tidak dibandingkan pada rasio. Klik sumber untuk rincian.</p>
              </div>
              <label className="flex w-full min-w-0 items-center gap-2 text-[12.5px] text-ink2 sm:inline-flex sm:w-auto">Urutkan
                <select className="min-w-0 max-w-full flex-1 rounded-btn bg-inset px-2 py-1.5 text-[13px] text-ink sm:flex-none" value={metrik} onChange={(e) => setMetrik(e.target.value)} aria-label="Urutkan peringkat menurut">
                  {METRIK_URUT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
              {urut.map((s) => <KartuSumber key={s.id} s={s} metrik={metrik} metrikLabel={METRIK_URUT.find((m) => m.id === metrik)?.label} penanda={penanda.get(s.id)} delta={bandingkan ? delta(lap, s.id, metrik === "lead" ? "lead" : metrik === "membayar" ? "membayar" : metrik === "lunas" ? "lunas" : "berOrder") : null} onBuka={() => onPilihSumber(s.id)} />)}
            </div>
          </section>

          {/* desktop/tablet: tabel perbandingan (mobile memakai kartu di atas) */}
          <section aria-label="Tabel perbandingan sumber" className="hidden flex-col gap-2 md:flex">
            <h3 className="text-[16px] font-semibold text-ink">Perbandingan sumber</h3>
            <Card className="overflow-x-auto !p-0">
              <table className="w-full min-w-[1080px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink3">
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Sumber</th>
                    <th className="px-3 py-2 text-right">Lead</th><th className="px-3 py-2 text-right">Spam</th><th className="px-3 py-2 text-right">Ber-order</th>
                    <th className="px-3 py-2 text-right">Membayar</th><th className="px-3 py-2 text-right">Lunas</th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">Konversi ÷ lead <InfoTooltip text={TIP.konversi} /></span></th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">Nilai order <InfoTooltip text={TIP.nilai} /></span></th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">Pembayaran bersih <InfoTooltip text={TIP.bayar} /></span></th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">Biaya <InfoTooltip text={TIP.biaya} /></span></th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">CPA lunas <InfoTooltip text={TIP.cpa} /></span></th>
                    <th className="px-3 py-2 text-right">Booked</th><th className="px-3 py-2 text-right">Cash</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {urut.map((s, i) => {
                    const spend = selBiayaSumber(s, "spend"), cpa = selBiayaSumber(s, "cpa"), booked = selBiayaSumber(s, "bookedRoas"), cash = selBiayaSumber(s, "cashRoas");
                    const organik = s.jenis === "ORGANIK";
                                    return (
                      <tr key={s.id} className="cursor-pointer border-b border-line/60 hover:bg-inset/60" onClick={() => onPilihSumber(s.id)}>
                        <td className="px-3 py-2 tabular-nums text-ink3">{i + 1}</td>
                        <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><LogoSumber id={s.id} size={28} /><span className="font-medium text-ink">{s.label}</span>{s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{angka(s.lead)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={`${s.spamPersen?.pembilang} dari ${s.spamPersen?.penyebut} lead`}>{formatPersen(s.spamPersen?.nilai)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{angka(s.berOrder)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{angka(s.membayar)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{angka(s.lunas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" title={`${s.konversiOrder?.pembilang} dari ${s.konversiOrder?.penyebut} total lead (termasuk spam)`}>{formatPersen(s.konversiOrder?.nilai)}<span className="t-secondary block text-[10.5px]">{s.konversiOrder?.pembilang}/{s.konversiOrder?.penyebut}</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{rupiah(s.uang?.nilaiOrderSaatIni)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rupiah(s.uang?.uangBersih)}</td>
                        <SelBiaya c={spend} organik={organik} /><SelBiaya c={cpa} organik={organik} /><SelBiaya c={booked} organik={organik} /><SelBiaya c={cash} organik={organik} />
                        <td className="px-3 py-2 text-ink3"><ChevronRight size={16} /></td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-line font-semibold text-ink">
                    <td className="px-3 py-2" /><td className="px-3 py-2">Total semua sumber</td>
                    <td className="px-3 py-2 text-right tabular-nums">{angka(t.lead)}</td><td className="px-3 py-2 text-right tabular-nums">{formatPersen(t.lead ? Math.round((t.spam / t.lead) * 10000) / 100 : null)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{angka(t.berOrder)}</td><td className="px-3 py-2 text-right tabular-nums">{angka(t.membayar)}</td><td className="px-3 py-2 text-right tabular-nums">{angka(t.lunas)}</td>
                    <td className="px-3 py-2" /><td className="px-3 py-2 text-right tabular-nums">{rupiah(t.nilaiOrderSaatIni)}</td><td className="px-3 py-2 text-right tabular-nums">{rupiah(t.uangBersih)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{spendT.teks}</td><td className="px-3 py-2 text-right tabular-nums">{cpaT.teks}</td><td className="px-3 py-2 text-right tabular-nums">{bookedT.teks}</td><td className="px-3 py-2 text-right tabular-nums">{cashT.teks}</td><td />
                  </tr>
                </tbody>
              </table>
            </Card>
            <p className="t-secondary text-[11.5px]">Baris total biaya/CPA/ROAS hanya untuk sumber berbayar dan hanya bila semuanya lengkap; organik tidak punya biaya dialokasikan. Dasar: {DASAR_BIAYA_LABEL}.</p>
          </section>

          <div className="t-secondary flex flex-col gap-1 text-[12.5px]">
            <p>{teksPengecualianTotal(lap)}</p>
            <p>{NOTA_AMBANG}</p>
          </div>
          <p className="t-secondary flex items-center gap-2 text-[12.5px]"><Info size={14} className="text-accent" /> Ber-order ≠ lunas. Sumber = label CRM; nilai order = nilai saat ini; angka dihitung server dari data aktual. {lap.pembanding ? `Pembanding: ${lap.pembanding.periode.dari} s/d ${lap.pembanding.periode.sampai}.` : ""}</p>
        </>
      )}

      {kelola && <KelolaBiayaIklan open onOpenChange={(o) => { if (!o) setKelola(null); }} periode={periode} hariIni={hariIni} sumberAwal={kelola.sumber} onTersimpan={muat} />}
    </div>
  );
}
