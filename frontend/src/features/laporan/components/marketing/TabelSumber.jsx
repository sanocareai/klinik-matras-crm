import React, { useMemo } from "react";
import { ChevronRight, Columns3, Download, GitCompare } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { METRIK_URUT, urutkan, penandaPerSumber, teksSorotan, angka, formatPersen, rupiah, selBiayaSumber, selTotalBerbayar, delta, deltaTeks, DASAR_BIAYA_LABEL, BUKTI_LABEL, sementaraTeks } from "../../akuisisiLogic.js";
import { kolomTampil, konversiTotal } from "../../marketingLogic.js";
import LogoSumber from "../LogoSumber.jsx";

// Peringkat semua sumber (label CRM): tabel (kolom utama; tambahan via "Kolom lengkap"). Klien hanya menampilkan/mengurutkan angka server.
// Sumber tanpa hasil TETAP tampil (lead 0 bukan dihilangkan). Biaya organik = "tidak tersedia", bukan Rp0. Konversi UTAMA = ber-order ÷ TOTAL lead (termasuk spam); non-spam kolom terpisah.
export const TIP = {
  lead: "TOTAL lead berlabel sumber itu (label CRM): customer baru dibuat di periode. Spam ikut terhitung; lead sah = bukan spam/internal/B2B/karyawan.",
  spam: "Persentase lead sumber ini yang ditandai SPAM. Diagnostik kualitas targeting — bukan penalti.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer dengan ≥ 1 pembayaran sah di ledger. Batas bawah: pembayaran di luar sistem tidak terlihat.",
  lunas: "Customer lunas TERBUKTI LEDGER: ledger order-nya (setelah refund disetujui) menutup seluruh tagihan. Angka hitung; cakupan ledger dinilai terpisah (Kualitas data).",
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
  <td className={cn("crm-mk-sel", c.kosong && "crm-mk-sel--kosong")} title={c.title}>
    <span className={c.t === BUKAN_BIAYA ? "crm-mk-sel-kecil" : ""}>{c.t}</span>
    {c.sub && <span className="crm-mk-sel-sub">{c.sub}</span>}
  </td>
);

// Performa Sumber (redesain Sales CRM 1 Nov 2026): satu tabel untuk semua lebar layar — angka rata kanan, digulir mendatar DI DALAM panel (teks tidak dikecilkan), kolom Sumber menempel di kiri.
// Menggantikan kartu per sumber di HP; semua isi kartu (label bukti atribusi, sampel kecil, angka utama dan tambahan) kini ada di tabel (kolom lengkap = tambahan).
export default function TabelSumber({ lap, urutId, kolomMode, bandingkan, onUbah, onBuka, onEkspor, periodeOk }) {
  const kolom = useMemo(() => kolomTampil(kolomMode), [kolomMode]);
  const urut = useMemo(() => urutkan(lap?.sumber || [], urutId), [lap, urutId]);
  const penanda = useMemo(() => penandaPerSumber(lap?.sorotan), [lap]);   // sorotan dipilih SERVER dari data (bukan hardcode)
  const lengkap = kolomMode === "lengkap";
  const labelUrut = METRIK_URUT.find((m) => m.id === urutId)?.label?.toLowerCase();
  const buka = (e, id) => { if (e.type === "click" || e.key === "Enter" || e.key === " ") { e.preventDefault(); onBuka(id); } };
  return (
    <Card className="crm-mk-sumber" data-testid="tabel-sumber" role="region" aria-label="Peringkat semua sumber">
      <div className="crm-mk-sumber-kepala">
        <div className="min-w-0 flex-1">
          <h3 className="t-card-title">Performa Sumber</h3>
          <p className="crm-mk-deskripsi">Urut menurut <b>{labelUrut}</b>. Sumber dengan sampel kecil (&lt; 30 lead) tidak dibandingkan pada rasio. Klik sumber untuk rincian.</p>
        </div>
        <div className="crm-mk-sumber-aksi">
          <label className="crm-mk-urut">Urutkan
            <select className="crm-mk-select" value={urutId} onChange={(e) => onUbah({ urut: e.target.value })} aria-label="Urutkan peringkat menurut" data-testid="pilih-urut">
              {METRIK_URUT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button type="button" className={cn("btn btn-sm", lengkap ? "btn-primary" : "btn-ghost")} aria-pressed={lengkap} onClick={() => onUbah({ kolom: lengkap ? "ringkas" : "lengkap" })} data-testid="toggle-kolom"><Columns3 size={14} /> {lengkap ? "Kolom ringkas" : "Kolom lengkap"}</button>
          <button type="button" className={cn("btn btn-sm", bandingkan ? "btn-primary" : "btn-ghost")} aria-pressed={bandingkan} onClick={() => onUbah({ banding: !bandingkan })} disabled={!periodeOk} data-testid="toggle-banding"><GitCompare size={14} /> Bandingkan</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEkspor} disabled={!lap} data-testid="ekspor-sumber"><Download size={14} /> Ekspor CSV</button>
        </div>
      </div>

      <div className="crm-ss-gulir" tabIndex={0} role="region" aria-label="Tabel performa sumber; gulir mendatar untuk kolom lain">
        <table className="crm-mk-tabel" data-lengkap={lengkap ? "1" : "0"}>
          <thead>
            <tr>
              <th scope="col" className="crm-mk-kiri">Sumber</th>
              {kolom.map((k) => <th key={k.id} scope="col"><span className="crm-mk-th">{k.label}<InfoTooltip text={TIP[k.id]} /></span></th>)}
              <th scope="col" className="crm-mk-panah"><span className="sr-only">Buka rincian</span></th>
            </tr>
          </thead>
          <tbody>
            {urut.map((s, i) => (
              <tr key={s.id} tabIndex={0} onClick={(e) => buka(e, s.id)} onKeyDown={(e) => buka(e, s.id)} data-testid={`baris-sumber-${s.id}`} aria-label={`Buka rincian ${s.label}`}>
                <th scope="row" className="crm-mk-kiri">
                  <span className="crm-mk-sumber-sel">
                    <span className="crm-mk-no">{i + 1}</span>
                    <LogoSumber id={s.id} size={32} />
                    <span className="crm-mk-sumber-teks">
                      <span className="crm-mk-sumber-nama">{s.label}</span>
                      <span className="crm-mk-sumber-bukti">{BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"}</span>
                    </span>
                    {s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}
                    {(penanda.get(s.id) || []).map((p) => <Badge key={p.id} variant="green" className="normal-case" title={teksSorotan(p)}>{p.label}</Badge>)}
                  </span>
                </th>
                {kolom.map((k) => <Sel key={k.id} c={selSumber(s, k.id, { banding: bandingkan, lap })} />)}
                <td className="crm-mk-panah"><ChevronRight size={16} aria-hidden="true" /></td>
              </tr>
            ))}
            <tr className="crm-mk-total" data-testid="baris-total">
              <th scope="row" className="crm-mk-kiri">Total semua sumber</th>
              {kolom.map((k) => <Sel key={k.id} c={selTotal(lap, k.id)} />)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="crm-mk-catatan">Biaya, CPA, dan ROAS pada baris total hanya untuk sumber berbayar dan hanya bila semuanya lengkap (dihitung dari pembilang dan penyebut total, bukan rata-rata per baris); organik tidak punya biaya dialokasikan. Dasar: {DASAR_BIAYA_LABEL}. Konversi total = Σ ber-order ÷ Σ lead.</p>
    </Card>
  );
}
