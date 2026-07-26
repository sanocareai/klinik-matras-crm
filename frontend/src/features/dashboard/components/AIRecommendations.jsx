import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Divider } from "@/components/ui/divider.jsx";

// Titik severity — HANYA 3 warna semantik. `low` memakai accent (informasi),
// bukan hue keempat.
const SEV_DOT = { high: "bg-red", med: "bg-orange", low: "bg-accent" };
const SEV_LABEL = { high: "Prioritas tinggi", med: "Prioritas sedang", low: "Info" };
const SEV_BADGE = { high: "red", med: "orange", low: "accent" };

// ── Rekomendasi Sano ────────────────────────────────────────────────────────
// DS v2 (spec Step 4): dulu ini Card berisi Card berisi baris ber-border
// (3 tingkat). Sekarang SATU Card → baris dipisah HAIRLINE. Kartu putih
// bersarang, border putih, dan ikon gradient dihapus.
//
// Aksi baris memakai tombol TERTIARY (teks accent, tanpa outline) dan
// "Sembunyikan" hanya muncul saat hover — aksi itu bukan niat utama user,
// jadi tidak perlu selalu meminta perhatian.
export default function AIRecommendations({ items, loading, error, isMock }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState([]);
  const list = Array.isArray(items) ? items : [];
  const visible = list.filter((i) => i && !dismissed.includes(i.id));
  const [primary, ...rest] = visible;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="t-card-title">Rekomendasi Sano</h3>
          <p className="t-secondary">Prioritas hari ini · diperbarui otomatis</p>
        </div>
        {isMock && <Badge variant="accent">Contoh</Badge>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="h-20 animate-pulse rounded-btn bg-inset" />
          <div className="h-12 animate-pulse rounded-btn bg-inset" />
          <div className="h-12 animate-pulse rounded-btn bg-inset" />
        </div>
      ) : error ? (
        <div className="t-body flex items-center gap-2 py-4">
          <AlertTriangle size={16} className="text-orange" />
          Gagal memuat rekomendasi. Coba muat ulang.
        </div>
      ) : !primary ? (
        <div className="t-body flex items-center gap-2 py-4">
          <CheckCircle2 size={16} className="text-green" />
          Semua lead sudah ditangani, kerja bagus 👍
        </div>
      ) : (
        <div>
          {/* PRIMARY — satu-satunya tombol primary di region ini */}
          <div className="pb-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge variant={SEV_BADGE[primary.severity] || "accent"}>
                {SEV_LABEL[primary.severity] || SEV_LABEL.low}
              </Badge>
              {primary.impact && <span className="t-secondary">{primary.impact}</span>}
            </div>
            <p className="t-body font-semibold">{primary.title}</p>
            <p className="t-secondary mt-1">{primary.detail}</p>
            <div className="mt-3 flex items-center gap-1">
              <Button size="sm" onClick={() => navigate(primary.href)}>
                {primary.actionLabel} <ArrowRight size={14} />
              </Button>
              <Button variant="neutral" size="sm" onClick={() => setDismissed((d) => [...d, primary.id])}>
                Nanti saja
              </Button>
            </div>
          </div>

          {/* SISANYA — baris inset dipisah hairline, aksi tertiary */}
          {rest.length > 0 && <Divider />}
          {rest.map((r, i) => (
            <React.Fragment key={r.id}>
              {i > 0 && <Divider />}
              <div className="group flex items-center gap-3 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[r.severity] || SEV_DOT.low}`} />
                <div className="min-w-0 flex-1">
                  <p className="t-body truncate">{r.title}</p>
                  <p className="t-secondary truncate">{r.detail}</p>
                </div>
                <Button variant="tertiary" size="sm" className="shrink-0" onClick={() => navigate(r.href)}>
                  {r.actionLabel} <ArrowRight size={13} />
                </Button>
                {/* Muncul saat hover — dan tetap bisa diakses lewat keyboard
                    (focus-visible), supaya tidak jadi aksi yang mustahil
                    dijangkau tanpa mouse. */}
                <button
                  onClick={() => setDismissed((d) => [...d, r.id])}
                  aria-label="Sembunyikan"
                  className="shrink-0 rounded-chip p-1 text-ink3 opacity-0 transition-opacity hover:bg-hovertint group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X size={13} />
                </button>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </Card>
  );
}
