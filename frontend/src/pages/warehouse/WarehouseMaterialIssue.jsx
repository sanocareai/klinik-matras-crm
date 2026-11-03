import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { cn } from "@/lib/utils.js";
import { IkCari, IkKotak, IkMuatUlang, IkPanah, IkTambah, IkTutup } from "@/components/gudangIcons.jsx";
import { useFilterDaftar, querySaringan } from "@/features/warehouse/dokumen/useFilterDaftar.js";
import MaterialIssueDetail from "@/features/warehouse/dokumen/MaterialIssueDetail.jsx";
import MaterialIssueFormModal from "@/features/warehouse/components/MaterialIssueFormModal.jsx";
import FilterPopover from "@/features/warehouse/stok/FilterPopover.jsx";
import { PilihGud, TanggalGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { tanggalPendek } from "@/features/warehouse/dokumen/dokumenLogic.js";
import {
  DASAR_TANGGAL, PRIORITAS_LABEL, STATUS_OPSI, SUMBER_LABEL, TAB_MI, chipMI, filterTabMI, hitunganMI, hitungTabMI, opsiSaringMI, saringMI, tabAktifMI, tindakanBerikutnya,
} from "@/features/warehouse/dokumen/miLogic.js";

// PENGELUARAN MATERIAL (redesain Gudang, 3 Nov 2026) — ruang kerja dokumen: daftar di kiri, rincian dokumen menempel di kanan (≥1200px), jendela fokus di lebar menengah, layar penuh di HP.
// TIGA hal dipisah: PERMINTAAN (apa yang dibutuhkan, siapa yang meminta) · PENGELUARAN (yang benar-benar dikeluarkan Gudang) · PEMAKAIAN (yang tercatat pada unit produksi). Status, tahap, aksi, dan ketersediaan dari server.
// CAKUPAN: seluruh dokumen v1 dimuat sekaligus (GET /inventory/material-issues, tanpa batas baris); tab, saringan, hitungan, dan daftar memakai SATU himpunan yang sama — tidak ada pagination atau urutan palsu
// (daftar terbaru dulu, urutan server). Dokumen Produksi V2 (Planned BOM/reservasi) punya antrean sendiri di "Permintaan Bahan".
const PATH = "/warehouse/material-issue";
const KUNCI = ["tab", "q", "status", "sumber", "prioritas", "peminta", "unit", "bahan", "dasar", "dari", "sampai"];
const tglRingkas = (d) => (d ? new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—");
const labelStatus = (r) => r.tampilan?.label ?? r.status;
const unitTeks = (r) => (r.unit ? { utama: r.unit.unitCode, sub: [r.unit.order?.orderNumber, r.unit.order?.customer?.name].filter(Boolean).join(" · ") } : { utama: r.sourceReference || r.department || "Tanpa unit produksi", sub: r.unit ? "" : (r.sourceReference && r.department ? r.department : "") });

function Baris({ r, aktif, onBuka }) {
  const t = r.tampilan; const u = unitTeks(r); const nb = tindakanBerikutnya(r);
  return (
    <li>
      <button type="button" onClick={() => onBuka(r.id)} aria-current={aktif ? "true" : undefined} data-aktif={aktif ? "ya" : undefined} data-testid="baris-dokumen" data-nomor={r.issueNumber} data-status={r.status}
        className="gud-dok-baris max-sm:min-h-11" aria-label={`Buka ${r.issueNumber}`}>
        <span className="gud-dok-sel gud-dok-nomor"><span className="gud-stok-judul">{r.issueNumber}</span><span className="gud-stok-kode">{SUMBER_LABEL[r.sourceType] ?? r.sourceType}</span><span className="gud-dok-sempit">{r.requestedBy?.name ?? "—"} · {tglRingkas(r.createdAt)}</span></span>
        <span className="gud-dok-sel gud-dok-unit" data-label="Order / unit tujuan"><span className="gud-dok-utama" data-testid="unit-baris">{u.utama}</span>{u.sub && <span className="gud-stok-kode">{u.sub}</span>}</span>
        <span className="gud-dok-sel gud-dok-peminta" data-label="Peminta"><span className="gud-dok-utama">{r.requestedBy?.name ?? "—"}</span>{r.department && <span className="gud-stok-kode">{r.department}</span>}</span>
        <span className="gud-dok-sel gud-dok-tanggal" data-label="Tanggal"><span className="gud-dok-utama">{tanggalPendek(r.createdAt)}</span>{r.requiredDate && <span className="gud-stok-kode">butuh {tglRingkas(r.requiredDate)}</span>}</span>
        <span className="gud-dok-sel gud-dok-tahap" data-label="Tahap"><span className="gud-pill gud-pill-titik" data-warna={t?.warna ?? "neutral"} data-testid="status-baris" title={t?.label}>{labelTahap(t) ?? labelStatus(r)}</span>{r.priority === "URGENT" || r.priority === "HIGH" ? <span className="gud-stok-kode" data-testid="prioritas-baris">Prioritas {PRIORITAS_LABEL[r.priority]}</span> : null}</span>
        <span className="gud-dok-sel gud-dok-berikut" data-label="Tindakan berikutnya"><span className={cn("gud-berikutnya", nb.perlu && "gud-berikutnya-utama")} data-testid="tindakan-berikutnya">{nb.teks}</span></span>
        <IkPanah size={16} aria-hidden className="gud-stok-panah gud-dok-panah" />
      </button>
    </li>
  );
}
// Nama tahap pendek dari alur server (mis. "Disetujui"); kalimat panjang tetap jadi tooltip dan ada di rincian.
const labelTahap = (t) => { if (!t) return null; if (t.tahapIndeks !== null && t.tahapIndeks !== undefined && t.tahap?.[t.tahapIndeks]) return t.tahap[t.tahapIndeks].label; return t.label; };

export default function WarehouseMaterialIssue() {
  const navigate = useNavigate(); const { id } = useParams(); const [sp] = useSearchParams(); useLocation();
  const [f, ubahF, ubahBanyak] = useFilterDaftar(PATH, KUNCI); const tab = tabAktifMI(f.tab); const cari = f.q;
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const jarak = useRef(0);
  useEffect(() => { const b = sp.get("buka"); if (b) navigate(`${PATH}/${b}`, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan lama dibaca sekali

  const load = useCallback((tenang = false) => {
    if (!tenang) setLoading(true); setError("");
    api.getMaterialIssues({}).then((d) => setRows(d.issues)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filter = { ...f, tab };
  const opsi = useMemo(() => (rows ? opsiSaringMI(rows) : { peminta: [], unit: [], bahan: [] }), [rows]);
  const hitungTab = useMemo(() => (rows ? hitungTabMI(rows) : {}), [rows]);
  const terfilter = useMemo(() => (rows ? saringMI(rows, filter) : null), [rows, f, tab]); // eslint-disable-line react-hooks/exhaustive-deps -- filter diturunkan dari f+tab
  const hitungan = useMemo(() => hitunganMI(terfilter ?? []), [terfilter]);
  const chips = chipMI(f, opsi);
  const kosong = !loading && terfilter && terfilter.length === 0;
  const gagalMuat = !!error && !rows;
  const saringan = querySaringan(f, KUNCI);
  const buka = (rid) => { jarak.current = 1; navigate(`${PATH}/${rid}${saringan}`); };
  const tutup = () => { if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${PATH}${saringan}`, { replace: true }); };
  const adaSaringan = chips.length > 0 || !!cari;
  const resetSaringan = () => ubahBanyak({ status: "", sumber: "", prioritas: "", peminta: "", unit: "", bahan: "", dasar: "", dari: "", sampai: "" });
  const hapusChip = (k) => (k === "periode" ? ubahBanyak({ dasar: "", dari: "", sampai: "" }) : ubahF(k, ""));
  const perluTindakan = hitungTab.tindakan ?? 0;
  const dasar = f.dasar || "dibuat";

  const isiFilter = (
    <>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Status dokumen</span><PilihGud value={f.status} onChange={(v) => ubahF("status", v)} opsi={STATUS_OPSI.map((s) => ({ nilai: s.key, label: s.label }))} aria-label="Saring status dokumen" kosongNormal data-testid="saring-status" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Sumber permintaan</span><PilihGud value={f.sumber} onChange={(v) => ubahF("sumber", v)} opsi={[{ nilai: "", label: "Semua sumber" }, ...Object.entries(SUMBER_LABEL).map(([k, l]) => ({ nilai: k, label: l }))]} aria-label="Saring sumber permintaan" kosongNormal data-testid="saring-sumber" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Order / unit produksi</span><PilihGud value={f.unit} onChange={(v) => ubahF("unit", v)} opsi={[{ nilai: "", label: "Semua unit" }, ...opsi.unit]} aria-label="Saring unit produksi" kosongNormal data-testid="saring-unit" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Peminta</span><PilihGud value={f.peminta} onChange={(v) => ubahF("peminta", v)} opsi={[{ nilai: "", label: "Semua peminta" }, ...opsi.peminta]} aria-label="Saring peminta" kosongNormal data-testid="saring-peminta" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Bahan</span><PilihGud value={f.bahan} onChange={(v) => ubahF("bahan", v)} opsi={[{ nilai: "", label: "Semua bahan" }, ...opsi.bahan]} aria-label="Saring bahan" kosongNormal data-testid="saring-bahan" /></label>
      <label className="gud-filter-kolom"><span className="gud-filter-label">Prioritas</span><PilihGud value={f.prioritas} onChange={(v) => ubahF("prioritas", v)} opsi={[{ nilai: "", label: "Semua prioritas" }, ...Object.entries(PRIORITAS_LABEL).map(([k, l]) => ({ nilai: k, label: l }))]} aria-label="Saring prioritas" kosongNormal data-testid="saring-prioritas" /></label>
      <fieldset className="gud-filter-kolom gud-set" data-testid="saring-periode">
        <legend className="gud-filter-label">Periode</legend>
        <PilihGud value={dasar} onChange={(v) => ubahF("dasar", v === "dibuat" ? "" : v)} opsi={DASAR_TANGGAL.map((d) => ({ nilai: d.key, label: d.label }))} aria-label="Dasar tanggal periode" data-testid="saring-dasar" />
        <div className="gud-filter-dua">
          <TanggalGud value={f.dari} onChange={(v) => ubahF("dari", v)} placeholder="Dari tanggal" aria-label="Periode dari tanggal" data-testid="saring-dari" />
          <TanggalGud value={f.sampai} onChange={(v) => ubahF("sampai", v)} placeholder="Sampai tanggal" aria-label="Periode sampai tanggal" data-testid="saring-sampai" />
        </div>
        <span className="gud-filter-bantu">Dokumen tanpa tanggal pada dasar ini tidak ikut saat periode diisi.</span>
      </fieldset>
    </>
  );

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={cn("gud-split gud-stok-split", id && "gud-split-buka")} data-testid="ruang-material-issue">
        <div className="gud-stok-utama">
          <header className="gud-kepala gud-stok-kepala-halaman">
            <div className="gud-judul">
              <h1 className="page-title">Pengeluaran material</h1>
              <p className="page-subtitle">Permintaan bahan dari Produksi atau Gudang, sampai bahan benar-benar keluar dari stok.</p>
            </div>
            <div className="gud-aksi-kepala">
              <button type="button" className="gud-tombol-ikon" onClick={() => load()} disabled={loading} aria-label="Muat ulang daftar" title="Muat ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : ""} /></button>
              <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => setFormOpen(true)} data-testid="permintaan-baru"><IkTambah size={16} /> Permintaan baru</button>
            </div>
          </header>

          <section className="gud-panel gud-daftar gud-stok-panel" aria-label="Daftar pengeluaran material">
            <div className="gud-stok-alat">
              <div className="gud-cari">
                <IkCari size={16} aria-hidden />
                <input type="search" value={cari} onChange={(e) => ubahF("q", e.target.value)} placeholder="Cari no. dokumen, unit, order, peminta, atau bahan..." aria-label="Cari permintaan material" data-testid="cari-dokumen" />
              </div>
              <div data-testid="toolbar-saringan"><FilterPopover jumlah={chips.length} onReset={resetSaringan}>{isiFilter}</FilterPopover></div>
            </div>

            <div role="tablist" aria-label="Kelompok dokumen" className="gud-tab gud-tab-lipat gud-kelompok" data-testid="tab-dokumen">
              {TAB_MI.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => ubahF("tab", t.key === "tindakan" ? "" : t.key)} data-testid={`tab-${t.key}`} className="max-sm:min-h-11">
                  {t.label}<span className="gud-tab-jumlah">{rows ? hitungTab[t.key] ?? 0 : "–"}</span>
                </button>
              ))}
            </div>
            <p className="gud-petunjuk m-0" data-testid="alur-ringkas">Permintaan menjadi <strong>pengeluaran</strong> saat Gudang menekan Konfirmasi keluar — hanya saat itu saldo berkurang. Yang tercatat <strong>dipakai</strong> pada unit ada di tab Pemakaian rincian dokumen.{rows && perluTindakan > 0 && <> <strong>{perluTindakan} dokumen masih berjalan.</strong></>}</p>

            {chips.length > 0 || cari ? (
              <div className="gud-chip-baris" data-testid="chip-saringan" aria-label="Saringan aktif">
                {chips.map((c) => <span key={c.kunci} className="gud-chip" data-testid={`chip-${c.kunci}`}>{c.teks}<button type="button" aria-label={`Hapus saringan ${c.teks}`} onClick={() => hapusChip(c.kunci)}><IkTutup size={12} /></button></span>)}
                {cari && <span className="gud-chip" data-testid="chip-q">Kata kunci: {cari}<button type="button" aria-label="Hapus kata kunci" onClick={() => ubahF("q", "")}><IkTutup size={12} /></button></span>}
                {chips.length > 0 && <button type="button" className="gud-tautan" onClick={resetSaringan} data-testid="atur-ulang-saringan">Reset saringan</button>}
              </div>
            ) : null}

            {error && rows && <div role="alert" className="gud-galat" data-testid="galat-muat">{error} — daftar di bawah dari pemuatan terakhir yang berhasil. <button type="button" className="gud-tautan" onClick={() => load()}>Coba lagi</button></div>}

            <div className="gud-stok-ringkas-hasil">
              <span data-testid="jumlah-tampil">{terfilter ? `${hitungan.dokumen} dokumen sesuai filter` : gagalMuat ? "Daftar gagal dimuat" : "Memuat…"}</span>
              {terfilter && hitungan.dokumen > 0 && <span data-testid="rincian-hitungan" title="Tiga hitungan berbeda, tidak dijumlahkan: dokumen, baris bahan di dokumen-dokumen itu, dan unit produksi berbeda.">{hitungan.barisBahan} baris bahan · {hitungan.unitProduksi} unit produksi</span>}
            </div>

            {gagalMuat ? (
              <div className="gud-kosong" data-testid="daftar-kosong">
                <IkKotak size={28} aria-hidden /><h2>Daftar permintaan gagal dimuat</h2><p>{error}. Tidak ada angka yang ditampilkan sampai data berhasil dimuat.</p>
                <button type="button" className="gud-tombol" onClick={() => load()} data-testid="coba-lagi">Coba lagi</button>
              </div>
            ) : kosong ? (
              <div className="gud-kosong" data-testid="daftar-kosong">
                <IkKotak size={28} aria-hidden />
                <h2>{adaSaringan ? "Tidak ada permintaan yang cocok" : tab === "tindakan" ? "Tidak ada permintaan yang masih berjalan" : "Belum ada dokumen di sini"}</h2>
                <p>{adaSaringan ? "Ubah kata kunci atau saringan." : tab === "tindakan" ? "Permintaan yang menunggu tindakan akan muncul di sini. Yang sudah dikeluarkan ada di tab Sudah dikeluarkan." : "Permintaan bahan dari Produksi atau Gudang akan tampil di sini."}</p>
                {adaSaringan ? <button type="button" className="gud-tombol" onClick={() => { resetSaringan(); ubahF("q", ""); }}>Reset saringan</button> : <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => setFormOpen(true)}><IkTambah size={16} /> Permintaan baru</button>}
              </div>
            ) : (
              <section aria-label="Dokumen" className="gud-stok-daftar" data-testid="daftar-dokumen">
                <div className="gud-dok-kepala" aria-hidden><span>Dokumen</span><span>Order / unit tujuan</span><span>Peminta</span><span>Tanggal</span><span>Tahap</span><span>Tindakan berikutnya</span></div>
                <ul className="gud-stok-ul">
                  {loading ? Array.from({ length: 6 }, (_, n) => <li key={n} className="gud-rangka" aria-hidden><span style={{ display: "block", height: 56, borderRadius: 12 }} /></li>) : terfilter?.map((r) => <Baris key={r.id} r={r} aktif={r.id === id} onBuka={buka} />)}
                </ul>
              </section>
            )}
          </section>
        </div>
        {id && <MaterialIssueDetail key="fokus" id={id} onTutup={tutup} onBerubah={() => load(true)} saringan={saringan} tempel />}
      </div>
      <MaterialIssueFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) buka(d.id); }} />
    </PageContainer>
  );
}
