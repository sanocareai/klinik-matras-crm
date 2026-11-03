import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { IkAwas, IkCari, IkMuatUlang, IkSampah, IkTambah, IkTutup } from "@/components/gudangIcons.jsx";
import { AngkaGud, GudField, PilihGud, TanggalGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { ISSUE_SOURCE_REAL, ISSUE_PRIORITY_REAL, UNIT_LABEL } from "../inventoryReal.js";
import { tampilSaldo } from "../stok/stokLogic.js";
import { teksJumlah } from "../dokumen/dokumenLogic.js";

// PERMINTAAN MATERIAL (buat / ubah isi Draf) — redesain Gudang, 3 Nov 2026. Dialog lebar dua bagian: (1) data permintaan, (2) bahan: katalog/pencarian di satu sisi, daftar yang diminta di sisi lain (di HP berurutan: daftar dulu,
// lalu pencarian). Aturan TIDAK berubah: status awal Draf (POST /inventory/material-issues) atau ubah isi Draf (PUT /:id/isi dengan revisi); jumlah diminta > 0 (itulah yang dicadangkan setelah disetujui); unit produksi WAJIB untuk
// Work Order Produksi; stok kurang TIDAK memblokir Draf (hanya diperingatkan — pencadangan baru terjadi saat disetujui). Draf dan membuka/membatalkan form tidak mengubah stok. Isian bertahan saat gagal; klik ganda = satu permintaan (kunci ref).
// Ketersediaan di katalog = angka server (/inventory/beranda/stok): "belum diketahui" ≠ 0; Tersedia = saldo − dicadangkan, perkiraan saat ini, BUKAN jaminan.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const SUMBER_OPSI = Object.entries(ISSUE_SOURCE_REAL).map(([k, s]) => ({ nilai: k, label: s.labelId || s.label }));
const PRIORITAS_OPSI = Object.entries(ISSUE_PRIORITY_REAL).map(([k, p]) => ({ nilai: k, label: p.labelId || p.label }));
const BATAS_KATALOG = 40;
const angkaOf = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
const cocok = (r, q) => { const k = String(q ?? "").trim().toLowerCase(); if (!k) return true; const t = `${r.kode} ${r.nama} ${r.vendor ?? ""}`.toLowerCase(); return k.split(/\s+/).every((p) => t.includes(p)); };

function tersediaTeks(row) {
  if (!row) return { teks: "ketersediaan tidak diketahui", nada: "redup" };
  const s = tampilSaldo(row);
  if (s.jenis === "BELUM_DIKETAHUI") return { teks: "stok belum diketahui", nada: "awas" };
  const v = row.tersedia === null || row.tersedia === undefined ? row.saldo : row.tersedia;
  return { teks: `tersedia ${teksJumlah(v)} ${satuan(row.satuan)}`, nada: Number(v) <= 0 ? "awas" : "biasa", angka: Number(v) };
}

export default function MaterialIssueFormModal({ open, onClose, onCreated, dokumen = null, onSaved }) {
  const ubah = !!dokumen; // mode UBAH ISI (Draf): sumber permintaan terkunci
  const [katalog, setKatalog] = useState(null); const [galatKatalog, setGalatKatalog] = useState("");
  const [sourceType, setSourceType] = useState("PRODUCTION_WORK_ORDER");
  const [unitId, setUnitId] = useState(""); const [unitLabel, setUnitLabel] = useState(""); const [unitQuery, setUnitQuery] = useState(""); const [unitResults, setUnitResults] = useState([]); const [unitSearching, setUnitSearching] = useState(false);
  const [sourceReference, setSourceReference] = useState(""); const [department, setDepartment] = useState(""); const [requiredDate, setRequiredDate] = useState(""); const [priority, setPriority] = useState("NORMAL"); const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]); const [cari, setCari] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [galat, setGalat] = useState({});
  const searchTimer = useRef(null); const kunci = useRef(false); const lineRefs = useRef({});

  useEffect(() => {
    if (!open) return;
    setErr(""); setGalat({}); setCari(""); setUnitQuery(""); setUnitResults([]); kunci.current = false;
    if (dokumen) {
      setSourceType(dokumen.sourceType); setUnitId(dokumen.unitId || "");
      setUnitLabel(dokumen.unit ? `${dokumen.unit.unitCode} — ${dokumen.unit.order?.orderNumber || "—"} (${dokumen.unit.order?.customer?.name || "—"})` : "");
      setSourceReference(dokumen.sourceReference || ""); setDepartment(dokumen.department || ""); setRequiredDate(dokumen.requiredDate ? String(dokumen.requiredDate).slice(0, 10) : "");
      setPriority(dokumen.priority || "NORMAL"); setNotes(dokumen.notes || "");
      setLines(dokumen.lines.map((l) => ({ materialId: l.materialId, kode: l.material.code, nama: l.material.name, satuan: l.material.unit, qty: String(l.requestedQty), sourceLocation: l.sourceLocation, notes: l.notes })));
    } else {
      setSourceType("PRODUCTION_WORK_ORDER"); setUnitId(""); setUnitLabel(""); setSourceReference(""); setDepartment(""); setRequiredDate(""); setPriority("NORMAL"); setNotes(""); setLines([]);
    }
    setKatalog(null); setGalatKatalog("");
    api.getStokLokasi().then((d) => setKatalog((d.rows ?? []).filter((r) => r.aktif !== false))).catch((e) => setGalatKatalog(e.message || "Katalog bahan gagal dimuat"));
  }, [open, dokumen]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!unitQuery.trim() || unitId) { setUnitResults([]); return undefined; }
    setUnitSearching(true);
    searchTimer.current = setTimeout(() => {
      api.getWorkOrders({ q: unitQuery.trim() }).then((d) => setUnitResults((d.units || []).slice(0, 8))).catch(() => setUnitResults([])).finally(() => setUnitSearching(false));
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [unitQuery, unitId]);

  const peta = useMemo(() => new Map((katalog ?? []).map((r) => [r.materialId, r])), [katalog]);
  const hasilKatalog = useMemo(() => (katalog ?? []).filter((r) => cocok(r, cari)), [katalog, cari]);
  const sudah = useMemo(() => new Set(lines.map((l) => l.materialId)), [lines]);

  const pilihUnit = (u) => { setUnitId(u.id); setUnitLabel(`${u.unitCode} — ${u.order?.orderNumber || "—"} (${u.order?.customer?.name || "—"})`); setUnitQuery(""); setUnitResults([]); setGalat((g) => ({ ...g, unit: undefined })); };
  const tambahBahan = (r) => {
    if (sudah.has(r.materialId)) { lineRefs.current[r.materialId]?.focus?.(); return; }
    setLines((ls) => [...ls, { materialId: r.materialId, kode: r.kode, nama: r.nama, satuan: r.satuan, qty: "" }]); setGalat((g) => ({ ...g, baris: undefined }));
    setTimeout(() => lineRefs.current[r.materialId]?.focus?.(), 60);
  };
  const ubahQty = (mid, v) => { setLines((ls) => ls.map((l) => (l.materialId === mid ? { ...l, qty: v } : l))); setGalat((g) => ({ ...g, [`qty-${mid}`]: undefined, baris: undefined })); };
  const hapusBaris = (mid) => setLines((ls) => ls.filter((l) => l.materialId !== mid));

  function periksa() {
    const g = {};
    if (sourceType === "PRODUCTION_WORK_ORDER" && !unitId) g.unit = "Unit produksi wajib dipilih untuk permintaan dari Work Order Produksi.";
    if (lines.length === 0) g.baris = "Tambahkan minimal satu bahan dari katalog.";
    for (const l of lines) { const n = angkaOf(l.qty); if (!(n > 0)) g[`qty-${l.materialId}`] = String(l.qty ?? "").trim() === "" ? "Isi jumlah yang diminta." : "Jumlah harus lebih dari 0."; }
    return g;
  }

  async function simpan(e) {
    e?.preventDefault();
    if (kunci.current) return;
    const g = periksa(); setGalat(g);
    if (Object.keys(g).length > 0) { setErr(""); return; }
    kunci.current = true; setBusy(true); setErr("");
    const valid = lines.map((l) => ({ ...l, requestedQty: String(angkaOf(l.qty)) }));
    try {
      if (ubah) {
        const hasil = await api.ubahIsiMaterialIssue(dokumen.id, {
          revisi: dokumen.revisi, unitId: unitId || null, sourceReference, department, requiredDate: requiredDate || null, priority, notes,
          lines: valid.map((l) => ({ materialId: l.materialId, requestedQty: l.requestedQty, sourceLocation: l.sourceLocation, notes: l.notes })),
        });
        onSaved?.(hasil); onClose(); return;
      }
      const baru = await api.createMaterialIssue({
        sourceType, unitId: unitId || undefined, sourceReference: sourceReference || undefined, department: department || undefined,
        requiredDate: requiredDate || undefined, priority, notes: notes || undefined, lines: valid.map((l) => ({ materialId: l.materialId, requestedQty: l.requestedQty })),
      });
      onCreated?.(baru); onClose();
    } catch (e2) { setErr(e2.message); } // isian TIDAK dihapus
    finally { kunci.current = false; setBusy(false); }
  }

  const wajibUnit = sourceType === "PRODUCTION_WORK_ORDER";
  return (
    <Modal portalToBody dialogBilaTempel open={open} onOpenChange={(o) => (o ? null : onClose())} title={ubah ? `Ubah isi ${dokumen.issueNumber}` : "Permintaan material baru"}
      description={ubah ? "Hanya selama Draf. Mengubah isi tidak memengaruhi stok; perubahan tercatat di riwayat." : "Disimpan sebagai Draf: belum memengaruhi stok. Stok baru dicadangkan setelah disetujui dan berkurang saat dikeluarkan."} className="sm:w-[1120px] gud-modal"
      footer={(
        <>
          <button type="button" className="gud-tombol" onClick={onClose}>Batal</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={simpan} disabled={busy} data-testid="simpan-permintaan">{busy && <IkMuatUlang size={14} className="animate-spin" />}{ubah ? "Simpan perubahan isi" : "Simpan sebagai draf"}</button>
        </>
      )}>
      <form onSubmit={simpan} noValidate className="gud-form gud-form-bagian" data-testid="form-permintaan">
        <div className="gud-mi-grid">
        <fieldset className="gud-f-seksi" data-testid="seksi-data">
          <legend className="gud-f-bagian-judul">1. Data permintaan</legend>
          <div className="gud-form-baris">
            <GudField label="Sumber permintaan" htmlFor="mi-source" wajib hint={ubah ? "Sumber dikunci setelah dokumen dibuat." : undefined}>
              <PilihGud id="mi-source" value={sourceType} onChange={(v) => { setSourceType(v); setGalat((g) => ({ ...g, unit: undefined })); }} opsi={SUMBER_OPSI} disabled={ubah} data-testid="pilih-sumber" />
            </GudField>
            <GudField label="Prioritas" htmlFor="mi-priority"><PilihGud id="mi-priority" value={priority} onChange={setPriority} opsi={PRIORITAS_OPSI} data-testid="pilih-prioritas" /></GudField>
            <GudField label="Dibutuhkan tanggal" htmlFor="mi-date"><TanggalGud id="mi-date" value={requiredDate} onChange={setRequiredDate} data-testid="input-dibutuhkan" /></GudField>
          </div>
          <GudField label="Unit produksi" htmlFor="mi-unit" wajib={wajibUnit} galat={galat.unit} hint={wajibUnit ? "Wajib untuk Work Order Produksi: inilah yang menautkan bahan ke unit." : "Opsional untuk sumber ini."}>
            {unitId ? (
              <div className="gud-pilihan-terpilih" data-testid="unit-terpilih"><span>{unitLabel}</span><button type="button" onClick={() => { setUnitId(""); setUnitLabel(""); }} aria-label="Ganti unit produksi"><IkTutup size={14} /></button></div>
            ) : (
              <div className="gud-unit-cari">
                <input id="mi-unit" className="gud-f-teks" value={unitQuery} onChange={(e) => setUnitQuery(e.target.value)} placeholder="Cari kode unit, no. order, atau nama pelanggan…" autoComplete="off" aria-invalid={!!galat.unit || undefined} aria-controls="mi-unit-hasil" aria-expanded={unitResults.length > 0} role="combobox" data-testid="cari-unit" />
                {(unitSearching || unitResults.length > 0) && (
                  <ul id="mi-unit-hasil" role="listbox" className="gud-unit-hasil" data-testid="hasil-unit">
                    {unitSearching && <li className="gud-petunjuk" role="status">Mencari…</li>}
                    {!unitSearching && unitResults.map((u) => <li key={u.id} role="option" aria-selected="false"><button type="button" onClick={() => pilihUnit(u)} data-testid="pilih-unit"><strong>{u.unitCode}</strong><span className="gud-redup"> {u.order?.orderNumber} · {u.order?.customer?.name}</span></button></li>)}
                  </ul>
                )}
              </div>
            )}
          </GudField>
          <div className="gud-form-baris">
            <GudField label="Departemen / PIC" htmlFor="mi-dept"><input id="mi-dept" className="gud-f-teks" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="mis. Line A — Quilting" maxLength={120} data-testid="input-departemen" /></GudField>
            <GudField label="Referensi (opsional)" htmlFor="mi-ref"><input id="mi-ref" className="gud-f-teks" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="mis. nomor tiket internal" maxLength={160} data-testid="input-referensi" /></GudField>
          </div>
          <GudField label="Catatan" htmlFor="mi-notes"><textarea id="mi-notes" rows={2} className="gud-f-teks gud-f-area" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} data-testid="input-catatan" /></GudField>
        </fieldset>

        <fieldset className="gud-f-seksi gud-mi-bahan" data-testid="seksi-bahan">
          <legend className="gud-f-bagian-judul">2. Bahan yang diminta</legend>
          <div className="gud-katalog-grid">
            <div className="gud-katalog-dipilih" data-testid="daftar-diminta">
              <h4 className="gud-bahan-sub2">Diminta ({lines.length} bahan)</h4>
              {lines.length === 0 ? <p className="gud-petunjuk" data-testid="diminta-kosong">Belum ada bahan. Cari di katalog lalu pilih Tambah.</p> : (
                <ul className="gud-item-daftar">
                  {lines.map((l) => {
                    const info = tersediaTeks(peta.get(l.materialId)); const n = angkaOf(l.qty); const kurang = Number.isFinite(info.angka) && n > info.angka;
                    return (
                      <li key={l.materialId} className="gud-item" data-testid="baris-diminta" data-kode={l.kode}>
                        <div className="gud-item-nama"><strong>{l.kode}</strong><span className="gud-redup">{l.nama}</span><button type="button" className="gud-tombol-ikon gud-hapus-baris" onClick={() => hapusBaris(l.materialId)} aria-label={`Hapus ${l.kode} dari daftar`} data-testid="hapus-baris"><IkSampah size={16} /></button></div>
                        <GudField label={`Jumlah diminta (${satuan(l.satuan)})`} htmlFor={`mi-qty-${l.materialId}`} galat={galat[`qty-${l.materialId}`]} className="gud-item-lebar">
                          <AngkaGud id={`mi-qty-${l.materialId}`} value={l.qty} onChange={(v) => ubahQty(l.materialId, v)} satuan={satuan(l.satuan)} invalid={!!galat[`qty-${l.materialId}`]} placeholder="0" data-testid={`qty-${l.kode}`} inputRef={(el) => { lineRefs.current[l.materialId] = el; }} />
                        </GudField>
                        <p className="gud-petunjuk gud-item-lebar" data-nada={info.nada}>{info.teks}{kurang && <b className="gud-merah-teks" data-testid="peringatan-kurang"> — lebih dari yang tersedia; Draf tetap bisa disimpan, tetapi pengeluaran akan gagal bila saldo belum cukup.</b>}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {galat.baris && <p className="gud-f-galat" role="alert" data-testid="galat-baris">{galat.baris}</p>}
            </div>
            <div className="gud-katalog" data-testid="katalog-bahan">
              <h4 className="gud-bahan-sub2">Katalog bahan Gudang</h4>
              <div className="gud-cari"><IkCari size={16} aria-hidden /><input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari kode, nama, atau vendor…" aria-label="Cari bahan di katalog" data-testid="cari-katalog" /></div>
              {galatKatalog && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-katalog">{galatKatalog}</p>}
              {!katalog && !galatKatalog && <p className="gud-petunjuk" role="status">Memuat katalog…</p>}
              {katalog && (
                <>
                  <p className="gud-petunjuk" data-testid="jumlah-katalog">{hasilKatalog.length} bahan cocok{hasilKatalog.length > BATAS_KATALOG ? ` — menampilkan ${BATAS_KATALOG} pertama; persempit pencarian` : ""}. Angka tersedia = saldo dikurangi stok dicadangkan, perkiraan saat ini.</p>
                  <ul className="gud-katalog-daftar">
                    {hasilKatalog.slice(0, BATAS_KATALOG).map((r) => {
                      const info = tersediaTeks(r); const ada = sudah.has(r.materialId);
                      return (
                        <li key={r.materialId}>
                          <button type="button" onClick={() => tambahBahan(r)} className="gud-katalog-item max-sm:min-h-11" data-testid="katalog-item" data-kode={r.kode} data-ada={ada ? "ya" : undefined} aria-label={ada ? `${r.kode} sudah ditambahkan` : `Tambah ${r.kode}`}>
                            <span className="gud-katalog-nama"><strong>{r.nama}</strong><span className="gud-redup">{r.kode}</span></span>
                            <span className="gud-katalog-stok" data-nada={info.nada}>{info.teks}</span>
                            <span className="gud-katalog-aksi">{ada ? "Sudah ditambahkan" : <><IkTambah size={14} /> Tambah</>}</span>
                          </button>
                        </li>
                      );
                    })}
                    {hasilKatalog.length === 0 && <li className="gud-petunjuk">Tidak ada bahan yang cocok.</li>}
                  </ul>
                </>
              )}
              <p className="gud-petunjuk">Perlengkapan Stok (hanya Gudang) tidak bisa diminta untuk unit produksi — server akan menolaknya.</p>
            </div>
          </div>
        </fieldset>
        </div>

        {err && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-permintaan"><IkAwas size={16} aria-hidden /> {err}</p>}
      </form>
    </Modal>
  );
}
