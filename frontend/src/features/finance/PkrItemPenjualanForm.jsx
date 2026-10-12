import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan, InputUang, formatUang } from "@/features/finance/shared.jsx";
import { BidangItem, KartuKomponen, AREA } from "@/features/finance/PkrItemForm.jsx";
import {
  KIRIM_ITEM_OPSI, MAKS_ITEM, itemPenjualanBaru, bentukItem, produkKategori, ubahKategoriItem, adaItemDikirim, cariKategori, itemBundel, komposisiItem, sinkronKomponen,
  infoPemenuhan, punyaUnitPemenuhan, kategoriUntukPemenuhan, ubahPemenuhanItem, subtotalPenjualan, totalPenjualan, totalUnitItems,
} from "@/features/finance/pkrItemLogic.js";

// ITEM PENJUALAN & PEMENUHAN (Penjualan Karyawan) — SATU daftar item. Tiap baris memuat sekaligus: cara pemenuhan, kategori/produk katalog, jumlah, harga satuan, ukuran + spesifikasi
// yang relevan untuk kategorinya, dan dikirim/diambil sendiri. Dari baris yang sama server menghitung total/piutang/jurnal (Finance) dan membuat item order, unit Produksi, serta
// pengiriman/pickup — tidak ada input kedua. Pemenuhan SELALU dipilih eksplisit (tidak ditebak dari kategori). Set Kasur Lengkap: satu harga induk, komponen Kasur/Divan/Sandaran tanpa harga sendiri.

// Warna badge pemenuhan diturunkan dari definisi server (unit/jenis kerja), bukan dari daftar kode di layar.
const warnaPemenuhan = (p) => (p.unit ? (p.jenisKerja === "LAYANAN" ? "orange" : "neutral") : "accent");

function KartuPenjualan({ i, no, katalog, onChange, onHapus, bisaHapus }) {
  const set = (k, v) => onChange({ ...i, [k]: v });
  const info = infoPemenuhan(katalog, i.pemenuhan);
  const unit = Boolean(info?.unit);
  const kat = cariKategori(katalog, i.kategori);
  const bentuk = bentukItem(katalog, i);
  const produk = produkKategori(katalog, i);
  const bundel = itemBundel(katalog, i);
  const komposisi = bundel ? komposisiItem(katalog, i) : [];
  const kategoriOpsi = kategoriUntukPemenuhan(katalog, i.pemenuhan);
  const sub = subtotalPenjualan(i);
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-3" data-testid="item-penjualan" data-item-no={no}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">Item {no}</span>
          {info && <Badge variant={warnaPemenuhan(info)} data-testid="badge-pemenuhan">{info.label}</Badge>}
          {bundel && <Badge variant="neutral" title="Satu harga untuk satu Set; komponennya tidak punya harga sendiri">Set — satu harga induk</Badge>}
        </div>
        {bisaHapus && (
          <Button size="sm" variant="neutral" aria-label={`Hapus item ${no}`} onClick={onHapus} className="max-sm:min-h-11" data-testid="hapus-item-penjualan">
            <Trash2 size={13} /> Hapus
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Cara pemenuhan" required hint={info ? undefined : "Dipilih eksplisit — tidak ditebak dari kategori."}>
          <Pilihan value={i.pemenuhan} onChange={(v) => onChange(ubahPemenuhanItem(katalog, i, v))} aria-label={`Cara pemenuhan item ${no}`} data-testid="item-pemenuhan">
            <option value="">— pilih cara pemenuhan —</option>
            {(katalog?.pemenuhan ?? []).map((p) => <option key={p.kode} value={p.kode}>{p.label}</option>)}
          </Pilihan>
        </Field>
        <Field label="Kategori" required={unit} hint={info && !unit ? "Opsional untuk item tanpa unit Produksi." : undefined}>
          <Pilihan value={i.kategori} disabled={!info} onChange={(v) => onChange(ubahKategoriItem(katalog, i, v))} aria-label={`Kategori item ${no}`} data-testid="item-kategori">
            <option value="">{unit ? "— pilih kategori —" : "— tanpa kategori —"}</option>
            {kategoriOpsi.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
          </Pilihan>
        </Field>
      </div>

      {info && (
        <>
          {!unit && (
            <Field label="Nama item" required hint="Tampil di tagihan Penjualan Karyawan.">
              <Input value={i.nama} onChange={(e) => set("nama", e.target.value)} placeholder="mis. Bantal Sano atau Biaya jasa pasang" aria-label={`Nama item ${no}`} data-testid="item-nama" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="baris-harga">
            <Field label={bundel ? "Jumlah set" : "Jumlah"} required hint={unit ? "Satu unit produksi per jumlah." : "Boleh pecahan, mis. 1,6."}>
              <Input
                type="text" inputMode="decimal" value={i.jumlah} onChange={(e) => set("jumlah", e.target.value)}
                aria-label={`Jumlah item ${no}`} data-testid="item-jumlah" title={unit ? "Bilangan bulat" : "Boleh pecahan, mis. 1,6 (maks 3 angka di belakang koma)"}
              />
            </Field>
            <Field label={bundel ? "Harga satu set" : "Harga satuan"} required>
              <InputUang value={i.harga} onChange={(v) => set("harga", v)} aria-label={`Harga item ${no}`} data-testid="item-harga" />
            </Field>
            <div className="col-span-2 flex flex-col justify-end sm:col-span-1">
              <p className="m-0 text-[11.5px] text-ink3">Subtotal</p>
              <p className="m-0 text-[15px] font-semibold tabular-nums text-ink" data-testid="item-subtotal">{formatUang(sub)}</p>
            </div>
          </div>
        </>
      )}

      {info && unit && kat && (bundel ? (
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
                <p className="m-0 text-[12px] text-ink3">Set ini dipecah menjadi {komposisi.length} komponen operasional — tiap komponen jadi unit produksinya sendiri; harga tetap satu di baris ini.</p>
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
          <BidangItem bentuk={bentuk} produk={produk} nilai={i} set={set} label={`item ${no}`} uji="item" />
          <Field label="Dikirim atau diambil sendiri?">
            <Pilihan value={i.kirim} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${no}`} data-testid="item-kirim">
              {KIRIM_ITEM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Pilihan>
          </Field>
        </>
      ))}

      {info && !unit && (
        <Field label="Catatan item" hint="Opsional.">
          <textarea className={AREA} value={i.spesifikasi} maxLength={1000} onChange={(e) => set("spesifikasi", e.target.value)} aria-label={`Catatan item ${no}`} data-testid="item-catatan" />
        </Field>
      )}
    </div>
  );
}

/**
 * Daftar Item Penjualan & Pemenuhan. `nilai` = { items, alamat, kota, tanggalKirim }. Dipakai pembuatan penjualan dan "tambah item" di koreksi.
 * Total (pratinjau) dihitung dari baris yang sama; server menghitung ulang dan tidak pernah menerima total dari klien.
 */
export function FormItemPenjualan({ katalog, nilai, onChange, memuat = false, galatMuat = "", sembunyikanLogistik = false, bolehKosong = false }) {
  const set = (k, v) => onChange({ ...nilai, [k]: v });
  const ubah = (idx, item) => set("items", nilai.items.map((x, n) => (n === idx ? item : x)));
  if (galatMuat) return <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galatMuat}</p>;
  if (memuat || !katalog) return <p className="text-[12.5px] text-ink3" role="status">Memuat katalog item…</p>;
  const unitItems = nilai.items.filter((i) => punyaUnitPemenuhan(katalog, i.pemenuhan));
  const unit = totalUnitItems(unitItems, katalog);
  const total = totalPenjualan(nilai.items);
  return (
    <div className="space-y-3" data-testid="form-item-penjualan">
      {nilai.items.map((i, idx) => (
        <KartuPenjualan
          key={i.kunci} i={i} no={idx + 1} katalog={katalog} onChange={(it) => ubah(idx, it)}
          bisaHapus={nilai.items.length > 1 || bolehKosong}
          onHapus={() => set("items", nilai.items.filter((_, n) => n !== idx))}
        />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="neutral" disabled={nilai.items.length >= MAKS_ITEM} onClick={() => set("items", [...nilai.items, itemPenjualanBaru()])} className="max-sm:min-h-11" data-testid="tambah-item-penjualan">
          <Plus size={13} /> Tambah Item
        </Button>
        <p className="m-0 text-[13px] text-ink2">
          {nilai.items.length} item · <span data-testid="total-unit">{unit} unit</span> produksi · Total: <strong className="text-ink" data-testid="total-penjualan">{formatUang(total)}</strong>
        </p>
      </div>
      {!sembunyikanLogistik && adaItemDikirim(unitItems, katalog) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="logistik-kirim">
          <Field label="Alamat pengiriman" className="sm:col-span-2" hint="Satu alamat untuk semua item yang dikirim."><Input value={nilai.alamat} onChange={(e) => set("alamat", e.target.value)} placeholder="mis. Jl. Mawar 5, Bekasi" /></Field>
          <Field label="Kota"><Input value={nilai.kota} onChange={(e) => set("kota", e.target.value)} /></Field>
          <Field label="Rencana tanggal kirim" hint="Opsional. Penjadwalan sebenarnya dilakukan Delivery."><Input type="date" value={nilai.tanggalKirim} onChange={(e) => set("tanggalKirim", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}
