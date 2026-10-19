import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import ActiveComplaintsWidget from "@/features/complaints/ActiveComplaintsWidget.jsx";
import { api } from "@/api.js";
import { useJendelaFokus } from "@/features/warehouse/dokumen/useJendelaFokus.js";
import { waktuTeks } from "@/features/warehouse/dokumen/dokumenLogic.js";
import BagianAntrean from "@/features/warehouse/pusatkerja/BagianAntrean.jsx";
import DokumenFokus from "@/features/warehouse/pusatkerja/DokumenFokus.jsx";
import PencarianGudang from "@/features/warehouse/pusatkerja/PencarianGudang.jsx";
import { useSumberPusatKerja } from "@/features/warehouse/pusatkerja/usePusatKerja.js";
import { dalamHalaman, urlItem } from "@/features/warehouse/pusatkerja/urlFokus.js";

// BERANDA GUDANG = PUSAT KERJA HARIAN (UX Gudang Tahap 4). Bukan dashboard angka: setiap baris adalah dokumen yang perlu ditindak, dengan alasan mengapa ia muncul, satu tindakan utama,
// dan siapa yang bertindak berikutnya. Semua hitungan datang dari GET /inventory/pusat-kerja (definisi tiap antrean ikut di respons — tombol "Definisi"); halaman ini tidak menghitung ulang
// dan BACA-SAJA: mengetuk kartu atau tombol hanya membuka jendela fokus dokumen (URL /warehouse/dashboard/<jenis>/<id>), Beranda tetap terpasang di belakangnya dengan posisi gulirnya.
const PATH = "/warehouse/dashboard";

export default function WarehouseDashboard() {
  const navigate = useNavigate(); const { jenis, id } = useParams();
  const { data, galat, memuat, muat } = useSumberPusatKerja(() => api.getPusatKerja());
  const { bukaUrl, tutup } = useJendelaFokus(PATH);
  const buka = (item, kodeAksi = null) => { const url = urlItem(PATH, item, kodeAksi); if (!url) return; if (dalamHalaman(PATH, url)) bukaUrl(url); else navigate(url); };
  const versi = data?.dihitungPada;
  const antreanAda = (data?.antrean ?? []).filter((a) => a.jumlah > 0);
  const antreanKosong = (data?.antrean ?? []).filter((a) => a.jumlah === 0);
  const tertahanAda = (data?.tertahan ?? []).filter((s) => s.jumlah > 0);
  const tertahanKosong = (data?.tertahan ?? []).filter((s) => s.jumlah === 0);

  return (
    <PageContainer>
      <PageHeader
        title="Beranda Gudang"
        subtitle="Yang perlu dikerjakan sekarang, dengan alasan dan pemilik tindakannya."
        actions={<Button variant="ghost" size="sm" onClick={() => muat()} disabled={memuat} className="max-sm:min-h-11" data-testid="muat-ulang-beranda"><RefreshCw size={14} className={memuat ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <PencarianGudang onBuka={buka} />
        {galat && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-beranda">{galat}<Button variant="ghost" size="sm" onClick={() => muat()} className="max-sm:min-h-11">Coba lagi</Button></div>}
        {memuat && !data && <div className="space-y-2" aria-busy="true" data-testid="memuat-beranda">{[0, 1, 2].map((n) => <div key={n} className="h-20 animate-pulse rounded-btn bg-inset" />)}</div>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="ringkasan-beranda">
              <Badge variant="accent" data-testid="ringkas-kerja">{data.ringkasan.perluDikerjakan} perlu dikerjakan</Badge>
              <Badge variant={data.ringkasan.tertahan > 0 ? "orange" : "neutral"} data-testid="ringkas-tertahan">{data.ringkasan.tertahan} dokumen terlambat/tertahan</Badge>
              <Link to="/warehouse/perlu-perhatian" className="inline-flex items-center gap-1 font-semibold text-accent max-sm:min-h-11 max-sm:items-center" data-testid="ke-perlu-perhatian"><AlertTriangle size={13} aria-hidden /> Perlu Perhatian <ChevronRight size={13} aria-hidden /></Link>
              <span className="text-[11.5px] text-ink3" data-testid="catatan-beranda">Dihitung {waktuTeks(data.dihitungPada)}. {data.umurDefinisi}</span>
            </div>
            {!data.izin.tulis && <div className="rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="baca-saja">Akun Anda hanya dapat melihat. Tombol tindakan tidak ditampilkan; dokumen tetap bisa dibuka.</div>}

            <section aria-label="Perlu dikerjakan sekarang" className="space-y-4" data-testid="bagian-kerja">
              <h2 className="m-0 text-[15px] font-semibold text-ink">Perlu dikerjakan sekarang</h2>
              {antreanAda.length === 0 && <div className="flex items-center gap-2 rounded-btn bg-greenbg px-3 py-2.5 text-[13px] text-green" data-testid="tidak-ada-tugas"><CheckCircle2 size={15} aria-hidden /> Tidak ada pekerjaan yang menunggu saat ini.</div>}
              {antreanAda.map((a) => <BagianAntrean key={a.kode} antrean={a} versi={versi} ambilLagi={api.getAntreanPusatKerja} onBuka={buka} />)}
              {antreanKosong.length > 0 && antreanAda.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="antrean-kosong">Tidak ada pekerjaan di: {antreanKosong.map((a) => a.judul).join(" · ")}.</p>}
              {data.ringkasan.produksiV2 !== "AKTIF" && <p className="m-0 text-[12px] text-ink3" data-testid="catatan-produksi-v2">Antrean Produksi (bahan, unit masuk, barang jadi, kekurangan) tidak dihitung di sini karena pembaca Produksi V2 belum aktif; lihat menu Produksi bila sudah diaktifkan.</p>}
            </section>

            <section aria-label="Terlambat atau tertahan" className="space-y-4" data-testid="bagian-tertahan">
              <h2 className="m-0 text-[15px] font-semibold text-ink">Terlambat atau tertahan</h2>
              <p className="m-0 text-[12px] text-ink3">Dipisah menurut penyebab nyata. “Terlambat” hanya dipakai bila ada tanggal sah yang sudah lewat; umur antrean bukan SLA.</p>
              {tertahanAda.length === 0 && <div className="flex items-center gap-2 rounded-btn bg-greenbg px-3 py-2.5 text-[13px] text-green" data-testid="tidak-ada-tertahan"><CheckCircle2 size={15} aria-hidden /> Tidak ada dokumen yang terlambat atau tertahan.</div>}
              {tertahanAda.map((s) => <BagianAntrean key={s.kode} antrean={s} versi={versi} ambilLagi={api.getTertahanPusatKerja} onBuka={buka} tampilSebab />)}
              {tertahanKosong.length > 0 && tertahanAda.length > 0 && <p className="m-0 text-[12px] text-ink3">Tidak ada: {tertahanKosong.map((s) => s.judul).join(" · ")}.</p>}
              {(data.tidakDihitung ?? []).map((t) => <p key={t.kode} className="m-0 text-[11.5px] text-ink3" data-testid={`tidak-dihitung-${t.kode}`}>Tidak dihitung — {t.kode === "KONFLIK_REVISI" ? "konflik revisi" : t.kode}: {t.alasan}</p>)}
            </section>

            <section aria-label="Selesai terbaru" className="space-y-2" data-testid="bagian-selesai">
              <h2 className="m-0 text-[15px] font-semibold text-ink">Selesai terbaru</h2>
              {data.selesaiTerbaru.length === 0 ? <p className="m-0 text-[12.5px] text-ink3">Belum ada dokumen yang selesai dalam 7 hari terakhir.</p> : (
                <Card className="p-0">
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {data.selesaiTerbaru.map((s) => (
                      <li key={s.kunci}>
                        <button type="button" onClick={() => buka(s, null)} className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3.5 py-2.5 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11" data-testid="baris-selesai">
                          <span className="text-[13px] font-semibold text-ink">{s.nomor}</span>
                          <span className="text-[12.5px] text-ink2">{s.teks}{s.oleh ? ` · ${s.oleh}` : ""}</span>
                          <span className="ml-auto text-[11.5px] text-ink3">{waktuTeks(s.waktu)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>

            <ActiveComplaintsWidget currentOwner="WAREHOUSE" title="Kasus Komplain Butuh Material" />
            <p className="m-0 text-[11.5px] text-ink3">Angka stok per bahan, bahan tanpa catatan, dan batas minimum ada di <Link to="/warehouse/inventory" className="font-semibold text-accent">Stok &amp; Lokasi</Link>.</p>
          </>
        )}
      </PageBody>
      <DokumenFokus jenis={jenis} id={id} onTutup={tutup} onBerubah={() => muat(true)} />
    </PageContainer>
  );
}
