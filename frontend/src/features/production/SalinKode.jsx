import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { salinTeks } from "@/features/production/orderListModel.js";

// Tombol salin kode unit di baris daftar. Klik/Enter/Spasi pada tombol TIDAK membuka baris (propagasi dihentikan). Umpan balik "Tersalin" singkat, dibacakan lewat aria-live.
export default function SalinKode({ teks, label = "Salin kode unit" }) {
  const [ok, setOk] = useState(false); const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  async function salin(e) {
    e.stopPropagation(); e.preventDefault();
    if (await salinTeks(teks)) { setOk(true); clearTimeout(t.current); t.current = setTimeout(() => setOk(false), 1600); }
  }
  return (
    <button type="button" className="prod-salin" onClick={salin} onKeyDown={(e) => e.stopPropagation()} aria-label={`${label} ${teks}`} title={ok ? "Tersalin" : label} data-testid="salin-kode">
      {ok ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className="prod-sr" role="status" aria-live="polite">{ok ? "Kode tersalin" : ""}</span>
    </button>
  );
}
