import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { formatDuration } from "@/utils/format.js";
import { bannerUtama, statusMembayar, formatPersen } from "../../akuisisiLogic.js";
import { kartuRingkas, kualitasData } from "../../marketingLogic.js";
import KpiLap from "../KpiLap.jsx";
import MetrikRingkas from "../MetrikRingkas.jsx";
import AlertRingkas from "../AlertRingkas.jsx";
import TrenLeadChart from "./TrenLeadChart.jsx";
import KelengkapanData from "./KelengkapanData.jsx";
import TabelSumber from "./TabelSumber.jsx";
import Disclosure from "./Disclosure.jsx";
import PolaLeadRespons from "./PolaLeadRespons.jsx";
import KualitasDataPanel, { ringkasKualitas } from "./KualitasDataPanel.jsx";

// Ringkasan semua sumber (redesain Sales CRM 1 Nov 2026, komposisi mockup): peringatan ringkas → 4 KPI utama → metrik pendukung → [Tren lead | Kelengkapan Data] → Performa Sumber
// → (dapat dibuka) pola lead & respons → (dapat dibuka) kualitas data. Penyajian saja: semua angka dari kartuRingkas/kualitasData/lap seperti sebelumnya.
function ringkasPola(traffic) {
  if (!traffic) return "Belum dimuat";
  const jam = traffic.busiestHours?.[0];
  const anomali = (traffic.daily || []).filter((d) => d.status !== "normal").length;
  return [jam ? `jam tersibuk ${String(jam.jam).padStart(2, "0")}:00` : null, traffic.avgResponseMinutes != null ? `respons rata-rata ${formatDuration(traffic.avgResponseMinutes)}` : "respons belum ada data", `${anomali} hari tidak normal`].filter(Boolean).join(" · ");
}

// KPI utama (urutan & warna mengikuti mockup) dan metrik pendukung — dipilih dari kartuRingkas() berdasarkan id, jadi label/tooltip/catatan TIDAK ditulis ulang di sini.
const KPI_UTAMA = [{ id: "lead", tone: "revenue", ikon: "orang" }, { id: "berOrder", tone: "leads", ikon: "alur" }, { id: "nilai", tone: "orders", ikon: "tas" }, { id: "uang", tone: "conversion", ikon: "dompet" }];

export default function RingkasanMarketing({ lap, iklan, iklanGalat, traffic, memuatTraffic, periode, rangeParams, url, onUbah, onBuka, onEkspor }) {
  const kartu = kartuRingkas(lap);
  const k = Object.fromEntries(kartu.map((c) => [c.id, c]));
  const banner = bannerUtama(lap);
  const bayar = statusMembayar(lap);
  const l = lap?.status?.ledger;
  const butir = kualitasData({ lap, iklan, traffic, periode });
  const [bukaKualitas, setBukaKualitas] = useState(false);
  const keRincian = () => {
    setBukaKualitas(true);
    setTimeout(() => document.getElementById("bagian-kualitas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const pendukung = [
    k.lunas && { testid: "kartu-lunas", label: k.lunas.judul, value: k.lunas.nilai, kosong: k.lunas.kosong, sub: k.lunas.sub.toLowerCase() === k.lunas.judul.toLowerCase() ? null : k.lunas.sub, catatan: k.lunas.catatan, tooltip: k.lunas.tip, ikon: "centang", tone: "green" },
    k.biaya && { testid: "kartu-biaya", label: k.biaya.judul, value: k.biaya.nilai, kosong: k.biaya.kosong, sub: k.biaya.sub, tooltip: k.biaya.tip, ikon: "dompet", tone: "orange" },
    l && l.orderEligible > 0 && { testid: "kartu-cakupan", label: "Cakupan pembayaran di ledger", value: formatPersen(l.persen), kosong: false, sub: `${l.orderBerLedger} dari ${l.orderEligible} order eligible`, tooltip: "Persentase order eligible yang punya pembayaran di ledger. Pembayaran di luar sistem belum terlihat, jadi angka customer membayar/lunas dan uang diterima adalah batas bawah.", ikon: "diagram", tone: "indigo" },
  ].filter(Boolean);

  return (
    <div className="crm-lap-tab-isi" data-testid="ringkasan-marketing">
      {(banner && !periode.termasukHariBerjalan) || !bayar.lengkap ? (
        <div className="crm-lap-alerts">
          {banner && !periode.termasukHariBerjalan && <AlertRingkas tone="oranye" testid="alert-biaya" judul="Biaya iklan belum lengkap" ringkas={banner} aksi={{ teks: "Lihat rincian", onClick: keRincian }} />}
          {!bayar.lengkap && <AlertRingkas tone="oranye" testid="alert-pembayaran" judul="Data pembayaran belum lengkap" ringkas={bayar.teks} aksi={{ teks: "Lihat rincian", onClick: keRincian }} />}
        </div>
      ) : null}
      {lap.total.lead === 0 && <Card className="!p-4"><p className="text-[13px] text-ink2" data-testid="kosong-lead">Belum ada lead pada periode ini. Sumber tanpa hasil tetap ditampilkan di tabel; kosong berbeda dari nol yang terukur.</p></Card>}

      <section className="crm-kpi-grid" data-testid="kartu-ringkas">
        {KPI_UTAMA.filter((u) => k[u.id]).map((u) => {
          const c = k[u.id];
          return <KpiLap key={u.id} testid={`kartu-${u.id}`} tone={u.tone} ikon={u.ikon} label={c.judul} value={c.nilai} sub={c.sub} tooltip={c.tip} />;
        })}
      </section>
      {pendukung.length > 0 && <MetrikRingkas items={pendukung} />}

      <div className="crm-lap-baris crm-lap-baris--tren">
        {traffic ? <TrenLeadChart traffic={traffic} />
          : <Card className="!p-4"><p className="flex items-center gap-2 text-[13px] text-ink3" data-testid="tren-tidak-ada">{memuatTraffic ? <><Loader2 size={15} className="animate-spin" /> Memuat tren lead…</> : "Tren lead harian tidak dapat dimuat. Angka lain di halaman ini tetap berlaku."}</p></Card>}
        <KelengkapanData lap={lap} periode={periode} onRincian={keRincian} />
      </div>

      <TabelSumber lap={lap} urutId={url.urut} kolomMode={url.kolom} bandingkan={url.banding} onUbah={onUbah} onBuka={onBuka} onEkspor={onEkspor} periodeOk={periode.ok} />

      <Disclosure id="pola" judul="Pola lead & respons" ringkas={ringkasPola(traffic)}>
        {traffic ? <PolaLeadRespons traffic={traffic} rangeParams={rangeParams} /> : <p className="text-[13px] text-ink3">Data traffic belum tersedia.</p>}
      </Disclosure>

      <Disclosure id="kualitas" buka={bukaKualitas} onToggle={setBukaKualitas} judul="Kualitas data" ringkas={iklan || iklanGalat ? ringkasKualitas(butir) : `${ringkasKualitas(butir)} · laporan Meta dimuat…`}>
        <KualitasDataPanel lap={lap} iklan={iklan} traffic={traffic} periode={periode} iklanGalat={iklanGalat} />
      </Disclosure>
    </div>
  );
}
