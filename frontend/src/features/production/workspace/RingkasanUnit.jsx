import React, { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, ExternalLink, HeartPulse, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
import { KartuPenerimaan, TindakanUtama } from "@/features/production/OrderProduksiPanel.jsx";
import { badgeTarget, teksTahapMeja } from "@/features/production/workspace/workListModel.js";
import { formatJumlah, nadaBadge, waktuWib } from "@/features/production/orderProduksiModel.js";
import { ringkasBahan, ringkasDokumentasi, ringkasPekerjaan } from "@/features/production/bahan/bahanModel.js";
import "@/features/production/bahan/bahan.css";
import { formatTanggal } from "@/utils/formatDate.js";

// RINGKASAN UNIT — yang perlu dilihat Admin dulu: tindakan berikutnya, pekerjaan (status kerja, jadwal, target, PIC), detail order (kondisi pelanggan, keluhan, catatan produksi, komplain),
// cuplikan Bahan (dua sumber TERPISAH) dan Dokumentasi. Tiap cuplikan membuka bagian detailnya. Data kosong = satu kalimat langkah berikutnya, bukan kartu kosong besar.
// Di HP: tindakan → pekerjaan → detail order → bahan → dokumentasi (satu kolom). Di desktop: kolom kiri tindakan/pekerjaan/bahan/dokumentasi, kolom kanan detail order.

function Kartu({ judul, aksi, children, testid, className }) {
  return (
    <section className={cn("rounded-card border border-line bg-surface px-4 py-3.5", className)} data-testid={testid} aria-label={judul}>
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink3">{judul}</h3>{aksi}</div>
      {children}
    </section>
  );
}
const Buka = ({ onClick, testid, children }) => <button type="button" onClick={onClick} data-testid={testid} className="inline-flex min-h-[40px] items-center gap-1 rounded-btn px-2 text-[12.5px] font-semibold text-accent outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/50">{children} <ChevronRight size={14} aria-hidden /></button>;
function Fakta({ label, children }) { return <div className="min-w-0"><dt className="m-0 text-[11px] font-medium uppercase tracking-[0.05em] text-ink3">{label}</dt><dd className="m-0 mt-0.5 text-[13.5px] text-ink">{children}</dd></div>; }

export function penjelasanTertahan(data) {
  const t = data?.adopsi?.tindakan; if (!t) return null;
  if (t.aksi === "WAIT") return { teks: `Menunggu ${t.aktor && t.aktor !== "—" ? t.aktor : "pihak lain"}${t.detail ? ` — ${t.detail}` : ""}. Tidak ada yang perlu dikerjakan Admin sekarang.`, jalur: null };
  return null;
}

function CuplikanBahan({ data, izin, aktif, onBagian }) {
  const r = ringkasBahan(data); const bisaCatat = !!izin.pemakaianAktual && aktif;
  return (
    <Kartu judul="Bahan" testid="cuplikan-bahan" aksi={<Buka onClick={() => onBagian("bahan")} testid="cuplikan-buka-bahan">{bisaCatat ? "Buka & catat" : "Buka Bahan"}</Buka>}>
      {r.kosong ? (
        <p className="m-0 text-[13px] text-ink2" data-testid="cuplikan-bahan-kosong">Belum ada rencana maupun pemakaian bahan. {bisaCatat ? "Catat pemakaian aktual langsung di tab Bahan — rencana tidak wajib." : ""}</p>
      ) : (
        <ul className="m-0 list-none space-y-1.5 p-0 text-[13px] text-ink2">
          <li data-testid="cuplikan-rencana">Rencana: {r.rencana ? <b className="text-ink">{r.rencana.jumlahItem} bahan · revisi {r.rencana.revisi}</b> : <span className="text-ink3">belum ada (opsional)</span>}</li>
          <li data-testid="cuplikan-baru"><span className="font-medium text-ink">Bahan baru dari Gudang</span> <Badge variant="orange" className="bh-b-orange">mengurangi stok</Badge><br />
            {r.baru.jumlahCatatan ? <span>{r.baru.jumlahCatatan} catatan · terakhir {formatJumlah(r.baru.terakhir.qty)} {r.baru.terakhir.satuan} {r.baru.terakhir.nama}, {r.baru.terakhir.pelaku || "—"}, {waktuWib(r.baru.terakhir.at)}</span> : <span className="text-ink3">belum ada pemakaian</span>}</li>
          <li data-testid="cuplikan-lama"><span className="font-medium text-ink">Komponen lama dari unit ini</span> <Badge variant="accent" className="bh-b-accent">bukan stok</Badge><br />
            {r.lama.pemakaianKembali + r.lama.dilepas > 0 ? <span>{r.lama.pemakaianKembali} dipakai kembali · {r.lama.dilepas} dilepas tanpa dipakai{r.lama.terakhirAt ? ` · terakhir ${waktuWib(r.lama.terakhirAt)}` : ""}</span> : <span className="text-ink3">belum ada</span>}</li>
        </ul>
      )}
      {r.peringatan.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid="cuplikan-bahan-peringatan">
          {r.peringatan.map((p) => <li key={p.key} className="flex items-start gap-1.5 rounded-btn bg-orangebg px-2.5 py-1.5 text-[12.5px] text-ink"><AlertTriangle size={13} className="bh-warn mt-0.5 shrink-0" aria-hidden />{p.teks}</li>)}
        </ul>
      )}
    </Kartu>
  );
}

function CuplikanDokumentasi({ ruang, onBagian }) {
  const dok = ruang?.dokumentasi; const runId = dok?.runId; const [detail, setDetail] = useState(null); const [galat, setGalat] = useState(false);
  useEffect(() => {
    if (!dok?.tersedia || !runId) { setDetail(null); return undefined; }
    let batal = false; setGalat(false);
    api.getProductionV2DocDetail(runId).then((d) => { if (!batal) setDetail(d); }).catch(() => { if (!batal) setGalat(true); });
    return () => { batal = true; };
  }, [dok?.tersedia, runId]);
  const r = ringkasDokumentasi(dok, detail);
  return (
    <Kartu judul="Dokumentasi" testid="cuplikan-dokumentasi" aksi={<Buka onClick={() => onBagian("dokumentasi")} testid="cuplikan-buka-dokumentasi">{r.bolehUnggah ? "Buka & unggah" : "Buka Dokumentasi"}</Buka>}>
      {!r.tersedia ? <p className="m-0 flex items-start gap-1.5 text-[13px] text-ink2" data-testid="cuplikan-dok-tidak"><Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />{r.alasan}</p>
        : galat ? <p className="m-0 text-[13px] text-ink3">Ringkasan dokumentasi belum bisa dimuat. Buka bagian Dokumentasi.</p>
        : r.memuat ? <div className="h-10 animate-pulse rounded bg-inset motion-reduce:animate-none" aria-label="Memuat ringkasan dokumentasi" />
        : (
          <div className="space-y-1.5 text-[13px] text-ink2" data-testid="cuplikan-dok-isi">
            {r.jumlahFoto === 0 ? <p className="m-0" data-testid="cuplikan-dok-kosong">Belum ada foto dokumentasi. {r.bolehUnggah ? "Unggah dari bagian Dokumentasi." : ""}</p>
              : <p className="m-0"><b className="text-ink">{r.jumlahFoto} foto</b> · kategori: {r.kategoriTerisi.join(", ")}{r.terbaru ? ` · terbaru ${r.terbaru.kategori}, ${r.terbaru.oleh || "—"}, ${waktuWib(r.terbaru.at)}` : ""}</p>}
            <p className="m-0" data-testid="cuplikan-dok-wajib">Bukti yang sudah waktunya (alur aktif): <b className="text-ink">{r.wajib.terpenuhi} dari {r.wajib.perlu}</b>{r.wajib.kurang.length > 0 && <span className="text-orange"> · kurang: {r.wajib.kurang.slice(0, 3).map((k) => `${k.label} (${k.kurang})`).join(", ")}</span>}</p>
            <p className="m-0 text-[11.5px] text-ink3">{r.catatan}</p>
          </div>
        )}
    </Kartu>
  );
}

function DetailOrder({ data, ruang }) {
  const { unit: u } = data; const d = ruang?.order?.detail; const k = d?.kondisiPelanggan;
  return (
    <Kartu judul="Detail order" testid="ringkasan-order">
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
        <Fakta label="Layanan Sales">{ruang?.order?.layanan?.join(" + ") || "belum tercatat"}</Fakta>
        <Fakta label="Kasur">{[u.merk, u.ukuran].filter(Boolean).join(" · ") || "—"}{u.order?.jumlahUnit > 1 ? ` · order ${u.order.jumlahUnit} unit` : ""}</Fakta>
        <Fakta label="Kondisi pelanggan"><span data-testid="kondisi-pelanggan" className="inline-flex flex-wrap items-center gap-1.5">{k?.sakit === true ? <Badge variant="red" className="bh-b-red"><HeartPulse size={11} className="mr-1" aria-hidden />{k.label}</Badge> : k?.sakit === false ? <Badge variant="neutral">{k.label}</Badge> : <span className="text-ink3">{k?.label || "—"}</span>}</span></Fakta>
        <Fakta label="Janji ke pelanggan">{d?.janjiPelanggan ? formatTanggal(d.janjiPelanggan) : <span className="text-ink3">belum ada</span>}</Fakta>
      </dl>
      {k?.sakit === true && k.keluhan.length > 0 && <p className="m-0 mt-3 text-[13px] text-ink" data-testid="keluhan-pelanggan"><span className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink3">Keluhan </span>{k.keluhan.join(", ")}</p>}
      {d?.catatanProduksi && <p className="m-0 mt-3 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="catatan-produksi"><span className="block text-[11px] font-medium uppercase tracking-[0.05em] text-ink3">Catatan Sales untuk Produksi</span>{d.catatanProduksi}</p>}
      {d?.komplain && <p className="m-0 mt-3 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red" data-testid="komplain-order"><span className="block text-[11px] font-semibold uppercase tracking-[0.05em]">Komplain {d.komplain.selesai ? "(sudah selesai)" : "(belum selesai)"}{d.komplain.tanggal ? ` · ${formatTanggal(d.komplain.tanggal)}` : ""}</span>{d.komplain.rincian || "Tanpa rincian."}</p>}
      <details className="group mt-3 rounded-btn border border-line px-3 py-2" data-testid="detail-lanjutan">
        <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Detail lanjutan: Sales, waktu, dan data lain</summary>
        <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
          <Fakta label="Status order (Sales)">{ruang?.order?.statusOrder?.label}{ruang?.order?.statusOrder?.terkunci ? " · dikunci manual" : ""}</Fakta>
          <Fakta label="Kode status tersimpan">{ruang?.order?.statusOrder?.mentah} / {u.status}</Fakta>
          <Fakta label="Pelanggan">{u.order?.customer?.name || "—"}</Fakta>
          <Fakta label="Order">{u.order?.orderNumber} · {u.order?.jumlahUnit} unit</Fakta>
          <Fakta label="Target di unit">{u.productionDueAt ? formatTanggal(u.productionDueAt) : "belum diisi"}</Fakta>
          <Fakta label="Terakhir diubah">{waktuWib(u.updatedAt)}</Fakta>
          <Fakta label="Prioritas">{u.priority || "—"}</Fakta>
          <Fakta label="Posisi (detail)">{data.adopsi.posisi?.detail || data.receivedBasisLabel || "—"}</Fakta>
        </dl>
        {u.order?.unitLain?.length > 0 && <p className="m-0 mt-3 text-[12.5px] text-ink3">Unit lain di order ini: {u.order.unitLain.map((x) => x.unitCode).join(", ")}.</p>}
        <p className="m-0 mt-3"><Link to={unitDetailPath(u.id)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent underline">Buka Unit 360 (tahap, QC, biaya) <ExternalLink size={12} aria-hidden /></Link></p>
      </details>
    </Kartu>
  );
}

export default function RingkasanUnit({ data, ruang, aktif, onDone, onBagian }) {
  const { adopsi: ad } = data; const izin = data.izin || {}; const meja = teksTahapMeja(ruang?.alurMeja); const target = badgeTarget(ad.targetSelesai?.at); const tahan = penjelasanTertahan(data);
  const layanan = ruang?.order?.layanan || []; const pk = ringkasPekerjaan(data);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start" data-testid="bagian-ringkasan">
      <div className="space-y-4 lg:col-start-1" data-testid="ringkasan-kiri-atas">
        <div className="space-y-3" data-testid="ringkasan-tindakan">
          <TindakanUtama data={data} aktif={aktif} onDone={onDone} onBukaUnit360={() => {}} />
          <KartuPenerimaan data={data} aktif={aktif} onDone={onDone} />
          {tahan && <p role="note" data-testid="tindakan-tertahan" className="m-0 flex items-start gap-2 rounded-btn bg-inset px-4 py-3 text-[13px] text-ink2"><Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden /><span>{tahan.teks}</span></p>}
        </div>
        <Kartu judul="Pekerjaan" testid="ringkasan-pekerjaan" aksi={<Buka onClick={() => onBagian("pekerjaan")} testid="cuplikan-buka-pekerjaan">Ubah status & target</Buka>}>
          <p className="m-0 text-[14px] font-medium text-ink" data-testid="pekerjaan-layanan">{layanan.length ? layanan.join(" + ") : "Pekerjaan belum tercatat dari Sales"}</p>
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3" data-testid="pekerjaan-fakta">
            <Fakta label="Status kerja (administratif)"><Badge variant={nadaBadge(ad.kerja?.tone)} className={ad.kerja?.tone === "accent" ? "bh-b-accent" : ""} data-testid="pekerjaan-status">{ad.kerja?.label || "—"}</Badge>{pk.sumber && <span className="mt-0.5 block text-[11.5px] text-ink2" data-testid="pekerjaan-sumber">{pk.sumber}</span>}{pk.faktaJadwal && <span className="mt-0.5 block text-[12px] font-medium text-ink" data-testid="fakta-tanpa-jadwal">{pk.faktaJadwal}</span>}</Fakta>
            <Fakta label="Jadwal produksi"><span data-testid="pekerjaan-jadwal">{pk.jadwal}</span></Fakta>
            <Fakta label="Pemakaian bahan"><span data-testid="pekerjaan-pemakaian">{pk.pemakaian}</span></Fakta>
            <Fakta label="Target selesai"><Badge variant={target.nada}>{target.teks}</Badge></Fakta>
            <Fakta label="PIC · meja">{ad.pic?.nama || "Belum ada"}{ad.meja ? ` · ${String(ad.meja).replace("TABLE_", "Meja ")}` : ""}</Fakta>
            <Fakta label="Tahap Meja · QC"><span data-testid="pekerjaan-qc">{meja.teks} · {pk.qc}</span></Fakta>
          </dl>
          <p className="m-0 mt-2 text-[11.5px] text-ink2" data-testid="pekerjaan-catatan-bukan-qc">“Sudah dikerjakan” bukan hasil QC, bukan siap serah Gudang, dan bukan siap kirim. Jadwal, pemakaian bahan, dan QC dicatat terpisah.</p>
        </Kartu>
      </div>
      <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-testid="ringkasan-kanan"><DetailOrder data={data} ruang={ruang} /></div>
      <div className="space-y-4 lg:col-start-1" data-testid="ringkasan-kiri-bawah">
        <CuplikanBahan data={data} izin={izin} aktif={aktif} onBagian={onBagian} />
        <CuplikanDokumentasi ruang={ruang} onBagian={onBagian} />
      </div>
    </div>
  );
}
