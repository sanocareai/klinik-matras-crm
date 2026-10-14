import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import { rolesOf } from "@/lib/roles.js";
import RuteProduksiPanel from "@/features/finance/RuteProduksiPanel.jsx";

// Pengaturan Produksi › Katalog Item PKR. Kategori + produk/varian untuk "Order untuk Produksi dan Delivery" pada Penjualan Karyawan. Admin/Owner (izin pkr_catalog:manage di server)
// mengelola; bentuk isian per kategori (kasur: P×L×T, divan: ukuran + tipe, …) ditetapkan KODE dan hanya dipilih di sini. PEMETAAN RUTE PRODUKSI (lini + jenis produk untuk produk baru,
// layanan produksi untuk service/upgrade) wajib: produk/kategori yang belum dipetakan DIBLOKIR saat pratinjau dan pembuatan order. Set Kasur Lengkap = bundel: komposisinya diatur di sini.
// Menonaktifkan tidak mengubah dokumen lama (nama disalin sebagai snapshot saat order dibuat).
function readUser() { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } }
const JENIS = { BARU: "Produk baru (langsung di workshop)", LAYANAN: "Service/upgrade (barang diambil dulu)" };
const LABEL_LINI = { KASUR: "Kasur", SOFA: "Sofa", DIVAN: "Divan" };

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
            <option value="">— ikut kategori —</option>
            {layanan.map((l) => <option key={l.id} value={l.id}>{l.labelId}</option>)}
          </Pilihan>
        )
        : <span className="self-center text-[12px] text-ink3">Jenis produk diatur setelah produk dibuat.</span>}
      <Button size="sm" variant="neutral" disabled={sibuk || f.kode.trim().length < 2 || f.nama.trim().length < 2}
        onClick={() => onSimpan({ kategoriId: kategori.id, kode: f.kode, nama: f.nama, ...(f.layananProduksiId && { layananProduksiId: f.layananProduksiId }) }, () => setF({ kode: "", nama: "", layananProduksiId: "" }))}
        className="max-sm:min-h-11">Tambah Produk</Button>
    </div>
  );
}

/** Pilih lini + jenis produk (produk baru) — jenis disaring menurut lini (familiJenis dari server). `nilai` = { productLine, productType }. */
function PetaJenis({ opsi, nilai, onUbah, disabled, label }) {
  const jenis = opsi.jenisProduk.filter((j) => !nilai.productLine || opsi.familiJenis[j] === nilai.productLine);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pilihan value={nilai.productLine || ""} disabled={disabled} className="!h-8 !w-auto" aria-label={`Lini produk ${label}`} onChange={(v) => onUbah({ productLine: v || null, productType: v && nilai.productType && opsi.familiJenis[nilai.productType] !== v ? null : nilai.productType })}>
        <option value="">— lini produk —</option>
        {opsi.lini.map((l) => <option key={l} value={l}>{LABEL_LINI[l] || l}</option>)}
      </Pilihan>
      <Pilihan value={nilai.productType || ""} disabled={disabled} className="!h-8 !w-auto" aria-label={`Jenis produk ${label}`} onChange={(v) => onUbah({ productType: v || null, ...(v ? { productLine: opsi.familiJenis[v] } : {}) })}>
        <option value="">— jenis produk —</option>
        {jenis.map((j) => <option key={j} value={j}>{j}</option>)}
      </Pilihan>
    </div>
  );
}

/** Editor komposisi bundel: daftar komponen (kategori, varian opsional, jumlah per set). Simpan = ganti seluruh komposisi (teraudit). */
function EditorKomposisi({ kategori, produk = null, semuaKategori, onSimpan, sibuk }) {
  const awal = (produk ? produk.komposisi : kategori.komposisi).map((k) => ({ kategoriId: k.kategoriId, produkId: k.produkId || "", jumlah: String(k.jumlah) }));
  const [daftar, setDaftar] = useState(awal);
  useEffect(() => { setDaftar((produk ? produk.komposisi : kategori.komposisi).map((k) => ({ kategoriId: k.kategoriId, produkId: k.produkId || "", jumlah: String(k.jumlah) }))); }, [kategori, produk]);
  const calon = semuaKategori.filter((c) => !c.bundel && c.aktif);
  const ubah = (idx, patch) => setDaftar((d) => d.map((x, n) => (n === idx ? { ...x, ...patch } : x)));
  const label = produk ? `varian ${produk.nama}` : kategori.nama;
  return (
    <div className="space-y-2 rounded-lg bg-inset p-3" data-testid={`komposisi-${produk ? produk.kode : kategori.kode}`}>
      <p className="m-0 text-[12.5px] font-semibold text-ink">{produk ? `Komposisi khusus varian ${produk.nama}` : "Komposisi set (komponen operasional)"}</p>
      {!produk && <p className="m-0 text-[12px] text-ink3">Set dipecah menjadi komponen ini saat order dibuat; tiap komponen jadi unit produksinya sendiri dengan ukuran dan rute sendiri. Kosong = set belum bisa dipakai.</p>}
      {produk && <p className="m-0 text-[12px] text-ink3">Kosong = varian ini memakai komposisi kategori.</p>}
      {daftar.map((k, idx) => {
        const kat = calon.find((c) => c.id === k.kategoriId);
        return (
          <div key={idx} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_90px_auto]">
            <Pilihan value={k.kategoriId} aria-label={`Kategori komponen ${idx + 1} ${label}`} onChange={(v) => ubah(idx, { kategoriId: v, produkId: "" })}>
              <option value="">— pilih kategori —</option>
              {calon.map((c) => <option key={c.id} value={c.id}>{c.nama}</option>)}
            </Pilihan>
            <Pilihan value={k.produkId} aria-label={`Varian komponen ${idx + 1} ${label}`} onChange={(v) => ubah(idx, { produkId: v })}>
              <option value="">— varian bebas —</option>
              {(kat?.produk ?? []).map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </Pilihan>
            <Input type="number" min="1" max="20" value={k.jumlah} onChange={(e) => ubah(idx, { jumlah: e.target.value })} aria-label={`Jumlah komponen ${idx + 1} ${label}`} />
            <Button size="sm" variant="neutral" onClick={() => setDaftar((d) => d.filter((_, n) => n !== idx))} className="max-sm:min-h-11" aria-label={`Hapus komponen ${idx + 1} ${label}`}>Hapus</Button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="neutral" disabled={daftar.length >= 10} onClick={() => setDaftar((d) => [...d, { kategoriId: "", produkId: "", jumlah: "1" }])} className="max-sm:min-h-11">+ Komponen</Button>
        <Button size="sm" disabled={sibuk || daftar.some((k) => !k.kategoriId)} className="max-sm:min-h-11"
          onClick={() => onSimpan({ kategoriId: kategori.id, ...(produk && { produkId: produk.id }), komponen: daftar.map((k) => ({ kategoriId: k.kategoriId, ...(k.produkId && { produkId: k.produkId }), jumlah: Number(k.jumlah) || 1 })) })}>
          Simpan komposisi
        </Button>
      </div>
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
  const belum = k?.ringkasan?.belumDipetakan ?? [];

  return (
    <PageContainer>
      <PageHeader title="Katalog Item PKR" subtitle="Kategori, produk/varian, pemetaan rute Produksi, dan komposisi set untuk order produksi Penjualan Karyawan. Produk yang belum dipetakan berstatus Menunggu penentuan alur Produksi selama mode transisi (lihat Mode rute Produksi di bawah); di mode ketat produk itu tidak bisa dipakai di order." />
      <PageBody>
        {galat && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat}</div>}
        {info && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{info}</div>}
        {!bisaTulis && k && <p className="m-0 text-[12px] text-ink3" data-testid="katalog-readonly">Hanya Admin/Owner yang dapat mengubah katalog; Anda dapat melihatnya.</p>}
        {!k && !galat && <p className="text-[12.5px] text-ink3" role="status">Memuat katalog…</p>}

        <RuteProduksiPanel bisaTulis={bisaTulis} />

        {k && belum.length > 0 && (
          <div role="status" className="space-y-1 rounded-btn bg-orangebg px-3 py-2.5 text-[12.5px] text-orange" data-testid="belum-dipetakan">
            <p className="m-0 flex items-center gap-2 font-semibold"><AlertTriangle size={14} /> {belum.length} produk/kategori aktif belum dipetakan ke rute Produksi — item yang memakainya berstatus "Menunggu penentuan alur Produksi" (mode transisi) atau ditolak (mode ketat).</p>
            <ul className="m-0 list-disc pl-8">
              {belum.slice(0, 12).map((b) => <li key={`${b.tipe}-${b.kode}`}>{b.tipe === "KATEGORI" ? "Kategori" : "Produk"} {b.nama}{b.kategori ? ` (${b.kategori})` : ""}</li>)}
            </ul>
            {belum.length > 12 && <p className="m-0">…dan {belum.length - 12} lainnya.</p>}
          </div>
        )}

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
                {c.aktif && !c.rute.ok && <Badge variant="orange" title={c.rute.pesan || undefined} data-testid="badge-belum-dipetakan">{c.bundel ? "Komposisi kosong" : "Rute belum dipetakan"}</Badge>}
              </div>
              {bisaTulis && (
                <Button size="sm" variant="neutral" disabled={sibuk} className="max-sm:min-h-11"
                  onClick={() => jalankan(() => api.ubahKategoriPkr(c.id, { aktif: !c.aktif }), c.aktif ? "Kategori dinonaktifkan." : "Kategori diaktifkan.")}>
                  {c.aktif ? "Nonaktifkan" : "Aktifkan"}
                </Button>
              )}
            </div>
            <p className="m-0 text-[12px] text-ink3">
              Isian: {k.bentuk[c.bentuk]?.dimensi.map((d) => `${d.label}${d.wajib ? "*" : ""}`).join(", ") || "per komponen"} · {k.bentuk[c.bentuk]?.produk.label}{k.bentuk[c.bentuk]?.produk.wajib ? "*" : ""} · {k.bentuk[c.bentuk]?.spesifikasi.label}{k.bentuk[c.bentuk]?.spesifikasi.keras ? "*" : ""}
              {" "}(* = untuk dianggap lengkap{k.bentuk[c.bentuk]?.spesifikasi.keras ? "; spesifikasi custom wajib saat input" : ""})
            </p>

            {c.bundel ? (
              bisaTulis
                ? <EditorKomposisi kategori={c} semuaKategori={k.kategori} sibuk={sibuk} onSimpan={(b) => jalankan(() => api.simpanKomposisiPkr(b), "Komposisi set disimpan.")} />
                : <ul className="m-0 list-disc pl-5 text-[12.5px] text-ink2">{c.komposisi.map((x) => <li key={x.id}>{x.kategoriNama}{x.produkNama ? ` · ${x.produkNama}` : ""} ×{x.jumlah}</li>)}</ul>
            ) : (
              <div className="space-y-1.5 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid={`peta-kategori-${c.kode}`}>
                <p className="m-0 font-semibold text-ink">Pemetaan rute Produksi (bawaan kategori)</p>
                {c.jenisKerja === "LAYANAN" ? (
                  <Pilihan value={c.pemetaan.layananProduksi?.id || ""} disabled={!bisaTulis || sibuk} className="!h-8 !w-auto max-w-[260px]" aria-label={`Layanan produksi bawaan ${c.nama}`}
                    onChange={(v) => jalankan(() => api.ubahKategoriPkr(c.id, { layananProduksiId: v || null }), "Pemetaan layanan produksi disimpan.")}>
                    <option value="">— belum dipetakan —</option>
                    {layanan.map((l) => <option key={l.id} value={l.id}>{l.labelId}</option>)}
                  </Pilihan>
                ) : (
                  <PetaJenis opsi={k.opsi} nilai={c.pemetaan} disabled={!bisaTulis || sibuk} label={c.nama}
                    onUbah={(p) => jalankan(() => api.ubahKategoriPkr(c.id, p), "Pemetaan jenis produk disimpan.")} />
                )}
                {c.aktif && !c.rute.ok && <p className="m-0 text-orange">{c.rute.pesan}</p>}
                {c.rute.ok && c.rute.alurLabel && <p className="m-0 text-ink3">{c.rute.alurLabel}</p>}
              </div>
            )}

            <ul className="m-0 list-none space-y-1.5 p-0">
              {c.produk.length === 0 && <li className="text-[12.5px] text-ink3">Belum ada produk — pengguna dapat mengetik nama produk sendiri{c.bundel ? "" : " (memakai pemetaan bawaan kategori)"}.</li>}
              {c.produk.map((p) => (
                <li key={p.id} className="space-y-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid={`produk-${p.kode}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><span className="font-medium text-ink">{p.nama}</span> <span className="font-mono text-[11px] text-ink3">{p.kode}</span>{p.layananProduksi ? <span className="ml-2 text-ink2">→ {p.layananProduksi.nama}</span> : null}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {!p.aktif && <Badge variant="neutral">Nonaktif</Badge>}
                      {p.aktif && c.aktif && !c.bundel && !p.rute.ok && <Badge variant="orange" title={p.rute.pesan || undefined} data-testid="badge-produk-belum-dipetakan">Rute belum dipetakan</Badge>}
                      {bisaTulis && !c.bundel && c.jenisKerja === "LAYANAN" && (
                        <Pilihan value={p.layananProduksi?.id || ""} className="!h-8 !w-auto max-w-[220px]" aria-label={`Layanan produksi ${p.nama}`} disabled={sibuk}
                          onChange={(v) => jalankan(() => api.ubahProdukPkr(p.id, { layananProduksiId: v || null }), "Pemetaan layanan produksi disimpan.")}>
                          <option value="">— ikut kategori —</option>
                          {layanan.map((l) => <option key={l.id} value={l.id}>{l.labelId}</option>)}
                        </Pilihan>
                      )}
                      {bisaTulis && !c.bundel && c.jenisKerja !== "LAYANAN" && (
                        <PetaJenis opsi={k.opsi} nilai={p.pemetaan} disabled={sibuk} label={p.nama} onUbah={(x) => jalankan(() => api.ubahProdukPkr(p.id, x), "Pemetaan jenis produk disimpan.")} />
                      )}
                      {bisaTulis && (
                        <Button size="sm" variant="neutral" disabled={sibuk} onClick={() => jalankan(() => api.ubahProdukPkr(p.id, { aktif: !p.aktif }), p.aktif ? "Produk dinonaktifkan." : "Produk diaktifkan.")} className="max-sm:min-h-11">
                          {p.aktif ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                      )}
                    </span>
                  </div>
                  {p.aktif && c.aktif && !c.bundel && !p.rute.ok && <p className="m-0 text-orange">{p.rute.pesan}</p>}
                  {c.bundel && bisaTulis && <EditorKomposisi kategori={c} produk={p} semuaKategori={k.kategori} sibuk={sibuk} onSimpan={(b) => jalankan(() => api.simpanKomposisiPkr(b), "Komposisi varian disimpan.")} />}
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
