import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IkCari, IkMuatUlang, IkPanah, IkTruk } from "@/components/gudangIcons.jsx";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { useFilterDaftar, querySaringan } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import { cn } from "@/lib/utils.js";
import DetailPO from "@/features/kedatangan/DetailPOFokus.jsx";
import { STATUS_AKAN_DATANG, TAB_AKAN_DATANG, jumlahTeks, tanggalTeks, ringkasKuantitas } from "@/features/kedatangan/kedatanganLogic.js";

// BARANG AKAN DATANG (Gudang) — PO bahan baku yang sama dengan Finance, TANPA harga, total, utang, atau pembayaran.
// Gudang melihat apa yang dipesan, kapan diperkirakan datang, apa yang sudah datang, dan mencatat barang tiba. Memeriksa baik/ditolak dan Simpan ke Stok tetap di Penerimaan Barang.
// Angka dan status dihitung server (satu sumber); halaman ini hanya menampilkan.
const BadgeStatus = ({ kode, label }) => <span className="gud-pill" data-warna={STATUS_AKAN_DATANG[kode]?.variant || "neutral"}>{label ?? STATUS_AKAN_DATANG[kode]?.label ?? kode}</span>;

const PATH = "/warehouse/barang-akan-datang";
const KUNCI = ["tab", "q"];
// Detail PO = JENDELA FOKUS berbasis rute (/warehouse/barang-akan-datang/:id): daftar tetap terpasang di belakangnya, saringan dan pencarian ikut di URL, Back/Esc menutup.
export default function WarehouseBarangAkanDatang() {
  const navigate = useNavigate(); const { id: bukaId } = useParams(); const jarak = React.useRef(0);
  const [saring, ubahSaring] = useFilterDaftar(PATH, KUNCI); const tab = saring.tab; const q = saring.q;
  const setTab = (v) => ubahSaring("tab", v); const setQ = (v) => ubahSaring("q", v);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const saringan = querySaringan(saring, KUNCI);
  const setBukaId = (rid) => { jarak.current = 1; navigate(`${PATH}/${rid}${saringan}`); };
  const tutup = () => { if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${PATH}${saringan}`, { replace: true }); };

  const muat = useCallback(() => {
    setLoading(true); setError("");
    return api.getBarangAkanDatang({ status: tab || undefined, q: q.trim() || undefined })
      .then(setData).catch((e) => setError(e.message || "Gagal memuat")).finally(() => setLoading(false));
  }, [tab, q]);
  useEffect(() => { const t = setTimeout(muat, q ? 250 : 0); return () => clearTimeout(t); }, [muat, q]);

  const rows = data?.purchaseOrders ?? [];
  const kosong = !loading && data && rows.length === 0;

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={cn("gud-split", bukaId && "gud-split-buka")} data-testid="ruang-akan-datang">
        <section className="gud-panel gud-daftar" aria-label="Daftar barang akan datang">
          <header className="gud-kepala">
            <div className="gud-judul">
              <h1 className="page-title">Barang akan datang</h1>
              <p className="page-subtitle">PO bahan baku dari Finance: yang ditunggu, yang sudah tiba, dan yang siap disimpan. Tanpa harga atau nilai.</p>
            </div>
            <div className="gud-aksi-kepala">
              <button type="button" className="gud-tombol-ikon" onClick={muat} disabled={loading} aria-label="Muat ulang daftar" title="Muat ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : ""} /></button>
            </div>
          </header>

          <div className="gud-cari">
            <IkCari size={16} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor PO, supplier, atau nama barang..." aria-label="Cari PO" />
          </div>
          <div role="tablist" aria-label="Saring status barang akan datang" className="gud-tab gud-tab-lipat">
            {TAB_AKAN_DATANG.map((t) => {
              const jml = t.key ? data?.hitungan?.[t.key] : null;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} data-testid={`tab-${t.key || "semua"}`} className="max-sm:min-h-11">
                  {t.label}{jml != null && <span className="gud-tab-jumlah" data-testid={`hitung-${t.key}`}>{jml}</span>}
                </button>
              );
            })}
          </div>
          {error && <p role="alert" className="gud-galat">{error}</p>}

          {kosong ? (
            <div className="gud-kosong">
              <IkTruk size={28} aria-hidden />
              <h2>Belum ada barang yang akan datang</h2>
              <p>{tab ? "Tidak ada PO pada status ini." : "PO yang disetujui Finance akan muncul di sini."}</p>
            </div>
          ) : (
            <>
              <div className="gud-tabel-bungkus hidden md:block">
                <table className="gud-tabel">
                  <thead><tr><th scope="col">PO &amp; supplier</th><th scope="col">Estimasi tiba</th><th scope="col" className="gud-kol-lebar">Progres</th><th scope="col">Status</th><th scope="col" className="gud-kol-lebar">Pengiriman</th><th scope="col" aria-label="Buka" /></tr></thead>
                  <tbody>
                    {loading && !data && Array.from({ length: 5 }, (_, n) => <tr key={n} className="gud-rangka"><td colSpan={6}><span /></td></tr>)}
                    {rows.map((po) => {
                      const r = ringkasKuantitas(po);
                      return (
                        <tr key={po.id} onClick={() => setBukaId(po.id)} data-aktif={po.id === bukaId ? "ya" : undefined} data-testid="baris-po" data-po={po.poNumber}>
                          <td><span className="gud-nomor">{po.poNumber}</span><span className="gud-sekunder">{po.supplier?.name}</span></td>
                          <td className="gud-jadwal">{tanggalTeks(po.expectedDate)}{po.hariTerlambat > 0 && <span className="gud-petunjuk gud-petunjuk-awas">lewat {po.hariTerlambat} hari</span>}</td>
                          <td className="gud-kol-lebar"><span className="gud-sekunder gud-angka">{r.teks}</span></td>
                          <td>
                            <div className="gud-pil-baris" data-testid="status-po">
                              <BadgeStatus kode={po.statusAkanDatang.kode} label={po.statusAkanDatang.label} />
                              {po.bendera.filter((b) => b.kode !== po.statusAkanDatang.kode).map((b) => <BadgeStatus key={b.kode} kode={b.kode} label={b.label} />)}
                            </div>
                          </td>
                          <td className="gud-angka gud-kol-lebar">{po.penerimaan.length}</td>
                          <td className="gud-buka"><IkPanah size={16} aria-hidden /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="gud-kartu-daftar md:hidden">
                {rows.map((po) => {
                  const r = ringkasKuantitas(po);
                  return (
                    <li key={po.id}>
                      <button type="button" onClick={() => setBukaId(po.id)} className="gud-kartu max-sm:min-h-11" data-testid="baris-po" data-po={po.poNumber}>
                        <span className="gud-kartu-atas"><span className="gud-nomor">{po.poNumber}</span><span className="gud-kartu-status"><BadgeStatus kode={po.statusAkanDatang.kode} label={po.statusAkanDatang.label} /></span></span>
                        <span className="gud-sekunder">{po.supplier?.name}</span>
                        <span className="gud-sekunder">Estimasi tiba {tanggalTeks(po.expectedDate)}{po.hariTerlambat > 0 && <span className="gud-petunjuk-awas"> · lewat {po.hariTerlambat} hari</span>}</span>
                        <span className="gud-sekunder gud-angka">{r.teks}</span>
                        <span className="gud-pil-baris">{po.bendera.filter((b) => b.kode !== po.statusAkanDatang.kode).map((b) => <BadgeStatus key={b.kode} kode={b.kode} label={b.label} />)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
        {bukaId && <DetailPO id={bukaId} onClose={tutup} onChanged={muat} tempel />}
      </div>
    </PageContainer>
  );
}
