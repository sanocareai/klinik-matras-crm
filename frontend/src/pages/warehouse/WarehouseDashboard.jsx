import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageContainer } from "@/components/ui/page.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import { api } from "@/api.js";
import { Glif } from "@/features/warehouse/beranda/IkonApple.jsx";
import "@/styles/sanss-gudang-beranda.css";
import { useJendelaFokus } from "@/features/warehouse/dokumen/useJendelaFokus.js";
import { waktuTeks } from "@/features/warehouse/dokumen/dokumenLogic.js";
import DokumenFokus from "@/features/warehouse/pusatkerja/DokumenFokus.jsx";
import { useSumberPusatKerja } from "@/features/warehouse/pusatkerja/usePusatKerja.js";
import { dalamHalaman, urlItem } from "@/features/warehouse/pusatkerja/urlFokus.js";
import KartuRingkasan from "@/features/warehouse/beranda/KartuRingkasan.jsx";
import ToolbarBeranda from "@/features/warehouse/beranda/ToolbarBeranda.jsx";
import DaftarKerja from "@/features/warehouse/beranda/DaftarKerja.jsx";
import HasilCariServer from "@/features/warehouse/beranda/HasilCariServer.jsx";
import { PanelPerhatian, AksesCepat, TentangAngka } from "@/features/warehouse/beranda/PanelPendukung.jsx";
import {
  susunPekerjaan, saringPekerjaan, pilihanFilter, hitungKelompok, sisaBelumDimuat, kartuRingkasan, jumlahFilterAktif, adaFilter, waktuPembaruan,
} from "@/features/warehouse/beranda/berandaLogika.js";

// BERANDA GUDANG = PUSAT KERJA HARIAN (redesain Beranda, 7 Nov 2026). Satu daftar padat "Perlu dikerjakan": satu dokumen satu baris, keterlambatan/hambatan sebagai penanda pada baris itu.
// Semua hitungan datang dari GET /inventory/pusat-kerja (definisi ikut di respons); halaman ini BACA-SAJA dan tidak menghitung ulang: mengetuk baris/tombol hanya membuka jendela fokus dokumen
// (URL /warehouse/dashboard/<jenis>/<id>), Beranda tetap terpasang di belakangnya. Endpoint, izin, status, dan arti angka tidak berubah.
const PATH = "/warehouse/dashboard";
const BATAS_MUAT = 50; // batas maksimum per antrean/sebab yang diizinkan server (?batas=); sisanya dimuat lewat "Muat sisanya"
const TAMPIL_AWAL = 12;
const F0 = { q: "", kelompok: "semua", jenis: [], tahap: [], antrean: [], penanda: "semua" };
const KARTU_ANTREAN = { PENERIMAAN_AKAN_DATANG: "kedatangan", PENERIMAAN_PERIKSA: "periksa", PENERIMAAN_SIAP_STOK: "siap" };

export default function WarehouseDashboard() {
  const navigate = useNavigate(); const { jenis, id } = useParams();
  const { data, galat, memuat, muat } = useSumberPusatKerja(() => api.getPusatKerja(BATAS_MUAT));
  const { bukaUrl, tutup } = useJendelaFokus(PATH);
  const [f, setF] = useState(F0); const [tampil, setTampil] = useState(TAMPIL_AWAL);
  const [ekstra, setEkstra] = useState({ antrean: {}, tertahan: {} }); const [memuatSisa, setMemuatSisa] = useState(false); const [galatSisa, setGalatSisa] = useState("");
  const [tentang, setTentang] = useState(false);
  const panelRef = useRef(null);
  useEffect(() => { setEkstra({ antrean: {}, tertahan: {} }); setGalatSisa(""); }, [data?.dihitungPada]);
  useEffect(() => { setTampil(TAMPIL_AWAL); }, [f]);

  const buka = (item, kodeAksi = null) => { const url = urlItem(PATH, item, kodeAksi); if (!url) return; if (dalamHalaman(PATH, url)) bukaUrl(url); else navigate(url); };

  const pekerjaan = useMemo(() => susunPekerjaan(data, ekstra), [data, ekstra]);
  const sisa = useMemo(() => sisaBelumDimuat(data, ekstra), [data, ekstra]);
  const lengkap = !!data && !sisa.ada;
  const disaring = useMemo(() => saringPekerjaan(pekerjaan, f), [pekerjaan, f]);
  const pilihan = useMemo(() => pilihanFilter(pekerjaan), [pekerjaan]);
  const hitung = useMemo(() => hitungKelompok(pekerjaan), [pekerjaan]);
  const kartu = useMemo(() => kartuRingkasan(data, pekerjaan, lengkap), [data, pekerjaan, lengkap]);
  const kunciAda = useMemo(() => new Set(disaring.map((r) => `${r.jenis}:${r.id}`)), [disaring]);
  const penandaTersedia = (data?.tertahan ?? []).filter((s) => s.jumlah > 0);
  const jumlahLewat = (data?.tertahan ?? []).find((s) => s.kode === "JADWAL_LEWAT")?.jumlah ?? 0;
  const aktifKartu = f.penanda === "ada" && !f.antrean.length ? "tertahan" : f.antrean.length === 1 ? KARTU_ANTREAN[f.antrean[0]] ?? null : null;
  const labelAntrean = (kode) => (data?.antrean ?? []).find((a) => a.kode === kode)?.judul ?? kode;
  const adaSaringan = adaFilter(f);

  const pilihKartu = (k) => {
    if (aktifKartu === k.kode) { setF(F0); return; }
    setF((s) => ({ ...s, kelompok: "semua", jenis: [], tahap: [], antrean: k.filter.antrean ?? [], penanda: k.filter.penanda ?? "semua" }));
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "nearest" }));
  };
  const pilihPenanda = (kode) => { setF((s) => ({ ...s, kelompok: "semua", jenis: [], tahap: [], antrean: [], penanda: kode === "JADWAL_LEWAT" ? "lewat" : kode })); requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "nearest" })); };

  async function muatSisa() {
    if (!data) return; setMemuatSisa(true); setGalatSisa("");
    try {
      const baru = { antrean: { ...ekstra.antrean }, tertahan: { ...ekstra.tertahan } };
      const halaman = async (daftar, peta, ambil) => {
        for (const a of daftar) {
          let ada = [...(peta[a.kode] ?? [])]; let lebih = Math.max(0, (a.lebih ?? 0) - ada.length);
          while (lebih > 0) {
            const d = await ambil(a.kode, { offset: a.item.length + ada.length, limit: 100 });
            if (!d.item.length) break; ada = [...ada, ...d.item]; lebih = d.lebih;
          }
          peta[a.kode] = ada;
        }
      };
      await halaman(data.antrean, baru.antrean, api.getAntreanPusatKerja);
      await halaman(data.tertahan, baru.tertahan, api.getTertahanPusatKerja);
      setEkstra(baru);
    } catch (e) { setGalatSisa(e.message || "Gagal memuat sisa pekerjaan"); } finally { setMemuatSisa(false); }
  }

  const hasilTeks = !data ? "" : !lengkap
    ? `Menampilkan ${disaring.length.toLocaleString("id-ID")} dari ${pekerjaan.length.toLocaleString("id-ID")} baris yang sudah dimuat · masih ada ${(sisa.antrean + sisa.tertahan).toLocaleString("id-ID")} di server`
    : adaSaringan ? `${disaring.length.toLocaleString("id-ID")} dari ${pekerjaan.length.toLocaleString("id-ID")} pekerjaan` : `${pekerjaan.length.toLocaleString("id-ID")} pekerjaan`;

  return (
    <PageContainer fluid className="gud-halaman">
      <div className="gud-br" data-testid="beranda-gudang">
        <header className="gud-kepala">
          <div className="gud-judul">
            <h1 className="page-title">Beranda Gudang</h1>
            <p className="page-subtitle">Lihat antrean dan lanjutkan pekerjaan.</p>
          </div>
          <div className="gud-aksi-kepala gud-br-kepala-aksi">
            {data && <span className="gud-br-diperbarui" data-testid="catatan-beranda" title={`Dihitung ${waktuTeks(data.dihitungPada)}`}>Diperbarui {waktuPembaruan(data.dihitungPada) ?? "—"}</span>}
            <button type="button" className="gud-tombol" aria-expanded={tentang} onClick={() => setTentang((v) => !v)} data-testid="tentang-angka-tombol"><Glif nama="info" size={16} /> Tentang angka</button>
            <button type="button" className="gud-tombol" onClick={() => muat()} disabled={memuat} data-testid="muat-ulang-beranda"><Glif nama="muatUlang" size={16} className={memuat ? "animate-spin" : ""} /> Muat ulang</button>
          </div>
        </header>

        {galat && <div role="alert" className="gud-br-galat" data-testid="galat-beranda"><span>{galat}</span><button type="button" className="gud-tombol" onClick={() => muat()}>Coba lagi</button></div>}
        {memuat && !data && <div className="gud-br-memuat" aria-busy="true" data-testid="memuat-beranda"><div className="gud-br-rangka" /><div className="gud-br-rangka gud-br-rangka-tinggi" /></div>}

        {data && (
          <>
            <TentangAngka data={data} buka={tentang} onTutup={() => setTentang(false)} />
            {!data.izin.tulis && <div className="gud-br-strip" data-testid="baca-saja">Akun Anda hanya dapat melihat. Tombol tindakan tidak ditampilkan; dokumen tetap bisa dibuka.</div>}
            <KartuRingkasan kartu={kartu} aktif={aktifKartu} onPilih={pilihKartu} />
            <p className="gud-br-catatan-kartu">Kategori dapat tumpang tindih dengan penanda terlambat.</p>

            <div className="gud-br-grid">
              <section className="gud-br-panel gud-panel" aria-label="Perlu dikerjakan" data-testid="bagian-kerja" ref={panelRef}>
                <div className="gud-br-panel-kepala">
                  <h2 className="gud-br-judul-panel">Perlu dikerjakan</h2>
                  <span className="gud-br-badge" data-testid="ringkas-kerja" title={lengkap ? "Jumlah baris pekerjaan" : "Jumlah baris yang sudah dimuat; masih ada sisa di server"}>{pekerjaan.length.toLocaleString("id-ID")}{lengkap ? "" : "+"}</span>
                </div>
                <p className="gud-br-sekunder gud-br-panel-sub">Satu dokumen, satu baris. Yang lewat jadwal di atas, lalu yang paling lama tidak diubah.</p>
                <ToolbarBeranda
                  f={f} setF={setF} onReset={() => setF(F0)} pilihan={pilihan} penandaTersedia={penandaTersedia} hitung={hitung} lengkap={lengkap} jumlahLewat={jumlahLewat}
                  labelAntrean={labelAntrean} jumlahAktif={jumlahFilterAktif(f)} hasil={hasilTeks} dimuat={!!data}
                />
                {!lengkap && (
                  <div className="gud-br-strip gud-br-strip-sisa" data-testid="sisa-belum-dimuat">
                    <span>Daftar memuat hingga {BATAS_MUAT} baris per antrean; hitungan dan filter di bawah hanya mencakup baris yang sudah dimuat.</span>
                    <button type="button" className="gud-tombol" onClick={muatSisa} disabled={memuatSisa} data-testid="muat-sisa">{memuatSisa ? <Loader2 size={14} className="animate-spin" /> : null} Muat sisanya</button>
                  </div>
                )}
                {galatSisa && <p role="alert" className="gud-br-galat-kecil">{galatSisa}</p>}
                <HasilCariServer q={f.q} kunciAda={kunciAda} onBuka={buka} />
                <DaftarKerja
                  baris={disaring} onBuka={buka} tampil={tampil} onLagi={() => setTampil((n) => n + TAMPIL_AWAL)}
                  kosongTeks={pekerjaan.length === 0 ? "Tidak ada pekerjaan yang menunggu saat ini." : "Tidak ada pekerjaan yang cocok dengan pencarian atau filter ini."}
                  kosongAksi={pekerjaan.length > 0 ? <button type="button" className="gud-tombol" onClick={() => setF(F0)} data-testid="reset-kosong">Reset filter</button> : null}
                />
              </section>

              <aside className="gud-br-sisi" aria-label="Panel pendukung">
                <PanelPerhatian data={data} onPilih={pilihPenanda} />
                <AksesCepat />
              </aside>
            </div>

            <details className="gud-br-selesai gud-panel" data-testid="bagian-selesai">
              <summary>Selesai terbaru <span className="gud-br-sekunder">· 7 hari terakhir ({data.selesaiTerbaru.length})</span></summary>
              {data.selesaiTerbaru.length === 0 ? <p className="gud-br-sekunder">Belum ada dokumen yang selesai dalam 7 hari terakhir.</p> : (
                <ul className="gud-br-selesai-daftar">
                  {data.selesaiTerbaru.map((s) => (
                    <li key={s.kunci}><button type="button" onClick={() => buka(s, null)} data-testid="baris-selesai"><span className="gud-br-nomor-teks">{s.nomor}</span><span className="gud-br-sekunder">{s.teks}{s.oleh ? ` · ${s.oleh}` : ""}</span><span className="gud-br-sekunder gud-br-waktu">{waktuTeks(s.waktu)}</span></button></li>
                  ))}
                </ul>
              )}
            </details>
            <ActiveComplaintsWidget currentOwner="WAREHOUSE" title="Kasus Komplain Butuh Material" />
          </>
        )}
      </div>
      <DokumenFokus jenis={jenis} id={id} onTutup={tutup} onBerubah={() => muat(true)} />
    </PageContainer>
  );
}
