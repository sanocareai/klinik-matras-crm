import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, UserCheck, UserPlus } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Pilihan } from "@/features/finance/shared.jsx";
import { KOTA_LIST } from "@/utils/format.js";
import { normalisasiNomorTelepon, tampilNomor } from "@/utils/nomorTelepon.js";
import { validasiLinkMaps } from "@/utils/mapsLink.js";

// BAGIAN FORM PEMBELI / PENERIMA / ALAMAT / KEBUTUHAN untuk Penjualan Karyawan. Dipakai SAMA oleh wizard "Catat Penjualan" dan dialog "Edit Data Customer"
// (satu komponen, satu aturan). Pilihan kota = KOTA_LIST yang sama dengan form Order Sales CRM; link Maps divalidasi helper yang sama dengan server.
// Tiga identitas dipisahkan: karyawan penjual (di bagian Transaksi), customer/pembeli, dan penerima.

const AreaTeks = ({ value, onChange, placeholder, rows = 3, ...p }) => (
  <textarea
    value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
    className="w-full rounded-lg bg-surface px-2.5 py-2 text-sm leading-normal text-ink outline-none transition-colors placeholder:text-ink3 focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:text-[15px]"
    {...p}
  />
);

/** Cari customer lewat nomor (debounce) — HANYA membaca. Mengembalikan { status, hasil } untuk ditampilkan. */
export function useCariCustomer(telepon, aktif) {
  const [st, setSt] = useState({ status: "diam", hasil: null, galat: null });
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!aktif) { setSt({ status: "diam", hasil: null, galat: null }); return undefined; }
    const n = normalisasiNomorTelepon(telepon);
    if (!String(telepon ?? "").trim()) { setSt({ status: "diam", hasil: null, galat: null }); return undefined; }
    if (!n.ok) { setSt({ status: "salah", hasil: null, galat: n.galat }); return undefined; }
    setSt((s) => ({ ...s, status: "mencari", galat: null }));
    let batal = false;
    timer.current = setTimeout(() => {
      api.cariPembeliPenjualanKaryawan(telepon).then((h) => { if (!batal) setSt({ status: h.ditemukan ? "ada" : "baru", hasil: h, galat: null }); })
        .catch((e) => { if (!batal) setSt({ status: "galat", hasil: null, galat: e.message || "Gagal mencari customer" }); });
    }, 450);
    return () => { batal = true; clearTimeout(timer.current); };
  }, [telepon, aktif]);
  return st;
}

function StatusCari({ st }) {
  if (st.status === "diam") return null;
  if (st.status === "mencari") return <p className="m-0 text-[12px] text-ink3" data-testid="cari-customer">Mencari customer…</p>;
  if (st.status === "salah" || st.status === "galat") return <p role="alert" className="m-0 text-[12px] text-red" data-testid="cari-customer">{st.galat}</p>;
  if (st.status === "baru") {
    return <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink2" data-testid="cari-customer"><UserPlus size={13} aria-hidden="true" /> Nomor belum terdaftar — customer baru akan dibuat saat dicatat (sumber “Penjualan Karyawan”).</p>;
  }
  const c = st.hasil.customer;
  if (!st.hasil.bisaDipakai) return <p role="alert" className="m-0 text-[12px] text-red" data-testid="cari-customer">{st.hasil.alasan}</p>;
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-ink2" data-testid="cari-customer">
      <UserCheck size={13} aria-hidden="true" className="text-green" />
      Customer ditemukan: <strong className="text-ink">{c.nama || "Tanpa nama"}</strong>{c.kota ? ` · ${c.kota}` : ""}
      <Badge variant="neutral">{c.jumlahOrder} order</Badge>
      <span className="basis-full text-ink3">Order ini ditautkan ke customer tersebut; datanya tidak ditimpa.</span>
    </p>
  );
}

/** Langkah 2 — Customer & penerima. `f` = { buyerName, pembeli{…} }; `setBuyer(nama)`, `setP(kunci, nilai)`. */
export function BagianCustomerPenerima({ f, setBuyer, setP, bolehKaryawan = true, kunciPenerima = false, labelNomor = "Nomor WhatsApp/telepon" }) {
  const p = f.pembeli;
  const st = useCariCustomer(p.telepon, !p.adalahKaryawan);
  return (
    <div className="space-y-3" data-testid="bagian-customer">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nama pembeli" required hint="Customer sebenarnya (bukan karyawan penjual)">
          <Input value={f.buyerName} onChange={(e) => setBuyer(e.target.value)} placeholder="mis. Bpk. Indra" aria-label="Nama pembeli" />
        </Field>
        <Field label={labelNomor} required={!p.adalahKaryawan} hint={p.adalahKaryawan ? "Tidak perlu — pembeli adalah karyawan penjual" : "Dipakai mencari customer yang sudah ada (tanpa duplikat)"}>
          <Input
            value={p.telepon} onChange={(e) => setP("telepon", e.target.value)} disabled={p.adalahKaryawan} inputMode="tel" placeholder="mis. 0812-3456-7890"
            aria-label="Nomor WhatsApp pembeli"
          />
        </Field>
      </div>
      {!p.adalahKaryawan && <StatusCari st={st} />}
      {bolehKaryawan && (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink2">
          <input type="checkbox" checked={p.adalahKaryawan} onChange={(e) => setP("adalahKaryawan", e.target.checked)} className="accent-[var(--accent)]" data-testid="pembeli-karyawan" />
          Pembeli adalah karyawan penjual itu sendiri
        </label>
      )}
      <fieldset className="space-y-2 rounded-lg bg-inset px-3 py-2.5">
        <legend className="px-1 text-[12px] font-semibold text-ink2">Penerima barang/layanan</legend>
        <div className="flex flex-wrap gap-4 text-[13px] text-ink2">
          <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="penerima" checked={!p.penerimaBeda} disabled={kunciPenerima} onChange={() => setP("penerimaBeda", false)} className="accent-[var(--accent)]" /> Sama dengan pembeli</label>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="penerima" checked={p.penerimaBeda} disabled={kunciPenerima} onChange={() => setP("penerimaBeda", true)} className="accent-[var(--accent)]" data-testid="penerima-beda" /> Berbeda</label>
        </div>
        {p.penerimaBeda && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nama penerima" required><Input value={p.penerimaNama} disabled={kunciPenerima} onChange={(e) => setP("penerimaNama", e.target.value)} aria-label="Nama penerima" /></Field>
            <Field label="Nomor penerima" hint="Opsional"><Input value={p.penerimaTelepon} disabled={kunciPenerima} onChange={(e) => setP("penerimaTelepon", e.target.value)} inputMode="tel" aria-label="Nomor penerima" /></Field>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** Link Maps + tombol buka — validasi dekat field. */
export function FieldLinkMaps({ value, onChange, label = "Link Google Maps", disabled = false }) {
  const m = validasiLinkMaps(value);
  return (
    <Field label={label} hint={!value ? "Tempel link share lokasi dari Google Maps (disarankan agar Delivery tidak mencari manual)" : undefined}>
      <div className="flex items-center gap-2">
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="https://maps.app.goo.gl/…" inputMode="url" aria-label={label} aria-invalid={!m.ok} disabled={disabled} />
        {m.ok && m.url && (
          <a href={m.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-inset px-2.5 text-[12.5px] font-semibold text-accent hover:bg-hovertint max-sm:h-11" data-testid="buka-maps">
            <ExternalLink size={13} aria-hidden="true" /> Buka Maps
          </a>
        )}
      </div>
      {!m.ok && <p role="alert" className="mt-1 text-[12px] text-red" data-testid="galat-maps">{m.galat}</p>}
    </Field>
  );
}

/** Langkah 3 — Alamat & lokasi. `alamat/kota/tanggalKirim` hidup di `daftar` (sama dengan form item); lokasi/patokan di `pembeli`. */
export function BagianAlamatLokasi({ daftar, setDaftar, pembeli, setP, perluAlamat = false, tanggalKirim = true, kunciAlamat = false }) {
  return (
    <div className="space-y-3" data-testid="bagian-alamat">
      <Field label="Alamat lengkap" required={perluAlamat} hint={perluAlamat ? "Wajib karena ada item yang dikirim" : "Isi bila barang akan dikirim"}>
        <AreaTeks value={daftar.alamat} onChange={(v) => setDaftar("alamat", v)} disabled={kunciAlamat} placeholder="Nama jalan, nomor, RT/RW, kelurahan, kecamatan…" aria-label="Alamat lengkap" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kota">
          <Pilihan value={daftar.kota} onChange={(v) => setDaftar("kota", v)} aria-label="Kota" disabled={kunciAlamat}>
            <option value="">— Pilih kota —</option>
            {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
            {daftar.kota && !KOTA_LIST.includes(daftar.kota) && <option value={daftar.kota}>{daftar.kota}</option>}
          </Pilihan>
        </Field>
        <Field label="Patokan lokasi" hint="mis. depan minimarket, pagar hitam"><Input value={pembeli.patokan} disabled={kunciAlamat} onChange={(e) => setP("patokan", e.target.value)} aria-label="Patokan lokasi" /></Field>
      </div>
      <FieldLinkMaps value={pembeli.lokasiUrl} onChange={(v) => setP("lokasiUrl", v)} disabled={kunciAlamat} />
      {tanggalKirim && (
        <Field label="Rencana tanggal kirim" hint="Opsional. Penjadwalan sebenarnya dilakukan Delivery.">
          <Input type="date" value={daftar.tanggalKirim} onChange={(e) => setDaftar("tanggalKirim", e.target.value)} aria-label="Rencana tanggal kirim" />
        </Field>
      )}
    </div>
  );
}

/** Langkah 4 — Keluhan & kebutuhan (+ catatan per divisi + waktu yang disarankan). */
export function BagianKebutuhan({ pembeli, setP }) {
  return (
    <div className="space-y-3" data-testid="bagian-kebutuhan">
      <Field label="Keluhan customer" hint="mis. pegal pinggang saat bangun tidur"><AreaTeks value={pembeli.keluhan} onChange={(v) => setP("keluhan", v)} aria-label="Keluhan customer" /></Field>
      <Field label="Catatan umum"><AreaTeks value={pembeli.catatanOrder} onChange={(v) => setP("catatanOrder", v)} rows={2} aria-label="Catatan umum" /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Catatan untuk Produksi"><AreaTeks value={pembeli.catatanProduksi} onChange={(v) => setP("catatanProduksi", v)} rows={3} aria-label="Catatan Produksi" /></Field>
        <Field label="Catatan untuk Delivery"><AreaTeks value={pembeli.catatanDelivery} onChange={(v) => setP("catatanDelivery", v)} rows={3} aria-label="Catatan Delivery" /></Field>
        <Field label="Waktu pickup yang disarankan" hint="mis. pagi sebelum jam 10"><Input value={pembeli.waktuPickup} onChange={(e) => setP("waktuPickup", e.target.value)} aria-label="Waktu pickup" /></Field>
        <Field label="Waktu pengiriman yang disarankan" hint="mis. sore setelah jam 3"><Input value={pembeli.waktuKirim} onChange={(e) => setP("waktuKirim", e.target.value)} aria-label="Waktu pengiriman" /></Field>
      </div>
    </div>
  );
}

export { Search as IkonCari, AreaTeks, tampilNomor };
