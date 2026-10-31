import React, { useState } from "react";
import { Timer, ArrowRightLeft, Info } from "lucide-react";
import { formatRupiah, formatRupiahShort, STAGE_LABELS, stageDotVar } from "@/utils/format.js";
import { formatTanggal } from "@/utils/formatDate.js";
import { Card } from "@/components/ui/card.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { STAGE_INFO } from "../utils/stageInfo.js";
import Sparkline from "./Sparkline.jsx";

// Revisi 26 Jul 2026: pipeline 8-stage, LOST dihapus (jadi hanya PAID/REVIEWED
// yang punya makna "berhasil"). Label dipakai langsung dari STAGE_LABELS
// (utils/format.js) — dulu file ini punya salinan sendiri (STAGE_LABEL_ID)
// yang independen dan rawan drift dari sumber utama (lihat CLAUDE.md §8,
// "Label 'Penawaran' masih muncul di beberapa tempat"); sekarang satu sumber.
// Revisi 30 Jul 2026: PAID dihapus (7 stage) — COMPLETED sekarang yang
// punya makna "berhasil" bareng REVIEWED.
// Revisi 24 Agustus 2026: 7 stage → 4 (NEW/PROSPECT/TRANSACTION/SPAM).
// QUALIFIED/QUOTED/BOOKED/SCHEDULED digabung PROSPECT, COMPLETED/REVIEWED
// digabung TRANSACTION. SPAM abu-abu netral — bukan "berhasil", bukan
// "sedang berjalan", jadi dapat treatment visual sendiri.
// Warna tahap (titik, bar): SATU sumber — palet tahap bersama (styles/stage-palette.css) lewat stageDotVar() di utils/format.js.
//
// REDESAIN Sales CRM (1 Nov 2026) — penyajian saja; populasi, periode, nilai, rumus konversi/persentase, definisi tidak berubah:
//  • "Sales Pipeline Funnel" = POSISI SAAT INI (foto kondisi sekarang): kotak funnel + tabel "Detail per Stage" lama dipadatkan jadi SATU tabel
//    (stage, jumlah, porsi, nilai, rasio vs stage sebelumnya) — semua angka & tooltip yang sama, tanpa pengulangan.
//  • "Kecepatan Pipeline" dan "Pergerakan Pipeline" = KEJADIAN perpindahan stage (riwayat pipeline_transitions) — dipisah dan diberi penanda
//    "Selama periode", supaya tidak tertukar dengan posisi saat ini.

// "3.4" → "3,4 hari" · "0.5" → "12 jam" (di bawah 1 hari lebih enak dibaca
// dalam jam). null → em-dash, JANGAN "0 hari" (0 berarti "instan", null
// berarti "belum ada datanya" — dua hal yang sangat berbeda di laporan).
function formatDurasiHari(hari) {
  if (hari == null) return "—";
  if (hari < 1) {
    const jam = Math.round(hari * 24);
    return jam <= 0 ? "<1 jam" : `${jam} jam`;
  }
  return `${hari.toString().replace(".", ",")} hari`;
}

// Stage yang paling lama tertahan = kemungkinan bottleneck.
// TRANSACTION/REVIEWED/SPAM dikecualikan (TRANSACTION & REVIEWED itu stage
// AKHIR "berhasil" — "lama di sana" tidak berarti macet, cuma belum pindah
// lagi / memang sudah selesai. SPAM juga bukan kandidat bottleneck — memang
// sengaja dibiarkan di sana).
function cariBottleneck(avgDaysInStage) {
  const kandidat = (avgDaysInStage || []).filter(
    (r) => r.stage !== "TRANSACTION" && r.stage !== "REVIEWED" && r.stage !== "SPAM" && r.avgDays != null && r.sample > 0
  );
  if (kandidat.length === 0) return null;
  return kandidat.reduce((a, b) => (b.avgDays > a.avgDays ? b : a));
}

// Penjelasan sederhana tiap bagian (permintaan owner 30 Sep 2026). Definisi
// stage ada di ../utils/stageInfo.js (dipakai juga kartu Sales per Stage).
const INFO = {
  funnel: "Gambaran perjalanan pelanggan dari lead baru sampai transaksi. Tiap baris = satu stage: angka besar adalah jumlah pelanggan yang SEKARANG ada di stage itu, Rp di sebelahnya adalah nilai order pasti mereka (order Menunggu dan Dibatalkan tidak dihitung). Yang dihitung hanya pelanggan yang pertama kali masuk di periode terpilih.",
    konversi: "Rasio antar tahap = jumlah pelanggan SAAT INI di tahap ini (pembilang) ÷ jumlah pelanggan saat ini di tahap pada baris tepat di atasnya (penyebut), dibulatkan ke persen. Contoh: 280 di Prospek ÷ 310 di New = 90%. Ini perbandingan dua jumlah pada saat ini — BUKAN tingkat perpindahan pelanggan antar tahap dan BUKAN perubahan antarperiode (perpindahan sesungguhnya ada di Pergerakan Pipeline). Bisa lebih dari 100% bila tahap ini lebih besar dari tahap di atasnya. Tanda “—” muncul bila baris di atasnya kosong, pada tahap pertama, dan pada Spam (Spam bukan kelanjutan tahap Reviewed, jadi tidak dibandingkan).",
  jumlah: "Jumlah pelanggan yang sekarang berada di stage itu.",
  nilai: "Total nilai order pasti milik pelanggan di stage itu. Order Menunggu (belum pasti) dan Dibatalkan tidak dihitung.",
  persen: "Porsi stage ini dari SELURUH pelanggan di periode terpilih (termasuk Spam). Rumus: jumlah di stage ini dibagi total semua stage. Semua baris kalau dijumlah = 100%.",
  kecepatan: "Rata-rata berapa lama pelanggan tinggal di satu stage sebelum dipindah ke stage berikutnya. Makin pendek makin cepat closing. Dihitung dari riwayat perpindahan stage yang dicatat sistem.",
  cakupanTerlama: "Perbandingan ini hanya mencakup New dan Prospek. Transaksi, Reviewed, dan Spam tidak ikut dipilih. Durasi tahap tersebut tetap ditampilkan di bawah.",
  sample: "n = jumlah perpindahan yang dipakai untuk menghitung rata-rata itu. Kalau angkanya kecil (mis. n=2), rata-ratanya belum bisa dipercaya.",
  pergerakan: "Berapa pelanggan MASUK ke tiap stage selama periode terpilih. Beda dengan funnel di atas yang menunjukkan posisi pelanggan saat ini: di sini yang dihitung adalah kejadian perpindahannya.",
};

// Penjelasan yang dibuka lewat KLIK/TAP dan KEYBOARD (Enter/Spasi; Esc menutup) — bukan hover saja. Teks tampil inline di bawah kalimat (tanpa portal), jadi tidak terpotong di HP.
function PenjelasanKlik({ id, teks }) {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button type="button" className="crm-pl-info" aria-expanded={buka} aria-controls={id} aria-label="Penjelasan cakupan perbandingan" onClick={() => setBuka((v) => !v)} onKeyDown={(e) => { if (e.key === "Escape") setBuka(false); }} data-testid="bottleneck-info">
        <Info size={14} aria-hidden="true" />
      </button>
      {buka && <span id={id} className="crm-pl-info-isi" role="note" data-testid="bottleneck-info-isi">{teks}</span>}
    </>
  );
}

const Titik = ({ s }) => <i className="crm-ss-titik" style={{ background: stageDotVar(s) }} aria-hidden="true" />;

export default function PipelineTab({ funnel, velocity }) {
  const total = funnel.reduce((s, f) => s + f.count, 0);

  const avgDays    = velocity?.avgDaysInStage || [];
  const movedTo    = velocity?.movedToStage || [];
  const totalTrans = velocity?.totalTransitions || 0;
  const adaData    = totalTrans > 0;
  const bottleneck = cariBottleneck(avgDays);
  const totalPindah = movedTo.reduce((s, r) => s + (r.count || 0), 0);
  const maxHari    = Math.max(1, ...avgDays.map((r) => r.avgDays || 0));

  // Empty state MENJELASKAN kenapa kosong. Tabel riwayat baru mulai merekam
  // dan tidak bisa di-backfill, jadi tanpa penjelasan ini widget terlihat
  // seperti fitur rusak padahal sedang menunggu data.
  const pesanKosong = (
    <div className="crm-pl-kosong" data-testid="pipeline-data-belum">
      <Timer className="text-ink3" size={26} />
      <p className="crm-pl-kosong-judul">Data belum terkumpul</p>
      <p className="crm-pl-kosong-teks">
        Kecepatan pipeline dihitung dari <strong>riwayat perpindahan stage</strong>, yang
        baru mulai dicatat sistem. Perpindahan sebelum fitur ini aktif tidak bisa
        dihitung ulang. Grafik akan terisi sendiri setelah tim memindahkan stage
        pelanggan beberapa kali — biasanya jelas dalam 2–4 minggu.
      </p>
    </div>
  );

  return (
    <div className="crm-lap-tab" data-testid="tab-pipeline">
      <div className="crm-lap-baris crm-lap-baris--tren">
        {/* ── POSISI SAAT INI: funnel + detail per stage dalam satu tabel ───────────────────────────────────── */}
        <Card className="crm-ss-sebaran crm-pl-posisi" data-testid="pipeline-posisi">
          <div className="crm-pl-kepala">
            <h3 className="t-card-title">Sales Pipeline Funnel</h3>
            <InfoTooltip text={INFO.funnel} />
            <span className="crm-pl-pil" data-jenis="posisi">Posisi saat ini</span>
            <p className="crm-mk-deskripsi">Jumlah pelanggan saat ini &amp; rasio antar tahap</p>
          </div>
          {funnel.length === 0 ? (
            <p className="crm-mk-kosong">Belum ada data pipeline.</p>
          ) : (
            <div role="table" aria-label="Posisi pelanggan per stage saat ini" className="crm-ss-tabel">
              <div role="row" className="crm-ss-baris crm-ss-baris--kepala">
                <span role="columnheader">Stage</span>
                <span role="columnheader" className="crm-ss-kanan">Jumlah <InfoTooltip text={INFO.jumlah} /></span>
                <span role="columnheader" className="crm-ss-kol-bar">Persentase <InfoTooltip text={INFO.persen} /></span>
                <span role="columnheader" className="crm-ss-kanan">Total Nilai <InfoTooltip text={INFO.nilai} /></span>
                <span role="columnheader" className="crm-ss-kanan">Rasio antar tahap <InfoTooltip text={INFO.konversi} /></span>
              </div>
              {funnel.map((item, i) => {
                const prev = funnel[i - 1];
                // Rasio antar tahap = jumlah tahap ini ÷ jumlah tahap di baris atasnya (rumus lama, tidak diubah). Spam bukan kelanjutan Reviewed → tidak dibandingkan (—).
                const conversion = item.stage !== "SPAM" && prev && prev.count > 0 ? Math.round((item.count / prev.count) * 100) : null;
                const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0";
                return (
                  <div role="row" className="crm-ss-baris" key={item.stage} data-stage={item.stage}>
                    <span role="cell" className="crm-ss-tahap"><Titik s={item.stage} /><span className="crm-ss-nama">{item.label}</span><InfoTooltip text={STAGE_INFO[item.stage]} /></span>
                    <span role="cell" className="crm-ss-lead crm-ss-kanan">{item.count.toLocaleString("id-ID")}</span>
                    <span role="cell" className="crm-pl-porsi">
                      <span className="crm-ss-bar"><span style={{ width: `${pct}%`, background: stageDotVar(item.stage) }} /></span>
                      <b>{pct}%</b>
                    </span>
                    <span role="cell" className="crm-ss-nilai crm-ss-kanan" data-label="Nilai" title={formatRupiah(item.value)}>{formatRupiahShort(item.value)}</span>
                    <span role="cell" className="crm-ss-mandek crm-ss-kanan" data-label="Rasio antar tahap" title={conversion != null ? `${item.count.toLocaleString("id-ID")} ÷ ${prev.count.toLocaleString("id-ID")} (${item.label} ÷ ${prev.label}), jumlah saat ini` : item.stage === "SPAM" ? "Spam bukan kelanjutan tahap Reviewed — tidak dibandingkan" : "Tidak ada tahap pembanding (tahap pertama atau tahap di atasnya kosong)"}>{conversion != null ? `${conversion}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── KECEPATAN (kejadian perpindahan stage, dari pipeline_transitions) ──────────────────────────── */}
        <Card className="crm-pl-kec" data-testid="pipeline-kecepatan">
          <div className="crm-pl-kepala">
            <h3 className="t-card-title">Kecepatan Pipeline</h3>
            <InfoTooltip text={INFO.kecepatan} />
            <span className="crm-pl-pil" data-jenis="periode">Selama periode</span>
            <p className="crm-mk-deskripsi">Rata-rata lama pelanggan tertahan di tiap stage — makin pendek makin cepat closing</p>
          </div>
          {!adaData ? pesanKosong : (
            <>
              {bottleneck && (
                <div className="crm-pl-bottleneck" data-testid="pipeline-bottleneck">
                  <Timer className="shrink-0" size={16} aria-hidden="true" />
                  <p>
                    Di antara New dan Prospek, waktu rata-rata terlama ada di{" "}
                    <strong>{STAGE_LABELS[bottleneck.stage] || bottleneck.stage}</strong>:{" "}
                    <strong>{formatDurasiHari(bottleneck.avgDays)}</strong>.{" "}
                    <PenjelasanKlik id="penjelasan-terlama" teks={INFO.cakupanTerlama} />
                  </p>
                </div>
              )}
              <ul className="crm-pl-kec-daftar">
                {avgDays.map((row) => (
                  <li key={row.stage} className="crm-pl-kec-baris">
                    <span className="crm-pl-kec-nama"><Titik s={row.stage} /><span>{STAGE_LABELS[row.stage] || row.stage}</span><InfoTooltip text={STAGE_INFO[row.stage]} /></span>
                    <b className="crm-pl-kec-nilai">{formatDurasiHari(row.avgDays)}</b>
                    {/* sample = jumlah perpindahan yang jadi dasar rata-rata. Angka kecil = rata-rata belum bisa dipercaya, jadi ditampilkan terbuka. */}
                    <span className="crm-pl-kec-n" title="Jumlah perpindahan yang jadi dasar perhitungan">
                      {row.sample > 0 ? <>n={row.sample} <InfoTooltip text={INFO.sample} /></> : "—"}
                    </span>
                    <span className="crm-ss-bar crm-pl-kec-bar"><span style={{ width: `${row.avgDays != null ? Math.max((row.avgDays / maxHari) * 100, 2) : 0}%`, background: stageDotVar(row.stage) }} /></span>
                  </li>
                ))}
              </ul>
              {velocity?.dataStartedAt && (
                <p className="crm-pl-catatan">
                  Berdasarkan {totalTrans} perpindahan stage yang tercatat sejak{" "}
                  {formatTanggal(velocity.dataStartedAt)}.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {/* ── PERGERAKAN: berapa pelanggan MASUK ke tiap stage selama periode (kejadian, bukan posisi) ────────────── */}
      <Card className="crm-pl-gerak" data-testid="pipeline-pergerakan">
        <div className="crm-pl-kepala">
          <h3 className="t-card-title">Pergerakan Pipeline</h3>
          <InfoTooltip text={INFO.pergerakan} />
          <span className="crm-pl-pil" data-jenis="periode">Selama periode</span>
          <p className="crm-mk-deskripsi">Berapa pelanggan MASUK ke tiap stage pada periode ini (beda dari tabel posisi di atas yang menghitung posisi saat ini)</p>
        </div>
        {!adaData ? <p className="crm-mk-kosong" data-testid="pergerakan-belum">Data belum terkumpul — riwayat perpindahan stage baru mulai dicatat (penjelasan di Kecepatan Pipeline).</p> : (
          <div className="crm-pl-gerak-isi">
            <div className="crm-pl-gerak-kiri">
              <ul className="crm-pl-gerak-daftar">
                {movedTo.map((row) => (
                  <li key={row.stage} className="crm-pl-gerak-sel">
                    <span className="crm-pl-gerak-nama"><ArrowRightLeft size={11} className="shrink-0" aria-hidden="true" /><Titik s={row.stage} /><span>{STAGE_LABELS[row.stage] || row.stage}</span><InfoTooltip text={STAGE_INFO[row.stage]} /></span>
                    <b className="crm-pl-gerak-angka">{row.count.toLocaleString("id-ID")}</b>
                  </li>
                ))}
              </ul>
              <p className="crm-pl-catatan">Total {totalPindah} perpindahan pada periode terpilih.</p>
            </div>
            {velocity?.monthlyWon?.length >= 2 && (
              <div className="crm-pl-gerak-tren">
                <p className="crm-pl-gerak-tren-judul">Tren bulanan masuk “Berhasil”</p>
                <Sparkline data={velocity.monthlyWon} color="#1F9D55" />
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
