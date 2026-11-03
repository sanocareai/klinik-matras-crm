import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { cn } from "@/lib/utils.js";
import { IkCari, IkKotak, IkMuatUlang, IkPanah, IkTambah, IkTutup } from "@/components/gudangIcons.jsx";
import { useFilterDaftar, querySaringan } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import GoodsReceiptFormModal from "@/features/warehouse/components/GoodsReceiptFormModal.jsx";
import SumberPO from "@/features/warehouse/components/SumberPO.jsx";
import PenerimaanDetail from "@/features/warehouse/penerimaan/PenerimaanDetail.jsx";
import {
  SARINGAN_JADWAL, TAB_PENERIMAAN, TAHAP_FILTER, diLuarDaftar, tabUntukDokumen, cocokCari, cocokJadwal, daftarSupplier, filterTab, filterTahap, hitungPerTab, identitasPenerimaan, lewatJadwal, perluTindakan, tabAktif, tahapUntukTab, tanggalPendek,
} from "@/features/warehouse/penerimaan/penerimaanLogic.js";

// PENERIMAAN BARANG (redesain Gudang, 3 Nov 2026) — ruang pemeriksaan: daftar di kiri, detail dokumen di kanan (layar lebar) sehingga konteks tidak hilang saat memeriksa barang.
// Tab: Perlu tindakan (bawaan) · Menunggu kedatangan · Semua · Selesai — riwayat tetap mudah dibuka. Saringan Tahap/Supplier/Jadwal + pencarian tersimpan di URL (bertahan saat muat ulang).
// Status, tahap, dan tindakan berikutnya SELALU dari server (`tampilan`); halaman ini tidak menghitung sendiri. Detail dibuka lewat rute (/warehouse/goods-receipt/:id): ≥1200px menempel di kanan,
// lebih sempit menjadi jendela fokus (tanpa mengubah perilaku Back/Esc/Tutup). Tidak ada perubahan data, izin, atau endpoint.
const PATH = "/warehouse/goods-receipt";
const KUNCI = ["tab", "tahap", "q", "supplier", "jadwal"];

function StatusPenerimaan({ r }) {
  const t = r.tampilan;
  return (
    <div className="gud-status">
      <span className="gud-pill" data-warna={t?.warna ?? "neutral"} data-testid="status-baris" title={t?.label}>{labelTahap(t) ?? r.status}</span>
      {t?.pengaruhStok === "BELUM" && ["DRAFT", "SCHEDULED"].includes(r.status) && <span className="gud-petunjuk">Belum memengaruhi stok</span>}
    </div>
  );
}
// Pil memakai nama tahap pendek dari alur server (mis. "Pemeriksaan"); kalimat panjang server ("Barang tiba — perlu diperiksa") tetap jadi tooltip dan ada di detail. Dokumen berhenti (dibatalkan/ditolak) memakai labelnya.
const labelTahap = (t) => { const p = t?.pipeline; return p && p.indeks !== null && p.indeks !== undefined ? p.tahap[p.indeks]?.label ?? t.label : t?.label; };
const Berikutnya = ({ r }) => <span className={cn("gud-berikutnya", perluTindakan(r) && "gud-berikutnya-utama")} data-testid="tindakan-berikutnya">{r.tampilan?.berikutnya ?? "—"}</span>;
const Jadwal = ({ r }) => (
  <>
    <span>{r.expectedDate ? tanggalPendek(r.expectedDate) : "—"}</span>
    {lewatJadwal(r) && <span className="gud-petunjuk gud-petunjuk-awas" data-testid="lewat-jadwal">Lewat jadwal</span>}
  </>
);

export default function WarehouseGoodsReceipt() {
  const navigate = useNavigate(); const { id } = useParams(); const { search } = useLocation();
  const [sp] = useSearchParams();
  const [f, ubahF, ubahBanyak] = useFilterDaftar(PATH, KUNCI); const cari = f.q; const tahap = f.tahap; const tab = tabAktif(f.tab, tahap);
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const jarak = useRef(0); // berapa langkah riwayat dari daftar ke detail (agar menutup kembali ke daftar, bukan ke dokumen sebelumnya)

  // Tautan lama "?buka=<id>" (mis. dari Barang Akan Datang) → detail.
  useEffect(() => { const b = sp.get("buka"); if (b) navigate(`${PATH}/${b}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam dibaca sekali saat halaman dibuka

  const load = useCallback((tenang = false) => {
    if (!tenang) setLoading(true); setError("");
    api.getGoodsReceipts({}).then((d) => setRows(d.receipts)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const hitung = useMemo(() => (rows ? hitungPerTab(rows) : {}), [rows]);
  const supplier = useMemo(() => daftarSupplier(rows), [rows]);
  const terfilter = useMemo(
    () => (rows ? filterTahap(filterTab(rows, tab), tahap).filter((r) => cocokCari(r, cari) && (!f.supplier || (r.supplier ?? "").trim() === f.supplier) && cocokJadwal(r, f.jadwal)) : null),
    [rows, tab, tahap, cari, f.supplier, f.jadwal],
  );
  const kosong = !loading && terfilter && terfilter.length === 0;
  const saringan = querySaringan(f, KUNCI);
  const buka = (rid) => { jarak.current = 1; navigate(`${PATH}/${rid}${saringan}`); };
  const tutup = () => { if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${PATH}${saringan}`, { replace: true }); };
  const memantik = (e, rid) => { if (e.type === "keydown" && !["Enter", " "].includes(e.key)) return; e.preventDefault(); buka(rid); };
  const perluDitindak = hitung.tindakan ?? 0;

  const tahapLama = TAHAP_FILTER.find((t) => t.key === tahap);
  const pilihanTahap = tahapUntukTab(tab);
  const tahapDiluarPilihan = tahap && !pilihanTahap.some((t) => t.key === tahap) ? tahapLama : null; // tautan lama (mis. "belum-masuk-stok") tetap tampil sebagai pilihan aktif
  const chip = [
    tahap && { k: "tahap", label: `Tahap: ${tahapLama?.label ?? tahap}` },
    f.supplier && { k: "supplier", label: `Supplier: ${f.supplier}` },
    f.jadwal && { k: "jadwal", label: SARINGAN_JADWAL.find((j) => j.key === f.jadwal)?.label ?? f.jadwal },
    cari && { k: "q", label: `Kata kunci: ${cari}` },
  ].filter(Boolean);
  const gantiTab = (k) => ubahBanyak({ tab: k === "tindakan" ? "" : k, tahap: "" });
  // Dokumen yang dibuka (lewat tautan/riwayat/PO) bisa tidak ikut hasil daftar saat ini: beri tahu + satu klik untuk menampilkannya di daftar (tab sesuai status, saringan lain dikosongkan).
  const dokBuka = rows && id ? rows.find((x) => x.id === id) ?? null : null;
  const luarDaftar = diLuarDaftar(id, rows, terfilter);
  const tampilkanDiDaftar = () => { const k = tabUntukDokumen(dokBuka); ubahBanyak({ tab: k === "tindakan" ? "" : k, tahap: "", q: "", supplier: "", jadwal: "" }); };
  const reset = () => ubahBanyak({ tahap: "", supplier: "", jadwal: "", q: "" });

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={cn("gud-split", id && "gud-split-buka")} data-testid="ruang-penerimaan">
        <section className="gud-panel gud-daftar" aria-label="Daftar penerimaan barang">
          <header className="gud-kepala">
            <div className="gud-judul">
              <h1 className="page-title">Penerimaan barang</h1>
              <p className="page-subtitle">Periksa barang yang tiba, lalu simpan ke stok.</p>
            </div>
            <div className="gud-aksi-kepala">
              <button type="button" className="gud-tombol-ikon" onClick={() => load()} disabled={loading} aria-label="Muat ulang daftar" title="Muat ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : ""} /></button>
              <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => setFormOpen(true)}><IkTambah size={16} /> Penerimaan baru</button>
            </div>
          </header>

          <p className="gud-alur" data-testid="alur-ringkas"><Link to="/warehouse/barang-akan-datang">PO yang ditunggu ada di Barang Akan Datang</Link>; di sini Anda memeriksa barang dan memasukkannya ke stok.{rows && perluDitindak > 0 && <> <strong>{perluDitindak} dokumen menunggu tindakan Anda.</strong></>}</p>

          {luarDaftar && (
            <div className="gud-luar-daftar" role="note" data-testid="di-luar-daftar">
              <span><strong>{dokBuka?.receiptNumber}</strong> tidak termasuk dalam tampilan daftar ini (tab atau saringan yang aktif). Dokumen tetap terbuka di sebelah kanan.</span>
              <button type="button" className="gud-tombol" onClick={tampilkanDiDaftar} data-testid="tampilkan-di-daftar">Tampilkan di daftar</button>
            </div>
          )}

          <div className="gud-cari">
            <IkCari size={16} aria-hidden />
            <input value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari GR, PO, supplier, atau bahan..." aria-label="Cari penerimaan" />
          </div>

          <div role="tablist" aria-label="Kelompok penerimaan" className="gud-tab gud-tab-lipat" data-testid="pipeline-daftar">
            {TAB_PENERIMAAN.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => gantiTab(t.key)} data-testid={`tab-${t.key}`} className="max-sm:min-h-11">
                {t.label}<span className="gud-tab-jumlah">{rows ? hitung[t.key] ?? 0 : "–"}</span>
              </button>
            ))}
          </div>

          <div className="gud-saring">
            <label className="gud-pilih"><span className="gud-sr">Tahap</span>
              <select value={tahap} onChange={(e) => ubahF("tahap", e.target.value)} aria-label="Saring menurut tahap" data-testid="saring-tahap">
                <option value="">Semua tahap</option>
                {tahapDiluarPilihan && <option value={tahapDiluarPilihan.key}>{tahapDiluarPilihan.label}</option>}
                {pilihanTahap.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="gud-pilih"><span className="gud-sr">Supplier</span>
              <select value={f.supplier} onChange={(e) => ubahF("supplier", e.target.value)} aria-label="Saring menurut supplier" data-testid="saring-supplier">
                <option value="">Semua supplier</option>
                {f.supplier && !supplier.includes(f.supplier) && <option value={f.supplier}>{f.supplier}</option>}
                {supplier.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="gud-pilih"><span className="gud-sr">Jadwal</span>
              <select value={f.jadwal} onChange={(e) => ubahF("jadwal", e.target.value)} aria-label="Saring menurut jadwal" data-testid="saring-jadwal">
                {SARINGAN_JADWAL.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
              </select>
            </label>
          </div>
          {chip.length > 0 && (
            <div className="gud-chip-baris" data-testid="saringan-aktif">
              {chip.map((c) => <span key={c.k} className="gud-chip">{c.label}<button type="button" onClick={() => ubahF(c.k, "")} aria-label={`Hapus saringan ${c.label}`}><IkTutup size={12} /></button></span>)}
              <button type="button" className="gud-tautan" onClick={reset} data-testid="saringan-reset">Reset</button>
            </div>
          )}
          {tahapLama?.lama && <p className="gud-petunjuk m-0" data-testid="saringan-lama">Saringan dari tautan lama: {tahapLama.label}. Pilih tahap di atas untuk menyaring lebih rinci.</p>}
          {error && <div role="alert" className="gud-galat">{error}</div>}

          {kosong ? (
            <div className="gud-kosong" data-testid="daftar-kosong">
              <IkKotak size={28} aria-hidden />
              <h2>{cari || tahap || f.supplier || f.jadwal ? "Tidak ada penerimaan yang cocok" : tab === "tindakan" ? "Tidak ada penerimaan yang perlu ditindak" : "Belum ada penerimaan di sini"}</h2>
              <p>{cari || tahap || f.supplier || f.jadwal ? "Ubah pencarian atau saringan." : tab === "tindakan" ? "Dokumen yang menunggu pemeriksaan atau penyimpanan akan muncul di sini. Riwayat ada di tab Semua dan Selesai." : "Penerimaan dari PO, supplier, atau retur akan tampil di sini."}</p>
              {chip.length > 0 ? <button type="button" className="gud-tombol" onClick={reset}>Reset saringan</button> : <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => setFormOpen(true)}><IkTambah size={16} /> Penerimaan baru</button>}
            </div>
          ) : (
            <>
              <div className="gud-tabel-bungkus hidden md:block">
                <table className="gud-tabel">
                  <thead><tr><th scope="col">Dokumen &amp; supplier</th><th scope="col" className="gud-kol-lebar">No. PO</th><th scope="col">Jadwal</th><th scope="col">Tahap</th><th scope="col" aria-label="Buka" /></tr></thead>
                  <tbody>
                    {loading && Array.from({ length: 5 }, (_, n) => <tr key={n} className="gud-rangka"><td colSpan={5}><span /></td></tr>)}
                    {!loading && terfilter?.map((r) => {
                      const i = identitasPenerimaan(r);
                      return (
                        <tr key={r.id} onClick={() => buka(r.id)} data-aktif={r.id === id ? "ya" : undefined} aria-selected={r.id === id} data-testid="baris-penerimaan" data-nomor={r.receiptNumber} data-status={r.status}>
                          <td><a href={`${PATH}/${r.id}`} onClick={(e) => memantik(e, r.id)} className="gud-nomor">{r.receiptNumber}</a><span className="gud-sekunder">{r.supplier || "supplier belum diisi"}</span>{i.nomorPO && <span className="gud-sekunder gud-kol-sempit">{i.nomorPO}</span>}</td>
                          <td className="gud-kol-lebar"><span className="gud-nomor-po">{i.nomorPO ?? "—"}</span> <SumberPO receipt={r} className="gud-sumber" /></td>
                          <td className="gud-jadwal"><Jadwal r={r} /></td>
                          <td><StatusPenerimaan r={r} /><Berikutnya r={r} /></td>
                          <td className="gud-buka"><IkPanah size={16} aria-hidden /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="gud-kartu-daftar md:hidden">
                {!loading && terfilter?.map((r) => {
                  const i = identitasPenerimaan(r);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => buka(r.id)} className="gud-kartu max-sm:min-h-11" data-testid="baris-penerimaan" data-nomor={r.receiptNumber} data-status={r.status}>
                        <span className="gud-kartu-atas"><span className="gud-nomor">{r.receiptNumber}</span><SumberPO receipt={r} /><span className="gud-kartu-status"><StatusPenerimaan r={r} /></span></span>
                        <span className="gud-sekunder">{i.nomorPO ? <>{/^PO/i.test(i.nomorPO) ? i.nomorPO : `PO ${i.nomorPO}`} · </> : null}{r.supplier || "—"}</span>
                        <span className="gud-sekunder">{r.lines.length} item · jadwal <Jadwal r={r} /></span>
                        <span className="gud-sekunder">Berikutnya: <Berikutnya r={r} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
        {id && <PenerimaanDetail key="fokus" id={id} onTutup={tutup} onBerubah={() => load(true)} saringan={saringan} tempel />}
      </div>
      <GoodsReceiptFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(g) => { load(); if (g?.id) buka(g.id); }} />
    </PageContainer>
  );
}
