import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BellRing, ClipboardList, Loader2,
  Package, Plus, RotateCcw, Scale, Settings2, Trash2,
} from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// GUDANG — Inventory v1 (Phase 3, PRD §8). Scope disepakati dengan Gilang
// 1 Agustus 2026: katalog material + ledger + goods receipt + issue manual
// + stock opname. Bagian dari portal "Bengkel" (PRD: "Workshop mencakup
// production + materials + QC dalam satu kata"), bukan portal terpisah —
// makanya navigasi ke sini lewat tab di dalam Bengkel, bukan kartu portal
// sendiri di halaman Portal.
//
// Saldo stok TIDAK PERNAH disimpan — selalu dihitung ulang dari ledger
// (GET /inventory/stock, SUM per material). Setiap aksi di sini adalah
// SATU baris ledger baru, tidak pernah mengubah baris lama (PRD §8.1).

function currentRoles() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.roles || [];
  } catch {
    return [];
  }
}

const UNIT_LABEL = { PCS: "pcs", METER: "meter", M3: "m³", SHEET: "lembar", SPOOL: "gulung", KG: "kg" };
const ALL_UNITS = Object.keys(UNIT_LABEL);

const MOVEMENT_TYPES = [
  { value: "receipt", label: "Terima", icon: ArrowDownToLine },
  { value: "issue", label: "Keluar ke Unit", icon: ArrowUpFromLine },
  { value: "return", label: "Retur", icon: RotateCcw },
  { value: "waste", label: "Buang", icon: Trash2 },
  { value: "adjustment", label: "Stock Opname", icon: Scale },
];
const MOVEMENT_LABEL = Object.fromEntries(MOVEMENT_TYPES.map((m) => [m.value.toUpperCase(), m.label]));
MOVEMENT_LABEL.RECEIPT = "Terima"; MOVEMENT_LABEL.ISSUE = "Keluar"; MOVEMENT_LABEL.RETURN = "Retur";
MOVEMENT_LABEL.WASTE = "Buang"; MOVEMENT_LABEL.ADJUSTMENT = "Opname";

function formatQty(qty, unit) {
  const n = Number(qty);
  const rounded = Math.abs(n % 1) < 0.0001 ? n.toFixed(0) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${rounded} ${UNIT_LABEL[unit] || unit}`;
}

// ── Modal Tambah Material ───────────────────────────────────────────────
function AddMaterialModal({ open, onClose, onAdded }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("PCS");
  const [serviceLine, setServiceLine] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) { setErr("Kode dan nama wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createMaterial({
        code: code.trim(), name: name.trim(), unit, serviceLine: serviceLine || undefined,
        reorderPoint: reorderPoint || undefined, reorderQty: reorderQty || undefined,
      });
      setCode(""); setName(""); setUnit("PCS"); setServiceLine(""); setReorderPoint(""); setReorderQty("");
      onAdded();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onClose} title="Tambah Material">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">Kode</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="FOAM-HR-D44-5CM"
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">Nama</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Busa HR D44 5cm"
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Satuan</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}
              className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent">
              {ALL_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Lini (opsional)</label>
            <select value={serviceLine} onChange={(e) => setServiceLine(e.target.value)}
              className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent">
              <option value="">Lintas lini</option>
              <option value="SERVICE">Service</option>
              <option value="UPGRADE">Upgrade</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Titik Reorder (opsional)</label>
            <input type="number" step="any" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)}
              placeholder="Alert mati kalau kosong"
              className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Jumlah Reorder (opsional)</label>
            <input type="number" step="any" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)}
              placeholder="Saran jumlah pesan"
              className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
          </div>
        </div>
        {err && <p className="text-[13px] text-red">{err}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal Atur Reorder ──────────────────────────────────────────────────
// TERPISAH dari AddMaterialModal — material yang SUDAH ada perlu jalur edit
// sendiri (PATCH), tidak lewat form tambah. Kirim `null` eksplisit saat
// dikosongkan supaya alert benar-benar MATI, bukan "tidak diubah" (lihat
// catatan di inventory.js PATCH /materials/:id).
function ReorderModal({ open, onClose, material, onSaved }) {
  const [reorderPoint, setReorderPoint] = useState("");
  const [reorderQty, setReorderQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (material) {
      setReorderPoint(material.reorderPoint ?? "");
      setReorderQty(material.reorderQty ?? "");
      setErr("");
    }
  }, [material]);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.updateMaterial(material.materialId, {
        reorderPoint: reorderPoint === "" ? null : Number(reorderPoint),
        reorderQty: reorderQty === "" ? null : Number(reorderQty),
      });
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (!material) return null;

  return (
    <Modal open={open} onOpenChange={onClose} title={`Atur Reorder — ${material.code}`}
      description={`Saldo sekarang: ${formatQty(material.balance, material.unit)}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">
            Titik Reorder ({UNIT_LABEL[material.unit]})
          </label>
          <input type="number" step="any" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)}
            placeholder="Kosongkan untuk matikan alert"
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">
            Jumlah Reorder Disarankan ({UNIT_LABEL[material.unit]})
          </label>
          <input type="number" step="any" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)}
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>
        {err && <p className="text-[13px] text-red">{err}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Modal Catat Pergerakan ───────────────────────────────────────────────
function MovementModal({ open, onClose, material, onSaved }) {
  const [type, setType] = useState("receipt");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function reset() {
    setType("receipt"); setQty(""); setUnitCost(""); setSupplier(""); setBatchNumber("");
    setUnitCode(""); setReason(""); setNote(""); setErr("");
  }
  function handleClose() { reset(); onClose(); }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    const qtyNum = Number(qty);
    if (!qtyNum || qtyNum <= 0) { setErr(type === "adjustment" ? "Hasil hitung fisik wajib diisi" : "Jumlah wajib diisi"); return; }
    if ((type === "waste" || type === "adjustment") && !reason.trim()) {
      setErr("Alasan wajib diisi"); return;
    }
    setBusy(true);
    try {
      if (type === "receipt") {
        await api.receiveStock({
          materialId: material.materialId, qty: qtyNum,
          unitCost: unitCost ? Number(unitCost) : undefined, supplier: supplier || undefined,
          batchNumber: batchNumber || undefined, note: note || undefined,
        });
      } else if (type === "issue") {
        if (!unitCode.trim()) { setErr("Kode unit wajib diisi"); setBusy(false); return; }
        const unit = await api.getUnitByCode(unitCode.trim().toUpperCase());
        await api.issueStock({ materialId: material.materialId, qty: qtyNum, unitId: unit.id, note: note || undefined });
      } else if (type === "return") {
        await api.returnStock({ materialId: material.materialId, qty: qtyNum, note: note || undefined });
      } else if (type === "waste") {
        await api.wasteStock({ materialId: material.materialId, qty: qtyNum, reason: reason.trim(), note: note || undefined });
      } else if (type === "adjustment") {
        await api.adjustStock({ materialId: material.materialId, actualQty: qtyNum, reason: reason.trim(), note: note || undefined });
      }
      reset();
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (!material) return null;

  return (
    <Modal open={open} onOpenChange={handleClose} title={`Catat Pergerakan — ${material.code}`}
      description={`Saldo sekarang: ${formatQty(material.balance, material.unit)}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-5 gap-1">
          {MOVEMENT_TYPES.map((m) => (
            <button key={m.value} type="button" onClick={() => { setType(m.value); setErr(""); }}
              className={`flex flex-col items-center gap-1 rounded-btn border-2 px-1 py-2 text-[11px] font-medium ${
                type === m.value ? "border-accent bg-accentbg text-accent" : "border-border text-ink2"
              }`}>
              <m.icon className="h-4 w-4" /> {m.label}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">
            {type === "adjustment" ? "Hasil hitung fisik" : "Jumlah"} ({UNIT_LABEL[material.unit]})
          </label>
          <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>

        {type === "receipt" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink2">Harga/satuan (Rp, opsional)</label>
              <input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
                className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink2">Supplier (opsional)</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
                className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[13px] font-medium text-ink2">No. Batch (opsional)</label>
              <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)}
                className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
            </div>
          </div>
        )}

        {type === "issue" && (
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Kode Unit</label>
            <input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="RES-07072026-001-U2"
              className="h-10 w-full rounded-btn border border-border px-3 text-sm font-mono outline-none focus:border-accent" />
          </div>
        )}

        {(type === "waste" || type === "adjustment") && (
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink2">Alasan (wajib)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={type === "waste" ? "mis. Sobek saat potong" : "mis. Stock opname bulanan"}
              className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
          </div>
        )}

        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink2">Catatan (opsional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="h-10 w-full rounded-btn border border-border px-3 text-sm outline-none focus:border-accent" />
        </div>

        {err && <p className="text-[13px] text-red">{err}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={handleClose}>Batal</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Gudang() {
  const navigate = useNavigate();
  const [stock, setStock] = useState(null);
  const [movements, setMovements] = useState(null);
  const [error, setError] = useState("");
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [movementFor, setMovementFor] = useState(null);
  const [reorderFor, setReorderFor] = useState(null);

  const roles = currentRoles();
  const allowed = roles.some((r) => ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"].includes(r));
  const canWrite = roles.includes("WAREHOUSE");

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.getStock(), api.getStockMovements({ limit: "20" })]);
      setStock(s);
      setMovements(m);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-orange" />
          <h2 className="text-lg font-semibold text-ink">Tidak Punya Akses</h2>
          <p className="mt-1 text-sm text-ink2">Halaman ini khusus tim produksi & gudang.</p>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <EmptyState icon={AlertTriangle} title="Gagal memuat Gudang" description={error} />
      </PageContainer>
    );
  }

  if (!stock) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat gudang…</span>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Gudang"
        subtitle="Katalog material & pergerakan stok."
        actions={canWrite && (
          <Button onClick={() => setShowAddMaterial(true)} className="h-10">
            <Plus className="h-4 w-4" /> Tambah Material
          </Button>
        )}
      >
        <div className="mt-2 flex gap-2">
          <button onClick={() => navigate("/bengkel")}
            className="rounded-chip px-3 py-1 text-[13px] font-medium text-ink2 hover:bg-hovertint">
            Papan Produksi
          </button>
          <button className="rounded-chip bg-accentbg px-3 py-1 text-[13px] font-medium text-accent">
            Gudang
          </button>
        </div>
      </PageHeader>

      <PageBody>
        {(() => {
          const needsReorder = stock.filter((m) => m.reorderPoint != null && m.balance <= m.reorderPoint);
          if (needsReorder.length === 0) return null;
          return (
            <Card className="border-2 border-orange/30 bg-orangebg">
              <CardHeader><CardTitle className="flex items-center gap-1.5"><BellRing className="h-4 w-4 text-orange" /> Perlu Reorder</CardTitle></CardHeader>
              <div className="flex flex-col gap-2">
                {needsReorder.map((m) => (
                  <div key={m.materialId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-btn bg-surface px-4 py-3">
                    <div className="min-w-[160px] flex-1">
                      <div className="text-[13px] font-semibold text-ink">{m.code}</div>
                      <div className="text-[12px] text-ink2">
                        Saldo {formatQty(m.balance, m.unit)} · titik reorder {formatQty(m.reorderPoint, m.unit)}
                      </div>
                    </div>
                    <Badge variant="orange">
                      {m.reorderQty != null ? `Pesan ${formatQty(m.reorderQty, m.unit)}` : "Belum ada saran jumlah"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          );
        })()}

        <Card>
          <CardHeader><CardTitle>Saldo Material</CardTitle></CardHeader>
          {stock.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Belum ada material"
              description={canWrite
                ? "Tambahkan material lewat tombol di atas untuk mulai mencatat stok."
                : "Hanya tim Gudang yang bisa menambah material. Hubungi mereka untuk mulai mencatat stok."}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {stock.map((m) => (
                <div key={m.materialId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-btn bg-inset px-4 py-3">
                  <div className="min-w-[160px] flex-1">
                    <div className="text-[13px] font-semibold text-ink">{m.code}</div>
                    <div className="text-[12px] text-ink2">{m.name}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-[15px] font-bold text-ink">{formatQty(m.balance, m.unit)}</span>
                    {m.reorderPoint != null && m.balance <= m.reorderPoint && <Badge variant="orange">Reorder</Badge>}
                    {!m.active && <Badge variant="neutral">Nonaktif</Badge>}
                    {canWrite && (
                      <>
                        <Button variant="neutral" className="h-8 px-2 text-xs" title="Atur titik reorder" onClick={() => setReorderFor(m)}>
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="neutral" className="h-8 px-3 text-xs" onClick={() => setMovementFor(m)}>
                          Catat
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Riwayat Terbaru</CardTitle></CardHeader>
          {!movements || movements.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Belum ada pergerakan stok" description="Riwayat terima/keluar/opname akan tampil di sini." />
          ) : (
            <div className="flex flex-col gap-2">
              {movements.map((mv) => {
                const qtyNum = Number(mv.qty);
                return (
                  <div key={mv.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-btn bg-inset px-4 py-3">
                    <div className="min-w-[160px] flex-1">
                      <div className="text-[13px] font-semibold text-ink">
                        {mv.material.code}
                        {mv.unit && <span className="ml-2 font-mono text-[11px] text-ink2">{mv.unit.unitCode}</span>}
                      </div>
                      <div className="text-[12px] text-ink2">
                        {mv.reason || mv.note || "—"} · {mv.createdBy?.name || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="neutral">{MOVEMENT_LABEL[mv.type] || mv.type}</Badge>
                      <span className={`text-[13px] font-bold ${qtyNum < 0 ? "text-red" : "text-green"}`}>
                        {qtyNum > 0 ? "+" : ""}{formatQty(mv.qty, mv.material.unit)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </PageBody>

      <AddMaterialModal open={showAddMaterial} onClose={() => setShowAddMaterial(false)} onAdded={() => { setShowAddMaterial(false); load(); }} />
      <MovementModal open={!!movementFor} material={movementFor} onClose={() => setMovementFor(null)} onSaved={() => { setMovementFor(null); load(); }} />
      <ReorderModal open={!!reorderFor} material={reorderFor} onClose={() => setReorderFor(null)} onSaved={() => { setReorderFor(null); load(); }} />
    </PageContainer>
  );
}
