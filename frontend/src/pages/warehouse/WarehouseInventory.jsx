import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Info, Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import ItemDetailDrawer from "@/features/warehouse/components/ItemDetailDrawer.jsx";
import ItemFormModal from "@/features/warehouse/components/ItemFormModal.jsx";
import KelompokBahanNav from "@/features/warehouse/stok/KelompokBahanNav.jsx";
import DaftarBahan from "@/features/warehouse/stok/DaftarBahan.jsx";
import PanelSaringan, { PilihanSaringan, kelasSelect } from "@/features/warehouse/stok/PanelSaringan.jsx";
import { useFilterDaftar } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import { FILTER_KEADAAN, FILTER_JENIS, FILTER_HARGA, FILTER_LAIN, hitungOpsiSaring, saringStok, jangkauanCari, kunciJenis } from "@/features/warehouse/stok/stokLogic.js";
import { halamanDaftar, saringanAktif, ringkasanAtas } from "@/features/warehouse/stok/stokTampilanLogic.js";

// STOK & LOKASI (redesain Okt 2026) — halaman bersih: pencarian + tombol Filter + Tambah Bahan; ringkasan tiga angka; pilihan kelompok ringkas dengan jumlah; DAFTAR LANGSUNG TERLIHAT sesuai saringan.
// Layanan, izin, perhitungan, dan parameter URL TIDAK berubah (?kelompok=&jenis=&q=&keadaan=&nonaktif=&semua=&harga=&lain=&satuan=); yang berubah hanya susunan tampilan.
//  • "belum diketahui" pada Tersedia = BELUM ADA CATATAN stok, bukan nol. "Batas minimum" kosong = belum diatur (bukan 0). Harga belum ada = "Belum ada harga berlaku" (bukan Rp0); tanpa izin Finance kolom harga tidak ada.
//  • Sistem tidak menyimpan saldo per lokasi: "Riwayat penerimaan" (di drawer) = lokasi penerimaan terakhir, bukan saldo di lokasi itu — bukan lokasi stok saat ini.
const PATH = "/warehouse/inventory";
const KUNCI = ["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua", "harga", "lain", "satuan"];
const UKURAN_HALAMAN = 25;
const label = (daftar) => (k) => daftar.find((x) => x.key === k)?.label ?? k;
const LABEL_CHIP = { keadaan: label(FILTER_KEADAAN), harga: label(FILTER_HARGA), lain: label(FILTER_LAIN), jenis: label(FILTER_JENIS) };

function Ubin({ judul, angka, angkaTestid, nada = "ink", onClick, testid, tombolTestid }) {
  const isi = (
    <>
      <span className="block text-[12px] font-medium text-ink2 sm:text-[12.5px]">{judul}</span>
      <span className={cn("mt-0.5 block text-[24px] font-bold leading-none tabular-nums sm:mt-1 sm:text-[28px]", nada === "red" ? "text-red" : nada === "orange" ? "text-orange" : "text-ink")} data-testid={angkaTestid}>{angka}</span>
    </>
  );
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4" data-testid={testid}>
      {onClick ? <button type="button" onClick={onClick} data-testid={tombolTestid} className="min-h-11 w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{isi}</button> : <div className="min-h-11">{isi}</div>}
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

  return (
    <PageContainer>
      <PageHeader
        title="Stok & Lokasi"
        subtitle="Stok, harga, dan pergerakan bahan dalam satu tempat."
        actions={
          <>
            <Button variant="neutral" size="sm" onClick={load} disabled={loading} aria-label="Muat ulang daftar" className="max-sm:min-h-11 max-sm:min-w-11"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /><span className="max-sm:hidden"> Muat ulang</span></Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }} className="h-11 rounded-2xl px-5 text-[14px] sm:h-11"><Plus size={16} /> Tambah bahan</Button>
          </>
        }
      />
      <PageBody>
        {atas && (
          <section aria-label="Ringkasan stok" className="space-y-2" data-testid="ringkasan-stok">
            <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-card bg-surface shadow-card">
              <Ubin judul="Bahan aktif" angka={atas.aktif} angkaTestid="n-aktif" testid="ubin-aktif" />
              <Ubin judul="Perlu perhatian" angka={atas.minus + atas.belumDiketahui} nada={atas.minus + atas.belumDiketahui > 0 ? "orange" : "ink"} testid="ubin-perhatian" />
              {atas.hargaBelum !== null
                ? <Ubin judul="Harga belum diisi" angka={atas.hargaBelum} nada={atas.hargaBelum > 0 ? "orange" : "ink"} angkaTestid="n-harga-belum" testid="ubin-harga" tombolTestid="perhatian-harga" onClick={atas.hargaBelum > 0 ? () => pilihPerhatian({ harga: "BELUM" }) : undefined} />
                : <Ubin judul="Belum dikelompokkan" angka={grup.find((g) => g.kode === "BELUM")?.total ?? 0} testid="ubin-kelompok" onClick={(grup.find((g) => g.kode === "BELUM")?.total ?? 0) > 0 ? () => pilihKelompok("BELUM") : undefined} />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-1" data-testid="perhatian">
              <span className="text-[12px] text-ink3 max-sm:hidden" data-testid="ringkasan-ringkas">{atas.adaStok} ada stok{atas.nonaktif > 0 && <> · {atas.nonaktif} nonaktif disembunyikan</>}<span className="hidden" data-testid="n-terdaftar">{ringkas.terdaftar}</span></span>
              {atas.minus > 0 && <button type="button" onClick={() => pilihPerhatian({ keadaan: "MINUS" })} data-testid="perhatian-minus" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-redbg px-3 text-[12px] font-semibold text-red sm:min-h-8"><strong>{atas.minus}</strong> saldo minus</button>}
              {atas.belumDiketahui > 0 && <button type="button" onClick={() => pilihPerhatian({ keadaan: "BELUM_ADA_CATATAN" })} data-testid="perhatian-belum" title="Belum ada catatan stok — bukan berarti habis" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-inset px-3 text-[12px] font-semibold text-ink2 sm:min-h-8"><strong>{atas.belumDiketahui}</strong> belum diketahui</button>}
              {atas.hargaBelum !== null && <button type="button" onClick={() => pilihPerhatian({ keadaan: "ADA", harga: "BELUM" })} data-testid="perhatian-ada-stok-tanpa-harga" className="inline-flex min-h-11 items-center rounded-full bg-orangebg px-3 text-[12px] font-semibold text-orange sm:min-h-8">Ada stok, belum ada harga</button>}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input type="search" value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari bahan, kode, vendor…" aria-label="Cari bahan di semua kelompok: kode, nama, atau vendor" data-testid="cari-bahan"
              autoFocus={typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches}
              className="h-11 w-full rounded-2xl bg-surface pl-11 pr-4 text-[14px] text-ink shadow-card outline-none placeholder:text-ink3 focus-visible:ring-2 focus-visible:ring-accent/50" />
          </div>
          <PanelSaringan jumlah={chips.length} onAturUlang={aturUlangSaringan}>
            <PilihanSaringan label="Keadaan stok">
              <select value={keadaan} onChange={(e) => ubahF("keadaan", e.target.value)} aria-label="Saring keadaan stok" data-testid="saring-keadaan" className={kelasSelect}>
                {FILTER_KEADAAN.map((x) => <option key={x.key} value={x.key}>{x.label}{x.key && opsi ? ` (${opsi.keadaan[x.key] ?? 0})` : ""}</option>)}
              </select>
            </PilihanSaringan>
            {harga && (
              <PilihanSaringan label="Harga berlaku">
                <select value={hargaF} onChange={(e) => ubahF("harga", e.target.value)} aria-label="Saring harga berlaku" data-testid="saring-harga" className={kelasSelect}>
                  {FILTER_HARGA.map((x) => <option key={x.key} value={x.key}>{x.label}{x.key && opsi ? ` (${opsi.harga[x.key] ?? 0})` : ""}</option>)}
                </select>
              </PilihanSaringan>
            )}
            <PilihanSaringan label="Kelengkapan data">
              <select value={lainF} onChange={(e) => ubahF("lain", e.target.value)} aria-label="Saring kelengkapan data bahan" data-testid="saring-lain" className={kelasSelect}>
                {FILTER_LAIN.map((x) => <option key={x.key} value={x.key}>{x.label}{x.key && opsi ? ` (${opsi.lain[x.key] ?? 0})` : ""}</option>)}
              </select>
            </PilihanSaringan>
            <PilihanSaringan label="Satuan stok">
              <select value={satuanF} onChange={(e) => ubahF("satuan", e.target.value)} aria-label="Saring satuan stok" data-testid="saring-satuan" className={kelasSelect}>
                <option value="">Semua satuan</option>
                {(opsi?.satuan ?? []).map((u) => <option key={u.kode} value={u.kode}>{u.kode} ({u.n})</option>)}
              </select>
            </PilihanSaringan>
            <PilihanSaringan label="Jenis persediaan">
              <select value={jenis} onChange={(e) => ubahF("jenis", e.target.value)} disabled={!!String(cari).trim()} aria-label="Jenis persediaan" data-testid="saring-jenis" className={cn(kelasSelect, "disabled:opacity-50")}>
                {FILTER_JENIS.map((x) => <option key={x.key} value={x.key}>{x.label}{x.key ? jenisBahan(x.key) : ""}</option>)}
              </select>
              {String(cari).trim() && <span className="mt-1 block text-[11.5px] text-ink3">Saat mencari, jenis dan kelompok tidak menyaring.</span>}
            </PilihanSaringan>
            <label className="flex min-h-11 items-center gap-2.5 rounded-xl text-[13.5px] text-ink"><input type="checkbox" checked={nonaktif} onChange={(e) => ubahF("nonaktif", e.target.checked ? "1" : "")} data-testid="tampilkan-nonaktif" className="h-5 w-5 accent-[var(--accent)]" /> Tampilkan bahan nonaktif</label>
          </PanelSaringan>
        </div>

        {chips.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label="Saringan aktif" data-testid="chip-saringan">
            {chips.map((c) => (
              <li key={c.kunci}><span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accentbg py-0.5 pl-3 pr-1 text-[12.5px] font-semibold text-accent" data-testid={c.testid}>{c.teks}
                <button type="button" aria-label={c.aria} onClick={() => hapusChip(c.kunci)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-accent/15 max-sm:h-11 max-sm:w-11"><X size={13} aria-hidden /></button></span></li>
            ))}
          </ul>
        )}

        {grup.length > 0 && (
          <section aria-label="Pilih kelompok bahan" className="space-y-1.5">
            <KelompokBahanNav kelompok={grup} dipilih={kelompok} onPilih={pilihKelompok} jumlahSemua={ringkas?.aktif} />
            {String(cari).trim() && kelompok && <p className="m-0 px-1 text-[12px] text-ink3" data-testid="cakupan" data-mode={cakupan.mode}>{cakupan.teks}</p>}
          </section>
        )}

        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <div className="flex items-center justify-between gap-2 px-1 text-[12.5px] text-ink3">
          <span data-testid="jumlah-tampil">{terfilter ? `${terfilter.length} bahan tampil` : "Memuat…"}</span>
          {adaPembatas && <button type="button" onClick={kembaliSemua} data-testid="kembali-semua" className="inline-flex min-h-11 items-center rounded-xl px-2 font-semibold text-accent hover:bg-accentbg sm:min-h-8">Tampilkan semua bahan</button>}
        </div>

        <DaftarBahan halaman={halaman} loading={loading || !terfilter} peta={harga} dipilihId={selected?.materialId ?? null} onPilih={pilihBaris} onHalaman={setNomorHalaman}
          kosong={kosong ? {
            judul: kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? `Belum ada bahan di kelompok ${labelKelompok}` : "Tidak ada bahan yang cocok",
            deskripsi: kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? "Tidak ada bahan aktif yang termasuk kelompok ini. Bahan nonaktif bisa ditampilkan lewat Filter." : "Ubah kata kunci, kelompok, atau saringan.",
          } : null}
          tampilBantuan={kosong && adaPembatas ? <Button variant="secondary" size="sm" onClick={kembaliSemua} className="mt-1 h-11 rounded-xl px-4">Tampilkan semua bahan</Button> : null} />

        {ringkas && (
          <details className="rounded-card bg-surface px-4 py-1 text-[12px] text-ink2 shadow-card" data-testid="rincian-ringkasan">
            <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold text-ink3">Rincian angka dan catatan sumber</summary>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pb-1">
              <span><strong className="text-ink">{ringkas.terdaftar}</strong> bahan terdaftar</span>
              <span><strong className="text-ink">{ringkas.ada}</strong> ada stok</span>
              <span><strong className="text-ink">{ringkas.belumAdaCatatan}</strong> belum ada catatan stok</span>
              <span><strong className="text-ink">{ringkas.nolTerhitung}</strong> nol menurut pergerakan</span>
              <span><strong className="text-ink">{ringkas.minus}</strong> bersaldo minus</span>
            </div>
            <ul className="m-0 list-none space-y-0.5 p-0 pb-2" data-testid="kesimpulan-stok">
              {k.belumDiketahui && <li>• {k.belumDiketahui}.</li>}
              {k.minus && <li>• {k.minus}.</li>}
              <li>• {k.reorder}.</li>
              {(grup.find((g) => g.kode === "BELUM")?.total ?? 0) > 0 && <li>• {grup.find((g) => g.kode === "BELUM").total} bahan belum dikelompokkan: itemGroup-nya kosong atau berisi bahan campuran — perlu keputusan manual (tidak ditebak dari nama).</li>}
            </ul>
            <p className="m-0 flex items-start gap-1 pb-2 text-ink3" data-testid="catatan-sumber"><Info size={12} className="mt-px shrink-0" aria-hidden /> {data.catatan}</p>
          </details>
        )}
      </PageBody>
      <ItemDetailDrawer item={selected} baris={selectedRow} hargaPeta={harga} onClose={tutupDrawer} onEdit={(it) => { tutupDrawer(); setEditing(it); setFormOpen(true); }} onChanged={load} />
      <ItemFormModal open={formOpen} item={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={load} />
    </PageContainer>
  );
}
