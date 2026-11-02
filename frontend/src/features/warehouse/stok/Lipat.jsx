import React from "react";
import { cn } from "@/lib/utils.js";

// Bagian TERLIPAT dengan judul jelas (elemen <details> asli: bisa dibuka dengan keyboard dan sentuhan, tanpa state tambahan). Terlipat secara bawaan; isi tetap ada di DOM (data tidak dimuat ulang).
// ringkas = keterangan singkat di sebelah judul (mis. jumlah baris). Gaya: .gud-lipat (sanss-gudang.css).
export default function Lipat({ judul, ringkas = null, testid, children, className, terbuka = false }) {
  return (
    <details open={terbuka || undefined} data-testid={testid} className={cn("gud-lipat", className)}>
      <summary><span>{judul}</span>{ringkas && <span className="gud-lipat-info">{ringkas}</span>}</summary>
      <div>{children}</div>
    </details>
  );
}
