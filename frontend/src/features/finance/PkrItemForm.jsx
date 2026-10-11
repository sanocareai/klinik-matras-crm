import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import {
  KIRIM_ITEM_OPSI, MAKS_ITEM, itemBaru, bentukItem, produkKategori, daftarKategori, ubahKategoriItem, totalUnitItems, adaItemDikirim, LABEL_JENIS_KERJA, cariKategori,
} from "@/features/finance/pkrItemLogic.js";

// Form item produksi Penjualan Karyawan (multi-item). Field kontekstual per kategori datang dari SERVER (katalog.bentuk) — kasur: panjang × lebar × tebal; divan: ukuran + tipe;
// sandaran: lebar/tinggi; custom: spesifikasi wajib. Mode "baru": kategori & jumlah bisa diisi; mode "lengkapi": kategori & jumlah terkunci (struktur tidak berubah setelah order ada).

const AREA = "min-h-[72px] w-full rounded-lg bg-surface px-2.5 py-2 text-sm leading-normal text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:min-h-[96px]";

function KartuItem({ i, no, katalog, onChange, onHapus, mode, bisaHapus }) {
  const lengkapi = mode === "lengkapi";
  const kat = cariKategori(katalog, i.kategori);
  const bentuk = bentukItem(katalog, i);
  const produk = produkKategori(katalog, i);
  const set = (k, v) => onChange({ ...i, [k]: v });
  const terkunciSpek = lengkapi && i.unitTerkunci;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-3" data-testid="item-produksi" data-item-no={no}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">Item {no}</span>
          {kat && <Badge variant={kat.jenisKerja === "LAYANAN" ? "orange" : "neutral"} title={LABEL_JENIS_KERJA[kat.jenisKerja]}>{kat.jenisKerja === "LAYANAN" ? "Service/upgrade" : "Produk baru"}</Badge>}
          {terkunciSpek && <Badge variant="neutral">Produksi sudah mulai — spesifikasi terkunci</Badge>}
        </div>
        {bisaHapus && (
          <Button size="sm" variant="neutral" aria-label={`Hapus item ${no}`} onClick={onHapus} className="max-sm:min-h-11" data-testid="hapus-item"><Trash2 size={13} /> Hapus</Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kategori" required>
          {lengkapi
            ? <Input value={i.kategoriNama || kat?.nama || ""} disabled aria-label={`Kategori item ${no}`} />
            : (
              <Pilihan value={i.kategori} onChange={(v) => onChange(ubahKategoriItem(katalog, i, v))} aria-label={`Kategori item ${no}`} data-testid="item-kategori">
                <option value="">— pilih kategori —</option>
                {daftarKategori(katalog).map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
              </Pilihan>
            )}
        </Field>
        <Field label="Jumlah" required hint={lengkapi ? "Jumlah tidak berubah setelah order dibuat." : "Satu unit produksi per jumlah."}>
          <Input type="number" min="1" max="20" inputMode="numeric" value={i.jumlah} disabled={lengkapi} onChange={(e) => set("jumlah", e.target.value)} aria-label={`Jumlah item ${no}`} data-testid="item-jumlah" />
        </Field>
      </div>

      {bentuk && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={bentuk.produk.label} required={bentuk.produk.wajib}>
              <Pilihan
                value={i.produkId || ""} disabled={terkunciSpek} aria-label={`${bentuk.produk.label} item ${no}`} data-testid="item-produk"
                onChange={(v) => onChange({ ...i, produkId: v, produkNama: v ? "" : i.produkNama })}
              >
                <option value="">{produk.length ? "— ketik sendiri / belum dipilih —" : "— belum ada di katalog (ketik sendiri) —"}</option>
                {produk.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
              </Pilihan>
            </Field>
            {!i.produkId && (
              <Field label={`${bentuk.produk.label} (ketik sendiri)`} hint="Dipakai bila tidak ada di daftar katalog.">
                <Input value={i.produkNama} disabled={terkunciSpek} onChange={(e) => set("produkNama", e.target.value)} placeholder="mis. Divan laci 3 susun" aria-label={`Nama produk item ${no}`} data-testid="item-produk-nama" />
              </Field>
            )}
          </div>

          <div className={`grid gap-3 ${bentuk.dimensi.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`} data-testid="item-dimensi">
            {bentuk.dimensi.map((d) => (
              <Field key={d.key} label={`${d.label} (${d.satuan})`} required={d.wajib}>
                <Input
                  inputMode="decimal" value={i[d.key] ?? ""} disabled={terkunciSpek} onChange={(e) => set(d.key, e.target.value)}
                  aria-label={`${d.label} item ${no}`} data-testid={`item-${d.key}`} placeholder="cm"
                />
              </Field>
            ))}
          </div>

          <Field label={bentuk.spesifikasi.label} required={bentuk.spesifikasi.keras} hint={bentuk.spesifikasi.hint}>
            <textarea
              className={AREA} value={i.spesifikasi} disabled={terkunciSpek} maxLength={1000} onChange={(e) => set("spesifikasi", e.target.value)}
              aria-label={`Spesifikasi item ${no}`} data-testid="item-spesifikasi"
            />
          </Field>
        </>
      )}

      <Field label="Dikirim atau diambil sendiri?">
        <Pilihan value={i.kirim} onChange={(v) => set("kirim", v)} aria-label={`Dikirim atau diambil sendiri item ${no}`} data-testid="item-kirim">
          {KIRIM_ITEM_OPSI.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Pilihan>
      </Field>
    </div>
  );
}

/**
 * Daftar item + logistik. `nilai` = { items, alamat, kota, tanggalKirim }.
 * mode "baru": tombol "+ Tambah Item Produksi" dan hapus; mode "lengkapi": hanya spesifikasi/pilihan kirim per item.
 */
export function FormItemProduksi({ katalog, nilai, onChange, mode = "baru", memuat = false, galatMuat = "" }) {
  const lengkapi = mode === "lengkapi";
  const set = (k, v) => onChange({ ...nilai, [k]: v });
  const ubahItem = (idx, item) => set("items", nilai.items.map((x, n) => (n === idx ? item : x)));
  if (galatMuat) return <p role="alert" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galatMuat}</p>;
  if (memuat || !katalog) return <p className="text-[12.5px] text-ink3" role="status">Memuat katalog item…</p>;
  const total = totalUnitItems(nilai.items);
  return (
    <div className="space-y-3" data-testid="form-item-produksi">
      {nilai.items.map((i, idx) => (
        <KartuItem
          key={i.kunci} i={i} no={lengkapi ? i.no : idx + 1} katalog={katalog} mode={mode} onChange={(it) => ubahItem(idx, it)}
          bisaHapus={!lengkapi && nilai.items.length > 1} onHapus={() => set("items", nilai.items.filter((_, n) => n !== idx))}
        />
      ))}
      {!lengkapi && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="neutral" disabled={nilai.items.length >= MAKS_ITEM} onClick={() => set("items", [...nilai.items, itemBaru()])} className="max-sm:min-h-11" data-testid="tambah-item">
            <Plus size={13} /> Tambah Item Produksi
          </Button>
          <p className="m-0 text-[12.5px] text-ink2" data-testid="total-unit">{nilai.items.length} item · <strong className="text-ink">{total} unit</strong> produksi</p>
        </div>
      )}
      {adaItemDikirim(nilai.items) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="logistik-kirim">
          <Field label="Alamat pengiriman" className="sm:col-span-2" hint="Satu alamat untuk semua item yang dikirim."><Input value={nilai.alamat} onChange={(e) => set("alamat", e.target.value)} placeholder="mis. Jl. Mawar 5, Bekasi" /></Field>
          <Field label="Kota"><Input value={nilai.kota} onChange={(e) => set("kota", e.target.value)} /></Field>
          <Field label="Rencana tanggal kirim" hint="Opsional. Penjadwalan sebenarnya dilakukan Delivery."><Input type="date" value={nilai.tanggalKirim} onChange={(e) => set("tanggalKirim", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}
