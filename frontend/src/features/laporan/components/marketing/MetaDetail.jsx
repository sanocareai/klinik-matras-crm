import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import { kueriIklan, drilldown, barisTabel, barisBiaya, statusBiayaLaporan, peringatanUrut, UMUR, NADA_KELAS } from "../../iklanCampaignLogic.js";
import { KRITERIA_META, kriteriaTersedia, urutkanMeta, terapkanUmur, alasanKosong, buatCsvMeta, namaBerkasCsvMeta } from "../../marketingLogic.js";
import { berurutan, pesanGalat, salinTeks } from "../../marketingData.js";
import { ImporSpend, PanelTarget, PanelMonitor } from "../IklanBiayaPanel.jsx";
import KesehatanReferensi from "./KesehatanReferensi.jsx";

// Meta: campaign → ad set → ad. Sumber: GET /api/atribusi/iklan (service existing; atribusi utama = CTWA_AD terbukti). Ranking dapat dipilih; ber-order, membayar, dan lunas (ledger) adalah TIGA kolom terpisah.
// UNMAPPED dan UNKNOWN selalu tampil di bawah baris berperingkat (tidak pernah diberi nama campaign) dan ikut rekonsiliasi. CPA/ROAS hanya terisi bila server menyatakan valid (null + alasan selain itu).
const angka = (n) => (n == null ? "—" : Number(n).toLocaleString("id-ID"));
const rp = (n) => (n == null ? "—" : formatRupiah(n));
const LABEL_LEVEL = { campaign: "Campaign", adset: "Ad Set", ad: "Ad" };
const TIP = {
  lead: "Customer baru (nomor unik) dibuat di rentang ini dan punya touch iklan CTWA pertama yang terbukti (bukan label CRM). Termasuk spam.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer unik dengan ≥ 1 pembayaran sah di ledger (DP atau lunas). Batas bawah bila ledger parsial. Tidak tersedia pada tampilan kohort umur.",
  lunas: "Customer unik yang ledger-nya (setelah refund disetujui) menutup seluruh tagihan — closing utama. Bukan status LUNAS di CRM.",
  nilai: "Nilai order eligible saat ini (tanpa ongkir) — nilai yang dibukukan, BUKAN uang diterima dan bukan laba.",
  uang: "Pembayaran sah di ledger dikurangi refund disetujui. Tidak tersedia pada tampilan kohort umur.",
  spend: "Spend Meta per tanggal delivery WIB dari tabel spend harian. Kosong ≠ Rp0: lihat alasan.",
  cpa: "Spend ÷ customer unik lunas ledger. Penyebut 0 atau spend tidak lengkap → kosong.",
  roasb: "Booked ROAS = nilai order ÷ spend. Belum tentu uang diterima.",
  roasc: "Cash ROAS = uang diterima bersih ÷ spend (uang memuat ongkir).",
};
const Th = ({ children, tip, kiri, className }) => (
  <th className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink3", kiri ? "text-left" : "text-right", className)}>
    <span className={cn("inline-flex items-center gap-1", !kiri && "justify-end")}>{children}{tip && <InfoTooltip text={tip} />}</span>
  </th>
);
const Td = ({ children, className, title }) => <td className={cn("px-3 py-2 text-right align-top text-[13px] tabular-nums text-ink", className)} title={title}>{children}</td>;
const SelBiaya = ({ s }) => <Td className={s.kosong ? "text-ink3" : ""} title={s.alasan || undefined}>{s.teks}{s.alasan && <span className="t-secondary block text-[10px] font-normal">{s.alasan}</span>}</Td>;

function SalinId({ id }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="inline-flex items-center gap-1 rounded-btn px-1 text-[11px] text-ink3 hover:bg-inset hover:text-ink" title="Salin ID" aria-label={`Salin ID ${id}`}
      onClick={async (e) => { e.stopPropagation(); if (await salinTeks(id)) { setOk(true); setTimeout(() => setOk(false), 1500); } }}>
      <span className="tabular-nums">ID {id}</span>{ok ? <Check size={12} className="text-green" /> : <Copy size={12} />}
    </button>
  );
}
function totalBiaya(lap, kunci, roas = false) {
  const v = lap?.biaya?.[kunci];
  if (v == null) return { teks: "—", alasan: lap?.biaya?.alasanNull?.[kunci] ? alasanKosong(lap.biaya.alasanNull[kunci]) : null, kosong: true };
  return roas ? { teks: Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×", kosong: false } : { teks: "Rp" + Math.round(Number(v)).toLocaleString("id-ID"), kosong: false };
}

export default function MetaDetail({ range, periode, jalur, rank, umur, kolom, onUbah, cache, versi, onMuat }) {
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [panel, setPanel] = useState(null);   // null | "spend" | "target" | "monitor" | "kesehatan"
  const [lihatCatatan, setLihatCatatan] = useState(false);
  const q = useMemo(() => kueriIklan({ range, level: jalur.level, campaignId: jalur.campaign, adSetId: jalur.adset }), [range, jalur.level, jalur.campaign, jalur.adset]);
  const kunci = JSON.stringify(q);

  const token = useRef(0);   // permintaan terbaru menang; hasil lama (periode/level/campaign sudah berganti) dibuang
  const muat = useCallback(async (paksa = false) => {
    const sendiri = ++token.current; const basi = () => sendiri !== token.current;
    if (!periode.ok) { setLap(null); setGalat(null); setMemuat(false); return; }
    const ada = !paksa && cache?.current?.get(kunci);
    if (ada) { setLap(ada); setGalat(null); setMemuat(false); return; }
    setLap(null); setMemuat(true); setGalat(null);
    try {
      const r = await berurutan(() => api.getAtribusiIklan(q), { batal: basi });
      if (basi()) return;
      cache?.current?.set(kunci, r); setLap(r);
    } catch (e) { if (basi() || e?.dibatalkan) return; setLap(null); setGalat(pesanGalat(e, "Gagal memuat laporan Meta.")); }
    finally { if (!basi()) setMemuat(false); }
  }, [periode.ok, kunci, q, cache]);
  useEffect(() => { muat(false); }, [muat, versi]);
  useEffect(() => () => { token.current += 1; }, []);
  useEffect(() => { onMuat?.(lap); }, [lap, onMuat]);

  const grupUmur = useMemo(() => (lap?.grup || []).map((g) => terapkanUmur(g, umur)), [lap, umur]);
  const tersedia = useMemo(() => kriteriaTersedia(grupUmur), [grupUmur]);
  const { baris, kriteria, semuaNol } = useMemo(() => urutkanMeta(grupUmur, rank), [grupUmur, rank]);
  const biaya = statusBiayaLaporan(lap);
  const catatan = useMemo(() => peringatanUrut(lap), [lap]);
  const lengkap = kolom === "lengkap";
  const kohort = umur !== "semua";
  const total = lap?.jumlahTeratribusi;

  function turun(g) { const d = drilldown(g, jalur.level); if (d) onUbah({ level: d.level, campaign: d.campaignId, adset: d.adSetId }, { ganti: false }); }
  function ekspor() {
    const csv = buatCsvMeta(lap, rank); if (!csv) return;
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = namaBerkasCsvMeta(lap); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  return (
    <section id="meta-campaign" aria-label="Meta campaign, ad set, dan ad" className="flex flex-col gap-3" data-testid="meta-detail">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-ink">{jalur.level === "campaign" ? "Per campaign" : jalur.level === "adset" ? "Per ad set" : "Per ad"} <span className="t-secondary text-[12.5px] font-normal">· atribusi CTWA terbukti — bukan label CRM</span></h3>
          <p className="t-secondary text-[12px]">Satu customer baru = satu campaign (touch iklan pertama yang terbukti). Reaktivasi dan touch lanjutan tidak menambah lead.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink2">Peringkat
            <select className="min-w-0 max-w-[230px] rounded-btn bg-inset px-2 py-1.5 text-[13px] text-ink" value={rank} onChange={(e) => onUbah({ rank: e.target.value })} aria-label="Peringkat menurut" data-testid="pilih-rank">
              {KRITERIA_META.map((k) => <option key={k.id} value={k.id} disabled={!tersedia[k.id] && k.id !== rank}>{k.label}{tersedia[k.id] ? "" : " — belum valid"}</option>)}
            </select>
          </label>
          <div className="inline-flex items-center gap-1 rounded-btn bg-inset p-0.5" role="tablist" aria-label="Umur kohort">
            {UMUR.map((u) => <button key={u.id} role="tab" aria-selected={umur === u.id} onClick={() => onUbah({ umur: u.id })} className={cn("rounded-btn px-2 py-1 text-[12px]", umur === u.id ? "bg-surface font-semibold shadow-card" : "text-ink3")}>{u.label}</button>)}
            <InfoTooltip text="Umur kohort: hanya lead berumur ≥ N hari, hasil dihitung DALAM N hari sejak tanggal lead — adil antar campaign. Peringkat mengikuti angka yang tampil; membayar dan uang bersih tidak tersedia di tampilan ini." />
          </div>
          <button type="button" className={cn("btn btn-sm hidden md:inline-flex", lengkap ? "btn-primary" : "btn-ghost")} aria-pressed={lengkap} onClick={() => onUbah({ kolom: lengkap ? "ringkas" : "lengkap" })} data-testid="toggle-kolom-meta">{lengkap ? "Kolom ringkas" : "Kolom lengkap"}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={ekspor} disabled={!lap} data-testid="ekspor-meta"><Download size={14} /> Ekspor CSV</button>
        </div>
      </div>

      {galat && <Card className="!p-4"><p className="flex items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat} <button className="btn btn-ghost btn-sm" onClick={() => muat(true)}>Coba lagi</button></p></Card>}
      {lap && (
        <p className="t-secondary flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]" data-testid="status-meta">
          <span>Atribusi sejak <b className="text-ink">{lap.atribusi.attributionStartWib ? `${lap.atribusi.attributionStartWib} WIB` : "belum ada touch"}</b></span>
          <span>Rekonsiliasi <b className={lap.rekonsiliasi.ok ? "text-green" : "text-red"}>{lap.rekonsiliasi.ok ? `OK (${lap.rekonsiliasi.cek.length})` : "GAGAL — jangan pakai angka ini"}</b></span>
          <span>Biaya per hasil <b className={biaya.tersambung ? "text-ink" : "text-orange"}>{biaya.teks}</b></span>
          {biaya.tersambung && <span>Spend {rp(biaya.spendTotal)} · terakhir {biaya.terakhirTanggal} WIB{biaya.terlambat ? " (terlambat)" : ""}</span>}
          {biaya.tersambung && biaya.spendTidakTerpetakan > 0 && <span className="text-orange">Spend tanpa mapping {rp(biaya.spendTidakTerpetakan)}</span>}
          {!biaya.tersambung && biaya.alasan && <span className="text-orange">{biaya.alasan}</span>}
        </p>
      )}
      {semuaNol && <p className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" role="status">Semua baris bernilai 0 pada kriteria “{kriteria.label}”: peringkat 1 bersama bukan pemenang.</p>}

      <Card className="overflow-x-auto !p-0">
        {memuat && !lap ? (
          <div className="flex h-40 items-center justify-center text-ink3"><Loader2 className="animate-spin" size={18} /></div>
        ) : (
          <table className="w-full border-collapse text-sm" data-testid="tabel-meta">
            <thead>
              <tr className="border-b border-line">
                <Th kiri className="w-8">#</Th>
                <Th kiri className="min-w-[170px] bg-surface md:sticky md:left-0 md:z-10 md:min-w-[230px]">{LABEL_LEVEL[jalur.level]}</Th>
                <Th tip={TIP.lead}>Lead CTWA terbukti</Th><Th tip={TIP.berOrder}>Ber-order</Th><Th tip={TIP.membayar}>Membayar</Th><Th tip={TIP.lunas}>Lunas (ledger)</Th>
                <Th tip={TIP.nilai}>Nilai order</Th><Th tip={TIP.uang}>Uang bersih</Th><Th tip={TIP.spend}>Spend</Th><Th tip={TIP.cpa}>CPA lunas</Th><Th tip={TIP.roasb}>Booked ROAS</Th><Th tip={TIP.roasc}>Cash ROAS</Th>
                {lengkap && <><Th tip="Spam vs bukan spam dari lead baru.">Spam / Bukan</Th><Th tip="Pernah ditandai PROSPECT/TRANSACTION/REVIEWED — manual oleh sales, bukan 'qualified lead'.">Prospek</Th><Th>Order DP</Th><Th tip="Customer dengan order berstatus LUNAS di CRM (status tersimpan). Belum tentu ada bukti uang di ledger.">Lunas CRM</Th>
                  <Th tip="Customer lama yang klik iklan lagi — bukan lead baru.">Reaktivasi</Th><Th tip="Touch berikutnya dari customer yang sudah diakuisisi; kredit tetap pada touch pertama.">Assisted</Th><Th tip="Hasil percakapan versi Meta; BUKAN lead CRM.">Konv. platform</Th><Th>Biaya / konv.</Th><Th>CPL</Th><Th>Cost / qualified</Th><Th>Cost / cust. order</Th></>}
                {lengkap && <Th kiri tip="Status data biaya baris ini dan (bila target ADMIN diisi) evaluasi. Tanpa target tidak ada warna.">Status biaya</Th>}
              </tr>
            </thead>
            <tbody>
              {lap && baris.length === 0 && <tr><td colSpan={30} className="px-3 py-10 text-center text-sm text-ink3">Belum ada lead dengan touch iklan di rentang ini. {lap?.atribusi?.attributionStartWib ? "" : "Capture touch belum menyala atau belum ada sinyal iklan tersimpan."}</td></tr>}
              {baris.map(({ g, peringkat, alasan, tanpaPeringkat }) => {
                const b = barisTabel(g, umur); const c = barisBiaya(g);
                const ent = g.level === "campaign" ? g.campaign : g.level === "adset" ? g.adSet : g.ad;
                const idEnt = g.status === "MAPPED" ? ent?.id : (g.ad?.id ?? null);
                const nol = (v) => (v == null ? "—" : angka(v));
                return (
                  <tr key={b.kunci} className={cn("border-b border-line/60", g.status !== "MAPPED" ? "bg-inset/50" : "", b.bisaDrilldown && "cursor-pointer hover:bg-inset")} onClick={() => b.bisaDrilldown && turun(g)} data-testid={`baris-meta-${g.status === "MAPPED" ? idEnt : g.status}`} data-status={g.status}>
                    <td className="px-3 py-2 align-top text-[12px] tabular-nums text-ink3" title={peringkat == null ? (tanpaPeringkat ? `${tanpaPeringkat}: tidak diperingkat` : alasanKosong(alasan)) : undefined}>{peringkat ?? "—"}</td>
                    <td className="min-w-[170px] bg-surface px-3 py-2 text-left align-top md:sticky md:left-0 md:z-10 md:min-w-[230px]">
                      <p className="flex items-center gap-1.5 font-medium text-ink">{b.label.judul}
                        {g.status !== "MAPPED" && <span className="rounded-btn bg-orangebg px-1.5 py-0.5 text-[10px] font-semibold text-orange">{g.status}</span>}
                        {b.bisaDrilldown && <ChevronRight size={14} className="text-ink3" />}
                      </p>
                      {g.status === "MAPPED" && idEnt ? <SalinId id={idEnt} /> : null}
                      <p className="t-secondary max-w-[300px] text-[11.5px]" title={g.status === "MAPPED" ? undefined : b.label.sub}>{g.status === "MAPPED" ? (b.label.sub.replace(/^ID \d+(?: · )?/, "") || "") : g.status === "UNMAPPED" ? "Belum ada pemetaan Ad → Ad Set → Campaign" : "Tidak dikreditkan ke campaign mana pun"}</p>
                    </td>
                    <Td>{angka(b.leadUnik)}{b.leadMatang != null && <span className="block text-[10px] text-ink3">{angka(b.leadMatang)} matang</span>}</Td>
                    <Td className="font-medium">{nol(b.customerOrder)}{!kohort && <span className="block text-[10px] font-normal text-ink3">{angka(b.orderEligible)} order</span>}</Td>
                    <Td title={kohort ? "Tidak tersedia pada tampilan kohort umur" : undefined}>{nol(g.customerPernahMembayar)}</Td>
                    <Td className="font-medium">{nol(b.closing)}<span className="block text-[10px] font-normal text-ink3">{b.persenClosing}</span></Td>
                    <Td>{rp(b.booked)}</Td>
                    <Td title={kohort ? "Tidak tersedia pada tampilan kohort umur" : undefined}>{rp(g.uangBersihLedger)}{b.cakupanLedger != null && <span className="block text-[10px] text-ink3">ledger {b.cakupanLedger}% order</span>}</Td>
                    <Td>{c.spend.teks}{c.kesegaran?.terlambat && <span className="block text-[10px] text-orange">terlambat</span>}</Td>
                    <SelBiaya s={c.cpa} /><SelBiaya s={c.bookedRoas} /><SelBiaya s={c.cashRoas} />
                    {lengkap && <>
                      <Td>{angka(b.spam)} / {angka(b.bukanSpam)}</Td><Td>{angka(b.prospek)}</Td><Td>{kohort ? "—" : angka(b.orderPernahDp)}</Td><Td>{kohort ? "—" : angka(b.customerLunasCrm)}</Td>
                      <Td>{angka(b.reaktivasi.touch)} <span className="text-ink3">({angka(b.reaktivasi.customerUnik)} cust.)</span></Td><Td>{angka(b.assisted.touch)} <span className="text-ink3">({angka(b.assisted.customerUnik)} cust.)</span></Td>
                      <Td>{angka(c.konversasiPlatform)}</Td><SelBiaya s={c.biayaPerKonversasi} /><SelBiaya s={c.cpl} /><SelBiaya s={c.cplQualified} /><SelBiaya s={c.cplOrder} />
                    </>}
                    {lengkap && <Td className="text-left" title={c.statusTip}>
                      <span className={cn("text-[11.5px] font-semibold", NADA_KELAS[c.nada])}>{c.statusTeks}</span>
                      {c.evaluasiTeks && <span className={cn("block text-[11px] font-semibold", NADA_KELAS[c.evaluasiNada])}>{c.evaluasiTeks}{c.pelanggaran.length > 0 && " (" + c.pelanggaran.map((p) => p.metrik).join(", ") + ")"}</span>}
                    </Td>}
                  </tr>
                );
              })}
            </tbody>
            {total && baris.length > 0 && (
              <tfoot>
                <tr className="border-t border-line font-semibold" data-testid="total-meta">
                  <td /><td className="min-w-[170px] bg-surface px-3 py-2 text-left text-[12px] md:sticky md:left-0 md:z-10">Akuisisi terbukti (tanpa UNKNOWN)</td>
                  <Td>{angka(total.leadUnik)}</Td><Td>{kohort ? "—" : angka(total.customerDenganOrder)}</Td><Td>{kohort ? "—" : angka(total.customerPernahMembayar)}</Td><Td>{kohort ? "—" : angka(total.closingUtama?.customerLunasTerbuktiLedger)}</Td>
                  <Td>{kohort ? "—" : rp(total.bookedValue)}</Td><Td>{kohort ? "—" : rp(total.uangBersihLedger)}</Td>
                  <Td>{lap.biaya.spend == null ? "—" : rp(lap.biaya.spend)}</Td>
                  <SelBiaya s={totalBiaya(lap, "cpa")} /><SelBiaya s={totalBiaya(lap, "bookedRoas", true)} /><SelBiaya s={totalBiaya(lap, "cashRoas", true)} />
                  {lengkap && <td colSpan={12} />}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </Card>
      <p className="t-secondary text-[11.5px]">Ber-order ≠ membayar ≠ lunas. Nilai order bukan uang diterima; keduanya bukan laba. Nama campaign/ad hanya label — join memakai ID. UNMAPPED dan UNKNOWN tidak dikreditkan ke campaign mana pun. Total CPA/ROAS dihitung server dari pembilang dan penyebut total.</p>

      <div className="flex flex-wrap items-center gap-2" data-testid="aksi-meta">
        {catatan.length > 0 && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={lihatCatatan} onClick={() => setLihatCatatan((v) => !v)}><AlertTriangle size={14} className="text-orange" /> {catatan.length} catatan cakupan data</button>}
        {[["kesehatan", "Kesehatan & referensi"], ["spend", "Impor spend"], ["target", "Target KPI"], ["monitor", "Monitoring"]].map(([id, label]) => (
          <button key={id} type="button" className={cn("btn btn-sm", panel === id ? "" : "btn-ghost")} aria-pressed={panel === id} onClick={() => setPanel((p) => (p === id ? null : id))} data-testid={`panel-${id}`}>{label}</button>
        ))}
      </div>
      {lihatCatatan && <Card className="!p-4"><ul className="m-0 flex flex-col gap-1 text-[12.5px] text-ink2">{catatan.map((w) => <li key={w.kode + (w.asal || "")} className="ml-4 list-disc break-words">{w.pesan}</li>)}</ul></Card>}
      {panel === "kesehatan" && <KesehatanReferensi />}
      {panel === "spend" && <ImporSpend onSelesai={() => muat(true)} />}
      {panel === "target" && <PanelTarget onSimpan={() => muat(true)} />}
      {panel === "monitor" && <PanelMonitor />}
      {!biaya.tersambung && lap && <p className="t-secondary text-[11.5px]">Opsi sambungan otomatis (tanpa CSV harian): {biaya.opsi.join(" ")}</p>}
      {biaya.tersambung && biaya.definisi && (
        <details className="t-secondary text-[11.5px]" data-testid="definisi-metrik"><summary className="cursor-pointer text-[12px] text-ink2">Definisi metrik biaya</summary><p className="mt-1">{biaya.definisi.ringkas} {biaya.definisi.reaktivasi} {biaya.definisi.kohort}</p></details>
      )}
    </section>
  );
}
