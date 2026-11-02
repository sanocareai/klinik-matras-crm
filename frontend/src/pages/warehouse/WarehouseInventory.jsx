import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { cn } from "@/lib/utils.js";
import { IkCari, IkInfo, IkMuatUlang, IkTambah, IkTutup } from "@/components/gudangIcons.jsx";
import ItemDetailDrawer from "@/features/warehouse/components/ItemDetailDrawer.jsx";
import ItemFormModal from "@/features/warehouse/components/ItemFormModal.jsx";
import KelompokBahanNav from "@/features/warehouse/stok/KelompokBahanNav.jsx";
import DaftarBahan from "@/features/warehouse/stok/DaftarBahan.jsx";
import { PilihGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { useFilterDaftar } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import { FILTER_KEADAAN, FILTER_JENIS, FILTER_HARGA, FILTER_LAIN, hitungOpsiSaring, saringStok, jangkauanCari, kunciJenis } from "@/features/warehouse/stok/stokLogic.js";
import { halamanDaftar, saringanAktif, ringkasanAtas, ringkasHasil } from "@/features/warehouse/stok/stokTampilanLogic.js";

// STOK & LOKASI (redesain Gudang, 3 Nov 2026) — bahan ditemukan, saldo dipahami, asal perubahan ditelusuri, tindakan sesuai izin. Daftar memakai lebar ruang setelah sidebar; rincian bahan menempel di kanan (≥1200px)
// atau layar penuh di HP, dan daftar mempertahankan posisi serta saringan saat panel ditutup.
// Layanan, izin, perhitungan, dan parameter URL TIDAK berubah (?kelompok=&jenis=&q=&keadaan=&nonaktif=&semua=&harga=&lain=&satuan=).
// CAKUPAN SARINGAN: seluruh bahan dimuat sekaligus (GET /inventory/beranda/stok tanpa batas baris); saringan, hitungan opsi "(n)", ringkasan, dan halaman daftar memakai SATU himpunan baris yang sama.
// Halaman daftar (25 baris) hanya memotong tampilan hasil saringan — tidak pernah menyaring ulang; angka "N bahan" dan rincian hasil dihitung dari seluruh hasil saringan.
//  • "belum diketahui" pada Tersedia = BELUM ADA CATATAN stok, bukan nol. "Batas minimum" kosong = belum diatur (bukan 0). Harga belum ada = "Belum ada harga berlaku" (bukan Rp0); tanpa izin Finance kolom harga tidak ada.
//  • Sistem tidak menyimpan saldo per lokasi: "Riwayat penerimaan" (di rincian bahan) = lokasi penerimaan terakhir, bukan saldo di lokasi itu — bukan lokasi stok saat ini. Karena itu TIDAK ada saringan lokasi.
//  • Kuantitas bahan berbeda satuan tidak pernah dijumlahkan: ringkasan menghitung JUMLAH BAHAN, bukan total kuantitas.
const PATH = "/warehouse/inventory";
const KUNCI = ["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua", "harga", "lain", "satuan"];
const UKURAN_HALAMAN = 25;
const label = (daftar) => (k) => daftar.find((x) => x.key === k)?.label ?? k;
const LABEL_CHIP = { keadaan: label(FILTER_KEADAAN), harga: label(FILTER_HARGA), lain: label(FILTER_LAIN), jenis: label(FILTER_JENIS) };

function Ubin({ judul, angka, angkaTestid, nada = "ink", onClick, testid, tombolTestid, keterangan }) {
  const isi = (
    <>
      <span className="gud-ubin-judul">{judul}</span>
      <span className="gud-ubin-angka" data-nada={nada} data-testid={angkaTestid}>{angka}</span>
      {keterangan && <span className="gud-ubin-ket">{keterangan}</span>}
    </>
  );
  return (
    <div className="gud-ubin" data-testid={testid}>
      {onClick ? <button type="button" onClick={onClick} data-testid={tombolTestid} className="gud-ubin-isi max-sm:min-h-11">{isi}</button> : <div className="gud-ubin-isi">{isi}</div>}
    </div>
  );
}

export default function WarehouseInventory() {
  const [data, setData] = useState(null); const [stok, setStok] = useState(null); const [harga, setHarga] = useState(null); // harga = null: tanpa izin Finance / gagal muat -> kolom harga disembunyikan
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [f, ubahF, ubahBanyak] = useFilterDaftar(PATH, KUNCI);
  const { kelompok, jenis, q: cari, keadaan } = f; const hargaF = f.harga; const lainF = f.lain; const satuanF = f.satuan; const nonaktif = f.nonaktif === "1";
  const [selected, setSelected] = useState(null); const [selectedRow, setSelectedRow] = useState(null); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState(null);
  const [nomorHalaman, setNomorHalaman] = useState(1);

  const load = useCallback(() => {
    setLoading(true); setError("");
    Promise.all([api.getStokLokasi(), api.getStock()]).then(([a, b]) => { setData(a); setStok(new Map(b.map((x) => [x.materialId, x]))); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    api.getRingkasanDaftarHargaBerlaku().then(setHarga).catch(() => setHarga(null)); // tanpa izin Finance -> kolom harga disembunyikan
  }, []);
  useEffect(() => { load(); }, [load]);

  const terfilter = useMemo(() => (data ? saringStok(data.rows, { jenis, kelompok, cari, keadaan, nonaktif, harga: hargaF, petaHarga: harga, lain: lainF, satuan: satuanF }) : null), [data, jenis, kelompok, cari, keadaan, nonaktif, hargaF, harga, lainF, satuanF]);
  const opsi = useMemo(() => (data ? hitungOpsiSaring(data.rows, { petaHarga: harga, nonaktif }) : null), [data, harga, nonaktif]);
  useEffect(() => { setNomorHalaman(1); }, [jenis, kelompok, cari, keadaan, nonaktif, hargaF, lainF, satuanF]);
  const hasil = useMemo(() => ringkasHasil(terfilter ?? [], harga), [terfilter, harga]); // SELURUH hasil saringan, bukan 25 baris halaman
  const halaman = useMemo(() => halamanDaftar(terfilter ?? [], nomorHalaman, UKURAN_HALAMAN), [terfilter, nomorHalaman]);

  const chips = saringanAktif({ keadaan, harga: hargaF, lain: lainF, satuan: satuanF, jenis, nonaktif }, LABEL_CHIP);
  const ringkas = data?.ringkasan; const k = ringkas?.kesimpulan; const grup = data?.kelompok?.kelompok ?? []; const jenisN = data?.kelompok?.jenis ?? [];
  const atas = ringkasanAtas(ringkas, opsi, !!harga);
  const labelKelompok = grup.find((g) => g.kode === kelompok)?.label ?? "";
  const cakupan = jangkauanCari({ kelompok, cari, labelKelompok });
  const kosong = !loading && terfilter && terfilter.length === 0;
  const adaPembatas = !!(kelompok || String(cari).trim() || chips.length || f.semua);
  const hapusChip = (kunci) => ubahF(kunci, "");
  const aturUlangSaringan = () => ubahBanyak({ keadaan: "", harga: "", lain: "", satuan: "", jenis: "", nonaktif: "" });
  const kembaliSemua = () => ubahBanyak({ kelompok: "", jenis: "", q: "", keadaan: "", nonaktif: "", semua: "", harga: "", lain: "", satuan: "" });
  const pilihKelompok = (kode) => ubahBanyak({ kelompok: kode, q: "", semua: "" });
  const pilihPerhatian = (patch) => ubahBanyak({ kelompok: "", jenis: "", q: "", keadaan: "", semua: "", harga: "", lain: "", satuan: "", ...patch });
  const pilihBaris = (r) => { const s = stok?.get(r.materialId) ?? null; setSelected(s); setSelectedRow(s ? r : null); };
  const tutupDrawer = () => { setSelected(null); setSelectedRow(null); };
  const jenisBahan = (kode) => { const n = jenisN.find((y) => kunciJenis(y.kode) === kode); return n ? ` (${n.total}${n.nonaktif ? `+${n.nonaktif} nonaktif` : ""})` : ""; };

  const opsiKeadaan = FILTER_KEADAAN.map((x) => ({ nilai: x.key, label: `${x.label}${x.key && opsi ? ` (${opsi.keadaan[x.key] ?? 0})` : ""}` }));
  const opsiHarga = FILTER_HARGA.map((x) => ({ nilai: x.key, label: `${x.label}${x.key && opsi ? ` (${opsi.harga[x.key] ?? 0})` : ""}` }));
  const opsiLain = FILTER_LAIN.map((x) => ({ nilai: x.key, label: `${x.label}${x.key && opsi ? ` (${opsi.lain[x.key] ?? 0})` : ""}` }));
  const opsiSatuan = [{ nilai: "", label: "Semua satuan" }, ...(opsi?.satuan ?? []).map((u) => ({ nilai: u.kode, label: `${u.kode} (${u.n})` }))];
  const opsiJenis = FILTER_JENIS.map((x) => ({ nilai: x.key, label: `${x.label}${x.key ? jenisBahan(x.key) : ""}` }));
  const mencari = !!String(cari).trim();

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={cn("gud-split", selected && "gud-split-buka")} data-testid="ruang-stok">
        <section className="gud-panel gud-daftar gud-stok" aria-label="Daftar stok dan lokasi">
          <header className="gud-kepala">
            <div className="gud-judul">
              <h1 className="page-title">Stok &amp; lokasi</h1>
              <p className="page-subtitle">Temukan bahan, pahami saldonya, dan telusuri asal perubahannya.</p>
            </div>
            <div className="gud-aksi-kepala">
              <button type="button" className="gud-tombol-ikon" onClick={load} disabled={loading} aria-label="Muat ulang daftar" title="Muat ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : ""} /></button>
              <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="tambah-bahan"><IkTambah size={16} /> Tambah bahan</button>
            </div>
          </header>

          {atas && (
            <section aria-label="Ringkasan stok" className="gud-ubin-baris" data-testid="ringkasan-stok">
              <Ubin judul="Bahan aktif" angka={atas.aktif} angkaTestid="n-aktif" testid="ubin-aktif" keterangan={`${atas.adaStok} ada stok${atas.nonaktif > 0 ? ` · ${atas.nonaktif} nonaktif disembunyikan` : ""}`} />
              <Ubin judul="Saldo minus" angka={atas.minus} nada={atas.minus > 0 ? "merah" : "ink"} testid="ubin-minus" tombolTestid="perhatian-minus" onClick={atas.minus > 0 ? () => pilihPerhatian({ keadaan: "MINUS" }) : undefined} keterangan="perlu dihitung fisik" />
              <Ubin judul="Belum diketahui" angka={atas.belumDiketahui} nada={atas.belumDiketahui > 0 ? "kuning" : "ink"} testid="ubin-belum" tombolTestid="perhatian-belum" onClick={atas.belumDiketahui > 0 ? () => pilihPerhatian({ keadaan: "BELUM_ADA_CATATAN" }) : undefined} keterangan="belum ada catatan stok, bukan nol" />
              {atas.hargaBelum !== null
                ? <Ubin judul="Harga belum diisi" angka={atas.hargaBelum} nada={atas.hargaBelum > 0 ? "kuning" : "ink"} angkaTestid="n-harga-belum" testid="ubin-harga" tombolTestid="perhatian-harga" onClick={atas.hargaBelum > 0 ? () => pilihPerhatian({ harga: "BELUM" }) : undefined} keterangan="HPP operasional" />
                : <Ubin judul="Belum dikelompokkan" angka={grup.find((g) => g.kode === "BELUM")?.total ?? 0} testid="ubin-kelompok" onClick={(grup.find((g) => g.kode === "BELUM")?.total ?? 0) > 0 ? () => pilihKelompok("BELUM") : undefined} keterangan="perlu keputusan manual" />}
            </section>
          )}

          <div className="gud-cari">
            <IkCari size={16} aria-hidden />
            <input type="search" value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari bahan, kode, atau vendor..." aria-label="Cari bahan di semua kelompok: kode, nama, atau vendor" data-testid="cari-bahan"
              autoFocus={typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches} />
          </div>

          {grup.length > 0 && (
            <section aria-label="Pilih kelompok bahan" className="gud-stok-kelompok">
              <KelompokBahanNav kelompok={grup} dipilih={kelompok} onPilih={pilihKelompok} jumlahSemua={ringkas?.aktif} />
              {mencari && kelompok && <p className="gud-petunjuk" data-testid="cakupan" data-mode={cakupan.mode}>{cakupan.teks}</p>}
            </section>
          )}

          <div className="gud-saring gud-saring-stok" data-testid="toolbar-saringan">
            <label className="gud-pilih-isi"><span className="gud-sr">Kondisi stok</span><PilihGud value={keadaan} onChange={(v) => ubahF("keadaan", v)} opsi={opsiKeadaan} aria-label="Saring keadaan stok" kosongNormal data-testid="saring-keadaan" /></label>
            {harga && <label className="gud-pilih-isi"><span className="gud-sr">Kelengkapan harga</span><PilihGud value={hargaF} onChange={(v) => ubahF("harga", v)} opsi={opsiHarga} aria-label="Saring harga berlaku" kosongNormal data-testid="saring-harga" /></label>}
            <label className="gud-pilih-isi"><span className="gud-sr">Kelengkapan data</span><PilihGud value={lainF} onChange={(v) => ubahF("lain", v)} opsi={opsiLain} aria-label="Saring kelengkapan data bahan" kosongNormal data-testid="saring-lain" /></label>
            <label className="gud-pilih-isi"><span className="gud-sr">Satuan stok</span><PilihGud value={satuanF} onChange={(v) => ubahF("satuan", v)} opsi={opsiSatuan} aria-label="Saring satuan stok" kosongNormal data-testid="saring-satuan" /></label>
            <label className="gud-pilih-isi"><span className="gud-sr">Jenis persediaan</span><PilihGud value={jenis} onChange={(v) => ubahF("jenis", v)} opsi={opsiJenis} disabled={mencari} aria-label="Jenis persediaan" kosongNormal data-testid="saring-jenis" /></label>
            <label className="gud-saklar" data-testid="saklar-nonaktif"><input type="checkbox" checked={nonaktif} onChange={(e) => ubahF("nonaktif", e.target.checked ? "1" : "")} data-testid="tampilkan-nonaktif" /><span>Tampilkan nonaktif</span></label>
          </div>
          {mencari && <p className="gud-petunjuk" data-testid="catatan-cari">Saat mencari, jenis dan kelompok tidak menyaring: pencarian mencakup seluruh bahan.</p>}

          {(chips.length > 0 || adaPembatas) && (
            <div className="gud-chip-baris" data-testid="chip-saringan" aria-label="Saringan aktif">
              {chips.map((c) => <span key={c.kunci} className="gud-chip" data-testid={c.testid}>{c.teks}<button type="button" aria-label={c.aria} onClick={() => hapusChip(c.kunci)}><IkTutup size={12} /></button></span>)}
              {chips.length > 0 && <button type="button" className="gud-tautan" onClick={aturUlangSaringan} data-testid="atur-ulang-saringan">Reset saringan</button>}
              {adaPembatas && <button type="button" onClick={kembaliSemua} data-testid="kembali-semua" className="gud-tautan">Tampilkan semua bahan</button>}
            </div>
          )}

          {error && <div role="alert" className="gud-galat">{error}</div>}

          <div className="gud-stok-ringkas-hasil">
            <span data-testid="jumlah-tampil">{terfilter ? `${terfilter.length} bahan tampil` : "Memuat…"}</span>
            {terfilter && terfilter.length > 0 && (hasil.minus + hasil.belumDiketahui + hasil.nolTerverifikasi + hasil.nolPergerakan + (hasil.hargaBelum ?? 0)) > 0 && (
              <span data-testid="rincian-hasil" title="Dihitung dari seluruh hasil saringan, bukan hanya halaman ini">
                {[hasil.minus > 0 && `${hasil.minus} saldo minus`, hasil.belumDiketahui > 0 && `${hasil.belumDiketahui} belum diketahui`, hasil.nolTerverifikasi > 0 && `${hasil.nolTerverifikasi} nol terverifikasi`, hasil.nolPergerakan > 0 && `${hasil.nolPergerakan} nol menurut pergerakan`, hasil.hargaBelum > 0 && `${hasil.hargaBelum} belum ada harga`].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>

          <DaftarBahan halaman={halaman} loading={loading || !terfilter} peta={harga} dipilihId={selected?.materialId ?? null} onPilih={pilihBaris} onHalaman={setNomorHalaman}
            kosong={kosong ? {
              judul: kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? `Belum ada bahan di kelompok ${labelKelompok}` : "Tidak ada bahan yang cocok",
              deskripsi: kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? "Tidak ada bahan aktif yang termasuk kelompok ini. Bahan nonaktif bisa ditampilkan lewat saklar di atas." : "Ubah kata kunci, kelompok, atau saringan.",
            } : null}
            tampilBantuan={kosong && adaPembatas ? <button type="button" className="gud-tombol" onClick={kembaliSemua}>Tampilkan semua bahan</button> : null} />

          {ringkas && (
            <details className="gud-lipat" data-testid="rincian-ringkasan">
              <summary><span>Rincian angka dan catatan sumber</span></summary>
              <div className="gud-stok-rincian">
                <p className="gud-stok-angka-baris">
                  <span><strong>{ringkas.terdaftar}</strong> bahan terdaftar</span><span><strong>{ringkas.ada}</strong> ada stok</span><span><strong>{ringkas.belumAdaCatatan}</strong> belum ada catatan stok</span>
                  <span><strong>{ringkas.nolTerhitung}</strong> nol menurut pergerakan</span><span><strong>{ringkas.minus}</strong> bersaldo minus</span>
                </p>
                <ul className="gud-stok-kesimpulan" data-testid="kesimpulan-stok">
                  {k.belumDiketahui && <li>{k.belumDiketahui}.</li>}
                  {k.minus && <li>{k.minus}.</li>}
                  <li>{k.reorder}.</li>
                  {(grup.find((g) => g.kode === "BELUM")?.total ?? 0) > 0 && <li>{grup.find((g) => g.kode === "BELUM").total} bahan belum dikelompokkan: itemGroup-nya kosong atau berisi bahan campuran — perlu keputusan manual (tidak ditebak dari nama). Ini bukan masalah stok.</li>}
                </ul>
                <p className="gud-petunjuk" data-testid="catatan-sumber"><IkInfo size={14} aria-hidden /> {data.catatan}</p>
              </div>
            </details>
          )}
        </section>
        <ItemDetailDrawer item={selected} baris={selectedRow} hargaPeta={harga} onClose={tutupDrawer} onEdit={(it) => { tutupDrawer(); setEditing(it); setFormOpen(true); }} onChanged={load} />
      </div>
      <ItemFormModal open={formOpen} item={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={load} />
    </PageContainer>
  );
}
