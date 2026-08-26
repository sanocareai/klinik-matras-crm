import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, Info, Clock, Flame, ArrowRight, UserCheck, Loader2, Search, ArrowUp, ArrowDown } from "lucide-react";
import dayjs from "dayjs";
import { api } from "@/api.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { formatDuration, formatRupiah, SOURCE_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { compareLabel } from "@/lib/dateRange.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";

// ═══ LAPORAN TRAFFIC LEAD ═════════════════════════════════════════════════
// Menjawab "kapan lead masuk, dan apakah kami ada di sana saat itu" — dua
// pertanyaan yang tidak terjawab tab lain. Sumber: GET /analytics/traffic.
//
// SPIKE bukan ditentukan ambang persen yang dikarang, tapi baseline statistik
// (rata-rata bergerak 7 hari sebelumnya ± 2 standar deviasi) — lihat catatan
// panjang di backend. Pita abu di grafik = rentang "normal" itu; titik yang
// keluar dari pita ditandai otomatis.

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Skala warna heatmap — intensitas via opacity SATU warna (aturan satu accent
// design system), bukan pelangi merah-kuning-hijau yang bikin heatmap terbaca
// seperti peta cuaca.
function selVolume(v, max) {
  if (!max || v === 0) return { background: "var(--bg-inset)" };
  return { background: `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 85) + 8}%, transparent)` };
}
// Respons: DI SINI warna merah dibenarkan — ini status bahaya (SLA), bukan
// sekadar besaran. Makin lama makin merah.
function selRespons(menit) {
  if (menit == null) return { background: "var(--bg-inset)" };
  const p = Math.min(menit / 240, 1); // 4 jam = merah penuh
  return { background: `color-mix(in srgb, var(--red) ${Math.round(p * 80) + 8}%, transparent)` };
}

function TrafficTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{formatTanggalPendek(label)}</p>
      <p className="text-[13px] font-semibold text-ink">{p.value} lead</p>
      {p.baseline != null && (
        <p className="t-secondary mt-0.5 text-[11px]">
          Normal: {p.lower}–{p.upper} (rata-rata {p.baseline})
        </p>
      )}
      {p.partial && <p className="mt-0.5 text-[11px] text-orange">Hari berjalan — belum lengkap</p>}
      {p.status === "spike" && <p className="mt-0.5 text-[11px] font-semibold text-green">▲ Spike +{p.deltaPct}%</p>}
      {p.status === "drop" && <p className="mt-0.5 text-[11px] font-semibold text-red">▼ Drop {p.deltaPct}%</p>}
    </div>
  );
}

// Warna per sumber — SATU warna per kanal, dipakai konsisten di bar
// proporsi & titik daftar supaya mata bisa mencocokkan keduanya tanpa
// legend terpisah.
const WARNA_SUMBER = {
  META_ADS: "var(--blue-600)",
  GOOGLE_ADS: "var(--green)",
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

export default function TrafficTab({ traffic, sourceDetail, rangeParams }) {
  const cmp = compareLabel(rangeParams);
  // Filter tanggal ikut dibawa ke halaman Pelanggan — tanpa ini, klik
  // "Google Ads" di laporan 30 hari membuka daftar SELURUH waktu, jadi
  // angka yang dilihat di laporan tidak pernah cocok dengan daftarnya.
  const qsTanggal = rangeParams?.from && rangeParams?.to
    ? `&from=${rangeParams.from}&to=${rangeParams.to}`
    : "";
  const [mode, setMode] = useState("volume"); // "volume" | "respons"
  // Tooltip heatmap dibuat sendiri, BUKAN atribut `title` bawaan browser:
  // `title` baru muncul setelah jeda ~1-2 detik, tidak bisa distyle, dan di
  // beberapa browser tidak muncul sama sekali di elemen kecil tanpa teks —
  // itu sebabnya detail kotak terasa "tidak ada".
  const [hover, setHover] = useState(null); // { cell, nama, x, y }

  const daily = traffic?.daily || [];
  const heatmap = traffic?.heatmap || [];
  const anomali = daily.filter((d) => d.status !== "normal");
  // Hari yang BENAR-BENAR dinilai (punya baseline, bukan hari berjalan) —
  // dibedakan dari "0 anomali" supaya "0 spike · 0 drop" tidak dibaca sebagai
  // "semuanya normal" padahal sebabnya periode terlalu pendek untuk baseline
  // (butuh histori 7 hari sebelum `from`, lihat catatan backend/analytics.js).
  const hariDinilai = daily.filter((d) => d.baseline != null && !d.partial).length;

  // Recharts butuh field terpisah utk menggambar pita baseline sebagai area
  // bertumpuk (lower + tinggi pita), bukan dua garis terpisah.
  const chartData = useMemo(() => daily.map((d) => ({
    ...d,
    bandBase: d.lower ?? null,
    bandSize: d.upper != null && d.lower != null ? d.upper - d.lower : null,
    spikeDot: d.status === "spike" ? d.value : null,
    dropDot:  d.status === "drop"  ? d.value : null,
  })), [daily]);

  const maxLeadSel = useMemo(() => Math.max(1, ...heatmap.map((c) => c.leads)), [heatmap]);
  const cellByKey = useMemo(() => {
    const m = {};
    for (const c of heatmap) m[`${c.dow}-${c.jam}`] = c;
    return m;
  }, [heatmap]);

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
  const [fSumber, setFSumber] = useState("");
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

  if (!traffic) {
    return <p className="t-secondary py-16 text-center">Gagal memuat laporan traffic.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── KPI ── */}
      {/* 3 kolom (bukan 4) supaya 6 kartu jadi 2 baris rapi: baris 1 = volume
          lead, baris 2 = kecepatan & kualitas. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          index={0} hero label="Total Lead Masuk"
          numericValue={traffic.totalLeads || 0}
          growth={traffic.growthPct} compareLabel={cmp}
          sub={`periode sebelumnya: ${(traffic.prevTotalLeads || 0).toLocaleString("id-ID")} lead`}
          tooltip="Jumlah pelanggan baru (Customer dibuat) di periode yang dipilih di atas, dari semua sumber."
        />
        <KpiCard
          index={1} label="Rata-rata per Hari"
          numericValue={traffic.rataRataHarian ?? 0}
          format={(v) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
          growth={traffic.rataRataGrowthPct} compareLabel={cmp}
          sub={traffic.rataRataHarianPrev != null
            ? `periode sebelumnya: ${traffic.rataRataHarianPrev.toLocaleString("id-ID", { maximumFractionDigits: 1 })} lead/hari`
            : "Belum ada periode pembanding"}
          tooltip="Hari yang sedang berjalan (belum selesai 24 jam) dikecualikan dari rata-rata, supaya angkanya tidak turun palsu tiap kali laporan dibuka siang hari."
        />
        <KpiCard
          index={2} label="Hari Tidak Normal"
          numericValue={anomali.length}
          sub={hariDinilai === 0
            ? "Belum cukup histori pembanding — pilih periode yang lebih panjang"
            : `${anomali.filter((a) => a.status === "spike").length} spike · ${anomali.filter((a) => a.status === "drop").length} drop, dari ${hariDinilai} hari yang dinilai`}
          tooltip="Dibandingkan rata-rata 7 hari SEBELUM hari itu (tidak termasuk hari itu sendiri) ± 2 standar deviasi. Di luar rentang itu → ditandai Spike (lebih ramai dari biasa) atau Drop (lebih sepi). Hari yang sedang berjalan tidak pernah dinilai — datanya belum lengkap."
        />
        <KpiCard
          index={3} label="Jam Tersibuk"
          numericValue={traffic.busiestHours?.[0]?.jam ?? 0}
          format={(v) => `${String(Math.round(v)).padStart(2, "0")}:00`}
          sub={traffic.busiestHours?.[0] ? `${traffic.busiestHours[0].leads} lead masuk di jam ini` : "—"}
          tooltip="Jam WIB (00-23) dengan jumlah lead masuk terbanyak, dijumlahkan dari seluruh hari di periode yang dipilih."
        />
        <KpiCard
          index={4} label="Respons Rata-rata"
          numericValue={traffic.avgResponseMinutes ?? 0}
          format={(v) => traffic.avgResponseMinutes != null ? formatDuration(traffic.avgResponseMinutes) : "—"}
          sub="Rata-rata waktu balas pertama, terbobot per jumlah percakapan — bukan rata-rata dari 24 angka per-jam"
          tooltip="Waktu dari pesan pertama pelanggan sampai balasan pertama sales, dihitung dalam jam operasional (09-21 WIB)."
        />
        <KpiCard
          index={5} label="Atribusi Sumber"
          numericValue={atribusi?.rate || 0}
          format={(v) => `${v.toFixed(1)}%`}
          sub={`${atribusi?.teridentifikasi || 0} dari ${atribusi?.total || 0} lead diketahui sumbernya`}
          tooltip="Persentase lead yang sumbernya (iklan/organik) berhasil diketahui sistem — bukan metrik performa, tapi kelengkapan data tracking."
        />
      </div>

      {/* Atribusi rendah = MASALAH KUALITAS DATA, bukan insight. Ditandai
          eksplisit (pola sama dgn peringatan "Kota Belum diisi" di Ringkasan)
          supaya owner tidak menyimpulkan "berarti semua lead organik".
          ⚠️ 14 Agt 2026: kalimat lama di sini bilang "deteksi otomatis iklan
          Meta terbukti tidak pernah berhasil" — itu benar SEBELUM perbaikan
          CTWA (13 Agt 2026), sekarang SALAH: Meta Ads justru sumber #1
          (95 dari 124 lead dalam 24 jam terakhir, semuanya berbukti clid
          asli). Kalimat lama dibiarkan di sini akan membuat pengguna
          mengira sistemnya masih rusak padahal sudah diperbaiki. */}
      {atribusi?.rate != null && atribusi.rate < 20 && atribusi.total > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl bg-orangebg px-3.5 py-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={16} />
          <p className="text-xs leading-relaxed text-ink">
            Hanya <strong>{atribusi.rate}%</strong> lead yang diketahui sumbernya — sisanya
            masuk sebagai "WhatsApp Langsung" karena tidak ada jejak teknis (mis. orang
            yang lihat profil IG lalu ketik nomor manual). Ini <strong>keterbatasan
            pelacakan, bukan berarti semua lead organik</strong> — satu-satunya cara
            menutupnya adalah sales mengonfirmasi manual "dari mana tahu Sano?" di
            profil pelanggan.
          </p>
        </div>
      )}

      {/* ── Antrean konfirmasi sumber ──────────────────────────────────────
          WHATSAPP_DIRECT ≠ organik — cuma berarti "tidak ada jejak teknis"
          (mis. lihat profil IG lalu ketik nomor manual). Satu-satunya cara
          menutup blind spot ini adalah sales bertanya & mengoreksi manual —
          widget ini jadi pengingat berapa banyak yang masih menunggu. */}
      {atribusi?.belumDikonfirmasi > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-inset px-4 py-3">
          <UserCheck className="shrink-0 text-accent" size={18} />
          <p className="flex-1 text-xs leading-relaxed text-ink2">
            <strong className="text-ink">{atribusi.belumDikonfirmasi} lead WhatsApp Langsung</strong>{" "}
            pada periode ini belum pernah dikonfirmasi sumbernya oleh sales — kemungkinan
            ada yang sebenarnya dari Instagram/referral tapi masuk sebagai "tidak diketahui".
          </p>
          <Link
            to={`/customers?source=WHATSAPP_DIRECT&confirmed=false`}
            className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent hover:underline"
          >
            Lihat daftarnya <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* ── Tren harian + baseline + spike ── */}
      <ChartCard
        index={4}
        title="Traffic Lead Harian"
        description="Pita abu = rentang normal (rata-rata 7 hari sebelumnya ± 2 standar deviasi). Titik di luar pita ditandai otomatis."
        empty={daily.length === 0 ? "Belum ada data lead pada periode ini." : null}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket" tickFormatter={(v) => dayjs(v).format("D MMM")}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} dy={6}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={36} allowDecimals={false}
            />
            <Tooltip content={<TrafficTip />} cursor={{ stroke: "var(--hairline)" }} />
            {/* Pita normal: area transparan (offset) + area terlihat setinggi pita */}
            <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="bandSize" stackId="band" stroke="none" fill="var(--text-tertiary)" fillOpacity={0.13} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke="var(--blue-600)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            <Scatter dataKey="spikeDot" fill="var(--green)" shape="circle" />
            <Scatter dataKey="dropDot"  fill="var(--red)"   shape="circle" />
          </ComposedChart>
        </ResponsiveContainer>

        {anomali.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            {anomali.slice(-6).reverse().map((a) => (
              <div key={a.bucket} className="flex items-center gap-2 text-[12px]">
                {a.status === "spike"
                  ? <TrendingUp size={13} className="shrink-0 text-green" />
                  : <TrendingDown size={13} className="shrink-0 text-red" />}
                <span className="font-medium text-ink">{formatTanggalPendek(a.bucket)}</span>
                <span className={cn("font-semibold tabular-nums", a.status === "spike" ? "text-green" : "text-red")}>
                  {a.value} lead ({a.deltaPct > 0 ? "+" : ""}{a.deltaPct}%)
                </span>
                <span className="t-secondary text-[11px]">vs normal ±{a.baseline}</span>
              </div>
            ))}
          </div>
        )}
      </ChartCard>

      {/* ── Heatmap jam × hari ── */}
      <ChartCard
        index={5}
        title="Peta Traffic: Hari × Jam (WIB)"
        description={mode === "volume"
          ? "Kapan lead paling banyak masuk"
          : "Berapa lama customer menunggu dibalas, menurut jam dia chat"}
      >
        <div className="mb-3 flex gap-1 rounded-btn bg-inset p-1" style={{ width: "fit-content" }}>
          {[["volume", "Volume Lead"], ["respons", "Waktu Respons"]].map(([k, label]) => (
            <button
              key={k} onClick={() => setMode(k)}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[12px] font-medium transition-colors",
                mode === k ? "bg-surface text-ink shadow-card" : "text-ink2 hover:text-ink"
              )}
            >{label}</button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div style={{ minWidth: 640 }}>
            {/* Label jam tiap 3 kolom biar tidak berdesakan */}
            <div className="flex gap-[2px] pl-9">
              {Array.from({ length: 24 }, (_, j) => (
                <div key={j} className="flex-1 text-center text-[9px] text-ink3">
                  {j % 3 === 0 ? String(j).padStart(2, "0") : ""}
                </div>
              ))}
            </div>
            {HARI.map((nama, dow) => (
              <div key={dow} className="mt-[2px] flex items-center gap-[2px]">
                <div className="w-9 shrink-0 text-[10px] font-medium text-ink2">{nama}</div>
                {Array.from({ length: 24 }, (_, jam) => {
                  const c = cellByKey[`${dow}-${jam}`] || { dow, jam, leads: 0, responded: 0, avgMinutes: null, slaBreach: 0 };
                  const style = mode === "volume" ? selVolume(c.leads, maxLeadSel) : selRespons(c.avgMinutes);
                  return (
                    <div
                      key={jam} style={style}
                      className="h-6 flex-1 cursor-help rounded-[3px] transition-[outline] hover:outline hover:outline-2 hover:outline-ink"
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({ cell: c, nama, x: r.left + r.width / 2, y: r.top });
                      }}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* BUG YANG DIPERBAIKI: tooltip dulu dirender di dalam ChartCard dan
            tertutup card di bawahnya. Penyebabnya BUKAN z-index kurang tinggi —
            ChartCard memakai animasi `fade-rise` yang meninggalkan
            `transform: translateY(0)` (fill-mode `both`). Transform non-none
            membuat elemen jadi CONTAINING BLOCK untuk position:fixed SEKALIGUS
            stacking context baru, jadi tooltip terkurung di dalam card itu dan
            z-50-nya cuma bersaing DI DALAM card — card berikutnya tetap menang.
            Portal ke document.body melepasnya dari semua stacking context
            ancestor, sekalian membuat koordinat fixed-nya benar-benar relatif
            viewport (sesuai getBoundingClientRect). */}
        {hover && createPortal(
          <div
            className="pointer-events-none fixed z-[1200] rounded-btn bg-surface px-3 py-2 shadow-popover"
            style={
              // Dibalik ke BAWAH kotak kalau ruang di atas tidak cukup —
              // baris "Min" di layar pendek tooltipnya akan kepotong tepi atas.
              hover.y < 150
                ? { left: hover.x, top: hover.y + 30, transform: "translateX(-50%)" }
                : { left: hover.x, top: hover.y - 8, transform: "translate(-50%, -100%)" }
            }
          >
            <p className="t-caption mb-1">
              {hover.nama}, {String(hover.cell.jam).padStart(2, "0")}:00–{String(hover.cell.jam).padStart(2, "0")}:59 WIB
            </p>
            <p className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-ink">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {hover.cell.leads} lead masuk
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink2">
              <span className="h-2 w-2 rounded-full bg-red" />
              {hover.cell.avgMinutes != null
                ? <>Respons {formatDuration(hover.cell.avgMinutes)}</>
                : <>Belum ada data respons</>}
            </p>
            {hover.cell.slaBreach > 0 && (
              <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-red">
                {hover.cell.slaBreach}× lewat SLA 60 menit
              </p>
            )}
            {hover.cell.responded > 0 && (
              <p className="t-secondary mt-0.5 whitespace-nowrap text-[10.5px]">
                dari {hover.cell.responded} percakapan yang dibalas
              </p>
            )}
          </div>,
          document.body
        )}

        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          Arahkan kursor ke kotak untuk detail. Bandingkan dua mode: kotak
          <strong> gelap</strong> di Volume tapi <strong>merah</strong> di Waktu Respons =
          jam ramai yang tidak terjaga — itu kebocoran lead paling mahal.
        </p>
      </ChartCard>

      {/* ── Jam sibuk & jam rawan ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={6} title="Jam Tersibuk" description="Paling banyak lead masuk">
          <div className="flex flex-col gap-2.5">
            {(traffic.busiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Flame size={15} className="shrink-0 text-accent" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] text-ink2">{h.leads} lead masuk</span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.avgMinutes != null ? formatDuration(h.avgMinutes) : "—"}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard
          index={7} title="Jam Paling Rawan"
          description="Respons terlama — hanya jam yang volumenya signifikan"
          empty={(traffic.riskiestHours || []).length === 0 ? "Belum cukup data respons." : null}
        >
          <div className="flex flex-col gap-2.5">
            {(traffic.riskiestHours || []).map((h) => (
              <div key={h.jam} className="flex items-center gap-3">
                <Clock size={15} className="shrink-0 text-red" />
                <span className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {String(h.jam).padStart(2, "0")}:00
                </span>
                <span className="flex-1 text-[12.5px] font-semibold text-red">
                  {formatDuration(h.avgMinutes)}
                </span>
                <span className="t-secondary text-[11.5px] tabular-nums">
                  {h.leads} lead · {h.slaBreach}× lewat SLA
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Jam sepi dengan 1-2 chat telat sengaja TIDAK masuk daftar ini —
              yang ditampilkan hanya jam yang volumenya cukup untuk jadi masalah nyata.
            </span>
          </p>
        </ChartCard>
      </div>

      {/* ── Sumber lead ── */}
      {(atribusi?.bySource || []).length > 0 && (
        <ChartCard
          index={8}
          title="Sumber Lead"
          description="Klik sumber untuk membuka daftar kontaknya (filter tanggal ikut terbawa)"
        >
          {/* Bar proporsi — satu batang utuh, tiap kanal satu segmen.
              Lebih cepat dibaca daripada deretan angka: mana yang dominan
              langsung kelihatan tanpa membandingkan digit satu per satu. */}
          <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-inset">
            {[...atribusi.bySource].sort((a, b) => b.count - a.count).map((s) => (
              <div
                key={s.source}
                style={{
                  width: `${(s.count / (atribusi.total || 1)) * 100}%`,
                  background: WARNA_SUMBER[s.source] || "var(--text-tertiary)",
                }}
                title={`${SOURCE_LABELS[s.source] || s.source}: ${s.count}`}
              />
            ))}
          </div>

          <div className="flex flex-col gap-0.5">
            {[...atribusi.bySource].sort((a, b) => b.count - a.count).map((s) => {
              const persen = (s.count / (atribusi.total || 1)) * 100;
              return (
                <Link
                  key={s.source}
                  to={`/customers?source=${encodeURIComponent(s.source)}${qsTanggal}`}
                  className="group flex items-center gap-2.5 rounded-btn px-2 py-2 transition-colors hover:bg-inset"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: WARNA_SUMBER[s.source] || "var(--text-tertiary)" }}
                  />
                  <span className="flex-1 text-[12.5px] text-ink2 group-hover:text-ink">
                    {SOURCE_LABELS[s.source] || s.source}
                  </span>
                  <span className="w-11 text-right text-[12px] tabular-nums text-ink3">
                    {persen.toFixed(1)}%
                  </span>
                  <span className="w-14 text-right text-[13px] font-semibold tabular-nums text-ink">
                    {s.count.toLocaleString("id-ID")}
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-ink3 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
        </ChartCard>
      )}

      {/* ── Rincian per iklan spesifik ──────────────────────────────────────
          Beda dari "Sumber Lead" di atas: itu per PLATFORM (Meta Ads: 95),
          ini per IKLAN/KREATIF (fb.me/77pJdJNsy: 40, instagram.com/p/DXWbO:
          30, dst) — dari Customer.leadSourceDetail apa adanya, tidak
          dinormalisasi/ditebak lebih lanjut. */}
      {(sourceDetail?.data || []).length > 0 && (
        <ChartCard
          index={9}
          title="Rincian per Iklan"
          description="Kreatif/link spesifik mana yang benar-benar menghasilkan, bukan cuma platformnya"
          actions={
            <div className="flex items-center gap-1.5">
              {loadingFilter && <Loader2 size={13} className="animate-spin text-ink3" />}
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  type="search" value={fCari} onChange={(e) => setFCari(e.target.value)}
                  placeholder="Cari detail…"
                  aria-label="Cari kreatif/link di Rincian per Iklan"
                  className="h-7 w-32 rounded-btn border-0 bg-inset pl-6 pr-2 text-[12px] text-ink2 placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
              <select
                value={fSumber}
                onChange={(e) => setFSumber(e.target.value)}
                aria-label="Filter sumber di Rincian per Iklan"
                className="h-7 rounded-btn border-0 bg-inset px-2 text-[12px] font-medium text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <option value="">Semua Sumber</option>
                {opsiSumber.map((s) => (
                  <option key={s.source} value={s.source}>
                    {SOURCE_LABELS[s.source] || s.source} ({s.count})
                  </option>
                ))}
              </select>
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
              termasuk yang baru closing belakangan. Beda dengan Dashboard yang menghitung
              <strong> order yang dibuat pada periode ini</strong> (bisa dari lead lama).
              Dua-duanya benar — untuk menilai iklan, yang dipakai adalah basis "kapan leadnya masuk".
              {/* Jembatan angka — supaya "kenapa beda dengan Ringkasan?" tidak
                  perlu ditanyakan berulang tiap ganti rentang tanggal. */}
              {!fSumber && !debouncedCari && sourceDetail.leadLama?.order > 0 && (
                <>
                  {" "}<strong>+ {formatRupiah(sourceDetail.leadLama.totalValue)}</strong> dari{" "}
                  <strong>{sourceDetail.leadLama.order} order lead lama</strong> yang baru closing
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
                    <SortableLabel label="Closing" sortKey="won" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Konversi" sortKey="convRate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Konversi = (lead dari sumber ini yang closing/order) ÷ (total Lead dari sumber ini) × 100%. Beda dari Laporan Sales: di sini SPAM TIDAK dikecualikan dari penyebutnya (sengaja, supaya sumber bertargeting buruk tidak tersembunyi)." />
                    </span>
                  </th>
                  <th className="pb-2 pr-3 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1">
                      <SortableLabel label="Rata2 Order" sortKey="avgOrderValue" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      <InfoTooltip text="Rata2 Order (AOV sumber ini) = total Nilai Order ÷ jumlah Closing dari sumber ini — rata-rata besar 1 order yang closing." />
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
