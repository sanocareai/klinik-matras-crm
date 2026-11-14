import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { wadahPortal } from "@/features/production/rencana/rencanaModel.js";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import UnitWorkspace from "@/features/production/workspace/UnitWorkspace.jsx";
import { jalurUnit } from "@/features/production/workspace/workListModel.js";
import { useTabs } from "@/lib/TabsContext.jsx";
import { IK, PEGAS } from "@/features/production/rencana/KartuUnit.jsx";
import "@/features/production/rencana/rencana.css";

// PANEL PROFIL UNIT — dipakai SEMUA halaman Produksi (Rencana Produksi, Order Produksi, Papan Meja, Quality Control, Planner): panel geser dari kanan (desktop) /
// lembar dari bawah (HP) yang memuat profil unit yang SAMA (UnitWorkspace) — satu sumber perilaku, tanpa salinan logika. `buka` = { unitId, bagian } atau null.
// `aksiHalaman` = tombol khusus halaman pemanggil di kepala profil (mis. "Putusan QC", "Kelola Jadwal"). Esc / klik latar / tombol tutup menutup.
export default function PanelUnit({ buka, onBagian, onClose, onChanged, onBukaTab, aksiHalaman = null, fokusKelengkapan = false }) {
  const panelRef = useRef(null); const pemicuRef = useRef(null);
  const { openInActiveTab } = useTabs();
  useEffect(() => {
    if (!buka) return undefined;
    pemicuRef.current = document.activeElement;
    const esc = (e) => { if (e.key === "Escape" && !document.querySelector("[role=dialog][data-state=open], .prod-pop")) onClose(); };
    // capture: dibaca SEBELUM Radix menutup dialog di atasnya — Esc pada formulir (Catat bahan, foto, dll.) hanya menutup formulir itu, bukan profil.
    document.addEventListener("keydown", esc, true); document.body.classList.add("rc-panel-terbuka");
    return () => { document.removeEventListener("keydown", esc, true); document.body.classList.remove("rc-panel-terbuka"); pemicuRef.current?.focus?.({ preventScroll: true }); };
  }, [!!buka, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const sempit = typeof window !== "undefined" && window.innerWidth < 768;
  const bukaTab = (id, b) => { if (onBukaTab) { onBukaTab(id, b); return; } onClose(); openInActiveTab(jalurUnit(id, b), { title: "Profil Unit" }); };
  return createPortal(
    <AnimatePresence>
      {buka && (
        <motion.div key="latar" className="rc-panel-latar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} data-testid="panel-unit-latar">
          <motion.aside ref={panelRef} role="dialog" aria-modal="true" aria-label="Profil unit" data-testid="panel-unit"
            className={`rc-panel${sempit ? " lembar" : ""}`} onClick={(e) => e.stopPropagation()}
            initial={sempit ? { y: "100%" } : { x: "100%" }} animate={sempit ? { y: 0 } : { x: 0 }} exit={sempit ? { y: "100%" } : { x: "100%" }} transition={PEGAS}>
            <div className="rc-panel-alat">
              {sempit && <span className="rc-panel-pegangan" aria-hidden />}
              <button type="button" className="rc-panel-tombol" onClick={() => bukaTab(buka.unitId, buka.bagian)} data-testid="panel-unit-tab"><ExternalLink {...IK} size={15} aria-hidden /> Buka di tab sendiri</button>
              <button type="button" className="rc-panel-tombol bulat" onClick={onClose} aria-label="Tutup profil unit" data-testid="panel-unit-tutup"><X {...IK} size={18} aria-hidden /></button>
            </div>
            <div className="rc-panel-isi">
              <UnitWorkspace unitId={buka.unitId} bagian={buka.bagian} onBagian={onBagian} onChanged={onChanged} aksiHalaman={aksiHalaman} fokusKelengkapan={fokusKelengkapan} />
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>, wadahPortal());
}
