import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Info } from "lucide-react";
import { api } from "@/api.js";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import AksiDokumen from "@/features/warehouse/aksi/AksiDokumen.jsx";
import AlurPenerimaan from "@/features/warehouse/penerimaan/AlurPenerimaan.jsx";
import StockTransferFormModal from "@/features/warehouse/components/StockTransferFormModal.jsx";
import { TRANSFER_TYPE_REAL, UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import TabelItemDokumen from "./TabelItemDokumen.jsx";
import KolomJumlah from "./KolomJumlah.jsx";
import { adaKurangStok, adaSelisihTerima, angka, dampakKirim, dampakTerima, galatJumlah, kalimatKetersediaan, tanggalPendek, teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL TRANSFER STOK — satu HALAMAN (bukan drawer). Dua langkah yang menulis stok: "Kirim barang" (saldo dikurangi) lalu "Terima barang" (saldo bertambah sebesar jumlah diterima). Kekurangan jumlah diterima dari jumlah dikirim
// sudah hilang dari saldo; karena itu PENYEBAB selisih wajib diisi saat Terima, selisih terlihat (kartu Selisih), dan diselesaikan lewat "Selesaikan selisih": ditemukan (saldo TOTAL bahan ditambah) atau diakui susut/hilang/rusak
// (tercatat, tanpa pergerakan stok, BUKAN pemakaian produksi). Kartu "Perjalanan saldo" menunjukkan saldo sebelum kirim → dalam perjalanan → sesudah terima. Sistem menyimpan saldo TOTAL per bahan, BUKAN saldo per lokasi.
// Draf boleh diubah isinya (bahan, jumlah, lokasi, catatan); sebelum dikirim dokumen boleh dikembalikan ke Draf untuk revisi (persetujuan lama gugur). Setelah dikirim: tidak ada Undo — koreksi lewat jalur resmi.
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED", TANDAI_DIAMBIL: "PICKED" };
const lokasiTeks = (l) => (l ? `${l.code}${l.zone ? ` (${l.zone})` : ""}` : "—");
const kunciBaru = () => `sel-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)}`;

export default function TransferDetail({ id, onTutup, onBerubah }) {
  const navigate = useNavigate(); const sudahMuat = useRef(false); const kabar = useRef(onBerubah); kabar.current = onBerubah;
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false);
  const [terima, setTerima] = useState({}); const [versi, setVersi] = useState(0); const [konflik, setKonflik] = useState(""); const [info, setInfo] = useState(""); const [editOpen, setEditOpen] = useState(false); const [kunciSelisih, setKunciSelisih] = useState(kunciBaru);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getStockTransfer(id); setR(d); if (sudahMuat.current) kabar.current?.(); sudahMuat.current = true;
      setTerima(Object.fromEntries(d.lines.map((l) => [l.id, String(l.qtySent)])));
    } catch (e) { setGalat(e.message || "Gagal memuat transfer"); } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [id]);
  useEffect(() => { sudahMuat.current = false; muat(); }, [muat]);

  const t = r?.tampilan; const ket = useMemo(() => Object.fromEntries((r?.ketersediaan ?? []).map((k) => [k.lineId, k])), [r]);
  const bisaTerima = (t?.aksi ?? []).some((a) => a.kode === "TERIMA");
  const galatTerima = bisaTerima ? galatJumlah(r.lines, terima, { boleh0: true }) : "";
  const barisSelisih = r?.selisih ?? []; const selisihBuka = barisSelisih.filter((x) => x.sisa > 0);

  const jalankan = async (kode, v = {}) => {
    if (kode === "UBAH_ISI") { setEditOpen(true); return; }
    if (kode === "TERIMA" && galatTerima) throw new Error(galatTerima);
    setKonflik(""); setInfo(""); let hasil = null; setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) hasil = await api.updateStockTransfer(id, { status: STATUS_MAJU[kode], revisi: r.revisi });
      else if (kode === "KIRIM") hasil = await api.dispatchStockTransfer(id, { revisi: r.revisi });
      else if (kode === "TERIMA") hasil = await api.receiveStockTransfer(id, { revisi: r.revisi, ...(adaSelisihTerima(r.lines, terima) && { alasanSelisih: v.alasanSelisih }), lines: r.lines.map((l) => ({ lineId: l.id, qtyReceived: angka(terima[l.id]) })) });
      else if (kode === "UBAH") await api.updateStockTransfer(id, { notes: v.notes, revisi: r.revisi });
      else if (kode === "KEMBALIKAN") hasil = await api.kembalikanStockTransfer(id, v.alasan, r.revisi);
      else if (kode === "BATALKAN") hasil = await api.cancelStockTransfer(id, v.alasan, r.revisi);
      else if (kode === "SELESAIKAN_SELISIH") { hasil = await api.selesaikanSelisihTransfer(id, { lineId: v.lineId, jenis: v.jenis, qty: angka(v.qty), alasan: v.alasan, kunci: kunciSelisih, revisi: r.revisi }); setKunciSelisih(kunciBaru()); }
      else if (kode === "BUAT_ULANG_TRANSFER") { const baru = await api.buatUlangStockTransfer(id, v.alasan); navigate(`/warehouse/transfers/${baru.id}`); return; }
      await muat(); if (hasil?.ulang) setInfo("Permintaan yang sama sudah dijalankan; hasilnya sama dan tidak diulang (stok, jurnal, dan riwayat tidak bertambah).");
    } catch (e) {
      if (e.code === "REVISI_BASI" || e.code === "STATUS_TIDAK_SESUAI" || e.code === "KONFLIK_PAYLOAD") await muat(); // tampilkan keadaan terbaru
      if (["REVISI_BASI", "STATUS_TIDAK_SESUAI", "KONFLIK_PAYLOAD"].includes(e.code)) { setKonflik(e.message); throw Object.assign(new Error(e.message), { diam: true }); } // banner halaman tetap terlihat walau kartu aksi berpindah/hilang
      throw e;
    } finally { setSibuk(false); }
  };

  if (!r) {
    return (
      <FokusOverlay open onClose={onTutup} title={memuat ? "Memuat transfer…" : "Tidak dapat membuka transfer"} testid="fokus-dokumen">
        {memuat && <p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3" data-testid="memuat-dokumen"><Loader2 size={14} className="animate-spin" /> Memuat transfer…</p>}
        {!memuat && galat && <div className="space-y-3"><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-dokumen">{galat}</p><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={muat} className="max-sm:min-h-11" data-testid="coba-lagi">Coba lagi</Button><Button variant="ghost" size="sm" onClick={onTutup} className="max-sm:min-h-11">Tutup</Button></div></div>}
      </FokusOverlay>
    );
  }

  const OPSI_JENIS = [{ nilai: "", label: "Pilih penyelesaian…" }, { nilai: "DITEMUKAN", label: `Barang ditemukan / terlambat tiba — saldo total bahan bertambah (dicatat pada ${r.destinationLocation.code})` }, { nilai: "SUSUT", label: "Diakui susut / hilang / rusak — hanya tercatat, saldo tidak berubah, Finance belum mencatat" }];
  const SPEC = {
    SETUJUI: { panel: { judul: "Setujui transfer ini?", tombol: "Setujui", peringatan: "Belum ada barang yang berpindah dan stok belum berubah.", catatan: r.izin?.pemohonSama ? "Anda juga pemohon dokumen ini. Aturan izin saat ini memperbolehkannya (belum ada penyetuju kedua untuk transaksi rutin); persetujuan Anda tercatat di riwayat." : undefined, bidang: [] } },
    KEMBALIKAN: { panel: { judul: t.aksi.find((a) => a.kode === "KEMBALIKAN")?.label ?? "Kembalikan ke Draf", tombol: "Kembalikan ke Draf", peringatan: r.status === "WAITING_APPROVAL" ? "Transfer kembali menjadi Draf supaya isinya bisa diubah; belum ada pengaruh ke stok." : "Transfer kembali menjadi Draf untuk direvisi. Persetujuan lama GUGUR (tetap ada di riwayat). Hanya selama belum dikirim.", bidang: [{ nama: "alasan", label: "Alasan revisi", wajib: true, min: 3, maks: 300 }] } },
    KIRIM: { panel: { judul: "Kirim barang sekarang?", tombol: "Kirim & kurangi saldo", peringatan: `Barang keluar dari ${r.sourceLocation.code}. Saldo di sistem berkurang SEKARANG dan baru bertambah lagi saat barang diterima di ${r.destinationLocation.code}. Setelah dikirim, transfer tidak bisa dibatalkan atau dikembalikan ke Draf.`,
      ringkasan: dampakKirim(r.lines, satuan), catatan: adaKurangStok(r.ketersediaan) ? "Stok tersedia belum cukup untuk sebagian item; pengiriman akan ditolak bila saldo tidak cukup." : undefined, bidang: [] } },
    TERIMA: { panel: { judul: "Terima barang di tujuan?", tombol: "Terima & tambah saldo", peringatan: "Isi jumlah yang benar-benar diterima pada tabel item. Jumlah kurang dari yang dikirim berarti selisih sudah hilang dari saldo; selisih itu tercatat dan wajib diselesaikan setelah ini.", galat: galatTerima,
      ringkasan: dampakTerima(r.lines, terima, satuan), catatan: adaSelisihTerima(r.lines, terima) ? "Ada selisih antara jumlah dikirim dan diterima. Isi penyebabnya; selisih tidak masuk saldo sampai diselesaikan (ditemukan atau diakui susut)." : undefined,
      bidang: adaSelisihTerima(r.lines, terima) ? [{ nama: "alasanSelisih", label: "Penyebab selisih", tipe: "area", wajib: true, min: 3, maks: 300 }] : [] } },
    SELESAIKAN_SELISIH: { panel: { judul: "Selesaikan selisih transfer", tombol: "Simpan penyelesaian", peringatan: "Ditemukan: saldo TOTAL bahan bertambah sebesar jumlah yang ditemukan (sistem tidak menyimpan saldo per lokasi; lokasi tujuan hanya tercatat di pergerakan). Susut/hilang/rusak: hanya tercatat (saldo sudah berkurang saat kirim), BUKAN pemakaian produksi, dan Pencatatan kerugian di Finance BELUM dilakukan (tidak ada jurnal otomatis); Finance perlu menanganinya terpisah. Bisa diselesaikan bertahap; jumlah tidak boleh melebihi sisa selisih.",
      bidang: [{ nama: "lineId", label: "Bahan", tipe: "pilih", wajib: true, awal: selisihBuka[0]?.lineId ?? "", opsi: selisihBuka.map((x) => ({ nilai: x.lineId, label: `${x.kode} — sisa selisih ${teksJumlah(x.sisa)} ${satuan(x.unit)}` })) },
        { nama: "jenis", label: "Penyelesaian", tipe: "pilih", wajib: true, awal: "", opsi: OPSI_JENIS },
        { nama: "qty", label: "Jumlah", wajib: true, awal: selisihBuka[0] ? String(selisihBuka[0].sisa) : "", maks: 20 },
        { nama: "alasan", label: "Keterangan penyelesaian", tipe: "area", wajib: true, min: 3, maks: 300 }] } },
    UBAH: { panel: { judul: "Ubah catatan transfer", tombol: "Simpan catatan", peringatan: "Hanya catatan. Untuk mengubah bahan, jumlah, atau lokasi, kembalikan dulu ke Draf. Perubahan tercatat di riwayat.", bidang: [{ nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
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
      sel.push({ kunci: "selisih", label: "Selisih", numeric: true, isi: <span data-testid="selisih" className={selisih ? "font-semibold text-red" : undefined}>{selisih > 0 ? `${teksJumlah(selisih)} ${u} kurang` : selisih < 0 ? `${teksJumlah(-selisih)} ${u} lebih` : "Tidak ada"}</span> });
    }
    return { id: l.id, kode: l.material.code, nama: l.material.name, sel, peringatan: !selesai && !batal && !jalan && k?.cukup === false ? "Stok tersedia belum cukup untuk jumlah ini" : undefined };
  });
  const perjalanan = (r.saldoPerjalanan ?? []).filter((x) => x);

  const kartuAksi = (
    <Card className="space-y-2 p-4" data-testid="kartu-aksi">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Yang bisa dilakukan sekarang</h3>
      {t.aksi.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-aksi">{r.izin?.tulis === false ? "Akun Anda hanya dapat melihat dokumen ini (tidak punya izin mengubah transfer stok)." : <>Tidak ada aksi untuk dokumen ini. {t.penjelasan}</>}</p>}
      <AksiDokumen aksi={t.aksi} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} ikutiVersi={versi} />
      <p className="m-0 text-[11.5px] leading-snug text-ink3">Lokasi asal dan tujuan adalah catatan perpindahan. Saldo stok dihitung total semua lokasi — sistem belum menyimpan saldo per lokasi.</p>
    </Card>
  );

  return (
    <FokusOverlay open onClose={onTutup} title={r.transferNumber} subtitle={<span data-testid="identitas-ringkas">{r.sourceLocation.code} → {r.destinationLocation.code} · {TRANSFER_TYPE_REAL[r.transferType]?.labelId ?? r.transferType}</span>} footer={kartuAksi} testid="fokus-dokumen">
      <div className="flex flex-col gap-4">
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
          <p className={`m-0 flex items-start gap-1.5 rounded-btn px-3 py-2 text-[12.5px] leading-snug ${t.pengaruhStok === "SUDAH" && !t.selisihTerbuka ? "bg-greenbg text-green" : t.pengaruhStok === "BERKURANG" || t.selisihTerbuka > 0 ? "bg-orangebg text-ink" : "bg-inset text-ink2"}`} data-testid="penjelasan-status"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>{t.penjelasan}</span></p>
          {r.notes && <p className="m-0 text-[12px] text-ink2" data-testid="catatan-dokumen">{r.notes}</p>}
        </Card>

        {konflik && (
          <div role="alert" className="flex items-start gap-2 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5 text-[12.5px] text-ink" data-testid="banner-konflik">
            <span className="flex-1"><strong>Aksi tidak dijalankan.</strong> {konflik} Halaman sudah dimuat ulang dengan keadaan terbaru.</span>
            <button type="button" onClick={() => setKonflik("")} className="shrink-0 text-[12px] font-semibold text-accent max-sm:min-h-11">Tutup</button>
          </div>
        )}
        {info && (
          <div role="status" className="flex items-start gap-2 rounded-btn border-l-[3px] border-accent bg-accentbg px-3 py-2.5 text-[12.5px] text-ink" data-testid="banner-ulang">
            <span className="flex-1"><strong>Sudah diproses sebelumnya.</strong> {info}</span>
            <button type="button" onClick={() => setInfo("")} className="shrink-0 text-[12px] font-semibold text-accent max-sm:min-h-11">Tutup</button>
          </div>
        )}

        <Card className="space-y-3 p-4">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Item — dikirim, stok tersedia, diterima</h3>
          <TabelItemDokumen baris={baris} />
          {bisaTerima && galatTerima && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatTerima}</p>}
        </Card>


        {perjalanan.length > 0 && (
          <Card className="space-y-2 p-4" data-testid="kartu-saldo-perjalanan">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Perjalanan saldo (total semua lokasi)</h3>
            <ul className="m-0 list-none space-y-2.5 p-0">
              {perjalanan.map((p) => {
                const u = satuan(p.unit); const dalam = Math.round((p.sebelumKirim - p.dikirim) * 10000) / 10000; const sesudah = Math.round((dalam + (p.diterima ?? 0) + (p.ditemukan ?? 0)) * 10000) / 10000;
                return (
                  <li key={p.lineId} className="rounded-btn border border-border p-3 text-[12.5px]" data-testid="saldo-baris" data-kode={p.kode}>
                    <div className="font-semibold text-ink">{p.kode}</div>
                    <dl className="m-0 mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
                      <div><dt className="text-ink3">Sebelum kirim</dt><dd className="m-0 font-medium text-ink" data-testid="saldo-sebelum">{teksJumlah(p.sebelumKirim)} {u}</dd></div>
                      <div><dt className="text-ink3">Dalam perjalanan</dt><dd className="m-0 font-medium text-ink" data-testid="saldo-dalam">{teksJumlah(dalam)} {u} <span className="text-ink3">(−{teksJumlah(p.dikirim)})</span></dd></div>
                      <div><dt className="text-ink3">Sesudah terima</dt><dd className="m-0 font-medium text-ink" data-testid="saldo-sesudah">{r.status === "COMPLETED" ? <>{teksJumlah(sesudah)} {u} <span className="text-ink3">(+{teksJumlah((p.diterima ?? 0) + (p.ditemukan ?? 0))})</span></> : "menunggu diterima"}</dd></div>
                      <div><dt className="text-ink3">Saldo sekarang</dt><dd className="m-0 font-medium text-ink">{teksJumlah(p.sekarang)} {u}</dd></div>
                    </dl>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 text-[11.5px] leading-snug text-ink3">Saldo sekarang bisa berbeda dari "sesudah terima" bila ada dokumen lain yang menyentuh bahan yang sama.</p>
          </Card>
        )}

        {barisSelisih.length > 0 && (
          <Card className="space-y-2 p-4" data-testid="kartu-selisih">
            <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Selisih transfer</h3>
            <ul className="m-0 list-none space-y-2.5 p-0">
              {barisSelisih.map((x) => (
                <li key={x.lineId} className="rounded-btn border border-border p-3 text-[12.5px]" data-testid="selisih-baris" data-kode={x.kode} data-sisa={x.sisa}>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">{x.kode}</span>
                    {x.kurang > 0 && (x.sisa > 0 ? <Badge variant="orange">Belum diselesaikan: {teksJumlah(x.sisa)} {satuan(x.unit)}</Badge> : <Badge variant="green">Selesai diselesaikan</Badge>)}
                    {x.lebih > 0 && <Badge variant="neutral">Lebih {teksJumlah(x.lebih)} {satuan(x.unit)} dari yang dikirim (koreksi lewat jalur resmi)</Badge>}</div>
                  <p className="m-0 mt-1 text-ink2">Dikirim {teksJumlah(x.dikirim)} · diterima {teksJumlah(x.diterima)}{x.kurang > 0 ? ` · kurang ${teksJumlah(x.kurang)} (sudah hilang dari saldo)` : ""}</p>
                  {x.penyelesaian.length > 0 && <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11.5px] text-ink2">{x.penyelesaian.map((p, i) => <li key={p.kunci ?? i}>{p.jenis === "DITEMUKAN" ? "Ditemukan" : "Diakui susut/hilang/rusak (Finance belum mencatat)"} {teksJumlah(p.qty)} — {p.alasan} <span className="text-ink3">· {waktuTeks(p.waktu)}</span></li>)}</ul>}
                </li>
              ))}
            </ul>
            <p className="m-0 text-[11.5px] leading-snug text-ink3">Selisih tidak dihitung sebagai pemakaian produksi. Pengakuan susut/hilang/rusak hanya tercatat di sini; belum ada jurnal Finance otomatis untuk kerugian ini.</p>
          </Card>
        )}

        <KartuJalurKoreksi tipe="STOCK_TRANSFER" id={id} versi={`${r.status}-${versi}`} ringkas />
        <JejakDokumen jejak={r.jejak} basePath="/warehouse/transfers" />
        {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={muat} disabled={memuat} className="self-start max-sm:min-h-11" data-testid="muat-ulang">{memuat ? <Loader2 size={14} className="animate-spin" /> : null} Muat ulang</Button>
      </div>
      {editOpen && <StockTransferFormModal open dokumen={r} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); muat(); }} />}
    </FokusOverlay>
  );
}
