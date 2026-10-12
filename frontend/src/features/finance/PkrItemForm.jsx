import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import {
  KIRIM_ITEM_OPSI, KIRIM_KOMPONEN_OPSI, MAKS_ITEM, itemBaru, bentukItem, produkKategori, daftarKategori, ubahKategoriItem, totalUnitItems, adaItemDikirim, LABEL_JENIS_KERJA,
  cariKategori, itemBundel, komposisiItem, sinkronKomponen, bentukKomponen, produkKomponen,
} from "@/features/finance/pkrItemLogic.js";

// Form item produksi Penjualan Karyawan (multi-item). Field kontekstual per kategori datang dari SERVER (katalog.bentuk) — kasur: panjang × lebar × tebal; divan: ukuran + tipe;
// sandaran: lebar/tinggi; custom: spesifikasi wajib. Set Kasur Lengkap = BUNDEL: dipecah menjadi komponen sesuai komposisi katalog (Kasur, Divan, Sandaran, …) dan tiap komponen
// memakai bidang bentuk kategorinya sendiri. Mode "baru": kategori & jumlah bisa diisi; mode "lengkapi": kategori & jumlah terkunci (struktur berubah lewat Koreksi Item);
// mode "koreksi": jumlah boleh diubah dan item boleh dihapus (diteruskan ke pratinjau dampak + alasan).

export const AREA = "min-h-[72px] w-full rounded-lg bg-surface px-2.5 py-2 text-sm leading-normal text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:min-h-[96px]";

/** Bidang kontekstual satu item/komponen: produk (pilih/ketik), dimensi, spesifikasi. `nilai` memakai kunci produkId/produkNama/panjang/lebar/tebal/tinggi/spesifikasi. */
export function BidangItem({ bentuk, produk, nilai, set, label, terkunci = false, uji = "item" }) {
  if (!bentuk) return null;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={bentuk.produk.label} required={bentuk.produk.wajib}>
          <Pilihan
            value={nilai.produkId || ""} disabled={terkunci} aria-label={`${bentuk.produk.label} ${label}`} data-testid={`${uji}-produk`}
            onChange={(v) => { set("produkId", v); if (v) set("produkNama", ""); }}
          >
            <option value="">{produk.length ? "— ketik sendiri / belum dipilih —" : "— belum ada di katalog (ketik sendiri) —"}</option>
            {produk.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
          </Pilihan>
        </Field>
        {!nilai.produkId && (
          <Field label={`${bentuk.produk.label} (ketik sendiri)`} hint="Dipakai bila tidak ada di daftar katalog.">
            <Input value={nilai.produkNama} disabled={terkunci} onChange={(e) => set("produkNama", e.target.value)} placeholder="mis. Divan laci 3 susun" aria-label={`Nama produk ${label}`} data-testid={`${uji}-produk-nama`} />
          </Field>
        )}
      </div>

      <div className={`grid gap-3 ${bentuk.dimensi.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`} data-testid={`${uji}-dimensi`}>
        {bentuk.dimensi.map((d) => (
          <Field key={d.key} label={`${d.label} (${d.satuan})`} required={d.wajib}>
            <Input
              inputMode="decimal" value={nilai[d.key] ?? ""} disabled={terkunci} onChange={(e) => set(d.key, e.target.value)}
              aria-label={`${d.label} ${label}`} data-testid={`${uji}-${d.key}`} placeholder="cm"
            />
          </Field>
        ))}
      </div>

      <Field label={bentuk.spesifikasi.label} required={bentuk.spesifikasi.keras} hint={bentuk.spesifikasi.hint}>
        <textarea
          className={AREA} value={nilai.spesifikasi} disabled={terkunci} maxLength={1000} onChange={(e) => set("spesifikasi", e.target.value)}
          aria-label={`Spesifikasi ${label}`} data-testid={`${uji}-spesifikasi`}
        />
      </Field>
    </>
  );
}

/** Satu komponen set: judul "Komponen n · Kasur Baru ×1", bidang bentuk kategorinya, dan pilihan kirim (ikut Set / dikirim / diambil sendiri). */
export function KartuKomponen({ entri, nilai, katalog, onChange, no, idx }) {
  const set = (k, v) => onChange({ ...nilai, [k]: v });
  return (
    <div className="space-y-3 rounded-lg border border-line bg-inset p-3" data-testid="komponen-set" data-komponen={entri.kategoriKode}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink">Komponen {idx + 1}</span>
        <span className="text-[12.5px] text-ink2">{entri.kategoriNama}</span>
        {entri.jumlah > 1 && <Badge variant="neutral">× {entri.jumlah} per set</Badge>}
      </div>
      <BidangItem bentuk={bentukKomponen(katalog, entri)} produk={produkKomponen(katalog, entri)} nilai={nilai} set={set} label={`item ${no} komponen ${entri.kategoriNama}`} uji="komponen" />
      <Field label="Dikirim atau diambil sendiri?">
        <Pilihan value={nilai.kirim ?? ""} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${no} komponen ${entri.kategoriNama}`} data-testid="komponen-kirim">
          {KIRIM_KOMPONEN_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Pilihan>
      </Field>
    </div>
  );
}

function KartuItem({ i, no, katalog, onChange, onHapus, mode, bisaHapus }) {
  const lengkapi = mode === "lengkapi";
  const koreksi = mode === "koreksi";
  const strukturTerkunci = lengkapi; // kategori & jumlah hanya berubah lewat Koreksi Item
  const kat = cariKategori(katalog, i.kategori);
  const bentuk = bentukItem(katalog, i);
  const produk = produkKategori(katalog, i);
  const set = (k, v) => onChange({ ...i, [k]: v });
  const terkunciSpek = (lengkapi || koreksi) && i.unitTerkunci;
  const bundel = itemBundel(katalog, i);
  const komposisi = bundel ? komposisiItem(katalog, i) : [];
  const hapus = Boolean(i.hapus);
  return (
    <div className={`space-y-3 rounded-lg border border-line bg-surface p-3 ${hapus ? "opacity-60" : ""}`} data-testid="item-produksi" data-item-no={no} data-hapus={hapus ? "ya" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`text-[13px] font-semibold text-ink ${hapus ? "line-through" : ""}`}>Item {no}</span>
          {kat && <Badge variant={kat.jenisKerja === "LAYANAN" ? "orange" : "neutral"} title={LABEL_JENIS_KERJA[kat.jenisKerja]}>{kat.bundel ? "Set kasur lengkap" : kat.jenisKerja === "LAYANAN" ? "Service/upgrade" : "Produk baru"}</Badge>}
          {i.bundel && <Badge variant="neutral" title="Komponen dari Set kasur lengkap">Bagian dari Set {i.bundel.no}</Badge>}
          {terkunciSpek && <Badge variant="neutral">Produksi sudah mulai — terkunci</Badge>}
          {hapus && <Badge variant="orange">Akan dihapus</Badge>}
        </div>
        {bisaHapus && (
          <Button size="sm" variant="neutral" aria-label={hapus ? `Batalkan hapus item ${no}` : `Hapus item ${no}`} onClick={onHapus} className="max-sm:min-h-11" data-testid="hapus-item" disabled={terkunciSpek}>
            <Trash2 size={13} /> {hapus ? "Batalkan hapus" : "Hapus"}
          </Button>
        )}
      </div>

      {!hapus && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Kategori" required>
              {mode !== "baru"
                ? <Input value={i.kategoriNama || kat?.nama || ""} disabled aria-label={`Kategori item ${no}`} />
                : (
                  <Pilihan value={i.kategori} onChange={(v) => onChange(ubahKategoriItem(katalog, i, v))} aria-label={`Kategori item ${no}`} data-testid="item-kategori">
                    <option value="">— pilih kategori —</option>
                    {daftarKategori(katalog).map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
                  </Pilihan>
                )}
            </Field>
            <Field
              label={bundel ? "Jumlah set" : "Jumlah"} required
              hint={strukturTerkunci ? "Jumlah berubah lewat “Koreksi item” (alasan wajib)." : bundel ? "Tiap set menghasilkan unit per komponen." : "Satu unit produksi per jumlah."}
            >
              <Input
                type="number" min="1" max="20" inputMode="numeric" value={i.jumlah} disabled={strukturTerkunci || terkunciSpek}
                onChange={(e) => set("jumlah", e.target.value)} aria-label={`Jumlah item ${no}`} data-testid="item-jumlah"
              />
            </Field>
          </div>

          {bundel ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Paket / set">
                  <Pilihan value={i.produkId || ""} onChange={(v) => onChange(sinkronKomponen(katalog, { ...i, produkId: v }))} aria-label={`Paket set item ${no}`} data-testid="item-produk">
                    <option value="">{produk.length ? "— set standar —" : "— set standar (belum ada varian) —"}</option>
                    {produk.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
                  </Pilihan>
                </Field>
                <Field label="Dikirim atau diambil sendiri?" hint="Berlaku untuk semua komponen kecuali dipilih lain di komponennya.">
                  <Pilihan value={i.kirim} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${no}`} data-testid="item-kirim">
                    {KIRIM_ITEM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </Pilihan>
                </Field>
              </div>
              {komposisi.length === 0
                ? <p role="alert" className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="bundel-kosong">Set ini belum punya komposisi komponen. Minta Admin mengisinya di Pengaturan Produksi › Katalog Item PKR.</p>
                : (
                  <div className="space-y-2" data-testid="komponen-daftar">
                    <p className="m-0 text-[12px] text-ink3">Set ini dipecah menjadi {komposisi.length} komponen operasional — tiap komponen jadi unit produksinya sendiri dengan ukuran dan rute sendiri.</p>
                    {komposisi.map((entri, idx) => (
                      <KartuKomponen
                        key={`${entri.kategoriKode}-${idx}`} entri={entri} idx={idx} no={no} katalog={katalog}
                        nilai={(i.komponen ?? [])[idx] ?? { produkId: "", produkNama: "", panjang: "", lebar: "", tebal: "", tinggi: "", spesifikasi: "", kirim: "" }}
                        onChange={(k) => onChange({ ...i, komponen: komposisi.map((_, n) => (n === idx ? { ...k, kategoriKode: entri.kategoriKode } : (i.komponen ?? [])[n] ?? { produkId: "", produkNama: "", panjang: "", lebar: "", tebal: "", tinggi: "", spesifikasi: "", kirim: "", kategoriKode: komposisi[n].kategoriKode })) })}
                      />
                    ))}
                  </div>
                )}
            </>
          ) : (
            <>
              <BidangItem bentuk={bentuk} produk={produk} nilai={i} set={set} label={`item ${no}`} terkunci={terkunciSpek} uji="item" />
              <Field label="Dikirim atau diambil sendiri?">
                <Pilihan value={i.kirim} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${no}`} data-testid="item-kirim">
                  {KIRIM_ITEM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </Pilihan>
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Daftar item + logistik. `nilai` = { items, alamat, kota, tanggalKirim }.
 * mode "baru": tombol "+ Tambah Item Produksi" dan hapus; mode "lengkapi": hanya spesifikasi/pilihan kirim per item;
 * mode "koreksi": jumlah + spesifikasi + hapus (tanda "Akan dihapus") untuk item yang ada; item baru ditambahkan lewat daftar terpisah (`nilai.baru`) oleh pemanggil.
 */
export function FormItemProduksi({ katalog, nilai, onChange, mode = "baru", memuat = false, galatMuat = "", sembunyikanLogistik = false, bolehKosong = false }) {
  const lengkapi = mode === "lengkapi";
  const koreksi = mode === "koreksi";
  const tetap = lengkapi || koreksi; // struktur item yang ada tidak ditambah/dihapus di form ini
  const set = (k, v) => onChange({ ...nilai, [k]: v });
  const ubahItem = (idx, item) => set("items", nilai.items.map((x, n) => (n === idx ? item : x)));
  if (galatMuat) return <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galatMuat}</p>;
  if (memuat || !katalog) return <p className="text-[12.5px] text-ink3" role="status">Memuat katalog item…</p>;
  const total = totalUnitItems(nilai.items, katalog);
  return (
    <div className="space-y-3" data-testid="form-item-produksi">
      {nilai.items.map((i, idx) => (
        <KartuItem
          key={i.kunci} i={i} no={tetap ? i.no : idx + 1} katalog={katalog} mode={mode} onChange={(it) => ubahItem(idx, it)}
          bisaHapus={koreksi || (!lengkapi && (nilai.items.length > 1 || bolehKosong))}
          onHapus={() => (koreksi ? ubahItem(idx, { ...i, hapus: !i.hapus }) : set("items", nilai.items.filter((_, n) => n !== idx)))}
        />
      ))}
      {!tetap && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="neutral" disabled={nilai.items.length >= MAKS_ITEM} onClick={() => set("items", [...nilai.items, itemBaru()])} className="max-sm:min-h-11" data-testid="tambah-item">
            <Plus size={13} /> Tambah Item Produksi
          </Button>
          <p className="m-0 text-[12.5px] text-ink2" data-testid="total-unit">{nilai.items.length} item · <strong className="text-ink">{total} unit</strong> produksi</p>
        </div>
      )}
      {!sembunyikanLogistik && adaItemDikirim(nilai.items, katalog) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="logistik-kirim">
          <Field label="Alamat pengiriman" className="sm:col-span-2" hint="Satu alamat untuk semua item yang dikirim."><Input value={nilai.alamat} onChange={(e) => set("alamat", e.target.value)} placeholder="mis. Jl. Mawar 5, Bekasi" /></Field>
          <Field label="Kota"><Input value={nilai.kota} onChange={(e) => set("kota", e.target.value)} /></Field>
          <Field label="Rencana tanggal kirim" hint="Opsional. Penjadwalan sebenarnya dilakukan Delivery."><Input type="date" value={nilai.tanggalKirim} onChange={(e) => set("tanggalKirim", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}
