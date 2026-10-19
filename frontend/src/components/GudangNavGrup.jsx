import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { antreanDariBeranda, bacaKelompokTerbuka, balikKelompok, bukaKelompokAktif, kelompokAktif, kelompokTerbukaAwal, simpanKelompokTerbuka } from "@/lib/gudangNav.js";
import SidebarNavSection from "./SidebarNavSection.jsx";

// Angka antrean Gudang untuk badge menu (dari GET /inventory/beranda yang sama dengan Beranda Gudang): hanya dimuat saat workspace Gudang aktif, disegarkan tiap 90 dtk dan saat tab kembali terlihat.
export function useAntreanGudang(aktif) {
  const [antrean, setAntrean] = useState(null);
  useEffect(() => {
    if (!aktif) return undefined;
    let batal = false;
    const muat = () => api.getBerandaGudang().then((b) => { if (!batal) setAntrean(antreanDariBeranda(b)); }).catch(() => { /* tanpa badge; akun tanpa izin baca Gudang tidak melihat angka */ });
    muat(); const id = setInterval(muat, 90_000); const lihat = () => { if (document.visibilityState === "visible") muat(); };
    document.addEventListener("visibilitychange", lihat);
    return () => { batal = true; clearInterval(id); document.removeEventListener("visibilitychange", lihat); };
  }, [aktif]);
  return antrean;
}

// Sidebar Gudang: enam kelompok utama; menu rinci jadi anak yang dibuka per kelompok. STATE TIAP KELOMPOK INDEPENDEN: klik judul hanya membuka/menutup kelompok itu (beberapa boleh terbuka bersamaan),
// kelompok yang berisi halaman aktif otomatis terbuka saat halaman dimuat/berpindah (tanpa menutup yang lain), dan daftar kelompok terbuka diingat per perangkat (localStorage) sehingga bertahan saat pindah halaman dan refresh.
// Mouse dan keyboard: tombol kelompok (Enter/Spasi), ↑/↓ memindahkan fokus antar menu, → membuka dan ← menutup kelompok yang difokus, Home/End ke menu pertama/terakhir.
export default function GudangNavGrup({ sections, pathname, search, allVisibleItems, onNavigate, badgeCount }) {
  const [terbuka, setTerbuka] = useState(() => kelompokTerbukaAwal({ sections, pathname, tersimpan: bacaKelompokTerbuka() }));
  const akar = useRef(null);
  const aktif = kelompokAktif(sections, pathname);
  useEffect(() => { setTerbuka((t) => bukaKelompokAktif({ sections, pathname, terbuka: t })); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps -- hanya saat berpindah halaman
  useEffect(() => { simpanKelompokTerbuka(terbuka); }, [terbuka]);

  const toggle = (nama) => setTerbuka((t) => balikKelompok(t, nama));
  const fokusan = () => [...(akar.current?.querySelectorAll("button[data-grup-kepala], a[href]") ?? [])].filter((el) => el.offsetParent !== null);
  const onKey = (e) => {
    const daftar = fokusan(); const i = daftar.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (i < 0) return; e.preventDefault(); daftar[(i + (e.key === "ArrowDown" ? 1 : -1) + daftar.length) % daftar.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); daftar[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); daftar[daftar.length - 1]?.focus(); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && document.activeElement?.dataset?.grupKepala) {
      const nama = document.activeElement.dataset.grupKepala; const buka = terbuka.includes(nama);
      if (e.key === "ArrowRight" && !buka) { e.preventDefault(); setTerbuka((t) => (t.includes(nama) ? t : [...t, nama])); } else if (e.key === "ArrowLeft" && buka) { e.preventDefault(); setTerbuka((t) => t.filter((n) => n !== nama)); }
    }
  };

  return (
    <div ref={akar} onKeyDown={onKey} data-testid="nav-gudang" role="group" aria-label="Menu Gudang">
      {sections.map((s) => {
        if (s.langsung) {
          return <div key={s.section} className="nav-section" data-testid={`grup-${s.section}`}><SidebarNavSection items={s.items} allDivisionItems={allVisibleItems} pathname={pathname} search={search} badgeCount={badgeCount} collapsed={false} onNavigate={onNavigate} /></div>;
        }
        const buka = terbuka.includes(s.section); const Ikon = s.Icon; const adaAktif = aktif === s.section; const idAnak = `grup-anak-${s.section}`;
        // Anak dikelompokkan ke segmen bila ada `subjudul` (konteks, mis. fitur milik Finance).
        const segmen = []; for (const it of s.items) { if (it.subjudul || segmen.length === 0) segmen.push({ judul: it.subjudul ?? null, items: [] }); segmen[segmen.length - 1].items.push(it); }
        return (
          <div key={s.section} className="nav-section" data-testid={`grup-${s.section}`} data-terbuka={buka ? "ya" : "tidak"}>
            <button type="button" data-grup-kepala={s.section} aria-expanded={buka} aria-controls={idAnak} onClick={() => toggle(s.section)}
              className={cn("flex w-full items-center gap-2 rounded-btn px-2.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent", adaAktif && !buka ? "text-accent" : "text-ink2")}>
              {Ikon && <Ikon size={16} className="shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{s.section}</span>
              {s.badgeKelompok > 0 && <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center text-[10.5px] font-bold leading-[18px] text-white" data-testid="badge-kelompok" aria-label={`${s.badgeKelompok} menunggu tindakan`}>{s.badgeKelompok}</span>}
              <ChevronDown size={14} className={cn("shrink-0 text-ink3 transition-transform", !buka && "-rotate-90")} aria-hidden />
            </button>
            {buka && (
              <div id={idAnak} className="ml-3.5 mt-0.5 space-y-0.5 border-l border-line pl-1.5" data-testid={`anak-${s.section}`}>
                {segmen.map((g, n) => (
                  <div key={n}>
                    {g.judul && <div className="px-2.5 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-ink3" data-testid="subjudul-nav">{g.judul}</div>}
                    <SidebarNavSection items={g.items} allDivisionItems={allVisibleItems} pathname={pathname} search={search} badgeCount={badgeCount} collapsed={false} onNavigate={onNavigate} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
