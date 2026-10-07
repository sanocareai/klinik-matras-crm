import React from "react";
import { NOT_RECORDED } from "./componentNotesModel.js";

// Pengujian awal (fase 2 Produksi LAYANAN) — TIGA pengukuran ditampilkan TERPISAH: kasur utuh, lapisan, fondasi. Tidak dijumlahkan dan tidak ada kategori otomatis; data kosong = "Belum dicatat".
// Satu komponen dipakai Meja, Dokumentasi, Unit 360, dan laporan (data dari satu endpoint Catatan Komponen — tanpa input ulang).
export function PreTestBlock({ measurements, compact = false }) {
  const m = measurements;
  if (!m || !(m.recorded?.whole || m.recorded?.foundation || m.recorded?.layers)) return null;
  const w = m.whole; const f = m.foundation; const l = m.layers;
  const Row = ({ label, children, testid }) => (
    <div className="rounded-btn bg-inset px-3 py-2" data-testid={testid}>
      <p className="m-0 text-[12.5px] font-bold text-ink">{label}</p>
      <div className="mt-0.5 space-y-0.5 text-[12.5px] text-ink2">{children}</div>
    </div>
  );
  return (
    <section className={compact ? "space-y-1.5" : "space-y-2"} aria-label="Pengujian awal" data-testid="pretest-block">
      <p className="m-0 text-[13px] font-bold text-ink">Pengujian awal (sebelum bongkar)</p>
      <Row label="Uji kasur utuh (PIC QC)" testid="pretest-whole">
        {w ? (
          <>
            <p className="m-0">{w.complaintMatchLabel}{w.complaintNote ? ` — ${w.complaintNote}` : ""}</p>
            <p className="m-0">Feel awal: {w.feelNote}</p>
            <p className="m-0">Berat penguji aktual {w.testerWeightKg} kg · {w.testMethod}</p>
            <p className="m-0 font-semibold text-ink" data-testid="whole-drop">Penurunan kasur utuh: {w.wholeDropCm} cm</p>
          </>
        ) : <p className="m-0 text-ink3">{NOT_RECORDED}</p>}
      </Row>
      <Row label="Lapisan awal (atas ke bawah)" testid="pretest-layers">
        {l ? <p className="m-0" data-testid="layers-total">{l.label}</p> : <p className="m-0 text-ink3">{NOT_RECORDED}</p>}
      </Row>
      <Row label="Uji fondasi awal (PIC QC)" testid="pretest-foundation">
        {f ? (
          <>
            <p className="m-0">{[f.systemLabel, f.material].filter(Boolean).join(" · ")}</p>
            <p className="m-0">{f.unloadedHeightCm} cm tanpa beban → {f.loadedHeightCm} cm dibebani {f.testerWeightKg} kg · {f.testMethod}</p>
            <p className="m-0 font-semibold text-ink" data-testid="foundation-drop">Penurunan fondasi: {f.dropCm} cm <span className="font-normal text-ink3">(dihitung sistem)</span></p>
          </>
        ) : <p className="m-0 text-ink3">{NOT_RECORDED}</p>}
      </Row>
      <p className="m-0 text-[11.5px] text-ink3" data-testid="pretest-separation">{m.separationNote}</p>
    </section>
  );
}
