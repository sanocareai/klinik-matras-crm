import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { wadahPortal } from "@/features/production/rencana/rencanaModel.js";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import UnitWorkspace from "@/features/production/workspace/UnitWorkspace.jsx";
import { IK, PEGAS } from "@/features/production/rencana/KartuUnit.jsx";

// RUANG KERJA UNIT DI DALAM RENCANA PRODUKSI (permintaan Owner 12 Nov 2026: semua dikerjakan dari satu tab). Panel geser dari kanan (desktop) / lembar dari bawah (HP)
// memuat komponen ruang kerja yang SAMA dengan halaman unit (Ringkasan · Pekerjaan · Bahan · Dokumentasi · Riwayat) — satu sumber perilaku, tanpa salinan logika.
// Perubahan di panel memuat ulang kalender & antrean (onChanged). Esc / klik latar / tombol tutup menutup; "Buka di tab sendiri" tetap tersedia.
export default function PanelUnit({ buka, onBagian, onClose, onChanged, onBukaTab }) {
  const panelRef = useRef(null); const pemicuRef = useRef(null);
  useEffect(() => {
    if (!buka) return undefined;
    pemicuRef.current = document.activeElement;
    const esc = (e) => { if (e.key === "Escape" && !document.querySelector("[role=dialog][data-state=open], .prod-pop")) onClose(); };
    document.addEventListener("keydown", esc); document.body.classList.add("rc-panel-terbuka");
    return () => { document.removeEventListener("keydown", esc); document.body.classList.remove("rc-panel-terbuka"); pemicuRef.current?.focus?.({ preventScroll: true }); };
  }, [!!buka, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const sempit = typeof window !== "undefined" && window.innerWidth < 768;
  return createPortal(
    <AnimatePresence>
      {buka && (
        <motion.div key="latar" className="rc-panel-latar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} data-testid="panel-unit-latar">
          <motion.aside ref={panelRef} role="dialog" aria-modal="true" aria-label="Ruang kerja unit" data-testid="panel-unit"
            className={`rc-panel${sempit ? " lembar" : ""}`} onClick={(e) => e.stopPropagation()}
            initial={sempit ? { y: "100%" } : { x: "100%" }} animate={sempit ? { y: 0 } : { x: 0 }} exit={sempit ? { y: "100%" } : { x: "100%" }} transition={PEGAS}>
            <div className="rc-panel-alat">
              {sempit && <span className="rc-panel-pegangan" aria-hidden />}
              <button type="button" className="rc-panel-tombol" onClick={() => onBukaTab(buka.unitId, buka.bagian)} data-testid="panel-unit-tab"><ExternalLink {...IK} size={15} aria-hidden /> Buka di tab sendiri</button>
              <button type="button" className="rc-panel-tombol bulat" onClick={onClose} aria-label="Tutup ruang kerja unit" data-testid="panel-unit-tutup"><X {...IK} size={18} aria-hidden /></button>
            </div>
            <div className="rc-panel-isi">
              <UnitWorkspace unitId={buka.unitId} bagian={buka.bagian} onBagian={onBagian} onKembali={onClose} labelKembali="Rencana" onChanged={onChanged} />
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>, wadahPortal());
}
