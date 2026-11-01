import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, SlidersHorizontal, X } from "lucide-react";
import { api } from "@/api.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { tanggalPendek } from "@/features/finance/shared.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import { keteranganRekening } from "@/features/finance/ringkasanTampilan.js";
import { PENJELASAN_TIDAK_DIHITUNG, adaKontrakHitung, akunDariNama, cakupanTotal, jumlahFilterLanjutan, kelasNada, keadaanHasil, nomorHalaman, rentangBaris, susunAlasan, teksRp, teksTidakDihitung, tidakDihitung } from "./pemasukanLogic.js";

// DAFTAR PEMASUKAN TERKLASIFIKASI (satu panel: toolbar + hasil + tabel/kartu + halaman). Sumber SATU: GET /api/finance/pemasukan (server memfilter, mengurutkan, dan
// memotong halaman); Export Excel mengirim filter yang SAMA. Halaman ini hanya menata. Tidak ada tindakan baru (tanpa verifikasi/persetujuan/posting).
//   • "Cari" (q) mencari di nomor, pelanggan, keterangan, rekening, dan nominal (semua kata harus cocok).
//   • "Nama pelanggan/pembayar" (pihak) = filter TERPISAH yang hanya mencocokkan nama (potongan teks) — fungsinya berbeda, maka disimpan sebagai filter lanjutan.

const LIMIT = 25;

const Rp = ({ v }) => <span className={`fin-pm-rp ${String(v).startsWith("-") ? "fin-pm-rp-min" : ""}`}>{teksRp(v)}</span>;
const Chip = ({ nada, children, ...p }) => <span className={`fin-chip fin-chip-${kelasNada(nada)}`} {...p}>{children}</span>;

function Rekening({ nama, akun }) {
  if (!nama) return <span className="fin-redup">—</span>;
  return (
    <div className="fin-pm-rek">
      <LogoBank r={akun ?? { kind: "BANK", bankName: null }} />
      <span className="fin-pm-rek-teks">
        <span className="fin-pm-rek-nama">{nama}</span>
        {akun && <span className="fin-pm-rek-ket">{keteranganRekening(akun)}</span>}
      </span>
    </div>
  );
}

// Kolom per jenis daftar. Pendapatan berasal dari jurnal pengakuan (tanpa rekening) → status PEMBAYARAN; kategori lain memakai rekening + status catatan.
function kolomUntuk(pendapatan, pembayaran) {
  if (pendapatan) return ["tanggal", "pihak", "keterangan", "statusBayar", "nilai", "rincian"];
  if (pembayaran) return ["tanggal", "pihak", "rekening", "nilai", "status", "rincian"];
  return ["tanggal", "pihak", "keterangan", "rekening", "nilai", "status", "rincian"];
}
const JUDUL_KOLOM = {
  tanggal: "Tanggal", pihak: null, keterangan: "Keterangan", statusBayar: "Status pembayaran", rekening: "Rekening", nilai: "Nilai", status: "Status", rincian: "Rincian",
};

/** Penanda netral "Tidak dihitung": tombol pembuka alasan (klik/tap/Enter/Spasi). Bukan galat — barisnya sah dan tetap bisa ditelusuri. */
function PenandaTidakDihitung({ b, terbuka, onToggle, idAlasan }) {
  if (!tidakDihitung(b)) return null;
  return (
    <button type="button" className="fin-pm-tdh" aria-expanded={terbuka} aria-controls={idAlasan} onClick={onToggle} data-testid="penanda-tidak-dihitung">
      Tidak dihitung<span className="fin-sr-saja">, lihat alasan</span>
      {terbuka ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
    </button>
  );
}

/** Isi alasan pengecualian. Teks utama = persis alasan server (sama dengan kolom Excel "Alasan Tidak Dihitung"); pengganti & alasan batal bila tersedia. */
function PanelAlasan({ b, id }) {
  const a = susunAlasan(b);
  if (!a) return null;
  return (
    <div id={id} className="fin-pm-alasan" role="note" aria-label={`Alasan tidak dihitung, ${b.nomor}`} data-testid="alasan-tidak-dihitung">
      <p className="fin-pm-alasan-judul">Alasan tidak dihitung</p>
      <p className="fin-pm-alasan-teks">{a.teks}</p>
      {a.alasanBatal && <p className="fin-pm-alasan-teks">Alasan pembatalan: {a.alasanBatal}</p>}
      {a.pengganti && (
        <div className="fin-pm-pengganti">
          <p className="fin-pm-alasan-sub">Pembayaran pengganti{a.pengganti.kecocokan ? ` · ${a.pengganti.kecocokan}` : ""}</p>
          <ul>
            {a.pengganti.daftar.map((g) => (
              <li key={g.kunci}>
                <span className="fin-pm-nomor">{g.id}</span>
                {g.tanggal && <span>{tanggalPendek(g.tanggal)}</span>}
                {g.nominal !== null && <span className="fin-pm-rp">{teksRp(g.nominal)}</span>}
                <Chip nada={g.terverifikasi ? "success" : "warning"}>{g.status}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fin-pm-alasan-angka">Nominal tercatat <strong>{teksRp(a.nilaiAsli)}</strong> · masuk total <strong>{teksRp(a.nilaiDihitung)}</strong></p>
    </div>
  );
}

function Status({ b, alasan }) {
  return (
    <div className="fin-pm-status">
      <Chip nada={b.nada}>{b.statusLabel}</Chip>
      {b.perluTinjau && b.statusLabel !== "Perlu ditinjau" && <Chip nada="warning">Perlu ditinjau</Chip>}
      {alasan}
    </div>
  );
}
function StatusBayar({ b, alasan }) {
  return (
    <div className="fin-pm-status">
      {b.statusBayar ? <Chip nada={b.statusBayar.nada}>{b.statusBayar.label}</Chip> : <span className="fin-redup">—</span>}
      {b.statusBayar?.rekeningBelumDiketahui && <Chip nada="warning">Rekening belum diketahui</Chip>}
      {b.status === "REVERSED" && <Chip nada="warning">{b.statusLabel}</Chip>}
      {b.perluTinjau && <Chip nada="warning">Perlu ditinjau</Chip>}
      {alasan}
    </div>
  );
}
function Keterangan({ b }) {
  return (
    <div className="fin-pm-ket">
      <span className="fin-pm-ket-isi" title={b.keterangan}>{b.keterangan}</span>
      {(b.subLabel || b.kategoriLabel) && <span className="fin-pm-ket-sub">{b.subLabel ?? b.kategoriLabel}</span>}
    </div>
  );
}
function Pihak({ b }) {
  return (
    <div className="fin-pm-pihak">
      <span className="fin-pm-nama">{b.pihak ?? "—"}</span>
      <span className="fin-pm-nomor" title={b.sumberLabel}>{b.nomor}</span>
    </div>
  );
}

export default function DaftarPemasukan({ periode, tab, opsi, indeksRek, onBuka, judulKosong, statusAwal = "", tanpaKepala = false, ringkasanUang = null }) {
  const kategori = tab.kategori;
  const [q, setQ] = useState("");
  const [pihak, setPihak] = useState("");
  const [rekening, setRekening] = useState("");
  const [status, setStatus] = useState(statusAwal);
  const [statusBayar, setStatusBayar] = useState("");
  const [lanjut, setLanjut] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const qT = useTertunda(q);
  const pihakT = useTertunda(pihak);
  const urutan = useRef(0);
  const idDasar = useId();
  const [bukaAlasan, setBukaAlasan] = useState(() => new Set());
  const idAlasan = (b) => `${idDasar}-alasan-${b.key}`;
  const alihAlasan = (b) => setBukaAlasan((s) => { const n = new Set(s); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n; });
  const kunciPeriode = `${periode.from}|${periode.to}|${kategori}`;

  useEffect(() => { setPage(1); setBukaAlasan(new Set()); }, [periode.from, periode.to, kategori, qT, pihakT, rekening, status, statusBayar]);

  // Hanya respons permintaan TERAKHIR yang boleh mengisi layar (respons periode/filter lama yang terlambat tidak menimpa yang baru).
  const muat = useCallback(async () => {
    const saya = ++urutan.current;
    setLoading(true); setError(null);
    try {
      const h = await api.getFinancePemasukan({ from: periode.from, to: periode.to, kategori, q: qT, pihak: pihakT, rekening, status, statusBayar, page, limit: LIMIT });
      if (saya === urutan.current) setData({ ...h, _kunci: kunciPeriode });
    } catch (e) { if (saya === urutan.current) setError(e.message || "Gagal memuat"); }
    finally { if (saya === urutan.current) setLoading(false); }
  }, [periode.from, periode.to, kategori, qT, pihakT, rekening, status, statusBayar, page, kunciPeriode]);
  useEffect(() => { muat(); }, [muat]);

  // Periode/kategori berganti: data periode lama TIDAK boleh tampil di bawah periode baru.
  const tampil = data && data._kunci === kunciPeriode ? data : null;

  const pendapatan = kategori === "PENDAPATAN";
  const pembayaran = kategori === "PEMBAYARAN";
  const statusOpsi = (opsi?.status ?? []).map((s) => [s.id, s.label]);
  const rekOpsi = (opsi?.rekening ?? []).map((r) => [r.id, r.name]);
  const statusBayarOpsi = (opsi?.statusBayar ?? []).map((s) => [s.id, s.label]);
  const kolom = kolomUntuk(pendapatan, pembayaran);
  const nLanjut = jumlahFilterLanjutan({ pihak });
  const adaFilter = !!q || !!pihak || !!rekening || status !== statusAwal || !!statusBayar;
  const reset = () => { setQ(""); setPihak(""); setRekening(""); setStatus(statusAwal); setStatusBayar(""); };
  const penjelasanKategori = opsi?.kategori?.find((k) => k.id === kategori)?.penjelasan;
  const total = tampil?.total ?? 0;
  const { dari, sampai } = rentangBaris(total, LIMIT, tampil?.page ?? 1);
  const items = tampil?.items ?? [];
  const keadaan = keadaanHasil(tampil);
  const labelTotal = adaKontrakHitung(tampil) ? "Total dihitung" : "Total nilai";
  const cakupan = cakupanTotal(kategori, status);
  const teksTdh = tampil ? teksTidakDihitung(tampil.totalTidakDihitung) : null;

  const bukaBaris = (e, b) => {
    if (e.target.closest("button, a, input, select, label")) return;
    if (typeof window !== "undefined" && String(window.getSelection?.() ?? "").length > 0) return;   // memilih/menyalin nomor tidak membuka rincian
    onBuka(b);
  };

  const penanda = (b) => <PenandaTidakDihitung b={b} terbuka={bukaAlasan.has(b.key)} onToggle={() => alihAlasan(b)} idAlasan={idAlasan(b)} />;
  const sel = (k, b) => {
    switch (k) {
      case "tanggal": return <span className="fin-pm-tgl">{tanggalPendek(b.tanggal)}</span>;
      case "pihak": return <Pihak b={b} />;
      case "keterangan": return <Keterangan b={b} />;
      case "statusBayar": return <StatusBayar b={b} alasan={penanda(b)} />;
      case "rekening": return <Rekening nama={b.rekening} akun={akunDariNama(indeksRek, b.rekening)} />;
      case "nilai": return <span className="fin-pm-nilai-sel"><Rp v={b.nilai} />{tidakDihitung(b) && <span className="fin-pm-rp-sub" data-testid="nilai-dihitung">Dihitung {teksRp(b.nilaiDihitung ?? "0.00")}</span>}</span>;
      case "status": return <Status b={b} alasan={penanda(b)} />;
      default: return <button type="button" className="fin-pm-rincian" aria-label={`Rincian ${b.nomor}`} onClick={() => onBuka(b)}>Rincian <ChevronRight size={14} aria-hidden="true" /></button>;
    }
  };
  const labelKartu = { tanggal: null, pihak: null, keterangan: "Keterangan", statusBayar: "Status pembayaran", rekening: "Rekening", nilai: "Nilai", status: "Status", rincian: null };

  return (
    <section className="fin-panel fin-pm-daftar" data-testid="daftar-pemasukan" aria-busy={loading} aria-label={`Daftar ${tab.judul}`}>
      {!tanpaKepala && (
        <div className="fin-panel-kepala">
          <div className="fin-pm-kepala-baris">
            <h2 className="fin-panel-judul">{tab.judul}</h2>
            {penjelasanKategori && <InfoTooltip text={penjelasanKategori} lebar={304} />}
          </div>
          <p className="fin-panel-sub">{tab.ringkas}</p>
        </div>
      )}

      {pembayaran && ringkasanUang && (
        <dl className="fin-pm-stat" data-testid="uang-masuk-ringkas">
          <div>
            <dt>Uang masuk terverifikasi <span className="fin-redup">· ringkasan periode</span></dt>
            <dd>{ringkasanUang.keadaan === "ada" ? <><strong>{teksRp(ringkasanUang.nilai)}</strong> <span className="fin-redup">{ringkasanUang.jumlah} pembayaran</span></> : <span className="fin-redup">{ringkasanUang.keadaan === "memuat" ? "Memuat…" : "Tidak tersedia"}</span>}</dd>
          </div>
          <div>
            <dt>Hasil daftar <InfoTooltip text={adaKontrakHitung(tampil) ? `Semua catatan pembayaran yang cocok dengan pencarian dan filter di bawah. ‘Total dihitung’ menjumlahkan semuanya kecuali yang ditolak atau dibatalkan, sehingga pembayaran yang masih menunggu verifikasi ikut terhitung dan bisa berbeda dari ‘Uang masuk terverifikasi’. ${PENJELASAN_TIDAK_DIHITUNG}` : "Semua catatan pembayaran yang cocok dengan pencarian dan filter di bawah."} lebar={304} /></dt>
            <dd>{tampil
              ? <><strong>{total.toLocaleString("id-ID")} catatan</strong> {keadaan !== "kosong" && <span className="fin-redup">{labelTotal} {teksRp(tampil.totalNilai)}{cakupan && adaKontrakHitung(tampil) ? ` · ${cakupan}` : ""}</span>}</>
              : <span className="fin-redup">Memuat…</span>}</dd>
          </div>
        </dl>
      )}

      <div className="fin-pm-toolbar" role="search">
        <label className="fin-pm-cari">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, pelanggan, keterangan, nominal…" aria-label="Cari nomor, pelanggan, keterangan, rekening, atau nominal" enterKeyHint="search" autoComplete="off" />
          {q && <button type="button" className="fin-pm-hapus" onClick={() => setQ("")} aria-label="Hapus pencarian"><X size={14} aria-hidden="true" /></button>}
        </label>
        <div className="fin-pm-filter">
          {pendapatan
            ? <Pilih label="Status pembayaran" value={statusBayar} onChange={setStatusBayar} options={statusBayarOpsi} />
            : <Pilih label="Rekening" value={rekening} onChange={setRekening} options={rekOpsi} />}
          <Pilih label="Status" value={status} onChange={setStatus} options={statusOpsi} semuaKetika={statusAwal} />
          <button type="button" className="fin-pm-lanjut" aria-expanded={lanjut} aria-controls="fin-pm-lanjut-isi" onClick={() => setLanjut((v) => !v)} data-aktif={nLanjut > 0 ? "1" : "0"}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filter lainnya{nLanjut > 0 && <span className="fin-pm-hitung" aria-label={`${nLanjut} filter aktif`}>{nLanjut}</span>}
            {lanjut ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        </div>
        {/* Export mengirim filter yang SAMA dengan yang sedang dikirim layar ke endpoint daftar (server yang memfilter). */}
        <TombolExportExcel
          modul="pemasukan"
          ambilBody={() => ({
            periode: { from: periode.from, to: periode.to },
            filter: { kategori, q: qT, pihak: pihakT, rekening, status, statusBayar },
            filterLabel: labelFilterAktif([
              ["Kategori", opsi?.kategori?.find((k) => k.id === kategori)?.label],
              ["Status", statusOpsi.find(([id]) => id === status)?.[1]],
              ["Status pembayaran", statusBayarOpsi.find(([id]) => id === statusBayar)?.[1]],
              ["Rekening", rekOpsi.find(([id]) => id === rekening)?.[1]],
              ["Pelanggan/pembayar", pihakT],
              ["Pencarian", qT],
            ]),
          })}
        />
      </div>
      {lanjut && (
        <div id="fin-pm-lanjut-isi" className="fin-pm-lanjut-isi">
          <label className="fin-pm-isian">
            <span>Nama pelanggan / pembayar</span>
            <input type="text" value={pihak} onChange={(e) => setPihak(e.target.value)} placeholder="Bagian dari nama…" aria-label="Cari pelanggan atau pembayar" autoComplete="off" />
          </label>
          <p className="fin-pm-bantu">Hanya mencocokkan nama. Pencarian di atas juga mencari nomor, keterangan, rekening, dan nominal.</p>
        </div>
      )}

      <div className="fin-pm-hasil">
        <span data-testid="hasil-ringkas">
          {!tampil ? "Memuat…" : (
            <>
              <strong>{total.toLocaleString("id-ID")}</strong> hasil
              {keadaan !== "kosong" && <> · <span data-testid="total-dihitung">{labelTotal} <strong>{teksRp(tampil.totalNilai)}</strong></span></>}
              {teksTdh && <> · <span className="fin-pm-tdh-ringkas" data-testid="total-tidak-dihitung">{teksTdh}</span></>}
              {keadaan === "semua" && <> · <span className="fin-pm-tdh-ringkas" data-testid="semua-tidak-dihitung">semua hasil tidak masuk total</span></>}
              {keadaan !== "kosong" && <InfoTooltip lebar={304} text={
                adaKontrakHitung(tampil)
                  ? `Dihitung server atas semua hasil (semua halaman) menurut pencarian dan filter, bukan hanya halaman yang tampil.${cakupan ? ` Cakupan: ${cakupan}.` : ""} ${PENJELASAN_TIDAK_DIHITUNG}`
                  : "Menjumlahkan semua hasil (semua halaman) menurut pencarian dan filter."
              } />}
            </>
          )}
        </span>
        {adaFilter && <button type="button" className="fin-pm-reset" onClick={reset}>Atur ulang filter</button>}
      </div>

      {tampil?.terpotong && <p className="fin-catatan-kaki">Data sangat besar; daftar dipotong server. Persempit periode.</p>}
      {error && (
        <p className="fin-galat fin-pm-galat" role="alert">Gagal memuat: {error} <button type="button" className="fin-pm-reset" onClick={muat}>Coba lagi</button></p>
      )}

      {/* Tabel (panel lebar) */}
      <div className="fin-pm-tabel-bungkus fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel; gulir mendatar bila perlu">
        <table className="fin-pm-tabel" data-jenis={pendapatan ? "pendapatan" : pembayaran ? "pembayaran" : "umum"}>
          <thead>
            <tr>{kolom.map((k) => (
              <th key={k} scope="col" className={k === "nilai" ? "fin-pm-kanan" : undefined}>
                {k === "pihak" ? (pembayaran ? "Pelanggan / Order" : pendapatan ? "Pelanggan / Dokumen" : "Pihak / Dokumen") : <>{JUDUL_KOLOM[k]}{k === "rincian" && <span className="fin-sr-saja">Buka rincian</span>}</>}
              </th>))}
            </tr>
          </thead>
          <tbody>
            {!tampil && !error && <tr><td colSpan={kolom.length} className="fin-pm-kosong">Memuat…</td></tr>}
            {tampil && items.length === 0 && <tr><td colSpan={kolom.length} className="fin-pm-kosong">{judulKosong ?? "Tidak ada data pada periode ini."}</td></tr>}
            {items.map((b) => (
              <React.Fragment key={b.key}>
                <tr className="fin-pm-baris" onClick={(e) => bukaBaris(e, b)} data-testid="baris-pemasukan" data-hitung={tidakDihitung(b) ? "tidak" : "ya"}>
                  {kolom.map((k) => <td key={k} className={k === "nilai" ? "fin-pm-kanan" : k === "rincian" ? "fin-pm-aksi" : undefined}>{sel(k, b)}</td>)}
                </tr>
                {tidakDihitung(b) && bukaAlasan.has(b.key) && (
                  <tr className="fin-pm-baris-alasan"><td colSpan={kolom.length}><PanelAlasan b={b} id={idAlasan(b)} /></td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kartu (panel sempit / HP): label per nilai + akses rincian */}
      <ul className="fin-pm-kartu-daftar" aria-label={`Daftar ${tab.judul} (tampilan kartu)`}>
        {!tampil && !error && <li className="fin-pm-kosong">Memuat…</li>}
        {tampil && items.length === 0 && <li className="fin-pm-kosong">{judulKosong ?? "Tidak ada data pada periode ini."}</li>}
        {items.map((b) => (
          <li key={b.key} className="fin-pm-kartu" data-testid="kartu-pemasukan" data-hitung={tidakDihitung(b) ? "tidak" : "ya"}>
            <div className="fin-pm-kartu-atas">
              <span className="fin-pm-tgl">{tanggalPendek(b.tanggal)}</span>
              {sel("nilai", b)}
            </div>
            <Pihak b={b} />
            <dl className="fin-pm-kartu-isi">
              {kolom.filter((k) => labelKartu[k]).filter((k) => k !== "nilai").map((k) => (
                <div key={k}><dt>{labelKartu[k]}</dt><dd>{sel(k, b)}</dd></div>
              ))}
            </dl>
            {tidakDihitung(b) && bukaAlasan.has(b.key) && <PanelAlasan b={b} id={idAlasan(b)} />}
            {sel("rincian", b)}
          </li>
        ))}
      </ul>

      {tampil && total > LIMIT && (
        <nav className="fin-pm-halaman" aria-label="Halaman daftar">
          <span className="fin-pm-halaman-ket">{dari}–{sampai} dari {total.toLocaleString("id-ID")}</span>
          <div className="fin-pm-halaman-nomor">
            <button type="button" className="fin-pm-hal" disabled={tampil.page <= 1} onClick={() => setPage(tampil.page - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16} aria-hidden="true" /></button>
            {nomorHalaman(total, LIMIT, tampil.page).map((n, i) => (n === "…"
              ? <span key={`e${i}`} className="fin-pm-hal-elips" aria-hidden="true">…</span>
              : <button type="button" key={n} className="fin-pm-hal" aria-current={n === tampil.page ? "page" : undefined} aria-label={`Halaman ${n}`} onClick={() => setPage(n)}>{n}</button>))}
            <button type="button" className="fin-pm-hal" disabled={!tampil.adaLagi} onClick={() => setPage(tampil.page + 1)} aria-label="Halaman berikutnya"><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        </nav>
      )}
    </section>
  );
}

/** Pemilih bergaya pil: <select> asli di balik teks (di HP muncul picker bawaan; keyboard dan pembaca layar bekerja apa adanya). */
export function Pilih({ label, value, onChange, options, semuaKetika = "" }) {
  const aktif = value !== "" && value !== semuaKetika;
  const terpilih = options.find(([v]) => String(v) === String(value));
  return (
    <label className="fin-pm-pilih" data-aktif={aktif ? "1" : "0"}>
      <span>{terpilih && value !== "" ? terpilih[1] : label}</span>
      <ChevronDown size={14} aria-hidden="true" />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{`Semua · ${label}`}</option>
        {options.map(([v, teks]) => <option key={v} value={v}>{teks}</option>)}
      </select>
    </label>
  );
}
