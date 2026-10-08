import React, { useEffect, useState } from "react";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan, tanggalPendek } from "@/features/finance/shared.jsx";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { api } from "@/api.js";
import { PILIHAN_TERMIN, LABEL_SUMBER_TERMIN, galatTermin } from "@/features/finance/terminLogic.js";

// Termin & jatuh tempo pada formulir faktur/PO. Default dihitung SERVER dari master supplier (atau snapshot PO): jatuh tempo = tanggal faktur + hari termin.
// Mengganti dari default butuh admin keuangan + alasan (server menegakkan); supplier tanpa termin / tanggal khusus: tanggal diisi biasa tanpa alasan.
// `value` = { ganti, pilihan, dueDate, alasan } (lihat TERMIN_AWAL di terminLogic.js).
export default function TerminFaktur({ supplierId, purchaseOrderId = null, tanggalFaktur = "", value, onChange, mode = "faktur" }) {
  const [pr, setPr] = useState(null);
  const [galat, setGalat] = useState("");
  const admin = adminSaatIni();
  useEffect(() => {
    if (!supplierId) { setPr(null); return undefined; }
    let batal = false;
    api.pratinjauTermin({ supplierId, purchaseOrderId: purchaseOrderId || undefined, billDate: tanggalFaktur || undefined })
      .then((r) => { if (!batal) { setPr(r); setGalat(""); } })
      .catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat termin"); });
    return () => { batal = true; };
  }, [supplierId, purchaseOrderId, tanggalFaktur]);

  if (!supplierId) return null;
  const set = (patch) => onChange({ ...value, ...patch });
  const perluTanggal = !!pr && pr.perluTanggal;
  const bolehGanti = admin || (mode === "faktur" && perluTanggal);
  const lokal = galatTermin(value, { perluTanggal });

  return (
    <div className="space-y-2 rounded-lg bg-inset px-3 py-2.5" data-testid="termin-faktur">
      <p className="m-0 text-[12.5px] text-ink2" data-testid="termin-ringkas">
        {galat ? <span className="text-red">{galat}</span> : !pr ? "Memuat termin…" : pr.ada
          ? <>Termin <strong className="text-ink">{pr.label}</strong> ({LABEL_SUMBER_TERMIN[pr.sumber] ?? pr.sumber}){pr.dueDate ? <> — jatuh tempo <strong className="text-ink">{tanggalPendek(pr.dueDate)}</strong> (tanggal faktur + {pr.hari ?? 0} hari)</> : <> — isi tanggal jatuh tempo di bawah</>}</>
          : <>Supplier ini belum punya termin. Isi tanggal jatuh tempo bila ada; kosong = <strong className="text-ink">Tanggal jatuh tempo belum diisi</strong>.</>}
      </p>
      {mode === "faktur" && pr?.sumber === "PO" && <p className="m-0 text-[11.5px] text-ink3">Termin mengikuti snapshot PO, bukan perubahan master supplier setelahnya.</p>}
      {pr && !perluTanggal && !admin && <p className="m-0 text-[11.5px] text-ink3">Hanya admin keuangan yang dapat mengganti termin atau tanggal jatuh tempo dari default supplier.</p>}
      {pr && bolehGanti && (
        <>
          {!perluTanggal && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input type="checkbox" checked={!!value.ganti} onChange={(e) => set({ ganti: e.target.checked })} /> Ganti termin / tanggal jatuh tempo (wajib alasan)
            </label>
          )}
          {(value.ganti || perluTanggal) && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {mode === "faktur" || admin ? (
                <Field label="Termin baru">
                  <Pilihan value={value.pilihan} onChange={(v) => set({ ganti: true, pilihan: v })} aria-label="Termin baru">
                    {PILIHAN_TERMIN.map((p) => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
                  </Pilihan>
                </Field>
              ) : null}
              {mode === "faktur" && (
                <Field label="Tanggal jatuh tempo" hint={value.pilihan && value.pilihan !== "TANGGAL_KHUSUS" ? "Dihitung dari termin baru" : "Isi bila tanggal khusus"}>
                  <Input type="date" min={tanggalFaktur || undefined} value={value.dueDate} disabled={!!value.pilihan && value.pilihan !== "TANGGAL_KHUSUS"} onChange={(e) => set({ ganti: !perluTanggal || value.ganti, dueDate: e.target.value })} aria-label="Tanggal jatuh tempo" />
                </Field>
              )}
              {value.ganti && (
                <Field label="Alasan" required><Input value={value.alasan} onChange={(e) => set({ alasan: e.target.value })} placeholder="mis. nego dengan supplier" aria-label="Alasan ganti termin" /></Field>
              )}
            </div>
          )}
          {lokal && <p role="alert" className="m-0 text-[12px] text-orange" data-testid="galat-termin">{lokal}</p>}
        </>
      )}
    </div>
  );
}
