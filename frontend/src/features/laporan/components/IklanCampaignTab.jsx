import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { makeRange, formatRangeText } from "@/lib/dateRange.js";
import { formatRupiah } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { kueriIklan, drilldown, barisTabel, ringkasCakupan, peringatanUrut, statusBiayaLaporan, barisBiaya, jejak, formatPersen, UMUR, LEVELS, NADA_KELAS } from "../iklanCampaignLogic.js";
import { ImporSpend, PanelTarget, PanelMonitor } from "./IklanBiayaPanel.jsx";

// ═══ LAPORAN IKLAN PER CAMPAIGN (ADMIN) ═════════════════════════════════════════════════════════════════════════════════════════
// Sumber: GET /api/atribusi/iklan (baca-saja). Satu customer baru = satu campaign akuisisi (touch CTWA pertama yang sah dan terbukti kausal).
// Customer lama yang klik iklan lagi = REAKTIVASI, bukan lead baru; touch berikutnya = ASSISTED (tidak menambah lead/closing).
// Biaya, CPA, dan ROAS BELUM tersambung — tidak dihitung di klien. UNMAPPED dan UNKNOWN selalu ditampilkan (coverage gap), tidak pernah ditebak.

const TIP = {
  lead: "Customer baru (nomor unik) yang dibuat di rentang ini dan punya touch iklan CTWA terbukti. Termasuk spam; spam dan bukan spam ditampilkan terpisah.",
  prospek: "Pernah ditandai PROSPECT/TRANSACTION/REVIEWED. Stage ini diatur MANUAL oleh sales — bukan ukuran 'qualified lead' dan bisa berbeda antar sales.",
  order: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan) dan jumlah order eligible-nya.",
  dp: "Order yang pembayaran pertamanya di ledger lebih kecil dari tagihan (DP). Hanya terhitung bila ada payment di ledger.",
  lunasCrm: "Customer dengan order berstatus LUNAS di CRM (status tersimpan). Belum tentu ada bukti uang di ledger.",
  closing: "CLOSING UTAMA: customer dengan order eligible yang ledger pembayarannya (setelah refund disetujui) menutup seluruh tagihan. Dasar biaya per closing kelak.",
  booked: "Σ nilai order eligible (tanpa ongkir) — nilai yang dibukukan, BUKAN uang diterima.",
  uang: "Σ pembayaran valid di ledger. Baca bersama cakupan ledger: histori lama banyak yang belum punya payment di ledger.",
  reaktivasi: "Customer LAMA (sudah punya riwayat pesan) yang klik iklan ini. Bukan lead baru; tidak menambah closing.",
  assisted: "Touch berikutnya dari customer yang sudah diakuisisi (mungkin oleh campaign lain). Kredit tetap pada touch pertama yang sah.",
  umur: "Umur kohort: hanya lead yang sudah berumur ≥ N hari, hasil dihitung DALAM N hari sejak tanggal lead — adil dibandingkan antar campaign.",
};

const Th = ({ children, tip, className }) => (
  <th className={cn("whitespace-nowrap px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink3", className)}>
    <span className="inline-flex items-center justify-end gap-1">{children}{tip && <InfoTooltip text={tip} />}</span>
  </th>
);
const SelBiaya = ({ s }) => <Td className={s.kosong ? "text-ink3" : ""} title={s.alasan || undefined}>{s.teks}{s.alasan && <span className="block text-[10px] font-normal">{s.alasan}</span>}</Td>;
function barisBiayaTotal(lap, kunci, roas = false) {
  const v = lap.biaya?.[kunci];
  if (v == null) return { teks: "—", alasan: lap.biaya?.alasanNull?.[kunci === "cpa" ? "cpa" : kunci] ? String(lap.biaya.alasanNull[kunci]).toLowerCase().replace(/_/g, " ") : null, kosong: true };
  return roas ? { teks: Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×", alasan: null, kosong: false } : { teks: rupiahBulat(v), alasan: null, kosong: false };
}
const Td = ({ children, className }) => <td className={cn("px-3 py-2 text-right align-top tabular-nums text-[13px] text-ink", className)}>{children}</td>;
const angka = (n) => (n == null ? "—" : Number(n).toLocaleString("id-ID"));
const rupiahBulat = (n) => (n == null ? "—" : "Rp" + Math.round(Number(n)).toLocaleString("id-ID"));
const TIP_BIAYA = {
  spend: "Spend Meta pada tanggal delivery WIB dalam rentang, dari tabel spend harian (satu sumber per hari+Ad). Nama hanya label; kunci = ID.",
  konv: "Hasil percakapan versi Meta (messaging conversations started). BUKAN lead CRM; tidak dipakai sebagai penyebut biaya.",
  biayaKonv: "Metrik PLATFORM: spend ÷ percakapan versi Meta. Boleh dibaca juga untuk tanggal sebelum atribusi. BUKAN CPL/CPA CRM.",
  cpl: "Spend ÷ acquisition lead (customer baru dengan touch pertama terbukti). Penyebut 0 → —.",
  cplq: "Spend ÷ lead yang pernah ditandai PROSPECT (manual oleh sales).",
  cplo: "Spend ÷ customer unik dengan ≥ 1 order eligible (bukan jumlah order).",
  cpa: "CPA utama: spend ÷ closing utama (customer lunas terbukti ledger). Bukan CPA versi Meta.",
  roasb: "Booked ROAS: nilai order eligible ÷ spend. Belum tentu uang diterima.",
  roasc: "Cash ROAS: pembayaran ledger valid dikurangi refund ÷ spend.",
};

export default function IklanCampaignTab() {
  const [range, setRange] = useState(() => makeRange("last_7_days"));
  const [level, setLevel] = useState("campaign");
  const [jalur, setJalur] = useState({ campaignId: null, adSetId: null, nama: {} });
  const [umur, setUmur] = useState("semua");
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [lihatPeringatan, setLihatPeringatan] = useState(true);
  const [panel, setPanel] = useState(null);   // null | "spend" | "target" | "monitor"

  const muat = useCallback(async () => {
    setMemuat(true); setGalat(null);
    try {
      setLap(await api.getAtribusiIklan(kueriIklan({ range, level, campaignId: jalur.campaignId, adSetId: jalur.adSetId })));
    } catch (e) {
      setLap(null);
      setGalat(e?.status === 429 ? "Laporan sedang dihitung untuk permintaan lain — coba lagi sebentar." : (e?.message || "Gagal memuat laporan iklan."));
    } finally { setMemuat(false); }
  }, [range, level, jalur.campaignId, jalur.adSetId]);
  useEffect(() => { muat(); }, [muat]);

  const baris = useMemo(() => (lap?.grup || []).map((g) => ({ g, b: barisTabel(g, umur), c: barisBiaya(g) })), [lap, umur]);
  const cakupan = useMemo(() => ringkasCakupan(lap), [lap]);
  const biaya = statusBiayaLaporan(lap);
  const peringatan = useMemo(() => peringatanUrut(lap), [lap]);

  function turun(g) {
    const d = drilldown(g, level);
    if (!d) return;
    setJalur({ campaignId: d.campaignId, adSetId: d.adSetId, nama: { campaign: g.campaign?.nama || `Campaign ${g.campaign?.id}`, adSet: g.adSet?.nama || (g.adSet ? `Ad Set ${g.adSet.id}` : null) } });
    setLevel(d.level);
  }
  function naik(lv) {
    if (lv === "campaign") { setJalur({ campaignId: null, adSetId: null, nama: {} }); setLevel("campaign"); }
    else if (lv === "adset") { setJalur((j) => ({ ...j, adSetId: null })); setLevel("adset"); }
  }

  const total = lap?.jumlahTeratribusi;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px]">
          <p className="t-secondary text-[12.5px]">
            Periode lead: <b>{formatRangeText(range)}</b> (tanggal customer dibuat, WIB, maks. 93 hari). Satu customer baru = satu campaign (touch iklan pertama yang terbukti).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={muat} disabled={memuat}><RefreshCw size={14} /> Refresh</button>
          <DateRangePicker value={range} onChange={setRange} showCompare={false} allowAll={false} />
        </div>
      </div>

      {/* jejak drilldown + umur kohort */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap items-center gap-1 text-[13px]" aria-label="Jejak drilldown">
          {jejak(level, jalur.nama).map((j, i, arr) => (
            <React.Fragment key={j.level}>
              {i > 0 && <ChevronRight size={14} className="text-ink3" />}
              {i === arr.length - 1
                ? <span className="font-semibold text-ink">{j.label}</span>
                : <button className="text-accent hover:underline" onClick={() => naik(j.level)}>{j.label}</button>}
            </React.Fragment>
          ))}
          <span className="t-secondary ml-2 text-[12px]">({level === "campaign" ? "per campaign" : level === "adset" ? "per ad set" : "per ad"})</span>
        </nav>
        <div className="inline-flex items-center gap-1 rounded-btn bg-inset p-0.5" role="tablist" aria-label="Umur kohort">
          {UMUR.map((u) => (
            <button key={u.id} role="tab" aria-selected={umur === u.id} onClick={() => setUmur(u.id)}
              className={cn("rounded-btn px-2.5 py-1 text-[12px]", umur === u.id ? "bg-surface font-semibold shadow-card" : "text-ink3")}>{u.label}</button>
          ))}
          <InfoTooltip text={TIP.umur} />
        </div>
      </div>

      {galat && <Card><CardContent><p className="flex items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat}</p></CardContent></Card>}

      {/* status data: kecuali diketahui, jangan tampilkan angka tanpa konteks */}
      {lap && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px]">
              <span>Atribusi tersimpan sejak: <b>{lap.atribusi.attributionStartWib ? `${lap.atribusi.attributionStartWib} WIB` : "belum ada touch"}</b></span>
              <span>Rekonsiliasi: <b className={lap.rekonsiliasi.ok ? "text-green" : "text-red"}>{lap.rekonsiliasi.ok ? `OK (${lap.rekonsiliasi.cek.length} pemeriksaan)` : "GAGAL — jangan pakai angka ini"}</b></span>
              <span>Biaya / CPL / CPA / ROAS: <b className={biaya.tersambung ? "text-ink" : "text-orange"}>{biaya.teks}</b></span>
              {biaya.tersambung && <span>Spend rentang: <b>{rupiahBulat(biaya.spendTotal)}</b> · terakhir {biaya.terakhirTanggal} WIB{biaya.terlambat ? " (TERLAMBAT)" : ""}</span>}
              {biaya.tersambung && biaya.spendTidakTerpetakan > 0 && <span className="text-orange">Spend tanpa mapping: <b>{rupiahBulat(biaya.spendTidakTerpetakan)}</b></span>}
              {biaya.tersambung && !biaya.targetDiatur && <span className="t-secondary">Target KPI belum diisi — tanpa evaluasi/warna</span>}
              {lap.rentangLead.bawaan && <span className="t-secondary">Rentang bawaan {lap.rentangLead.hariBawaan} hari terakhir</span>}
            </div>
            {cakupan && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {cakupan.bagian.map((p) => (
                  <div key={p.id} className="rounded-btn bg-inset px-3 py-2">
                    <p className="text-[11px] text-ink3">{p.label}</p>
                    <p className="text-[18px] font-semibold tabular-nums">{angka(p.n)} <span className="text-[11px] font-normal text-ink3">dari {angka(cakupan.total)} lead baru</span></p>
                  </div>
                ))}
              </div>
            )}
            {cakupan?.metaAds && (
              <p className="t-secondary text-[12px]">
                Selisih terhadap label <b>META_ADS</b> di CRM ({angka(cakupan.metaAds.label)} lead baru): {angka(cakupan.metaAds.terbukti)} terbukti per Ad ID · {angka(cakupan.metaAds.unknown)} UNKNOWN · {angka(cakupan.metaAds.sudahAda)} customer sudah ada · {angka(cakupan.metaAds.tanpaTouch)} tanpa touch iklan (label dari clid/teks/tautan, tanpa Ad ID — tidak diberi kredit campaign).
                {cakupan.metaAds.terbuktiBukanLabelMeta > 0 && ` ${angka(cakupan.metaAds.terbuktiBukanLabelMeta)} terbukti per Ad ID tetapi labelnya bukan META_ADS.`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {peringatan.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <button className="flex items-center gap-2 text-left text-[13px] font-semibold" onClick={() => setLihatPeringatan((v) => !v)}>
              <AlertTriangle size={15} className="text-orange" /> {peringatan.length} catatan cakupan data {lihatPeringatan ? "(sembunyikan)" : "(tampilkan)"}
            </button>
            {lihatPeringatan && <ul className="flex flex-col gap-1 text-[12.5px] text-ink2">{peringatan.map((w) => <li key={w.kode + (w.asal || "")} className="list-disc ml-4 break-words">{w.pesan}</li>)}</ul>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {memuat && !lap ? (
            <div className="flex h-40 items-center justify-center text-ink3"><Loader2 className="animate-spin" size={18} /></div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="min-w-[150px] bg-surface md:sticky md:left-0 md:z-10 md:min-w-[220px] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink3">{level === "campaign" ? "Campaign" : level === "adset" ? "Ad Set" : "Ad"}</th>
                  <Th tip={TIP.lead}>Lead baru</Th>
                  <Th tip="Spam vs bukan spam dari lead baru.">Spam / Bukan</Th>
                  <Th tip={TIP.prospek}>Prospek (manual)</Th>
                  <Th tip={TIP.order}>Cust. ber-order (order)</Th>
                  {umur === "semua" && <Th tip={TIP.dp}>Order DP</Th>}
                  {umur === "semua" && <Th tip={TIP.lunasCrm}>Cust. lunas CRM</Th>}
                  <Th tip={TIP.closing}>Closing utama</Th>
                  <Th tip={TIP.booked}>Booked value</Th>
                  <Th tip={TIP.uang}>Uang ledger</Th>
                  <Th tip={TIP.reaktivasi}>Reaktivasi</Th>
                  <Th tip={TIP.assisted}>Assisted</Th>
                  <Th tip={TIP_BIAYA.spend}>Spend</Th>
                  <Th tip={TIP_BIAYA.konv}>Konv. platform</Th>
                  <Th tip={TIP_BIAYA.biayaKonv}>Biaya / konv. platform</Th>
                  <Th tip={TIP_BIAYA.cpl}>CPL</Th>
                  <Th tip={TIP_BIAYA.cplq}>Cost / qualified</Th>
                  <Th tip={TIP_BIAYA.cplo}>Cost / cust. order</Th>
                  <Th tip={TIP_BIAYA.cpa}>CPA closing</Th>
                  <Th tip={TIP_BIAYA.roasb}>Booked ROAS</Th>
                  <Th tip={TIP_BIAYA.roasc}>Cash ROAS</Th>
                  <Th tip="Status data biaya baris ini dan (bila target ADMIN diisi) evaluasi. Tidak ada warna tanpa target.">Status biaya</Th>
                </tr>
              </thead>
              <tbody>
                {lap && baris.length === 0 && <tr><td colSpan={22} className="px-3 py-10 text-center text-sm text-ink3">Belum ada lead dengan touch iklan di rentang ini. {lap?.atribusi?.attributionStartWib ? "" : "Capture touch belum menyala atau belum ada sinyal iklan tersimpan."}</td></tr>}
                {baris.map(({ g, b, c }) => (
                  <tr key={b.kunci} className={cn("border-b border-line/60", !b.kredit || g.status === "UNMAPPED" ? "bg-inset/50" : "", b.bisaDrilldown && "cursor-pointer hover:bg-inset")} onClick={() => b.bisaDrilldown && turun(g)}>
                    <td className="min-w-[150px] bg-surface md:sticky md:left-0 md:z-10 md:min-w-[220px] px-3 py-2 text-left align-top">
                      <p className="flex items-center gap-1.5 font-medium text-ink">
                        {b.label.judul}
                        {g.status !== "MAPPED" && <span className="rounded-btn bg-orangebg px-1.5 py-0.5 text-[10px] font-semibold text-orange">{g.status}</span>}
                        {b.bisaDrilldown && <ChevronRight size={14} className="text-ink3" />}
                      </p>
                      <p className="t-secondary max-w-[360px] text-[11.5px]">{b.label.sub}</p>
                    </td>
                    <Td>{angka(b.leadUnik)}{b.leadMatang != null && <span className="block text-[10px] text-ink3">{angka(b.leadMatang)} matang</span>}</Td>
                    <Td>{angka(b.spam)} / {angka(b.bukanSpam)}</Td>
                    <Td>{angka(b.prospek)}</Td>
                    <Td>{angka(b.customerOrder)} <span className="text-ink3">({angka(b.orderEligible)})</span></Td>
                    {umur === "semua" && <Td>{angka(b.orderPernahDp)}</Td>}
                    {umur === "semua" && <Td>{angka(b.customerLunasCrm)}</Td>}
                    <Td className="font-semibold">{angka(b.closing)}<span className="block text-[10px] font-normal text-ink3">{b.persenClosing}</span></Td>
                    <Td>{formatRupiah(b.booked)}</Td>
                    <Td>{formatRupiah(b.uangLedger)}{b.cakupanLedger != null && <span className="block text-[10px] text-ink3">ledger {formatPersen(b.cakupanLedger)} order</span>}</Td>
                    <Td>{angka(b.reaktivasi.touch)} <span className="text-ink3">({angka(b.reaktivasi.customerUnik)} cust.)</span></Td>
                    <Td>{angka(b.assisted.touch)} <span className="text-ink3">({angka(b.assisted.customerUnik)} cust.)</span></Td>
                    <Td>{c.spend.teks}{c.kesegaran?.terlambat && <span className="block text-[10px] text-orange">terlambat</span>}</Td>
                    <Td>{angka(c.konversasiPlatform)}{(c.impresi != null || c.klikTautan != null) && <span className="block text-[10px] text-ink3">{angka(c.impresi)} tayang · {angka(c.klikTautan)} klik</span>}</Td>
                    <SelBiaya s={c.biayaPerKonversasi} />
                    <SelBiaya s={c.cpl} /><SelBiaya s={c.cplQualified} /><SelBiaya s={c.cplOrder} /><SelBiaya s={c.cpa} /><SelBiaya s={c.bookedRoas} /><SelBiaya s={c.cashRoas} />
                    <Td className="text-left" title={c.statusTip}>
                      <span className={cn("text-[11.5px] font-semibold", NADA_KELAS[c.nada])}>{c.statusTeks}</span>
                      {c.evaluasiTeks && <span className={cn("block text-[11px] font-semibold", NADA_KELAS[c.evaluasiNada])}>{c.evaluasiTeks}{c.pelanggaran.length > 0 && " (" + c.pelanggaran.map((p) => p.metrik).join(", ") + ")"}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
              {total && baris.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className="min-w-[150px] bg-surface md:sticky md:left-0 md:z-10 md:min-w-[220px] px-3 py-2 text-left text-[12px]">Akuisisi terbukti (tanpa baris UNKNOWN)</td>
                    <Td>{angka(total.leadUnik)}</Td><Td>—</Td><Td>—</Td>
                    <Td>{angka(total.customerDenganOrder)} <span className="text-ink3">({angka(total.orderEligible)})</span></Td>
                    {umur === "semua" && <Td>{angka(total.orderPernahDp)}</Td>}
                    {umur === "semua" && <Td>{angka(total.customerLunasMenurutCrm)}</Td>}
                    <Td>{angka(total.closingUtama.customerLunasTerbuktiLedger)}</Td>
                    <Td>{formatRupiah(total.bookedValue)}</Td><Td>{formatRupiah(total.uangLedger)}</Td><Td>—</Td><Td>—</Td>
                    <Td>{lap.biaya.spend == null ? "—" : rupiahBulat(lap.biaya.spend)}</Td><Td>{angka(lap.biaya.platformConversations)}</Td><SelBiaya s={barisBiayaTotal(lap, "costPerPlatformConversation")} /><SelBiaya s={barisBiayaTotal(lap, "cpl")} /><SelBiaya s={barisBiayaTotal(lap, "costPerQualifiedLead")} /><SelBiaya s={barisBiayaTotal(lap, "costPerCustomerOrder")} /><SelBiaya s={barisBiayaTotal(lap, "cpa")} /><SelBiaya s={barisBiayaTotal(lap, "bookedRoas", true)} /><SelBiaya s={barisBiayaTotal(lap, "cashRoas", true)} /><Td>—</Td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </CardContent>
      </Card>

      {!biaya.tersambung && (
        <Card>
          <CardContent className="flex flex-col gap-1 text-[12.5px] text-ink2">
            <p className="font-semibold text-ink">Biaya, CPA, dan ROAS: belum tersambung</p>
            <p>{biaya.alasan}</p>
            <p className="t-secondary">Opsi sambungan otomatis (tanpa CSV harian): {biaya.opsi.join(" ")}</p>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {[["spend", "Impor spend"], ["target", "Target KPI"], ["monitor", "Monitoring"]].map(([id, label]) => (
          <button key={id} className={cn("btn btn-sm", panel === id ? "" : "btn-ghost")} onClick={() => setPanel((p) => (p === id ? null : id))}>{label}</button>
        ))}
      </div>
      {panel === "spend" && <ImporSpend onSelesai={muat} />}
      {panel === "target" && <PanelTarget onSimpan={muat} />}
      {panel === "monitor" && <PanelMonitor />}
      {biaya.tersambung && biaya.definisi && <p className="t-secondary text-[11.5px]">{biaya.definisi.ringkas} {biaya.definisi.reaktivasi} {biaya.definisi.kohort}</p>}
      <p className="t-secondary text-[11.5px]">Level yang tersedia: {LEVELS.join(" → ")}. Nama kreatif/campaign hanya label; join memakai ID. Tidak ada kredit dari URL postingan, teks chat, atau waktu pesan.</p>
    </div>
  );
}
