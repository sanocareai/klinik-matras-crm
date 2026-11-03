import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { IkAwas } from "@/components/gudangIcons.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import { waktuTeks, teksJumlah } from "./dokumenLogic.js";
import { bahanTumpangTindih, pisahPemakaianUnit } from "./miLogic.js";

// PEMAKAIAN — apa yang TERCATAT pada unit produksi (baca-saja; GET /units/:id/materials, sumber kebenaran = buku stok bertaut unit). Dipisahkan dari PENGELUARAN dokumen ini:
//   • dikeluarkan lewat dokumen INI (Konfirmasi keluar menulis pergerakan ISSUE bertaut unit — itulah catatan pada unit; tidak ada catatan kedua),
//   • dikeluarkan lewat dokumen Gudang LAIN, • dicatat LANGSUNG oleh Produksi (tanpa dokumen).
// Sistem TIDAK memiliki langkah "diterima Produksi" tersendiri dan tidak menautkan pencatatan langsung ke dokumen: dua jalur itu menulis pergerakan masing-masing. Karena itu bahan yang sama yang sudah dikeluarkan lewat
// dokumen TIDAK boleh dicatat ulang di Produksi — layar hanya memperingatkan, tidak memblokir apa pun (aturan stok tidak berubah).
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const JENIS = { ISSUE: "Dikeluarkan", RETURN: "Dikembalikan", WASTE: "Rusak/terbuang" };

function Tabel({ judul, kosong, movements, testid }) {
  return (
    <div className="gud-bahan-pendukung" data-testid={testid}>
      <h3 className="gud-bahan-sub">{judul} <span className="gud-redup">{movements.length} pergerakan</span></h3>
      {movements.length === 0 ? <p className="gud-petunjuk">{kosong}</p> : (
        <ul className="gud-gerak">
          {movements.map((m) => {
            const qty = -Number(m.qty);
            return (
              <li key={m.id} data-testid="baris-pemakaian">
                <div className="gud-gerak-isi">
                  <div className="gud-gerak-atas"><span className="gud-pill" data-warna={m.type === "ISSUE" ? "orange" : m.type === "RETURN" ? "green" : "red"}>{JENIS[m.type] ?? m.type}</span><span className="gud-sekunder">{waktuTeks(m.createdAt)}</span></div>
                  <span className="gud-sekunder"><strong>{m.material?.code}</strong> · {m.material?.name}</span>
                  {m.materialIssue ? <span className="gud-sekunder">Dokumen <Link to={`/warehouse/material-issue/${m.materialIssue.id}`} className="gud-tautan-nomor">{m.materialIssue.issueNumber}</Link></span> : <span className="gud-sekunder">Dicatat langsung (tanpa dokumen Gudang)</span>}
                  {(m.reason || m.note) && <span className="gud-sekunder">{m.reason || m.note}</span>}
                  {m.createdBy?.name && <span className="gud-sekunder">oleh {m.createdBy.name}</span>}
                </div>
                <span className={qty >= 0 ? "gud-gerak-qty gud-minus" : "gud-gerak-qty gud-plus"} data-testid="qty-pemakaian">{qty >= 0 ? "−" : "+"}{teksJumlah(Math.abs(qty))} {satuan(m.material?.unit)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function PemakaianUnit({ dokumen }) {
  const unitId = dokumen.unitId ?? dokumen.unit?.id ?? null;
  const [data, setData] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(false);
  useEffect(() => {
    if (!unitId) return undefined;
    let batal = false; setMemuat(true); setGalat(""); setData(null);
    api.getUnitMaterials(unitId).then((d) => { if (!batal) setData(d); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat pemakaian unit"); }).finally(() => { if (!batal) setMemuat(false); });
    return () => { batal = true; };
  }, [unitId, dokumen.status, dokumen.updatedAt]);

  if (!unitId) {
    return <div className="gud-bahan-bagian" data-testid="pemakaian-tanpa-unit"><p className="gud-info" data-nada="biasa">Dokumen ini tidak terkait unit produksi, jadi tidak ada pemakaian unit yang dicatat. Bahan yang dikeluarkan hanya mengurangi stok Gudang.</p></div>;
  }
  if (memuat) return <p className="gud-petunjuk" role="status">Memuat pemakaian unit…</p>;
  if (galat) return <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-pemakaian">{galat}</p>;
  if (!data) return null;
  const pisah = pisahPemakaianUnit(data.movements, dokumen.id); const tumpang = bahanTumpangTindih(pisah, dokumen.lines);
  const unitKode = dokumen.unit?.unitCode ?? "unit";
  return (
    <div className="gud-bahan-bagian" data-testid="pemakaian-unit">
      <p className="gud-info" data-testid="penjelasan-pemakaian">Ini yang <b>tercatat pada unit {unitKode}</b>, bukan keputusan baru. Pengeluaran lewat dokumen ini otomatis tercatat pada unit (pergerakan keluar bertaut unit) — <b>tidak ada pencatatan kedua</b>. Sistem belum punya langkah “diterima Produksi” tersendiri; bahan yang dikeluarkan dianggap sudah tercatat pada unit, belum tentu sudah dipakai habis.</p>
      {tumpang.length > 0 && (
        <p className="gud-info" data-nada="awas" role="note" data-testid="peringatan-ganda"><IkAwas size={16} aria-hidden /> <span><b>Periksa kemungkinan pencatatan ganda.</b> Unit ini juga punya pencatatan langsung dari Produksi untuk {tumpang.map((e) => `${e.bahan.code}`).join(", ")}. Jangan mencatat ulang bahan yang sudah dikeluarkan lewat dokumen; bila memang pemakaian tambahan, biarkan. Sistem tidak menggabungkan keduanya.</span></p>
      )}
      <Tabel testid="pemakaian-dokumen-ini" judul={`Dikeluarkan lewat dokumen ${dokumen.issueNumber}`} kosong={dokumen.status === "ISSUED" ? "Tidak ada pergerakan bertaut dokumen ini pada unit." : "Belum ada — stok baru berkurang dan tercatat pada unit saat Konfirmasi keluar."} movements={pisah.dokumenIni} />
      <Tabel testid="pemakaian-dokumen-lain" judul="Dikeluarkan lewat dokumen Gudang lain" kosong="Tidak ada." movements={pisah.dokumenLain} />
      <Tabel testid="pemakaian-langsung" judul="Dicatat langsung oleh Produksi" kosong="Tidak ada pencatatan langsung pada unit ini." movements={pisah.langsung} />
      <p className="gud-petunjuk">Angka per bahan dihitung per satuan bahan masing-masing; tidak dijumlahkan lintas bahan. Riwayat penuh unit ada di ruang kerja Bahan Produksi.</p>
    </div>
  );
}
