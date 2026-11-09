import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, CornerDownLeft, X, Clock, FileText, Users, ClipboardList, MessageCircle, Home, TrendingUp,
  Hammer, Warehouse, Truck, LayoutGrid, Wallet, Handshake, ArrowUp, ArrowDown, Loader2,
} from "lucide-react";
import { ModalPrimitive as Dialog } from "@/components/ui/modal.jsx";
import { DaftarOverlay } from "./overlay-status.jsx";
import { api } from "@/api.js";
import { STAGE_LABELS, ORDER_STATUS_LABELS } from "@/utils/format.js";
import {
  WORKSPACE_CARI, cariHalaman, sorot, kueriDataLayak, kueriUntukServer, bacaRiwayat, catatRiwayat, hapusRiwayat,
} from "@/lib/cariGlobal.js";

// Spotlight SANSS (⌘K / Ctrl+K) — redesain Apple, 10 Nov 2026.
// SATU kolom pencarian untuk: halaman dari SEMUA workspace yang boleh dibuka pengguna, pelanggan (nama/nomor HP/
// Instagram/email), order (nomor order/nama/nomor HP/kode unit), dan chat WhatsApp (nama/nomor/nama grup).
// - Halaman: dicari di browser dari daftar menu (sumber sama dengan sidebar), disaring lagi per portal dari /auth/me.
// - Data: endpoint daftar yang SUDAH ADA (GET /customers, /orders, /conversations?nameOnly=true) dengan limit kecil —
//   server tetap penegak akses; tidak ada endpoint/izin baru. Chat sengaja nameOnly (tanpa isi pesan: full-scan Message
//   adalah akar lambat yang diketahui). Data hanya ditawarkan ke pengguna yang boleh membuka Sales CRM.
// - Riwayat "Terakhir dibuka" disimpan per peramban (localStorage), boleh hilang kapan saja.

const IKON_WS = { hub: Home, growth: TrendingUp, bengkel: Hammer, warehouse: Warehouse, armada: Truck, kendali: LayoutGrid, finance: Wallet, b2b: Handshake };
const IKON_JENIS = { pelanggan: Users, order: ClipboardList, chat: MessageCircle, halaman: FileText };
const LINGKUP = [
  { key: "semua", label: "Semua" },
  { key: "halaman", label: "Halaman" },
  { key: "pelanggan", label: "Pelanggan", data: true },
  { key: "order", label: "Order", data: true },
  { key: "chat", label: "Chat", data: true },
];
const JUDUL_GRUP = { halaman: "Halaman", pelanggan: "Pelanggan", order: "Order", chat: "Chat WhatsApp" };
const KOSONG = { status: "diam", items: [] };

// Portal yang boleh dibuka — dimuat sekali per sesi halaman (server = sumber kebenaran, perubahan peran berlaku saat refresh).
let janjiPortal = null;
function muatPortal() {
  if (!janjiPortal) {
    janjiPortal = api.getMyPortals()
      .then((me) => new Set((me?.portals || []).map((p) => p.key)))
      .catch(() => { janjiPortal = null; return null; });
  }
  return janjiPortal;
}

function formatHp(hp) {
  const d = String(hp || "").replace(/\D/g, "");
  if (!d) return "";
  const lokal = d.startsWith("62") ? "0" + d.slice(2) : d;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}
function inisial(nama) {
  const k = String(nama || "").trim().split(/\s+/).filter(Boolean);
  return ((k[0]?.[0] || "") + (k[1]?.[0] || "")).toUpperCase() || "#";
}
function waktuRelatif(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt`;
  const j = Math.round(m / 60);
  if (j < 24) return `${j} jam`;
  const h = Math.round(j / 24);
  return h < 30 ? `${h} hr` : new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function Sorot({ teks, kueri }) {
  return sorot(teks, kueri).map((s, i) => (s.cocok ? <mark key={i} className="sp-cocok">{s.teks}</mark> : <React.Fragment key={i}>{s.teks}</React.Fragment>));
}

function Ubin({ r }) {
  if (r.jenis === "pelanggan" || r.jenis === "chat") {
    return <span className={"sp-ubin sp-ubin-" + r.jenis} aria-hidden>{r.jenis === "chat" ? <MessageCircle size={16} /> : inisial(r.label)}</span>;
  }
  const Ikon = r.jenis === "halaman" ? (r.Icon || IKON_WS[r.ws] || FileText) : (IKON_JENIS[r.jenis] || FileText);
  const warna = r.jenis === "halaman" ? (WORKSPACE_CARI[r.ws]?.warna || "abu") : r.jenis;
  return <span className={"sp-ubin sp-ubin-" + warna} aria-hidden><Ikon size={16} strokeWidth={2.1} /></span>;
}

export function CommandPalette({ open, onOpenChange, halaman, halamanSemua, wsSaatIni = null, onPilih }) {
  const [q, setQ] = useState("");
  const [lingkup, setLingkup] = useState("semua");
  const [idx, setIdx] = useState(0);
  const [portal, setPortal] = useState(null); // Set kunci portal | null (belum/gagal dimuat)
  const [riwayat, setRiwayat] = useState([]);
  const [data, setData] = useState({ pelanggan: KOSONG, order: KOSONG, chat: KOSONG });
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const seq = useRef(0);

  // Shortcut global ⌘K / Ctrl+K.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) { setQ(""); setIdx(0); setLingkup("semua"); setData({ pelanggan: KOSONG, order: KOSONG, chat: KOSONG }); return; }
    setRiwayat(bacaRiwayat());
    let hidup = true;
    muatPortal().then((s) => { if (hidup) setPortal(s); });
    return () => { hidup = false; };
  }, [open]);

  // Hak lihat: portal dari server; bila gagal dimuat, hanya workspace saat ini + Main Hub (aman: tidak menawarkan lebih).
  const boleh = useMemo(() => portal || new Set([wsSaatIni, "hub"].filter(Boolean)), [portal, wsSaatIni]);
  const bolehData = boleh.has("growth");

  const kumpulanHalaman = useMemo(() => {
    const semua = Array.isArray(halamanSemua) && halamanSemua.length
      ? halamanSemua.filter((h) => h.ws === "hub" || h.ws === wsSaatIni || boleh.has(h.ws))
      : (Array.isArray(halaman) ? halaman.map((h) => ({ ...h, ws: wsSaatIni })) : []);
    return semua.map((h) => ({ ...h, wsLabel: WORKSPACE_CARI[h.ws]?.label || "" }));
  }, [halamanSemua, halaman, wsSaatIni, boleh]);

  const kueri = q.trim();
  const cariData = bolehData && kueriDataLayak(kueri) && lingkup !== "halaman";

  // Pencarian data (debounce 250 ms; respons basi dibuang lewat nomor urut).
  useEffect(() => {
    if (!open) return undefined;
    if (!cariData) { setData({ pelanggan: KOSONG, order: KOSONG, chat: KOSONG }); return undefined; }
    const nomor = ++seq.current;
    const batas = lingkup === "semua" ? 4 : 12;
    const jenisAktif = ["pelanggan", "order", "chat"].filter((j) => lingkup === "semua" || lingkup === j);
    setData((d) => {
      const n = { pelanggan: KOSONG, order: KOSONG, chat: KOSONG };
      jenisAktif.forEach((j) => { n[j] = { status: "muat", items: d[j].items }; });
      return n;
    });
    const t = setTimeout(() => {
      const s = kueriUntukServer(kueri);
      const panggil = {
        pelanggan: () => api.getCustomers({ search: s, page: 1, limit: batas }).then((r) => r?.items || []),
        order: () => api.getOrders({ search: s, limit: batas }).then((r) => (r?.items || []).slice(0, batas)),
        chat: () => api.getConversations({ search: s, nameOnly: true, limit: batas }).then((r) => (r?.data || []).slice(0, batas)),
      };
      jenisAktif.forEach((j) => {
        panggil[j]()
          .then((items) => { if (seq.current === nomor) setData((d) => ({ ...d, [j]: { status: "siap", items } })); })
          .catch(() => { if (seq.current === nomor) setData((d) => ({ ...d, [j]: { status: "galat", items: [] } })); });
      });
    }, 250);
    return () => clearTimeout(t);
  }, [open, cariData, kueri, lingkup]);

  // Baris hasil per grup → satu daftar datar untuk navigasi keyboard.
  const grup = useMemo(() => {
    const g = [];
    if (!kueri) {
      if (riwayat.length) g.push({ key: "riwayat", judul: "Terakhir dibuka", aksi: "hapus", baris: riwayat.map((r) => ({ ...r, jenis: r.jenis || "halaman", Icon: null })) });
      const pintas = kumpulanHalaman.filter((h) => h.ws === (wsSaatIni || "hub")).slice(0, 6);
      if (pintas.length) g.push({ key: "pintas", judul: `Di ${WORKSPACE_CARI[wsSaatIni || "hub"]?.label || "workspace ini"}`, baris: pintas.map((h) => ({ ...h, jenis: "halaman", sub: h.section ? h.section.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : "" })) });
      return g;
    }
    if (lingkup === "semua" || lingkup === "halaman") {
      const hs = cariHalaman(kumpulanHalaman, kueri, { wsSaatIni, batas: lingkup === "halaman" ? 30 : 6 });
      if (hs.length) g.push({ key: "halaman", judul: JUDUL_GRUP.halaman, baris: hs.map((h) => ({ ...h, jenis: "halaman", sub: [h.wsLabel, h.section && h.section.toLowerCase() !== h.label.toLowerCase() ? h.section.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : null].filter(Boolean).join(" · ") })) });
    }
    const p = data.pelanggan;
    if (p.status !== "diam") g.push({ key: "pelanggan", judul: JUDUL_GRUP.pelanggan, status: p.status, baris: p.items.map((c) => ({
      jenis: "pelanggan", to: `/customers?id=${c.id}`, label: c.name || formatHp(c.phone) || "Tanpa nama",
      sub: [formatHp(c.phone), c.city, c.assignedSales?.name ? `Sales: ${c.assignedSales.name}` : null].filter(Boolean).join(" · "),
      meta: STAGE_LABELS[c.pipelineStage] || "", ws: "growth",
    })) });
    const o = data.order;
    if (o.status !== "diam") g.push({ key: "order", judul: JUDUL_GRUP.order, status: o.status, baris: o.items.map((x) => ({
      jenis: "order", to: `/orders?id=${x.id}&cari=${encodeURIComponent(x.orderNumber || "")}`, label: x.orderNumber || "Order",
      sub: [x.customerName, formatHp(x.customerPhone), x.customerCity].filter(Boolean).join(" · "),
      meta: ORDER_STATUS_LABELS[x.status] || x.status || "", ws: "growth",
    })) });
    const c = data.chat;
    if (c.status !== "diam") g.push({ key: "chat", judul: JUDUL_GRUP.chat, status: c.status, baris: c.items.map((x) => {
      const nama = x.type === "GROUP" ? (x.groupName || "Grup") : (x.customer?.name || formatHp(x.customer?.phone) || "Percakapan");
      const pesan = x.messages?.[0]?.content || "";
      return {
        jenis: "chat", to: `/inbox?conv=${x.id}`, label: nama,
        sub: [x.type === "GROUP" ? "Grup" : formatHp(x.customer?.phone), pesan ? pesan.slice(0, 70) : null].filter(Boolean).join(" · "),
        meta: waktuRelatif(x.lastMessageAt), ws: "growth",
      };
    }) });
    return g;
  }, [kueri, lingkup, riwayat, kumpulanHalaman, wsSaatIni, data]);

  const datar = useMemo(() => grup.flatMap((x) => x.baris), [grup]);
  useEffect(() => { setIdx(0); }, [kueri, lingkup]);
  useEffect(() => { if (idx > Math.max(0, datar.length - 1)) setIdx(Math.max(0, datar.length - 1)); }, [datar.length, idx]);
  useEffect(() => { listRef.current?.querySelector('[data-aktif="true"]')?.scrollIntoView({ block: "nearest" }); }, [idx]);

  const lingkupTerlihat = LINGKUP.filter((l) => !l.data || bolehData);
  const sedangMuat = grup.some((x) => x.status === "muat");

  function pilih(r) {
    if (!r) return;
    // Riwayat hanya menyimpan nama + jenis (tanpa nomor HP/isi chat) — localStorage bisa dibaca siapa pun di perangkat itu.
    const subRiwayat = r.jenis === "halaman" ? r.sub : ({ pelanggan: "Pelanggan", order: "Order", chat: "Chat WhatsApp" }[r.jenis] || "");
    setRiwayat(catatRiwayat({ jenis: r.jenis, to: r.to, label: r.label, sub: subRiwayat, ws: r.ws }));
    onOpenChange(false);
    if (typeof onPilih === "function") onPilih({ to: r.to, label: r.label });
  }
  function onInputKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(0, datar.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pilih(datar[idx]); }
    else if (e.key === "Tab" && lingkupTerlihat.length > 1) {
      e.preventDefault();
      const i = lingkupTerlihat.findIndex((l) => l.key === lingkup);
      const n = (i + (e.shiftKey ? -1 : 1) + lingkupTerlihat.length) % lingkupTerlihat.length;
      setLingkup(lingkupTerlihat[n].key);
    }
  }

  let nomorBaris = -1;
  const placeholder = bolehData ? "Cari halaman, pelanggan, nomor HP, order, chat…" : "Cari halaman atau menu…";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sp-latar fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="sp-panel fixed left-1/2 top-[11vh] z-[201] flex max-h-[76vh] w-[680px] max-w-[94vw] -translate-x-1/2 flex-col overflow-hidden outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-label="Pencarian"
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
        >
          <Dialog.Title className="sr-only">Pencarian</Dialog.Title>
          <Dialog.Description className="sr-only">Cari halaman{bolehData ? ", pelanggan, order, atau chat" : ""}. Panah atas/bawah memilih, Enter membuka, Tab mengganti kategori.</Dialog.Description>

          <div className="sp-kepala">
            <Search size={20} className="sp-kaca" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={placeholder}
              aria-label="Kata pencarian"
              aria-controls="sp-hasil"
              aria-activedescendant={datar[idx] ? `sp-baris-${idx}` : undefined}
              role="combobox"
              aria-expanded="true"
              autoComplete="off"
              spellCheck={false}
              className="sp-input palette-input-ringkas"
            />
            {sedangMuat && <Loader2 size={16} className="sp-putar" aria-label="Mencari" />}
            {q && (
              <button type="button" className="sp-hapus" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Hapus kata pencarian">
                <X size={14} />
              </button>
            )}
            <kbd className="sp-kbd hidden sm:block">esc</kbd>
          </div>

          {lingkupTerlihat.length > 1 && (
            <div className="sp-lingkup" role="tablist" aria-label="Kategori pencarian">
              {lingkupTerlihat.map((l) => (
                <button key={l.key} type="button" role="tab" aria-selected={lingkup === l.key} data-aktif={lingkup === l.key ? "true" : "false"}
                  className="sp-chip" onClick={() => { setLingkup(l.key); inputRef.current?.focus(); }}>
                  {l.label}
                </button>
              ))}
            </div>
          )}

          <div id="sp-hasil" ref={listRef} className="sp-hasil" role="listbox" aria-label="Hasil pencarian">
            {grup.map((g) => (
              <section key={g.key} className="sp-grup" aria-label={g.judul}>
                <div className="sp-grup-judul">
                  <span>{g.judul}</span>
                  {g.aksi === "hapus" && (
                    <button type="button" className="sp-grup-aksi" onClick={() => { setRiwayat(hapusRiwayat()); inputRef.current?.focus(); }}>Hapus</button>
                  )}
                </div>
                {g.baris.map((r) => {
                  nomorBaris += 1;
                  const i = nomorBaris;
                  return (
                    <button
                      key={g.key + r.to}
                      id={`sp-baris-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === idx}
                      data-aktif={i === idx ? "true" : "false"}
                      onMouseMove={() => { if (i !== idx) setIdx(i); }}
                      onClick={() => pilih(r)}
                      className="sp-baris"
                    >
                      {g.key === "riwayat" ? <span className="sp-ubin sp-ubin-abu" aria-hidden><Clock size={15} /></span> : <Ubin r={r} />}
                      <span className="sp-teks">
                        <span className="sp-judul"><Sorot teks={r.label} kueri={kueri} /></span>
                        {r.sub && <span className="sp-sub"><Sorot teks={r.sub} kueri={kueri} /></span>}
                      </span>
                      {r.meta && <span className="sp-meta">{r.meta}</span>}
                      <CornerDownLeft size={14} className="sp-enter" aria-hidden />
                    </button>
                  );
                })}
                {g.status === "muat" && g.baris.length === 0 && (
                  <div className="sp-catatan" aria-live="polite">Mencari {g.judul.toLowerCase()}…</div>
                )}
                {g.status === "siap" && g.baris.length === 0 && (
                  <div className="sp-catatan">Tidak ada {g.judul.toLowerCase()} yang cocok.</div>
                )}
                {g.status === "galat" && <div className="sp-catatan sp-catatan-galat">Gagal memuat {g.judul.toLowerCase()}. Coba lagi sebentar.</div>}
              </section>
            ))}

            {kueri && datar.length === 0 && !sedangMuat && (
              <div className="sp-kosong">
                <Search size={26} aria-hidden />
                <p className="sp-kosong-judul">Tidak ada hasil untuk “{kueri}”</p>
                <p className="sp-kosong-sub">
                  {bolehData
                    ? (kueriDataLayak(kueri) ? "Coba nama lain, nomor HP tanpa spasi, atau nomor order." : "Ketik minimal 2 huruf untuk mencari pelanggan, order, dan chat.")
                    : "Pencarian ini mencari nama halaman dan menu."}
                </p>
              </div>
            )}

            {!kueri && grup.length === 0 && (
              <div className="sp-kosong">
                <Search size={26} aria-hidden />
                <p className="sp-kosong-judul">Mau cari apa?</p>
                <p className="sp-kosong-sub">{bolehData ? "Nama pelanggan, nomor HP, nomor order, atau nama halaman." : "Nama halaman atau menu."}</p>
              </div>
            )}
          </div>

          <div className="sp-kaki" aria-hidden>
            <span><kbd><ArrowUp size={11} /></kbd><kbd><ArrowDown size={11} /></kbd> pilih</span>
            <span><kbd><CornerDownLeft size={11} /></kbd> buka</span>
            {lingkupTerlihat.length > 1 && <span><kbd>tab</kbd> kategori</span>}
            <span className="sp-kaki-kanan">{bolehData ? "Pelanggan, order & chat dicari langsung di server" : "Halaman sesuai akses Anda"}</span>
          </div>
          <DaftarOverlay />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
