import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Info, MapPin, Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import ItemDetailDrawer from "@/features/warehouse/components/ItemDetailDrawer.jsx";
import ItemFormModal from "@/features/warehouse/components/ItemFormModal.jsx";
import KelompokBahanNav from "@/features/warehouse/stok/KelompokBahanNav.jsx";
import { useFilterDaftar } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import { CATEGORY_REAL } from "@/features/warehouse/inventoryReal.js";
import { tampilHargaDaftar } from "@/features/warehouse/stok/koreksiSaldoLogic.js";
import { FILTER_KEADAAN, FILTER_JENIS, saringStok, daftarTampil, jangkauanCari, teksBatasMinimum, warnaKeadaan, tampilSaldo, riwayatLokasi, kunciJenis } from "@/features/warehouse/stok/stokLogic.js";

// STOK & LOKASI — mencari bahan dan membaca saldonya dengan jujur. Layar awal = NAVIGASI KELOMPOK BAHAN (Busa, Kain, Benang, Pegas, Kayu, Lem/Kimia, Aksesori, Lainnya, + yang belum dikelompokkan), pencarian,
// dan kondisi yang butuh perhatian — bukan 358 baris. Memilih kelompok langsung membuka daftarnya; pencarian selalu mencari SELURUH bahan dan menampilkan kelompoknya. Keadaan disimpan di URL
// (?kelompok=&jenis=&q=&keadaan=) supaya bertahan saat muat ulang dan bisa dibagikan. Kelompok = turunan itemGroup lewat tabel eksplisit di server (bukan tebakan nama).
//  • "—"/"belum diketahui" pada Saldo = BELUM ADA CATATAN stok, bukan nol. "Batas minimum" kosong = belum diatur (bukan 0).
//  • Sistem tidak menyimpan saldo per lokasi: kolom Riwayat penerimaan = lokasi penerimaan terakhir, bukan saldo di lokasi itu.
const PATH = "/warehouse/inventory";
const KUNCI = ["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua"];

function SaldoSel({ r, inline = false }) {
  const t = tampilSaldo(r);
  if (t.jenis === "BELUM_DIKETAHUI") return <span className="text-[11.5px] font-medium italic text-ink3">{t.teks}</span>;
  if (t.jenis === "MINUS") return <span className="font-bold text-red">{t.teks}<span className="ml-1 text-[10.5px] font-semibold uppercase">minus</span></span>;
  if (t.jenis === "NOL_TERVERIFIKASI") return <span className="font-semibold text-ink2" data-testid="saldo-nol-terverifikasi">0<span className="ml-1 text-[10.5px] font-semibold text-green">terverifikasi</span></span>;
  if (t.jenis === "NOL") return <span className="font-semibold text-ink2" data-testid="saldo-nol-pergerakan">0<span className="ml-1 text-[10.5px] font-normal text-ink3">{t.label ?? "habis"}</span></span>;
  return <span className={inline ? "font-semibold text-ink" : "font-semibold text-ink"}>{t.teks}</span>;
}
// Harga Berlaku (HPP operasional per satuan stok) dari fitur Harga Berlaku. Bahan tanpa harga: "Belum ada harga berlaku" — BUKAN Rp0. Bukan nilai persediaan Finance.
function HargaSel({ peta, r }) {
  const h = tampilHargaDaftar(peta, r.materialId);
  if (!h) return null;
  if (!h.ada) return <span className="text-[11.5px] italic text-ink3" data-testid="harga-daftar" data-ada="0">{h.teks}{h.sub && <span className="block not-italic">{h.sub}</span>}</span>;
  return <span data-testid="harga-daftar" data-ada="1" title={`${h.label} — HPP operasional per satuan stok, bukan nilai persediaan Finance`}><span className="font-semibold text-ink">Rp{Number(h.harga).toLocaleString("id-ID", { maximumFractionDigits: 4 })}</span><span className="ml-0.5 text-[10.5px] text-ink3">/ {h.satuan}</span></span>;
}
const LabelKelompok = ({ r }) => (r.kelompok?.kode === "BELUM"
  ? <span className="rounded-chip bg-orangebg px-1.5 py-0.5 text-[10.5px] font-semibold text-orange" title={r.kelompok?.alasan} data-testid="kelompok-baris" data-kode="BELUM">Belum dikelompokkan</span>
  : <span className="rounded-chip bg-inset px-1.5 py-0.5 text-[10.5px] font-semibold text-ink2" data-testid="kelompok-baris" data-kode={r.kelompok?.kode}>{r.kelompok?.label ?? "—"}</span>);

export default function WarehouseInventory() {
  const [data, setData] = useState(null); const [stok, setStok] = useState(null); const [harga, setHarga] = useState(null); // harga = null: tanpa izin Finance / gagal muat -> kolom harga disembunyikan
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [f, ubahF, ubahBanyak] = useFilterDaftar(PATH, KUNCI);
  const { kelompok, jenis, q: cari, keadaan } = f; const nonaktif = f.nonaktif === "1"; const semua = f.semua === "1";
  const [selected, setSelected] = useState(null); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    Promise.all([api.getStokLokasi(), api.getStock()]).then(([a, b]) => { setData(a); setStok(new Map(b.map((x) => [x.materialId, x]))); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    api.getRingkasanDaftarHargaBerlaku().then(setHarga).catch(() => setHarga(null)); // tanpa izin Finance -> kolom harga disembunyikan
  }, []);
  useEffect(() => { load(); }, [load]);

  const tampil = daftarTampil({ kelompok, cari, keadaan, jenis, semua: f.semua });
  const terfilter = useMemo(() => (data ? saringStok(data.rows, { jenis, kelompok, cari, keadaan, nonaktif }) : null), [data, jenis, kelompok, cari, keadaan, nonaktif]);
  const ringkas = data?.ringkasan; const k = ringkas?.kesimpulan; const grup = data?.kelompok?.kelompok ?? []; const jenisN = data?.kelompok?.jenis ?? [];
  const labelKelompok = grup.find((g) => g.kode === kelompok)?.label ?? "";
  const cakupan = jangkauanCari({ kelompok, cari, labelKelompok });
  const kosong = !loading && tampil && terfilter && terfilter.length === 0;
  const pilihKelompok = (kode) => ubahBanyak({ kelompok: kode, q: "", jenis: "", keadaan: "", semua: "" });
  const pilihPerhatian = (patch) => ubahBanyak({ kelompok: "", jenis: "", q: "", keadaan: "", semua: "", ...patch });
  const kembaliSemua = () => ubahBanyak({ kelompok: "", jenis: "", q: "", keadaan: "", nonaktif: "", semua: "" });
  const belum = grup.find((g) => g.kode === "BELUM");

  return (
    <PageContainer>
      <PageHeader
        title="Stok & Lokasi"
        subtitle="Cari bahan, lihat saldo, satuan, lokasi, dan dari mana angkanya."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={14} /> Tambah Bahan</Button>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <Input type="search" value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari bahan di semua kelompok: kode, nama, atau vendor" aria-label="Cari bahan" className="h-11 pl-9 text-[14px]" autoFocus data-testid="cari-bahan" />
          </div>
          <select value={keadaan} onChange={(e) => ubahF("keadaan", e.target.value)} aria-label="Saring keadaan stok" data-testid="saring-keadaan" className="h-11 min-w-0 flex-1 rounded-btn sm:flex-none border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent">
            {FILTER_KEADAAN.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={nonaktif} onChange={(e) => ubahF("nonaktif", e.target.checked ? "1" : "")} data-testid="tampilkan-nonaktif" /> Tampilkan nonaktif</label>
        </div>

        {ringkas && (
          <div className="space-y-2" data-testid="ringkasan-stok">
            <p className="m-0 text-[12px] text-ink2" data-testid="ringkasan-ringkas"><strong className="text-ink" data-testid="n-aktif">{ringkas.aktif}</strong> bahan aktif · {ringkas.ada} ada stok{ringkas.nonaktif > 0 && <> · {ringkas.nonaktif} nonaktif disembunyikan</>} <span className="hidden" data-testid="n-terdaftar">{ringkas.terdaftar}</span></p>
            <div className="flex flex-wrap gap-2" data-testid="perhatian">
              {ringkas.minus > 0 && <button type="button" onClick={() => pilihPerhatian({ keadaan: "MINUS" })} data-testid="perhatian-minus" className="inline-flex items-center gap-1.5 rounded-chip bg-redbg px-3 py-1.5 text-[12px] font-semibold text-red max-sm:min-h-11"><strong>{ringkas.minus}</strong> bersaldo minus<span className="max-sm:hidden"> — perlu dihitung fisik</span></button>}
              {ringkas.belumAdaCatatan > 0 && <button type="button" onClick={() => pilihPerhatian({ keadaan: "BELUM_ADA_CATATAN" })} data-testid="perhatian-belum" className="inline-flex items-center gap-1.5 rounded-chip bg-inset px-3 py-1.5 text-[12px] font-semibold text-ink2 max-sm:min-h-11"><strong>{ringkas.belumAdaCatatan}</strong> belum ada catatan<span className="max-sm:hidden"> stok (bukan berarti habis)</span></button>}
              {belum && belum.total > 0 && <button type="button" onClick={() => pilihKelompok("BELUM")} data-testid="perhatian-kelompok" className="inline-flex items-center gap-1.5 rounded-chip bg-orangebg px-3 py-1.5 text-[12px] font-semibold text-orange max-sm:min-h-11"><strong>{belum.total}</strong> belum dikelompokkan</button>}
            </div>
            <details className="text-[11.5px] text-ink2" data-testid="rincian-ringkasan">
              <summary className="cursor-pointer list-none font-semibold text-ink3 max-sm:flex max-sm:min-h-11 max-sm:items-center">Rincian angka dan catatan sumber</summary>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                <span><strong className="text-ink">{ringkas.terdaftar}</strong> bahan terdaftar</span>
                <span><strong className="text-ink">{ringkas.ada}</strong> ada stok</span>
                <span><strong className="text-ink">{ringkas.belumAdaCatatan}</strong> belum ada catatan stok</span>
                <span><strong className="text-ink">{ringkas.nolTerhitung}</strong> nol menurut pergerakan</span>
                <span><strong className="text-ink">{ringkas.minus}</strong> bersaldo minus</span>
              </div>
              <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0" data-testid="kesimpulan-stok">
                {k.belumDiketahui && <li>• {k.belumDiketahui}.</li>}
                {k.minus && <li>• {k.minus}.</li>}
                <li>• {k.reorder}.</li>
                {belum && belum.total > 0 && <li>• {belum.total} bahan belum dikelompokkan: itemGroup-nya kosong atau berisi bahan campuran — perlu keputusan manual (tidak ditebak dari nama).</li>}
              </ul>
              <p className="m-0 mt-1.5 flex items-start gap-1 text-ink3" data-testid="catatan-sumber"><Info size={12} className="mt-px shrink-0" aria-hidden /> {data.catatan}</p>
            </details>
          </div>
        )}

        {grup.length > 0 && (
          <section aria-label="Pilih kelompok bahan" className="space-y-2">
            <KelompokBahanNav kelompok={grup} dipilih={kelompok} onPilih={pilihKelompok} jumlahSemua={ringkas?.aktif} />
          </section>
        )}

        {!tampil && !loading && data && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-inset px-3 py-2.5 text-[12.5px] text-ink2" data-testid="petunjuk-awal">
            <span>Pilih kelompok di atas, atau cari bahan. Pencarian selalu mencari di semua kelompok.</span>
            <Button variant="ghost" size="sm" onClick={() => ubahF("semua", "1")} data-testid="lihat-semua">Lihat semua {ringkas?.aktif} bahan</Button>
          </div>
        )}

        {tampil && (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="jejak-kelompok">
              <button type="button" onClick={kembaliSemua} data-testid="kembali-semua" className="inline-flex items-center gap-1 rounded-chip px-2 py-1 text-[12px] font-semibold text-accent hover:bg-hovertint max-sm:min-h-11">← Semua kelompok</button>
              <span className="inline-flex items-center gap-1 text-[12px] text-ink2" data-testid="cakupan" data-mode={cakupan.mode}><ChevronRight size={12} className="text-ink3" aria-hidden />{cakupan.teks}</span>
              {keadaan && <span className="inline-flex items-center gap-1 rounded-chip bg-inset px-2 py-1 text-[11.5px] font-semibold text-ink2">{FILTER_KEADAAN.find((x) => x.key === keadaan)?.label}<button type="button" aria-label="Hapus saringan keadaan" onClick={() => ubahF("keadaan", "")} className="ml-0.5 text-ink3 hover:text-ink"><X size={11} /></button></span>}
              {cari && <button type="button" onClick={() => ubahF("q", "")} data-testid="hapus-cari" className="inline-flex items-center gap-1 rounded-chip bg-inset px-2 py-1 text-[11.5px] font-semibold text-ink2 max-sm:min-h-11">“{cari}” <X size={11} aria-hidden /></button>}
              <span className="ml-auto flex items-center gap-2">
                {!cari && <label className="flex items-center gap-1 text-[11.5px] text-ink3">Jenis
                  <select value={jenis} onChange={(e) => ubahF("jenis", e.target.value)} aria-label="Jenis persediaan" data-testid="saring-jenis" className="rounded-btn border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent max-sm:min-h-11">
                    {FILTER_JENIS.map((x) => { const n = jenisN.find((y) => kunciJenis(y.kode) === x.key); return <option key={x.key} value={x.key}>{x.label}{x.key && n ? ` (${n.total}${n.nonaktif ? `+${n.nonaktif} nonaktif` : ""})` : ""}</option>; })}
                  </select></label>}
                {terfilter && <span className="whitespace-nowrap text-[11.5px] text-ink3" data-testid="jumlah-tampil">{terfilter.length} bahan tampil</span>}
              </span>
            </div>

            {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

            <Card className="overflow-hidden p-0">
              {kosong ? (
                <EmptyState icon={Package} title={kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? `Belum ada bahan di kelompok ${labelKelompok}` : "Tidak ada bahan yang cocok"} description={kelompok && !cari && grup.find((g) => g.kode === kelompok)?.total === 0 ? "Tidak ada bahan aktif yang termasuk kelompok ini. Bahan nonaktif bisa ditampilkan lewat kotak di atas." : "Ubah kata kunci, kelompok, atau saringan keadaan stok."} />
              ) : (
                <>
                  <TableWrap className="hidden md:block">
                    <Table>
                      <THead><TR><TH>Bahan</TH><TH>Kelompok</TH><TH numeric>Saldo</TH><TH numeric>Tersedia</TH><TH>Satuan</TH>{harga && <TH numeric title="Harga Berlaku = HPP operasional per satuan stok, bukan nilai persediaan Finance">Harga berlaku</TH>}<TH numeric>Batas minimum</TH><TH title="Riwayat penerimaan, bukan lokasi stok saat ini">Riwayat penerimaan</TH><TH>Keadaan</TH></TR></THead>
                      <TBody>
                        {loading && <TableSkeletonRows rows={8} cols={harga ? 9 : 8} />}
                        {!loading && terfilter?.map((r) => (
                          <TR key={r.materialId} clickable onClick={() => setSelected(stok?.get(r.materialId) ?? null)} data-testid="baris-stok" data-kode={r.kode} title={r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok untuk bahan ini"}>
                            <TD className="min-w-[220px]"><div className="font-semibold text-ink" data-testid="nama-bahan">{r.nama}</div><div className="text-[11px] text-ink3 [overflow-wrap:anywhere]">{r.kode}{r.kategori ? ` · ${CATEGORY_REAL[r.kategori]?.label}` : ""}</div></TD>
                            <TD><LabelKelompok r={r} /></TD>
                            <TD numeric data-testid="sel-saldo" data-jenis={tampilSaldo(r).jenis} title={tampilSaldo(r).keterangan}><SaldoSel r={r} /></TD>
                            <TD numeric className="text-ink2">{r.tersedia === null ? "—" : r.tersedia}</TD>
                            <TD className="text-ink2">{String(r.satuan ?? "").toLowerCase()}</TD>
                            {harga && <TD numeric data-testid="sel-harga"><HargaSel peta={harga} r={r} /></TD>}
                            <TD numeric className="text-ink3" data-testid="sel-minimum">{teksBatasMinimum(r)}</TD>
                            <TD className="whitespace-nowrap text-ink2" data-testid="sel-riwayat-lokasi">{riwayatLokasi(r) ? <span title="Dari riwayat penerimaan. Sistem tidak menyimpan saldo per lokasi, jadi ini bukan lokasi stok saat ini."><MapPin size={11} className="mr-0.5 inline text-ink3" aria-hidden />{riwayatLokasi(r).teks}</span> : <span className="text-ink3">tidak ada riwayat</span>}</TD>
                            <TD className="min-w-[140px]"><Badge variant={warnaKeadaan(r.keadaan)} className="h-auto whitespace-normal text-left leading-tight">{r.keadaanLabel}</Badge></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableWrap>
                  <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
                    {!loading && terfilter?.map((r) => (
                      <li key={r.materialId}>
                        <button type="button" onClick={() => setSelected(stok?.get(r.materialId) ?? null)} data-testid="baris-stok" data-kode={r.kode}
                          className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
                          <div className="flex items-start justify-between gap-2"><span className="text-[12.5px] font-semibold text-ink [overflow-wrap:anywhere]">{r.kode}</span><LabelKelompok r={r} /></div>
                          <div className="mt-0.5 text-[13px] text-ink">{r.nama}</div>
                          <div className="mt-1"><Badge variant={warnaKeadaan(r.keadaan)} className="h-auto whitespace-normal text-left leading-tight">{r.keadaanLabel}</Badge></div>
                          <div className="mt-1 text-[11.5px] text-ink2">Saldo <SaldoSel r={r} inline /> · minimum {teksBatasMinimum(r)}</div>
                          {harga && <div className="mt-0.5 text-[11.5px] text-ink2" data-testid="harga-mobile">Harga berlaku <HargaSel peta={harga} r={r} /></div>}
                          <div className="mt-0.5 text-[11px] text-ink3">{r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok"}</div>
                          {riwayatLokasi(r) && <div className="mt-0.5 text-[11px] text-ink3" data-testid="riwayat-lokasi">{riwayatLokasi(r).teks} — riwayat, bukan lokasi stok saat ini</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </>
        )}
        {error && !tampil && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
      </PageBody>
      <ItemDetailDrawer item={selected} onClose={() => setSelected(null)} onEdit={(it) => { setSelected(null); setEditing(it); setFormOpen(true); }} onChanged={load} />
      <ItemFormModal open={formOpen} item={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={load} />
    </PageContainer>
  );
}
