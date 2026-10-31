import React, { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Landmark, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Uang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { useKontrak, IsiDefinisi } from "@/features/finance/kontrakData.jsx";
import { KotakPembalik, UangBiaya } from "@/features/finance/biayaNeto.jsx";
import { penandaDari, ringkasPembalik } from "@/features/finance/biayaNetoLogic.js";
import {
  ISTILAH, KALIMAT, TEKS_STRIP, bahanBarisRekening, jenisRekening, keadaanStrip, keteranganRekening, susunPerluDibereskan,
} from "@/features/finance/ringkasanTampilan.js";
import { LABEL_BANNER, LABEL_REKONSILIASI } from "@/features/finance/ringkasanKualitas.js";
import logoBca from "@/assets/bank/bca.svg";
import logoMandiri from "@/assets/bank/mandiri.png";

// Panel-panel baru halaman Ringkasan Keuangan (Fase Ringkasan Finance). Semua gaya di styles/sanss-finance.css, terkunci ke `.fin-ring`.
// Panel ini HANYA menyajikan angka yang dikirim API yang sudah ada — tanpa perhitungan akuntansi baru.

const TANPA_DATA = "Tidak tersedia";
const angkaId = (n) => Number(n).toLocaleString("id-ID");

/** Tombol buka/tutup penjelasan dengan atribut aksesibilitas yang benar. */
function Pembuka({ buka, onToggle, id, children, className = "" }) {
  return (
    <button type="button" className={`fin-pembuka ${className}`} aria-expanded={buka} aria-controls={id} onClick={onToggle}>
      {children}<ChevronDown size={14} aria-hidden="true" className="fin-pembuka-panah" />
    </button>
  );
}

// ─── 2. Strip status data ───────────────────────────────────────────────────

export function StripStatus({ kualitas, catatan }) {
  const [buka, setBuka] = useState(false);
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
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id="fin-strip-rincian" className="fin-strip-aksi">Lihat rincian</Pembuka>
      </div>
      {buka && (
        <div id="fin-strip-rincian" className="fin-strip-rincian">
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

// ─── 3-4. Empat KPI ─────────────────────────────────────────────────────────

export function KpiKartu({ nada, label, nilai, ket, tanggal, info, metrik, onClick, penanda }) {
  const kontrak = useKontrak();
  const m = metrik ? kontrak?.peta.get(metrik) : null;
  return (
    <div
      role="button" tabIndex={0} className={`fin-kpi fin-kpi-${nada}`} aria-label={`${label}: ${nilai}. ${ket}. ${tanggal}. Buka rincian`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(e); } }}
    >
      <div className="fin-kpi-label">
        <span>{label}</span>
        {(m || info) && <InfoTooltip text={m ? <IsiDefinisi m={m} /> : info} lebar={304} />}
      </div>
      <p className="fin-kpi-nilai">{nilai}</p>
      {penanda && <p className="fin-kpi-penanda">{penanda}</p>}
      <p className="fin-kpi-ket">{ket}</p>
      <p className="fin-kpi-tanggal">{tanggal}</p>
    </div>
  );
}

// ─── 5. Perlu dibereskan ────────────────────────────────────────────────────

export function PerluDibereskan({ kualitas, navigate }) {
  const baris = susunPerluDibereskan(kualitas);
  return (
    <section className="fin-panel" aria-labelledby="fin-perlu-judul" data-testid="panel-perlu-dibereskan">
      <header className="fin-panel-kepala">
        <h2 id="fin-perlu-judul" className="fin-panel-judul">Perlu dibereskan</h2>
        <p className="fin-panel-sub">Setiap baris dihitung sendiri-sendiri dan bisa saling tumpang tindih, jadi tidak dijumlahkan.</p>
      </header>
      <ul className="fin-perlu" aria-label="Hal yang perlu dibereskan">
        {baris.map((b) => {
          const tanpa = b.status === "tanpa-data";
          const bersih = b.status === "bersih";
          return (
            <li key={b.id} className={`fin-perlu-baris fin-perlu-${b.status}`}>
              <div className="fin-perlu-isi">
                <p className="fin-perlu-label">{b.label}</p>
                <p className="fin-perlu-ket">
                  {tanpa ? "Data tidak dapat dimuat" : bersih ? "Tidak ada" : b.detailRupiah ? b.detailRupiah.map((d) => `${d.label}: ${formatUang(d.nilai)}`).join(" · ") : b.keterangan}
                </p>
                {!tanpa && !bersih && b.detailRupiah && <p className="fin-perlu-ket">Positif = saldo pembukuan lebih tinggi dari saldo terkonfirmasi (per tanggal acuan).</p>}
                {!tanpa && !bersih && !b.detailRupiah && b.nilai ? <p className="fin-perlu-ket">Senilai {formatUang(b.nilai)}</p> : null}
              </div>
              <p className="fin-perlu-jumlah">
                {tanpa ? <span className="fin-redup">{TANPA_DATA}</span>
                  : bersih ? <span className="fin-ok"><CheckCircle2 size={15} aria-hidden="true" /> Aman</span>
                    : <span className={b.id === "selisih_rekening" ? "fin-galat" : "fin-perhatian"}>{angkaId(b.jumlah)} {b.satuanJumlah}</span>}
              </p>
              <Button variant="tertiary" size="sm" className="fin-perlu-aksi" onClick={() => navigate(b.tujuan)} aria-label={`Lihat rincian: ${b.label}`}>
                Lihat rincian <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── 6. Saldo rekening ──────────────────────────────────────────────────────

export function LogoBank({ r }) {
  const { jenis, namaBank } = jenisRekening(r);
  if (jenis === "BCA") return <span className="fin-logo fin-logo-merek"><img src={logoBca} alt="" loading="lazy" decoding="async" /></span>;
  if (jenis === "MANDIRI") return <span className="fin-logo fin-logo-merek"><img src={logoMandiri} alt="" loading="lazy" decoding="async" /></span>;
  if (jenis === "TUNAI" || jenis === "EWALLET") return <span className="fin-logo fin-logo-ikon" data-jenis={jenis}><Wallet size={20} aria-hidden="true" /></span>;
  return <span className="fin-logo fin-logo-ikon" data-jenis="BANK_LAIN" data-bank={namaBank || ""}><Landmark size={20} aria-hidden="true" /></span>;
}

function BarisRekening({ r, x, riil, posisi, navigate }) {
  const [buka, setBuka] = useState(false);
  const bahan = bahanBarisRekening(r, x, riil);
  const idRincian = `fin-rek-${r.id}`;
  const { terkonfirmasi: tk, status } = bahan;
  return (
    <>
      <tr className="fin-rek-baris" data-testid="baris-rekening">
        <td>
          <div className="fin-rek-identitas">
            <LogoBank r={r} />
            <span className="fin-rek-nama">
              <span className="fin-rek-judul">{r.name}</span>
              <span className="fin-rek-sekunder">{keteranganRekening(r)}</span>
            </span>
          </div>
        </td>
        <td data-label="Saldo pembukuan" className="fin-rek-angka">
          <span className="fin-rek-isi">
            <Uang value={r.saldo} className="fin-rek-uang" />
            <span className="fin-rek-sekunder">Per {tanggalPendek(posisi)}</span>
          </span>
        </td>
        <td data-label="Saldo terkonfirmasi" className="fin-rek-angka">
          <span className="fin-rek-isi">
            {tk.keadaan === "ada"
              ? <Uang value={tk.nilai} className="fin-rek-uang" />
              : <span className="fin-redup fin-rek-belum">{tk.keadaan === "belum" ? "Belum dikonfirmasi" : TANPA_DATA}</span>}
            <span className="fin-rek-sekunder">{tk.keterangan}</span>
          </span>
        </td>
        <td data-label="Rincian" className="fin-rek-rincian">
          {bahan.perluTindakan && <span className="fin-chip fin-chip-red">Ada selisih</span>}
          {!!bahan.danaBelumDikenal && <span className="fin-chip fin-chip-perhatian">Sumber dana belum diketahui</span>}
          <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={idRincian}>Rincian</Pembuka>
        </td>
      </tr>
      {buka && (
        <tr className="fin-rek-detail" id={idRincian}>
          <td colSpan={4}>
            <div className="fin-detail">
              <p className="fin-detail-status">
                <b>{ISTILAH.pencocokanSaldo.tampil}:</b>{" "}
                {status ? <span className={`fin-chip fin-chip-${status.tone}`}>{status.label}{bahan.tanggalAcuan && x?.status === "SESUAI" ? ` per ${bahan.tanggalAcuan}` : ""}</span> : <span className="fin-redup">—</span>}
              </p>
              <dl className="fin-detail-daftar">
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
          </td>
        </tr>
      )}
    </>
  );
}

export function SaldoRekening({ data, riil, posisi, navigate }) {
  const [penjelasanDana, setPenjelasanDana] = useState(false);
  const petaRiil = new Map((riil?.rekening ?? []).map((r) => [r.id, r]));
  const dana = riil?.danaBelumTeridentifikasi;
  return (
    <section className="fin-panel" aria-labelledby="fin-rek-judul" data-testid="panel-saldo-rekening">
      <header className="fin-panel-kepala">
        <h2 id="fin-rek-judul" className="fin-panel-judul">
          Saldo rekening
          <InfoTooltip lebar={304} text={<>Saldo pembukuan dihitung dari jurnal. Saldo terkonfirmasi adalah konfirmasi pemilik (bukan rekening koran). Pencocokan dilakukan pada tanggal acuan yang sama, jadi transaksi setelah tanggal acuan tidak memengaruhi selisih. <i>Istilah asli: {ISTILAH.pencocokanSaldo.asli}, {ISTILAH.tanggalAcuan.asli.toLowerCase()}.</i></>} />
        </h2>
        <p className="fin-panel-sub">
          {riil ? <>Saldo terkonfirmasi per {riil.cutoffLabel} (tanggal acuan {tanggalPendek(riil.tanggalBuku)}).</> : "Data saldo terkonfirmasi tidak dapat dimuat."}
        </p>
      </header>
      {data.kasBank.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada rekening" description="Daftarkan kas & rekening bank supaya uang masuk/keluar punya tempat."
          action={<Button size="sm" onClick={() => navigate("/finance/cash")}>Tambah Rekening</Button>} />
      ) : (
        <div className="fin-tabel-gulir" tabIndex={0} role="region" aria-label="Tabel saldo rekening">
          <table className="fin-tabel" data-testid="tabel-kas-bank">
            <thead>
              <tr><th scope="col">Rekening</th><th scope="col" className="fin-kanan">Saldo pembukuan</th><th scope="col" className="fin-kanan">Saldo terkonfirmasi</th><th scope="col" className="fin-kanan">Rincian</th></tr>
            </thead>
            <tbody>
              {data.kasBank.map((r) => <BarisRekening key={r.id} r={r} x={petaRiil.get(r.id)} riil={riil} posisi={posisi} navigate={navigate} />)}
            </tbody>
          </table>
        </div>
      )}
      {!!dana?.total && (
        <div className="fin-dana" role="note" data-testid="strip-dana-belum-diketahui">
          <div className="fin-dana-baris">
            <AlertTriangle size={16} aria-hidden="true" className="fin-dana-ikon" />
            <p className="fin-dana-teks"><b>{ISTILAH.sumberDanaBelumDiketahui.tampil}: {formatUang(dana.total)}.</b> Dana ini belum dihitung sebagai pendapatan.</p>
            <Pembuka buka={penjelasanDana} onToggle={() => setPenjelasanDana((v) => !v)} id="fin-dana-rincian" className="fin-dana-aksi">Lihat penjelasan</Pembuka>
          </div>
          {penjelasanDana && (
            <div id="fin-dana-rincian" className="fin-dana-rincian">
              {dana.peringatan && <p>{dana.peringatan}</p>}
              <p>{KALIMAT.danaBelumDiketahui}</p>
              <p className="fin-asli">Istilah asli sistem: {ISTILAH.sumberDanaBelumDiketahui.asli}.</p>
            </div>
          )}
        </div>
      )}
      <p className="fin-catatan-kaki">
        {KALIMAT.penjelasanPencocokan}{riil ? <> Sumber saldo terkonfirmasi: {riil.sumber.toLowerCase()}.</> : null}{" "}
        <span className="fin-asli" title={LABEL_REKONSILIASI}>Istilah asli: {ISTILAH.pencocokanSaldo.asli}.</span>
      </p>
      <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/reconciliation")}>Buka {ISTILAH.pencocokanSaldo.tampil.toLowerCase()} <ArrowRight size={14} aria-hidden="true" /></Button>
    </section>
  );
}

// ─── 7. Laba rugi sementara ─────────────────────────────────────────────────

function BarisLR({ label, children, sub, akhir }) {
  return (
    <div className={`fin-lr-baris${sub ? " fin-lr-sub" : ""}${akhir ? " fin-lr-akhir" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function LabaRugiPanel({ lr, penanda, marginInfo, navigate }) {
  const [penjelasan, setPenjelasan] = useState(false);
  const pembalik = ringkasPembalik(lr);
  const pen = penandaDari({ penanda });
  // Label utama bahasa sederhana; istilah akuntansi asli (dan penjelasan server) tetap ada di tooltip & rincian.
  const penLabel = { ...pen, pembalikBebanBersih: { label: ISTILAH.penyesuaianPengurangBiaya.tampil, penjelasan: `${pen.pembalikBebanBersih.label}: ${pen.pembalikBebanBersih.penjelasan}` } };
  return (
    <section className="fin-panel" aria-labelledby="fin-lr-judul" data-testid="panel-laba-rugi">
      <header className="fin-panel-kepala">
        <h2 id="fin-lr-judul" className="fin-panel-judul">
          Laba rugi sementara
          <InfoTooltip lebar={304} text="Kenapa DP tidak langsung dihitung untung: uang yang masuk sebelum barang/jasa diserahkan masih bisa direfund atau order-nya batal. Angka ini sementara karena masih ada order selesai yang pendapatannya belum dibukukan." />
        </h2>
        <p className="fin-panel-sub">Dari jurnal yang sudah dibukukan. Pendapatan diakui saat order diserahterimakan.</p>
      </header>
      <dl className="fin-lr">
        <BarisLR label="Pendapatan tercatat"><Uang value={lr?.pendapatanBruto ?? 0} /></BarisLR>
        <BarisLR label="Retur & potongan"><Uang value={-(Number(lr?.retur) || 0)} /></BarisLR>
        <BarisLR label="Pendapatan bersih" sub><Uang value={lr?.pendapatanBersih ?? 0} /></BarisLR>
        <BarisLR label="Biaya pokok (HPP)"><UangBiaya value={lr?.bebanPokok ?? 0} penanda={penLabel} /></BarisLR>
        <BarisLR label="Laba kotor" sub><Uang value={lr?.labaKotor ?? 0} /></BarisLR>
        <BarisLR label="Biaya operasional"><UangBiaya value={lr?.bebanOperasional ?? 0} penanda={penLabel} /></BarisLR>
        <BarisLR label="Laba sementara" akhir><Uang value={lr?.labaBersih ?? 0} /></BarisLR>
      </dl>
      {pembalik.ada && (
        <div className="fin-lr-catatan" data-testid="catatan-penyesuaian-biaya">
          <div className="fin-lr-catatan-baris">
            <p><b>{KALIMAT.penyesuaianBiaya}</b></p>
            <Pembuka buka={penjelasan} onToggle={() => setPenjelasan((v) => !v)} id="fin-lr-penjelasan" className="fin-lr-aksi">Lihat penjelasan</Pembuka>
          </div>
          {penjelasan && (
            <div id="fin-lr-penjelasan">
              <KotakPembalik penanda={pen} ada testid="kotak-pembalik-dashboard" />
              <p className="fin-asli">Istilah asli: {ISTILAH.penyesuaianPengurangBiaya.asli}.</p>
            </div>
          )}
        </div>
      )}
      <p className="fin-catatan-kaki" data-testid="catatan-margin">
        {marginInfo?.tampil
          ? <>Margin bersih {marginInfo.nilai.toFixed(1)}%.</>
          : <>{marginInfo?.alasan ?? "Margin tidak ditampilkan"}. Margin baru ditampilkan setelah data pendapatan lengkap.</>}
      </p>
      <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/reports")}>Lihat laporan lengkap <ArrowRight size={14} aria-hidden="true" /></Button>
    </section>
  );
}
