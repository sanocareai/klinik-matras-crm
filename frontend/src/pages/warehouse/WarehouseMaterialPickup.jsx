import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { FokusOverlay } from "@/components/ui/fokus-overlay.jsx";
import { cn } from "@/lib/utils.js";
import { IkAwas, IkCari, IkInfo, IkKotak, IkMuatUlang, IkPanah, IkTutup } from "@/components/gudangIcons.jsx";
import { GudField, PilihGud, TanggalGud } from "@/features/warehouse/form/GudKontrol.jsx";
import FilterPopover from "@/features/warehouse/stok/FilterPopover.jsx";
import PemakaianUnit from "@/features/warehouse/dokumen/PemakaianUnit.jsx";
import { useFilterDaftar, querySaringan } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import { tanggalPendek, teksJumlah, waktuTeks } from "@/features/warehouse/dokumen/dokumenLogic.js";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import { emptyStateCopy, pickErrorMessage } from "@/features/production/materialPickup.js";
import {
  BATAS_DAFTAR, DASAR_PICKUP, JENIS_OPSI, STATUS_PICKUP_LABEL, STATUS_PICKUP_WARNA, TAB_PICKUP, barisTidakKonsisten, chipPickup, daftarMungkinTerpotong, hitunganPickup, hitungTabPickup, opsiSaringPickup,
  saringPickup, tabAktifPickup, tindakanBerikutnyaPickup,
} from "@/features/warehouse/dokumen/pickupLogic.js";

// PERMINTAAN BAHAN PRODUKSI (V2 / P4; redesain Gudang, 3 Nov 2026) — antrean Gudang atas permintaan dari Produksi (bahan & jumlah dari Planned BOM + reservasi; TIDAK diketik ulang di sini). Daftar di kiri, rincian menempel di kanan.
// TIGA hal dipisah: PERMINTAAN (dari Produksi, per BOM) · PENGELUARAN (Serahkan Bahan: satu-satunya titik stok fisik berkurang + reservasi dipakai + HPP) · PEMAKAIAN (tercatat pada unit, baca-saja).
// Kontrak yang dipertahankan: satu permintaan aktif per rencana; TIDAK ada serah parsial (bila jumlah fisik tidak sesuai, koreksi stok/BOM lebih dulu); batal hanya sebelum diserahkan (reservasi dilepas); idempotensi + revisi dari server.
// BATAS YANG DIJUJURKAN: tidak ada langkah “diterima Produksi” tersendiri dan tidak ada data peminta di kontrak ini; data hanya muncul bila reader V2 aktif untuk unit terkait (di luar itu antrean kosong, bukan galat).
// CAKUPAN: seluruh daftar dimuat (server: terlama dulu, maksimal 200 — bila tepat 200 layar menyatakan mungkin terpotong); tab/saringan/hitungan memakai himpunan yang sama.
const PATH = "/warehouse/material-pickup";
const KUNCI = ["tab", "q", "status", "unit", "bahan", "jenis", "dasar", "dari", "sampai"];
const tglRingkas = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—");
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const kunciBaru = (p) => (globalThis.crypto?.randomUUID ? `${p}-${globalThis.crypto.randomUUID()}` : `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function Baris({ r, aktif, onBuka }) {
  const nb = tindakanBerikutnyaPickup(r);
  return (
    <li>
      <button type="button" onClick={() => onBuka(r.id)} aria-current={aktif ? "true" : undefined} data-testid="baris-permintaan" data-nomor={r.issueNumber} data-status={r.status} className="gud-dok-baris max-sm:min-h-11" aria-label={`Buka ${r.issueNumber}`}>
        <span className="gud-dok-sel gud-dok-nomor"><span className="gud-stok-judul">{r.issueNumber}</span><span className="gud-stok-kode">{r.supplemental ? "Bahan tambahan rework" : "Dari rencana bahan (BOM)"}</span><span className="gud-dok-sempit">{tanggalPendek(r.createdAt)}</span></span>
        <span className="gud-dok-sel gud-dok-unit" data-label="Order / unit tujuan"><span className="gud-dok-utama">{r.unit?.unitCode ?? "—"}</span>{r.unit?.orderNumber && <span className="gud-stok-kode">{r.unit.orderNumber}</span>}</span>
        <span className="gud-dok-sel gud-dok-peminta" data-label="Bahan"><span className="gud-dok-utama">{r.lines.length} baris bahan</span><span className="gud-stok-kode">{r.lines[0] ? `${r.lines[0].name}${r.lines.length > 1 ? ` +${r.lines.length - 1}` : ""}` : "—"}</span></span>
        <span className="gud-dok-sel gud-dok-tanggal" data-label="Tanggal"><span className="gud-dok-utama">{tanggalPendek(r.createdAt)}</span>{r.issuedAt && <span className="gud-stok-kode">diserahkan {tglRingkas(r.issuedAt)}</span>}</span>
        <span className="gud-dok-sel gud-dok-tahap" data-label="Tahap"><span className="gud-pill gud-pill-titik" data-warna={STATUS_PICKUP_WARNA[r.status] ?? "neutral"} data-testid="status-baris">{STATUS_PICKUP_LABEL[r.status] ?? r.status}</span></span>
        <span className="gud-dok-sel gud-dok-berikut" data-label="Tindakan berikutnya"><span className={cn("gud-berikutnya", nb.perlu && "gud-berikutnya-utama")} data-testid="tindakan-berikutnya">{nb.teks}</span></span>
        <IkPanah size={16} aria-hidden className="gud-stok-panah gud-dok-panah" />
      </button>
    </li>
  );
}

function Rincian({ id, onTutup, onBerubah, tempel }) {
  const [r, setR] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [tab, setTab] = useState("minta");
  const [aksi, setAksi] = useState(null); const [alasan, setAlasan] = useState(""); const [galatAlasan, setGalatAlasan] = useState(""); const [galatAksi, setGalatAksi] = useState(""); const [info, setInfo] = useState(""); const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(false); const kunciIdem = useRef({}); const kabar = useRef(onBerubah); kabar.current = onBerubah; const sudah = useRef(false);

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try { setR(await api.getMaterialRequest(id)); if (sudah.current) kabar.current?.(); sudah.current = true; } catch (e) { setGalat(e.message || "Gagal memuat permintaan"); } finally { setMemuat(false); }
  }, [id]);
  useEffect(() => { sudah.current = false; setTab("minta"); setAksi(null); setInfo(""); setGalatAksi(""); muat(); }, [muat]);

  // Satu kunci idempotensi per NIAT (permintaan + revisi + aksi): kirim ulang/klik ganda/jaringan putus memakai kunci yang sama → server memutar ulang hasil, tidak menggandakan pengeluaran.
  const kunciUntuk = (nama) => { const k = `${nama}:${r.id}:${r.revision}`; kunciIdem.current[k] ??= kunciBaru(`issue-${nama}`); return kunciIdem.current[k]; };
  const jalankan = async (nama) => {
    if (kunci.current) return;
    if (nama === "cancel" && alasan.trim().length < 3) { setGalatAlasan("Alasan pembatalan wajib diisi (minimal 3 karakter)."); return; }
    kunci.current = true; setSibuk(true); setGalatAksi(""); setGalatAlasan("");
    try {
      if (nama === "pick") { const h = await api.pickMaterialRequest(r.id, { expectedRevision: r.revision }, kunciUntuk("pick")); setInfo(h.replayed ? "Sudah diproses sebelumnya — tidak ada pengurangan stok ganda." : `Bahan ${r.issueNumber} diserahkan; stok fisik berkurang dan tercatat pada unit.`); }
      else { await api.cancelMaterialRequest(r.id, { reason: alasan.trim(), expectedRevision: r.revision }, kunciUntuk("cancel")); setInfo(`Permintaan ${r.issueNumber} dibatalkan; reservasi dilepas.`); }
      setAksi(null); setAlasan(""); await muat();
    } catch (e) { setGalatAksi(pickErrorMessage(e)); if (["MATERIAL_ISSUE_REVISION_CONFLICT", "MATERIAL_ISSUE_ALREADY_PICKED", "MATERIAL_ISSUE_CANCELLED"].includes(e.code)) await muat(); } // isian alasan TIDAK dihapus saat gagal
    finally { kunci.current = false; setSibuk(false); }
  };

  if (!r) {
    return (
      <FokusOverlay open onClose={onTutup} tempel={tempel} testid="fokus-permintaan" title={memuat ? "Memuat permintaan…" : "Tidak dapat membuka permintaan"}>
        {memuat && <p className="gud-petunjuk" role="status">Memuat permintaan…</p>}
        {!memuat && galat && <div className="gud-bahan-bagian"><p role="alert" className="gud-info" data-nada="galat" data-testid="galat-dokumen">{galat}</p><div className="gud-aksi-baris"><button type="button" className="gud-tombol" onClick={muat}>Coba lagi</button><button type="button" className="gud-tombol" onClick={onTutup}>Tutup</button></div></div>}
      </FokusOverlay>
    );
  }
  const siap = r.status === "READY_TO_PICK"; const tidakSesuai = barisTidakKonsisten(r.lines);
  const dokumen = { id: r.id, issueNumber: r.issueNumber, status: r.status, unitId: r.unit?.id ?? null, unit: r.unit ? { unitCode: r.unit.unitCode } : null, lines: r.lines.map((l) => ({ materialId: l.materialId })), updatedAt: r.issuedAt ?? r.cancelledAt ?? r.createdAt };
  const TABS = [{ k: "minta", label: "Permintaan" }, { k: "keluar", label: "Pengeluaran" }, { k: "pakai", label: "Pemakaian" }];
  const footer = (
    <div className="space-y-2" data-testid="kartu-aksi">
      {siap ? (
        <>
          <div className="gud-aksi-baris">
            <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => { setAksi(aksi === "pick" ? null : "pick"); setGalatAksi(""); }} aria-expanded={aksi === "pick"} data-testid="aksi-serahkan">Serahkan bahan…</button>
            <button type="button" className="gud-tombol gud-tombol-awas" onClick={() => { setAksi(aksi === "cancel" ? null : "cancel"); setGalatAksi(""); }} aria-expanded={aksi === "cancel"} data-testid="aksi-batalkan">Batalkan permintaan…</button>
          </div>
          {aksi === "pick" && (
            <div className="gud-panel-aksi" role="alertdialog" aria-label="Konfirmasi serahkan bahan" data-testid="konfirmasi-serahkan">
              <p className="gud-form-seksi">Serahkan bahan dan kurangi stok?</p>
              <p className="gud-info" data-nada="awas">Stok fisik berkurang SEKARANG sebesar jumlah di bawah, reservasi dipakai, dan bahan tercatat pada unit {r.unit?.unitCode ?? ""}. Tidak ada serah sebagian dan tidak bisa dibatalkan dari sini; bila jumlah fisik tidak sesuai, koreksi stok/BOM lebih dulu.</p>
              <ul className="gud-info m-0 list-none" data-testid="ringkasan-serahkan">{r.lines.map((l) => <li key={l.id}>{l.code}: stok berkurang {teksJumlah(l.planned)} {satuan(l.unit)}</li>)}</ul>
              {galatAksi && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-aksi">{galatAksi}</p>}
              <div className="gud-form-aksi"><button type="button" className="gud-tombol" onClick={() => setAksi(null)}>Batal</button><button type="button" className="gud-tombol gud-tombol-utama" disabled={sibuk} onClick={() => jalankan("pick")} data-testid="ya-serahkan">{sibuk ? "Memproses…" : "Serahkan dan kurangi stok"}</button></div>
            </div>
          )}
          {aksi === "cancel" && (
            <form className="gud-panel-aksi gud-form" noValidate role="alertdialog" aria-label="Konfirmasi batalkan permintaan" data-testid="konfirmasi-batalkan" onSubmit={(e) => { e.preventDefault(); jalankan("cancel"); }}>
              <p className="gud-form-seksi">Batalkan permintaan ini?</p>
              <p className="gud-info">Hanya sebelum bahan diserahkan. Reservasi dilepas dan rencana kembali ke Direncanakan; stok tidak berubah. Dokumen tersimpan sebagai Dibatalkan beserta alasan.</p>
              <GudField label="Alasan pembatalan" htmlFor="pk-alasan" wajib galat={galatAlasan}><textarea id="pk-alasan" rows={3} className="gud-f-teks gud-f-area" value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalatAlasan(""); }} maxLength={300} aria-invalid={!!galatAlasan || undefined} data-testid="alasan-batal" /></GudField>
              {galatAksi && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-aksi">{galatAksi}</p>}
              <div className="gud-form-aksi"><button type="button" className="gud-tombol" onClick={() => setAksi(null)}>Kembali</button><button type="submit" className="gud-tombol gud-tombol-utama" disabled={sibuk} data-testid="ya-batalkan">{sibuk ? "Menyimpan…" : "Ya, batalkan permintaan"}</button></div>
            </form>
          )}
        </>
      ) : <div><p className="gud-petunjuk m-0" data-testid="tanpa-aksi">{r.status === "ISSUED" ? "Sudah diserahkan: tidak ada aksi di sini. Salah input diperbaiki lewat pengembalian bahan atau penyesuaian stok (jalur koreksi resmi)." : "Permintaan dibatalkan: tidak ada aksi."}</p></div>}
    </div>
  );

  return (
    <FokusOverlay open onClose={onTutup} tempel={tempel} testid="fokus-permintaan" className="gud-bahan gud-dok" title={<span data-testid="id-nomor">{r.issueNumber}</span>}
      subtitle={<span data-testid="identitas-ringkas">{r.supplemental ? "Bahan tambahan rework" : "Dari rencana bahan (BOM)"} · {r.unit?.unitCode ?? "—"}{r.unit?.orderNumber ? ` · ${r.unit.orderNumber}` : ""}</span>}
      header={(
        <div className="gud-bahan-kepala">
          <div className="gud-bahan-pil"><span className="gud-pill gud-pill-titik" data-warna={STATUS_PICKUP_WARNA[r.status] ?? "neutral"} data-testid="status-dokumen" data-kode={r.status}>{STATUS_PICKUP_LABEL[r.status] ?? r.status}</span></div>
          <div role="tablist" aria-label="Bagian permintaan" className="gud-tab gud-tab-lipat" data-testid="tab-bagian">
            {TABS.map((x) => <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)} data-testid={`tab-${x.k}`} className="max-sm:min-h-11">{x.label}</button>)}
          </div>
        </div>
      )} footer={footer}>
      <div className="gud-bahan-isi">
        {info && <div role="status" className="gud-info gud-info-ok" data-testid="banner-hasil">{info} <button type="button" className="gud-tautan" onClick={() => setInfo("")}>Tutup</button></div>}
        <section hidden={tab !== "minta"} className="gud-bahan-bagian" role="tabpanel" data-testid="bagian-permintaan">
          <p className="gud-info" data-testid="penjelasan-status"><IkInfo size={14} aria-hidden /> {r.status === "READY_TO_PICK" ? "Produksi sudah meminta bahan sesuai Planned BOM; jumlah sudah DIRESERVASI (belum mengurangi stok). Stok baru berkurang saat Gudang menyerahkan bahan." : r.status === "ISSUED" ? "Bahan sudah diserahkan: stok fisik sudah berkurang dan tercatat pada unit." : `Dibatalkan${r.cancelReason ? `: ${r.cancelReason}` : ""}. Reservasi dilepas; stok tidak berubah.`}</p>
          <dl className="gud-dl">
            <div className="gud-dl-baris"><dt>Order / unit tujuan</dt><dd data-testid="id-unit">{r.unit?.unitCode ?? "—"}{r.unit?.orderNumber ? ` · ${r.unit.orderNumber}` : ""}</dd></div>
            <div className="gud-dl-baris"><dt>Jenis</dt><dd>{r.supplemental ? "Bahan tambahan rework" : "Dari rencana bahan (BOM)"}</dd></div>
            <div className="gud-dl-baris"><dt>Diajukan</dt><dd>{waktuTeks(r.createdAt)}</dd></div>
            <div className="gud-dl-baris"><dt>Status rencana produksi</dt><dd>{r.planStatus ?? "—"}</dd></div>
            <div className="gud-dl-baris"><dt>Jumlah baris bahan</dt><dd>{r.lines.length}</dd></div>
          </dl>
          <p className="gud-petunjuk">Peminta tidak tercatat pada kontrak permintaan ini; bahan dan jumlah berasal dari rencana bahan (BOM) Produksi.</p>
          <div className="gud-bahan-pendukung">
            <h3 className="gud-bahan-sub">Bahan yang diminta</h3>
            <ul className="gud-bhn-daftar" data-testid="item-dokumen">
              {r.lines.map((l) => (
                <li key={l.id} className="gud-bhn" data-testid="baris-item" data-kode={l.code}>
                  <div className="gud-bhn-nama"><strong>{l.code}</strong><span className="gud-redup">{l.name}</span></div>
                  <div className="gud-bhn-angka"><span className="gud-bhn-label">Rencana (BOM)</span><span className="gud-angka">{teksJumlah(l.planned)} {satuan(l.unit)}</span></div>
                  <div className="gud-bhn-angka"><span className="gud-bhn-label">Direservasi</span><span className={cn("gud-angka", Number(l.planned) !== Number(l.reserved) && "gud-minus")} data-testid="direservasi">{teksJumlah(l.reserved)} {satuan(l.unit)}</span></div>
                </li>
              ))}
            </ul>
            {tidakSesuai.length > 0 && <p className="gud-info" data-nada="awas" role="note" data-testid="peringatan-reservasi"><IkAwas size={16} aria-hidden /> <span>Jumlah direservasi tidak sama dengan rencana untuk {tidakSesuai.map((l) => l.code).join(", ")}. Periksa dengan Produksi sebelum menyerahkan.</span></p>}
          </div>
        </section>
        <section hidden={tab !== "keluar"} className="gud-bahan-bagian" role="tabpanel" data-testid="bagian-pengeluaran">
          <p className={cn("gud-info", r.status === "ISSUED" && "gud-info-ok")} data-testid="status-pengeluaran">{r.status === "ISSUED" ? <>Diserahkan {waktuTeks(r.issuedAt)}. Stok fisik sudah berkurang sebesar jumlah diserahkan di bawah.</> : r.status === "CANCELLED" ? <>Dibatalkan — tidak ada bahan yang diserahkan.</> : <>Belum diserahkan. Jumlah hanya direservasi; saldo baru berkurang saat <b>Serahkan bahan</b>.</>}</p>
          <ul className="gud-bhn-daftar">
            {r.lines.map((l) => (
              <li key={l.id} className="gud-bhn" data-testid="baris-keluar" data-kode={l.code}>
                <div className="gud-bhn-nama"><strong>{l.code}</strong><span className="gud-redup">{l.name}</span></div>
                <div className="gud-bhn-angka"><span className="gud-bhn-label">Direservasi</span><span className="gud-angka">{teksJumlah(l.reserved)} {satuan(l.unit)}</span></div>
                <div className="gud-bhn-angka"><span className="gud-bhn-label">Diserahkan</span><span className="gud-angka" data-testid="diserahkan">{r.status === "ISSUED" ? `${teksJumlah(l.picked)} ${satuan(l.unit)}` : "—"}</span></div>
                <div className="gud-bhn-angka"><span className="gud-bhn-label">Status reservasi</span><span>{l.reservationStatus ?? "—"}</span></div>
              </li>
            ))}
          </ul>
          <p className="gud-petunjuk">Tidak ada serah parsial: jumlah diserahkan = jumlah direservasi. Saldo fisik tidak cukup → server menolak dan tidak ada stok yang berkurang. Tidak ada langkah “diterima Produksi” terpisah di sistem.</p>
        </section>
        <section hidden={tab !== "pakai"} role="tabpanel" data-testid="bagian-pemakaian">{tab === "pakai" && <PemakaianUnit dokumen={dokumen} />}</section>
        {galat && <p role="alert" className="gud-f-galat">{galat}</p>}
        <button type="button" className="gud-tombol gud-tombol-kecil" onClick={muat} disabled={memuat} data-testid="muat-ulang"><IkMuatUlang size={14} className={memuat ? "animate-spin" : ""} /> Muat ulang</button>
      </div>
    </FokusOverlay>
  );
}

export default function WarehouseMaterialPickup() {
  const navigate = useNavigate(); const { id } = useParams();
  const [f, ubahF, ubahBanyak] = useFilterDaftar(PATH, KUNCI); const tab = tabAktifPickup(f.tab); const cari = f.q;
  const [rows, setRows] = useState(null); const [readerMode, setReaderMode] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const jarak = useRef(0);
  const load = useCallback((tenang = false) => {
    if (!tenang) setLoading(true); setError("");
    api.getMaterialRequests({ limit: String(BATAS_DAFTAR) }).then((d) => { setRows((d.items || []).slice().reverse()); setReaderMode(d.readerMode || null); }).catch((e) => setError(e.message || "Gagal memuat antrean")).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const opsi = useMemo(() => (rows ? opsiSaringPickup(rows) : { unit: [], bahan: [] }), [rows]);
  const hitungTab = useMemo(() => (rows ? hitungTabPickup(rows) : {}), [rows]);
  const terfilter = useMemo(() => (rows ? saringPickup(rows, { ...f, tab }) : null), [rows, f, tab]);
  const hitungan = useMemo(() => hitunganPickup(terfilter ?? []), [terfilter]);
  const chips = chipPickup(f, opsi); const kosong = !loading && terfilter && terfilter.length === 0; const gagalMuat = !!error && !rows;
  const saringan = querySaringan(f, KUNCI);
  const buka = (rid) => { jarak.current = 1; navigate(`${PATH}/${rid}${saringan}`); };
  const tutup = () => { if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${PATH}${saringan}`, { replace: true }); };
  const resetSaringan = () => ubahBanyak({ status: "", unit: "", bahan: "", jenis: "", dasar: "", dari: "", sampai: "" });
  const hapusChip = (k) => (k === "periode" ? ubahBanyak({ dasar: "", dari: "", sampai: "" }) : ubahF(k, ""));
  const adaSaringan = chips.length > 0 || !!cari; const dasar = f.dasar || "dibuat";
  const salinan = emptyStateCopy({ readerMode, tabKey: "READY_TO_PICK" });
  const perlu = hitungTab.tindakan ?? 0;

  const isiFilter = (
    <>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Status</span><PilihGud value={f.status} onChange={(v) => ubahF("status", v)} opsi={[{ nilai: "", label: "Semua status" }, ...Object.entries(STATUS_PICKUP_LABEL).map(([k, l]) => ({ nilai: k, label: l }))]} aria-label="Saring status" kosongNormal data-testid="saring-status" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Order / unit produksi</span><PilihGud value={f.unit} onChange={(v) => ubahF("unit", v)} opsi={[{ nilai: "", label: "Semua unit" }, ...opsi.unit]} aria-label="Saring unit produksi" kosongNormal data-testid="saring-unit" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Bahan</span><PilihGud value={f.bahan} onChange={(v) => ubahF("bahan", v)} opsi={[{ nilai: "", label: "Semua bahan" }, ...opsi.bahan]} aria-label="Saring bahan" kosongNormal data-testid="saring-bahan" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Jenis permintaan</span><PilihGud value={f.jenis} onChange={(v) => ubahF("jenis", v)} opsi={JENIS_OPSI.map((j) => ({ nilai: j.key, label: j.label }))} aria-label="Saring jenis permintaan" kosongNormal data-testid="saring-jenis" /></label>
      <fieldset className="gud-filter-kolom gud-set" data-testid="saring-periode">
        <legend className="gud-filter-label">Periode</legend>
        <PilihGud value={dasar} onChange={(v) => ubahF("dasar", v === "dibuat" ? "" : v)} opsi={DASAR_PICKUP.map((d) => ({ nilai: d.key, label: d.label }))} aria-label="Dasar tanggal periode" data-testid="saring-dasar" />
        <div className="gud-filter-dua"><TanggalGud value={f.dari} onChange={(v) => ubahF("dari", v)} placeholder="Dari tanggal" aria-label="Periode dari tanggal" data-testid="saring-dari" /><TanggalGud value={f.sampai} onChange={(v) => ubahF("sampai", v)} placeholder="Sampai tanggal" aria-label="Periode sampai tanggal" data-testid="saring-sampai" /></div>
        <span className="gud-filter-bantu">Permintaan tanpa tanggal pada dasar ini tidak ikut saat periode diisi.</span>
      </fieldset>
    </>
  );

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={cn("gud-split gud-stok-split", id && "gud-split-buka")} data-testid="ruang-pickup">
        <div className="gud-stok-utama">
          <header className="gud-kepala gud-stok-kepala-halaman">
            <div className="gud-judul"><h1 className="page-title">Permintaan bahan produksi</h1><p className="page-subtitle">Bahan yang diminta Produksi dari rencana bahan (BOM). Stok berkurang saat Gudang menyerahkan bahan.</p></div>
            <div className="gud-aksi-kepala"><button type="button" className="gud-tombol-ikon" onClick={() => load()} disabled={loading} aria-label="Muat ulang daftar" title="Muat ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : ""} /></button></div>
          </header>
          <section className="gud-panel gud-daftar gud-stok-panel" aria-label="Daftar permintaan bahan produksi">
            <div className="gud-stok-alat">
              <div className="gud-cari"><IkCari size={16} aria-hidden /><input type="search" value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari no. permintaan, unit, order, atau bahan..." aria-label="Cari permintaan bahan" data-testid="cari-dokumen" /></div>
              <div data-testid="toolbar-saringan"><FilterPopover jumlah={chips.length} onReset={resetSaringan}>{isiFilter}</FilterPopover></div>
            </div>
            <div role="tablist" aria-label="Kelompok permintaan" className="gud-tab gud-tab-lipat gud-kelompok" data-testid="tab-dokumen">
              {TAB_PICKUP.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => ubahF("tab", t.key === "tindakan" ? "" : t.key)} data-testid={`tab-${t.key}`} className="max-sm:min-h-11">{t.label}<span className="gud-tab-jumlah">{rows ? hitungTab[t.key] ?? 0 : "–"}</span></button>)}
            </div>
            <p className="gud-petunjuk m-0" data-testid="alur-ringkas">Permintaan datang dari Produksi dan sudah direservasi; <strong>pengeluaran</strong> terjadi saat Serahkan bahan; yang tercatat <strong>dipakai</strong> pada unit ada di tab Pemakaian.{rows && perlu > 0 && <> <strong>{perlu} permintaan menunggu diserahkan.</strong></>}</p>
            {(chips.length > 0 || cari) && (
              <div className="gud-chip-baris" data-testid="chip-saringan" aria-label="Saringan aktif">
                {chips.map((c) => <span key={c.kunci} className="gud-chip" data-testid={`chip-${c.kunci}`}>{c.teks}<button type="button" aria-label={`Hapus saringan ${c.teks}`} onClick={() => hapusChip(c.kunci)}><IkTutup size={12} /></button></span>)}
                {cari && <span className="gud-chip" data-testid="chip-q">Kata kunci: {cari}<button type="button" aria-label="Hapus kata kunci" onClick={() => ubahF("q", "")}><IkTutup size={12} /></button></span>}
                {chips.length > 0 && <button type="button" className="gud-tautan" onClick={resetSaringan} data-testid="atur-ulang-saringan">Reset saringan</button>}
              </div>
            )}
            {error && rows && <div role="alert" className="gud-galat" data-testid="galat-muat">{error} — daftar dari pemuatan terakhir yang berhasil. <button type="button" className="gud-tautan" onClick={() => load()}>Coba lagi</button></div>}
            {rows && daftarMungkinTerpotong(rows) && <p className="gud-info" data-nada="awas" role="note" data-testid="daftar-terpotong">Server hanya mengirim {BATAS_DAFTAR} permintaan (terlama dulu). Daftar ini mungkin tidak memuat permintaan yang lebih baru; angka di layar hanya untuk yang dimuat.</p>}
            <div className="gud-stok-ringkas-hasil">
              <span data-testid="jumlah-tampil">{terfilter ? `${hitungan.dokumen} permintaan sesuai filter` : gagalMuat ? "Daftar gagal dimuat" : "Memuat…"}</span>
              {terfilter && hitungan.dokumen > 0 && <span data-testid="rincian-hitungan" title="Tiga hitungan berbeda, tidak dijumlahkan.">{hitungan.barisBahan} baris bahan · {hitungan.unitProduksi} unit produksi</span>}
            </div>
            {gagalMuat ? (
              <div className="gud-kosong" data-testid="daftar-kosong"><IkKotak size={28} aria-hidden /><h2>Antrean gagal dimuat</h2><p>{error}. Tidak ada angka yang ditampilkan sampai data berhasil dimuat.</p><button type="button" className="gud-tombol" onClick={() => load()}>Coba lagi</button></div>
            ) : kosong ? (
              <div className="gud-kosong" data-testid="daftar-kosong"><IkKotak size={28} aria-hidden /><h2>{adaSaringan ? "Tidak ada permintaan yang cocok" : readerMode === "OFF" ? salinan.title : tab === "tindakan" ? "Tidak ada permintaan yang menunggu diserahkan" : "Belum ada permintaan di sini"}</h2><p>{adaSaringan ? "Ubah kata kunci atau saringan." : readerMode === "OFF" ? salinan.description : "Permintaan dari Produksi akan muncul di sini."}</p>{adaSaringan && <button type="button" className="gud-tombol" onClick={() => { resetSaringan(); ubahF("q", ""); }}>Reset saringan</button>}</div>
            ) : (
              <section aria-label="Permintaan" className="gud-stok-daftar" data-testid="daftar-dokumen">
                <div className="gud-dok-kepala" aria-hidden><span>Permintaan</span><span>Order / unit tujuan</span><span>Bahan</span><span>Tanggal</span><span>Tahap</span><span>Tindakan berikutnya</span></div>
                <ul className="gud-stok-ul">{loading ? Array.from({ length: 5 }, (_, n) => <li key={n} className="gud-rangka" aria-hidden><span style={{ display: "block", height: 56, borderRadius: 12 }} /></li>) : terfilter?.map((r) => <Baris key={r.id} r={r} aktif={r.id === id} onBuka={buka} />)}</ul>
              </section>
            )}
          </section>
        </div>
        {id && <Rincian key={id} id={id} onTutup={tutup} onBerubah={() => load(true)} tempel />}
      </div>
    </PageContainer>
  );
}
