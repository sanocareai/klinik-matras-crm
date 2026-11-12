import React from "react";
import { createPortal } from "react-dom";
import { wadahPortal } from "@/features/production/rencana/rencanaModel.js";
import { motion } from "framer-motion";

// Kartu yang "diangkat" saat diseret: salinan visual kartu asli (bukan komponen interaktif), sedikit membesar dan berbayang; beberapa unit = tumpukan + jumlah.
// Posisi ditulis langsung oleh useSeretPointer lewat `salinanRef` (transform), animasi angkat oleh framer-motion pada elemen dalam.
export default function SalinanSeret({ seret, salinanRef, sasaran }) {
  if (!seret) return null;
  const jumlah = seret.items.length;
  return createPortal(
    <div ref={salinanRef} className="rc-salinan" aria-hidden="true" style={{ width: seret.lebar, transform: `translate3d(${seret.x}px, ${seret.y}px, 0)` }}>
      <motion.div initial={{ scale: 1, rotate: 0 }} animate={{ scale: sasaran ? 0.96 : 1.03, rotate: sasaran ? 0 : -1.2 }} transition={{ type: "spring", stiffness: 420, damping: 28 }} className="rc-salinan-isi">
        {jumlah > 1 && <span className="rc-salinan-tumpuk" />}
        <div dangerouslySetInnerHTML={{ __html: seret.html }} />
        {jumlah > 1 && <span className="rc-salinan-jumlah">{jumlah}</span>}
      </motion.div>
    </div>, wadahPortal());
}
