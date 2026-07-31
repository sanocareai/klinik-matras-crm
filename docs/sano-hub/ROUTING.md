# Sano Hub — Model Routing Produksi

Sumber kebenaran urutan produksi. Diisi dari keterangan langsung Gilang
(31 Juli 2026), menggantikan tebakan tahap di PRD §5.1.

Aturan yang tidak boleh dilanggar: **stage adalah DATA, bukan kode.** Kalau
sampai menulis `if (stage === 'jahit_corner')`, berhenti — tambahkan kolom flag
di `routing_stages`. Lihat `CLAUDE.md` di folder ini.

---

## 1. Bentuk umum

Satu tulang punggung tetap, modul kerja yang dipilih per unit:

```
INTAKE (selalu, urut)
  1  Uji Sebelum Bongkar
  2  Bongkar
  3  Uji Fondasi          ← titik keputusan lini & modul
  4  Diagnosa

MODUL KERJA (0..n, dipilih per unit, urut fondasi → lapisan → kain)
  F-S  Service Fondasi
  F-U  Upgrade Fondasi
  L-T  Tambah Busa
  L-U  Upgrade Lapisan Atas
  K-G  Ganti Kain

FINISHING (selalu, urut)
  5  Uji Berat Badan (QC)   ← GERBANG, perakitan termasuk di sini
  6  Jahit Corner
  7  Finish / Siap Kirim
```

Urutan modul dari bawah ke atas mengikuti urutan fisik pembangunan kasur:
fondasi dulu, lapisan di atasnya, kain terakhir.

---

## 2. Tabel tahap (seed `routing_stages`)

`line` = `null` berarti tahap berlaku untuk kedua lini.

| # | code | label_id | line | wajib | foto | catatan |
|---|---|---|---|---|---|---|
| 1 | `pre_teardown_test` | Uji Sebelum Bongkar | — | ya | ya | baseline kondisi & tekstur sebelum disentuh; foto = bukti serah terima |
| 2 | `teardown` | Bongkar | — | ya | ya | bukti kondisi dalam; dasar sengketa & garansi |
| 3 | `foundation_test` | Uji Fondasi | — | ya | ya | menentukan seberapa layak fondasi → menetapkan lini + modul |
| 4 | `diagnosis` | Diagnosa | — | ya | — | menghasilkan DiagnosisReport; bisa memicu ScopeRevision |
| — | `foundation_service` | Service Fondasi | SERVICE | modul | — | penguatan fondasi per TANPA mengganti per |
| — | `foundation_upgrade` | Upgrade Fondasi | UPGRADE | modul | ya | ganti fondasi (spek 150kg), mis. per amblas → fondasi baru |
| — | `foam_addition` | Tambah Busa | SERVICE | modul | — | restorasi, material grade service |
| — | `comfort_layer_upgrade` | Upgrade Lapisan Atas | UPGRADE | modul | ya | ganti lapisan kempes dengan material premium Matras Sehat |
| — | `cover_replacement` | Ganti Kain | — | modul | — | grade kain mengikuti lini unit |
| 5 | `fit_test` | Uji Berat Badan | — | ya | ya | GERBANG. Perakitan termasuk di sini. Lihat §4 |
| 6 | `corner_sewing` | Jahit Corner | — | ya | ya | tidak bisa dibatalkan — karena itu QC di depannya |
| 7 | `finished` | Finish / Siap Kirim | — | ya | ya | foto akhir = baseline garansi + materi marketing |

Kolom lain per tahap, mengikuti PRD §5.1: `sequence`, `is_optional`,
`expected_duration_minutes`, `required_role`, `requires_photo`, `requires_qc`.

`expected_duration_minutes` sengaja dikosongkan di seed — **jangan ditebak.**
Isi setelah beberapa minggu data `unit_stage_logs` nyata, lalu pakai untuk
proyeksi tanggal janji.

---

## 3. Katalog layanan → modul

| code | label_id | lini | modul |
|---|---|---|---|
| `SVC_FONDASI` | Service Fondasi Matras Sehat | SERVICE | `foundation_service` |
| `SVC_FULL` | Full Service | SERVICE | `foundation_service` + `foam_addition` + `cover_replacement` |
| `UPG_LAPISAN` | Upgrade Lapisan Atas Matras Sehat | UPGRADE | `comfort_layer_upgrade` |
| `UPG_FONDASI` | Paket Upgrade Fondasi (150kg) | UPGRADE | `foundation_upgrade` |
| `UPG_FONDASI_LAPISAN` | Paket Upgrade Fondasi + Lapisan | UPGRADE | `foundation_upgrade` + `comfort_layer_upgrade` |
| `UPG_FULL` | Full Upgrade (Fondasi + Lapisan + Kain) | UPGRADE | `foundation_upgrade` + `comfort_layer_upgrade` + `cover_replacement` |

Enam layanan, lima modul. Layanan ketujuh = satu baris data + pemetaan modul,
bukan template baru.

**Modul fondasi saling eksklusif:** `foundation_service` (perkuat per) dan
`foundation_upgrade` (ganti fondasi) tidak pernah berbarengan di satu unit.
Begitu juga `foam_addition` (service) dan `comfort_layer_upgrade` (upgrade) —
karena beda lini, dan lintas lini dilarang (D-004).

**Hubungan dengan `OrderItem` yang sudah ada.** Add-on layanan di order
SUDAH menjadi pemilihan modul. Tidak ada struktur paralel yang harus
disinkronkan sales manual — `OrderItem.layananName` dinaikkan jadi FK ke
katalog layanan ini.

> ⚠️ **Catatan penamaan.** "SERVICE FONDASI MATRAS SEHAT" memakai frasa merek
> "Matras Sehat" padahal lini SERVICE justru bukan fokus Matras Sehat (D-004).
> Sementara itu CLAUDE.md §16.7 melarang menyebut Restorasi Total sebagai
> "servis kasur". Katalog dan panduan merek saling bertabrakan di sini.
> Prioritas rendah, tapi perlu dirapikan sebelum masuk Knowledge Base AI —
> kalau tidak, Sano AI akan mengutip dua definisi yang berlawanan.

---

## 4. Uji Berat Badan (`fit_test`) — gerbang, bukan checklist

Perakitan tidak dilacak sebagai tahap sendiri karena cepat. Yang krusial
uji-nya: tekstur kasur terhadap tubuh pemakainya.

**Masukan** (dua-duanya SUDAH dikumpulkan CRM hari ini, tinggal disambungkan):
- `OrderWeightEntry` — berat badan per orang (suami/istri terpisah, bukan
  dirata-rata)
- `Order.keluhanCustomer` — keluhan awal

**Putusan** — direkam, bukan lulus/gagal:

```
verdict                       TERLALU_KERAS | PAS | TERLALU_EMPUK
reference_weight_kg           berat badan acuan yang dipakai menguji
customer_preference_override  null | LEBIH_KERAS | LEBIH_EMPUK
education_given               boolean   ← wajib true kalau override terisi
tested_by                     Production Lead / QC Leader
note                          racikan akhir, penyesuaian yang dilakukan
```

Alur:
- `PAS` tanpa override → lanjut ke `corner_sewing`
- `TERLALU_KERAS` / `TERLALU_EMPUK` → balik ke modul lapisan, dihitung
  **rework** (jangan biarkan rework tidak terlihat), lalu uji ulang
- Override customer → boleh lanjut, tapi tersimpan permanen di unit beserta
  catatan edukasi (D-009 — ini catatan liability, bukan preferensi)

**Kenapa ini bagian paling berharga.** Setiap baris menyimpan
(berat badan → keluhan → racikan → putusan). Setelah beberapa ratus unit,
keahlian Production Lead & QC Leader berubah jadi data yang bisa dicari:
"untuk 75kg dengan keluhan pinggang, racikan apa yang keluar PAS?" Itu
FR-G-03 di PRD, didapat gratis asal direkam sejak unit pertama.

---

## 5. Titik keputusan di Uji Fondasi

`foundation_test` adalah tempat lini & modul DITETAPKAN, bukan saat sales
input order. Sales menjual perkiraan; bongkar mengungkap kenyataan.

```
Uji Fondasi
  └─ fondasi masih layak diperkuat?
       ya  → lini SERVICE tetap    → modul sesuai katalog
       tidak → usul pindah UPGRADE → ScopeRevision (delta harga)
                                    → unit BLOCKED: awaiting_customer_approval
                                    → jam blok mulai
```

Perubahan modul di dalam lini yang sama dan tanpa perubahan harga: tidak
memblokir, cukup dicatat. **Perubahan lini atau perubahan harga: selalu
memblokir sampai customer menyetujui** (D-008).
