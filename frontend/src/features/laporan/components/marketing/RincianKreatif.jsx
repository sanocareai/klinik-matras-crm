import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Info, Loader2, Search } from "lucide-react";
import { api } from "@/api.js";
import { formatRupiah, SOURCE_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { sumberAkuisisiDariTraffic } from "../../periodeLaporan.js";
import ChartCard from "../ChartCard.jsx";

// Rincian kreatif/tautan + Nilai per lead per platform (pindahan dari tab Traffic). BASIS LEGACY (analytics/lead-source-detail & source-performance): tetap tersedia agar tidak ada fitur yang hilang,
// tetapi bukan atribusi campaign. Dibuka dari detail satu sumber (filter sumber terisi awal). Angka biaya/CPA/ROAS resmi ada di tabel sumber dan detail sumber Marketing.
// Warna per sumber — SATU warna per kanal, dipakai konsisten di bar
// proporsi & titik daftar supaya mata bisa mencocokkan keduanya tanpa
// legend terpisah.
const WARNA_SUMBER = {
  META_ADS: "var(--blue-600)",
  GOOGLE_ADS: "var(--green)",
  TIKTOK_ADS: "var(--red)",
  INSTAGRAM: "var(--violet, #7c3aed)",
  WEBSITE_ORGANIC: "var(--orange)",
  WHATSAPP_DIRECT: "var(--text-tertiary)",
  REFERRAL: "var(--accent)",
  OTHER: "var(--text-tertiary)",
  LAINNYA: "var(--text-tertiary)",
};

// Header kolom yang bisa disortir di tabel "Rincian per Iklan" — panah cuma
// muncul untuk kolom yang SEDANG aktif (biar header tidak ramai), sama pola
// dengan TH sortable di components/ui/table.jsx.
function SortableLabel({ label, sortKey, sortBy, sortDir, onSort }) {
  const active = sortBy === sortKey;
  return (
    <button
      type="button" onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-0.5 uppercase tracking-wide transition-colors hover:text-ink",
        active && "text-ink2",
      )}
    >
      {label}
      {active && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  );
}

const LABEL_PLATFORM = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  WHATSAPP: "WA Status",
  UNKNOWN: "—",
};

export default function RincianKreatif({ traffic, sourceDetail, rangeParams, sumberLabelAwal = "", onBukaAkuisisi }) {
  const atribusi = traffic?.atribusi;

  // ── Filter/pencarian/sortir di "Rincian per Iklan" ────────────────────
  // Backend memotong ke 30 baris teratas + gabung sisanya jadi "LAINNYA"
  // (lihat catatan `BATAS` di routes/analytics.js) — kalau filter/pencarian
  // ini cuma menyaring `sourceDetail.data` yang SUDAH terpotong di client,
  // baris yang kebetulan jatuh ke dalam "LAINNYA" jadi tidak pernah bisa
  // ditemukan lewat filter apa pun, dan sortir kolom selain Lead jadi cuma
  // mengurutkan ULANG 30 baris ber-lead-terbanyak (bukan cari yang sebenarnya
  // TERTINGGI di kolom itu). Makanya semuanya SELF-FETCH ulang dari backend
  // (?source=&q=&sortBy=&sortDir=) — potongan 30 barisnya jadi berlaku
  // SETELAH difilter/disortir, bukan sebelum.
  const [fSumber, setFSumber] = useState(sumberLabelAwal);
  const [fCari, setFCari] = useState("");
  const [debouncedCari, setDebouncedCari] = useState("");
  const [sortBy, setSortBy] = useState("leads");
  const [sortDir, setSortDir] = useState("desc");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCari(fCari.trim()), 300);
    return () => clearTimeout(t);
  }, [fCari]);
  function toggleSort(key) {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("desc"); }
  }
  // Kombinasi default PERSIS = apa yang sudah dimuat prop `sourceDetail`
  // (leads desc, tanpa filter/pencarian) — jadi tidak perlu fetch ulang
  // kalau user belum menyentuh kontrol apa pun.
  const isDefaultView = !fSumber && !debouncedCari && sortBy === "leads" && sortDir === "desc";
  const [filteredDetail, setFilteredDetail] = useState(null);
  const [loadingFilter, setLoadingFilter] = useState(false);
  useEffect(() => {
    if (isDefaultView) { setFilteredDetail(null); return; }
    let batal = false;
    setLoadingFilter(true);
    api.getLeadSourceDetail({ ...rangeParams, source: fSumber, q: debouncedCari, sortBy, sortDir })
      .then((res) => { if (!batal) setFilteredDetail(res); })
      .catch(() => { if (!batal) setFilteredDetail(null); })
      .finally(() => { if (!batal) setLoadingFilter(false); });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDefaultView, fSumber, debouncedCari, sortBy, sortDir, rangeParams?.from, rangeParams?.to]);
  const detailAktif = isDefaultView ? sourceDetail : filteredDetail;
  // Opsi dropdown dari sumber yang BENAR-BENAR punya lead periode ini
  // (`atribusi.bySource`, sudah dimuat) — bukan daftar tetap yang bisa
  // menampilkan pilihan kosong (mis. "Referral" padahal 0 lead bulan ini).
  const opsiSumber = useMemo(
    () => [...(atribusi?.bySource || [])].sort((a, b) => b.count - a.count),
    [atribusi],
  );

  // ── Performa per Platform (CPA/ROAS, 30 Agustus 2026) ──────────────────
  // Beda dari "Rincian per Iklan" di bawah: itu per KREATIF/link spesifik,
  // ini per PLATFORM saja (Meta Ads, Google Ads, dst) TAPI dilengkapi biaya
  // iklan (input manual admin, lihat Pengaturan > Biaya Iklan) sehingga bisa
  // menghitung CPA (biaya ÷ closing) dan ROAS (nilai order ÷ biaya) — dua
  // angka yang tidak bisa dihitung "Sumber Lead" karena itu tidak tahu
  // biaya. Satu fetch untuk SEMUA sumber (dropdown cuma pindah tampilan,
  // tidak fetch ulang) — sumber datanya sama dengan Rincian per Iklan
  // (`/analytics/source-performance`), yang sebelum ini tidak dipakai
  // frontend mana pun.
  // Default "" = Semua Platform — tabel ringkas SEMUA sumber (paid ads
  // Meta/Google MAUPUN organik Website/Instagram/WhatsApp Langsung/Referral)
  // sekaligus, sama seperti default "Rincian per Iklan" di bawah (tanpa
  // filter = semua baris). Pilih satu dari dropdown untuk melihat detailnya
  // dalam kartu statistik besar — dua tampilan ini melayani pertanyaan beda
  // ("bandingkan semua platform" vs "dalami satu platform").
  const [platformSel, setPlatformSel] = useState(sumberLabelAwal);
  const [perf, setPerf] = useState(null); // { months, spendNote, data }
  const [loadingPerf, setLoadingPerf] = useState(false);
  useEffect(() => {
    let batal = false;
    setLoadingPerf(true);
    api.getAnalyticsSourcePerformance({ ...rangeParams })
      .then((res) => { if (!batal) setPerf(res); })
      .catch(() => { if (!batal) setPerf(null); })
      .finally(() => { if (!batal) setLoadingPerf(false); });
    return () => { batal = true; };
  }, [rangeParams?.from, rangeParams?.to]);
  const perfRows = useMemo(
    () => [...(perf?.data || [])].sort((a, b) => b.leads - a.leads),
    [perf],
  );
  const perfRow = useMemo(
    () => perfRows.find((r) => r.source === platformSel) || null,
    [perfRows, platformSel],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ── Performa per Platform (CPA/ROAS) ──────────────────────────────
          Default (tanpa filter) = tabel SEMUA sumber sekaligus, paid ads
          (Meta/Google, yang punya biaya) MAUPUN organik (Website/Instagram/
          WhatsApp Langsung/Referral, yang wajar tidak punya biaya) — sama
          persis pola default "Rincian per Iklan" di bawah. Pilih satu dari
          dropdown untuk mendalami platform itu lewat kartu statistik besar. */}
      {perfRows.length > 0 && (
        <ChartCard
          index={9}
          title="Performa per Platform"
          description="Biaya iklan (input manual, total bulanan) dibagi hasil, per platform — pilih satu untuk detail. Untuk biaya periode tepat + nilai order & pembayaran, buka Akuisisi."
          actions={
            <>
            {onBukaAkuisisi && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBukaAkuisisi(sumberAkuisisiDariTraffic(platformSel) || null)}>{platformSel && sumberAkuisisiDariTraffic(platformSel) ? "Detail di Akuisisi" : "Buka Akuisisi"} <ArrowRight size={12} /></button>}
            <FilterDropdown
              value={platformSel}
              onChange={setPlatformSel}
              options={opsiSumber.map((s) => ({ value: s.source, label: `${SOURCE_LABELS[s.source] || s.source} (${s.count})` }))}
              placeholder="Semua Platform"
              ariaLabel="Pilih platform di Performa per Platform"
              triggerClassName="h-7 text-[12px]"
            />
            </>
          }
        >
          {loadingPerf ? (
            <p className="py-8 text-center text-[12.5px] text-ink3">Memuat…</p>
          ) : !platformSel ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                    <th className="pb-2 pr-3 font-medium">Platform</th>
                    <th className="pb-2 pr-3 text-right font-medium">Lead</th>
                    <th className="pb-2 pr-3 text-right font-medium"><span className="inline-flex items-center justify-end gap-1">Transaksi (stage CRM)<InfoTooltip text="Customer di stage TRANSACTION/REVIEWED (ditandai manual sales) dengan order tidak batal. Basis legacy: BUKAN customer ber-order eligible dan BUKAN lunas ledger." /></span></th>
                    <th className="pb-2 pr-3 text-right font-medium">Konversi</th>
                    <th className="pb-2 pr-3 text-right font-medium">Spam</th>
                    <th className="pb-2 pr-3 text-right font-medium">Biaya Iklan</th>
                    <th className="pb-2 pr-3 text-right font-medium">
                      <span className="inline-flex items-center justify-end gap-1">
                        CPA
                        <InfoTooltip text="Cost per Acquisition = Biaya Iklan ÷ jumlah Transaksi (stage CRM) platform ini (basis legacy; CPA lunas resmi ada di tabel sumber). Kosong untuk sumber organik (tidak ada biaya) atau platform yang biayanya belum diisi admin." />
                      </span>
                    </th>
                    <th className="pb-2 pr-3 text-right font-medium">
                      <span className="inline-flex items-center justify-end gap-1">
                        ROAS
                        <InfoTooltip text="Return on Ad Spend = Nilai Order ÷ Biaya Iklan. Cuma terisi untuk platform yang biaya iklannya sudah diinput admin." />
                      </span>
                    </th>
                    <th className="pb-2 text-right font-medium text-ink2">
                      <span className="inline-flex items-center justify-end gap-1">
                        Nilai/Lead
                        <InfoTooltip text="Nilai/Lead = total Nilai Order ÷ total Lead (BUKAN cuma yang closing) dari platform ini — beda dari CPA/ROAS, ini TIDAK butuh data biaya iklan sama sekali, jadi tetap terisi untuk platform organik. Angka paling menentukan buat bandingkan kualitas SEMUA sumber apel-ke-apel." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perfRows.map((row) => (
                    <tr key={row.source} className="cursor-pointer border-b border-line hover:bg-inset" onClick={() => setPlatformSel(row.source)}>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: WARNA_SUMBER[row.source] || "var(--text-tertiary)" }} />
                          <span className="text-ink2">{SOURCE_LABELS[row.source] || row.source}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{row.leads}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink2">{row.won}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink2">
                        {row.convRate == null ? "—" : `${row.convRate}%`}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink3">
                        {row.spamRate == null ? "—" : `${row.spamRate}%`}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink3">
                        {row.spend == null ? "—" : formatRupiah(row.spend)}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-accent">
                        {row.cpa == null ? "—" : formatRupiah(row.cpa)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink2">
                        {row.roas == null ? "—" : `${row.roas}×`}
                      </td>
                      <td className={cn(
                        "py-2 text-right font-semibold tabular-nums",
                        row.nilaiPerLead > 0 ? "text-ink" : "text-ink3",
                      )}>
                        {row.nilaiPerLead == null ? "—" : formatRupiah(row.nilaiPerLead)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                Klik baris untuk detail satu platform. Kolom Biaya Iklan/CPA/ROAS kosong untuk sumber
                organik (memang tidak punya biaya) atau platform yang biayanya belum diisi admin —
                pakai kolom Nilai/Lead untuk bandingkan SEMUA platform (termasuk organik) apel-ke-apel.
                {perf?.spendNote ? <> {perf.spendNote}</> : null}
              </p>
            </div>
          ) : !perfRow ? (
            <p className="py-8 text-center text-[12.5px] text-ink3">
              Belum ada data untuk platform ini pada periode ini.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPlatformSel("")}
                className="mb-3 flex items-center gap-1 text-[11.5px] font-medium text-ink3 hover:text-ink"
              >
                <ArrowRight size={11} className="rotate-180" /> Kembali ke semua platform
              </button>
              {/* Biaya iklan cuma tercatat kalau admin sudah input di Pengaturan
                  > Biaya Iklan — beda dari 0 (dientri sengaja Rp0), null berarti
                  memang belum pernah diisi, tampil "belum diisi" apa adanya. */}
              {perfRow.spend == null && (
                <div className="mb-3 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-orange" />
                  <p className="text-[11.5px] leading-relaxed text-ink">
                    Biaya iklan <strong>{SOURCE_LABELS[perfRow.source] || perfRow.source}</strong> belum
                    diisi untuk bulan yang tersentuh periode ini — CPA/ROAS tidak bisa dihitung.
                    Isi di <Link to="/pengaturan-sales?section=ad-spend" className="font-semibold text-accent hover:underline">Pengaturan &gt; Biaya Iklan</Link>.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Lead</p>
                  <p className="text-lg font-bold tabular-nums text-ink">{perfRow.leads}</p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Transaksi (stage CRM)</p>
                  <p className="text-lg font-bold tabular-nums text-ink">{perfRow.won}</p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Konversi</p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.convRate == null ? "—" : `${perfRow.convRate}%`}
                  </p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Spam</p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.spamRate == null ? "—" : `${perfRow.spamRate}%`}
                  </p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Biaya Iklan</p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.spend == null ? "—" : formatRupiah(perfRow.spend)}
                  </p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Cost per Lead</p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.costPerLead == null ? "—" : formatRupiah(perfRow.costPerLead)}
                  </p>
                </div>
                <div className="rounded-btn bg-accentbg px-3 py-2.5">
                  <p className="t-caption mb-1 flex items-center gap-1">
                    CPA
                    <InfoTooltip text="Cost per Acquisition = Biaya Iklan ÷ jumlah Transaksi (stage CRM) dari platform ini (basis legacy; CPA lunas resmi ada di tabel sumber). Biaya per 1 pelanggan bertransaksi, bukan per lead masuk." />
                  </p>
                  <p className="text-lg font-bold tabular-nums text-accent">
                    {perfRow.cpa == null ? "—" : formatRupiah(perfRow.cpa)}
                  </p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1 flex items-center gap-1">
                    ROAS
                    <InfoTooltip text="Return on Ad Spend = Nilai Order ÷ Biaya Iklan. Contoh: 4.2 artinya tiap Rp1 belanja iklan platform ini menghasilkan Rp4.200.000-nya (per Rp1jt)." />
                  </p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.roas == null ? "—" : `${perfRow.roas}×`}
                  </p>
                </div>
                <div className="rounded-btn bg-inset px-3 py-2.5">
                  <p className="t-caption mb-1">Rata2 Order</p>
                  <p className="text-lg font-bold tabular-nums text-ink">
                    {perfRow.avgOrderValue == null ? "—" : formatRupiah(perfRow.avgOrderValue)}
                  </p>
                </div>
                <div className="rounded-btn bg-accentbg px-3 py-2.5">
                  <p className="t-caption mb-1 flex items-center gap-1">
                    Nilai/Lead
                    <InfoTooltip text="Nilai/Lead = total Nilai Order ÷ total Lead (BUKAN cuma yang closing) dari platform ini. Beda dari CPA/ROAS: ini TIDAK butuh data biaya iklan, jadi tetap terisi untuk platform organik — angka paling menentukan buat bandingkan SEMUA sumber apel-ke-apel, iklan atau bukan." />
                  </p>
                  <p className="text-lg font-bold tabular-nums text-accent">
                    {perfRow.nilaiPerLead == null ? "—" : formatRupiah(perfRow.nilaiPerLead)}
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                Nilai Order dari platform ini pada periode ini: <strong>{formatRupiah(perfRow.totalValue)}</strong>.
                {perf?.spendNote ? <> {perf.spendNote}</> : null}
              </p>
            </>
          )}
        </ChartCard>
      )}

      {/* ── Rincian per iklan spesifik ──────────────────────────────────────
          Beda dari "Sumber Lead" di atas: itu per PLATFORM (Meta Ads: 95),
          ini per IKLAN/KREATIF (fb.me/77pJdJNsy: 40, instagram.com/p/DXWbO:
          30, dst) — dari Customer.leadSourceDetail apa adanya, tidak
          dinormalisasi/ditebak lebih lanjut. */}
      {(sourceDetail?.data || []).length > 0 && (
        <ChartCard
          index={10}
          title="Rincian per Iklan"
          description="Kreatif/link spesifik mana yang benar-benar menghasilkan, bukan cuma platformnya"
          actions={
            // flex-wrap — di layar sempit, search box + dropdown TIDAK
            // dipaksa muat 1 baris bersama title (lihat catatan panjang di
            // ChartCard.jsx); kalau masih belum cukup lebar meski title
            // sudah turun ke barisnya sendiri, 2 kontrol ini boleh pecah jadi
            // baris sendiri, bukan kepotong.
            <div className="flex flex-wrap items-center gap-1.5">
              {loadingFilter && <Loader2 size={13} className="animate-spin text-ink3 shrink-0" />}
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  type="search" value={fCari} onChange={(e) => setFCari(e.target.value)}
                  placeholder="Cari detail…"
                  aria-label="Cari kreatif/link di Rincian per Iklan"
                  className="h-7 w-32 rounded-btn border-0 bg-inset pl-6 pr-2 text-[12px] text-ink2 placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
              <FilterDropdown
                value={fSumber}
                onChange={setFSumber}
                options={opsiSumber.map((s) => ({ value: s.source, label: `${SOURCE_LABELS[s.source] || s.source} (${s.count})` }))}
                placeholder="Semua Sumber"
                ariaLabel="Filter sumber di Rincian per Iklan"
                triggerClassName="h-7 text-[12px]"
              />
            </div>
          }
        >
          {/* Basis periode WAJIB dijelaskan — angkanya memang beda dari
              Dashboard, dan tanpa penjelasan itu terbaca sebagai data rusak.
              Lihat catatan panjang di backend/src/routes/analytics.js.
              Kalimat rekonsiliasi "cocok dengan Dashboard" cuma ditampilkan
              saat TIDAK ada filter sumber (sourceFilter null dari backend) —
              begitu difilter ke 1 sumber, jumlahnya tidak lagi bisa
              direkonsiliasi ke Dashboard yang menggabung semua sumber. */}
          <div className="mb-3 flex items-start gap-2 rounded-btn bg-inset px-3 py-2">
            <Info size={13} className="mt-0.5 shrink-0 text-ink3" />
            <p className="text-[11.5px] leading-relaxed text-ink2">
              Nilai order di sini = <strong>semua order dari lead yang MASUK pada periode ini</strong>,
              termasuk yang baru bertransaksi belakangan. Beda dengan Dashboard yang menghitung
              <strong> order yang dibuat pada periode ini</strong> (bisa dari lead lama).
              Dua-duanya benar — untuk menilai iklan, yang dipakai adalah basis "kapan leadnya masuk".
              {/* Jembatan angka — supaya "kenapa beda dengan Ringkasan?" tidak
                  perlu ditanyakan berulang tiap ganti rentang tanggal. */}
              {!fSumber && !debouncedCari && sourceDetail.leadLama?.order > 0 && (
                <>
                  {" "}<strong>+ {formatRupiah(sourceDetail.leadLama.totalValue)}</strong> dari{" "}
                  <strong>{sourceDetail.leadLama.order} order lead lama</strong> yang baru bertransaksi
                  periode ini = <strong>{formatRupiah(sourceDetail.sesuaiRingkasan)}</strong> (cocok dengan Dashboard).
                </>
              )}
              {(fSumber || debouncedCari) && (
                <> Sedang difilter{fSumber ? <> ke <strong>{SOURCE_LABELS[fSumber] || fSumber}</strong></> : null}{debouncedCari ? <> dengan kata kunci "<strong>{debouncedCari}</strong>"</> : null} — total di bawah tidak dibandingkan ke Dashboard (itu menggabung semua sumber).</>
              )}
            </p>
          </div>

          {!detailAktif ? (
            <p className="py-8 text-center text-[12.5px] text-ink3">
              {loadingFilter ? "Memuat…" : "Gagal memuat data untuk filter ini."}
            </p>
          ) : detailAktif.data.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-ink3">
              Tidak ada lead yang cocok
              {fSumber ? <> dari {SOURCE_LABELS[fSumber] || fSumber}</> : null}
              {debouncedCari ? <> dengan kata kunci "{debouncedCari}"</> : null} pada periode ini.
            </p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                  <th className="pb-2 pr-3 font-medium">Sumber</th>
                  <th className="pb-2 pr-3 font-medium">Platform</th>
                  <th className="pb-2 pr-3 font-medium">Detail</th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Lead" sortKey="leads" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Termasuk chat junk/salah sasaran (SPAM) — lihat kolom Spam di sebelah" />
                    </span>
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Spam" sortKey="spamRate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Persentase lead dari sumber ini yang ditandai SPAM/chat junk — bukan penalti, diagnostik kualitas targeting. SPAM SENGAJA tidak dikecualikan dari Lead/Konversi di sini (beda dari Laporan Sales) supaya channel bertargeting buruk tidak tersembunyi" />
                    </span>
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <SortableLabel label="Transaksi (stage CRM)" sortKey="won" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Konversi" sortKey="convRate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Konversi = (lead dari sumber ini di stage Transaksi dengan order tidak batal) ÷ (total Lead dari sumber ini) × 100%. Beda dari Laporan Sales: di sini SPAM TIDAK dikecualikan dari penyebutnya (sengaja, supaya sumber bertargeting buruk tidak tersembunyi)." />
                    </span>
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Rata2 Order" sortKey="avgOrderValue" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Rata2 Order (AOV sumber ini) = total Nilai Order ÷ jumlah Transaksi (stage CRM) dari sumber ini — rata-rata besar 1 order yang closing." />
                    </span>
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium text-ink2">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Nilai/Lead" sortKey="nilaiPerLead" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Nilai/Lead = total Nilai Order ÷ total Lead (BUKAN cuma yang closing) dari sumber ini — rupiah yang dihasilkan SATU lead rata-rata, angka paling menentukan untuk membandingkan iklan." />
                    </span>
                  </th>
                  <th className="pb-2 text-right font-medium">
                    <SortableLabel label="Nilai Order" sortKey="totalValue" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {detailAktif.data.map((row) => (
                  <tr
                    key={`${row.source}-${row.detail}`}
                    className={cn("border-b border-line", row.agregat && "text-ink3")}
                  >
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: WARNA_SUMBER[row.source] || "var(--text-tertiary)" }}
                        />
                        <span className="text-ink2">{SOURCE_LABELS[row.source] || row.source}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-ink2">{LABEL_PLATFORM[row.platform] || "—"}</td>
                    <td className="max-w-[280px] truncate py-2 pr-3 text-ink3" title={row.detail}>{row.detail}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{row.leads}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink3">
                      {row.spamRate == null ? "—" : `${row.spamRate}%`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink2">{row.won}</td>
                    {/* null = penyebutnya nol ("belum ada closing"), BEDA dari
                        0% / Rp0. Ditampilkan "—" supaya tidak terbaca sebagai
                        "sudah dicoba dan hasilnya nol". */}
                    <td className="py-2 pr-3 text-right tabular-nums text-ink2">
                      {row.convRate == null ? "—" : `${row.convRate}%`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink3">
                      {row.avgOrderValue == null ? "—" : formatRupiah(row.avgOrderValue)}
                    </td>
                    <td className={cn(
                      "py-2 pr-3 text-right font-semibold tabular-nums",
                      row.nilaiPerLead > 0 ? "text-ink" : "text-ink3",
                    )}>
                      {row.nilaiPerLead == null ? "—" : formatRupiah(row.nilaiPerLead)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink2">{formatRupiah(row.totalValue)}</td>
                  </tr>
                ))}
                {/* Baris total — supaya angka di tabel ini bisa DIREKONSILIASI,
                    bukan sekadar dipercaya. Versi sebelumnya memotong 30 baris
                    teratas tanpa menyebut sisanya, jadi menjumlah kolom di
                    layar tidak pernah ketemu total mana pun. */}
                {detailAktif.total && (
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="py-2.5 pr-3 text-ink" colSpan={3}>
                      {fSumber ? `Total ${SOURCE_LABELS[fSumber] || fSumber}` : "Total seluruh sumber"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">{detailAktif.total.leads}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                      {detailAktif.total.spamRate == null ? "—" : `${detailAktif.total.spamRate}%`}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">{detailAktif.total.won}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                      {detailAktif.total.convRate == null ? "—" : `${detailAktif.total.convRate}%`}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                      {detailAktif.total.avgOrderValue == null ? "—" : formatRupiah(detailAktif.total.avgOrderValue)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                      {detailAktif.total.nilaiPerLead == null ? "—" : formatRupiah(detailAktif.total.nilaiPerLead)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">{formatRupiah(detailAktif.total.totalValue)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </ChartCard>
      )}
    </div>
  );
}
