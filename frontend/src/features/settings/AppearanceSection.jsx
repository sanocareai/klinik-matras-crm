import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { cn } from "@/lib/utils.js";
import { Card, CardTitle, CardDescription } from "@/components/ui/card.jsx";

const OPSI = [
  { key: "light",  label: "Terang", Icon: Sun,     ket: "Selalu terang" },
  { key: "dark",   label: "Gelap",  Icon: Moon,    ket: "Selalu gelap" },
  { key: "system", label: "Sistem", Icon: Monitor, ket: "Ikuti perangkat" },
];

// Pratinjau mini — miniatur halaman: base → surface → inset + satu accent.
// Sengaja memakai token yang SAMA dengan app, jadi ini pratinjau sungguhan,
// bukan gambar statis: begitu tema diganti, kotak ini langsung berubah.
function Pratinjau() {
  return (
    <div className="rounded-btn bg-base p-3" aria-hidden="true">
      <div className="rounded-chip bg-surface p-2.5 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-12 rounded-full bg-accent" />
          <div className="h-1.5 w-6 rounded-full bg-line" />
        </div>
        <div className="mt-2 rounded-chip bg-inset p-2">
          <div className="h-1.5 w-16 rounded-full bg-line" />
          <div className="mt-1.5 h-1.5 w-10 rounded-full bg-line" />
        </div>
      </div>
    </div>
  );
}

// Settings → Tampilan. Menulis ke localStorage lewat ThemeProvider; tidak ada
// panggilan API — preferensi tema murni per-perangkat, bukan per-akun.
export default function AppearanceSection() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <Card>
      <CardTitle>Tampilan</CardTitle>
      <CardDescription className="mb-5 mt-1">
        Pilih tema tampilan CRM. Pengaturan ini tersimpan di perangkat ini saja —
        tidak memengaruhi tampilan anggota tim lain.
      </CardDescription>

      {/* Segmented control 3 opsi */}
      <div
        role="radiogroup"
        aria-label="Tema tampilan"
        className="flex max-w-[420px] gap-1 rounded-btn bg-inset p-1"
      >
        {OPSI.map(({ key, label, Icon }) => {
          const aktif = theme === key;
          return (
            <button
              key={key}
              role="radio"
              aria-checked={aktif}
              onClick={() => setTheme(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-chip px-3 py-2",
                "text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                aktif
                  ? "bg-surface text-ink shadow-card"
                  : "bg-transparent text-ink2 hover:text-ink"
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      <p className="t-secondary mt-3">
        {theme === "system"
          ? `Mengikuti perangkat — sekarang ${resolved === "dark" ? "gelap" : "terang"}.`
          : OPSI.find((o) => o.key === theme)?.ket}
      </p>

      <div className="mt-6 max-w-[260px]">
        <p className="t-caption mb-2">Pratinjau</p>
        <Pratinjau />
      </div>
    </Card>
  );
}
