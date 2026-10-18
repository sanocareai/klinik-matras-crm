import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import AksiDokumen from "@/features/warehouse/aksi/AksiDokumen.jsx";
import AlurPenerimaan from "@/features/warehouse/penerimaan/AlurPenerimaan.jsx";
import { TRANSFER_TYPE_REAL, UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import TabelItemDokumen from "./TabelItemDokumen.jsx";
import KolomJumlah from "./KolomJumlah.jsx";
import { adaKurangStok, adaSelisihTerima, angka, dampakKirim, dampakTerima, galatJumlah, kalimatKetersediaan, tanggalPendek, teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL TRANSFER STOK — satu HALAMAN (bukan drawer). Dua langkah yang menulis stok: "Kirim barang" (saldo dikurangi) lalu "Terima barang" (saldo bertambah sebesar jumlah diterima). Selisih jumlah diterima dari jumlah dikirim
// TIDAK masuk saldo (terlihat jelas sebelum konfirmasi). Sistem menyimpan saldo total per bahan, BUKAN saldo per lokasi: lokasi asal/tujuan adalah catatan perpindahan, bukan bukti stok di lokasi itu.
// Setelah selesai tidak ada Undo/Hapus: koreksi lewat jalur resmi. Transfer dibatalkan → "Buat transfer baru dari dokumen ini" (dokumen lama tidak diubah, saling tertaut).
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED", TANDAI_DIAMBIL: "PICKED" };
const lokasiTeks = (l) => (l ? `${l.code}${l.zone ? ` (${l.zone})` : ""}` : "—");

export default function TransferDetail() {
  const { id } = useParams(); const navigate = useNavigate();
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false);
  const [terima, setTerima] = useState({}); const [versi, setVersi] = useState(0);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getStockTransfer(id); setR(d);
      setTerima(Object.fromEntries(d.lines.map((l) => [l.id, String(l.qtySent)])));
    } catch (e) { setGalat(e.message || "Gagal memuat transfer"); } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [id]);
  useEffect(() => { muat(); }, [muat]);

  const t = r?.tampilan; const ket = useMemo(() => Object.fromEntries((r?.ketersediaan ?? []).map((k) => [k.lineId, k])), [r]);
  const bisaTerima = (t?.aksi ?? []).some((a) => a.kode === "TERIMA");
  const galatTerima = bisaTerima ? galatJumlah(r.lines, terima, { boleh0: true }) : "";

  const jalankan = async (kode, v = {}) => {
    if (kode === "TERIMA" && galatTerima) throw new Error(galatTerima);
    setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) await api.updateStockTransfer(id, { status: STATUS_MAJU[kode] });
      else if (kode === "KIRIM") await api.dispatchStockTransfer(id);
      else if (kode === "TERIMA") await api.receiveStockTransfer(id, { lines: r.lines.map((l) => ({ lineId: l.id, qtyReceived: angka(terima[l.id]) })) });
      else if (kode === "UBAH") await api.updateStockTransfer(id, { notes: v.notes });
      else if (kode === "BATALKAN") await api.cancelStockTransfer(id, v.alasan);
      else if (kode === "BUAT_ULANG_TRANSFER") { const baru = await api.buatUlangStockTransfer(id, v.alasan); navigate(`/warehouse/transfers/${baru.id}`); return; }
      await muat();
    } finally { setSibuk(false); }
  };

  if (memuat && !r) return <PageContainer><PageBody><p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat transfer…</p></PageBody></PageContainer>;
  if (galat && !r) return <PageContainer><PageBody><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</p><Link to="/warehouse/transfers" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent"><ArrowLeft size={13} /> Kembali ke Transfer Stok</Link></PageBody></PageContainer>;
  if (!r) return null;

  const SPEC = {
    KIRIM: { panel: { judul: "Kirim barang sekarang?", tombol: "Kirim & kurangi saldo", peringatan: `Barang keluar dari ${r.sourceLocation.code}. Saldo di sistem berkurang SEKARANG dan baru bertambah lagi saat barang diterima di ${r.destinationLocation.code}. Setelah dikirim, transfer tidak bisa dibatalkan.`,
      ringkasan: dampakKirim(r.lines, satuan), catatan: adaKurangStok(r.ketersediaan) ? "Stok tersedia belum cukup untuk sebagian item; pengiriman akan ditolak bila saldo tidak cukup." : undefined, bidang: [] } },
    TERIMA: { panel: { judul: "Terima barang di tujuan?", tombol: "Terima & tambah saldo", peringatan: "Isi jumlah yang benar-benar diterima pada tabel item. Jumlah kurang dari yang dikirim berarti selisih hilang dari saldo.", galat: galatTerima,
      ringkasan: dampakTerima(r.lines, terima, satuan), catatan: adaSelisihTerima(r.lines, terima) ? "Ada selisih antara jumlah dikirim dan diterima. Selisih tidak masuk saldo; catat penyebabnya pada catatan transfer bila perlu." : undefined, bidang: [] } },
    UBAH: { panel: { judul: "Ubah catatan transfer", tombol: "Simpan catatan", peringatan: "Hanya catatan yang bisa diubah. Item, jumlah, dan lokasi tidak bisa diubah — bila salah, batalkan lalu buat transfer baru.", bidang: [{ nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    BATALKAN: { panel: { judul: "Batalkan transfer ini?", tombol: "Ya, batalkan", peringatan: "Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
    BUAT_ULANG_TRANSFER: { panel: { judul: "Buat transfer baru dari dokumen ini?", tombol: "Buat transfer baru", peringatan: "Dokumen ini tidak diubah dan tidak dihapus. Dibuat dokumen BARU berstatus Draf (jenis, lokasi, item, jumlah sama); kedua dokumen saling tertaut di riwayat.", bidang: [{ nama: "alasan", label: "Alasan membuat ulang", wajib: true, min: 3, maks: 300 }] } },
  };
  const selesai = r.status === "COMPLETED"; const batal = r.status === "CANCELLED"; const jalan = r.status === "IN_TRANSIT";
  const baris = r.lines.map((l) => {
    const k = ket[l.id]; const u = satuan(l.material.unit);
    const sel = [{ kunci: "dikirim", label: "Dikirim", numeric: true, tebal: true, isi: `${teksJumlah(l.qtySent)} ${u}` }];
    if (!selesai && !batal && !jalan && k) sel.push({ kunci: "stok", label: "Stok tersedia", lebar: true, isi: <span data-testid="ketersediaan" data-cukup={String(k.cukup)}>{kalimatKetersediaan(k, u)}</span> });
    if (bisaTerima) sel.push({ kunci: "diterima", label: "Jumlah diterima", numeric: true, isi: <KolomJumlah nilai={terima[l.id]} onUbah={(v) => setTerima((x) => ({ ...x, [l.id]: v }))} label={`Jumlah diterima ${l.material.code}`} testid={`terima-${l.material.code}`} /> });
    if (selesai) {
      const selisih = l.qtyReceived != null ? Math.round((Number(l.qtySent) - Number(l.qtyReceived)) * 10000) / 10000 : null;
      sel.push({ kunci: "diterima", label: "Diterima", numeric: true, tebal: true, isi: `${teksJumlah(l.qtyReceived)} ${u}` });
      sel.push({ kunci: "selisih", label: "Selisih", numeric: true, isi: <span data-testid="selisih" className={selisih ? "font-semibold text-red" : undefined}>{selisih ? `${teksJumlah(selisih)} ${u} tidak masuk saldo` : "Tidak ada"}</span> });
    }
    return { id: l.id, kode: l.material.code, nama: l.material.name, sel, peringatan: !selesai && !batal && !jalan && k?.cukup === false ? "Stok tersedia belum cukup untuk jumlah ini" : undefined };
  });

  const kartuAksi = (
    <Card className="space-y-2 p-4" data-testid="kartu-aksi">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Yang bisa dilakukan sekarang</h3>
      {t.aksi.length === 0 ? <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-aksi">{r.izin?.tulis === false ? "Akun Anda hanya dapat melihat dokumen ini (tidak punya izin mengubah transfer stok)." : <>Tidak ada aksi untuk dokumen ini. {t.penjelasan}</>}</p> : (
        <AksiDokumen aksi={t.aksi} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} ikutiVersi={versi} />
      )}
      <p className="m-0 text-[11.5px] leading-snug text-ink3">Lokasi asal dan tujuan adalah catatan perpindahan. Saldo stok dihitung total semua lokasi — sistem belum menyimpan saldo per lokasi.</p>
    </Card>
  );

  return (
    <PageContainer>
      <PageHeader
        title={r.transferNumber}
        subtitle={<span data-testid="identitas-ringkas">{r.sourceLocation.code} → {r.destinationLocation.code} · {TRANSFER_TYPE_REAL[r.transferType]?.labelId ?? r.transferType}</span>}
        actions={<Link to="/warehouse/transfers" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent max-sm:min-h-11"><ArrowLeft size={13} /> Transfer Stok</Link>}
      />
      <PageBody>
        <Card className="space-y-3 p-4" data-testid="kartu-identitas">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE[t.warna] ?? "neutral"} data-testid="status-dokumen" data-kode={t.kode}>{t.label}</Badge>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
            <div><dt className="text-ink3">No. transfer</dt><dd className="m-0 font-semibold text-ink" data-testid="id-nomor">{r.transferNumber}</dd></div>
            <div><dt className="text-ink3">Jenis</dt><dd className="m-0 font-medium text-ink">{TRANSFER_TYPE_REAL[r.transferType]?.labelId ?? r.transferType}</dd></div>
            <div><dt className="text-ink3">Lokasi asal</dt><dd className="m-0 font-medium text-ink" data-testid="id-asal">{lokasiTeks(r.sourceLocation)}</dd></div>
            <div><dt className="text-ink3">Lokasi tujuan</dt><dd className="m-0 font-medium text-ink" data-testid="id-tujuan">{lokasiTeks(r.destinationLocation)}</dd></div>
            <div><dt className="text-ink3">Diminta oleh</dt><dd className="m-0 font-medium text-ink">{r.requestedBy?.name ?? "—"}</dd></div>
            <div><dt className="text-ink3">Dibuat</dt><dd className="m-0 font-medium text-ink">{tanggalPendek(r.createdAt)}</dd></div>
            <div><dt className="text-ink3">Dikirim</dt><dd className="m-0 font-medium text-ink">{r.dispatchedAt ? waktuTeks(r.dispatchedAt) : "—"}</dd></div>
            <div><dt className="text-ink3">Diterima</dt><dd className="m-0 font-medium text-ink">{r.receivedAt ? waktuTeks(r.receivedAt) : "—"}</dd></div>
          </dl>
          <AlurPenerimaan tampilan={t} label="Alur transfer stok" testid="alur-dokumen" className="pt-2" />
          <p className={`m-0 flex items-start gap-1.5 rounded-btn px-3 py-2 text-[12.5px] leading-snug ${t.pengaruhStok === "SUDAH" ? "bg-greenbg text-green" : t.pengaruhStok === "BERKURANG" ? "bg-orangebg text-ink" : "bg-inset text-ink2"}`} data-testid="penjelasan-status"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>{t.penjelasan}</span></p>
          {r.notes && <p className="m-0 text-[12px] text-ink2" data-testid="catatan-dokumen">{r.notes}</p>}
        </Card>

        {!bisaTerima && kartuAksi}

        <Card className="space-y-3 p-4">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Item — dikirim, stok tersedia, diterima</h3>
          <TabelItemDokumen baris={baris} />
          {bisaTerima && galatTerima && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatTerima}</p>}
        </Card>

        {bisaTerima && kartuAksi}

        <KartuJalurKoreksi tipe="STOCK_TRANSFER" id={id} versi={`${r.status}-${versi}`} ringkas />
        <JejakDokumen jejak={r.jejak} basePath="/warehouse/transfers" />
        {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={muat} disabled={memuat} className="self-start max-sm:min-h-11" data-testid="muat-ulang">{memuat ? <Loader2 size={14} className="animate-spin" /> : null} Muat ulang</Button>
      </PageBody>
    </PageContainer>
  );
}
