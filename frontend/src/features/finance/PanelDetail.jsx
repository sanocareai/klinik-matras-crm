// PANEL DETAIL SAMPING (sidebar kanan) untuk SEMUA daftar Finance — klik baris/kartu membuka rincian dokumen tanpa pindah halaman
// (pola yang sama dengan panel Resi/Detail Revisi: Radix Dialog di sisi kanan, layar penuh di HP).
//
//   const [detail, setDetail] = useState(null);
//   <TR {...klikBuka(() => setDetail(spec))}>…</TR>      // tabel
//   <RowCard onClick={() => setDetail(spec)} …/>          // kartu (HP)
//   <PanelDetail spec={detail} onClose={() => setDetail(null)} />
//
// `spec` = { judul, subjudul?, badge?, bagian: [{ judul?, baris: [[label, nilai], …] }], catatan?, aksi? } — dibentuk oleh fungsi spec*
// di detailSpecs.js dari data baris yang SUDAH dimuat daftar (tanpa panggilan API tambahan). Nilai kosong (null/""/undefined) tidak ditampilkan.

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const kosong = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Properti untuk <TR>: baris jadi bisa diklik. Klik pada tombol/tautan/kolom isian/menu di dalam baris TIDAK membuka panel, begitu pula
 * peristiwa yang "menggelembung" dari dialog/menu yang dibuka lewat portal (bukan bagian DOM baris ini).
 */
export function klikBuka(buka) {
  return {
    clickable: true,
    onClick: (e) => {
      if (!e.currentTarget.contains(e.target)) return; // peristiwa dari portal (dialog/menu) — abaikan
      if (e.target.closest("button, a, input, select, textarea, label, [role='menuitem'], [role='checkbox'], [data-tanpa-detail]")) return;
      buka();
    },
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); buka(); }
    },
    tabIndex: 0,
  };
}

export function PanelDetail({ spec, onClose }) {
  const bagian = (spec?.bagian || []).map((b) => ({ ...b, baris: (b.baris || []).filter(([, v]) => !kosong(v)) })).filter((b) => b.baris.length > 0);
  return (
    <Dialog.Root open={!!spec} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label={spec?.judul || "Detail"}
          aria-describedby={undefined}
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          {spec && (
            <>
              <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate font-mono text-[14px] font-bold text-ink">{spec.judul}</Dialog.Title>
                  {spec.subjudul && <p className="mt-0.5 break-words text-[12.5px] text-ink2">{spec.subjudul}</p>}
                </div>
                {spec.badge && <div className="shrink-0">{spec.badge}</div>}
                <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
                  <X size={16} />
                </Dialog.Close>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
                {spec.ringkas?.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {spec.ringkas.map(([label, nilai, tone], i) => (
                      <div key={label ?? i} className="rounded-lg bg-inset px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
                        <p className={`mt-0.5 break-words text-[15px] font-bold tabular-nums ${tone === "hijau" ? "text-green" : tone === "merah" ? "text-red" : tone === "oranye" ? "text-orange" : "text-ink"}`}>{nilai}</p>
                      </div>
                    ))}
                  </div>
                )}
                {bagian.map((b, i) => (
                  <section key={b.judul ?? i}>
                    {b.judul && <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink3">{b.judul}</h3>}
                    <dl className="divide-y divide-line rounded-lg border border-line">
                      {b.baris.map(([label, nilai], j) => (
                        <div key={label ?? j} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2 text-[13px]">
                          <dt className="text-ink3">{label}</dt>
                          <dd className="min-w-0 break-words text-ink">{nilai}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                {bagian.length === 0 && !(spec.ringkas?.length > 0) && <p className="text-[13px] text-ink3">Belum ada rincian untuk ditampilkan.</p>}
                {spec.catatan && <p className="rounded-lg bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2">{spec.catatan}</p>}
              </div>

              {spec.aksi && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{spec.aksi}</div>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
