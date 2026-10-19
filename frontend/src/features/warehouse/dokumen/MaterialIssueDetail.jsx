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
import MaterialIssueFormModal from "@/features/warehouse/components/MaterialIssueFormModal.jsx";
import { ISSUE_SOURCE_REAL, ISSUE_PRIORITY_REAL, UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import TabelItemDokumen from "./TabelItemDokumen.jsx";
import KolomJumlah from "./KolomJumlah.jsx";
import { adaKurangStok, angka, dampakKeluar, galatJumlah, kalimatKetersediaan, tanggalPendek, teksJumlah } from "./dokumenLogic.js";

// DETAIL PENGELUARAN MATERIAL — satu HALAMAN (bukan drawer). Urutan baca petugas: identitas & status → alur (Draf → … → Dikeluarkan) → pengaruh ke stok → item (diminta · stok tersedia · lokasi · jumlah keluar) →
// aksi yang relevan untuk status ini → riwayat. Status, tahap, aksi, dan ketersediaan datang dari server. Stok BARU berkurang saat "Konfirmasi keluar" (sebelumnya hanya dicadangkan). Setelah dikeluarkan tidak ada Undo/Hapus:
// koreksi lewat jalur resmi (kartu di bawah). Dokumen dibatalkan → "Buat permintaan baru dari dokumen ini" (dokumen lama tidak diubah, saling tertaut di riwayat).
const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED", SIAPKAN: "READY_TO_PICK", TANDAI_DIAMBIL: "PICKED" };
const PRIORITAS_OPSI = Object.entries(ISSUE_PRIORITY_REAL).map(([nilai, v]) => ({ nilai, label: v.labelId }));

export default function MaterialIssueDetail({ id, onTutup, onBerubah }) {
  const navigate = useNavigate(); const sudahMuat = useRef(false); const kabar = useRef(onBerubah); kabar.current = onBerubah;
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false);
  const [lokasi, setLokasi] = useState({}); const [keluar, setKeluar] = useState({}); const [versi, setVersi] = useState(0); const [konflik, setKonflik] = useState(""); const [info, setInfo] = useState(""); const [editOpen, setEditOpen] = useState(false);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getMaterialIssue(id); setR(d); setLokasi({}); if (sudahMuat.current) kabar.current?.(); sudahMuat.current = true;
      setKeluar(Object.fromEntries(d.lines.map((l) => [l.id, String(l.requestedQty)])));
    } catch (e) { setGalat(e.message || "Gagal memuat permintaan"); } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [id]);
  useEffect(() => { sudahMuat.current = false; muat(); }, [muat]);

  const t = r?.tampilan; const ket = useMemo(() => Object.fromEntries((r?.ketersediaan ?? []).map((k) => [k.lineId, k])), [r]);
  const kodeAksi = (t?.aksi ?? []).map((a) => a.kode);
  const bisaLokasi = kodeAksi.includes("ATUR_LOKASI"); const bisaKeluar = kodeAksi.includes("KONFIRMASI_KELUAR");
  const adaLokasi = Object.keys(lokasi).length > 0;
  const galatKeluar = bisaKeluar ? galatJumlah(r.lines, keluar) : "";

  const simpanLokasi = async () => { await Promise.all(Object.entries(lokasi).map(([lineId, sourceLocation]) => api.updateMaterialIssueLine(id, lineId, { sourceLocation }))); };
  const jalankan = async (kode, v = {}) => {
    if (kode === "KONFIRMASI_KELUAR" && galatKeluar) throw new Error(galatKeluar);
    if (kode === "UBAH_ISI") { setEditOpen(true); return; }
    setKonflik(""); setInfo(""); let hasil = null; setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) { if (adaLokasi) await simpanLokasi(); hasil = await api.updateMaterialIssue(id, { status: STATUS_MAJU[kode], revisi: r.revisi }); }
      else if (kode === "ATUR_LOKASI") await simpanLokasi();
      else if (kode === "KONFIRMASI_KELUAR") { if (adaLokasi) await simpanLokasi(); hasil = await api.issueMaterialIssue(id, { revisi: r.revisi, lines: r.lines.map((l) => ({ lineId: l.id, issuedQty: angka(keluar[l.id]) })) }); }
      else if (kode === "UBAH") await api.updateMaterialIssue(id, { department: v.department, sourceReference: v.sourceReference, requiredDate: v.requiredDate, priority: v.priority, notes: v.notes, revisi: r.revisi });
      else if (kode === "KEMBALIKAN") hasil = await api.kembalikanMaterialIssue(id, v.alasan, r.revisi);
      else if (kode === "BATALKAN") hasil = await api.cancelMaterialIssue(id, v.alasan, r.revisi);
      else if (kode === "BUAT_ULANG") { const baru = await api.buatUlangMaterialIssue(id, v.alasan); navigate(`/warehouse/material-issue/${baru.id}`); return; }
      await muat(); if (hasil?.ulang) setInfo("Permintaan yang sama sudah dijalankan; hasilnya sama dan tidak diulang (stok, jurnal, dan riwayat tidak bertambah).");
    } catch (e) {
      if (e.code === "REVISI_BASI" || e.code === "STATUS_TIDAK_SESUAI" || e.code === "KONFLIK_PAYLOAD") await muat(); // tampilkan keadaan terbaru
      if (["REVISI_BASI", "STATUS_TIDAK_SESUAI", "KONFLIK_PAYLOAD"].includes(e.code)) { setKonflik(e.message); throw Object.assign(new Error(e.message), { diam: true }); } // banner halaman tetap terlihat walau kartu aksi berpindah/hilang
      throw e;
    } finally { setSibuk(false); }
  };

  if (!r) {
    return (
      <FokusOverlay open onClose={onTutup} title={memuat ? "Memuat permintaan…" : "Tidak dapat membuka permintaan"} testid="fokus-dokumen">
        {memuat && <p className="flex items-center gap-1.5 py-8 text-[13px] text-ink3" data-testid="memuat-dokumen"><Loader2 size={14} className="animate-spin" /> Memuat permintaan…</p>}
        {!memuat && galat && <div className="space-y-3"><p role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red" data-testid="galat-dokumen">{galat}</p><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={muat} className="max-sm:min-h-11" data-testid="coba-lagi">Coba lagi</Button><Button variant="ghost" size="sm" onClick={onTutup} className="max-sm:min-h-11">Tutup</Button></div></div>}
      </FokusOverlay>
    );
  }

  const SPEC = {
    SETUJUI: { panel: { judul: "Setujui permintaan ini?", tombol: "Setujui & cadangkan stok", peringatan: "Jumlah yang diminta dicadangkan: saldo belum berkurang, tetapi tidak tersedia untuk permintaan lain. Jumlah tidak bisa diubah setelah ini.",
      judulRingkasan: "Stok yang dicadangkan", ringkasan: r.lines.map((l) => `${l.material.code}: ${teksJumlah(l.requestedQty)} ${satuan(l.material.unit)}`), catatan: [adaKurangStok(r.ketersediaan) ? "Stok tersedia belum cukup untuk sebagian item. Persetujuan tetap bisa diberikan, tetapi pengeluaran akan gagal bila saldo belum cukup." : null, r.izin?.pemohonSama ? "Anda juga pemohon dokumen ini. Aturan izin saat ini memperbolehkannya (belum ada penyetuju kedua untuk transaksi rutin); persetujuan Anda tercatat di riwayat." : null].filter(Boolean).join(" ") || undefined, bidang: [] } },
    KEMBALIKAN: { panel: { judul: t.aksi.find((a) => a.kode === "KEMBALIKAN")?.label ?? "Kembalikan ke Draf", tombol: "Kembalikan ke Draf", peringatan: r.status === "WAITING_APPROVAL" ? "Dokumen kembali menjadi Draf supaya isinya bisa diubah; belum ada pengaruh ke stok." : "Dokumen kembali menjadi Draf untuk direvisi. Persetujuan lama GUGUR (tetap ada di riwayat) dan pencadangan stok dilepas. Hanya selama belum dikeluarkan.", bidang: [{ nama: "alasan", label: "Alasan revisi", wajib: true, min: 3, maks: 300 }] } },
    KONFIRMASI_KELUAR: { panel: { judul: "Keluarkan barang dari stok?", tombol: "Keluarkan dari stok", peringatan: "Saldo stok berkurang SEKARANG dan tidak bisa dibatalkan dari sini; salah input diperbaiki lewat jalur koreksi resmi.", galat: galatKeluar,
      ringkasan: dampakKeluar(r.lines, keluar, satuan), bidang: [] } },
    UBAH: { panel: { judul: "Ubah data permintaan", tombol: "Simpan perubahan", peringatan: "Mengubah data pengantar (departemen, prioritas, catatan). Untuk mengubah bahan atau jumlah, kembalikan dulu ke Draf. Perubahan tercatat di riwayat.", bidang: [
      { nama: "department", label: "Departemen", maks: 120, awal: r.department ?? "" }, { nama: "sourceReference", label: "Referensi", maks: 160, awal: r.sourceReference ?? "" },
      { nama: "requiredDate", label: "Dibutuhkan tanggal", tipe: "date", awal: r.requiredDate ? String(r.requiredDate).slice(0, 10) : "" }, { nama: "priority", label: "Prioritas", tipe: "pilih", opsi: PRIORITAS_OPSI, awal: r.priority },
      { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    BATALKAN: { panel: { judul: "Batalkan permintaan ini?", tombol: "Ya, batalkan", peringatan: r.status === "DRAFT" || r.status === "WAITING_APPROVAL" ? "Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah." : "Pencadangan stok dilepas. Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
    BUAT_ULANG: { panel: { judul: "Buat permintaan baru dari dokumen ini?", tombol: "Buat permintaan baru", peringatan: "Dokumen ini tidak diubah dan tidak dihapus. Dibuat dokumen BARU berstatus Draf dengan item dan jumlah yang sama; kedua dokumen saling tertaut di riwayat.", bidang: [{ nama: "alasan", label: "Alasan membuat ulang", wajib: true, min: 3, maks: 300 }] } },
  };
  const aksiTampil = (t.aksi ?? []).filter((a) => !(a.kode === "ATUR_LOKASI" && !adaLokasi));
  const baris = r.lines.map((l) => {
    const k = ket[l.id]; const u = satuan(l.material.unit); const final = r.status === "ISSUED"; const batal = r.status === "CANCELLED";
    const sel = [{ kunci: "diminta", label: "Diminta", numeric: true, tebal: true, isi: `${teksJumlah(l.requestedQty)} ${u}` }];
    if (!final && !batal && k) sel.push({ kunci: "stok", label: "Stok tersedia", lebar: true, isi: <span data-testid="ketersediaan" data-cukup={String(k.cukup)}>{kalimatKetersediaan(k, u)}</span> });
    if (final) sel.push({ kunci: "keluar", label: "Dikeluarkan", numeric: true, tebal: true, isi: `${teksJumlah(l.issuedQty)} ${u}` });
    sel.push({ kunci: "lokasi", label: "Lokasi sumber", lebar: true, isi: bisaLokasi ? <input type="text" value={lokasi[l.id] ?? l.sourceLocation ?? ""} onChange={(e) => setLokasi((x) => ({ ...x, [l.id]: e.target.value }))} placeholder="Catatan lokasi ambil" aria-label={`Lokasi sumber ${l.material.code}`} data-testid={`lokasi-${l.material.code}`} className="w-40 rounded-btn border border-border bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11 max-sm:w-full" /> : (l.sourceLocation || "—") });
    if (bisaKeluar) sel.push({ kunci: "jumlahKeluar", label: "Jumlah keluar", numeric: true, isi: <KolomJumlah nilai={keluar[l.id]} onUbah={(v) => setKeluar((x) => ({ ...x, [l.id]: v }))} label={`Jumlah keluar ${l.material.code}`} testid={`keluar-${l.material.code}`} /> });
    return { id: l.id, kode: l.material.code, nama: l.material.name, sel, peringatan: !final && !batal && k?.cukup === false ? "Stok tersedia belum cukup untuk jumlah ini" : undefined };
  });
  const unit = r.unit ? `${r.unit.unitCode}${r.unit.order?.orderNumber ? ` · ${r.unit.order.orderNumber}` : ""}${r.unit.order?.customer?.name ? ` · ${r.unit.order.customer.name}` : ""}` : (r.sourceReference || "—");

  const kartuAksi = (
    <Card className="space-y-2 p-4" data-testid="kartu-aksi">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Yang bisa dilakukan sekarang</h3>
      {t.aksi.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-aksi">{r.izin?.tulis === false ? "Akun Anda hanya dapat melihat dokumen ini (tidak punya izin mengubah pengeluaran material)." : <>Tidak ada aksi untuk dokumen ini. {t.penjelasan}</>}</p>}
      <AksiDokumen aksi={aksiTampil} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} ikutiVersi={versi} />
      {bisaLokasi && <p className="m-0 text-[11.5px] leading-snug text-ink3">Lokasi sumber hanya catatan tempat barang diambil. Saldo stok dihitung total semua lokasi — sistem belum menyimpan saldo per lokasi.</p>}
    </Card>
  );

  return (
    <FokusOverlay open onClose={onTutup} title={r.issueNumber} subtitle={<span data-testid="identitas-ringkas">{ISSUE_SOURCE_REAL[r.sourceType]?.labelId ?? r.sourceType} · {r.department || unit}</span>} footer={kartuAksi} testid="fokus-dokumen">
      <div className="flex flex-col gap-4">
        <Card className="space-y-3 p-4" data-testid="kartu-identitas">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE[t.warna] ?? "neutral"} data-testid="status-dokumen" data-kode={t.kode}>{t.label}</Badge>
            <Badge variant={ISSUE_PRIORITY_REAL[r.priority]?.tone ?? "neutral"}>Prioritas {ISSUE_PRIORITY_REAL[r.priority]?.labelId ?? r.priority}</Badge>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
            <div><dt className="text-ink3">No. permintaan</dt><dd className="m-0 font-semibold text-ink" data-testid="id-nomor">{r.issueNumber}</dd></div>
            <div><dt className="text-ink3">Sumber</dt><dd className="m-0 font-medium text-ink">{ISSUE_SOURCE_REAL[r.sourceType]?.labelId ?? r.sourceType}</dd></div>
            <div className="col-span-2"><dt className="text-ink3">Unit produksi / referensi</dt><dd className="m-0 font-medium text-ink" data-testid="id-unit">{unit}</dd></div>
            <div><dt className="text-ink3">Departemen</dt><dd className="m-0 font-medium text-ink">{r.department || "—"}</dd></div>
            <div><dt className="text-ink3">Dibutuhkan</dt><dd className="m-0 font-medium text-ink">{tanggalPendek(r.requiredDate)}</dd></div>
            <div><dt className="text-ink3">Diminta oleh</dt><dd className="m-0 font-medium text-ink">{r.requestedBy?.name ?? "—"}</dd></div>
            <div><dt className="text-ink3">Disetujui oleh</dt><dd className="m-0 font-medium text-ink">{r.approvedBy?.name ?? "—"}</dd></div>
            {r.issuedBy && <div><dt className="text-ink3">Dikeluarkan oleh</dt><dd className="m-0 font-medium text-ink">{r.issuedBy.name}</dd></div>}
            <div><dt className="text-ink3">Jumlah item</dt><dd className="m-0 font-medium text-ink">{r.lines.length}</dd></div>
          </dl>
          <AlurPenerimaan tampilan={t} label="Alur pengeluaran material" testid="alur-dokumen" className="pt-2" />
          <p className={`m-0 flex items-start gap-1.5 rounded-btn px-3 py-2 text-[12.5px] leading-snug ${t.pengaruhStok === "SUDAH" ? "bg-greenbg text-green" : "bg-inset text-ink2"}`} data-testid="penjelasan-status"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>{t.penjelasan}</span></p>
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
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Item — diminta, stok tersedia, lokasi, jumlah keluar</h3>
          <TabelItemDokumen baris={baris} />
          {bisaKeluar && galatKeluar && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatKeluar}</p>}
        </Card>


        <KartuJalurKoreksi tipe="MATERIAL_ISSUE" id={id} versi={`${r.status}-${versi}`} ringkas />
        <JejakDokumen jejak={r.jejak} basePath="/warehouse/material-issue" />
        {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
        <Button variant="ghost" size="sm" onClick={muat} disabled={memuat} className="self-start max-sm:min-h-11" data-testid="muat-ulang">{memuat ? <Loader2 size={14} className="animate-spin" /> : null} Muat ulang</Button>
      </div>
      {editOpen && <MaterialIssueFormModal open dokumen={r} onClose={() => setEditOpen(false)} onSaved={(h) => { setEditOpen(false); muat(); void h; }} />}
    </FokusOverlay>
  );
}
