import React, { useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { makeCustomRange } from "@/lib/dateRange.js";
import { bannerUtama, statusMembayar, ringkasBiayaBerbayar, statusBiayaTeks } from "../../akuisisiLogic.js";
import { saranRentang } from "../../periodeLaporan.js";
import { namaMerek } from "../LogoSumber.jsx";

// Satu strip "Hasil masih sementara" (redesain Apple, 10 Nov 2026) menggantikan dua peringatan oranye + banner hari berjalan.
// Isinya sama dengan peringatan lama, hanya disatukan: biaya iklan belum lengkap, pembayaran belum lengkap, dan hari berjalan ditulis TERPISAH (masalahnya berbeda).
// Tidak ada ambang baru: biaya = total.berbayar.belumLengkap dari server, pembayaran = statusMembayar(), hari berjalan = periode.
export function butirStatus(lap, periode) {
  const out = [];
  const rb = ringkasBiayaBerbayar(lap);
  if (rb && !rb.lengkap) {
    const nama = rb.belum.map((x) => namaMerek(x.id)).join(" & ");
    const banner = bannerUtama(lap);
    out.push({
      id: "biaya", ringkas: rb.belum.length ? `Biaya ${rb.belum.length} sumber belum lengkap` : "Biaya iklan belum lengkap",
      judul: "Biaya iklan belum lengkap", teks: `${nama ? `${nama}: ${rb.belum.map((x) => statusBiayaTeks(x.status).toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(", ")}. ` : ""}${banner && !/hari berjalan/i.test(banner) ? banner : "CPA dan ROAS sumber tersebut belum dapat dinilai."}`,
    });
  }
  const bayar = statusMembayar(lap); const l = lap?.status?.ledger;
  if (!bayar.lengkap && l) {
    out.push({
      id: "bayar", ringkas: `Pembayaran tercatat pada ${l.orderBerLedger} dari ${l.orderEligible} order`,
      judul: "Pembayaran belum lengkap", teks: `${bayar.teks}. Pembayaran di luar sistem belum terlihat, jadi customer membayar, lunas, dan uang diterima adalah batas bawah.`,
    });
  }
  if (periode?.termasukHariBerjalan) {
    out.push({ id: "hari", ringkas: "Memuat hari berjalan", judul: "Hari berjalan", teks: "Lead dan pembayaran masih bertambah, biaya hari ini belum final — CPA/ROAS sengaja kosong.", pintasan: true });
  }
  return out;
}

export default function StripStatus({ lap, periode, hariIni, onUbahRentang, onKualitas }) {
  const [buka, setBuka] = useState(false);
  const butir = butirStatus(lap, periode);
  if (!butir.length) return null;
  const saran = saranRentang(hariIni);
  return (
    <section className="mk-strip" data-testid="strip-status" role="status" aria-label="Hasil masih sementara">
      <div className="mk-strip-baris">
        <CircleAlert size={18} className="mk-strip-ikon" aria-hidden="true" />
        <p className="mk-strip-teks">
          <strong>Hasil masih sementara</strong>
          {butir.map((b) => <span key={b.id} className="mk-strip-butir" data-testid={`strip-${b.id}`}>{b.ringkas}</span>)}
        </p>
        <button type="button" className="mk-strip-aksi" aria-expanded={buka} onClick={() => setBuka((v) => !v)} data-testid="strip-rincian">
          Rincian <ChevronDown size={14} aria-hidden="true" className={buka ? "rotate-180" : ""} />
        </button>
      </div>
      {buka && (
        <ul className="mk-strip-rincian">
          {butir.map((b) => (
            <li key={b.id}>
              <b>{b.judul}</b> <span>{b.teks}</span>
              {b.pintasan && onUbahRentang && (
                <span className="mk-strip-pintasan">{saran.map((s) => <button key={s.id} type="button" className="mk-kapsul mk-kapsul--kecil" onClick={() => onUbahRentang(makeCustomRange(s.dari, s.sampai))}>{s.label}</button>)}</span>
              )}
            </li>
          ))}
          {onKualitas && <li><button type="button" className="mk-tautan" onClick={onKualitas}>Lihat bagian Kualitas data</button></li>}
        </ul>
      )}
    </section>
  );
}
