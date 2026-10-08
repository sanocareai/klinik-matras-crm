import React from "react";
import { NOT_RECORDED } from "./componentNotesModel.js";

// Pengujian awal (fase 2 Produksi LAYANAN) — TIGA pengukuran ditampilkan TERPISAH: kasur utuh, lapisan, fondasi. Tidak dijumlahkan dan tidak ada kategori otomatis; data kosong = "Belum dicatat".
// Satu komponen dipakai Meja, Dokumentasi, Unit 360, dan laporan (data dari satu endpoint Catatan Komponen — tanpa input ulang).
export function PreTestBlock({ measurements, assembly = null, compact = false }) {
  const m = measurements;
  if (!m || !(m.recorded?.whole || m.recorded?.foundation || m.recorded?.layers || m.recorded?.wholeAfter || m.recorded?.foundationAfter)) return null;
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
      {(m.recorded?.foundationAfter || m.recorded?.wholeAfter) && (
        <>
          {assembly?.applicable && assembly.round > 1 && <p className="m-0 text-[12px] text-orange" data-testid="posttest-round-note">Putaran {assembly.round}: hasil uji dari putaran sebelumnya ditandai sampai diuji ulang.</p>}
          <p className="m-0 pt-1 text-[13px] font-bold text-ink">Uji setelah perbaikan</p>
          <Row label={`Uji fondasi baru (PIC QC)${assembly?.applicable && m.foundationAfter && !assembly.current?.foundationTest?.ok ? " — putaran sebelumnya" : ""}`} testid="posttest-foundation">
            {m.foundationAfter ? (
              <>
                <p className="m-0">{[m.foundationAfter.systemLabel, m.foundationAfter.material].filter(Boolean).join(" · ")}</p>
                <p className="m-0">{m.foundationAfter.unloadedHeightCm} cm tanpa beban → {m.foundationAfter.loadedHeightCm} cm dibebani {m.foundationAfter.testerWeightKg} kg · {m.foundationAfter.testMethod}</p>
                <p className="m-0 font-semibold text-ink" data-testid="foundation-after-drop">Penurunan fondasi baru: {m.foundationAfter.dropCm} cm <span className="font-normal text-ink3">(dihitung sistem)</span></p>
                {m.comparisons?.foundation?.text && <p className="m-0 text-ink3" data-testid="foundation-compare" data-comparable={m.comparisons.foundation.comparable ? "1" : "0"}>{m.comparisons.foundation.text}</p>}
              </>
            ) : <p className="m-0 text-ink3">{NOT_RECORDED}</p>}
          </Row>
          <Row label={`Uji kasur jadi (PIC QC)${assembly?.applicable && m.wholeAfter && !assembly.current?.wholeTest?.ok ? " — putaran sebelumnya" : ""}`} testid="posttest-whole">
            {m.wholeAfter ? (
              <>
                <p className="m-0">{m.wholeAfter.complaintMatchLabel}{m.wholeAfter.complaintNote ? ` — ${m.wholeAfter.complaintNote}` : ""}</p>
                <p className="m-0">Feel: {m.wholeAfter.feelNote}</p>
                <p className="m-0">Berat penguji aktual {m.wholeAfter.testerWeightKg} kg · {m.wholeAfter.testMethod}</p>
                <p className="m-0 font-semibold text-ink" data-testid="whole-after-drop">Penurunan kasur jadi: {m.wholeAfter.wholeDropCm} cm</p>
                {m.comparisons?.whole?.text && <p className="m-0 text-ink3" data-testid="whole-compare" data-comparable={m.comparisons.whole.comparable ? "1" : "0"}>{m.comparisons.whole.text}</p>}
              </>
            ) : <p className="m-0 text-ink3">{NOT_RECORDED}</p>}
          </Row>
        </>
      )}
      <p className="m-0 text-[11.5px] text-ink3" data-testid="pretest-separation">{m.separationNote}</p>
    </section>
  );
}
