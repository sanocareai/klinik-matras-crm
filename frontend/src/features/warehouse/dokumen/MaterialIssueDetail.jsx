import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api.js";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { IkAwas, IkInfo, IkMuatUlang } from "@/components/gudangIcons.jsx";
import { AngkaGud } from "@/features/warehouse/form/GudKontrol.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import AksiDokumen from "@/features/warehouse/aksi/AksiDokumen.jsx";
import AlurPenerimaan from "@/features/warehouse/penerimaan/AlurPenerimaan.jsx";
import MaterialIssueFormModal from "@/features/warehouse/components/MaterialIssueFormModal.jsx";
import { ISSUE_PRIORITY_REAL, UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import { cn } from "@/lib/utils.js";
import PemakaianUnit from "./PemakaianUnit.jsx";
import { adaKurangStok, angka, dampakKeluar, galatJumlah, kalimatKetersediaan, tanggalPendek, teksJumlah, waktuTeks } from "./dokumenLogic.js";
import { PRIORITAS_LABEL, SUMBER_LABEL, selisihKeluar } from "./miLogic.js";

// RUANG KERJA DOKUMEN PENGELUARAN MATERIAL (redesain Gudang, 3 Nov 2026) — panel kanan (≥1200px) / jendela fokus / layar penuh (HP). Empat bagian yang TIDAK dicampur:
//   PERMINTAAN (apa yang dibutuhkan, siapa yang meminta) · PENGELUARAN (yang benar-benar dikeluarkan Gudang; satu-satunya tempat stok berkurang) · PEMAKAIAN (yang tercatat pada unit, baca-saja) · RIWAYAT.
// Status, tahap, aksi, ketersediaan, dan revisi datang dari server; layar tidak menghitung aturan sendiri. Tombol menyebut dampaknya; setiap aksi berakibat (Setujui, Keluarkan dari stok, Batalkan) memakai konfirmasi di dalam aplikasi.
// Stok BARU berkurang saat "Keluarkan dari stok"; selama Disetujui–Sudah diambil jumlah hanya dicadangkan. Setelah dikeluarkan tidak ada Undo/Hapus: koreksi lewat jalur resmi (kartu di tab Riwayat).
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const STATUS_MAJU = { AJUKAN: "WAITING_APPROVAL", SETUJUI: "APPROVED", SIAPKAN: "READY_TO_PICK", TANDAI_DIAMBIL: "PICKED" };
const PRIORITAS_OPSI = Object.entries(ISSUE_PRIORITY_REAL).map(([nilai, v]) => ({ nilai, label: v.labelId }));
const LABEL_TOMBOL = { SETUJUI: "Setujui & cadangkan stok", KONFIRMASI_KELUAR: "Keluarkan dari stok…", AJUKAN: "Ajukan persetujuan", SIAPKAN: "Tandai siap diambil", TANDAI_DIAMBIL: "Tandai sudah diambil", BATALKAN: "Batalkan permintaan", KEMBALIKAN: "Kembalikan ke Draf" };
const TAB = [{ k: "minta", label: "Permintaan" }, { k: "keluar", label: "Pengeluaran" }, { k: "pakai", label: "Pemakaian" }, { k: "riwayat", label: "Riwayat" }];
const WARNA_PILL = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };

function Baris({ label, children, testid }) { return <div className="gud-dl-baris"><dt>{label}</dt><dd data-testid={testid}>{children}</dd></div>; }

export default function MaterialIssueDetail({ id, onTutup, onBerubah, saringan = "", tempel = false }) {
  const navigate = useNavigate(); const sudahMuat = useRef(false); const kabar = useRef(onBerubah); kabar.current = onBerubah;
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [sibuk, setSibuk] = useState(false);
  const [lokasi, setLokasi] = useState({}); const [keluar, setKeluar] = useState({}); const [versi, setVersi] = useState(0); const [konflik, setKonflik] = useState(""); const [info, setInfo] = useState(""); const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState(null);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = await api.getMaterialIssue(id); setR(d); setLokasi({}); if (sudahMuat.current) kabar.current?.(); sudahMuat.current = true;
      setKeluar(Object.fromEntries(d.lines.map((l) => [l.id, String(l.requestedQty)])));
    } catch (e) { setGalat(e.message || "Gagal memuat permintaan"); } finally { setMemuat(false); setVersi((v) => v + 1); }
  }, [id]);
  useEffect(() => { sudahMuat.current = false; setTab(null); muat(); }, [muat]);

  const t = r?.tampilan; const ket = useMemo(() => Object.fromEntries((r?.ketersediaan ?? []).map((k) => [k.lineId, k])), [r]);
  const kodeAksi = (t?.aksi ?? []).map((a) => a.kode);
  const bisaLokasi = kodeAksi.includes("ATUR_LOKASI"); const bisaKeluar = kodeAksi.includes("KONFIRMASI_KELUAR");
  const adaLokasi = Object.keys(lokasi).length > 0;
  const galatKeluar = bisaKeluar ? galatJumlah(r.lines, keluar) : "";
  const tabKini = tab ?? (r && (r.status === "PICKED" || r.status === "ISSUED") ? "keluar" : "minta");

  const simpanLokasi = async () => { await Promise.all(Object.entries(lokasi).map(([lineId, sourceLocation]) => api.updateMaterialIssueLine(id, lineId, { sourceLocation }))); };
  const jalankan = async (kode, v = {}) => {
    if (kode === "KONFIRMASI_KELUAR" && galatKeluar) { setTab("keluar"); throw new Error(galatKeluar); }
    if (kode === "UBAH_ISI") { setEditOpen(true); return; }
    setKonflik(""); setInfo(""); let hasil = null; setSibuk(true);
    try {
      if (STATUS_MAJU[kode]) { if (adaLokasi) await simpanLokasi(); hasil = await api.updateMaterialIssue(id, { status: STATUS_MAJU[kode], revisi: r.revisi }); }
      else if (kode === "ATUR_LOKASI") await simpanLokasi();
      else if (kode === "KONFIRMASI_KELUAR") { if (adaLokasi) await simpanLokasi(); hasil = await api.issueMaterialIssue(id, { revisi: r.revisi, lines: r.lines.map((l) => ({ lineId: l.id, issuedQty: angka(keluar[l.id]) })) }); }
      else if (kode === "UBAH") await api.updateMaterialIssue(id, { department: v.department, sourceReference: v.sourceReference, requiredDate: v.requiredDate, priority: v.priority, notes: v.notes, revisi: r.revisi });
      else if (kode === "KEMBALIKAN") hasil = await api.kembalikanMaterialIssue(id, v.alasan, r.revisi);
      else if (kode === "BATALKAN") hasil = await api.cancelMaterialIssue(id, v.alasan, r.revisi);
      else if (kode === "BUAT_ULANG") { const baru = await api.buatUlangMaterialIssue(id, v.alasan); navigate(`/warehouse/material-issue/${baru.id}${saringan}`); return; }
      await muat(); if (hasil?.ulang) setInfo("Permintaan yang sama sudah dijalankan; hasilnya sama dan tidak diulang (stok, jurnal, dan riwayat tidak bertambah).");
    } catch (e) {
      if (["REVISI_BASI", "STATUS_TIDAK_SESUAI", "KONFLIK_PAYLOAD"].includes(e.code)) { await muat(); setKonflik(e.message); throw Object.assign(new Error(e.message), { diam: true }); } // banner tetap terlihat walau kartu aksi berpindah/hilang
      throw e;
    } finally { setSibuk(false); }
  };

  if (!r) {
    return (
      <FokusOverlay open onClose={onTutup} tempel={tempel} testid="fokus-dokumen" title={memuat ? "Memuat permintaan…" : "Tidak dapat membuka permintaan"}>
        {memuat && <p className="gud-petunjuk" role="status" data-testid="memuat-dokumen">Memuat permintaan…</p>}
        {!memuat && galat && <div className="gud-bahan-bagian"><p role="alert" className="gud-info" data-nada="galat" data-testid="galat-dokumen">{galat}</p><div className="gud-aksi-baris"><button type="button" className="gud-tombol" onClick={muat} data-testid="coba-lagi">Coba lagi</button><button type="button" className="gud-tombol" onClick={onTutup}>Tutup</button></div></div>}
      </FokusOverlay>
    );
  }

  const SPEC = {
    SETUJUI: { panel: { judul: "Setujui permintaan ini?", tombol: "Setujui & cadangkan stok", peringatan: "Jumlah yang diminta dicadangkan: saldo belum berkurang, tetapi tidak tersedia untuk permintaan lain. Jumlah tidak bisa diubah setelah ini.",
      judulRingkasan: "Stok yang dicadangkan", ringkasan: r.lines.map((l) => `${l.material.code}: ${teksJumlah(l.requestedQty)} ${satuan(l.material.unit)}`), catatan: [adaKurangStok(r.ketersediaan) ? "Stok tersedia belum cukup untuk sebagian item. Persetujuan tetap bisa diberikan, tetapi pengeluaran akan gagal bila saldo belum cukup." : null, r.izin?.pemohonSama ? "Anda juga pemohon dokumen ini. Aturan izin saat ini memperbolehkannya (belum ada penyetuju kedua untuk transaksi rutin); persetujuan Anda tercatat di riwayat." : null].filter(Boolean).join(" ") || undefined, bidang: [] } },
    KEMBALIKAN: { panel: { judul: t.aksi.find((a) => a.kode === "KEMBALIKAN")?.label ?? "Kembalikan ke Draf", tombol: "Kembalikan ke Draf", peringatan: r.status === "WAITING_APPROVAL" ? "Dokumen kembali menjadi Draf supaya isinya bisa diubah; belum ada pengaruh ke stok." : "Dokumen kembali menjadi Draf untuk direvisi. Persetujuan lama GUGUR (tetap ada di riwayat) dan pencadangan stok dilepas. Hanya selama belum dikeluarkan.", bidang: [{ nama: "alasan", label: "Alasan revisi", wajib: true, min: 3, maks: 300 }] } },
    KONFIRMASI_KELUAR: { panel: { judul: "Keluarkan barang dari stok?", tombol: "Keluarkan dari stok", peringatan: "Saldo stok berkurang SEKARANG dan tidak bisa dibatalkan dari sini; salah input diperbaiki lewat jalur koreksi resmi. Bahan langsung tercatat pada unit tujuan (bila ada).", galat: galatKeluar,
      ringkasan: dampakKeluar(r.lines, keluar, satuan), bidang: [] } },
    UBAH: { panel: { judul: "Ubah data permintaan", tombol: "Simpan perubahan data", peringatan: "Mengubah data pengantar (departemen, prioritas, catatan). Untuk mengubah bahan atau jumlah, kembalikan dulu ke Draf. Perubahan tercatat di riwayat.", bidang: [
      { nama: "department", label: "Departemen", maks: 120, awal: r.department ?? "" }, { nama: "sourceReference", label: "Referensi", maks: 160, awal: r.sourceReference ?? "" },
      { nama: "requiredDate", label: "Dibutuhkan tanggal", tipe: "date", awal: r.requiredDate ? String(r.requiredDate).slice(0, 10) : "" }, { nama: "priority", label: "Prioritas", tipe: "pilih", opsi: PRIORITAS_OPSI, awal: r.priority },
      { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    BATALKAN: { panel: { judul: "Batalkan permintaan ini?", tombol: "Ya, batalkan permintaan", peringatan: r.status === "DRAFT" || r.status === "WAITING_APPROVAL" ? "Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah." : "Pencadangan stok dilepas. Dokumen tidak dihapus: tersimpan sebagai Dibatalkan beserta alasan.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
    BUAT_ULANG: { panel: { judul: "Buat permintaan baru dari dokumen ini?", tombol: "Buat permintaan baru", peringatan: "Dokumen ini tidak diubah dan tidak dihapus. Dibuat dokumen BARU berstatus Draf dengan item dan jumlah yang sama; kedua dokumen saling tertaut di riwayat.", bidang: [{ nama: "alasan", label: "Alasan membuat ulang", wajib: true, min: 3, maks: 300 }] } },
  };
  const aksiTampil = (t.aksi ?? []).filter((a) => !(a.kode === "ATUR_LOKASI" && !adaLokasi)).map((a) => (LABEL_TOMBOL[a.kode] ? { ...a, label: LABEL_TOMBOL[a.kode] } : a));
  const final = r.status === "ISSUED"; const batal = r.status === "CANCELLED"; const mencadang = ["APPROVED", "READY_TO_PICK", "PICKED"].includes(r.status);
  const unit = r.unit ? `${r.unit.unitCode}${r.unit.order?.orderNumber ? ` · ${r.unit.order.orderNumber}` : ""}${r.unit.order?.customer?.name ? ` · ${r.unit.order.customer.name}` : ""}` : (r.sourceReference || "Tanpa unit produksi");
  const sebagian = final && r.lines.some((l) => (selisihKeluar(l) ?? 0) > 0);

  const kartuAksi = (
    <div className="space-y-2" data-testid="kartu-aksi">
      {t.aksi.length === 0
        ? <div><p className="gud-petunjuk m-0" data-testid="tanpa-aksi">{r.izin?.tulis === false ? "Akun Anda hanya dapat melihat dokumen ini (tidak punya izin mengubah pengeluaran material)." : <>Tidak ada aksi untuk dokumen ini. {t.penjelasan}</>}</p></div>
        : <AksiDokumen aksi={aksiTampil} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} ikutiVersi={versi} />}
      {bisaLokasi && <div><p className="gud-petunjuk m-0" data-testid="catatan-lokasi-sumber">Lokasi sumber hanya catatan tempat barang diambil. Saldo stok dihitung total semua lokasi — sistem belum menyimpan saldo per lokasi.</p></div>}
    </div>
  );

  return (
    <FokusOverlay
      open onClose={onTutup} tempel={tempel} testid="fokus-dokumen" className="gud-bahan gud-dok"
      title={<span data-testid="id-nomor">{r.issueNumber}</span>}
      subtitle={<span data-testid="identitas-ringkas">{SUMBER_LABEL[r.sourceType] ?? r.sourceType} · {unit}</span>}
      header={(
        <div className="gud-bahan-kepala">
          <div className="gud-bahan-pil">
            <span className="gud-pill gud-pill-titik" data-warna={WARNA_PILL[t.warna] ?? "neutral"} data-testid="status-dokumen" data-kode={t.kode}>{t.label}</span>
            <span className="gud-pill" data-warna={r.priority === "URGENT" ? "red" : r.priority === "HIGH" ? "orange" : "neutral"}>Prioritas {PRIORITAS_LABEL[r.priority] ?? r.priority}</span>
          </div>
          <AlurPenerimaan tampilan={t} label="Alur pengeluaran material" testid="alur-dokumen" />
          <div role="tablist" aria-label="Bagian dokumen" className="gud-tab gud-tab-lipat" data-testid="tab-bagian">
            {TAB.map((x) => <button key={x.k} type="button" role="tab" id={`dok-tab-${x.k}`} aria-selected={tabKini === x.k} aria-controls={`dok-isi-${x.k}`} onClick={() => setTab(x.k)} data-testid={`tab-${x.k}`} className="max-sm:min-h-11">{x.label}</button>)}
          </div>
        </div>
      )}
      footer={kartuAksi}
    >
      <div className="gud-bahan-isi">
        {konflik && (
          <div role="alert" className="gud-info" data-nada="galat" data-testid="banner-konflik">
            <strong>Aksi tidak dijalankan.</strong> {konflik} Halaman sudah dimuat ulang dengan keadaan terbaru. <button type="button" onClick={() => setKonflik("")} className="gud-tautan">Tutup</button>
          </div>
        )}
        {info && (
          <div role="status" className="gud-info" data-testid="banner-ulang">
            <strong>Sudah diproses sebelumnya.</strong> {info} <button type="button" onClick={() => setInfo("")} className="gud-tautan">Tutup</button>
          </div>
        )}

        {/* ── Permintaan ── */}
        <section id="dok-isi-minta" role="tabpanel" aria-labelledby="dok-tab-minta" hidden={tabKini !== "minta"} className="gud-bahan-bagian" data-testid="bagian-permintaan">
          <p className={cn("gud-info", t.pengaruhStok === "SUDAH" && "gud-info-ok")} data-testid="penjelasan-status"><IkInfo size={14} aria-hidden /> {t.penjelasan}</p>
          <dl className="gud-dl" data-testid="kartu-identitas">
            <Baris label="Sumber permintaan">{SUMBER_LABEL[r.sourceType] ?? r.sourceType}</Baris>
            <Baris label="Order / unit tujuan" testid="id-unit">{unit}</Baris>
            <Baris label="Departemen / referensi">{[r.department, r.sourceReference].filter(Boolean).join(" · ") || "—"}</Baris>
            <Baris label="Diminta oleh">{r.requestedBy?.name ?? "—"} · {waktuTeks(r.createdAt)}</Baris>
            <Baris label="Dibutuhkan">{tanggalPendek(r.requiredDate)}</Baris>
            <Baris label="Disetujui oleh">{r.approvedBy?.name ? `${r.approvedBy.name} · ${waktuTeks(r.approvedAt)}` : "Belum disetujui"}</Baris>
            <Baris label="Jumlah baris bahan">{r.lines.length}</Baris>
          </dl>
          {r.notes && <p className="gud-petunjuk" data-testid="catatan-dokumen">Catatan: {r.notes}</p>}
          <div className="gud-bahan-pendukung">
            <h3 className="gud-bahan-sub">Bahan yang diminta</h3>
            <ul className="gud-item-daftar" data-testid="item-dokumen">
              {r.lines.map((l) => {
                const k = ket[l.id]; const u = satuan(l.material.unit);
                return (
                  <li key={l.id} className="gud-item" data-testid="baris-item" data-kode={l.material.code}>
                    <div className="gud-item-nama"><strong>{l.material.code}</strong><span className="gud-redup">{l.material.name}</span></div>
                    <div className="gud-item-angka"><span className="gud-item-label">Diminta</span><span className="gud-angka" data-testid="diminta">{teksJumlah(l.requestedQty)} {u}</span></div>
                    {!final && !batal && k && <p className="gud-petunjuk gud-item-lebar" data-testid="ketersediaan" data-cukup={String(k.cukup)}>{kalimatKetersediaan(k, u)} <span className="gud-redup">(saldo total dikurangi cadangan dokumen lain; perkiraan saat ini, bukan jaminan)</span></p>}
                    {!final && !batal && k?.cukup === false && <p role="note" className="gud-item-lebar gud-merah-teks" data-testid="peringatan-item"><IkAwas size={14} aria-hidden /> Stok tersedia belum cukup untuk jumlah ini</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── Pengeluaran ── */}
        <section id="dok-isi-keluar" role="tabpanel" aria-labelledby="dok-tab-keluar" hidden={tabKini !== "keluar"} className="gud-bahan-bagian" data-testid="bagian-pengeluaran">
          <p className={cn("gud-info", final && "gud-info-ok")} data-testid="status-pengeluaran">
            {final ? <>Dikeluarkan oleh <b>{r.issuedBy?.name ?? "—"}</b> · {waktuTeks(r.issuedAt)}. Saldo stok sudah berkurang sebesar jumlah dikeluarkan di bawah.</>
              : batal ? <>Dibatalkan — tidak ada bahan yang dikeluarkan. Pencadangan stok (bila ada) sudah dilepas.</>
              : mencadang ? <>Belum dikeluarkan. Jumlah diminta <b>dicadangkan</b> (tidak tersedia untuk permintaan lain) tetapi saldo belum berkurang; saldo baru berkurang saat <b>Keluarkan dari stok</b>.</>
              : <>Belum dikeluarkan dan belum dicadangkan — dokumen belum memengaruhi stok.</>}
          </p>
          <ul className="gud-item-daftar" data-testid="item-pengeluaran">
            {r.lines.map((l) => {
              const u = satuan(l.material.unit); const sel = selisihKeluar(l); const k = ket[l.id];
              return (
                <li key={l.id} className="gud-item" data-testid="baris-keluar" data-kode={l.material.code}>
                  <div className="gud-item-nama"><strong>{l.material.code}</strong><span className="gud-redup">{l.material.name}</span></div>
                  <div className="gud-item-angka"><span className="gud-item-label">Diminta</span><span className="gud-angka">{teksJumlah(l.requestedQty)} {u}</span></div>
                  <div className="gud-item-angka"><span className="gud-item-label">Dicadangkan</span><span className="gud-angka" data-testid="dicadangkan">{mencadang ? `${teksJumlah(l.requestedQty)} ${u}` : "—"}</span></div>
                  <div className="gud-item-angka"><span className="gud-item-label">Dikeluarkan</span><span className="gud-angka" data-testid="dikeluarkan">{final ? `${teksJumlah(l.issuedQty)} ${u}` : "—"}</span></div>
                  {final && sel !== null && sel !== 0 && <p className="gud-petunjuk gud-item-lebar" data-testid="selisih-keluar">{sel > 0 ? `Kurang dikeluarkan ${teksJumlah(sel)} ${u} dari yang diminta.` : `Dikeluarkan ${teksJumlah(-sel)} ${u} lebih banyak dari yang diminta.`}</p>}
                  {!final && !batal && k && <p className="gud-petunjuk gud-item-lebar" data-testid="ketersediaan-keluar" data-cukup={String(k.cukup)}>{kalimatKetersediaan(k, u)}</p>}
                  {(bisaLokasi || l.sourceLocation) && (
                    <label className="gud-item-lebar gud-item-isian"><span className="gud-item-label">Lokasi sumber{bisaLokasi ? " (catatan)" : ""}</span>
                      {bisaLokasi ? <input type="text" className="gud-f-teks" value={lokasi[l.id] ?? l.sourceLocation ?? ""} onChange={(e) => setLokasi((x) => ({ ...x, [l.id]: e.target.value }))} placeholder="Catatan lokasi ambil" aria-label={`Lokasi sumber ${l.material.code}`} data-testid={`lokasi-${l.material.code}`} /> : <span>{l.sourceLocation}</span>}
                    </label>
                  )}
                  {bisaKeluar && (
                    <label className="gud-item-lebar gud-item-isian"><span className="gud-item-label">Jumlah yang dikeluarkan</span>
                      <AngkaGud value={keluar[l.id] ?? ""} onChange={(v) => setKeluar((x) => ({ ...x, [l.id]: v }))} satuan={u} aria-label={`Jumlah keluar ${l.material.code}`} data-testid={`keluar-${l.material.code}`} invalid={!!galatKeluar && (keluar[l.id] ?? "") === ""} />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          {bisaKeluar && <p className="gud-petunjuk" data-testid="catatan-keluar">Jumlah dikeluarkan boleh lebih kecil dari yang diminta (pengeluaran sebagian). Dokumen tetap menjadi “Sudah dikeluarkan”; kekurangannya <b>tidak</b> dikeluarkan susulan otomatis — buat permintaan baru bila masih perlu. Bila saldo tidak cukup, server menolak dan tidak ada stok yang berkurang.</p>}
          {sebagian && <p className="gud-info" data-nada="awas" role="note" data-testid="peringatan-sebagian"><IkAwas size={16} aria-hidden /> <span>Dikeluarkan sebagian. Kekurangan dari jumlah yang diminta tidak dikeluarkan susulan; buat permintaan baru bila masih dibutuhkan.</span></p>}
          {bisaKeluar && galatKeluar && <p role="alert" className="gud-f-galat" data-testid="galat-isian">{galatKeluar}</p>}
        </section>

        {/* ── Pemakaian ── */}
        <section id="dok-isi-pakai" role="tabpanel" aria-labelledby="dok-tab-pakai" hidden={tabKini !== "pakai"} data-testid="bagian-pemakaian">
          {tabKini === "pakai" && <PemakaianUnit dokumen={r} />}
        </section>

        {/* ── Riwayat ── */}
        <section id="dok-isi-riwayat" role="tabpanel" aria-labelledby="dok-tab-riwayat" hidden={tabKini !== "riwayat"} className="gud-bahan-bagian" data-testid="bagian-riwayat">
          {r.jejak?.length > 0 ? (
            <ol className="gud-riwayat" data-testid="jejak-dokumen">
              {r.jejak.map((j) => (
                <li key={j.id} data-testid="jejak-baris" data-aksi={j.aksi}>
                  <div><strong>{j.teks}</strong>{j.tautan?.id && <> — <a href={`/warehouse/material-issue/${j.tautan.id}${saringan}`} onClick={(e) => { e.preventDefault(); navigate(`/warehouse/material-issue/${j.tautan.id}${saringan}`, { replace: true }); }} className="gud-tautan-nomor">{j.tautan.nomor}</a></>}</div>
                  <div className="gud-sekunder">{j.oleh ?? "—"} · {waktuTeks(j.waktu)}</div>
                  {j.alasan && <div className="gud-sekunder">Alasan: {j.alasan}</div>}
                </li>
              ))}
            </ol>
          ) : <p className="gud-petunjuk">Belum ada riwayat.</p>}
          <KartuJalurKoreksi tipe="MATERIAL_ISSUE" id={id} versi={`${r.status}-${versi}`} ringkas />
          {galat && <p role="alert" className="gud-f-galat">{galat}</p>}
          <button type="button" className="gud-tombol gud-tombol-kecil" onClick={muat} disabled={memuat} data-testid="muat-ulang"><IkMuatUlang size={14} className={memuat ? "animate-spin" : ""} /> Muat ulang</button>
        </section>
      </div>
      {editOpen && <MaterialIssueFormModal open dokumen={r} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); muat(); }} />}
    </FokusOverlay>
  );
}
