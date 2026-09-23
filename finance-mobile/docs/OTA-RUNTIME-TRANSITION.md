# OTA transisi runtimeVersion — rilis 1.1.0 ke binary produksi 1.0.0

## Konteks

Binary produksi yang benar-benar terpasang (Play Store, `versionCode 3`, dibangun 21 Sep 2026, commit
`8a9a4248`) punya `version` **1.0.0** dan `runtimeVersion` **1.0.0**.

Sejak build itu, `app.config.ts` menaikkan `version` ke **1.1.0** (commit `d0ca6940`, untuk fitur
Pemasukan Terpadu) — tapi **tidak ada build native baru** yang menyusul. Karena `runtimeVersion`
memakai kebijakan `"appVersion"` (mengikuti `version`), setiap OTA yang dipublikasikan sesudah commit
itu otomatis ber-`runtimeVersion` **1.1.0** — dan **tidak pernah sampai** ke binary produksi yang
masih `runtimeVersion` 1.0.0. Ini murni artefak proses penomoran versi, bukan perubahan native
sungguhan (lihat audit di bawah).

Build native 1.1.0 belum bisa dibuat sekarang: kuota Android build paket Free EAS akun `sanocare`
habis bulan ini, reset **1 Oktober 2026**.

## Audit yang membuktikan aman: nol perubahan native sejak 1.0.0

Diverifikasi 23 Sep 2026 dengan `git diff 8a9a4248..HEAD`:

| Area | Hasil |
|---|---|
| `package-lock.json` | **Identik byte-untuk-byte.** Nol dependency ditambah/dihapus/naik versi. |
| `app.config.ts` | Sebelum perubahan ini, hanya **satu baris** berbeda: string `version`. `permissions`, `blockedPermissions`, `plugins`, `package`, `scheme` — semuanya sama persis. |
| `eas.json` | Tidak berubah sama sekali. |
| Skema penyimpanan lokal | Hanya field opsional baru (`avatarUrl?: string \| null`) di objek user tersimpan — *backward-compatible*, kunci SecureStore (`session.v1`, `lock.pin.v1`, `device.id`) tidak berubah. |
| API contract | Semua perubahan aditif (endpoint/fungsi baru), tidak ada modifikasi ke kontrak yang sudah ada. |

Kesimpulan: fingerprint native (dependency + plugin + permission) 1.1.0 == 1.0.0. Mengirim JS bundle
1.1.0 sebagai OTA ber-`runtimeVersion` 1.0.0 ke binary 1.0.0 aman — ini persis skenario yang mekanisme
`runtimeVersion` dirancang untuk menangani (kompatibilitas JS-native), bukan celah yang dieksploitasi.

## Mekanisme: `EAS_UPDATE_RUNTIME_OVERRIDE`

Di `app.config.ts`, field `runtimeVersion` sekarang:

```ts
runtimeVersion: RUNTIME_OVERRIDE_VALID ? (RUNTIME_OVERRIDE_RAW as string) : { policy: "appVersion" },
```

- **Default (tanpa env ini di-set): TIDAK BERUBAH** — tetap kebijakan `"appVersion"`, persis seperti
  sebelum mekanisme ini ada. Build native (`eas build`) dan `eas update` biasa sama sekali tidak
  terpengaruh — variabel ini **tidak** di-set di `eas.json` mana pun.
- **Aktif hanya kalau** `EAS_UPDATE_RUNTIME_OVERRIDE` di-set **dan** formatnya `x.y.z` (angka murni,
  divalidasi regex `^\d+\.\d+\.\d+$`). Format lain (kosong, `1.0`, `v1.0.0`, `1.0.0-beta`, dst)
  **diabaikan diam-diam** — fallback ke kebijakan `appVersion`, tidak pernah melempar error.
- Variabel ini **hanya dibaca di satu tempat**: field `runtimeVersion`. Tidak ada cabang kode lain
  yang membacanya, jadi secara struktural **tidak mungkin** mengubah `package`, `channel` (diatur di
  `eas.json`/flag CLI, bukan `app.config.ts`), permission, plugin, URL API, atau flag push — apa pun
  nilainya.
- Regression guard lengkap: `src/__tests__/appConfig.runtimeOverride.test.ts` (11 kasus: default,
  env kosong/undefined, override valid, berbagai format tidak sah, isolasi terhadap
  package/plugin/permission/`updates`/`extra`, dan pemeriksaan statis `eas.json`).

## Cara pakai (SEKALI SAJA, untuk transisi ini)

```bash
cd finance-mobile
EAS_UPDATE_RUNTIME_OVERRIDE=1.0.0 npx eas update \
  --branch production --channel production \
  --message "Finance 1.1 — Pemasukan dan Terapkan Uang Muka"
```

Verifikasi hasil publish menunjuk `Runtime Version 1.0.0` (bukan 1.1.0) sebelum menganggap selesai:

```bash
EAS_PROJECT_ID=ac46e42b-2ac5-4fb3-a515-ebaf40c4c3e2 npx eas channel:view production
```

## Kapan berhenti memakai jalur ini

Begitu kuota EAS reset (1 Oktober 2026) dan binary native **1.1.0** (`runtimeVersion` 1.1.0) sudah
dibangun serta didistribusikan ke perangkat: **hentikan pemakaian `EAS_UPDATE_RUNTIME_OVERRIDE`**.
OTA berikutnya kembali memakai `eas update` biasa tanpa variabel ini — otomatis kembali ke kebijakan
`appVersion` (runtimeVersion 1.1.0), sesuai binary baru yang sudah beredar. Jangan pernah memakai
`EAS_UPDATE_RUNTIME_OVERRIDE` untuk mengirim perubahan yang benar-benar mengubah native/dependency —
mekanisme ini murni untuk transisi satu kali ini, bukan cara permanen memisahkan `version` dari
`runtimeVersion`.
