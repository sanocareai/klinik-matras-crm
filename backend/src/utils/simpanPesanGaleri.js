// Simpan pesan KELUAR hasil kiriman galeri (send-product / send-documentation) — satu tempat supaya kedua rute konsisten.
//
// sentById WAJIB terisi (7 Okt 2026): tanpa ini pesan galeri tidak tercatat dikirim siapa — audit balasan sales, riwayat, dan nama
// pengirim di bubble menganggapnya "bukan dari sales". Kasus sempit: gema webhook WAHA bisa menyimpan pesan yang SAMA lebih dulu
// (externalId sama) tanpa tahu pengirimnya — baris itu dilengkapi sentById-nya, bukan dibiarkan kosong.
//
// prismaClient diinjeksi supaya bisa dites tanpa database.
export async function simpanPesanGaleri(prismaClient, { data, sentById }) {
  const { clientId = null, externalId = null } = data;
  try {
    return await prismaClient.message.create({ data: { ...data, sentById } });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    // Race: 2 request ber-clientId sama, ATAU gema webhook sudah menyimpan pesan ini (externalId sama).
    const ada = (clientId && await prismaClient.message.findUnique({ where: { clientId } }))
      || (externalId && await prismaClient.message.findUnique({ where: { externalId } }));
    if (!ada) throw e;
    if (ada.sentById) return ada;
    return prismaClient.message.update({ where: { id: ada.id }, data: { sentById } });
  }
}
