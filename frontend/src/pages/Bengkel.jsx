import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Camera, CheckCircle2, ClipboardList, Loader2, Plus, X,
} from "lucide-react";
import { api } from "../api.js";
import { compressImage } from "../utils/compressImage.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

// PAPAN PRODUKSI HARIAN (D-014) — layar utama kepala produksi / QC Leader.
//
// Menggantikan model kiosk scan yang dibatalkan: SATU orang meng-update
// seluruh proses secara terkumpul, bukan tiap pekerja scan di stasiunnya.
//
// Alur harian yang ditiru:
//   pagi → pilih unit yang dikerjakan hari ini (Target Hari Ini)
//   sore → tandai tahap yang selesai + foto, lalu laporkan ringkasannya
//
// SATU TAP untuk maju satu tahap. TIDAK ada dropdown 12 tahap — itu yang
// bikin sistem ditinggalkan minggu kedua. Tahap berikutnya SELALU dihitung
// server (D-003), halaman ini tidak pernah menebak urutan sendiri.

function todayWibISO() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function currentRoles() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.roles || [];
  } catch {
    return [];
  }
}

// ── Kartu unit di Target Hari Ini ────────────────────────────────────────
function TargetCard({ target, onChanged }) {
  const { unit, moved } = target;
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState("");

  // unit.currentStage (relasi Prisma mentah) NULL untuk unit yang belum
  // pernah di-start. unit.nextStage adalah tahap TERHITUNG dari server
  // (resolveNextStageForUnits) — sudah benar sejak unit pertama kali masuk
  // target, bukan baru aktif setelah ada yang men-start-nya duluan dulu.
  const stage = unit.nextStage;
  const needsPhoto = !!stage?.requiresPhoto;
  const isQcGate = !!stage?.requiresQc;

  async function handlePhotos(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      const fd = new FormData();
      compressed.forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadUnitPhotos(unit.id, fd);
      setPhotos((p) => [...p, ...urls]);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleDone() {
    setBusy(true);
    setErr("");
    try {
      await api.recordStageDone(unit.id, { photoUrls: photos, note });
      setPhotos([]);
      setNote("");
      setExpanded(false);
      onChanged();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink2">{unit.unitCode}</span>
            {moved && <Badge variant="green">Sudah diupdate</Badge>}
          </div>
          <h3 className="mt-1 truncate text-base font-semibold text-ink">
            {stage?.labelId || "Belum masuk produksi"}
          </h3>
          <p className="truncate text-xs text-ink2">
            {unit.order?.customer?.name || "—"} · {unit.merk || "—"} {unit.ukuran || ""}
          </p>
        </div>
      </div>

      {err && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-redbg px-3 py-2 text-xs text-red">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
        </div>
      )}

      {/* Gerbang QC punya bentuk data sendiri (verdict + berat badan +
          override customer) — TIDAK bisa lewat tombol "Selesai" biasa.
          Dialihkan ke layar QC terpisah, belum dibangun di increment ini. */}
      {isQcGate ? (
        <div className="mt-3 rounded-lg bg-orangebg px-3 py-2 text-xs text-ink">
          Tahap ini gerbang <b>Uji Berat Badan</b> — dicatat lewat layar QC (verdict, berat
          badan acuan, override customer), belum tersedia di papan ini.
        </div>
      ) : !expanded ? (
        <Button className="mt-3 h-11 w-full" onClick={() => setExpanded(true)} disabled={!stage}>
          Tandai Selesai
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed
                            border-border text-xs font-medium text-ink2 hover:border-accent hover:text-accent">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {photos.length > 0 ? `${photos.length} foto siap` : "Ambil / Pilih Foto"}
            <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handlePhotos} disabled={busy} />
          </label>

          {photos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {photos.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded object-cover" />)}
            </div>
          )}

          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)"
            className="h-14 w-full rounded-lg border border-border p-2 text-xs outline-none focus:border-accent"
          />

          <div className="flex gap-2">
            <Button variant="neutral" className="h-10 flex-1 text-xs" onClick={() => setExpanded(false)}>Batal</Button>
            <Button
              className="h-10 flex-1 text-xs"
              disabled={busy || (needsPhoto && photos.length === 0)}
              onClick={handleDone}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </div>
          {needsPhoto && photos.length === 0 && (
            <p className="text-center text-[11px] text-ink2">Tahap ini wajib foto</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Pemilih unit untuk ditambahkan ke target ─────────────────────────────
function AddTargetPanel({ available, date, onAdded, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  // Dikelompokkan per ORDER — kepala produksi berpikir dalam "ID order dari
  // sales", bukan daftar unit lepas (D-014). Order hotel 15 kasur tetap bisa
  // dipilih sebagian, karena datanya per unit.
  const byOrder = available.reduce((acc, u) => {
    const key = u.order?.orderNumber || u.order?.id || "—";
    (acc[key] = acc[key] || []).push(u);
    return acc;
  }, {});

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleOrder(units) {
    const ids = units.map((u) => u.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function save() {
    setBusy(true);
    try {
      await api.setProductionTargets([...selected], { date });
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Pilih Unit untuk Target Hari Ini</h3>
        <button onClick={onClose} className="text-ink2 hover:text-ink"><X className="h-4 w-4" /></button>
      </div>

      {available.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink2">Tidak ada unit lain di bengkel.</p>
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {Object.entries(byOrder).map(([orderNo, units]) => (
            <div key={orderNo}>
              <button
                onClick={() => toggleOrder(units)}
                className="mb-1 font-mono text-xs font-semibold text-accent hover:underline"
              >
                {orderNo} · {units.length} unit
              </button>
              <div className="space-y-1">
                {units.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-hovertint">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                    <span className="flex-1 truncate text-xs text-ink">
                      {u.unitCode} — {u.nextStage?.labelId || "belum mulai"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="mt-3 h-11 w-full" disabled={busy || selected.size === 0} onClick={save}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Tambahkan ${selected.size} unit ke target`}
      </Button>
    </Card>
  );
}

// ── Halaman ───────────────────────────────────────────────────────────────
export default function Bengkel() {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const date = todayWibISO();

  const roles = currentRoles();
  const allowed = roles.some((r) =>
    ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"].includes(r));

  const load = useCallback(async () => {
    try {
      setBoard(await api.getProductionBoard(date));
    } catch (e) {
      setError(e.message);
    }
  }, [date]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (!allowed) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-orange" />
          <h2 className="text-lg font-semibold text-ink">Tidak Punya Akses</h2>
          <p className="mt-1 text-sm text-ink2">Halaman ini khusus tim produksi.</p>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red" />
          <p className="text-sm text-ink2">{error}</p>
        </div>
      </PageContainer>
    );
  }

  if (!board) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat papan…</span>
        </div>
      </PageContainer>
    );
  }

  const { targets, available, summary } = board;

  return (
    <PageContainer>
      <PageHeader
        title="Papan Produksi Harian"
        subtitle={`${board.date} — ${summary.moved} dari ${summary.total} target sudah diupdate`}
        actions={
          <Button onClick={() => setAdding((v) => !v)} className="h-10">
            <Plus className="h-4 w-4" /> Tambah Target
          </Button>
        }
      />

      {adding && (
        <AddTargetPanel
          available={available}
          date={date}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load(); }}
        />
      )}

      {targets.length === 0 ? (
        <Card className="p-8 text-center">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 text-ink2" strokeWidth={1.5} />
          <h3 className="text-base font-semibold text-ink">Belum ada target hari ini</h3>
          <p className="mt-1 text-sm text-ink2">
            Pilih unit yang dikerjakan hari ini lewat tombol “Tambah Target”.
          </p>
        </Card>
      ) : (
        <>
          {summary.moved === summary.total && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-greenbg px-4 py-3 text-sm text-green">
              <CheckCircle2 className="h-4 w-4" />
              Semua target hari ini sudah diupdate — siap dilaporkan ke grup.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {targets.map((t) => <TargetCard key={t.id} target={t} onChanged={load} />)}
          </div>
        </>
      )}

      {available.length > 0 && (
        <p className="mt-6 text-center text-xs text-ink2">
          {available.length} unit lain ada di bengkel tapi belum masuk target hari ini.
        </p>
      )}
    </PageContainer>
  );
}
