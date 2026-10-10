import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { friendlyError } from "@/features/production/experience.js";

// Aktivasi Rencana — BACA-SAJA. Daftar unit order nyata (Diproses/Pengambilan) beserta kelayakan dan pengecualiannya, plus perintah aktivasi yang KONKRET. Halaman ini tidak
// pernah mengubah cohort/flag: aktivasi adalah keputusan Owner yang dijalankan lewat skrip (dry-run bawaan, --apply butuh backup).
export const ACTION_LABEL = Object.freeze({
  SCHEDULE: ["Siap dijadwalkan", "green"], ONBOARD_SCHEDULE: ["Siap dijadwalkan", "green"], AWAIT_ACTIVATION: ["Menunggu aktivasi Owner", "orange"], WAIT_PICKUP: ["Belum diambil", "neutral"], EXCEPTION: ["Pengecualian", "red"],
});

export function activationCommand(units) {
  const codes = (units || []).filter((u) => u.action === "AWAIT_ACTIVATION").map((u) => u.unitCode);
  return codes.length ? `RENCANA_BACKUP_OK=1 node scripts/production-delivery-v2/activate-rencana-units.js --unit-codes=${codes.join(",")} --apply` : null;
}

export default function RencanaActivationModal({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getRencanaEligibility().then((r) => { if (alive) setData(r); }).catch((e) => { if (alive) setError(e?.status === 403 ? "Daftar aktivasi hanya untuk Admin, Owner, dan Kepala Produksi." : friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  const cmd = data ? activationCommand(data.units) : null;
  const exceptions = (data?.units || []).filter((u) => u.action === "EXCEPTION" || u.action === "WAIT_PICKUP");
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Aktivasi Rencana Produksi" description="Unit order nyata mana yang eligible, mana yang menunggu keputusan Owner, dan mana yang dikecualikan beserta alasannya." className="w-[760px]">
      <div className="space-y-3 px-6 pb-4" data-testid="activation-panel">
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
        {!data && !error && <p className="text-[12.5px] text-ink3">Memuat…</p>}
        {data && (
          <>
            <p className="m-0 text-[12.5px] text-ink2" data-testid="activation-cohort">Unit yang sudah diaktifkan untuk Rencana Produksi: <b>{data.cohort.writer.size}</b> unit (writer) · <b>{data.cohort.reader.size}</b> unit (reader). {data.cohort.writer.diagnostic || data.cohort.reader.diagnostic ? "Konfigurasi cohort tidak sah — hubungi tim sistem." : "Menambah unit TIDAK terjadi otomatis."}</p>
            <div className="flex flex-wrap gap-1.5" data-testid="activation-summary">
              {Object.entries(data.summary.byAction).map(([k, n]) => <Badge key={k} variant={ACTION_LABEL[k]?.[1] || "neutral"}>{ACTION_LABEL[k]?.[0] || k}: {n}</Badge>)}
            </div>
            <div className="max-h-[320px] overflow-auto rounded-btn border border-line">
              <table className="w-full text-[12px]" data-testid="activation-table">
                <thead className="sticky top-0 bg-inset text-ink3"><tr><th className="px-2 py-1.5 text-left font-medium">Unit</th><th className="px-2 py-1.5 text-left font-medium">Pelanggan</th><th className="px-2 py-1.5 text-left font-medium">Keadaan</th></tr></thead>
                <tbody>
                  {data.units.map((u) => (
                    <tr key={u.unitId} className="border-t border-line align-top" data-action={u.action} data-code={u.code || ""}>
                      <td className="px-2 py-1.5 font-semibold text-ink">{u.unitCode}<br /><span className="font-normal text-ink3">{u.orderNumber}</span></td>
                      <td className="px-2 py-1.5 text-ink2">{u.customerName || "—"}</td>
                      <td className="px-2 py-1.5"><Badge variant={ACTION_LABEL[u.action]?.[1] || "neutral"}>{ACTION_LABEL[u.action]?.[0] || u.action}</Badge><br /><span className="text-ink3">{u.message}</span></td>
                    </tr>
                  ))}
                  {data.units.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-center text-ink3">Tidak ada unit order nyata yang berstatus Diproses/Pengambilan.</td></tr>}
                </tbody>
              </table>
            </div>
            {exceptions.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="activation-exceptions">{exceptions.length} unit dikecualikan/menunggu — alasannya tertulis di tabel; tidak bisa diaktifkan lewat skrip sebelum alasannya selesai.</p>}
            <div className="space-y-1 rounded-btn bg-inset p-3" data-testid="activation-howto">
              <p className="m-0 text-[12.5px] font-semibold text-ink">Cara mengaktifkan (Owner / tim sistem)</p>
              <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[12px] text-ink2">
                <li>Pastikan backup database terbaru ada.</li>
                <li>Jalankan <b>dry-run</b> dulu (tanpa <code>--apply</code>) untuk melihat perubahan daftar unit aktif.</li>
                <li>Jalankan dengan <code>--apply</code> — unit menjadi dapat dijadwalkan; pekerjaan produksi (belum tiba) baru dibuka saat tombol Jadwalkan ditekan.</li>
              </ol>
              {cmd ? <pre className="m-0 mt-1 overflow-x-auto whitespace-pre-wrap rounded-btn bg-surface p-2 text-[11.5px] text-ink" data-testid="activation-command">{cmd}</pre> : <p className="m-0 text-[12px] text-ink3">Tidak ada unit yang menunggu aktivasi saat ini.</p>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
