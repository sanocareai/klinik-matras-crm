import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { IkTambah, IkTutup } from "@/components/gudangIcons.jsx";
import { AngkaGud, GudField, PilihGud, TanggalGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { RECEIPT_SOURCE_REAL } from "../inventoryReal.js";
import { teksJumlah } from "@/features/finance/purchaseOrderLogic.js";

// Buat Penerimaan Barang baru — status awal selalu DRAFT (POST /inventory/goods-receipts).
//
// Dua jalur:
//   • DARI PO (Purchase Order bahan baku yang sudah disetujui Finance): supplier, referensi, dan baris item terisi dari PO — Gudang tidak
//     mengetik ulang. Gudang tetap mencatat surat jalan, jumlah datang, baik, dan ditolak di tahapan penerimaan seperti biasa. Jumlah
//     dijadwalkan per baris tidak boleh melebihi sisa PO. Harga PO tidak ditampilkan di sini.
//   • TANPA PO (jalur lama, untuk kiriman yang memang tidak punya PO): isian bebas seperti sebelumnya, ditandai jelas sebagai "Tanpa PO".
const BARIS_KOSONG = { materialId: "", orderedQty: "" };
const MODE = { PO: "po", MANUAL: "manual" };

export default function GoodsReceiptFormModal({ open, onClose, onCreated }) {
  const [mode, setMode] = useState(MODE.PO);
  const [pos, setPos] = useState(null); // null = memuat
  const [poId, setPoId] = useState("");
  const [pilihan, setPilihan] = useState({}); // purchaseOrderLineId -> { dipilih, qty }
  const [materials, setMaterials] = useState([]);
  const [sourceType, setSourceType] = useState("SUPPLIER_DELIVERY");
  const [sourceReference, setSourceReference] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const kunci = useRef(false);

  useEffect(() => {
    if (!open) return;
    setMode(MODE.PO); setPoId(""); setPilihan({}); setPos(null);
    setSourceType("SUPPLIER_DELIVERY"); setSourceReference(""); setSupplier("");
    setExpectedDate(""); setNotes(""); setLines([{ ...BARIS_KOSONG }]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
    api.getGudangPurchaseOrders()
      .then((r) => { setPos(r.purchaseOrders || []); if ((r.purchaseOrders || []).length === 0) setMode(MODE.MANUAL); })
      .catch(() => { setPos([]); setMode(MODE.MANUAL); });
  }, [open]);

  const po = useMemo(() => (pos || []).find((p) => p.id === poId) || null, [pos, poId]);

  function pilihPO(id) {
    setPoId(id);
    const p = (pos || []).find((x) => x.id === id);
    const awal = {};
    for (const l of p?.lines || []) awal[l.id] = { dipilih: l.progres.belumDatang > 0, qty: String(l.progres.belumDatang) };
    setPilihan(awal);
    setExpectedDate(p?.expectedDate ? String(p.expectedDate).slice(0, 10) : "");
  }
  const setPil = (id, patch) => setPilihan((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  function setLine(i, patch) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  const tambahBaris = () => setLines((ls) => [...ls, { ...BARIS_KOSONG }]);
  const hapusBaris = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // Galat isian jalur PO: jumlah dijadwalkan harus > 0 dan tidak melebihi sisa PO.
  const galatPO = useMemo(() => {
    if (!po) return "Pilih Purchase Order";
    const dipilih = po.lines.filter((l) => pilihan[l.id]?.dipilih);
    if (dipilih.length === 0) return "Pilih minimal satu item";
    for (const l of dipilih) {
      const q = Number(pilihan[l.id].qty);
      if (!(q > 0)) return `${l.kode}: jumlah dijadwalkan harus lebih dari 0`;
      if (q > l.progres.belumDatang + 1e-9) return `${l.kode}: melebihi yang belum datang (${teksJumlah(l.progres.belumDatang)} ${l.satuan})`;
    }
    return null;
  }, [po, pilihan]);

  async function simpan(e) {
    e.preventDefault();
    setErr("");
    let body;
    if (mode === MODE.PO) {
      if (galatPO) return; // galat tampil di kolomnya (lihat `coba`)
      body = {
        purchaseOrderId: po.id, expectedDate: expectedDate || undefined, notes: notes || undefined,
        lines: po.lines.filter((l) => pilihan[l.id]?.dipilih).map((l) => ({ purchaseOrderLineId: l.id, orderedQty: Number(pilihan[l.id].qty) })),
      };
    } else {
      const valid = lines.filter((l) => l.materialId);
      if (valid.length === 0) { setErr("Minimal satu item wajib dipilih"); return; }
      body = {
        sourceType, sourceReference: sourceReference || undefined, supplier: supplier || undefined,
        expectedDate: expectedDate || undefined, notes: notes || undefined,
        lines: valid.map((l) => ({ materialId: l.materialId, orderedQty: l.orderedQty || undefined })),
      };
    }
    if (kunci.current) return; kunci.current = true; // klik ganda: satu permintaan saja
    setBusy(true);
    try {
      const dibuat = await api.createGoodsReceipt(body);
      onCreated(dibuat?.receipt ?? dibuat);
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      kunci.current = false; setBusy(false);
    }
  }

  const adaPO = (pos || []).length > 0;
  const [coba, setCoba] = useState(false); // sudah menekan simpan sekali → galat kolom wajib ditampilkan
  useEffect(() => { if (open) setCoba(false); }, [open]);
  const galatQty = (l) => {
    const p = pilihan[l.id]; if (!p?.dipilih) return "";
    const q = Number(p.qty);
    if (p.qty === "" || !(q > 0)) return "Jumlah harus lebih dari 0";
    if (q > l.progres.belumDatang + 1e-9) return `Melebihi yang belum datang (${teksJumlah(l.progres.belumDatang)} ${l.satuan})`;
    return "";
  };
  const opsiPO = useMemo(() => (pos || []).map((p) => ({ nilai: p.id, label: `${p.poNumber} — ${p.supplier.name}${p.status === "DITERIMA_SEBAGIAN" ? " (diterima sebagian)" : ""}` })), [pos]);
  const opsiSumber = useMemo(() => Object.entries(RECEIPT_SOURCE_REAL).map(([k, x]) => ({ nilai: k, label: x.labelId || x.label })), []);
  const opsiBahan = useMemo(() => materials.map((m) => ({ nilai: m.id, label: `${m.code} — ${m.name}` })), [materials]);
  const submit = (e) => { setCoba(true); simpan(e); };

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Penerimaan baru" description="Buat draf penerimaan. Stok baru bertambah setelah barang diperiksa dan disimpan ke stok." className="w-[640px] gud-modal">
      <form onSubmit={submit} className="gud-form" noValidate data-testid="form-penerimaan-baru">
        <div role="radiogroup" aria-label="Sumber penerimaan" className="gud-segmen">
          <button type="button" role="radio" aria-checked={mode === MODE.PO} disabled={!adaPO} onClick={() => setMode(MODE.PO)} data-testid="mode-po">Dari Purchase Order</button>
          <button type="button" role="radio" aria-checked={mode === MODE.MANUAL} onClick={() => setMode(MODE.MANUAL)} data-testid="mode-manual">Tanpa PO</button>
        </div>

        {mode === MODE.PO ? (
          <>
            {pos === null ? (
              <p className="gud-info" role="status"><Loader2 size={14} className="inline animate-spin" /> Memuat Purchase Order…</p>
            ) : (
              <GudField label="Purchase Order" htmlFor="gr-po" wajib hint="Hanya PO yang sudah disetujui Finance dan belum selesai diterima." galat={coba && !po ? "Pilih Purchase Order" : ""}>
                <PilihGud id="gr-po" value={poId} onChange={pilihPO} opsi={opsiPO} placeholder="Pilih PO yang disetujui…" invalid={coba && !po} data-testid="pilih-po" />
              </GudField>
            )}

            {po && (
              <>
                <dl className="gud-ringkas-po">
                  <div><dt>Supplier</dt><dd>{po.supplier.name}</dd></div>
                  <div><dt>Referensi</dt><dd>{po.poNumber}</dd></div>
                </dl>
                <fieldset className="gud-form gud-set">
                  <legend className="gud-form-seksi">Item yang dijadwalkan datang <span className="gud-f-wajib" aria-hidden="true">*</span></legend>
                  {po.lines.map((l) => {
                    const p = pilihan[l.id] || { dipilih: false, qty: "" };
                    const penuh = l.progres.belumDatang <= 0;
                    const galat = galatQty(l);
                    return (
                      <div key={l.id} className="gud-kartu-isian" data-aktif={p.dipilih && !penuh ? "ya" : "tidak"} data-testid="baris-po-gudang">
                        <label className="gud-pilih-baris" data-nonaktif={penuh ? "ya" : undefined}>
                          <input type="checkbox" checked={!!p.dipilih && !penuh} disabled={penuh} onChange={(e) => setPil(l.id, { dipilih: e.target.checked })} aria-label={`Jadwalkan ${l.kode}`} />
                          <span className="gud-item-badan">
                            <span className="gud-item-nama">{l.nama} <span className="gud-item-kode">{l.kode}</span></span>
                            <span className="gud-item-kalimat">Dipesan {teksJumlah(l.dipesan)} {l.satuan} · masuk stok {teksJumlah(l.progres.masukStok)} · <strong>belum datang {teksJumlah(l.progres.belumDatang)}</strong>{penuh ? " — sudah terpenuhi" : ""}</span>
                          </span>
                        </label>
                        {p.dipilih && !penuh && (
                          <GudField label="Jumlah dijadwalkan" htmlFor={`gr-qty-${l.id}`} galat={galat}>
                            <AngkaGud id={`gr-qty-${l.id}`} value={p.qty} onChange={(v) => setPil(l.id, { qty: v })} satuan={l.satuan} invalid={!!galat} aria-label={`Jumlah dijadwalkan ${l.kode}`} />
                          </GudField>
                        )}
                      </div>
                    );
                  })}
                  {coba && galatPO && po && !po.lines.some((l) => pilihan[l.id]?.dipilih) && <p className="gud-f-galat" role="alert">{galatPO}</p>}
                </fieldset>
              </>
            )}
          </>
        ) : (
          <>
            <p className="gud-info" data-nada="awas" data-testid="peringatan-tanpa-po">
              Penerimaan ini <strong>tanpa PO</strong>: tidak ada pencocokan jumlah dan harga terhadap pesanan. Gunakan hanya untuk kiriman yang memang tidak punya PO.
            </p>
            <div className="gud-form-baris">
              <GudField label="Jenis sumber" htmlFor="gr-source" wajib>
                <PilihGud id="gr-source" value={sourceType} onChange={setSourceType} opsi={opsiSumber} data-testid="pilih-sumber" />
              </GudField>
              <GudField label="Referensi" htmlFor="gr-ref">
                <input id="gr-ref" className="gud-f-teks" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="No. PO lama / referensi internal" />
              </GudField>
            </div>
            <GudField label="Supplier / pengirim" htmlFor="gr-supplier">
              <input id="gr-supplier" className="gud-f-teks" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nama supplier atau pengirim" />
            </GudField>
            <fieldset className="gud-form gud-set">
              <legend className="gud-form-seksi">Baris item <span className="gud-f-wajib" aria-hidden="true">*</span></legend>
              {lines.map((l, i) => (
                <div key={i} className="gud-baris-bahan">
                  <div className="gud-baris-bahan-pilih">
                    <PilihGud value={l.materialId} onChange={(v) => setLine(i, { materialId: v })} opsi={opsiBahan} placeholder="Pilih item…" aria-label={`Item baris ${i + 1}`} invalid={coba && i === 0 && !lines.some((x) => x.materialId)} data-testid={`pilih-bahan-${i}`} kosongLabel="Belum ada item aktif di katalog" />
                  </div>
                  <div className="gud-baris-bahan-qty"><AngkaGud value={l.orderedQty} onChange={(v) => setLine(i, { orderedQty: v })} placeholder="Jumlah" aria-label={`Jumlah baris ${i + 1}`} /></div>
                  <button type="button" onClick={() => hapusBaris(i)} disabled={lines.length === 1} className="gud-tombol-ikon" aria-label={`Hapus baris ${i + 1}`}><IkTutup size={16} /></button>
                </div>
              ))}
              {coba && !lines.some((x) => x.materialId) && <p className="gud-f-galat" role="alert">Minimal satu item wajib dipilih</p>}
              <button type="button" onClick={tambahBaris} className="gud-tombol gud-tombol-kecil"><IkTambah size={15} /> Tambah baris</button>
              {materials.length === 0 && <p className="gud-f-hint">Belum ada item aktif di katalog — tambahkan lewat Stok bahan dulu.</p>}
            </fieldset>
          </>
        )}

        <div className="gud-form-baris">
          <GudField label="Perkiraan tiba" htmlFor="gr-date"><TanggalGud id="gr-date" value={expectedDate} onChange={setExpectedDate} placeholder="Pilih tanggal" data-testid="tanggal-perkiraan" /></GudField>
          <GudField label="Catatan" htmlFor="gr-notes"><input id="gr-notes" className="gud-f-teks" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional" /></GudField>
        </div>

        {err && <p role="alert" data-testid="galat-penerimaan" className="gud-info" data-nada="galat">{err}</p>}

        <div className="gud-form-aksi">
          <button type="button" className="gud-tombol" onClick={onClose}>Batal</button>
          <button type="submit" className="gud-tombol gud-tombol-utama" disabled={busy} data-testid="buat-draf">
            {busy && <Loader2 size={14} className="animate-spin" />} Buat draf penerimaan
          </button>
        </div>
      </form>
    </Modal>
  );
}
