import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, X, History } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { tautanKeuangan } from "@/features/finance/uangMukaLogic.js";
import { teksJumlah } from "@/features/finance/purchaseOrderLogic.js";
import { BannerUangMuka, useKelayakanFaktur } from "@/features/finance/uangMukaFaktur/PenerapanUangMuka.jsx";
import { fakturPerluPeriksaUangMuka } from "@/features/finance/uangMukaFaktur/kelayakanLogika.js";
import { ChipStatusTagihan } from "./DaftarTagihan.jsx";
import { tampilSisa, statusTempo, asalTagihan, nomorFakturTampil, penjagaPermintaan, formatUangTepat, sisaKurangSatuRupiah, KET_SISA_SEN } from "./tagihanLogika.js";

// Rincian tagihan (panel samping, layar penuh di HP): supplier & faktur, dokumen asal, nilai/terbayar/sisa/status, item atau penerimaan bila server menyediakan,
// pembayaran, riwayat, dan tindakan yang memang tersedia. "Semua rincian dokumen" mempertahankan akses ke seluruh bidang yang dulu tampil di panel lama.

const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");

function Baris({ label, children }) {
  return <div className="fin-tg-r-baris"><dt>{label}</dt><dd>{children}</dd></div>;
}

function ItemFaktur({ b }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const penjaga = useRef(penjagaPermintaan());
  useEffect(() => {
    if (!b.purchaseOrderId) return undefined;
    const id = penjaga.current.mulai();
    setData(null); setGalat("");
    api.getFakturPurchaseOrder(b.id)
      .then((r) => { if (penjaga.current.sahkan(id)) setData(r); })
      .catch((e) => { if (penjaga.current.sahkan(id)) setGalat(e.message || "Gagal memuat item faktur"); });
    return () => penjaga.current.batalkan();
  }, [b.id, b.purchaseOrderId]);
  if (!b.purchaseOrderId) {
    return b.goodsReceipt?.receiptNumber
      ? <p className="fin-tg-r-ket">Tagihan ini menaut satu dokumen penerimaan ({b.goodsReceipt.receiptNumber}). Pencocokan per item tidak tersedia untuk tagihan jenis ini; yang dibandingkan adalah nilai dokumen penerimaan.</p>
      : <p className="fin-tg-r-ket">Tidak ada rincian item: tagihan ini dicatat sebagai satu nilai menurut dokumen supplier.</p>;
  }
  if (galat) return <p role="alert" className="fin-tg-r-galat">{galat}</p>;
  if (!data) return <p className="fin-tg-r-ket" role="status">Memuat item faktur…</p>;
  return (
    <div className="fin-tg-r-item" data-testid="item-faktur">
      {data.tertahan && <p role="alert" className="fin-tg-r-galat">Faktur tertahan: {(data.alasanTertahan || []).join("; ") || "periksa jumlah dan penerimaan"}.</p>}
      <ul className="fin-tg-r-daftar">
        {(data.barisFaktur || []).map((l) => (
          <li key={l.id || l.purchaseOrderLineId}>
            <p className="fin-tg-r-item-nama"><span className="fin-tg-kode">{l.kode}</span> {l.nama}</p>
            <dl className="fin-tg-r-item-dl">
              <div><dt>Ditagih sekarang</dt><dd>{teksJumlah(l.diajukanIni)} {l.satuan}</dd></div>
              <div><dt>Dipesan</dt><dd>{teksJumlah(l.dipesan)} {l.satuan}</dd></div>
              <div><dt>Diterima baik</dt><dd>{teksJumlah(l.diterimaBaik)} {l.satuan}</dd></div>
              <div><dt>Ditagih sebelumnya</dt><dd>{teksJumlah(l.sudahDitagih)} {l.satuan}</dd></div>
              <div><dt>Harga PO</dt><dd>{formatUang(l.hargaPO)}</dd></div>
              <div><dt>Harga faktur</dt><dd>{formatUang(l.hargaFaktur)}{Number(l.selisihHarga) !== 0 && <span className="fin-tg-r-selisih"> · selisih {formatUang(l.selisihHarga)}/{l.satuan}</span>}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      {data.perluTinjauanHarga && <p className="fin-tg-r-ket">Harga faktur berbeda dari PO (selisih nilai {formatUang(data.selisihHargaTotal)}). PO hanya pembanding; tinjauan harga dicatat saat faktur disetujui.</p>}
      {(data.penerimaanTerpilih || []).length > 0 && <p className="fin-tg-r-ket">Penerimaan yang ditagih dipilih eksplisit saat faktur dicatat.</p>}
    </div>
  );
}

const sen = (n) => Math.round((Number(n) || 0) * 100);

// "Penyelesaian faktur": angka dari server apa adanya (nilai, pembayaran kas, uang muka diterapkan, kredit lain, sisa) — tidak ada rumus pelunasan baru. Uang muka diterapkan = penerapan AKTIF
// atas faktur ini (daftar server); kredit lain = pengurang server (creditApplied) dikurangi uang muka diterapkan, supaya tidak terhitung dua kali.
function PenyelesaianFaktur({ b, onClose, kelayakan }) {
  const alokasi = b.allocations || [];
  const [st, setSt] = useState({ memuat: false, daftar: [], galat: "" });
  const [versi, setVersi] = useState(0);
  const penjaga = useRef(penjagaPermintaan());
  const perluDaftar = Number(b.kredit) > 0 || !!b.purchaseOrderId;
  useEffect(() => {
    if (!perluDaftar) { setSt({ memuat: false, daftar: [], galat: "" }); return undefined; }
    const id = penjaga.current.mulai();
    setSt((s) => ({ ...s, memuat: true, galat: "" }));
    api.getPenerapanUangMuka({ supplierId: b.supplierId })
      .then((r) => { if (penjaga.current.sahkan(id)) setSt({ memuat: false, daftar: (r.penerapan || []).filter((x) => x.faktur?.id === b.id), galat: "" }); })
      .catch((e) => { if (penjaga.current.sahkan(id)) setSt({ memuat: false, daftar: [], galat: e?.message || "Gagal memuat penerapan uang muka" }); });
    return () => penjaga.current.batalkan();
  }, [b.id, b.supplierId, b.kredit, perluDaftar, versi]);
  const aktif = st.daftar.filter((x) => x.status === "ACTIVE");
  const dpDiterapkan = aktif.reduce((s, x) => s + sen(x.jumlah), 0) / 100;
  const kreditLain = Math.max(0, sen(b.kredit) - sen(dpDiterapkan)) / 100;
  const belum = (kelayakan?.sesuai || []);
  const sisa = tampilSisa(b);
  return (
    <section className="fin-tg-r-bagian" data-testid="penyelesaian-faktur">
      <h3>Penyelesaian faktur</h3>
      <dl>
        <Baris label="Nilai faktur">{formatUangTepat(b.amount)}</Baris>
        <Baris label="Pembayaran kas">{Number(b.terbayar) > 0 ? formatUangTepat(b.terbayar) : "Belum ada"}</Baris>
        <Baris label="Uang muka diterapkan">
          <span data-testid="uang-muka-diterapkan">{st.galat ? `${formatUangTepat(b.kredit)} (uang muka dan kredit, rincian belum termuat)` : aktif.length > 0 ? formatUangTepat(dpDiterapkan) : "Belum ada"}</span>
        </Baris>
        {!st.galat && kreditLain > 0 && <Baris label="Kredit / penyesuaian lain">{formatUangTepat(kreditLain)}</Baris>}
        <Baris label="Sisa utang"><strong data-testid="sisa-penyelesaian">{sisa.tampil ? formatUangTepat(sisa.nilai) : "—"}</strong></Baris>
      </dl>
      {alokasi.length === 0 ? <p className="fin-tg-r-ket">Belum ada pembayaran kas yang dialokasikan ke tagihan ini.</p> : (
        <ul className="fin-tg-r-bayar">
          {alokasi.map((x, i) => (
            <li key={x.payment?.id || i}>
              <Link onClick={onClose} className="fin-tg-tautan" to={tautanKeuangan("pembayaran", x.payment?.paymentNumber)}>{x.payment?.paymentNumber}<ChevronRight size={14} aria-hidden="true" /></Link>
              <span className="fin-tg-r-bayar-tgl">{tgl(x.payment?.date)}</span><strong>{formatUangTepat(x.amount)}</strong>
            </li>
          ))}
        </ul>
      )}
      {st.galat && (
        <p role="alert" className="fin-tg-r-galat" data-testid="galat-penerapan-uang-muka">{st.galat}. <button type="button" className="fin-tg-tautan" onClick={() => setVersi((n) => n + 1)} data-testid="coba-lagi-penerapan-rincian">Coba lagi</button></p>
      )}
      {(st.daftar.length > 0 || belum.length > 0) && (
        <ul className="fin-tg-r-bayar" data-testid="jejak-uang-muka">
          {st.daftar.map((x) => (
            <li key={x.id} className={x.status !== "ACTIVE" ? "fin-tg-r-batal" : undefined}>
              <Link onClick={onClose} className="fin-tg-tautan" to={tautanKeuangan("pembelian", x.uangMuka?.nomor)}>{x.uangMuka?.nomor}<ChevronRight size={14} aria-hidden="true" /></Link>
              <span className="fin-tg-r-bayar-tgl">{x.status === "ACTIVE" ? "Uang muka diterapkan" : "Penerapan dibatalkan"} · {tgl(x.tanggal)}{x.jurnal ? ` · ${x.jurnal}` : ""}</span><strong>{formatUangTepat(x.jumlah)}</strong>
            </li>
          ))}
          {belum.map((d) => (
            <li key={d.id}>
              <Link onClick={onClose} className="fin-tg-tautan" to={tautanKeuangan("pembelian", d.nomor)}>{d.nomor}<ChevronRight size={14} aria-hidden="true" /></Link>
              <span className="fin-tg-r-bayar-tgl">Uang muka dibayar {formatUangTepat(d.nominal)} · belum diterapkan</span><strong>{formatUangTepat(d.saldoBelumDiterapkan)}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="fin-tg-r-ket">Pembayaran dicatat terpisah dari persetujuan tagihan. Tagihan disetujui belum berarti sudah dibayar. “Uang muka dibayar”, “faktur disetujui”, dan “uang muka diterapkan” adalah tiga langkah terpisah; penerapan tidak mengeluarkan uang dari bank.</p>
    </section>
  );
}

export default function RincianTagihan({ b, aksi, spec, onClose, onRiwayat, bolehPost = true, onTerapkanUm }) {
  const idSemua = useId();
  const [semua, setSemua] = useState(false);
  useEffect(() => { setSemua(false); }, [b?.id]);
  const layakPeriksa = !!b && fakturPerluPeriksaUangMuka(b);
  const kel = useKelayakanFaktur(layakPeriksa ? [`${b.id}:${b.sisa}`] : []);
  if (!b) return null;
  const sisa = tampilSisa(b);
  const tempo = statusTempo(b);
  const asal = asalTagihan(b);
  const nomor = nomorFakturTampil(b);
  const a = aksi(b);
  const alokasi = (b.allocations || []);
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal container={typeof document !== "undefined" ? document.querySelector(".app-shell") || undefined : undefined}>
        <Dialog.Overlay className="fin-tg-tirai" />
        <Dialog.Content className="fin-tg-lembar" aria-describedby={undefined} data-testid="rincian-tagihan">
          <header className="fin-tg-r-kepala">
            <div className="fin-tg-r-judul">
              <Dialog.Title className="fin-tg-r-nomor">{nomor || <span className="fin-tg-kosong-nomor">Nomor faktur belum diisi</span>}</Dialog.Title>
              <p className="fin-tg-r-sub">{b.supplier?.name} · <span title="Nomor tagihan SANSS">{b.billNumber}</span></p>
            </div>
            <ChipStatusTagihan status={b.status} tempo={tempo} />
            <Dialog.Close className="fin-tg-tutup" aria-label="Tutup rincian"><X size={18} aria-hidden="true" /></Dialog.Close>
          </header>

          <div className="fin-tg-r-badan">
            <div className="fin-tg-r-angka" data-testid="angka-tagihan">
              <div><span>Nilai</span><strong>{formatUangTepat(b.amount)}</strong></div>
              <div><span>Terbayar</span><strong>{Number(b.terbayar) > 0 ? formatUangTepat(b.terbayar) : "—"}</strong></div>
              <div><span>Sisa utang</span>{sisa.tampil ? <strong>{formatUangTepat(sisa.nilai)}</strong> : <strong className="fin-tg-strip">—</strong>}</div>
              <div><span>Jatuh tempo</span><strong className={cn(tempo === "lewat" && "fin-tg-merah")}>{tgl(b.dueDate)}</strong></div>
            </div>
            {!sisa.tampil && <p className="fin-tg-r-ket" data-testid="alasan-tanpa-sisa">{sisa.alasan} Nilai dokumen {formatUangTepat(b.amount)}.</p>}
            {sisaKurangSatuRupiah(b) && <p className="fin-tg-r-ket" data-testid="ket-sisa-sen">{KET_SISA_SEN}</p>}
            {Number(b.kredit) > 0 && <p className="fin-tg-r-ket">Sudah dikurangi uang muka, retur, atau kredit supplier {formatUangTepat(b.kredit)}.</p>}
            {layakPeriksa && <BannerUangMuka r={kel.peta.get(b.id)} galat={kel.galat[b.id]} onCoba={kel.muatUlang} onTerapkan={() => onTerapkanUm?.(b)} bolehPost={bolehPost} />}

            <section className="fin-tg-r-bagian">
              <h3>Supplier dan faktur</h3>
              <dl>
                <Baris label="Supplier">{b.supplier?.name || "—"}</Baris>
                <Baris label="Nomor faktur supplier">{nomor || <span className="fin-tg-kosong-nomor">Belum diisi</span>}</Baris>
                <Baris label="Nomor tagihan SANSS"><span className="fin-tg-kode">{b.billNumber}</span></Baris>
                <Baris label="Tanggal faktur">{tgl(b.billDate)}</Baris>
                {b.description && <Baris label="Keterangan">{b.description}</Baris>}
                {b.jenisTagihan?.label && <Baris label="Jenis tagihan">{b.jenisTagihan.label}</Baris>}
              </dl>
            </section>

            <section className="fin-tg-r-bagian">
              <h3>Dokumen asal</h3>
              <dl>
                <Baris label="Asal">{asal.label}</Baris>
                {asal.jenis === "PO" && <Baris label="Pesanan pembelian"><Link onClick={onClose} className="fin-tg-tautan" to={`/finance/purchase-orders?buka=${asal.id}`}>{asal.nomor}<ChevronRight size={14} aria-hidden="true" /></Link></Baris>}
                {asal.jenis === "PENERIMAAN" && <Baris label="Penerimaan barang"><span className="fin-tg-kode">{asal.nomor}</span></Baris>}
                {asal.jenis === "TANPA_PO" && <Baris label="Catatan">Dicatat tanpa PO atau penerimaan barang.</Baris>}
              </dl>
            </section>

            <section className="fin-tg-r-bagian">
              <h3>Item dan penerimaan</h3>
              <ItemFaktur b={b} />
            </section>

            <PenyelesaianFaktur b={b} onClose={onClose} kelayakan={kel.peta.get(b.id)} />

            {b.rejectReason && <section className="fin-tg-r-bagian"><h3>Alasan penolakan</h3><p className="fin-tg-r-ket">{b.rejectReason}</p></section>}

            <section className="fin-tg-r-bagian">
              <button type="button" className="fin-tombol fin-tg-r-pembuka" aria-expanded={semua} aria-controls={idSemua} onClick={() => setSemua((v) => !v)}>
                <span>Semua rincian dokumen</span><ChevronDown size={16} aria-hidden="true" className={cn("fin-tg-chev", semua && "buka")} />
              </button>
              {semua && (
                <dl id={idSemua} className="fin-tg-r-semua">
                  {(spec?.bagian || []).flatMap((s) => s.baris).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([l, v], i) => (
                    <div className="fin-tg-r-baris" key={`${l}-${i}`}><dt>{l}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              )}
            </section>
          </div>

          <footer className="fin-tg-r-kaki">
            <button type="button" className="fin-tombol fin-tg-r-riwayat" onClick={() => onRiwayat(b)}><History size={16} aria-hidden="true" /><span>Riwayat</span></button>
            <div className="fin-tg-r-aksi"><RowActions primary={a.primary} items={a.items} /></div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
