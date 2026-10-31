import React from "react";
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { formatPersen, angka, statusMembayar, ringkasBiayaBerbayar, selTotalBerbayar, statusBiayaTeks } from "../../akuisisiLogic.js";

// Panel "Kelengkapan Data": RINGKASAN keterbatasan data yang memang tersedia — pembayaran/ledger, biaya iklan, hari berjalan — dan akses ke rincian lengkap (bagian Kualitas data).
// Semua nilai dari objek server yang SAMA dengan kartu & tabel (tidak ada perhitungan/ambang baru). Syarat tampil CPA/ROAS tidak diubah di sini: panel hanya MELAPORKAN bahwa CPA/ROAS kosong
// (selTotalBerbayar → kosong) beserta alasannya. Data tidak lengkap ≠ nol: yang kosong ditulis sebagai kosong.
const TIP = {
  ledger: "Persentase order eligible yang punya pembayaran di ledger. Pembayaran di luar sistem belum terlihat, jadi angka customer membayar/lunas dan uang diterima adalah batas bawah.",
  biaya: "Biaya iklan terisi hanya bila SEMUA sumber berbayar lengkap setiap hari. Terisi ≠ diverifikasi independen. Kosong ≠ Rp0.",
  hari: "Rentang yang memuat hari berjalan: lead dan pembayaran masih bertambah dan biaya hari ini belum final, jadi biaya per hasil (CPA/ROAS) sengaja dikosongkan.",
};

function Baris({ ok, judul, nilai, teks, tip, testid }) {
  const Ikon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="crm-mk-kel-baris" data-ok={ok ? "1" : "0"} data-testid={testid}>
      <Ikon size={16} className="crm-mk-kel-ikon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="crm-mk-kel-judul"><b>{judul}</b> <span className="crm-mk-kel-nilai">{nilai}</span>{tip && <InfoTooltip text={tip} />}</p>
        {teks && <p className="crm-mk-kel-teks">{teks}</p>}
      </div>
    </li>
  );
}

export default function KelengkapanData({ lap, periode, onRincian }) {
  const l = lap?.status?.ledger;
  const bayar = statusMembayar(lap);
  const rb = ringkasBiayaBerbayar(lap);
  const cpa = selTotalBerbayar(lap?.total?.berbayar, "cpa");
  const persen = l && l.orderEligible > 0 ? Math.max(0, Math.min(Number(l.persen) || 0, 100)) : null;
  const adaCatatan = !bayar.lengkap || (rb && !rb.lengkap) || periode?.termasukHariBerjalan || cpa.kosong;
  return (
    <Card className="crm-mk-kel" data-testid="kelengkapan-data">
      <div className="crm-mk-kepala"><h3 className="t-card-title">Kelengkapan Data</h3></div>

      {l && (
        <div className="crm-mk-kel-ledger" data-testid="kel-ledger">
          <p className="crm-mk-kel-ledger-label">Cakupan pembayaran di ledger <InfoTooltip text={TIP.ledger} /></p>
          <div className="crm-mk-kel-bar-baris">
            <span className="crm-mk-kel-bar" role="img" aria-label={persen == null ? "Cakupan ledger belum ada data" : `Cakupan ledger ${formatPersen(l.persen)}`}>
              {persen != null && <span style={{ width: `${persen}%` }} data-lengkap={bayar.lengkap ? "1" : "0"} />}
            </span>
            <b className="crm-mk-kel-persen">{persen == null ? "—" : formatPersen(l.persen)}</b>
          </div>
          <p className="crm-mk-kel-teks">{angka(l.orderBerLedger)} dari {angka(l.orderEligible)} order eligible punya pembayaran di ledger.</p>
        </div>
      )}

      <ul className="crm-mk-kel-daftar">
        {rb && <Baris testid="kel-biaya" ok={rb.lengkap} judul="Biaya iklan" nilai={rb.lengkap ? "Lengkap" : "Belum lengkap"} tip={TIP.biaya}
          teks={rb.lengkap ? `${rb.jumlah} sumber berbayar terisi setiap hari.` : (rb.belum.map((x) => `${x.id}: ${statusBiayaTeks(x.status).toLowerCase()}`).join(" · ") || "Ada sumber berbayar yang belum lengkap.")} />}
        <Baris testid="kel-hari" ok={!periode?.termasukHariBerjalan} judul="Hari berjalan" nilai={periode?.termasukHariBerjalan ? "Termasuk" : "Tidak termasuk"} tip={TIP.hari}
          teks={periode?.termasukHariBerjalan ? "Lead dan pembayaran masih bertambah; biaya hari ini belum final." : null} />
      </ul>

      {cpa.kosong && (
        <p className="crm-mk-kel-info" data-testid="kel-cpa">
          <b>CPA dan ROAS belum ditampilkan</b>{cpa.alasan ? ` — ${cpa.alasan}` : ""}. Kosong bukan nol.
        </p>
      )}
      {!adaCatatan && <p className="crm-mk-kel-teks" data-testid="kel-aman">Tidak ada keterbatasan data yang perlu diperhatikan pada periode ini.</p>}

      <button type="button" className="crm-mk-kel-rincian" onClick={onRincian} data-testid="kel-rincian">Lihat rincian <ArrowRight size={14} aria-hidden="true" /></button>
    </Card>
  );
}
