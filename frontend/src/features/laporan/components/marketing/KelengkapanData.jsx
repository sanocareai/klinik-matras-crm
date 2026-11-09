import React from "react";
import { ArrowRight, Clock3, CreditCard, Receipt } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { formatPersen, angka, statusMembayar, ringkasBiayaBerbayar, selTotalBerbayar, statusBiayaTeks } from "../../akuisisiLogic.js";
import { namaMerek } from "../LogoSumber.jsx";

// Panel "Kelengkapan data" (redesain Apple, 10 Nov 2026): ringkas, satu baris per hal. Nilai dari objek server yang SAMA dengan kartu dan tabel — tidak ada ambang baru.
// Data tidak lengkap ≠ nol: yang kosong ditulis kosong. Rincian penuh tetap di bagian Kualitas data.
const TIP = {
  biaya: "Biaya iklan per sumber berbayar pada periode yang sama. “Tercatat” = lengkap setiap hari (terisi ≠ diverifikasi independen). Belum lengkap → CPA/ROAS sumber itu kosong, bukan Rp0.",
  ledger: "Persentase order eligible yang punya pembayaran di ledger. Pembayaran di luar sistem belum terlihat, jadi customer membayar/lunas dan uang diterima adalah batas bawah.",
  hari: "Rentang memuat hari berjalan: lead dan pembayaran masih bertambah dan biaya hari ini belum final, jadi CPA/ROAS sengaja dikosongkan.",
};

function Baris({ Ikon, judul, chip, nada = "ok", tip, sub, testid }) {
  return (
    <li className="mk-kel-baris" data-testid={testid}>
      <span className="mk-kel-ikon" aria-hidden="true"><Ikon size={16} /></span>
      <span className="mk-kel-judul">{judul}{tip && <InfoTooltip text={tip} />}{sub && <span className="mk-kel-sub">{sub}</span>}</span>
      <span className="mk-chip" data-nada={nada}>{chip}</span>
    </li>
  );
}

export default function KelengkapanData({ lap, periode, onRincian }) {
  const l = lap?.status?.ledger;
  const bayar = statusMembayar(lap);
  const rb = ringkasBiayaBerbayar(lap);
  const cpa = selTotalBerbayar(lap?.total?.berbayar, "cpa");
  const belumId = new Set((rb?.belum || []).map((x) => x.id));
  const semua = lap?.total?.berbayar?.sumber || [];
  const lengkap = semua.filter((id) => !belumId.has(id));
  const persen = l && l.orderEligible > 0 ? Math.max(0, Math.min(Number(l.persen) || 0, 100)) : null;
  const statusBelum = [...new Set((rb?.belum || []).map((x) => statusBiayaTeks(x.status)))].join(", ");
  return (
    <section className="mk-panel mk-kel" data-testid="kelengkapan-data">
      <h3 className="mk-panel-judul">Kelengkapan data</h3>
      <ul className="mk-kel-daftar">
        {lengkap.length > 0 && <Baris testid="kel-biaya" Ikon={Receipt} judul={`Biaya ${lengkap.map(namaMerek).join(" & ")}`} chip="Tercatat" tip={TIP.biaya} />}
        {belumId.size > 0 && <Baris testid="kel-biaya-belum" Ikon={Receipt} judul={`Biaya ${[...belumId].map(namaMerek).join(" & ")}`} sub={statusBelum} chip="Belum lengkap" nada="peringatan" tip={TIP.biaya} />}
        {l && (
          <li className="mk-kel-baris" data-testid="kel-ledger">
            <span className="mk-kel-ikon" aria-hidden="true"><CreditCard size={16} /></span>
            <span className="mk-kel-judul">Pembayaran tercatat<InfoTooltip text={TIP.ledger} />
              <span className="mk-kel-bar" role="img" aria-label={persen == null ? "Cakupan ledger belum ada data" : `Cakupan ledger ${formatPersen(l.persen)}`}>
                {persen != null && <span style={{ width: `${persen}%` }} data-lengkap={bayar.lengkap ? "1" : "0"} />}
              </span>
            </span>
            <span className="mk-chip" data-nada={bayar.lengkap ? "ok" : "peringatan"} title={persen == null ? undefined : `Cakupan ${formatPersen(l.persen)}`}>{angka(l.orderBerLedger)} dari {angka(l.orderEligible)} order</span>
          </li>
        )}
        {periode?.termasukHariBerjalan && <Baris testid="kel-hari" Ikon={Clock3} judul="Hari berjalan" chip="Termasuk" nada="peringatan" tip={TIP.hari} />}
      </ul>
      {cpa.kosong && <p className="mk-kel-catatan" data-testid="kel-cpa">CPA dan ROAS total belum ditampilkan{cpa.alasan ? ` — ${cpa.alasan}` : ""}. Kosong bukan nol.</p>}
      <button type="button" className="mk-tautan mk-kel-rincian" onClick={onRincian} data-testid="kel-rincian">Rincian kualitas data <ArrowRight size={14} aria-hidden="true" /></button>
    </section>
  );
}
