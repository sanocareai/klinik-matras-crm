import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Columns3, Download, GitCompare } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { METRIK_URUT, urutkan, penandaPerSumber, teksSorotan, angka, formatPersen, rupiah, selBiayaSumber, selTotalBerbayar, delta, deltaTeks, DASAR_BIAYA_LABEL, BUKTI_LABEL, sementaraTeks } from "../../akuisisiLogic.js";
import { KOLOM_SUMBER, kolomTampil, konversiTotal } from "../../marketingLogic.js";
import LogoSumber from "../LogoSumber.jsx";

// Peringkat semua sumber (label CRM). Desktop: tabel (kolom utama; tambahan via "Kolom lengkap"). Mobile: kartu ringkas yang dapat dibuka. Klien hanya menampilkan/mengurutkan angka server.
// Sumber tanpa hasil TETAP tampil (lead 0 bukan dihilangkan). Biaya organik = "tidak tersedia", bukan Rp0. Konversi UTAMA = ber-order ÷ TOTAL lead (termasuk spam); non-spam kolom terpisah.
export const TIP = {
  lead: "Customer baru dibuat di periode dengan label sumber itu. Spam ikut terhitung; lead sah = bukan spam/internal/B2B/karyawan.",
  spam: "Persentase lead sumber ini yang ditandai SPAM. Diagnostik kualitas targeting — bukan penalti.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer dengan ≥ 1 pembayaran sah di ledger. Batas bawah: pembayaran di luar sistem tidak terlihat.",
  lunas: "Customer dengan order yang ledger-nya (setelah refund disetujui) menutup seluruh tagihan.",
  nilai: "Σ nilai order eligible kohort lead periode ini (nilai SAAT INI). Bukan uang diterima dan bukan laba.",
  uang: "Pembayaran sah di ledger dikurangi refund disetujui, kohort lead periode ini. Bukan nilai order, bukan laba.",
  spend: "Biaya sumber pada periode yang sama; terisi hanya bila lengkap setiap hari (detail Ad, entri harian, atau total rentang). Kosong ≠ Rp0. Terisi ≠ diverifikasi independen.",
  konversi: "UTAMA: customer ber-order ÷ TOTAL lead (termasuk spam); pembilang/penyebut ditampilkan. 'Sampel kecil' = < 30 lead — aturan tampilan sementara, bukan uji signifikansi.",
  konversiNonSpam: "Terpisah dari konversi utama: customer ber-order ÷ lead sah (tanpa spam/staf/karyawan).",
  cpa: "Biaya sumber ÷ customer UNIK lunas (kohort lead periode ini). Dasar: Atribusi label CRM — bukan CPA campaign. 'Sementara' bila ledger parsial atau kohort < 30 hari.",
  booked: "Booked ROAS = nilai order ÷ biaya. Belum tentu uang diterima.",
  cash: "Cash ROAS = uang diterima bersih ÷ biaya. Batas bawah bila ledger tidak lengkap.",
};

const BUKAN_BIAYA = "tidak tersedia";
/** Nilai satu sel: { t, sub, kosong, title }. Satu fungsi untuk tabel desktop dan kartu mobile (angka identik). */
export function selSumber(s, id, { banding = false, lap } = {}) {
  const organik = s.jenis === "ORGANIK";
  const d = (kunci) => (banding ? deltaTeks(delta(lap, s.id, kunci)) : null);
  const biaya = (kunci) => {
    if (organik) return { t: BUKAN_BIAYA, kosong: true };
    const c = selBiayaSumber(s, kunci);
    return { t: c.teks, kosong: c.kosong, sub: c.sementara ? `sementara${c.alasan ? ` · ${c.alasan}` : ""}` : c.alasan || null };
  };
  switch (id) {
    case "lead": return { t: angka(s.lead), sub: d("lead") ? `${d("lead")} vs sebelumnya` : null };
    case "spam": return { t: formatPersen(s.spamPersen?.nilai), sub: `${angka(s.spam)} lead`, title: `${s.spamPersen?.pembilang} dari ${s.spamPersen?.penyebut} lead` };
    case "berOrder": return { t: angka(s.berOrder), sub: d("berOrder") ? `${d("berOrder")} vs sebelumnya` : null };
    case "membayar": return { t: angka(s.membayar), sub: d("membayar") ? `${d("membayar")} vs sebelumnya` : null };
    case "lunas": return { t: angka(s.lunas), sub: d("lunas") ? `${d("lunas")} vs sebelumnya` : null };
    case "nilai": return { t: rupiah(s.uang?.nilaiOrderSaatIni) };
    case "uang": return { t: rupiah(s.uang?.uangBersih) };
    case "spend": return biaya("spend");
    case "konversi": return { t: formatPersen(s.konversiOrder?.nilai), kosong: s.konversiOrder?.nilai == null, sub: `${s.konversiOrder?.pembilang}/${s.konversiOrder?.penyebut}${s.sampelKecil ? " · sampel kecil" : ""}`, title: `${s.konversiOrder?.pembilang} dari ${s.konversiOrder?.penyebut} total lead (termasuk spam)` };
    case "konversiNonSpam": return { t: formatPersen(s.konversiOrderNonSpam?.nilai), kosong: s.konversiOrderNonSpam?.nilai == null, sub: `${s.konversiOrderNonSpam?.pembilang}/${s.konversiOrderNonSpam?.penyebut}` };
    case "cpa": return biaya("cpa");
    case "booked": return biaya("bookedRoas");
    case "cash": return biaya("cashRoas");
    default: return { t: "—", kosong: true };
  }
}
/** Sel baris TOTAL (semua sumber). Biaya/CPA/ROAS = total sumber berbayar dari server (pembilang dan penyebut total); organik tidak punya biaya dialokasikan. */
export function selTotal(lap, id) {
  const t = lap?.total; if (!t) return { t: "—", kosong: true };
  const bb = t.berbayar; const k = konversiTotal(t);
  const tb = (kunci) => { const c = selTotalBerbayar(bb, kunci); return { t: c.teks, kosong: c.kosong, sub: c.kosong ? c.alasan : c.sementara ? "sementara" : null }; };
  switch (id) {
    case "lead": return { t: angka(t.lead) };
    case "spam": return { t: formatPersen(t.lead ? Math.round((t.spam / t.lead) * 10000) / 100 : null), sub: `${angka(t.spam)} lead` };
    case "berOrder": return { t: angka(t.berOrder) };
    case "membayar": return { t: angka(t.membayar) };
    case "lunas": return { t: angka(t.lunas) };
    case "nilai": return { t: rupiah(t.nilaiOrderSaatIni) };
    case "uang": return { t: rupiah(t.uangBersih) };
    case "spend": return tb("spend");
    case "konversi": return { t: formatPersen(k.nilai), kosong: k.nilai == null, sub: `${k.pembilang}/${k.penyebut}` };
    case "konversiNonSpam": return { t: formatPersen(k.nilaiNonSpam), kosong: k.nilaiNonSpam == null, sub: `${k.pembilang}/${k.penyebutNonSpam}` };
    case "cpa": return tb("cpa");
    case "booked": return tb("bookedRoas");
    case "cash": return tb("cashRoas");
    default: return { t: "—", kosong: true };
  }
}

const Sel = ({ c }) => (
  <td className={cn("px-3 py-2 text-right align-top tabular-nums", c.kosong && "text-ink3")} title={c.title}>
    <span className={c.t === BUKAN_BIAYA ? "text-[11px]" : ""}>{c.t}</span>
    {c.sub && <span className="t-secondary block text-[10.5px] font-normal">{c.sub}</span>}
  </td>
);

function KartuSumber({ s, lap, banding, onBuka, kolom }) {
  const [lebih, setLebih] = useState(false);
  const utama = ["lead", "berOrder", "lunas", "nilai", "uang", "spend"];
  const tambahan = kolom.map((k) => k.id).filter((id) => !utama.includes(id));
  const baris = (ids) => ids.map((id) => { const c = selSumber(s, id, { banding, lap }); const lab = KOLOM_SUMBER.find((k) => k.id === id)?.label; return (
    <div key={id} className="min-w-0"><dt className="t-secondary">{lab}</dt><dd className={cn("m-0 truncate font-medium tabular-nums", c.kosong ? "text-ink3" : "text-ink")} title={c.title}>{c.t}{c.sub ? <span className="t-secondary ml-1 text-[10.5px] font-normal">{c.sub}</span> : null}</dd></div>
  ); });
  return (
    <Card className="flex min-w-0 flex-col gap-2 !p-3" data-testid={`kartu-sumber-${s.id}`}>
      <button type="button" onClick={onBuka} className="flex items-center gap-3 text-left" aria-label={`Buka rincian ${s.label}`}>
        <LogoSumber id={s.id} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-ink">{s.label}</span>
          <span className="t-secondary block text-[11px]">{BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"}</span>
        </span>
        {s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}
        <ChevronRight size={16} className="shrink-0 text-ink3" />
      </button>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">{baris(utama)}</dl>
      <button type="button" className="inline-flex items-center gap-1 self-start text-[12px] text-accent hover:underline" aria-expanded={lebih} onClick={() => setLebih((v) => !v)}>
        {lebih ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {lebih ? "Sembunyikan" : "Konversi & efisiensi biaya"}
      </button>
      {lebih && <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 rounded-btn bg-inset p-2.5 text-[12px]">{baris(tambahan)}</dl>}
    </Card>
  );
}

export default function TabelSumber({ lap, urutId, kolomMode, bandingkan, onUbah, onBuka, onEkspor, periodeOk }) {
  const kolom = useMemo(() => kolomTampil(kolomMode), [kolomMode]);
  const urut = useMemo(() => urutkan(lap?.sumber || [], urutId), [lap, urutId]);
  const penanda = useMemo(() => penandaPerSumber(lap?.sorotan), [lap]);   // sorotan dipilih SERVER dari data (bukan hardcode)
  const lengkap = kolomMode === "lengkap";
  const labelUrut = METRIK_URUT.find((m) => m.id === urutId)?.label?.toLowerCase();
  return (
    <section aria-label="Peringkat semua sumber" className="flex flex-col gap-2" data-testid="tabel-sumber">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-ink">Semua sumber</h3>
          <p className="t-secondary text-[12px]">Urut menurut <b>{labelUrut}</b>. Sumber dengan sampel kecil (&lt; 30 lead) tidak dibandingkan pada rasio. Klik sumber untuk rincian.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink2">Urutkan
            <select className="min-w-0 max-w-[220px] rounded-btn bg-inset px-2 py-1.5 text-[13px] text-ink" value={urutId} onChange={(e) => onUbah({ urut: e.target.value })} aria-label="Urutkan peringkat menurut" data-testid="pilih-urut">
              {METRIK_URUT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button type="button" className={cn("btn btn-sm hidden md:inline-flex", lengkap ? "btn-primary" : "btn-ghost")} aria-pressed={lengkap} onClick={() => onUbah({ kolom: lengkap ? "ringkas" : "lengkap" })} data-testid="toggle-kolom"><Columns3 size={14} /> {lengkap ? "Kolom ringkas" : "Kolom lengkap"}</button>
          <button type="button" className={cn("btn btn-sm", bandingkan ? "btn-primary" : "btn-ghost")} aria-pressed={bandingkan} onClick={() => onUbah({ banding: !bandingkan })} disabled={!periodeOk} data-testid="toggle-banding"><GitCompare size={14} /> Bandingkan</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEkspor} disabled={!lap} data-testid="ekspor-sumber"><Download size={14} /> Ekspor CSV</button>
        </div>
      </div>

      {/* mobile: kartu */}
      <div className="grid grid-cols-1 gap-2 md:hidden">
        {urut.map((s) => <KartuSumber key={s.id} s={s} lap={lap} banding={bandingkan} kolom={KOLOM_SUMBER} onBuka={() => onBuka(s.id)} />)}
      </div>

      {/* desktop/tablet: tabel */}
      <Card className="hidden overflow-x-auto !p-0 md:block">
        <table className={cn("w-full border-collapse text-[13px]", lengkap ? "min-w-[1200px]" : "min-w-[900px]")}>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink3">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Sumber</th>
              {kolom.map((k) => <th key={k.id} className="whitespace-nowrap px-3 py-2 text-right"><span className="inline-flex items-center justify-end gap-1">{k.label}<InfoTooltip text={TIP[k.id]} /></span></th>)}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {urut.map((s, i) => (
              <tr key={s.id} className="cursor-pointer border-b border-line/60 hover:bg-inset/60" onClick={() => onBuka(s.id)} data-testid={`baris-sumber-${s.id}`}>
                <td className="px-3 py-2 tabular-nums text-ink3">{i + 1}</td>
                <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><LogoSumber id={s.id} size={28} /><span className="font-medium text-ink">{s.label}</span>{s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}{(penanda.get(s.id) || []).map((p) => <Badge key={p.id} variant="green" className="normal-case" title={teksSorotan(p)}>{p.label}</Badge>)}</span></td>
                {kolom.map((k) => <Sel key={k.id} c={selSumber(s, k.id, { banding: bandingkan, lap })} />)}
                <td className="px-3 py-2 text-ink3"><ChevronRight size={16} /></td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-semibold text-ink" data-testid="baris-total">
              <td className="px-3 py-2" /><td className="px-3 py-2">Total semua sumber</td>
              {kolom.map((k) => <Sel key={k.id} c={selTotal(lap, k.id)} />)}
              <td />
            </tr>
          </tbody>
        </table>
      </Card>
      <p className="t-secondary text-[11.5px]">Biaya, CPA, dan ROAS pada baris total hanya untuk sumber berbayar dan hanya bila semuanya lengkap (dihitung dari pembilang dan penyebut total, bukan rata-rata per baris); organik tidak punya biaya dialokasikan. Dasar: {DASAR_BIAYA_LABEL}. Konversi total = Σ ber-order ÷ Σ lead.</p>
    </section>
  );
}
