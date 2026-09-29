// Visibilitas menu sidebar berdasarkan peran/divisi/admin — dipisah dari
// Layout.jsx (P8.1, UI & Navigation Consolidation) supaya bisa diuji lewat
// `node --test`. REFACTOR MURNI: logika dipindah apa adanya (lihat commit
// C1/C2.1 di Layout.jsx untuk sejarahnya), tidak ada perilaku baru di sini.
// Server tetap sumber izin utama — ini HANYA menyembunyikan menu yang pasti
// buntu, bukan penegakan akses sungguhan.

// C1 — item bertanda `bolehPeran` hanya tampil untuk peran yang disebut.
// C2.1 — `bolehDivisi`: anggota divisi itu juga melihat menunya (peran ATAU divisi).
export function filterMenuByPermission(division, { roles = [], divisiSaya = [] } = {}) {
  return {
    ...division,
    sections: division.sections.map((s) => ({
      ...s,
      items: s.items.filter(
        (i) => !i.bolehPeran || roles.some((r) => i.bolehPeran.includes(r)) || (i.bolehDivisi || []).some((d) => divisiSaya.includes(d)),
      ),
    })),
  };
}

// Section/item bertanda `adminOnly` hanya tampil untuk ADMIN — dipakai untuk
// section "Legacy (Admin)" (P8.1): route lama TETAP ADA (tidak dihapus),
// cuma disembunyikan dari menu operasional harian.
export function visibleSections(sections, isAdmin) {
  return sections
    .filter((s) => !s.adminOnly || isAdmin)
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.adminOnly || isAdmin) }));
}
