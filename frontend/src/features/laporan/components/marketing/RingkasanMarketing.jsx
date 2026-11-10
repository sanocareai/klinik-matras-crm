import React, { useState } from "react";
import { Layers, Loader2, ShoppingCart, UserCheck, Users, Wallet } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { formatDuration } from "@/utils/format.js";
import { angka, formatPersen, rupiah } from "../../akuisisiLogic.js";
import { kartuRingkas, kualitasData } from "../../marketingLogic.js";
import { rupiahRingkas } from "../../kanalPakem.js";
import TrenLeadChart from "./TrenLeadChart.jsx";
import KelengkapanData from "./KelengkapanData.jsx";
import TabelSumber from "./TabelSumber.jsx";
import Disclosure from "./Disclosure.jsx";
import PolaLeadRespons from "./PolaLeadRespons.jsx";
import KualitasDataPanel, { ringkasKualitas } from "./KualitasDataPanel.jsx";
import StripStatus from "./StripStatus.jsx";

// Ringkasan semua sumber (redesain Apple, 10 Nov 2026): strip status → 4 KPI → [Tren lead | Kelengkapan data] → Performa sumber → (dapat dibuka) pola lead & respons, kualitas data.
// Penyajian saja: angka dari kartuRingkas/kualitasData/lap seperti sebelumnya. Customer lunas, biaya total, dan cakupan pembayaran tidak lagi jadi kartu sendiri:
// lunas & biaya ada di tabel (pilihan kolom, baris total), cakupan pembayaran di kartu Uang diterima dan panel Kelengkapan data.
function ringkasPola(traffic) {
  if (!traffic) return "Belum dimuat";
  const jam = traffic.busiestHours?.[0];
  const anomali = (traffic.daily || []).filter((d) => d.status !== "normal").length;
  return [jam ? `jam tersibuk ${String(jam.jam).padStart(2, "0")}:00` : null, traffic.avgResponseMinutes != null ? `respons rata-rata ${formatDuration(traffic.avgResponseMinutes)}` : "respons belum ada data", `${anomali} hari tidak normal`].filter(Boolean).join(" · ");
}

const IKON = { lead: Users, leadTanpaSpam: UserCheck, berOrder: ShoppingCart, nilai: Layers, uang: Wallet };
const NADA = { lead: "biru", leadTanpaSpam: "langit", berOrder: "periwinkle", nilai: "lavender", uang: "lime" };

function KartuKpi({ id, label, nilai, judulPenuh, sub, tip }) {
  const Ikon = IKON[id];
  return (
    <div className="mk-kpi" data-nada={NADA[id]} data-testid={`kartu-${id}`}>
      <span className="mk-kpi-ikon" aria-hidden="true"><Ikon size={22} strokeWidth={1.9} /></span>
      <div className="mk-kpi-isi">
        <span className="mk-kpi-label">{label}{tip && <InfoTooltip text={tip} />}</span>
        <span className="mk-kpi-nilai" title={judulPenuh}>{nilai}</span>
        {sub && <span className="mk-kpi-sub">{sub}</span>}
      </div>
    </div>
  );
}

export default function RingkasanMarketing({ lap, iklan, iklanGalat, traffic, memuatTraffic, periode, hariIni, onUbahRentang, rangeParams, url, onUbah, onBuka, onLihatChat }) {
  const k = Object.fromEntries(kartuRingkas(lap).map((c) => [c.id, c]));
  const l = lap?.status?.ledger;
  const t = lap?.total || {};
  const butir = kualitasData({ lap, iklan, traffic, periode });
  const [bukaKualitas, setBukaKualitas] = useState(false);
  const keRincian = () => {
    setBukaKualitas(true);
    setTimeout(() => document.getElementById("bagian-kualitas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const cakupan = l && l.orderEligible > 0 ? `cakupan pembayaran ${formatPersen(l.persen)}` : null;

  const kpi = [
    k.lead && { id: "lead", label: "Total lead", nilai: k.lead.nilai, sub: `termasuk ${angka(t.spam)} spam`, tip: k.lead.tip },
    // Sama dengan "New Leads" di Dashboard Sales CRM (permintaan 10 Nov 2026: dua angka lead dulu tampak tidak cocok).
    k.leadTanpaSpam && { id: "leadTanpaSpam", label: "Lead tanpa spam", nilai: k.leadTanpaSpam.nilai, sub: `${k.leadTanpaSpam.sub} · sama dengan New Leads Dashboard`, tip: k.leadTanpaSpam.tip },
    k.berOrder && { id: "berOrder", label: "Customer ber-order", nilai: k.berOrder.nilai, sub: k.berOrder.sub === "—" ? "dari kohort lead periode ini" : k.berOrder.sub, tip: k.berOrder.tip },
    k.nilai && { id: "nilai", label: "Nilai order", nilai: rupiahRingkas(t.nilaiOrderSaatIni), judulPenuh: rupiah(t.nilaiOrderSaatIni), sub: "kohort lead · bukan uang diterima", tip: k.nilai.tip },
    k.uang && { id: "uang", label: "Uang diterima bersih", nilai: rupiahRingkas(t.uangBersih), judulPenuh: rupiah(t.uangBersih), sub: ["ledger − refund", cakupan].filter(Boolean).join(" · "), tip: k.uang.tip },
  ].filter(Boolean);

  return (
    <div className="mk-isi" data-testid="ringkasan-marketing">
      <StripStatus lap={lap} periode={periode} hariIni={hariIni} onUbahRentang={onUbahRentang} onKualitas={keRincian} />
      {lap.total.lead === 0 && <p className="mk-panel mk-catatan-kosong" data-testid="kosong-lead">Belum ada lead pada periode ini. Sumber tanpa hasil tetap ditampilkan di tabel; kosong berbeda dari nol yang terukur.</p>}

      <section className="mk-kpi-grid" data-testid="kartu-ringkas" aria-label="Angka utama">
        {kpi.map((c) => <KartuKpi key={c.id} {...c} />)}
      </section>

      <div className="mk-baris-tren">
        {traffic ? <TrenLeadChart traffic={traffic} />
          : <section className="mk-panel"><p className="mk-redup flex items-center gap-2" data-testid="tren-tidak-ada">{memuatTraffic ? <><Loader2 size={15} className="animate-spin" /> Memuat tren lead…</> : "Tren lead harian tidak dapat dimuat. Angka lain di halaman ini tetap berlaku."}</p></section>}
        <KelengkapanData lap={lap} periode={periode} onRincian={keRincian} />
      </div>

      <TabelSumber lap={lap} urutId={url.urut} kolomMode={url.kolom} bandingkan={url.banding} onUbah={onUbah} onBuka={onBuka} periodeOk={periode.ok} onLihatChat={onLihatChat} />

      <Disclosure id="pola" judul="Pola lead & respons" ringkas={ringkasPola(traffic)}>
        {traffic ? <PolaLeadRespons traffic={traffic} rangeParams={rangeParams} /> : <p className="mk-redup">Data traffic belum tersedia.</p>}
      </Disclosure>

      <Disclosure id="kualitas" buka={bukaKualitas} onToggle={setBukaKualitas} judul="Kualitas data" ringkas={iklan || iklanGalat ? ringkasKualitas(butir) : `${ringkasKualitas(butir)} · laporan Meta dimuat…`}>
        <KualitasDataPanel lap={lap} iklan={iklan} traffic={traffic} periode={periode} iklanGalat={iklanGalat} />
      </Disclosure>
    </div>
  );
}
