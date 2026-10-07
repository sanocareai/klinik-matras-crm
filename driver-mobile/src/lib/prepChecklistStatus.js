// Logika MURNI Checklist Persiapan Perjalanan — dipisah dari
// PersiapanPerjalananScreen.js supaya dites tanpa runtime React Native
// (pola sama dengan executionCore.js/trackingLifecycle.js: inti murni +
// wiring UI tipis).
//
// `kelengkapanSiap` = Bukti Kelengkapan Standar (7 Okt 2026) SELALU wajib,
// TERPISAH dari item admin di `items` — tidak ada default diam-diam (bukan
// parameter opsional): pemanggil WAJIB mengirim status sebenarnya dari
// respons server (res.kelengkapan.photoUrls.length > 0), supaya "belum
// dicek" tidak pernah keliru dianggap "sudah siap".
export function checklistSiapBerangkat(items, kelengkapanSiap) {
  return Boolean(kelengkapanSiap) && (items || []).filter((i) => i.required).every((i) => i.terpenuhi);
}

export function hitungItemBelum(items, kelengkapanSiap) {
  return (items || []).filter((i) => i.required && !i.terpenuhi).length + (kelengkapanSiap ? 0 : 1);
}

// Dipakai menentukan mode input per item (tombol foto vs tombol "Tandai
// Selesai" + catatan opsional).
export function butuhFoto(item) {
  return Boolean(item.photoRequired);
}
