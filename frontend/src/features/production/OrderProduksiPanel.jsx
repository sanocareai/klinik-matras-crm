import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal } from "@/utils/formatDate.js";
import MaterialPlanEditor from "@/features/production/MaterialPlanEditor.jsx";
import { statusOf } from "@/features/production/productionLabels.js";
import { formatJumlah, kunciIdempoten, nadaBadge, parseJumlah, pesanGalatAdopsi, sumberKerjaText, waktuWib } from "@/features/production/orderProduksiModel.js";

// Panel fokus Order Produksi (adopsi Admin) — urutan: ringkasan + SATU tindakan utama → status & target → rencana bahan → pemakaian aktual → riwayat → lanjutan (Unit 360).
// Tiga status tampil terpisah dan berlabel (Status order · Posisi unit · Status kerja) — label teks, bukan hanya warna. Tahap/dokumentasi/biaya/QC tetap lengkap di Unit 360 (bagian "Lanjutan").
// Catatan manual TIDAK membuat tahap, QC, foto, penerimaan Gudang, atau pemakaian bahan; stok hanya berubah lewat "Pemakaian aktual".

const PANEL_PROPS = { "data-testid": "order-produksi-panel" };
const STATUS_ORDER_OPSI = Object.freeze([{ key: "PROCESSING", label: "Diproses" }, { key: "READY", label: "Siap Kirim" }]);
const aktifUnit = (s) => !["CANCELLED", "DELIVERED"].includes(s);

function Status3({ ad, unitStatus }) {
  const order = statusOf({ status: unitStatus, unitStatusDisplay: ad.statusOrder }); // nada status order = peta yang sama dengan daftar/Sales
  const baris = [
    { cap: "Status order", sub: "Dilihat Sales & Delivery", chip: order, key: "order" },
    { cap: "Posisi unit", sub: ad.posisi?.detail || "Dari dokumen jemput/terima/kirim", chip: ad.posisi, key: "posisi" },
    { cap: "Status kerja", sub: sumberKerjaText(ad.kerja) || "Pekerjaan di Produksi", chip: ad.kerja, key: "kerja" },
  ];
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3" data-testid="tiga-status">
      {baris.map((b) => (
        <div key={b.key} className="min-w-0" data-testid={`status-${b.key}`}>
          <dt className="m-0 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink3">{b.cap}</dt>
          <dd className="m-0 mt-1">
            <Badge variant={nadaBadge(b.chip?.tone)} className="max-w-full whitespace-normal normal-case tracking-normal text-[12.5px]">{b.chip?.label || "—"}</Badge>
            <span className="mt-1 block text-[12px] leading-snug text-ink3">{b.sub}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Kosong({ children }) { return <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2">{children}</p>; }
function Bagian({ id, judul, children, aksi }) {
  return (
    <section aria-labelledby={id} className="border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h3 id={id} className="m-0 text-[15px] font-semibold text-ink">{judul}</h3>{aksi}</div>
      {children}
    </section>
  );
}

export default function OrderProduksiPanel({ unitId, onClose, onChanged, onBukaUnit360 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const reqRef = useRef(0);

  const muat = useCallback(async () => {
    if (!unitId) return;
    const id = ++reqRef.current; setMemuat(true); setError(null);
    try { const d = await api.getUnitAdopsi(unitId); if (id === reqRef.current) setData(d); } catch (e) { if (id === reqRef.current) setError(e); } finally { if (id === reqRef.current) setMemuat(false); }
  }, [unitId]);
  useEffect(() => { setData(null); if (unitId) muat(); }, [unitId, muat]);

  const izin = data?.izin || {};
  const u = data?.unit; const ad = data?.adopsi;
  const aktif = !!u && aktifUnit(u.status);
  const judul = u ? `${u.unitCode}${u.order?.orderNumber ? ` · ${u.order.orderNumber}` : ""}` : "Memuat unit…";
  const deskripsi = u ? [u.order?.customer?.name, (u.layanan || []).join(", ")].filter(Boolean).join(" · ") : undefined;
  const sesudahUbah = useCallback(async () => { await muat(); onChanged?.(); }, [muat, onChanged]);

  return (
    <Modal open={!!unitId} onOpenChange={(v) => !v && onClose()} contentProps={PANEL_PROPS} title={judul} description={deskripsi}
      className="flex w-[920px] max-w-[96vw] flex-col max-sm:!left-0 max-sm:!top-0 max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none">
      <div className="space-y-6 px-1 pb-2" aria-busy={memuat}>
        {error && (
          <div role="alert" data-testid="panel-galat" className="rounded-btn bg-redbg px-3 py-3 text-[13px] text-red">
            <p className="m-0 font-medium">{error.status === 404 ? "Unit tidak ditemukan atau sudah dihapus." : error.message || "Panel gagal dimuat."}</p>
            <Button variant="secondary" size="sm" className="mt-2 min-h-[40px]" onClick={muat}>Coba lagi</Button>
          </div>
        )}
        {!data && !error && <div className="space-y-3" data-testid="panel-memuat" aria-label="Memuat unit"><div className="h-6 w-1/2 animate-pulse rounded bg-inset motion-reduce:animate-none" /><div className="h-24 animate-pulse rounded bg-inset motion-reduce:animate-none" /><div className="h-40 animate-pulse rounded bg-inset motion-reduce:animate-none" /></div>}

        {data && (
          <>
            {/* 1 · Ringkasan + satu tindakan utama */}
            <div className="space-y-4" data-testid="panel-ringkasan">
              <Status3 ad={ad} unitStatus={u.status} />
              <TindakanUtama data={data} aktif={aktif} onDone={sesudahUbah} onBukaUnit360={() => onBukaUnit360?.(unitId)} />
            </div>

            {/* 2 · Status & target */}
            <Bagian id="sec-status" judul="Status & target">
              <StatusTarget data={data} aktif={aktif} onDone={sesudahUbah} />
            </Bagian>

            {/* 3 · Rencana bahan */}
            <div className="border-t border-line pt-5" id="sec-rencana-wrap">
              <MaterialPlanEditor unitId={unitId} rencana={data.rencanaBahan} bolehUbah={!!izin.rencanaBahan} unitAktif={aktif} onSaved={() => sesudahUbah()} onReload={muat} />
            </div>

            {/* 4 · Pemakaian aktual — transaksi resmi, mengurangi stok */}
            <Bagian id="sec-aktual" judul="Pemakaian aktual" aksi={<Badge variant="orange" title="Setiap catatan di sini mengurangi stok Gudang tepat sekali.">Aktual · mengurangi stok</Badge>}>
              <PemakaianAktual data={data} aktif={aktif} bolehCatat={!!izin.pemakaianAktual} onDone={sesudahUbah} />
            </Bagian>

            {/* 5 · Riwayat */}
            <Bagian id="sec-riwayat" judul="Riwayat">
              <Riwayat daftar={data.riwayat} />
            </Bagian>

            {/* 6 · Lanjutan */}
            <details className="group border-t border-line pt-4" data-testid="panel-lanjutan">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[14px] font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <ChevronRight size={16} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden /> Lanjutan: tahap, dokumentasi, biaya &amp; QC
              </summary>
              <div className="mt-2 space-y-2 pl-6 text-[13px] text-ink2">
                <p className="m-0">Tahap pengerjaan, foto &amp; dokumentasi, biaya bahan, QC, dan data lama unit ini tetap lengkap di Unit 360.</p>
                {u.order?.unitLain?.length > 0 && <p className="m-0 text-ink3">Order ini punya {u.order.jumlahUnit} unit: {u.order.unitLain.map((x) => x.unitCode).join(", ")} (status dikelola per unit).</p>}
                <Button variant="secondary" size="sm" className="min-h-[44px]" data-testid="buka-unit360" onClick={() => onBukaUnit360?.(unitId)}>Buka Unit 360</Button>
              </div>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────────── tindakan utama ─────────────────────────────
function TindakanUtama({ data, aktif, onDone, onBukaUnit360 }) {
  const { adopsi: ad, izin, unit: u } = data;
  const t = ad.tindakan || {};
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState({ galat: null, ok: "" });

  const ke = (id) => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); el.querySelector?.("button, input, select")?.focus?.({ preventScroll: true }); } };
  async function catat(status) {
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try { await api.postStatusKerjaManual(u.id, { status, expectedLatestId: data.kerjaManual.terakhirId }); setHasil({ galat: null, ok: `Status kerja dicatat: ${status === "DIKERJAKAN" ? "Dikerjakan" : "Selesai"}.` }); await onDone(); } catch (e) { setHasil({ galat: e, ok: "" }); } finally { setSibuk(false); }
  }
  async function siapKirim() {
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try { await api.updateOrder(u.order.id, { status: "READY", statusOverrideNote: "Diubah dari Order Produksi" }); setKonfirmasi(false); setHasil({ galat: null, ok: "Status order kini Siap Kirim — Sales dan Delivery melihat status yang sama." }); await onDone(); } catch (e) { setHasil({ galat: e, ok: "" }); } finally { setSibuk(false); }
  }

  let tombol = null;
  switch (t.aksi) {
    case "START_WORK": tombol = izin.statusKerja && aktif && !data.kerjaManual.dikunciAplikasi ? { label: "Catat: Dikerjakan", onClick: () => catat("DIKERJAKAN") } : null; break;
    case "FINISH_WORK": tombol = izin.statusKerja && aktif && !data.kerjaManual.dikunciAplikasi ? { label: "Catat: Selesai", onClick: () => catat("SELESAI") } : { label: "Buka Unit 360", onClick: onBukaUnit360, sekunder: true }; break;
    case "MARK_READY": tombol = izin.statusOrder ? { label: "Tandai Siap Kirim", onClick: () => setKonfirmasi(true) } : null; break;
    case "PLAN_MATERIAL": tombol = izin.rencanaBahan ? { label: "Susun rencana bahan", onClick: () => ke("sec-rencana-wrap") } : null; break;
    case "SET_TARGET": case "OPEN_PLAN": tombol = izin.target ? { label: t.aksi === "SET_TARGET" ? "Tetapkan target" : "Atur status & target", onClick: () => ke("sec-status") } : null; break;
    case "RECORD_MATERIAL": tombol = izin.pemakaianAktual ? { label: "Catat pemakaian bahan", onClick: () => ke("sec-aktual") } : null; break;
    case "RESOLVE_DELAY": tombol = { label: "Buka Unit 360", onClick: onBukaUnit360, sekunder: true }; break;
    default: tombol = null;
  }

  return (
    <div className="rounded-card bg-inset px-4 py-3" data-testid="tindakan-utama">
      <p className="m-0 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink3">Tindakan berikutnya</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] font-semibold text-ink" data-testid="tindakan-label">{t.label || "—"}</p>
          <p className="m-0 text-[12.5px] text-ink3">{t.aktor && t.aktor !== "—" ? `Oleh ${t.aktor}` : ""}{t.detail ? `${t.aktor && t.aktor !== "—" ? " · " : ""}${t.detail}` : ""}</p>
        </div>
        {tombol && !konfirmasi && <Button variant={tombol.sekunder ? "secondary" : "primary"} className="min-h-[44px]" data-testid="tindakan-tombol" disabled={sibuk} onClick={tombol.onClick}>{sibuk ? "Menyimpan…" : tombol.label}</Button>}
      </div>
      {konfirmasi && (
        <div role="group" aria-label="Konfirmasi Siap Kirim" className="mt-3 rounded-btn bg-surface px-3 py-3 text-[13px] text-ink2" data-testid="konfirmasi-siap-kirim">
          <p className="m-0 font-medium text-ink">Ubah status order {u.order.orderNumber} menjadi Siap Kirim?</p>
          <p className="m-0 mt-1">Sales dan Delivery akan melihat status yang sama, dan tugas pengiriman dibuat bila belum ada.{u.order.jumlahUnit > 1 ? ` Order ini punya ${u.order.jumlahUnit} unit — status mengikuti aturan order.` : ""}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={() => setKonfirmasi(false)} disabled={sibuk}>Batal</Button><Button className="min-h-[44px]" data-testid="konfirmasi-siap-kirim-ya" onClick={siapKirim} disabled={sibuk}>{sibuk ? "Menyimpan…" : "Ya, tandai Siap Kirim"}</Button></div>
        </div>
      )}
      <Hasil hasil={hasil} onMuat={onDone} />
    </div>
  );
}

function Hasil({ hasil, onMuat }) {
  const g = hasil.galat ? pesanGalatAdopsi(hasil.galat) : null;
  if (hasil.ok) return <p role="status" data-testid="hasil-ok" className="m-0 mt-3 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />{hasil.ok}</p>;
  if (!g) return null;
  return (
    <div role="alert" data-testid="hasil-galat" className={cn("mt-3 rounded-btn px-3 py-2 text-[12.5px]", g.jenis === "konflik" || g.jenis === "info" ? "bg-orangebg text-orange" : "bg-redbg text-red")}>
      <p className="m-0 flex items-start gap-2 font-medium">{g.jenis === "info" ? <Info size={15} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />}{g.teks}</p>
      {g.petunjuk && <p className="m-0 mt-0.5 pl-6">{g.petunjuk}</p>}
      {g.muatUlang && <Button variant="secondary" size="sm" className="ml-6 mt-2 min-h-[40px]" onClick={onMuat}>Muat ulang</Button>}
    </div>
  );
}

// ───────────────────────────── status & target ─────────────────────────────
function StatusTarget({ data, aktif, onDone }) {
  const { adopsi: ad, izin, unit: u, kerjaManual: km } = data;
  const [kerja, setKerja] = useState(km.nilaiBoleh.find((n) => n.key === ad.kerja?.key)?.key || "DIJADWALKAN");
  const [catatan, setCatatan] = useState("");
  const [orderPilih, setOrderPilih] = useState(u.status === "READY_FOR_DELIVERY" ? "READY" : "PROCESSING");
  const [targetTeks, setTargetTeks] = useState(() => (u.productionDueAt ? new Date(new Date(u.productionDueAt).getTime() + 7 * 3600000).toISOString().slice(0, 10) : ""));
  const [hKerja, setHKerja] = useState({ galat: null, ok: "" }); const [hOrder, setHOrder] = useState({ galat: null, ok: "" }); const [hTarget, setHTarget] = useState({ galat: null, ok: "" });
  const [sibuk, setSibuk] = useState("");
  const kunci = km.dikunciAplikasi;
  const perluCatatan = kerja === "TERTUNDA";

  async function simpanKerja() {
    setSibuk("kerja"); setHKerja({ galat: null, ok: "" });
    try { const r = await api.postStatusKerjaManual(u.id, { status: kerja, note: catatan.trim() || undefined, expectedLatestId: km.terakhirId }); setHKerja({ galat: null, ok: r.dicatat ? "Status kerja dicatat manual. Tidak ada tahap, foto, QC, atau pemakaian bahan yang dibuat." : "Sudah sama dengan catatan terakhir — tidak ada yang berubah." }); setCatatan(""); await onDone(); } catch (e) { setHKerja({ galat: e, ok: "" }); } finally { setSibuk(""); }
  }
  async function simpanOrder() {
    setSibuk("order"); setHOrder({ galat: null, ok: "" });
    try { await api.updateOrder(u.order.id, { status: orderPilih, statusOverrideNote: "Diubah dari Order Produksi" }); setHOrder({ galat: null, ok: `Status order diubah ke ${STATUS_ORDER_OPSI.find((o) => o.key === orderPilih)?.label}. Sales dan Delivery melihat status yang sama.` }); await onDone(); } catch (e) { setHOrder({ galat: e, ok: "" }); } finally { setSibuk(""); }
  }
  async function simpanTarget() {
    setSibuk("target"); setHTarget({ galat: null, ok: "" });
    try {
      const iso = targetTeks ? new Date(`${targetTeks}T17:00:00+07:00`).toISOString() : null;
      await api.updateUnitProduction(u.id, { productionDueAt: iso, expected: { productionDueAt: u.productionDueAt ?? null } });
      setHTarget({ galat: null, ok: targetTeks ? "Target selesai disimpan." : "Target selesai dikosongkan." }); await onDone();
    } catch (e) { setHTarget({ galat: e.code === "UNIT_CONFLICT" || e.status === 409 ? Object.assign(e, { code: "RIWAYAT_BERUBAH" }) : e, ok: "" }); } finally { setSibuk(""); }
  }

  const label = "block text-[12px] font-medium text-ink3";
  const field = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2" data-testid="status-target">
      {/* status kerja manual */}
      <div className="space-y-3 md:col-span-1">
        <p className="m-0 text-[13px] font-semibold text-ink">Status kerja</p>
        {kunci
          ? <Kosong>Unit ini sudah dikerjakan lewat aplikasi Produksi, jadi status kerja <b>mengikuti aplikasi</b> ({ad.kerja?.label}) dan tidak bisa dicatat manual.</Kosong>
          : (
            <>
              <p className="m-0 text-[12.5px] text-ink3">Untuk Admin yang belum memakai aplikasi Meja. Hanya mencatat status — tidak membuat tahap, foto, QC, atau pemakaian bahan.</p>
              <label className="block space-y-1"><span className={label}>Catat status kerja</span>
                <select value={kerja} onChange={(e) => setKerja(e.target.value)} disabled={!izin.statusKerja || !aktif || !!sibuk} data-testid="kerja-pilih" className={field}>
                  {km.nilaiBoleh.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                </select></label>
              <label className="block space-y-1"><span className={label}>Catatan {perluCatatan ? "(wajib untuk Tertunda)" : "(opsional)"}</span>
                <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} disabled={!izin.statusKerja || !aktif || !!sibuk} data-testid="kerja-catatan" placeholder={perluCatatan ? "Mis. menunggu kain dari supplier" : "Tambahkan catatan singkat"} className={field} /></label>
              {izin.statusKerja && aktif
                ? <Button className="min-h-[44px]" data-testid="kerja-simpan" disabled={!!sibuk || (perluCatatan && catatan.trim().length < 3)} onClick={simpanKerja}>{sibuk === "kerja" ? "Menyimpan…" : "Catat status kerja"}</Button>
                : <p className="m-0 text-[12.5px] text-ink3">{!aktif ? "Unit sudah selesai/dibatalkan." : "Akun Anda hanya bisa melihat."}</p>}
            </>
          )}
        <Hasil hasil={hKerja} onMuat={onDone} />
        {km.riwayat.length > 0 && (
          <ul className="m-0 list-none space-y-1 p-0 text-[12px] text-ink2" data-testid="kerja-riwayat">
            {[...km.riwayat].reverse().slice(0, 4).map((r) => (
              <li key={r.id}><b className="text-ink">{r.label}</b> · Dicatat manual oleh {r.by || "—"}, {waktuWib(r.at)}{r.note ? ` — “${r.note}”` : ""}{r.digantikanBuktiAplikasi ? <span className="text-orange"> · digantikan bukti aplikasi sejak {waktuWib(r.digantikanBuktiAplikasi)}</span> : null}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-6">
        {/* status order */}
        <div className="space-y-3">
          <p className="m-0 text-[13px] font-semibold text-ink">Status order</p>
          <p className="m-0 text-[12.5px] text-ink3">Sama dengan yang dilihat Sales dan Delivery — perubahan di sini berlaku di semua workspace.</p>
          <div className="flex items-end gap-2">
            <label className="block flex-1 space-y-1"><span className={label}>Ubah ke</span>
              <select value={orderPilih} onChange={(e) => setOrderPilih(e.target.value)} disabled={!izin.statusOrder || !aktif || !!sibuk} data-testid="order-pilih" className={field}>
                {STATUS_ORDER_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select></label>
            <Button variant="secondary" className="min-h-[44px]" data-testid="order-simpan" disabled={!izin.statusOrder || !aktif || !!sibuk} onClick={simpanOrder}>{sibuk === "order" ? "Menyimpan…" : "Ubah"}</Button>
          </div>
          {!izin.statusOrder && <p className="m-0 text-[12.5px] text-ink3">Akun Anda hanya bisa melihat.</p>}
          <Hasil hasil={hOrder} onMuat={onDone} />
        </div>

        {/* target + PIC */}
        <div className="space-y-3">
          <p className="m-0 text-[13px] font-semibold text-ink">Target selesai &amp; PIC</p>
          <div className="flex items-end gap-2">
            <label className="block flex-1 space-y-1"><span className={label}>Target selesai</span>
              <input type="date" value={targetTeks} onChange={(e) => setTargetTeks(e.target.value)} disabled={!izin.target || !aktif || !!sibuk} data-testid="target-tanggal" className={field} /></label>
            <Button variant="secondary" className="min-h-[44px]" data-testid="target-simpan" disabled={!izin.target || !aktif || !!sibuk} onClick={simpanTarget}>{sibuk === "target" ? "Menyimpan…" : "Simpan"}</Button>
          </div>
          <p className="m-0 text-[12.5px] text-ink3" data-testid="pic-teks">PIC: <b className="text-ink">{ad.pic?.nama || "Belum ditugaskan"}</b>{ad.meja ? ` · ${ad.meja}` : ""}{ad.pic ? ` (${ad.pic.sumber === "TAHAP" ? "penugasan tahap" : "Rencana Produksi"})` : " — atur di Rencana Produksi."}</p>
          {ad.targetSelesai && <p className="m-0 text-[12px] text-ink3">Target saat ini {formatTanggal(ad.targetSelesai.at)} ({ad.targetSelesai.sumber === "UNIT" ? "diisi di unit" : "dari Rencana Produksi"}).</p>}
          <Hasil hasil={hTarget} onMuat={onDone} />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── pemakaian aktual ─────────────────────────────
function PemakaianAktual({ data, aktif, bolehCatat, onDone }) {
  const { pemakaianAktual: ak, perbandingan, unit: u } = data;
  const [form, setForm] = useState(false);
  const [cari, setCari] = useState(""); const [hasilCari, setHasilCari] = useState([]);
  const [pilih, setPilih] = useState(null); const [qty, setQty] = useState(""); const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [hasil, setHasil] = useState({ galat: null, ok: "" });
  const kunciRef = useRef(null); const isianRef = useRef("");

  useEffect(() => {
    if (!form) return undefined;
    let batal = false; const t = setTimeout(async () => {
      try { const d = await api.getKatalogBahanProduksi({ q: cari.trim() || undefined, limit: "8" }); if (!batal) setHasilCari(d.rows || []); } catch { if (!batal) setHasilCari([]); }
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [form, cari]);

  // Satu niat = satu kunci: dipakai ulang bila isian sama (klik ulang/retry), diganti bila isian berubah → pencatatan TEPAT SEKALI.
  const sidik = `${pilih?.materialId}|${qty}|${catatan}`;
  if (isianRef.current !== sidik) { isianRef.current = sidik; kunciRef.current = null; }
  async function catat() {
    const v = parseJumlah(qty); if (!pilih || v === null || v === 0) return;
    kunciRef.current ??= kunciIdempoten("pakai");
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try {
      await api.addUnitMaterial(u.id, { materialId: pilih.materialId, qty: v, note: catatan.trim() || undefined }, kunciRef.current);
      setHasil({ galat: null, ok: `Tercatat: ${pilih.nama} ${formatJumlah(v)} ${pilih.satuan}. Stok berkurang.` }); setForm(false); setPilih(null); setQty(""); setCatatan(""); kunciRef.current = null;
      await onDone();
    } catch (e) { setHasil({ galat: e, ok: "" }); } finally { setSibuk(false); }
  }

  return (
    <div className="space-y-3" data-testid="pemakaian-aktual">
      {perbandingan.length > 0 && (
        <div className="overflow-x-auto" data-testid="rencana-vs-aktual">
          <table className="w-full table-fixed border-collapse text-left text-[13px]">
            <caption className="sr-only">Perbandingan rencana dan pemakaian aktual per bahan</caption>
            <thead><tr className="text-[11.5px] uppercase tracking-[0.05em] text-ink3"><th scope="col" className="w-[44%] py-1 pr-2 font-medium">Bahan</th><th scope="col" className="px-2 py-1 text-right font-medium">Rencana</th><th scope="col" className="pl-2 py-1 text-right font-medium">Aktual</th></tr></thead>
            <tbody className="divide-y divide-line">
              {perbandingan.map((p) => (
                <tr key={p.materialId}>
                  <td className="py-2 pr-3"><span className="block font-medium text-ink">{p.nama}</span><span className="block text-[11.5px] text-ink3">{p.kode}</span></td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink2">{p.rencana === null ? <span className="text-ink3">tidak direncanakan</span> : `${formatJumlah(p.rencana)} ${p.satuan}`}</td>
                  <td className={cn("pl-2 py-2 text-right tabular-nums font-semibold", p.rencana !== null && p.aktual > p.rencana ? "text-orange" : "text-ink")}>{formatJumlah(p.aktual)} {p.satuan}{p.rencana !== null && p.aktual > p.rencana ? <span className="block text-[11px] font-normal">melebihi rencana</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ak.baris.length === 0
        ? <Kosong>Belum ada pemakaian bahan tercatat untuk unit ini. Pemakaian dicatat lewat Material Issue Gudang atau catat langsung di sini.</Kosong>
        : (
          <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0" data-testid="aktual-baris">
            {ak.baris.slice(0, 8).map((b) => (
              <li key={b.id} className="px-3 py-2 text-[12.5px]">
                <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate font-medium text-ink">{b.nama}</span><span className={cn("shrink-0 font-semibold tabular-nums", b.qty < 0 ? "text-green" : "text-ink")}>{b.qty < 0 ? "−" : ""}{formatJumlah(Math.abs(b.qty))} {b.satuan}</span></div>
                <div className="text-ink3">{b.dokumen.jenis}{b.dokumen.nomor ? ` ${b.dokumen.nomor}` : ""} · {b.pelaku || "—"} · {waktuWib(b.tanggal)}{b.tipe === "RETURN" ? " · dikembalikan" : ""}</div>
              </li>
            ))}
          </ul>
        )}
      {ak.baris.length > 8 && <p className="m-0 text-[12px] text-ink3">Menampilkan 8 dari {ak.baris.length} catatan terbaru. Lengkapnya ada di Unit 360 &gt; Bahan.</p>}

      {bolehCatat && aktif && !form && <Button variant="secondary" className="min-h-[44px]" data-testid="aktual-buka" onClick={() => { setForm(true); setHasil({ galat: null, ok: "" }); }}>Catat pemakaian bahan</Button>}
      {!bolehCatat && <p className="m-0 text-[12.5px] text-ink3">Akun Anda hanya bisa melihat pemakaian.</p>}
      {form && (
        <div className="space-y-3 rounded-card bg-inset px-4 py-3" data-testid="aktual-form">
          <p className="m-0 flex items-start gap-2 text-[12.5px] text-orange"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />Ini pemakaian sungguhan: <b>stok Gudang berkurang</b> sekarang. Untuk sekadar merencanakan, gunakan Rencana bahan.</p>
          {!pilih ? (
            <>
              <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari bahan (nama atau kode)…" aria-label="Cari bahan yang dipakai" data-testid="aktual-cari" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
              <ul className="m-0 max-h-[200px] list-none divide-y divide-line overflow-y-auto rounded-btn bg-surface p-0">
                {hasilCari.map((b) => <li key={b.materialId}><button type="button" onClick={() => setPilih(b)} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span><span className="block text-[11.5px] text-ink3">{b.kode} · {b.kelompok?.label}</span></span><span className="text-[12px] text-ink3">{b.satuan}</span></button></li>)}
                {!hasilCari.length && <li className="px-3 py-3 text-center text-[13px] text-ink3">Tidak ada bahan cocok.</li>}
              </ul>
            </>
          ) : (
            <div className="space-y-2">
              <p className="m-0 text-[13px] font-medium text-ink">{pilih.nama} <button type="button" className="ml-1 text-[12px] font-normal text-accent underline-offset-2 hover:underline" onClick={() => setPilih(null)}>ganti</button></p>
              <div className="flex gap-2">
                <label className="flex-1"><span className="block text-[12px] text-ink3">Jumlah dipakai ({pilih.satuan})</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="aktual-qty" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-right text-[14px] tabular-nums text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
                <label className="flex-[2]"><span className="block text-[12px] text-ink3">Catatan (opsional)</span><input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={() => { setForm(false); setPilih(null); }} disabled={sibuk}>Batal</Button><Button className="min-h-[44px]" data-testid="aktual-simpan" disabled={sibuk || !pilih || parseJumlah(qty) === null || parseJumlah(qty) === 0} onClick={catat}>{sibuk ? "Mencatat…" : "Catat & kurangi stok"}</Button></div>
        </div>
      )}
      <Hasil hasil={hasil} onMuat={onDone} />
    </div>
  );
}

function Riwayat({ daftar }) {
  const [semua, setSemua] = useState(false);
  const tampil = useMemo(() => (semua ? daftar : daftar.slice(0, 6)), [daftar, semua]);
  if (!daftar?.length) return <Kosong>Belum ada riwayat untuk unit ini.</Kosong>;
  return (
    <>
      <ol className="m-0 list-none space-y-2 p-0" data-testid="riwayat-daftar">
        {tampil.map((r, i) => (
          <li key={`${r.kind}-${r.at}-${i}`} className="text-[12.5px]">
            <span className="text-ink">{r.label}</span>
            <span className="block text-ink3">{r.actor || "Sistem"} · {waktuWib(r.at)}</span>
          </li>
        ))}
      </ol>
      {daftar.length > 6 && <Button variant="tertiary" size="sm" className="mt-2 min-h-[40px]" onClick={() => setSemua((v) => !v)}>{semua ? "Tampilkan lebih sedikit" : `Tampilkan semua (${daftar.length})`}</Button>}
    </>
  );
}
