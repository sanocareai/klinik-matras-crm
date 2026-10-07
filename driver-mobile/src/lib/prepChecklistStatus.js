// Logika MURNI Checklist Persiapan Perjalanan — dipisah dari
// PersiapanPerjalananScreen.js supaya dites tanpa runtime React Native
// (pola sama dengan executionCore.js/trackingLifecycle.js: inti murni +
// wiring UI tipis).
export function checklistSiapBerangkat(items) {
  return (items || []).filter((i) => i.required).every((i) => i.terpenuhi);
}

export function hitungItemBelum(items) {
  return (items || []).filter((i) => i.required && !i.terpenuhi).length;
}

// Dipakai menentukan mode input per item (tombol foto vs tombol "Tandai
// Selesai" + catatan opsional).
export function butuhFoto(item) {
  return Boolean(item.photoRequired);
}
