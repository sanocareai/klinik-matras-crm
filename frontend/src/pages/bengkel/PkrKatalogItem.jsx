import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import { rolesOf } from "@/lib/roles.js";

// Pengaturan Produksi › Katalog Item PKR. Kategori + produk/varian untuk "Order untuk Produksi dan Delivery" pada Penjualan Karyawan. Admin/Owner mengelola; bentuk isian per kategori
// (kasur: P×L×T, divan: ukuran + tipe, …) ditetapkan KODE dan hanya dipilih di sini. Menonaktifkan tidak mengubah dokumen lama (nama disalin sebagai snapshot saat order dibuat).
function readUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } }
const JENIS = { BARU: "Produk baru (langsung di workshop)", LAYANAN: "Service/upgrade (barang diambil dulu)" };

function FormKategori({ bentuk, onSimpan, sibuk }) {
  const [f, setF] = useState({ kode: "", nama: "", bentuk: "KASUR", jenisKerja: "BARU" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-5" data-testid="form-kategori">
      <Field label="Kode" hint="Huruf besar/angka/_, mis. DIVAN_LACI"><Input value={f.kode} onChange={(e) => set("kode", e.target.value.toUpperCase())} aria-label="Kode kategori" /></Field>
      <Field label="Nama kategori"><Input value={f.nama} onChange={(e) => set("nama", e.target.value)} aria-label="Nama kategori" /></Field>
      <Field label="Bentuk isian">
        <Pilihan value={f.bentuk} onChange={(v) => set("bentuk", v)} aria-label="Bentuk isian">
          {Object.entries(bentuk).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
        </Pilihan>
      </Field>
      <Field label="Jenis pekerjaan">
        <Pilihan value={f.jenisKerja} onChange={(v) => set("jenisKerja", v)} aria-label="Jenis pekerjaan">
          <option value="BARU">{JENIS.BARU}</option><option value="LAYANAN">{JENIS.LAYANAN}</option>
        </Pilihan>
      </Field>
      <div className="flex items-end"><Button disabled={sibuk || f.kode.trim().length < 2 || f.nama.trim().length < 2} onClick={() => onSimpan(f, () => setF({ kode: "", nama: "", bentuk: "KASUR", jenisKerja: "BARU" }))} className="max-sm:min-h-11 max-sm:w-full">Tambah Kategori</Button></div>
    </div>
  );
}

function FormProduk({ kategori, layanan, onSimpan, sibuk }) {
  const [f, setF] = useState({ kode: "", nama: "", layananProduksiId: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const adaLayanan = kategori.jenisKerja === "LAYANAN";
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4" data-testid={`form-produk-${kategori.kode}`}>
      <Input value={f.kode} onChange={(e) => set("kode", e.target.value.toUpperCase())} placeholder="Kode produk" aria-label={`Kode produk ${kategori.nama}`} />
      <Input value={f.nama} onChange={(e) => set("nama", e.target.value)} placeholder="Nama produk/varian" aria-label={`Nama produk ${kategori.nama}`} />
      {adaLayanan
        ? (
          <Pilihan value={f.layananProduksiId} onChange={(v) => set("layananProduksiId", v)} aria-label={`Layanan produksi ${kategori.nama}`}>
            <option value="">— tanpa layanan produksi —</option>
            {layanan.map((l) => <option key={l.id} value={l.id}>{l.labelId}</option>)}
          </Pilihan>
        )
        : <span className="self-center text-[12px] text-ink3">Layanan produksi hanya untuk kategori service/upgrade.</span>}
      <Button size="sm" variant="neutral" disabled={sibuk || f.kode.trim().length < 2 || f.nama.trim().length < 2}
        onClick={() => onSimpan({ kategoriId: kategori.id, kode: f.kode, nama: f.nama, ...(f.layananProduksiId && { layananProduksiId: f.layananProduksiId }) }, () => setF({ kode: "", nama: "", layananProduksiId: "" }))}
        className="max-sm:min-h-11">Tambah Produk</Button>
    </div>
  );
}

export default function PkrKatalogItem() {
  const roles = rolesOf(readUser());
  const bisaTulis = roles.some((r) => ["ADMIN", "OWNER"].includes(r));
  const [k, setK] = useState(null);
  const [layanan, setLayanan] = useState([]);
  const [galat, setGalat] = useState(""); const [info, setInfo] = useState(""); const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api.getPkrKatalogKelola(), api.getServiceCatalog().catch(() => ({ services: [] }))]);
      setK(a); setLayanan(b.services || []); setGalat("");
    } catch (e) { setGalat(e.message || "Gagal memuat katalog"); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const jalankan = async (fn, ok, selesai) => {
    setSibuk(true); setGalat(""); setInfo("");
    try { await fn(); setInfo(ok); selesai?.(); await muat(); } catch (e) { setGalat(e.message || "Gagal menyimpan"); } finally { setSibuk(false); }
  };

  return (
    <PageContainer>
      <PageHeader title="Katalog Item PKR" subtitle="Kategori dan produk/varian untuk order produksi Penjualan Karyawan. Bentuk isian tiap kategori (ukuran yang relevan) mengikuti bentuk yang dipilih." />
      <PageBody>
        {galat && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</div>}
        {info && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{info}</div>}
        {!bisaTulis && k && <p className="m-0 text-[12px] text-ink3" data-testid="katalog-readonly">Hanya Admin/Owner yang dapat mengubah katalog; Anda dapat melihatnya.</p>}
        {!k && !galat && <p className="text-[12.5px] text-ink3" role="status">Memuat katalog…</p>}

        {k && bisaTulis && (
          <Card className="space-y-3 p-4">
            <h3 className="m-0 text-[14px] font-bold text-ink">Tambah kategori</h3>
            <FormKategori bentuk={k.bentuk} sibuk={sibuk} onSimpan={(f, bersih) => jalankan(() => api.buatKategoriPkr(f), "Kategori ditambahkan.", bersih)} />
          </Card>
        )}

        {k?.kategori.map((c) => (
          <Card key={c.id} className="space-y-3 p-4" data-testid={`kategori-${c.kode}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="m-0 text-[14px] font-bold text-ink">{c.nama}</h3>
                <span className="font-mono text-[11.5px] text-ink3">{c.kode}</span>
                <Badge variant="neutral">{k.bentuk[c.bentuk]?.label || c.bentuk}</Badge>
                <Badge variant={c.jenisKerja === "LAYANAN" ? "orange" : "neutral"}>{JENIS[c.jenisKerja]}</Badge>
                {!c.aktif && <Badge variant="neutral">Nonaktif</Badge>}
              </div>
              {bisaTulis && (
                <Button size="sm" variant="neutral" disabled={sibuk} className="max-sm:min-h-11"
                  onClick={() => jalankan(() => api.ubahKategoriPkr(c.id, { aktif: !c.aktif }), c.aktif ? "Kategori dinonaktifkan." : "Kategori diaktifkan.")}>
                  {c.aktif ? "Nonaktifkan" : "Aktifkan"}
                </Button>
              )}
            </div>
            <p className="m-0 text-[12px] text-ink3">
              Isian: {k.bentuk[c.bentuk]?.dimensi.map((d) => `${d.label}${d.wajib ? "*" : ""}`).join(", ")} · {k.bentuk[c.bentuk]?.produk.label}{k.bentuk[c.bentuk]?.produk.wajib ? "*" : ""} · {k.bentuk[c.bentuk]?.spesifikasi.label}{k.bentuk[c.bentuk]?.spesifikasi.keras ? "*" : ""}
              {" "}(* = untuk dianggap lengkap{k.bentuk[c.bentuk]?.spesifikasi.keras ? "; spesifikasi custom wajib saat input" : ""})
            </p>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {c.produk.length === 0 && <li className="text-[12.5px] text-ink3">Belum ada produk — pengguna dapat mengetik nama produk sendiri.</li>}
              {c.produk.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid={`produk-${p.kode}`}>
                  <span className="min-w-0 truncate"><span className="font-medium text-ink">{p.nama}</span> <span className="font-mono text-[11px] text-ink3">{p.kode}</span>{p.layananProduksi ? <span className="ml-2 text-ink2">→ {p.layananProduksi.nama}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    {!p.aktif && <Badge variant="neutral">Nonaktif</Badge>}
                    {bisaTulis && c.jenisKerja === "LAYANAN" && (
                      <Pilihan value={p.layananProduksi?.id || ""} className="!h-8 !w-auto max-w-[220px]" aria-label={`Layanan produksi ${p.nama}`} disabled={sibuk}
                        onChange={(v) => jalankan(() => api.ubahProdukPkr(p.id, { layananProduksiId: v || null }), "Pemetaan layanan produksi disimpan.")}>
                        <option value="">— tanpa layanan produksi —</option>
                        {layanan.map((l) => <option key={l.id} value={l.id}>{l.labelId}</option>)}
                      </Pilihan>
                    )}
                    {bisaTulis && (
                      <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => jalankan(() => api.ubahProdukPkr(p.id, { aktif: !p.aktif }), p.aktif ? "Produk dinonaktifkan." : "Produk diaktifkan.")} className="max-sm:min-h-11">
                        {p.aktif ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {bisaTulis && <FormProduk kategori={c} layanan={layanan} sibuk={sibuk} onSimpan={(f, bersih) => jalankan(() => api.buatProdukPkr(f), "Produk ditambahkan.", bersih)} />}
          </Card>
        ))}
      </PageBody>
    </PageContainer>
  );
}
