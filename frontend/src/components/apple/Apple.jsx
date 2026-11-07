import React, { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Primitif bahasa visual Apple bersama (styles/sanss-apple.css). Hanya tampilan: tidak ada data/logika bisnis.

/** Ubin ikon squircle bergradien. `nada`: biru|langit|ungu|oranye|hijau|merah|pink|abu|indigo|teal|kaca. children = ikon (lucide, 55% dari ukuran). */
export function Ubin({ nada = "biru", ukuran = 40, className, children }) {
  return <span className={cn("ap-ubin", `ap-ubin-${nada}`, className)} style={{ "--ap": `${ukuran}px` }} aria-hidden="true">{children}</span>;
}

/**
 * Ikon info "i" — membuka penjelasan lewat KLIK, KETUK, atau KEYBOARD (Enter/Spasi); BUKAN hover. Menutup dengan Esc, klik di luar, atau menekan ikon lagi.
 * Dipakai untuk memindahkan paragraf penjelasan keluar dari kartu/tab/judul. `label` = nama untuk pembaca layar.
 */
export function InfoI({ label, children, kiri = false, className }) {
  const [buka, setBuka] = useState(false); const id = useId(); const akar = useRef(null);
  useEffect(() => {
    if (!buka) return undefined;
    const luar = (e) => { if (!akar.current?.contains(e.target)) setBuka(false); };
    const esc = (e) => { if (e.key === "Escape") { setBuka(false); akar.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", luar); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", luar); document.removeEventListener("keydown", esc); };
  }, [buka]);
  return (
    <span className={cn("ap-i", kiri && "ap-i-kiri", className)} ref={akar}>
      <button type="button" aria-expanded={buka} aria-controls={buka ? id : undefined} aria-label={`Penjelasan: ${label}`} title={label} onClick={(e) => { e.stopPropagation(); setBuka((v) => !v); }} data-testid="ap-info">
        <Info size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {buka && <span id={id} role="note" className="ap-i-isi" data-testid="ap-info-isi">{children}</span>}
    </span>
  );
}

/** Kartu widget berwarna. `nada`: biru|langit|ungu|jingga|hijau|pink|indigo. `glif` = ikon lucide untuk ubin + ikon besar samar. `onBuka` membuat kartu dapat diklik (div role=button agar ikon info boleh di dalamnya). */
export function KartuWidget({ nada = "biru", Glif, judul, info, infoLabel, onBuka, className, testid, children }) {
  const klik = onBuka ? { role: "button", tabIndex: 0, onClick: onBuka, onKeyDown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onBuka(); } } } : {};
  return (
    <section className={cn("ap-widget", `ap-w-${nada}`, className)} data-testid={testid} aria-label={typeof judul === "string" ? judul : undefined} {...klik}>
      {Glif && <Glif size={104} className="ap-w-besar" aria-hidden="true" />}
      <header className="ap-w-kepala">
        {Glif && <Ubin nada="kaca" ukuran={34}><Glif size={19} strokeWidth={1.9} /></Ubin>}
        <h3>{judul}</h3>
        {info && <InfoI label={infoLabel ?? (typeof judul === "string" ? judul : "Info")}>{info}</InfoI>}
      </header>
      {children}
    </section>
  );
}
