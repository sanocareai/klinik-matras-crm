import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { Glif } from "@/features/warehouse/beranda/IkonApple.jsx";
import KartuNilai from "@/features/warehouse/nilaiPersediaan/KartuNilai.jsx";
import CakupanData from "@/features/warehouse/nilaiPersediaan/CakupanData.jsx";
import TabelBahan from "@/features/warehouse/nilaiPersediaan/TabelBahan.jsx";
import DrawerBahan from "@/features/warehouse/nilaiPersediaan/DrawerBahan.jsx";
import { RincianFinance, DefinisiNilai } from "@/features/warehouse/nilaiPersediaan/BagianBawah.jsx";
import { rolesOf } from "@/lib/roles.js";
import { FILTER_PENGECUALIAN, TEKS_TANPA_NOMINAL, teksWaktuWIB } from "@/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js";
import { ringkasKartu } from "@/features/warehouse/nilaiPersediaan/nilaiTampilanLogic.js";
import "@/styles/sanss-gudang-beranda.css"; // ubin ikon squircle (.gud-br-ap*) dipakai bersama; aturan lain di berkas itu terkunci ke .gud-br
import "@/styles/sanss-gudang-nilai.css";

// NILAI PERSEDIAAN (BACA-SAJA, redesain sederhana gaya Apple). Header · tiga kartu ringkas · Cakupan data (terbuka-tutup) · pencarian + satu Filter · tabel · drawer baris · bagian terlipat.
// Semua angka dari GET /inventory/nilai-persediaan (tidak ada perhitungan nilai di sini). Estimasi stok dan saldo Finance tidak dijumlahkan/disamakan; nilai tidak diketahui bukan Rp0.
// Izin nominal, waktu acuan, jumlah unik, filter, dan halaman memakai satu sumber data yang sama. Tindakan tulis (Catat hasil SO) hanya di drawer, berizin inventory:write, dengan konfirmasi Simpan.
function pengguna() { try { return JSON.parse(localStorage.getItem("user")) || {}; } catch { return {}; } }
// Petunjuk tampilan saja: izin sebenarnya (inventory:write) ditegakkan server.
const bolehCatat = () => rolesOf(pengguna()).some((r) => ["ADMIN", "OWNER", "WAREHOUSE"].includes(r));
const lompat = (el) => { if (!el) return; const kurang = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; el.scrollIntoView({ behavior: kurang ? "auto" : "smooth", block: "start" }); };

export default function WarehouseNilaiPersediaan() {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const [versi, setVersi] = useState(0);
  const [filter, setFilter] = useState(FILTER_PENGECUALIAN); const [cari, setCari] = useState(""); const [pilihId, setPilihId] = useState(null);
  const tabelRef = useRef(null); const bukti = useRef(null); const infoWaktu = useInfoToggle();
  const muat = useCallback(() => { setMemuat(true); setGalat(""); api.getNilaiPersediaan().then((x) => { setD(x); setVersi((v) => v + 1); }).catch((e) => setGalat(e.message || "Gagal memuat")).finally(() => setMemuat(false)); }, []);
  useEffect(() => { muat(); }, [muat]);

  const nominal = !!d?.izin?.nominal; const bisaCatat = bolehCatat();
  const ringkas = useMemo(() => (d ? ringkasKartu(d, nominal) : null), [d, nominal]);
  const bahanPilih = useMemo(() => d?.baris?.find((b) => b.materialId === pilihId) ?? null, [d, pilihId]);
  const saring = (kode) => { setFilter(kode); setCari(""); requestAnimationFrame(() => lompat(tabelRef.current)); };
  const bukaRincianAkun = () => { if (bukti.current) { bukti.current.open = true; lompat(bukti.current); } };

  return (
    <PageContainer fluid className="gud-halaman">
      <div className={`gud-split nip-split${bahanPilih ? " gud-split-buka" : ""}`} data-testid="ruang-nilai">
      <div className="nip" data-testid="nilai-persediaan">
        <header className="gud-kepala nip-kepala">
          <div className="gud-judul">
            <h1 className="page-title">Nilai Persediaan</h1>
            {d && (
              <p className="nip-waktu" data-testid="np-waktu">
                <span>Data per <b>{teksWaktuWIB(d.waktuAcuan)}</b></span>
                <InfoToggleButton info={infoWaktu} label="Waktu acuan data" className="nip-ibtn nip-ibtn-tenang" />
              </p>
            )}
          </div>
          <div className="gud-aksi-kepala">
            <button type="button" className="nip-muat" onClick={muat} disabled={memuat} data-testid="np-muat"><Glif nama="muatUlang" size={16} className={memuat ? "animate-spin" : ""} /> Muat ulang</button>
          </div>
        </header>
        {d && <InfoToggleIsi info={infoWaktu} className="nip-iisi"><p>Saldo stok dan Harga Berlaku memakai waktu acuan yang sama · dihitung {teksWaktuWIB(d.waktuHitung)}.</p><p>{d.definisi.waktu}</p></InfoToggleIsi>}

        {galat && <div className="nip-galat" role="alert" data-testid="np-galat"><span>{galat}</span><button type="button" onClick={muat}>Coba lagi</button></div>}
        {!d && memuat && <div className="nip-memuat" aria-busy="true" data-testid="np-memuat"><div className="nip-rangka" /><div className="nip-rangka" /><div className="nip-rangka" /></div>}

        {d && (
          <>
            {!nominal && <div className="nip-strip-izin" data-testid="np-tanpa-nominal">{TEKS_TANPA_NOMINAL}</div>}
            <KartuNilai d={d} ringkas={ringkas} onRincianAkun={bukaRincianAkun} onLihatBahan={() => saring(FILTER_PENGECUALIAN)} />
            <CakupanData d={d} onFilter={saring} />
            <TabelBahan ref={tabelRef} d={d} nominal={nominal} filter={filter} setFilter={setFilter} cari={cari} setCari={setCari} dipilihId={pilihId} onPilih={(b) => setPilihId(b.materialId)} />
            <RincianFinance ref={bukti} d={d} nominal={nominal} />
            <DefinisiNilai d={d} />
          </>
        )}
      </div>
      <DrawerBahan bahan={bahanPilih} nominal={nominal} bisaCatat={bisaCatat} versi={versi} onTutup={() => setPilihId(null)} onTersimpan={muat} />
      </div>
    </PageContainer>
  );
}
