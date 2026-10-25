import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Loader2, RefreshCw, GitCompare } from "lucide-react";
import { api } from "@/api.js";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { makeCustomRange, formatRangeText, todayWIB } from "@/lib/dateRange.js";
import { cn } from "@/lib/utils.js";
import { METRIK_URUT, urutkan, tampilMetrik, selBiaya, penandaPerSumber, bannerUtama, statusMembayar, peringatanUrut, delta, deltaTeks, angka, formatPersen, rupiah, BUKTI_LABEL, teksSorotan, teksPengecualian, teksPengecualianTotal, NOTA_AMBANG, PENYEBUT_LABEL } from "../akuisisiLogic.js";

// ═══ PERFORMA AKUISISI (ADMIN) ════════════════════════════════════════════════════════════════════
// Sumber: GET /api/atribusi/iklan/sumber (baca-saja). Sumber = LABEL CRM; hanya Meta punya atribusi terbukti + biaya. Klien tidak menghitung apa pun: ia menampilkan,
// mengurutkan, dan memformat angka dari server. CPA/ROAS null (—) dengan alasan bila spend/ledger tidak memadai. Rincian per campaign Meta: tab "Iklan".

const rentangBawaan = () => { const k = todayWIB().subtract(1, "day"); return makeCustomRange(k.subtract(29, "day").format("YYYY-MM-DD"), k.format("YYYY-MM-DD")); };
const NADA = { peringatan: "text-orange", baik: "text-green" };

const TIP = {
  sumber: "Sumber = label CRM (Customer.leadSource). Bukan bukti per klik: hanya Meta yang juga punya atribusi terbukti (touch CTWA).",
  lead: "Customer baru yang dibuat di periode dengan label sumber itu. Spam ikut terhitung di sini; lead sah = bukan spam/internal/B2B/karyawan.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer dengan ≥ 1 pembayaran sah di ledger. Batas bawah: pembayaran di luar sistem tidak terlihat.",
  lunas: "Customer dengan order yang ledger-nya menutup seluruh tagihan (setelah refund disetujui).",
  konversi: "UTAMA: customer ber-order ÷ TOTAL lead (termasuk spam), konsisten dengan KPI Oktober. Kolom 'non-spam' = ber-order ÷ lead sah (metrik terpisah). Pembilang dan penyebut ditampilkan. 'Sampel kecil' = < 30 lead — aturan tampilan sementara, bukan uji signifikansi.",
  cpa: "Spend ÷ customer lunas terbukti. Hanya Meta, dan hanya bila spend lengkap serta periode tidak memuat hari berjalan.",
  roas: "Nilai (uang ledger bersih) ÷ spend. Hanya Meta; null bila spend tidak memadai.",
  overlap: "Pernah DP, DP saat ini, dan lunas bisa tumpang tindih (customer DP lalu lunas). Jangan dijumlahkan; pakai pembagian saling lepas.",
};

function Kartu({ judul, nilai, sub, nada, tip, children }) {
  return (
    <Card className="flex flex-col gap-1 !p-4">
      <span className="t-secondary inline-flex items-center gap-1 text-[12.5px]">{judul}{tip && <InfoTooltip text={tip} />}</span>
      <span className={cn("text-[26px] font-semibold leading-tight tabular-nums text-ink", nada)}>{nilai}</span>
      {sub && <span className="t-secondary text-[12px]">{sub}</span>}
      {children}
    </Card>
  );
}

const IKON = {
  META: { bg: "bg-accentbg", t: "text-accent", k: "∞" }, TIKTOK: { bg: "bg-inset", t: "text-ink", k: "♪" }, WHATSAPP: { bg: "bg-greenbg", t: "text-green", k: "✆" },
  INSTAGRAM: { bg: "bg-orangebg", t: "text-orange", k: "◎" }, WEBSITE: { bg: "bg-inset", t: "text-ink2", k: "◌" }, LAINNYA: { bg: "bg-inset", t: "text-ink3", k: "…" },
};
const Ikon = ({ id }) => { const i = IKON[id] || IKON.LAINNYA; return <span aria-hidden className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn text-[17px] font-semibold", i.bg, i.t)}>{i.k}</span>; };

function KartuSumber({ s, metrik, metrikLabel, penanda, delta: d, onBuka }) {
  const t = tampilMetrik(s, metrik);
  return (
    <button type="button" onClick={onBuka} className="text-left" aria-label={`Buka rincian ${s.label}`}>
      <Card className="flex h-full flex-col gap-2 !p-3 transition-shadow hover:shadow-md sm:!p-4">
        <div className="flex items-center gap-3">
          <Ikon id={s.id} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{s.label}</p>
            <span className="t-secondary text-[11px]">{BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"}</span>
          </div>
          <ChevronRight size={16} className="shrink-0 text-ink3" />
        </div>
        {((penanda || []).length > 0 || s.sampelKecil) && (
          <div className="flex flex-wrap items-center gap-1">
            {(penanda || []).map((p) => <Badge key={p.id} variant="green" className="normal-case" title={teksSorotan(p)}>{p.label}</Badge>)}
            {s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}
          </div>
        )}
        {(penanda || []).filter((p) => p.jenis === "KONVERSI_BER_ORDER_PER_TOTAL_LEAD").map((p) => (
          <p key={p.id} className="t-secondary text-[11px] leading-snug">Konversi ber-order {formatPersen(p.nilai)} = {angka(p.pembilang)} dari {angka(p.penyebut)} total lead (termasuk spam). Ambang {s.ambangSampel} lead = aturan tampilan sementara; bukan uji signifikansi, bukan pemenang pasti.</p>
        ))}
        <div>
          <p className="t-secondary text-[12px]">{metrikLabel}</p>
          <span className={cn("text-[22px] font-semibold tabular-nums leading-tight sm:text-[26px]", t.kosong ? "text-ink3" : "text-ink")}>{t.utama}</span>
          {d != null && <span className="t-secondary ml-2 text-[12px]">{deltaTeks(d)} vs sebelumnya</span>}
          {t.sub && <p className="t-secondary text-[12px]">{t.sub}</p>}
        </div>
        <p className="t-secondary text-[12px]">{angka(s.berOrder)} ber-order · {angka(s.membayar)} membayar · {angka(s.lunas)} lunas</p>
      </Card>
    </button>
  );
}

function Rincian({ s, onIklan }) {
  const b = s.biaya || {};
  const baris = [["CPA lunas", selBiaya(b, "cpa")], ["Cash ROAS", selBiaya(b, "cashRoas")], ["Spend", b.spend == null ? { teks: "—", alasan: null, kosong: true } : { teks: rupiah(b.spend), kosong: false }]];
  return (
    <div className="grid gap-3 rounded-btn bg-inset p-3 text-[12.5px] md:grid-cols-3">
      <div>
        <p className="mb-1 font-semibold text-ink">Pembayaran customer <InfoTooltip text={TIP.overlap} /></p>
        <ul className="space-y-0.5 text-ink2">
          <li>Pernah DP: <b>{angka(s.pernahDp)}</b> · DP saat ini: <b>{angka(s.dpSaatIni)}</b> · Lunas: <b>{angka(s.lunas)}</b></li>
          <li className="t-secondary">Tumpang tindih — jangan dijumlahkan.</li>
          <li>Saling lepas: lunas <b>{angka(s.kategoriEksklusif?.lunas)}</b> · DP <b>{angka(s.kategoriEksklusif?.dpSaatIni)}</b> · tidak diketahui <b>{angka(s.kategoriEksklusif?.tidakDiketahui)}</b> · belum bayar <b>{angka(s.kategoriEksklusif?.belumBayar)}</b> (= {angka(s.kategoriEksklusif?.jumlah)} dari {angka(s.berOrder)} ber-order)</li>
          <li className="t-secondary">Tidak diketahui = status bayar tersimpan LUNAS/DP tanpa pembayaran di ledger; bukan 'belum bayar'.</li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">Order &amp; uang</p>
        <ul className="space-y-0.5 text-ink2">
          <li>Konversi non-spam: <b>{formatPersen(s.konversiOrderNonSpam?.nilai)}</b> ({angka(s.konversiOrderNonSpam?.pembilang)} dari {angka(s.konversiOrderNonSpam?.penyebut)} {PENYEBUT_LABEL.LEAD_SAH_NON_SPAM})</li>
          <li>{teksPengecualian(s)}</li>
          <li>Order eligible: <b>{angka(s.order?.eligible)}</b> · punya ledger: <b>{angka(s.order?.berLedger)}</b> ({formatPersen(s.order?.persenBerLedger)})</li>
          <li>Nilai order (saat ini): <b>{rupiah(s.uang?.nilaiOrderSaatIni)}</b></li>
          <li>Uang ledger bersih: <b>{rupiah(s.uang?.uangBersih)}</b></li>
        </ul>
      </div>
      <div>
        <p className="mb-1 font-semibold text-ink">Biaya ({s.biaya?.dasar === "ATRIBUSI_TERBUKTI" ? "atribusi terbukti" : "tidak tersedia"})</p>
        <ul className="space-y-0.5 text-ink2">
          {baris.map(([n, c]) => <li key={n}>{n}: <b className={c.kosong ? "text-ink3" : ""}>{c.teks}</b>{c.alasan && <span className="t-secondary"> · {c.alasan}</span>}</li>)}
        </ul>
        {s.id === "META" && <button className="mt-2 text-accent hover:underline" onClick={onIklan}>Lihat per campaign →</button>}
        <p className="t-secondary mt-1">{s.buktiAtribusi?.catatan}</p>
      </div>
    </div>
  );
}

export default function AkuisisiTab({ onBukaIklan }) {
  const [range, setRange] = useState(rentangBawaan);
  const [metrik, setMetrik] = useState("berOrder");
  const [bandingkan, setBandingkan] = useState(false);
  const [lap, setLap] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState(null);
  const [buka, setBuka] = useState(null);
  const [lihatCatatan, setLihatCatatan] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat(null);
    try {
      setLap(await api.getAtribusiSumber({ dari: range.from, sampai: range.to, ...(bandingkan ? { pembanding: "1" } : {}) }));
    } catch (e) {
      setLap(null);
      setGalat(e?.status === 429 ? "Laporan sedang dihitung untuk permintaan lain — coba lagi sebentar." : (e?.message || "Gagal memuat performa akuisisi."));
    } finally { setMemuat(false); }
  }, [range, bandingkan]);
  useEffect(() => { muat(); }, [muat]);

  const urut = useMemo(() => urutkan(lap?.sumber || [], metrik), [lap, metrik]);
  const penanda = useMemo(() => penandaPerSumber(lap?.sorotan), [lap]);
  const banner = bannerUtama(lap);
  const bayar = statusMembayar(lap);
  const catatan = useMemo(() => peringatanUrut(lap), [lap]);
  const t = lap?.total;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px]">
          <h2 className="text-[22px] font-semibold leading-tight text-ink">Performa Akuisisi</h2>
          <p className="t-secondary text-[12.5px]">Semua sumber · Periode lead: <b>{formatRangeText(range)}</b> (WIB){lap?.periode?.termasukHariBerjalan ? " · memuat hari berjalan" : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={muat} disabled={memuat}>{memuat ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</button>
          <button className={cn("btn btn-sm", bandingkan ? "btn-primary" : "btn-ghost")} aria-pressed={bandingkan} onClick={() => setBandingkan((v) => !v)}><GitCompare size={14} /> Bandingkan</button>
          <DateRangePicker value={range} onChange={setRange} showCompare={false} allowAll={false} />
        </div>
      </div>

      {galat && <Card><p className="flex items-center gap-2 text-sm text-red"><AlertTriangle size={16} /> {galat}</p></Card>}
      {!lap && memuat && <Card><p className="flex items-center gap-2 text-sm text-ink3"><Loader2 size={16} className="animate-spin" /> Memuat…</p></Card>}

      {banner && <div role="status" className="flex items-center gap-2 rounded-card bg-orangebg px-4 py-2.5 text-[13px] font-medium text-orange"><AlertTriangle size={16} /> {banner}</div>}

      {lap && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Kartu judul="Lead masuk" nilai={angka(t.lead)} sub={`${angka(t.leadSah)} sah · ${angka(t.spam)} spam`} tip={TIP.lead} />
            <Kartu judul="Customer ber-order" nilai={angka(t.berOrder)} sub={`dari ${angka(t.leadSah)} lead sah`} tip={TIP.berOrder} />
            <Kartu judul="Customer membayar" nilai={bayar.lengkap ? angka(t.membayar) : "Belum lengkap"} nada={bayar.lengkap ? "" : NADA.peringatan}
              sub={bayar.lengkap ? "pembayaran sah di ledger" : `≥ ${angka(t.membayar)} terbukti · ${bayar.teks}`} tip={TIP.membayar} />
            <Kartu judul="Customer lunas" nilai={bayar.lengkap ? angka(t.lunas) : `≥ ${angka(t.lunas)}`} sub="ledger menutup seluruh tagihan" tip={TIP.lunas} />
            <Kartu judul="Cakupan data" nilai={<button className="text-[20px] text-accent hover:underline" onClick={() => setLihatCatatan((v) => !v)}>Lihat detail →</button>} sub={`${catatan.length} catatan · ledger ${formatPersen(lap.status?.ledger?.persen)}`} />
          </div>

          {lihatCatatan && (
            <Card className="flex flex-col gap-2 !p-4">
              {catatan.map((w) => (
                <p key={w.kode} className="flex items-start gap-2 text-[12.5px] text-ink2"><Info size={14} className="mt-0.5 shrink-0 text-accent" /> <span><b>{w.kode.replace(/_/g, " ").toLowerCase()}</b> — {w.pesan}</span></p>
              ))}
              <p className="t-secondary text-[12px]">Status: spend <b>{lap.status?.spend}</b> · atribusi mulai <b>{lap.status?.atribusi?.mulaiHari || "belum ada"}</b> · Meta label CRM {angka(lap.status?.atribusi?.metaLabelCrm)} vs terbukti {angka(lap.status?.atribusi?.metaAkuisisiTerbukti)}</p>
            </Card>
          )}

          <section aria-label="Highlight sumber" className="flex flex-col gap-2">
            <h3 className="text-[16px] font-semibold text-ink">Highlight sumber</h3>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
              {urut.map((s) => <KartuSumber key={s.id} s={s} metrik={metrik} metrikLabel={METRIK_URUT.find((m) => m.id === metrik)?.label} penanda={penanda.get(s.id)} delta={bandingkan ? delta(lap, s.id, metrik === "lead" ? "lead" : metrik === "membayar" ? "membayar" : metrik === "lunas" ? "lunas" : "berOrder") : null} onBuka={() => setBuka(buka === s.id ? null : s.id)} />)}
            </div>
          </section>

          <section aria-label="Peringkat sumber" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-[16px] font-semibold text-ink">Peringkat sumber</h3>
                <p className="t-secondary text-[12.5px]">Peringkat berdasarkan <b>{METRIK_URUT.find((m) => m.id === metrik)?.label?.toLowerCase()}</b>; sumber dengan sampel kecil (&lt; 30 lead) tidak dibandingkan pada rasio.</p>
              </div>
              <label className="flex w-full min-w-0 items-center gap-2 text-[12.5px] text-ink2 sm:inline-flex sm:w-auto">Urutkan
                <select className="min-w-0 max-w-full flex-1 rounded-btn bg-inset px-2 py-1.5 text-[13px] text-ink sm:flex-none" value={metrik} onChange={(e) => setMetrik(e.target.value)} aria-label="Urutkan peringkat menurut">
                  {METRIK_URUT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            </div>

            {/* desktop/tablet: tabel */}
            <Card className="hidden overflow-x-auto !p-0 md:block">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink3">
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Sumber</th>
                    <th className="px-3 py-2 text-right">Lead</th><th className="px-3 py-2 text-right">Spam</th><th className="px-3 py-2 text-right">Ber-order</th>
                    <th className="px-3 py-2 text-right">Membayar</th><th className="px-3 py-2 text-right">Lunas</th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">Konversi ÷ lead <InfoTooltip text={TIP.konversi} /></span></th>
                    <th className="px-3 py-2 text-right">Non-spam</th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">CPA lunas <InfoTooltip text={TIP.cpa} /></span></th>
                    <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1">ROAS <InfoTooltip text={TIP.roas} /></span></th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {urut.map((s, i) => {
                    const cpa = selBiaya(s.biaya, "cpa"), roas = selBiaya(s.biaya, "cashRoas");
                    return (
                      <React.Fragment key={s.id}>
                        <tr className="cursor-pointer border-b border-line/60 hover:bg-inset/60" onClick={() => setBuka(buka === s.id ? null : s.id)}>
                          <td className="px-3 py-2 tabular-nums text-ink3">{i + 1}</td>
                          <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><Ikon id={s.id} /><span className="font-medium text-ink">{s.label}</span>{s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}</span></td>
                          <td className="px-3 py-2 text-right tabular-nums">{angka(s.lead)}</td>
                          <td className="px-3 py-2 text-right tabular-nums" title={`${s.spamPersen.pembilang} dari ${s.spamPersen.penyebut} lead`}>{formatPersen(s.spamPersen.nilai)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{angka(s.berOrder)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{angka(s.membayar)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{angka(s.lunas)}</td>
                          <td className="px-3 py-2 text-right tabular-nums" title={`${s.konversiOrder.pembilang} dari ${s.konversiOrder.penyebut} total lead (termasuk spam)`}>{formatPersen(s.konversiOrder.nilai)}<span className="t-secondary block text-[10.5px]">{s.konversiOrder.pembilang}/{s.konversiOrder.penyebut}</span></td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink2" title={`${s.konversiOrderNonSpam.pembilang} dari ${s.konversiOrderNonSpam.penyebut} lead sah (non-spam)`}>{formatPersen(s.konversiOrderNonSpam.nilai)}<span className="t-secondary block text-[10.5px]">{s.konversiOrderNonSpam.pembilang}/{s.konversiOrderNonSpam.penyebut}</span></td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", cpa.kosong && "text-ink3")}>{cpa.teks}{cpa.alasan && <span className="block text-[10.5px]">{cpa.alasan}</span>}</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", roas.kosong && "text-ink3")}>{roas.teks}{roas.alasan && <span className="block text-[10.5px]">{roas.alasan}</span>}</td>
                          <td className="px-3 py-2 text-ink3">{buka === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                        </tr>
                        {buka === s.id && <tr><td colSpan={12} className="px-3 pb-3"><Rincian s={s} onIklan={onBukaIklan} /></td></tr>}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {/* mobile: kartu bertumpuk (tanpa scroll horizontal) */}
            <div className="md:hidden">
              <div className="flex flex-col gap-2">
              {urut.map((s, i) => {
                const cpa = selBiaya(s.biaya, "cpa");
                return (
                  <Card key={s.id} className="flex flex-col gap-2 !p-3">
                    <button className="flex items-center gap-2 text-left" onClick={() => setBuka(buka === s.id ? null : s.id)} aria-expanded={buka === s.id}>
                      <span className="w-5 text-[12px] tabular-nums text-ink3">{i + 1}</span><Ikon id={s.id} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{s.label}</span>{s.sampelKecil && <Badge variant="orange" className="normal-case">Sampel kecil</Badge>}</span>
                      {buka === s.id ? <ChevronDown size={16} className="text-ink3" /> : <ChevronRight size={16} className="text-ink3" />}
                    </button>
                    <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-[12px]">
                      {[["Lead", angka(s.lead)], ["Spam", formatPersen(s.spamPersen.nilai)], ["Ber-order", angka(s.berOrder)], ["Membayar", angka(s.membayar)], ["Lunas", angka(s.lunas)], ["Konversi ÷ lead", `${formatPersen(s.konversiOrder.nilai)} (${s.konversiOrder.pembilang}/${s.konversiOrder.penyebut})`], ["Non-spam", `${formatPersen(s.konversiOrderNonSpam.nilai)} (${s.konversiOrderNonSpam.pembilang}/${s.konversiOrderNonSpam.penyebut})`]].map(([k, v]) => (
                        <div key={k}><dt className="t-secondary">{k}</dt><dd className="font-medium tabular-nums text-ink">{v}</dd></div>
                      ))}
                      <div className="col-span-3"><dt className="t-secondary">CPA lunas</dt><dd className={cn("font-medium", cpa.kosong && "text-ink3")}>{cpa.teks}{cpa.alasan && <span className="t-secondary"> · {cpa.alasan}</span>}</dd></div>
                    </dl>
                    {buka === s.id && <Rincian s={s} onIklan={onBukaIklan} />}
                  </Card>
                );
              })}
              </div>
            </div>
          </section>

          <div className="t-secondary flex flex-col gap-1 text-[12.5px]">
            <p>{teksPengecualianTotal(lap)}</p>
            <p>{NOTA_AMBANG}</p>
          </div>
          <p className="t-secondary flex items-center gap-2 text-[12.5px]"><Info size={14} className="text-accent" /> Ber-order ≠ lunas. Sumber = label CRM; nilai order = nilai saat ini; angka dihitung server dari data aktual. {lap.pembanding ? `Pembanding: ${lap.pembanding.periode.dari} s/d ${lap.pembanding.periode.sampai}.` : ""}</p>
        </>
      )}
    </div>
  );
}
