import React, { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Foto, PeriodePicker, formatUang, tanggalJam } from "@/features/finance/shared.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import { keteranganRekening } from "@/features/finance/ringkasanTampilan.js";
import { useKontrak, IsiDefinisi } from "@/features/finance/kontrakData.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { Pilih } from "@/features/finance/pemasukan/DaftarPemasukan.jsx";
import {
  LABEL_CARA_BAYAR, LABEL_JENIS, alasanBatal, daftarBukti, daftarTerpotong, jumlahFilterLanjutan, opsiRekening, relasiVersi, statusPembayaran, tidakDihitung,
} from "./verifikasiLogic.js";

// DAFTAR PEMBAYARAN (satu panel: angka periode + toolbar + hasil + tabel/kartu). Data & saringan = yang SUDAH ada: server memuat per periode/status
// (GET /finance/customer-payments), pencarian & chip disaring di layar oleh saringPembayaran (fungsi murni yang dibuktikan identik dengan Export Excel).
// Halaman ini hanya menata. Klik baris/kartu MEMBUKA panel pemeriksaan; tidak pernah memverifikasi sendiri.

/** Definisi metrik dari kontrak server (bila ada) di samping label. */
function InfoMetrik({ kunci, tambahan }) {
  const kontrak = useKontrak();
  const m = kontrak?.peta.get(kunci);
  if (!m && !tambahan) return null;
  return <InfoTooltip lebar={304} text={<>{m && <IsiDefinisi m={m} />}{tambahan && <span className="block" style={m ? { marginTop: 8 } : undefined}>{tambahan}</span>}</>} />;
}

function Rekening({ p, akunPerId }) {
  const akun = p.cashAccount ? akunPerId.get(p.cashAccount.id) ?? null : null;
  if (!p.cashAccount) {
    return (
      <div className="fin-vf-rek-kosong" title="Rekening tidak dipilih saat pembayaran dicatat, jadi sistem memakai rekening standar untuk cara bayar ini.">
        <span className="fin-pm-nama">Belum dipilih</span>
        <span className="fin-pm-rek-ket">Memakai rekening standar cara bayar</span>
      </div>
    );
  }
  return (
    <div className="fin-pm-rek">
      <LogoBank r={akun ?? { kind: "BANK", bankName: null }} />
      <span className="fin-pm-rek-teks">
        <span className="fin-pm-rek-nama">{p.cashAccount.name}</span>
        {akun && <span className="fin-pm-rek-ket">{keteranganRekening(akun)}</span>}
      </span>
    </div>
  );
}

/** Bukti terunggah di baris: maksimal dua gambar mini + "+N". Membuka panel pemeriksaan (bukan jendela foto terpisah). */
function BuktiSel({ p, onPeriksa }) {
  const urls = daftarBukti(p);
  if (urls.length === 0) return <span className="fin-vf-tanpa-bukti" data-testid="bukti-kosong">Belum ada bukti</span>;
  const tampil = urls.slice(0, 2);
  const sisa = urls.length - tampil.length;
  return (
    <span className="fin-vf-bukti-sel">
      {tampil.map((u, i) => (
        <button key={u} type="button" className="fin-vf-mini-bukti" aria-label={`Periksa bukti pembayaran ${p.order?.orderNumber || ""}, ${urls.length} foto`} onClick={() => onPeriksa(p)} data-testid="bukti-mini" data-urutan={i}>
          <Foto url={u} alt="" className="fin-vf-mini-gambar" />
        </button>
      ))}
      {sisa > 0 && <button type="button" className="fin-vf-sisa-bukti" aria-label={`${sisa} foto lainnya, periksa bukti`} onClick={() => onPeriksa(p)}>+{sisa}</button>}
    </span>
  );
}

function StatusSel({ p, penanda }) {
  const st = statusPembayaran(p);
  return (
    <div className="fin-pm-status">
      <span className={`fin-chip fin-chip-${st.nada}`} data-testid="status-pembayaran" data-kode={st.kode}>{st.label}</span>
      {p.jenisPembayaran && !p.cancelledAt && <span className={`fin-chip fin-chip-${p.jenisPembayaran === "PELUNASAN" ? "green" : "neutral"}`}>{LABEL_JENIS[p.jenisPembayaran]}</span>}
      {penanda}
      {p.terverifikasi && !p.cancelledAt && <span className="fin-pm-subcatatan">oleh {p.verifications?.[0]?.verifiedBy?.name || "—"}</span>}
    </div>
  );
}

function Pelanggan({ p }) {
  const bagi = p.finAllocations?.length ?? 0;
  return (
    <div className="fin-pm-pihak">
      <span className="fin-pm-nama">{p.order?.customer?.name || "—"}</span>
      <span className="fin-pm-nomor">{p.order?.orderNumber || "—"}</span>
      <span className="fin-vf-meta">
        {LABEL_CARA_BAYAR[p.method] || p.method}{p.recordedBy?.name ? ` · dicatat ${p.recordedBy.name}` : ""}{bagi > 0 ? ` · dibagi ke ${bagi} order` : ""}
      </span>
    </div>
  );
}

function PenandaTidakDihitung({ terbuka, onToggle, idAlasan }) {
  return (
    <button type="button" className="fin-pm-tdh" aria-expanded={terbuka} aria-controls={idAlasan} onClick={onToggle} data-testid="penanda-tidak-dihitung">
      Tidak dihitung<span className="fin-sr-saja">, lihat alasan</span>
      {terbuka ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
    </button>
  );
}

/** Alasan batal/ganti + pembayaran pengganti (jika ada di daftar). Nominal asli tetap terlihat; di sini hanya menjelaskan kenapa tidak dihitung. */
function PanelAlasan({ p, semua, id }) {
  const st = statusPembayaran(p);
  const a = alasanBatal(p);
  const r = relasiVersi(p, semua);
  return (
    <div id={id} className="fin-pm-alasan" role="note" aria-label={`Alasan tidak dihitung, ${p.order?.orderNumber || "pembayaran"}`} data-testid="alasan-tidak-dihitung">
      <p className="fin-pm-alasan-judul">{st.kode === "DIGANTI" ? "Alasan: diganti versi baru" : "Alasan dibatalkan"}</p>
      <p className="fin-pm-alasan-teks">{a?.alasan || "Alasan tidak dicatat."}</p>
      {(a?.oleh || a?.pada) && <p className="fin-pm-alasan-angka">{a.oleh ? `Oleh ${a.oleh}` : ""}{a.oleh && a.pada ? " · " : ""}{a.pada ? tanggalJam(a.pada) : ""}</p>}
      {(r.penggantiId || r.pengganti) && (
        <div className="fin-pm-pengganti">
          <p className="fin-pm-alasan-sub">Pembayaran pengganti</p>
          {r.pengganti ? (
            <ul><li>
              <span className="fin-pm-nomor">{r.pengganti.order?.orderNumber || "—"}</span>
              <span>{tanggalJam(r.pengganti.createdAt)}</span>
              <span className="fin-pm-rp">{formatUang(r.pengganti.amount)}</span>
              <span className={`fin-chip fin-chip-${statusPembayaran(r.pengganti).nada}`}>{statusPembayaran(r.pengganti).label}</span>
            </li></ul>
          ) : <p className="fin-pm-alasan-teks">Versi pengganti sudah tercatat, tetapi tidak ada di periode yang dimuat. Buka Riwayat Perubahan untuk melihatnya.</p>}
        </div>
      )}
      <p className="fin-pm-alasan-angka">Nominal tercatat <strong>{formatUang(p.amount)}</strong> · masuk total <strong>{formatUang(0)}</strong></p>
    </div>
  );
}

export default function DaftarPembayaran({
  antrean, periode, onPeriode, payments, semuaDimuat, tampil, filter, onFilter, onReset, akun, aksiBaris, onPeriksa, angka, memuat, galat, onCoba,
}) {
  const [lanjut, setLanjut] = useState(false);
  const [bukaAlasan, setBukaAlasan] = useState(() => new Set());
  const idDasar = useId();
  const idAlasan = (p) => `${idDasar}-alasan-${p.id}`;
  const alih = (p) => setBukaAlasan((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; });
  const akunPerId = useMemo(() => new Map((akun ?? []).map((a) => [a.id, a])), [akun]);
  const opsiMetode = useMemo(() => [...new Set(payments.map((p) => p.method).filter(Boolean))].sort().map((m) => [m, LABEL_CARA_BAYAR[m] || m]), [payments]);
  const opsiRek = useMemo(() => opsiRekening(payments), [payments]);
  const nLanjut = jumlahFilterLanjutan(filter);
  const disaring = !!filter.q || !!filter.metode || !!filter.verif || !!filter.alokasi || !!filter.bukti || !!filter.rekening;
  const terpotong = daftarTerpotong(payments.length);

  const bukaBaris = (e, p) => {
    if (e.target.closest("button, a, input, select, label, summary")) return;
    if (typeof window !== "undefined" && String(window.getSelection?.() ?? "").length > 0) return;
    onPeriksa(p);
  };
  const tombolBaris = (e, p) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPeriksa(p); } };
  const penanda = (p) => (tidakDihitung(p) ? <PenandaTidakDihitung terbuka={bukaAlasan.has(p.id)} onToggle={() => alih(p)} idAlasan={idAlasan(p)} /> : null);
  const nominal = (p) => (
    <span className="fin-pm-nilai-sel">
      <span className={`fin-pm-rp${tidakDihitung(p) ? " fin-vf-rp-asli" : ""}`} data-testid="nominal-pembayaran">{formatUang(p.amount)}</span>
      {tidakDihitung(p) && <span className="fin-pm-rp-sub" data-testid="nilai-dihitung">Dihitung {formatUang(0)}</span>}
    </span>
  );
  const aksi = (p) => { const a = aksiBaris(p); return <RowActions primary={a.primary} items={a.items} />; };

  return (
    <section className="fin-panel fin-pm-daftar" data-testid="daftar-pembayaran" aria-busy={memuat} aria-label={`Daftar ${antrean.judul}`}>
      <div className="fin-panel-kepala">
        <div className="fin-pm-kepala-baris">
          <h2 className="fin-panel-judul">{antrean.id === "perlu" ? "Pembayaran menunggu verifikasi" : antrean.judul}</h2>
        </div>
        <p className="fin-panel-sub">
          {antrean.id === "perlu" ? "Sudah tercatat oleh Sales atau driver, belum diperiksa Finance. Semua periode." : antrean.ringkas}
        </p>
      </div>

      <dl className="fin-pm-stat" data-testid="angka-periode">
        <div>
          <dt>Pembayaran tercatat <span className="fin-redup">· periode {periode.label}</span><InfoMetrik kunci="payment_tercatat" tambahan={`Jumlah semua pembayaran pelanggan di periode yang dipilih (${angka.aktif} pembayaran; yang dibatalkan tidak dihitung), dipisah antara yang sudah dan yang masih menunggu verifikasi.`} /></dt>
          <dd><strong data-testid="angka-tercatat">{formatUang(angka.total)}</strong> <span className="fin-redup">{angka.aktif} pembayaran</span></dd>
        </div>
        <div>
          <dt>Terverifikasi <span className="fin-redup">· periode {periode.label}</span><InfoMetrik kunci="uang_masuk_terverifikasi" tambahan="Sudah dicek dan uangnya memang masuk. Status Lunas order tetap diatur dari CRM." /></dt>
          <dd><strong data-testid="angka-terverifikasi">{formatUang(angka.sudah)}</strong> <span className="fin-redup">{angka.sudahJumlah} pembayaran</span></dd>
        </div>
        <div>
          <dt>Menunggu verifikasi <span className="fin-redup">· periode {periode.label}</span><InfoTooltip lebar={304} text="Pembayaran yang sudah dicatat sales atau driver, tapi belum ada yang memastikan uangnya benar-benar masuk ke rekening atau kas perusahaan." /></dt>
          <dd><strong data-testid="angka-menunggu">{formatUang(angka.belum)}</strong> <span className="fin-redup">{angka.belumJumlah} pembayaran</span></dd>
        </div>
      </dl>
      <p className="fin-pm-bantu">Tiga angka ini mengikuti periode, bukan pencarian atau filter di bawah.{daftarTerpotong(semuaDimuat) && " Dihitung dari 300 pembayaran terbaru yang dimuat server; persempit periode bila perlu."}</p>

      <div className="fin-pm-toolbar" role="search">
        <label className="fin-pm-cari">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={filter.q} onChange={(e) => onFilter("q", e.target.value)} placeholder="Cari order, pelanggan, nominal…" aria-label="Cari order, pelanggan, pencatat, atau nominal" enterKeyHint="search" autoComplete="off" />
          {filter.q && <button type="button" className="fin-pm-hapus" onClick={() => onFilter("q", "")} aria-label="Hapus pencarian"><X size={14} aria-hidden="true" /></button>}
        </label>
        {antrean.semuaPeriode
          ? <span className="fin-vf-cakupan" data-testid="cakupan-semua-periode" title="Antrean pekerjaan: pembayaran yang menunggu dari periode mana pun, bukan hanya bulan terpilih.">Semua periode</span>
          : <PeriodePicker from={periode.from} to={periode.to} onChange={onPeriode} className="fin-vf-periode" />}
        <div className="fin-pm-filter">
          <Pilih label="Rekening tujuan" value={filter.rekening} onChange={(v) => onFilter("rekening", v)} options={opsiRek} />
          <Pilih label="Cara bayar" value={filter.metode} onChange={(v) => onFilter("metode", v)} options={opsiMetode} />
          <Pilih label="Status" value={filter.verif} onChange={(v) => onFilter("verif", v)} options={[["terverifikasi", "Terverifikasi"], ["belum", "Menunggu verifikasi"], ["dibatalkan", "Dibatalkan"]]} />
          <button type="button" className="fin-pm-lanjut" aria-expanded={lanjut} aria-controls="fin-vf-lanjut-isi" onClick={() => setLanjut((v) => !v)} data-aktif={nLanjut > 0 ? "1" : "0"}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filter lainnya{nLanjut > 0 && <span className="fin-pm-hitung" aria-label={`${nLanjut} filter aktif`}>{nLanjut}</span>}
            {lanjut ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {lanjut && (
        <div id="fin-vf-lanjut-isi" className="fin-pm-lanjut-isi fin-vf-lanjut">
          <div className="fin-vf-lanjut-pilih">
            <Pilih label="Dibagi ke order lain" value={filter.alokasi} onChange={(v) => onFilter("alokasi", v)} options={[["ada", "Ya, dibagi"], ["tanpa", "Tidak dibagi"]]} />
            <Pilih label="Foto bukti" value={filter.bukti} onChange={(v) => onFilter("bukti", v)} options={[["ada", "Ada foto"], ["tanpa", "Tanpa foto"]]} />
          </div>
          <p className="fin-pm-bantu">Filter foto bukti memeriksa ada tidaknya unggahan, bukan keaslian atau kecocokan buktinya.</p>
        </div>
      )}

      <div className="fin-pm-hasil">
        <span data-testid="hasil-ringkas">
          {disaring ? <><strong>{tampil.length}</strong> dari {payments.length} pembayaran</> : <><strong>{payments.length}</strong> pembayaran</>}
          {antrean.id === "perlu" && <span className="fin-vf-redup"> · menunggu verifikasi</span>}
        </span>
        {disaring && <button type="button" className="fin-pm-reset" onClick={onReset}>Atur ulang filter</button>}
      </div>
      {terpotong && <p className="fin-catatan-kaki" data-testid="catatan-terpotong">Server mengirim paling banyak 300 pembayaran terbaru. Persempit periode bila yang dicari tidak muncul.</p>}
      {galat && <p className="fin-galat fin-pm-galat" role="alert">Gagal memuat: {galat} <button type="button" className="fin-pm-reset" onClick={onCoba}>Coba lagi</button></p>}

      {/* Tabel (panel lebar) */}
      <div className="fin-pm-tabel-bungkus fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel pembayaran; gulir mendatar bila perlu">
        <table className="fin-pm-tabel fin-vf-tabel" data-jenis="pembayaran-verifikasi">
          <thead>
            <tr>
              <th scope="col">Pelanggan / Order</th><th scope="col">Tanggal</th><th scope="col" className="fin-pm-kanan">Nominal</th>
              <th scope="col">Rekening tujuan</th><th scope="col">Bukti</th><th scope="col">Status</th><th scope="col">Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {memuat && !galat && tampil.length === 0 && <tr><td colSpan={7} className="fin-pm-kosong">Memuat…</td></tr>}
            {!memuat && tampil.length === 0 && (
              <tr><td colSpan={7} className="fin-pm-kosong" data-testid="daftar-kosong">{disaring ? "Tidak ada pembayaran yang cocok dengan pencarian atau filter ini." : "Tidak ada pembayaran pada tampilan ini."}</td></tr>
            )}
            {tampil.map((p) => (
              <React.Fragment key={p.id}>
                <tr className="fin-pm-baris" tabIndex={0} onClick={(e) => bukaBaris(e, p)} onKeyDown={(e) => tombolBaris(e, p)} data-testid="baris-pembayaran" data-hitung={tidakDihitung(p) ? "tidak" : "ya"} data-status={statusPembayaran(p).kode}>
                  <td><Pelanggan p={p} /></td>
                  <td><span className="fin-pm-tgl">{tanggalJam(p.createdAt)}</span></td>
                  <td className="fin-pm-kanan">{nominal(p)}</td>
                  <td><Rekening p={p} akunPerId={akunPerId} /></td>
                  <td><BuktiSel p={p} onPeriksa={onPeriksa} /></td>
                  <td><StatusSel p={p} penanda={penanda(p)} /></td>
                  <td className="fin-pm-aksi">{aksi(p)}</td>
                </tr>
                {tidakDihitung(p) && bukaAlasan.has(p.id) && (
                  <tr className="fin-pm-baris-alasan"><td colSpan={7}><PanelAlasan p={p} semua={semuaDimuat} id={idAlasan(p)} /></td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kartu (panel sempit / HP): identitas, nominal, status, bukti, tindakan */}
      <ul className="fin-pm-kartu-daftar" aria-label={`Daftar ${antrean.judul} (tampilan kartu)`}>
        {memuat && !galat && tampil.length === 0 && <li className="fin-pm-kosong">Memuat…</li>}
        {!memuat && tampil.length === 0 && <li className="fin-pm-kosong">{disaring ? "Tidak ada pembayaran yang cocok dengan pencarian atau filter ini." : "Tidak ada pembayaran pada tampilan ini."}</li>}
        {tampil.map((p) => (
          <li key={p.id} className="fin-pm-kartu fin-vf-kartu fin-vf-kartu-klik" onClick={(e) => bukaBaris(e, p)} data-testid="kartu-pembayaran" data-hitung={tidakDihitung(p) ? "tidak" : "ya"} data-status={statusPembayaran(p).kode}>
            <div className="fin-pm-kartu-atas">
              <span className="fin-pm-tgl">{tanggalJam(p.createdAt)}</span>
              {nominal(p)}
            </div>
            <Pelanggan p={p} />
            <dl className="fin-pm-kartu-isi">
              <div><dt>Status</dt><dd><StatusSel p={p} penanda={penanda(p)} /></dd></div>
              <div><dt>Rekening tujuan</dt><dd><Rekening p={p} akunPerId={akunPerId} /></dd></div>
              <div><dt>Bukti</dt><dd><BuktiSel p={p} onPeriksa={onPeriksa} /></dd></div>
            </dl>
            {tidakDihitung(p) && bukaAlasan.has(p.id) && <PanelAlasan p={p} semua={semuaDimuat} id={idAlasan(p)} />}
            <div className="fin-vf-kartu-aksi">{aksi(p)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

