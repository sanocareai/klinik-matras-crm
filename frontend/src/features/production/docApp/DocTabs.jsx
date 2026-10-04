import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, Loader2, Search } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { DraftPanel } from "@/features/production/DocumentationDraftUi.jsx";
import {
  DOC_FILTERS, DOC_GROUP_KEYS, DOC_GROUP_LABEL, DOC_STATUS, docFriendlyError, docStatusChip, missingTotal, sortForCamera,
} from "@/features/production/documentation.js";
import { AkunTab } from "@/features/production/workerApp/Tabs.jsx";
import DocUnitCard from "./DocUnitCard.jsx";
import { SafeImage } from "./DocUi.jsx";
import "./doc-app.css";

// Tab-tab Aplikasi Dokumentasi (P12D): Unit (antrean), Kamera (unit -> kategori -> ambil foto), Draf (antrean kirim IndexedDB yang sudah ada), Akun.
// Tidak ada store media/antrean upload baru: Kamera dan Unit membuka CaptureSheet + draf manager yang SAMA.
const SearchBox = ({ value, onChange, testid }) => (
  <div className="relative">
    <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Cari customer, resi, atau kode unit" placeholder="Cari customer, resi, atau kode unit"
      className="min-h-[50px] w-full rounded-[16px] border border-line bg-surface pl-10 pr-3 text-[15px] text-ink" data-testid={testid} />
  </div>
);

export function UnitTab({ data, items, loading, filter, onFilter, q, onQ, onOpen, qDebounced }) {
  return (
    <div data-testid="tab-unit">
      <h1 className="wa-h1 mb-3">Unit</h1>
      <div className="space-y-3">
        <SearchBox value={q} onChange={onQ} testid="doc-search" />
        <div role="tablist" aria-label="Saring antrean dokumentasi" className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-1" data-testid="doc-filters">
          {DOC_FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => onFilter(f.key)} data-filter={f.key}
              className={`flex min-h-[42px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-3.5 text-[13.5px] font-bold ${filter === f.key ? "bg-accent text-white" : "bg-surface text-ink2 shadow-sm"}`}>
              {f.label}<span className={`rounded-chip px-1.5 text-[11px] tabular-nums ${filter === f.key ? "bg-white/25" : "bg-inset text-ink3"}`}>{data?.counts?.[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        {loading && !data ? (
          <div className="wa-grid">{[1, 2, 3].map((n) => <div key={n} className="h-72 animate-pulse rounded-card bg-inset" />)}</div>
        ) : data?.readerMode === "OFF" ? (
          <div className="wa-card p-8 text-center" data-testid="doc-reader-off"><Camera className="mx-auto mb-2 text-ink3" size={32} aria-hidden /><p className="m-0 font-bold text-ink">Produksi V2 belum aktif</p><p className="m-0 mt-1 text-[13.5px] text-ink3">Antrean dokumentasi terisi setelah Production V2 diaktifkan untuk unit terkait.</p></div>
        ) : items.length === 0 ? (
          <div className="wa-card p-8 text-center" data-testid="doc-empty"><CheckCircle2 className="mx-auto mb-2 text-green" size={32} aria-hidden />
            <p className="m-0 font-bold text-ink">{qDebounced || filter !== "ALL" ? "Tidak ada unit yang cocok" : "Belum ada unit untuk didokumentasikan"}</p>
            <p className="m-0 mt-1 text-[13.5px] text-ink3">{qDebounced || filter !== "ALL" ? "Ubah kata kunci atau saringan." : "Unit cohort Produksi V2 akan muncul di sini."}</p></div>
        ) : (
          <div className="wa-grid" data-testid="doc-list">{items.map((item) => <DocUnitCard key={item.runId} item={item} onOpen={onOpen} />)}</div>
        )}
      </div>
    </div>
  );
}

// Kamera: unit (yang paling butuh foto dulu) -> kategori -> sheet kamera/galeri. Detail diminta ke server (kategori, minimum, kekurangan).
export function KameraTab({ items, readerMode, canWrite, onCapture }) {
  const [q, setQ] = useState("");
  const [runId, setRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async (id) => {
    setDetail(null); setError("");
    try { setDetail(await api.getProductionV2DocDetail(id)); } catch (e) { setError(docFriendlyError(e)); }
  }, []);
  useEffect(() => { if (runId) load(runId); }, [runId, load]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle ? items.filter((i) => [i.customerName, i.orderNumber, i.unit.unitCode].some((v) => String(v || "").toLowerCase().includes(needle))) : items;
    return sortForCamera(rows);
  }, [items, q]);

  return (
    <div data-testid="tab-kamera" className="mx-auto max-w-[640px]">
      <h1 className="wa-h1 mb-1">Kamera</h1>
      <p className="m-0 mb-4 text-[14px] text-ink3">{runId ? "Pilih kategori foto, lalu ambil foto atau pilih dari galeri." : "Pilih unit yang akan difoto. Unit yang paling kurang dokumentasinya di atas."}</p>
      {readerMode === "OFF" && <div className="wa-card p-6 text-center text-[14px] text-ink3" data-testid="kamera-reader-off">Produksi V2 belum aktif — belum ada unit untuk difoto.</div>}
      {!runId && readerMode !== "OFF" && (
        <div className="space-y-3">
          <SearchBox value={q} onChange={setQ} testid="kamera-search" />
          {!canWrite && <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="kamera-readonly">Anda hanya bisa melihat dokumentasi — pengiriman foto memerlukan izin dokumentasi.</p>}
          {list.length === 0 ? <div className="wa-card p-6 text-center text-[14px] text-ink3" data-testid="kamera-empty">Tidak ada unit yang cocok.</div> : (
            <div className="wa-card divide-y divide-line" data-testid="kamera-units">
              {list.map((it) => {
                const chip = docStatusChip(it); const miss = missingTotal(it.docs?.missing);
                return (
                  <button key={it.runId} type="button" className="da-row" onClick={() => setRunId(it.runId)} data-testid="kamera-unit" data-unit-code={it.unit.unitCode} data-run-id={it.runId}>
                    <SafeImage src={it.unit.photoUrl} className="shrink-0 rounded-btn object-cover" size={56} alt="" />
                    <span className="min-w-0 flex-1">
                      <span className="wa-wrap block text-[15px] font-extrabold text-ink">{it.customerName || "Customer"}</span>
                      <span className="wa-wrap block text-[12.5px] text-ink3">Resi {it.orderNumber || "—"} · {it.unit.unitCode}</span>
                    </span>
                    <Badge variant={chip.tone === "red" ? "red" : chip.tone === "green" ? "green" : chip.tone === "accent" ? "accent" : "neutral"}>{miss > 0 ? `Kurang ${miss}` : chip.label}</Badge>
                    <ChevronRight size={18} className="shrink-0 text-ink3" aria-hidden />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {runId && (
        <div className="space-y-3" data-testid="kamera-step2">
          <button type="button" onClick={() => { setRunId(null); setDetail(null); }} className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-bold text-accent" data-testid="kamera-back"><ArrowLeft size={16} aria-hidden /> Pilih unit lain</button>
          {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red"><span>{error}</span><button type="button" onClick={() => load(runId)} className="shrink-0 font-bold underline">Coba lagi</button></div>}
          {!detail && !error && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" size={26} aria-hidden /></div>}
          {detail && (
            <>
              <div className="wa-card p-4"><p className="wa-wrap m-0 text-[17px] font-extrabold text-ink" data-testid="kamera-unit-title">{detail.customerName || "Customer"} · {detail.unit.unitCode}</p><p className="m-0 mt-0.5 text-[12.5px] text-ink3">Resi {detail.orderNumber || "—"} · Dokumentasi {detail.totals.satisfied}/{detail.totals.required} foto</p></div>
              {!detail.canWrite && <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="kamera-readonly">Anda hanya bisa melihat dokumentasi unit ini (tanpa izin mengirim, atau Produksi V2 belum aktif untuk unit ini).</p>}
              {DOC_GROUP_KEYS.map((g) => {
                const cats = detail.categories.filter((c) => c.group === g);
                if (!cats.length) return null;
                return (
                  <div key={g}>
                    <h2 className="mb-2 mt-1 text-[13px] font-extrabold uppercase tracking-wide text-ink3">{DOC_GROUP_LABEL[g]}</h2>
                    <div className="wa-card divide-y divide-line">
                      {cats.map((c) => {
                        const st = DOC_STATUS[c.status] || DOC_STATUS.MENUNGGU;
                        return (
                          <button key={c.key} type="button" className="da-cat-btn" disabled={!c.applicable || !detail.canWrite} onClick={() => onCapture(detail, c)} data-testid="kamera-category" data-mutates data-category={c.key}>
                            <span className="min-w-0"><span className="wa-wrap block text-[15px] font-bold">{c.label}</span><span className="block text-[12px] tabular-nums text-ink3">{c.count} / min {c.min} foto{c.status === "KURANG" ? ` · kurang ${c.missing}` : ""}</span></span>
                            <span className="flex shrink-0 items-center gap-2"><Badge variant={st.variant}>{st.label}</Badge>{c.applicable && detail.canWrite && <Camera size={18} className="text-accent" aria-hidden />}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const countBy = (records, status) => records.filter((r) => r.status === status).length;

export function DrafTab({ drafts, onResume, purgeNote, onDismissPurge }) {
  const { manager, records, online, persistent, summary } = drafts;
  const purged = summary && (summary.foreign + summary.corrupt + summary.schema > 0 || summary.reset);
  return (
    <div data-testid="tab-draf" className="mx-auto max-w-[640px] space-y-3">
      <h1 className="wa-h1 mb-1">Draf</h1>
      <p className="m-0 text-[14px] text-ink3">Foto yang tersimpan di HP ini: draf, antre kirim, sedang dikirim, atau gagal. Terkirim otomatis saat online.</p>
      {!persistent && <div role="status" className="rounded-btn bg-orangebg px-3 py-3 text-[13px] text-orange" data-testid="no-persist">Penyimpanan offline tidak tersedia di browser ini (mis. mode privat). Foto hanya tersimpan selama halaman terbuka — kirim sebelum menutup.</div>}
      {purged && purgeNote && <div role="status" className="flex items-start justify-between gap-2 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="purge-note"><span>Draf lama dari pengguna lain atau yang rusak sudah dibersihkan dari HP ini.</span><button type="button" onClick={onDismissPurge} aria-label="Tutup pemberitahuan" className="shrink-0 font-bold text-ink3">Tutup</button></div>}
      <div className="grid grid-cols-4 gap-2 text-center" data-testid="draft-counts">
        {[["Draf", "DRAFT"], ["Antre", "QUEUED"], ["Mengirim", "SENDING"], ["Gagal", "FAILED"]].map(([label, st]) => (
          <div key={st} className="wa-card px-1 py-3"><p className="m-0 text-[20px] font-extrabold tabular-nums text-ink" data-count={st}>{countBy(records, st)}</p><p className="m-0 text-[11.5px] font-semibold text-ink3">{label}</p></div>
        ))}
      </div>
      {manager ? <DraftPanel manager={manager} records={records} online={online} onResume={onResume} showEmpty /> : <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={24} aria-hidden /></div>}
    </div>
  );
}

export function DocAkun({ user, roles, pathname, onLogout, navigate, drafts }) {
  const extra = (
    <>
      <h2 className="mb-2 mt-5 text-[13px] font-extrabold uppercase tracking-wide text-ink3">Penyimpanan di HP</h2>
      <div className="wa-card divide-y divide-line" data-testid="akun-storage">
        <div className="flex min-h-[56px] items-center justify-between gap-3 px-4"><span className="text-[15px] font-semibold text-ink">Koneksi</span><Badge variant={drafts.online ? "green" : "orange"}>{drafts.online ? "Online" : "Offline"}</Badge></div>
        <div className="flex min-h-[56px] items-center justify-between gap-3 px-4"><span className="text-[15px] font-semibold text-ink">Simpanan offline</span><Badge variant={drafts.persistent ? "green" : "orange"}>{drafts.persistent ? "Aktif (IndexedDB)" : "Tidak tersedia"}</Badge></div>
        <div className="flex min-h-[56px] items-center justify-between gap-3 px-4"><span className="text-[15px] font-semibold text-ink">Draf menunggu</span><span className="text-[15px] font-extrabold tabular-nums text-ink" data-testid="akun-draft-count">{drafts.records.length}</span></div>
      </div>
      <p className="mt-2 text-[12px] text-ink3">Keluar menghapus draf milik akun ini dari HP supaya tidak terbaca pengguna berikutnya.</p>
    </>
  );
  return <AkunTab user={user} roles={roles} lane={null} currentKey="dokumentasi" pathname={pathname} onLogout={onLogout} navigate={navigate} extra={extra} onLeave={drafts.confirmLeave} />;
}
