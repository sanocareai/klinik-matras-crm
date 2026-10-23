import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/features/production/bahan/bahan.css";
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Package, ScrollText, SlidersHorizontal } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal } from "@/utils/formatDate.js";
import MaterialPlanEditor from "@/features/production/MaterialPlanEditor.jsx";
import PemakaianAktualBagian from "@/features/production/bahan/PemakaianAktualBagian.jsx";
import PenerimaanWorkshopModal from "@/features/production/PenerimaanWorkshopModal.jsx";
import KoreksiPenerimaanModal from "@/features/production/KoreksiPenerimaanModal.jsx";
import { statusOf } from "@/features/production/productionLabels.js";
import { KERJA_PERLU_KONFIRMASI, formatJumlah, ketersediaanText, konfirmasiKerja, kunciIdempoten, labelCatatKerja, nadaBadge, parseJumlah, pesanGalatAdopsi, sumberKerjaText, teksKoreksi, waktuWib } from "@/features/production/orderProduksiModel.js";

// Panel fokus Order Produksi (adopsi Admin) — urutan: ringkasan + SATU tindakan utama → status & target → rencana bahan → pemakaian aktual → riwayat → lanjutan (Unit 360).
// Tiga status tampil terpisah dan berlabel (Status order · Posisi unit · Status kerja) — label teks, bukan hanya warna. Tahap/dokumentasi/biaya/QC tetap lengkap di Unit 360 (bagian "Lanjutan").
// Catatan manual TIDAK membuat tahap, QC, foto, penerimaan Gudang, atau pemakaian bahan; stok hanya berubah lewat "Pemakaian aktual".

const PANEL_PROPS = { "data-testid": "order-produksi-panel" };
const STATUS_ORDER_OPSI = Object.freeze([{ key: "PROCESSING", label: "Diproses" }, { key: "READY", label: "Siap Kirim" }]);
const aktifUnit = (s) => !["CANCELLED", "DELIVERED"].includes(s);

function Status3({ ad, unitStatus, penerimaan }) {
  // Status ORDER = status Sales sebenarnya (ad.orderSales) — bukan turunan status unit. Payload lama tanpa orderSales jatuh ke peta unit.
  const order = ad.orderSales ?? statusOf({ status: unitStatus, unitStatusDisplay: ad.statusOrder });
  const subOrder = ad.orderSales?.terkunci ? `Dikunci manual${ad.orderSales.pengunci?.nama ? ` oleh ${ad.orderSales.pengunci.nama}` : ""}${ad.orderSales.pengunci?.at ? `, ${waktuWib(ad.orderSales.pengunci.at)}` : ""}` : "Dilihat Sales & Delivery";
  const subPosisi = penerimaan ? `Diterima ${penerimaan.receivedBy?.name ? `oleh ${penerimaan.receivedBy.name}` : "petugas"} · ${waktuWib(penerimaan.receivedAt)}${penerimaan.location?.code ? ` · ${penerimaan.location.code}` : ""}` : (ad.posisi?.detail || "Dari dokumen jemput/terima/kirim");
  const baris = [
    { cap: "Status order", sub: subOrder, chip: order, key: "order" },
    { cap: "Posisi unit", sub: subPosisi, chip: ad.posisi, key: "posisi" },
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

export default function OrderProduksiPanel({ unitId, fokus = null, onClose, onChanged, onBukaUnit360 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const reqRef = useRef(0);
  // FOKUS BAHAN: masuk untuk mencatat bahan (tombol "Catat bahan" di daftar, atau "Pemakaian bahan" di bilah lompat) → Pemakaian aktual naik tepat di bawah ringkasan dan layar diarahkan ke sana;
  // Status & target tetap bisa dicapai (bagian terlipat di bawahnya + bilah lompat). Tanpa fokus, urutan lama dipertahankan.
  const [fokusLokal, setFokusLokal] = useState(false); const fokusSudahRef = useRef("");
  const fokusBahan = fokus === "bahan" || fokusLokal;

  const muat = useCallback(async () => {
    if (!unitId) return;
    const id = ++reqRef.current; setMemuat(true); setError(null);
    try { const d = await api.getUnitAdopsi(unitId); if (id === reqRef.current) setData(d); } catch (e) { if (id === reqRef.current) setError(e); } finally { if (id === reqRef.current) setMemuat(false); }
  }, [unitId]);
  useEffect(() => { setData(null); setFokusLokal(false); fokusSudahRef.current = ""; if (unitId) muat(); }, [unitId, muat]);
  useEffect(() => {
    if (!fokusBahan || !data?.unit?.id || fokusSudahRef.current === data.unit.id) return undefined;
    fokusSudahRef.current = data.unit.id;
    const t = setTimeout(() => { const el = document.getElementById("sec-aktual"); if (el) { el.scrollIntoView({ behavior: "auto", block: "start" }); el.setAttribute("tabindex", "-1"); el.style.outline = "none"; el.focus({ preventScroll: true }); } }, 60);
    return () => clearTimeout(t);
  }, [fokusBahan, data?.unit?.id]);
  const lompat = (id, { buka = false } = {}) => { const el = document.getElementById(id); if (!el) return; if (el.tagName === "DETAILS" || buka) { const d = el.closest("details") || el; if (d.tagName === "DETAILS") d.open = true; } el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); };

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
              <Status3 ad={ad} unitStatus={u.status} penerimaan={data.penerimaan} />
              <TindakanUtama data={data} aktif={aktif} onDone={sesudahUbah} onBukaUnit360={() => onBukaUnit360?.(unitId)} />
              <KartuPenerimaan data={data} aktif={aktif} onDone={sesudahUbah} />
            </div>

            {/* Bilah lompat: semua bagian tetap terjangkau tanpa menggulir melewati bagian lain */}
            <nav aria-label="Bagian panel" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="panel-lompat">
              <Button variant={fokusBahan ? undefined : "secondary"} size="sm" className="min-h-[44px] shrink-0" data-testid="lompat-bahan" aria-pressed={fokusBahan} onClick={() => { setFokusLokal(true); fokusSudahRef.current = ""; setTimeout(() => lompat("sec-aktual"), 60); }}><Package size={14} aria-hidden /> Pemakaian bahan</Button>
              <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" data-testid="lompat-status" onClick={() => lompat("sec-status", { buka: true })}><SlidersHorizontal size={14} aria-hidden /> Status &amp; target</Button>
              <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" data-testid="lompat-riwayat" onClick={() => lompat("sec-riwayat")}><ScrollText size={14} aria-hidden /> Riwayat</Button>
            </nav>

            {/* 2 · Status & target — di atas Pemakaian aktual (urutan biasa); bila fokus bahan: terlipat di bawah Pemakaian aktual */}
            {!fokusBahan && <Bagian id="sec-status" judul="Status & target"><StatusTarget data={data} aktif={aktif} onDone={sesudahUbah} /></Bagian>}

            {/* 3 · Pemakaian aktual — tiga sumber selalu terlihat. Bahan dari Gudang mengurangi stok; belum ada di katalog = pemakaian sementara + usulan (perlu rekonsiliasi Gudang); komponen lama tidak memengaruhi stok */}
            <Bagian id="sec-aktual" judul="Pemakaian aktual">
              <PemakaianAktual data={data} aktif={aktif} onDone={sesudahUbah} onMulai={() => { const d = document.getElementById("sec-rencana-wrap"); if (d?.tagName === "DETAILS") d.open = false; }} />
            </Bagian>

            {fokusBahan && (
              <details className="border-t border-line pt-5" id="sec-status-lipat" data-testid="sec-status-lipat">
                <summary className="min-h-[44px] cursor-pointer text-[14px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50">Status &amp; target · {ad.kerja?.label || "—"}{ad.targetSelesai?.at ? " · target diisi" : " · tanpa target"}</summary>
                <div className="pt-3"><Bagian id="sec-status" judul="Status & target"><StatusTarget data={data} aktif={aktif} onDone={sesudahUbah} /></Bagian></div>
              </details>
            )}

            {/* 4 · Rencana bahan — opsional, TERTUTUP bawaan, di bawah pemakaian aktual */}
            <details className="border-t border-line pt-5" id="sec-rencana-wrap" data-testid="sec-rencana-lama">
              <summary className="min-h-[44px] cursor-pointer text-[14px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50">Rencana bahan (opsional, belum mengurangi stok){data.rencanaBahan?.plan ? ` · ${data.rencanaBahan.plan.lines.length} bahan` : ""}</summary>
              <div className="pt-3"><MaterialPlanEditor unitId={unitId} rencana={data.rencanaBahan} bolehUbah={!!izin.rencanaBahan} unitAktif={aktif} onSaved={() => sesudahUbah()} onReload={muat} /></div>
            </details>

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
/** Konfirmasi singkat SEBELUM menyimpan status kerja yang menyatakan pekerjaan sudah dilakukan. Tidak menyimpan apa pun sampai "Ya"; klik ganda diabaikan oleh pemanggil (sibuk). */
export function KonfirmasiKerja({ status, unitCode, sibuk, onYa, onBatal }) {
  const k = konfirmasiKerja(status, unitCode);
  const ref = useRef(null);
  // Di HP, banner/toolbar yang menempel di bawah layar bisa menutupi tombol Batal/Ya: gulirkan konfirmasi ke tengah layar saat muncul (HP dan desktop), tanpa mengambil fokus dari "Batal".
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const kurang = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: kurang ? "auto" : "smooth" });
  }, [status]);
  if (!k) return null;
  return (
    <div ref={ref} role="group" aria-label="Konfirmasi status kerja" className="mt-3 scroll-mb-24 space-y-2 rounded-btn bg-surface px-3 py-3 text-[13px] text-ink2" data-testid="konfirmasi-kerja">
      <p className="m-0 font-medium text-ink" data-testid="konfirmasi-kerja-judul">{k.judul}</p>
      <p className="m-0">{k.isi}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" data-testid="konfirmasi-kerja-batal" onClick={onBatal} disabled={sibuk}>Batal</Button>
        <Button className="min-h-[44px]" data-testid="konfirmasi-kerja-ya" onClick={onYa} disabled={sibuk}>{sibuk ? "Menyimpan…" : k.ya}</Button>
      </div>
    </div>
  );
}

function TindakanUtama({ data, aktif, onDone, onBukaUnit360, onBagian }) {
  const { adopsi: ad, izin, unit: u } = data;
  const t = ad.tindakan || {};
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [terimaBuka, setTerimaBuka] = useState(false);
  const [diprosesBuka, setDiprosesBuka] = useState(false);
  const [catatanOrder, setCatatanOrder] = useState("");
  const [konfKerja, setKonfKerja] = useState(null); // status kerja yang menunggu konfirmasi ("DIKERJAKAN" | "SELESAI")
  const catatRef = useRef(false); // klik ganda: hanya satu permintaan
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState({ galat: null, ok: "" });

  const ke = (id) => { const el = document.getElementById(id); if (el) { if (el.tagName === "DETAILS") el.open = true; /* rencana terlipat: buka dulu bila diminta lewat tindakan */ el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); el.querySelector?.("button, input, select")?.focus?.({ preventScroll: true }); } };
  async function catat(status) {
    if (catatRef.current) return; catatRef.current = true;
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try { await api.postStatusKerjaManual(u.id, { status, expectedLatestId: data.kerjaManual.terakhirId }); setKonfKerja(null); setHasil({ galat: null, ok: konfirmasiKerja(status, u.unitCode)?.sukses ?? "Status kerja dicatat." }); await onDone(); } catch (e) { setKonfKerja(null); setHasil({ galat: e, ok: "" }); } finally { setSibuk(false); catatRef.current = false; }
  }
  async function siapKirim() {
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try { await api.updateOrder(u.order.id, { status: "READY", statusOverrideNote: "Diubah dari Order Produksi" }); setKonfirmasi(false); setHasil({ galat: null, ok: "Status order kini Siap Kirim — Sales dan Delivery melihat status yang sama." }); await onDone(); } catch (e) { setHasil({ galat: e, ok: "" }); } finally { setSibuk(false); }
  }

  const diprosesRef = useRef(false);
  async function ubahKeDiproses() {
    if (diprosesRef.current) return; diprosesRef.current = true;
    setSibuk(true); setHasil({ galat: null, ok: "" });
    try { await api.updateOrder(u.order.id, { status: "PROCESSING", statusOverrideNote: catatanOrder.trim() }); setDiprosesBuka(false); setCatatanOrder(""); setHasil({ galat: null, ok: "Status order kini Diproses — Sales dan Delivery melihat status yang sama. Unit bisa dijadwalkan di Rencana Produksi." }); await onDone(); } catch (e) { setHasil({ galat: e, ok: "" }); } finally { diprosesRef.current = false; setSibuk(false); }
  }

  let tombol = null;
  switch (t.aksi) {
    case "CONFIRM_ARRIVAL": tombol = izin.catatPenerimaan && aktif ? { label: "Catat unit diterima", onClick: () => setTerimaBuka(true) } : null; break;
    case "UBAH_ORDER_DIPROSES": tombol = izin.statusOrder && aktif ? { label: "Ubah ke Diproses", onClick: () => setDiprosesBuka(true) } : null; break;
    // OPEN_WORK: hanya MEMBUKA bagian Pekerjaan (tidak mengubah status; tampil juga untuk akun hanya-lihat). Status kerja tidak pernah tercatat dari tombol ini.
    case "OPEN_WORK": tombol = { label: t.label || "Buka pekerjaan", onClick: () => (onBagian ? onBagian("pekerjaan") : ke("sec-status")) }; break;
    case "FINISH_WORK": tombol = izin.statusKerja && aktif && !data.kerjaManual.dikunciAplikasi ? { label: "Catat pekerjaan selesai", onClick: () => setKonfKerja("SELESAI") } : { label: "Buka Unit 360", onClick: onBukaUnit360, sekunder: true }; break;
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
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <p className="m-0 text-[15px] font-semibold text-ink" data-testid="tindakan-label">{t.label || "—"}</p>
          <p className="m-0 text-[12.5px] text-ink3">{t.aktor && t.aktor !== "—" ? `Oleh ${t.aktor}` : ""}{t.detail ? `${t.aktor && t.aktor !== "—" ? " · " : ""}${t.detail}` : ""}</p>
        </div>
        {tombol && !konfirmasi && !diprosesBuka && !konfKerja && <Button variant={tombol.sekunder ? "secondary" : "primary"} className="bh-cta min-h-[44px]" data-testid="tindakan-tombol" disabled={sibuk} onClick={tombol.onClick}>{sibuk ? "Menyimpan…" : tombol.label}</Button>}
      </div>
      {t.penghalang && t.aksi !== "UBAH_ORDER_DIPROSES" && (
        <p role="note" data-testid="tindakan-penghalang" className="m-0 mt-2 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><Info size={15} className="mt-0.5 shrink-0" aria-hidden />{t.penghalang.teks}</p>
      )}
      {terimaBuka && <PenerimaanWorkshopModal unit={{ unitId: u.id, unitCode: u.unitCode, orderNumber: u.order.orderNumber, customerName: u.order.customer?.name }} onClose={() => setTerimaBuka(false)} onDone={async (ok) => { setTerimaBuka(false); setHasil({ galat: null, ok }); await onDone(); }} />}
      {diprosesBuka && (
        <div role="group" aria-label="Konfirmasi ubah status order ke Diproses" className="mt-3 space-y-2 rounded-btn bg-surface px-3 py-3 text-[13px] text-ink2" data-testid="konfirmasi-diproses">
          <p className="m-0 font-medium text-ink">Ubah status order {u.order.orderNumber} dari {data.adopsi.orderSales?.label || "Pengambilan"} menjadi Diproses?</p>
          <p className="m-0">Perubahan ini lewat jalur status Sales yang sama: tercatat atas nama Anda dengan catatan di bawah, dan <b>hanya order ini</b> yang berubah. Tidak membuat job pengiriman atau Production Run.{u.order.jumlahUnit > 1 ? ` Order ini punya ${u.order.jumlahUnit} unit — status mengikuti aturan order.` : ""}</p>
          <label className="block space-y-1"><span className="block text-[12px] font-medium text-ink3">Catatan perubahan (wajib)</span>
            <input value={catatanOrder} onChange={(e) => setCatatanOrder(e.target.value)} maxLength={300} disabled={sibuk} data-testid="diproses-catatan" placeholder="Mis. unit sudah diterima di workshop" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="neutral" className="min-h-[44px]" onClick={() => setDiprosesBuka(false)} disabled={sibuk}>Batal</Button><Button className="min-h-[44px]" data-testid="diproses-ya" onClick={ubahKeDiproses} disabled={sibuk || catatanOrder.trim().length < 3}>{sibuk ? "Menyimpan…" : "Ya, ubah ke Diproses"}</Button></div>
        </div>
      )}
      {konfKerja && <KonfirmasiKerja status={konfKerja} unitCode={u.unitCode} sibuk={sibuk} onYa={() => catat(konfKerja)} onBatal={() => setKonfKerja(null)} />}
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

// Catatan penerimaan di workshop + riwayat koreksinya (catatan asli tidak pernah dihapus) + tombol Koreksi. Tanpa istilah teknis: petugas hanya melihat siapa, kapan, di mana, dan apa yang pernah dikoreksi.
function KartuPenerimaan({ data, aktif, onDone }) {
  const { penerimaan: p, riwayatPenerimaan: riwayat = [], izin, unit: u } = data;
  const [buka, setBuka] = useState(false);
  const [ok, setOk] = useState("");
  const batal = riwayat.filter((r) => !r.aktif);
  if (!p && !batal.length) return null;
  const boleh = !!p && aktif && (izin.koreksiLokasiPenerimaan || izin.koreksiBelumDiterima);
  return (
    <section aria-label="Penerimaan di workshop" className="rounded-card border border-line px-4 py-3" data-testid="kartu-penerimaan">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="m-0 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink3">Penerimaan di workshop</p>
        {p?.koreksi?.length > 0 && <Badge variant="orange">Sudah dikoreksi {p.koreksi.length}×</Badge>}
      </div>
      {p ? (
        <>
          <p className="m-0 mt-1 text-[13.5px] text-ink" data-testid="penerimaan-ringkas">Diterima oleh <b>{p.receivedBy?.name || "petugas"}</b> · {waktuWib(p.receivedAt)} · lokasi <b>{p.location?.code}</b>{p.note ? <span className="text-ink3"> — “{p.note}”</span> : null}</p>
          {p.koreksi.length > 0 && (
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12px] text-ink2" data-testid="penerimaan-koreksi">
              {p.koreksi.map((k) => <li key={k.id}>{teksKoreksi(k)}</li>)}
            </ul>
          )}
          {boleh && <Button variant="secondary" size="sm" className="bh-pilih mt-3 min-h-[44px]" data-testid="koreksi-buka" onClick={() => { setOk(""); setBuka(true); }}>Koreksi penerimaan</Button>}
        </>
      ) : (
        <p className="m-0 mt-1 text-[13px] text-ink2" data-testid="penerimaan-dibatalkan">Belum ada penerimaan yang berlaku. Penerimaan sebelumnya dinyatakan <b>belum diterima fisik</b>.</p>
      )}
      {batal.length > 0 && (
        <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12px] text-ink3" data-testid="penerimaan-lama">
          {batal.map((r) => <li key={r.id}>Dulu dicatat diterima oleh {r.receivedBy?.name || "petugas"} · {waktuWib(r.receivedAt)} · {r.location?.code} — {r.koreksi.filter((k) => k.jenis === "NOT_RECEIVED").map(teksKoreksi).join(" ")}</li>)}
        </ul>
      )}
      {ok && <p role="status" data-testid="koreksi-ok" className="m-0 mt-3 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />{ok}</p>}
      {buka && <KoreksiPenerimaanModal unit={{ unitId: u.id, unitCode: u.unitCode }} onClose={() => setBuka(false)} onDone={async (pesan) => { setBuka(false); setOk(pesan); await onDone(); }} />}
    </section>
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
  const [konf, setKonf] = useState(false); // konfirmasi sebelum menyimpan status yang menyatakan pekerjaan sudah dilakukan
  const simpanRef = useRef(false); // klik ganda: hanya satu permintaan
  const kunci = km.dikunciAplikasi;
  const perluCatatan = kerja === "TERTUNDA";

  async function simpanKerja() {
    if (simpanRef.current) return; simpanRef.current = true;
    setSibuk("kerja"); setHKerja({ galat: null, ok: "" });
    try { const r = await api.postStatusKerjaManual(u.id, { status: kerja, note: catatan.trim() || undefined, expectedLatestId: km.terakhirId }); setKonf(false); setHKerja({ galat: null, ok: r.dicatat ? "Status kerja dicatat manual (bukan dari pemakaian bahan). Tidak ada stok, tahap, foto, QC, Run, atau jurnal yang dibuat." : "Sudah sama dengan catatan terakhir — tidak ada yang berubah." }); setCatatan(""); await onDone(); } catch (e) { setKonf(false); setHKerja({ galat: e, ok: "" }); } finally { setSibuk(""); simpanRef.current = false; }
  }
  const perluKonf = KERJA_PERLU_KONFIRMASI.includes(kerja);
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
              <p className="m-0 text-[12.5px] text-ink3">Untuk Admin yang belum memakai aplikasi Meja. Pilih “Sudah dikerjakan” hanya bila pekerjaannya memang sudah dilakukan (boleh tanpa bahan baru). Hanya mencatat status — tidak membuat stok, tahap, foto, QC, Run, atau jurnal.</p>
              <label className="block space-y-1"><span className={label}>Catat status kerja</span>
                <select value={kerja} onChange={(e) => { setKerja(e.target.value); setKonf(false); }} disabled={!izin.statusKerja || !aktif || !!sibuk} data-testid="kerja-pilih" className={field}>
                  {km.nilaiBoleh.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
                </select></label>
              <label className="block space-y-1"><span className={label}>Catatan {perluCatatan ? "(wajib untuk Tertunda)" : "(opsional)"}</span>
                <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} disabled={!izin.statusKerja || !aktif || !!sibuk} data-testid="kerja-catatan" placeholder={perluCatatan ? "Mis. menunggu kain dari supplier" : "Tambahkan catatan singkat"} className={field} /></label>
              {izin.statusKerja && aktif
                ? <Button className="min-h-[44px]" data-testid="kerja-simpan" disabled={!!sibuk || konf || (perluCatatan && catatan.trim().length < 3)} onClick={() => (perluKonf ? setKonf(true) : simpanKerja())}>{sibuk === "kerja" ? "Menyimpan…" : labelCatatKerja(kerja)}</Button>
                : <p className="m-0 text-[12.5px] text-ink3">{!aktif ? "Unit sudah selesai/dibatalkan." : "Akun Anda hanya bisa melihat."}</p>}
            </>
          )}
        {konf && perluKonf && <KonfirmasiKerja status={kerja} unitCode={u.unitCode} sibuk={!!sibuk} onYa={simpanKerja} onBatal={() => setKonf(false)} />}
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
          {ad.orderSales && <p className="m-0 text-[12.5px] text-ink2" data-testid="order-saat-ini">Status order saat ini: <b className="text-ink">{ad.orderSales.label}</b>{ad.orderSales.terkunci ? " (dikunci manual)" : ""}.</p>}
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
// Perbandingan rencana vs aktual (bila ada rencana) + komponen BERSAMA PemakaianAktualBagian (tiga sumber selalu terlihat: Bahan dari Gudang · Bahan belum ada di katalog · Komponen lama dari kasur ini;
// sama dengan tab Bahan Ruang Kerja Unit). Bahan dari Gudang = stok berkurang tepat sekali; belum ada di katalog = pemakaian sementara + usulan (perlu rekonsiliasi Gudang, stok/biaya/jurnal tidak berubah).
function PemakaianAktual({ data, aktif, onDone, onMulai }) {
  const { perbandingan, unit: u } = data;
  return (
    <div className="space-y-4" data-testid="pemakaian-aktual">
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
      <PemakaianAktualBagian unitId={u.id} data={data} izin={data.izin || {}} aktif={aktif} onDone={onDone} onMulai={onMulai} tanpaJudul />
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

// Dipakai ulang oleh Ruang Kerja Unit (features/production/workspace) — satu sumber tampilan untuk bagian yang sama.
export { Kosong, Bagian, Status3, TindakanUtama, Hasil, StatusTarget, PemakaianAktual, Riwayat, KartuPenerimaan };
