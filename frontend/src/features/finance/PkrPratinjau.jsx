import React from "react";
import { AlertTriangle, CheckCircle2, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";

// Pratinjau SERVER sebelum "Catat Penjualan" / "Buat Order CRM": apa yang AKAN dibuat (order, item, unit, job pickup, job pengiriman) dan yang TIDAK dibuat (uang). Tanpa nominal.
// `data` = respons POST /finance/penjualan-karyawan/order-crm/pratinjau. Produk tanpa pemetaan rute Produksi DIBLOKIR di sini (valid:false) dengan arah tindakan untuk Admin.
export function GalatPratinjau({ galat, className = "" }) {
  const daftar = Array.isArray(galat?.rute) ? galat.rute : [];
  return (
    <div role="alert" className={`space-y-2 rounded-lg bg-redbg px-3 py-2.5 text-[12.5px] text-red ${className}`} data-testid="pratinjau-galat">
      <p className="m-0 flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{galat?.pesan || "Isian belum valid"}</span></p>
      {daftar.length > 1 && (
        <ul className="m-0 list-disc space-y-0.5 pl-9" data-testid="pratinjau-galat-rute">
          {daftar.map((r) => <li key={r.no}>Item {r.no}{r.produk ? ` (${r.produk})` : ""}</li>)}
        </ul>
      )}
      {galat?.aksi && (
        <p className="m-0 pl-6 text-ink2" data-testid="pratinjau-galat-aksi">
          Tindakan: minta Admin memetakan rute Produksi di <strong className="text-ink">{galat.aksi}</strong>, lalu buat ulang pratinjau. Penjualan belum dicatat.
        </p>
      )}
      {galat?.petunjuk && <p className="m-0 pl-6 text-ink2" data-testid="pratinjau-galat-petunjuk">{galat.petunjuk}</p>}
    </div>
  );
}

function RuteBaris({ rute, jenisKerja }) {
  if (!rute) return null;
  const teks = jenisKerja === "LAYANAN" ? "Rute Produksi: layanan produksi dari katalog" : rute.alurLabel || "Rute Produksi terpetakan";
  return <p className="m-0 mt-1 flex items-center gap-1.5 text-[12px] text-ink3" data-testid="pratinjau-rute"><Route size={12} className="shrink-0" /> {teks}</p>;
}

export function PratinjauOrderPkr({ data, className = "" }) {
  if (!data) return null;
  if (!data.valid) return <GalatPratinjau galat={data.galat} className={className} />;
  const d = data;
  const kategori = d.order.kategoriLabel || d.order.kategori;
  return (
    <div className={`space-y-3 ${className}`} data-testid="pratinjau-order">
      {d.sudahAdaOrder && (
        <p role="status" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-sudah-ada">
          Penjualan ini sudah punya order {d.sudahAdaOrder.nomor}. Tidak ada order baru yang dibuat; gunakan “Lengkapi spesifikasi” untuk mengubah.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pratinjau-ringkas">
        {[["Item", d.order.jumlahItem], ["Unit produksi", d.order.jumlahUnit], ["Job pickup", d.pickup.adaJob ? "1" : "0"], ["Job pengiriman", d.delivery.adaJobPengiriman ? "1" : "0"]].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-inset px-3 py-2"><p className="m-0 text-[11px] text-ink3">{l}</p><p className="m-0 text-[15px] font-semibold tabular-nums text-ink">{v}</p></div>
        ))}
      </div>
      <p className="m-0 text-[12.5px] text-ink2" data-testid="pratinjau-kategori">Kategori order: <strong className="text-ink">{kategori}</strong></p>

      <ul className="m-0 list-none space-y-2 p-0" data-testid="pratinjau-item">
        {d.items.map((i) => (
          <li key={i.no} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Item {i.no}</span>
              <span className="text-ink2">{i.kategoriNama}{i.produk ? ` · ${i.produk}` : ""}</span>
              <Badge variant="neutral">× {i.jumlah}</Badge>
              <Badge variant={i.perluDikirim === true ? "accent" : "neutral"}>{i.kirimLabel}</Badge>
              {i.bundel && <Badge variant="neutral" title="Komponen dari Set kasur lengkap">Set {i.bundel.no}{i.bundel.nama ? ` · ${i.bundel.nama}` : ""}</Badge>}
            </div>
            <p className="m-0 mt-1 text-ink2">{i.ukuran || "Ukuran belum diisi"}{i.spesifikasi ? ` — ${i.spesifikasi}` : ""}</p>
            <p className="m-0 mt-1 text-[12px] text-ink3">Unit {i.unit.nomorUnit.join(", ")}: {i.unit.statusAwalLabel}{i.layananProduksiOtomatis ? " · layanan produksi ditetapkan dari katalog" : ""}</p>
            <RuteBaris rute={i.rute} jenisKerja={i.jenisKerja} />
            {i.kurang.length > 0 && <p className="m-0 mt-1 text-[12px] text-orange" data-testid="pratinjau-kurang">Belum diisi: {i.kurang.join(", ")}</p>}
          </li>
        ))}
      </ul>

      <div className={`rounded-lg px-3 py-2 text-[12.5px] ${d.produksi.lengkap ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`} data-testid="pratinjau-produksi">
        <strong>{d.produksi.status}.</strong>{" "}
        {d.produksi.lengkap ? "Semua data item dan pilihan kirim sudah terisi." : `Data yang kurang: ${d.produksi.kurang.join("; ")}. Order tetap dibuat; item yang belum lengkap tidak bisa dijadwalkan sampai dilengkapi (item lain tidak ikut tertahan).`}
      </div>

      {d.delivery.catatan && <p className="m-0 text-[12px] text-ink3" data-testid="pratinjau-delivery">{d.delivery.catatan}{d.delivery.itemDiambilSendiri.length ? ` Item ${d.delivery.itemDiambilSendiri.join(", ")} diambil sendiri (tanpa pengiriman).` : ""}</p>}

      {d.peringatan.map((w) => (
        <p key={w.kode} role="status" className="m-0 flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pratinjau-peringatan">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w.pesan}</span>
        </p>
      ))}

      <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="pratinjau-tidak-dibuat">
        <p className="m-0 mb-1 flex items-center gap-1.5 font-semibold text-ink"><CheckCircle2 size={13} /> Tidak dibuat oleh order ini</p>
        <p className="m-0">{d.tidakDibuat.join(" · ")}. Nominal, pembayaran, piutang, dan jurnal tetap hanya di Penjualan Karyawan.</p>
      </div>
    </div>
  );
}

/** Pratinjau DAMPAK koreksi item (respons POST …/koreksi-item/pratinjau). Menyebut item, unit, job, kategori, revisi — dan yang tidak disentuh (uang). */
export function PratinjauKoreksi({ data, className = "" }) {
  if (!data) return null;
  if (!data.valid) return <GalatPratinjau galat={data.galat} className={className} />;
  const d = data.dampak;
  const kat = d.kategoriOrder;
  return (
    <div className={`space-y-3 ${className}`} data-testid="pratinjau-koreksi">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="koreksi-ringkas">
        {[["Item ditambah", d.item.ditambah.length], ["Item dihapus", d.item.dihapus.length], ["Item diubah", d.item.diubah.length], ["Unit baru / batal", `${d.unit.dibuat} / ${d.unit.dibatalkan.length}`]].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-inset px-3 py-2"><p className="m-0 text-[11px] text-ink3">{l}</p><p className="m-0 text-[15px] font-semibold tabular-nums text-ink">{v}</p></div>
        ))}
      </div>
      <p className="m-0 text-[12.5px] text-ink2" data-testid="koreksi-revisi">
        Revisi daftar item: <strong className="text-ink">{d.revisiSekarang} → {d.revisiBaru}</strong>
        {kat.sebelum !== kat.sesudah ? <> · Kategori order: <strong className="text-ink">{kat.sebelum} → {kat.sesudah}</strong></> : null}
      </p>
      <ul className="m-0 list-none space-y-1.5 p-0 text-[12.5px]" data-testid="koreksi-rincian">
        {d.item.ditambah.map((i) => <li key={`t${i.no}`} className="rounded-lg border border-line px-3 py-1.5">+ Item {i.no}: {i.kategori}{i.produk && i.produk !== i.kategori ? ` · ${i.produk}` : ""} × {i.jumlah}{i.bundel ? ` (Set ${i.bundel})` : ""}</li>)}
        {d.item.dihapus.map((i) => <li key={`h${i.no}`} className="rounded-lg border border-line px-3 py-1.5">− Item {i.no}: {i.kategori}{i.produk && i.produk !== i.kategori ? ` · ${i.produk}` : ""} × {i.jumlah} — unit {i.unit.join(", ") || "—"} dibatalkan</li>)}
        {d.item.diubah.map((i) => (
          <li key={`u${i.no}`} className="rounded-lg border border-line px-3 py-1.5">
            Item {i.no} ({i.produk}): {Object.entries(i.perubahan).map(([k, v]) => `${k} ${v.sebelum ?? "—"} → ${v.sesudah ?? "—"}`).join("; ")}
            {i.unitBaru > 0 ? ` · +${i.unitBaru} unit` : ""}{i.unitDibatalkan.length ? ` · unit ${i.unitDibatalkan.join(", ")} dibatalkan` : ""}
          </li>
        ))}
      </ul>
      {(d.pickup.jobDibatalkan.length > 0 || d.pickup.jobTersentuh.length > 0) && (
        <p className="m-0 text-[12px] text-ink3" data-testid="koreksi-pickup">Job pickup: {d.pickup.jobTersentuh.reduce((a, j) => a + j.unitDikeluarkan, 0)} unit dikeluarkan{d.pickup.jobDibatalkan.length ? `, ${d.pickup.jobDibatalkan.length} job kosong dibatalkan` : ""}.</p>
      )}
      <div className={`rounded-lg px-3 py-2 text-[12.5px] ${d.produksi.lengkap ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`} data-testid="koreksi-produksi">
        {d.produksi.lengkap ? "Setelah koreksi semua item lengkap." : `Setelah koreksi masih kurang: ${d.produksi.kurang.join("; ")}.`}
      </div>
      {d.delivery.catatan && <p className="m-0 text-[12px] text-ink3" data-testid="koreksi-delivery">{d.delivery.catatan}</p>}
      {d.peringatan.map((w) => (
        <p key={w.kode + w.pesan} role="status" className="m-0 flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="koreksi-peringatan">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{w.pesan}</span>
        </p>
      ))}
      <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="koreksi-tidak-dibuat">
        <p className="m-0 mb-1 flex items-center gap-1.5 font-semibold text-ink"><CheckCircle2 size={13} /> Tidak disentuh oleh koreksi ini</p>
        <p className="m-0">{d.tidakDibuat.join(" · ")}. Nominal tetap di Penjualan Karyawan.</p>
      </div>
    </div>
  );
}
