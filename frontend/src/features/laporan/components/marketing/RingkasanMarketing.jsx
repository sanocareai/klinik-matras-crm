import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { formatDuration } from "@/utils/format.js";
import { bannerUtama } from "../../akuisisiLogic.js";
import { kartuRingkas, kualitasData } from "../../marketingLogic.js";
import KartuAngka from "./KartuAngka.jsx";
import TrenLeadChart from "./TrenLeadChart.jsx";
import TabelSumber from "./TabelSumber.jsx";
import Disclosure from "./Disclosure.jsx";
import PolaLeadRespons from "./PolaLeadRespons.jsx";
import KualitasDataPanel, { ringkasKualitas } from "./KualitasDataPanel.jsx";

// Ringkasan semua sumber: kartu → tren → peringkat sumber → (dapat dibuka) pola lead & respons → (dapat dibuka) kualitas data.
function ringkasPola(traffic) {
  if (!traffic) return "Belum dimuat";
  const jam = traffic.busiestHours?.[0];
  const anomali = (traffic.daily || []).filter((d) => d.status !== "normal").length;
  return [jam ? `jam tersibuk ${String(jam.jam).padStart(2, "0")}:00` : null, traffic.avgResponseMinutes != null ? `respons rata-rata ${formatDuration(traffic.avgResponseMinutes)}` : "respons belum ada data", `${anomali} hari tidak normal`].filter(Boolean).join(" · ");
}

export default function RingkasanMarketing({ lap, iklan, iklanGalat, traffic, memuatTraffic, periode, rangeParams, url, onUbah, onBuka, onEkspor }) {
  const kartu = kartuRingkas(lap);
  const banner = bannerUtama(lap);
  const butir = kualitasData({ lap, iklan, traffic, periode });
  return (
    <div className="flex flex-col gap-4" data-testid="ringkasan-marketing">
      {banner && !periode.termasukHariBerjalan && <div role="status" className="flex items-center gap-2 rounded-card bg-orangebg px-3 py-2 text-[12.5px] font-medium text-orange"><AlertTriangle size={15} className="shrink-0" /> {banner}</div>}
      {lap.total.lead === 0 && <Card className="!p-4"><p className="text-[13px] text-ink2" data-testid="kosong-lead">Belum ada lead pada periode ini. Sumber tanpa hasil tetap ditampilkan di tabel; kosong berbeda dari nol yang terukur.</p></Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="kartu-ringkas">
        {kartu.map((k) => <KartuAngka key={k.id} {...k} />)}
      </div>

      {traffic ? <TrenLeadChart traffic={traffic} />
        : <Card className="!p-4"><p className="flex items-center gap-2 text-[13px] text-ink3" data-testid="tren-tidak-ada">{memuatTraffic ? <><Loader2 size={15} className="animate-spin" /> Memuat tren lead…</> : "Tren lead harian tidak dapat dimuat. Angka lain di halaman ini tetap berlaku."}</p></Card>}

      <TabelSumber lap={lap} urutId={url.urut} kolomMode={url.kolom} bandingkan={url.banding} onUbah={onUbah} onBuka={onBuka} onEkspor={onEkspor} periodeOk={periode.ok} />

      <Disclosure id="pola" judul="Pola lead & respons" ringkas={ringkasPola(traffic)}>
        {traffic ? <PolaLeadRespons traffic={traffic} rangeParams={rangeParams} /> : <p className="text-[13px] text-ink3">Data traffic belum tersedia.</p>}
      </Disclosure>

      <Disclosure id="kualitas" judul="Kualitas data" ringkas={iklan || iklanGalat ? ringkasKualitas(butir) : `${ringkasKualitas(butir)} · laporan Meta dimuat…`}>
        <KualitasDataPanel lap={lap} iklan={iklan} traffic={traffic} periode={periode} iklanGalat={iklanGalat} />
      </Disclosure>
    </div>
  );
}
