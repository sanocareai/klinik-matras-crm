import React, { useId, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Landmark, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Uang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { useKontrak, IsiDefinisi } from "@/features/finance/kontrakData.jsx";
import { KotakPembalik, UangBiaya } from "@/features/finance/biayaNeto.jsx";
import { penandaDari, ringkasPembalik } from "@/features/finance/biayaNetoLogic.js";
import {
  ISTILAH, KALIMAT, LABEL_POSISI, TEKS_LABA_NOL, TEKS_STRIP, bahanBarisRekening, jenisRekening, keadaanStrip, keteranganRekening,
  pisahkanTindakLanjut, semuaKomponenNol,
} from "@/features/finance/ringkasanTampilan.js";
import { LABEL_BANNER } from "@/features/finance/ringkasanKualitas.js";
import { Pembuka, Cakupan, angkaId } from "@/features/finance/RingkasanKecil.jsx";
import BuktiDaftar from "@/features/finance/RingkasanBukti.jsx";
// Sumber & status izin logo: docs/ASET-LOGO-BANK.md (berkas lokal, tidak dimodifikasi).
import logoBca from "@/assets/bank/bca.svg";
import logoMandiri from "@/assets/bank/mandiri.png";

// Panel-panel halaman Ringkasan Keuangan. Semua gaya di styles/sanss-finance.css, terkunci ke `.fin-ring`.
// Panel ini HANYA menyajikan angka yang dikirim API yang sudah ada — tanpa perhitungan akuntansi baru.

const TANPA_DATA = "Tidak tersedia";

// ─── Strip status data ──────────────────────────────────────────────────────

export function StripStatus({ kualitas, catatan }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const keadaan = keadaanStrip(kualitas);
  const teks = TEKS_STRIP[keadaan];
  const lengkap = keadaan === "lengkap";
  const Ikon = lengkap ? CheckCircle2 : AlertTriangle;
  return (
    <section className={`fin-strip ${lengkap ? "fin-strip-ok" : "fin-strip-perhatian"}`} role="status" aria-live="polite" data-testid="banner-kualitas" aria-label="Status kelengkapan data">
      <div className="fin-strip-baris">
        <Ikon size={18} aria-hidden="true" className="fin-strip-ikon" />
        <div className="fin-strip-teks">
          <p className="fin-strip-judul">{teks.judul}</p>
          <p className="fin-strip-isi">{teks.isi}</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-strip-aksi">Lihat rincian</Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-strip-rincian">
          {lengkap
            ? <p>{TEKS_STRIP.lengkap.isi}</p>
            : <p>{KALIMAT.penjelasanBanner} Semua angka di halaman ini dihitung dari <b>jurnal yang sudah dibukukan</b>, bukan laporan final.</p>}
          {catatan?.pesan?.length > 0 && <ul>{catatan.pesan.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          <p className="fin-asli">Teks asli sistem: “{LABEL_BANNER}”</p>
        </div>
      )}
    </section>
  );
}

// ─── Empat KPI (kartu pendek: ikon, label, angka, satu keterangan) ──────────

export function KpiKartu({ nada, Ikon, label, nilai, ket, info, metrik, onClick, penanda, catatanTanggal }) {
  const kontrak = useKontrak();
  const m = metrik ? kontrak?.peta.get(metrik) : null;
  return (
    <div
      role="button" tabIndex={0} className={`fin-kpi fin-kpi-${nada}`} aria-label={`${label}: ${nilai}. ${ket}. Buka rincian`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(e); } }}
    >
      <div className="fin-kpi-atas">
        {Ikon && <span className="fin-kpi-ubin" aria-hidden="true"><Ikon size={22} /></span>}
        <div className="fin-kpi-label">
          <span>{label}</span>
          {(m || info) && (
            <InfoTooltip lebar={304} text={<>
              {m && <IsiDefinisi m={m} />}
              {info && <span className="block" style={m ? { marginTop: 8 } : undefined}>{info}</span>}
              {catatanTanggal && <span className="block" style={{ marginTop: 8 }}><b className="font-semibold text-ink">Tanggal: </b>{catatanTanggal}</span>}
            </>} />
          )}
        </div>
      </div>
      {penanda && <p className="fin-kpi-penanda">{penanda}</p>}
      <p className="fin-kpi-nilai">{nilai}</p>
      <p className="fin-kpi-ket">{ket}</p>
    </div>
  );
}

// ─── Perlu ditindaklanjuti (satu pintu masuk pekerjaan) ─────────────────────

function IkonStatus({ status }) {
  if (status === "perlu") return <span className="fin-tl-ikon fin-tl-ikon-perlu" aria-hidden="true"><AlertTriangle size={15} /></span>;
  if (status === "bersih") return <span className="fin-tl-ikon fin-tl-ikon-bersih" aria-hidden="true"><CheckCircle2 size={15} /></span>;
  return <span className="fin-tl-ikon fin-tl-ikon-tanpa" aria-hidden="true"><Info size={15} /></span>;
}

function BarisTindak({ b, navigate }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const jumlah = b.status === "tanpa-data" ? <span className="fin-redup">{TANPA_DATA}</span>
    : b.status === "bersih" ? <span className="fin-ok">{b.labelBersih ?? "Tidak ada"}</span>
      : <span className={b.id === "selisih_rekening" ? "fin-galat" : "fin-perhatian"}>{angkaId(b.jumlah)} {b.satuan}</span>;
  return (
    <li className={`fin-tl-baris fin-tl-${b.status}`} data-testid={`tl-${b.id}`}>
      <IkonStatus status={b.status} />
      <div className="fin-tl-judul">
        <span>{b.judul}</span>
        <button type="button" className="fin-info" aria-expanded={buka} aria-controls={id} aria-label={`Penjelasan: ${b.judul}`} onClick={() => setBuka((v) => !v)}><Info size={15} aria-hidden="true" /></button>
      </div>
      <p className="fin-tl-jumlah">{jumlah}</p>
      <p className="fin-tl-nilai">{b.status === "perlu" && b.nilai ? formatUang(b.nilai) : null}</p>
      {b.tujuan
        ? <Button variant="tertiary" size="sm" className="fin-tl-aksi" onClick={() => navigate(b.tujuan)} aria-label={`Lihat: ${b.judul}`}>Lihat <ArrowRight size={14} aria-hidden="true" /></Button>
        : <span className="fin-tl-aksi" />}
      {buka && <div id={id} className="fin-tl-penjelasan" role="note">{b.penjelasan}</div>}
    </li>
  );
}

export function TindakLanjut({ kelompok, bukti, galatBukti, aksiBukti, navigate }) {
  const [semua, setSemua] = useState(false);
  const idSemua = useId();
  const grup = pisahkanTindakLanjut(kelompok, semua);
  const jumlahNol = grup.reduce((s, g) => s + g.nol.length, 0);
  const adaPekerjaan = kelompok.some((g) => g.baris.some((b) => b.status === "perlu"));
  const adaTanpaData = kelompok.some((g) => g.baris.some((b) => b.status === "tanpa-data"));
  const tampil = grup.filter((g) => g.terlihat.length > 0);
  return (
    <section className="fin-panel" aria-labelledby="fin-tl-judul" data-testid="panel-perlu-ditindaklanjuti">
      <header className="fin-panel-kepala fin-panel-kepala-aksi">
        <div className="fin-panel-kepala-isi">
          <h2 id="fin-tl-judul" className="fin-panel-judul">Perlu ditindaklanjuti</h2>
          <p className="fin-panel-sub">Setiap kategori dihitung sendiri dan bisa saling tumpang tindih, jadi tidak dijumlahkan.</p>
        </div>
        {jumlahNol > 0 && (
          <Pembuka buka={semua} onToggle={() => setSemua((v) => !v)} id={idSemua} className="fin-panel-tautan">
            {semua ? "Sembunyikan kategori tanpa pekerjaan" : `Tampilkan semua kategori (${jumlahNol} tanpa pekerjaan)`}
          </Pembuka>
        )}
      </header>
      {!adaPekerjaan && !adaTanpaData && !semua && (
        <p className="fin-kosong">Tidak ada pekerjaan tercatat pada kategori yang diperiksa.</p>
      )}
      <div id={idSemua} className="fin-tl-grup-daftar">
        {tampil.map((g) => (
          <div key={g.id} className="fin-tl-grup" role="group" aria-labelledby={`fin-tl-g-${g.id}`}>
            <div className="fin-tl-grup-kepala">
              <h3 id={`fin-tl-g-${g.id}`}>{g.judul}</h3>
              <Cakupan>{g.cakupan}</Cakupan>
            </div>
            <ul className="fin-tl">
              {g.terlihat.map((b) => (
                <React.Fragment key={b.id}>
                  <BarisTindak b={b} navigate={navigate} />
                  {b.id === "bukti_transaksi" && b.status === "perlu" && bukti && (
                    <li className="fin-tl-bukti"><BuktiDaftar bukti={bukti} galat={galatBukti} aksi={aksiBukti} /></li>
                  )}
                </React.Fragment>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Saldo rekening ─────────────────────────────────────────────────────────

export function LogoBank({ r }) {
  const { jenis, namaBank } = jenisRekening(r);
  if (jenis === "BCA") return <span className="fin-logo fin-logo-merek"><img src={logoBca} alt="" loading="lazy" decoding="async" /></span>;
  if (jenis === "MANDIRI") return <span className="fin-logo fin-logo-merek"><img src={logoMandiri} alt="" loading="lazy" decoding="async" /></span>;
  if (jenis === "TUNAI" || jenis === "EWALLET") return <span className="fin-logo fin-logo-ikon" data-jenis={jenis}><Wallet size={20} aria-hidden="true" /></span>;
  return <span className="fin-logo fin-logo-ikon" data-jenis="BANK_LAIN" data-bank={namaBank || ""}><Landmark size={20} aria-hidden="true" /></span>;
}

function BarisRekening({ r, x, riil, navigate }) {
  const [buka, setBuka] = useState(false);
  const bahan = bahanBarisRekening(r, x, riil);
  const idRincian = useId();
  const { terkonfirmasi: tk, status } = bahan;
  const sekunder = keteranganRekening({ ...r, accountNumber: null });
  return (
    <li className="fin-rek-item" data-testid="baris-rekening">
      <div className="fin-rek-id">
        <LogoBank r={r} />
        <span className="fin-rek-nama">
          <span className="fin-rek-judul">{r.name}</span>
          <span className="fin-rek-sekunder">{sekunder}{r.accountNumber && <> · <span className="fin-rek-nomor">{r.accountNumber}</span></>}</span>
        </span>
      </div>
      <div className="fin-rek-saldo">
        <div className="fin-rek-sel">
          <span className="fin-rek-label">Saldo pembukuan</span>
          <Uang value={r.saldo} className="fin-rek-uang" />
          <span className="fin-rek-sekunder">{LABEL_POSISI}</span>
        </div>
        <div className="fin-rek-sel">
          <span className="fin-rek-label">Saldo terkonfirmasi</span>
          {tk.keadaan === "ada"
            ? <Uang value={tk.nilai} className="fin-rek-uang" />
            : <span className="fin-rek-uang fin-redup">{tk.keadaan === "belum" ? "Belum dikonfirmasi" : TANPA_DATA}</span>}
          <span className="fin-rek-sekunder">{tk.keterangan}</span>
          {((status && tk.keadaan === "ada") || bahan.danaBelumDikenal > 0) && (
            <span className="fin-rek-chips">
              {status && tk.keadaan === "ada" && <span className={`fin-chip fin-chip-${status.tone}`}>{status.label}</span>}
              {bahan.danaBelumDikenal > 0 && <span className="fin-chip fin-chip-perhatian">Sumber dana belum diketahui</span>}
            </span>
          )}
        </div>
      </div>
      <div className="fin-rek-aksi">
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={idRincian} className="fin-rek-tombol"><span className="fin-sr-saja">{r.name}: </span>Rincian</Pembuka>
      </div>
      {buka && (
        <div id={idRincian} className="fin-detail">
          <p className="fin-detail-status">
            <b>{ISTILAH.pencocokanSaldo.tampil}:</b>{" "}
            {status ? <span className={`fin-chip fin-chip-${status.tone}`}>{status.label}{bahan.tanggalAcuan && x?.status === "SESUAI" ? ` per ${bahan.tanggalAcuan}` : ""}</span> : <span className="fin-redup">—</span>}
          </p>
          <dl className="fin-detail-daftar">
            <div><dt>Saldo pembukuan terbaru</dt><dd><Uang value={r.saldo} /><span className="fin-rek-sekunder">{LABEL_POSISI}</span></dd></div>
            {bahan.baris.filter((b) => b.nilai !== undefined).map((b) => (
              <div key={b.k}><dt>{b.label}</dt><dd><Uang value={b.nilai} />{b.catatan && <span className="fin-rek-sekunder">{b.catatan}</span>}</dd></div>
            ))}
          </dl>
          {bahan.baris.filter((b) => b.teks).map((b) => <p key={b.k} className="fin-detail-teks">{b.teks}</p>)}
          {!!bahan.danaBelumDikenal && <p className="fin-detail-teks fin-detail-perhatian">Termasuk {formatUang(bahan.danaBelumDikenal)} dengan sumber dana belum diketahui.</p>}
          <Button variant="tertiary" size="sm" className="fin-detail-aksi" onClick={() => navigate(x?.periodeId ? `/finance/reconciliation?periode=${x.periodeId}` : "/finance/reconciliation")}>
            Buka {ISTILAH.pencocokanSaldo.tampil.toLowerCase()} <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  );
}

export function SaldoRekening({ data, riil, navigate }) {
  const [penjelasanDana, setPenjelasanDana] = useState(false);
  const [tentang, setTentang] = useState(false);
  const idDana = useId(); const idTentang = useId();
  const petaRiil = new Map((riil?.rekening ?? []).map((r) => [r.id, r]));
  const dana = riil?.danaBelumTeridentifikasi;
  return (
    <section className="fin-panel" aria-labelledby="fin-rek-judul" data-testid="panel-saldo-rekening">
      <header className="fin-panel-kepala fin-panel-kepala-aksi">
        <div className="fin-panel-kepala-isi">
          <h2 id="fin-rek-judul" className="fin-panel-judul">Saldo rekening</h2>
          <p className="fin-panel-sub fin-cakupan-baris">
            <Cakupan>Posisi terbaru</Cakupan>
            {riil ? <Cakupan nada="biru">{ISTILAH.tanggalAcuan.tampil}: {tanggalPendek(riil.tanggalBuku)}</Cakupan> : <span className="fin-redup">Saldo terkonfirmasi tidak dapat dimuat.</span>}
            <span>Pencocokan sementara, tanpa rekening koran.</span>
          </p>
        </div>
        <Pembuka buka={tentang} onToggle={() => setTentang((v) => !v)} id={idTentang} className="fin-panel-tautan">Tentang pencocokan saldo</Pembuka>
      </header>
      {tentang && (
        <div id={idTentang} className="fin-catatan-kaki fin-tentang">
          <p><b>Apa yang dicocokkan?</b> Saldo pembukuan (dari jurnal) pada tanggal acuan dibandingkan dengan saldo terkonfirmasi pemilik pada tanggal yang sama. Transaksi setelah tanggal acuan tidak ikut memengaruhi selisih.</p>
          <p>Saldo pembukuan di daftar adalah posisi terbaru, jadi bisa berbeda dari saldo pada tanggal acuan. Selisih dibaca dari sistem, tidak dihitung dari dua angka di daftar.</p>
          <p>{KALIMAT.penjelasanPencocokan}{riil ? <> Sumber saldo terkonfirmasi: {riil.sumber.toLowerCase()}. Tanggal acuan: {riil.cutoffLabel}.</> : null}</p>
          <p className="fin-asli">Istilah asli sistem: {ISTILAH.pencocokanSaldo.asli}; {ISTILAH.tanggalAcuan.asli.toLowerCase()}.</p>
        </div>
      )}
      {data.kasBank.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada rekening" description="Daftarkan kas & rekening bank supaya uang masuk/keluar punya tempat."
          action={<Button size="sm" onClick={() => navigate("/finance/cash")}>Tambah Rekening</Button>} />
      ) : (
        <ul className="fin-rek" data-testid="tabel-kas-bank">
          {data.kasBank.map((r) => <BarisRekening key={r.id} r={r} x={petaRiil.get(r.id)} riil={riil} navigate={navigate} />)}
        </ul>
      )}
      {!!dana?.total && (
        <div className="fin-dana" role="note" data-testid="strip-dana-belum-diketahui">
          <div className="fin-dana-baris">
            <AlertTriangle size={16} aria-hidden="true" className="fin-dana-ikon" />
            <p className="fin-dana-teks"><b>{formatUang(dana.total)} – {ISTILAH.sumberDanaBelumDiketahui.tampil}</b><span className="block">Belum dihitung sebagai pendapatan.</span></p>
            <Pembuka buka={penjelasanDana} onToggle={() => setPenjelasanDana((v) => !v)} id={idDana} className="fin-dana-aksi">Lihat rincian</Pembuka>
          </div>
          {penjelasanDana && (
            <div id={idDana} className="fin-dana-rincian">
              {dana.peringatan && <p>{dana.peringatan}</p>}
              <p>{KALIMAT.danaBelumDiketahui}</p>
              <p className="fin-asli">Istilah asli sistem: {ISTILAH.sumberDanaBelumDiketahui.asli}.</p>
            </div>
          )}
        </div>
      )}
      <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/reconciliation")}>Buka {ISTILAH.pencocokanSaldo.tampil.toLowerCase()} <ArrowRight size={14} aria-hidden="true" /></Button>
    </section>
  );
}

// ─── Laba rugi sementara ────────────────────────────────────────────────────

function BarisLR({ label, children, sub, akhir }) {
  return (
    <div className={`fin-lr-baris${sub ? " fin-lr-sub" : ""}${akhir ? " fin-lr-akhir" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function LabaRugiPanel({ lr, penanda, marginInfo, periodeLabel, navigate }) {
  const [penjelasan, setPenjelasan] = useState(false);
  const [cara, setCara] = useState(false);
  const [rinci, setRinci] = useState(false);
  const idPen = useId(); const idCara = useId(); const idRinci = useId();
  const nol = semuaKomponenNol(lr);
  const pembalik = ringkasPembalik(lr);
  const pen = penandaDari({ penanda });
  // Label utama bahasa sederhana; istilah akuntansi asli (dan penjelasan server) tetap ada di tooltip & rincian.
  const penLabel = { ...pen, pembalikBebanBersih: { label: ISTILAH.penyesuaianPengurangBiaya.tampil, penjelasan: `${pen.pembalikBebanBersih.label}: ${pen.pembalikBebanBersih.penjelasan}` } };
  const baris = (
    <dl className="fin-lr">
      <BarisLR label="Pendapatan tercatat"><Uang value={lr?.pendapatanBruto ?? 0} /></BarisLR>
      <BarisLR label="Retur & potongan"><Uang value={-(Number(lr?.retur) || 0)} /></BarisLR>
      <BarisLR label="Pendapatan bersih" sub><Uang value={lr?.pendapatanBersih ?? 0} /></BarisLR>
      <BarisLR label="Biaya pokok (HPP)"><UangBiaya value={lr?.bebanPokok ?? 0} penanda={penLabel} /></BarisLR>
      <BarisLR label="Laba kotor" sub><Uang value={lr?.labaKotor ?? 0} /></BarisLR>
      <BarisLR label="Biaya operasional"><UangBiaya value={lr?.bebanOperasional ?? 0} penanda={penLabel} /></BarisLR>
      <BarisLR label="Laba sementara" akhir><Uang value={lr?.labaBersih ?? 0} /></BarisLR>
    </dl>
  );
  return (
    <section className="fin-panel" aria-labelledby="fin-lr-judul" data-testid="panel-laba-rugi">
      <header className="fin-panel-kepala">
        <h2 id="fin-lr-judul" className="fin-panel-judul">Laba rugi sementara</h2>
        <p className="fin-panel-sub fin-cakupan-baris"><Cakupan nada="biru">Periode terpilih · {periodeLabel}</Cakupan><span>Dari jurnal yang sudah dibukukan; pendapatan diakui saat order diserahterimakan.</span></p>
      </header>
      {nol ? (
        <div className="fin-lr-nol" data-testid="laba-rugi-nol">
          <div className="fin-lr-baris fin-lr-akhir"><span className="fin-lr-nol-label">Laba sementara</span><span className="fin-lr-nol-nilai"><Uang value={0} /></span></div>
          <p className="fin-panel-sub">{TEKS_LABA_NOL}</p>
          <Pembuka buka={rinci} onToggle={() => setRinci((v) => !v)} id={idRinci} className="fin-panel-tautan">Lihat rincian perhitungan</Pembuka>
          {rinci && <div id={idRinci}>{baris}</div>}
        </div>
      ) : baris}
      {pembalik.ada && (
        <div className="fin-lr-catatan" data-testid="catatan-penyesuaian-biaya">
          <div className="fin-lr-catatan-baris">
            <p><b>{KALIMAT.penyesuaianBiaya}</b></p>
            <Pembuka buka={penjelasan} onToggle={() => setPenjelasan((v) => !v)} id={idPen} className="fin-lr-aksi">Lihat penjelasan</Pembuka>
          </div>
          {penjelasan && (
            <div id={idPen}>
              <KotakPembalik penanda={pen} ada testid="kotak-pembalik-dashboard" />
              <p className="fin-asli">Istilah asli: {ISTILAH.penyesuaianPengurangBiaya.asli}.</p>
            </div>
          )}
        </div>
      )}
      {cara && (
        <div id={idCara} className="fin-catatan-kaki">
          <p>{pen.rumusLaba}</p>
          <p>Pendapatan bersih = pendapatan tercatat − retur & potongan. Laba kotor = pendapatan bersih − biaya pokok (HPP). Laba sementara = laba kotor − biaya operasional.</p>
          <p data-testid="catatan-margin">
            {marginInfo?.tampil ? <>Margin bersih {marginInfo.nilai.toFixed(1)}%.</> : <>{marginInfo?.alasan ?? "Margin tidak ditampilkan"}. Margin baru ditampilkan setelah data pendapatan lengkap.</>}
          </p>
        </div>
      )}
      <div className="fin-panel-aksi-baris">
        <Pembuka buka={cara} onToggle={() => setCara((v) => !v)} id={idCara} className="fin-panel-tautan">Cara menghitung laba</Pembuka>
        <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/reports")}>Lihat laporan lengkap <ArrowRight size={14} aria-hidden="true" /></Button>
      </div>
    </section>
  );
}
