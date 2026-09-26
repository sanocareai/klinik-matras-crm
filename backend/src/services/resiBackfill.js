// RESI GABUNGAN — FASE 2: klasifikasi & backfill METADATA-ONLY untuk invoice bundle lama.
//
// Invoice bundle lama (Invoice.combinedIntoId) sudah menggabungkan beberapa order dalam satu tampilan invoice, tetapi tidak punya OrderGroup.
// Backfill hanya membuat baris order_groups (source BACKFILL_BUNDLE) dan mengisi orders.group_id. TIDAK menyentuh Payment, jurnal, Invoice,
// Unit, Job, status, nominal, alamat, insentif, maupun Order.updatedAt (UPDATE mentah, bukan Prisma, supaya updatedAt tidak bergeser).
//
// Modul ini murni-fungsi + satu fungsi tulis (terapkanBackfill) yang HANYA dipanggil dengan izin eksplisit dari CLI. Klasifikasi tidak
// pernah membaca nama/alamat/telepon customer: alamat dibandingkan lewat sidik jari (md5 ternormalisasi) yang dihitung di SQL.

export const KLAS = { BISA: "BISA", PERINGATAN: "PERINGATAN", TIDAK_BISA: "TIDAK_BISA", SUDAH_ADA: "SUDAH_ADA" };

// Alasan TIDAK_BISA (backfill ditolak) dan PERINGATAN (boleh, tetapi metadata dicatat apa adanya + kode peringatan).
export const ALASAN = {
  ANGGOTA_KURANG: { klas: KLAS.TIDAK_BISA, teks: "kurang dari 2 order dalam bundle" },
  ANCHOR_TIDAK_ADA: { klas: KLAS.TIDAK_BISA, teks: "tidak ada invoice induk (anchor) di bundle" },
  CUSTOMER_CAMPUR: { klas: KLAS.TIDAK_BISA, teks: "order milik lebih dari satu customer" },
  RANTAI_BUNDLE: { klas: KLAS.TIDAK_BISA, teks: "bundle berantai (invoice anggota juga menjadi induk bundle lain)" },
  ORDER_GANDA: { klas: KLAS.TIDAK_BISA, teks: "satu order muncul lebih dari sekali" },
  ANCHOR_JAMAK: { klas: KLAS.TIDAK_BISA, teks: "lebih dari satu invoice induk dalam satu bundle" },
  ANGGOTA_DIBATALKAN: { klas: KLAS.PERINGATAN, teks: "ada order berstatus CANCELLED" },
  ALAMAT_BERBEDA: { klas: KLAS.PERINGATAN, teks: "alamat antar order berbeda (snapshot memakai alamat anchor)" },
  ALAMAT_KOSONG_ANCHOR: { klas: KLAS.PERINGATAN, teks: "alamat order anchor kosong (snapshot alamat = kosong)" },
  TANGGAL_BERBEDA: { klas: KLAS.PERINGATAN, teks: "tanggal kirim antar order berbeda (snapshot memakai tanggal anchor)" },
  ONGKIR_TERSEBAR: { klas: KLAS.PERINGATAN, teks: "ongkir tercatat pada lebih dari satu order (aturan lama per order)" },
  DP_TARGET_PARSIAL: { klas: KLAS.PERINGATAN, teks: "sebagian order punya dpTarget, sebagian tidak" },
};

/**
 * SQL baca-saja: satu baris JSON per anggota bundle (semua invoice yang menjadi induk atau anggota bundle).
 * Tanpa nama/alamat/telepon customer; alamat hanya sidik jari md5.
 */
export const SQL_ANGGOTA_BUNDLE = String.raw`select coalesce(jsonb_agg(to_jsonb(t) order by t.root_invoice_id, t.is_root desc, t.nomor_order), '[]'::jsonb) as anggota from (
  select coalesce(i.combined_into_id, i.id) as root_invoice_id,
         (i.combined_into_id is null) as is_root,
         exists (select 1 from invoices c where c.combined_into_id = i.id) as punya_anak,
         i.invoice_number as nomor_invoice,
         o.id as order_id, o."orderNumber" as nomor_order, o."customerId" as customer_id,
         o.status::text as status, o."paymentStatus"::text as status_bayar,
         md5(lower(regexp_replace(trim(coalesce(o.delivery_address, '')), '\s+', ' ', 'g'))) as alamat_fp,
         (nullif(trim(coalesce(o.delivery_address, '')), '') is not null) as alamat_ada,
         o.delivery_confirmed_date::text as tanggal,
         o.value as harga, o.ongkir, o.dp_target, o.group_id,
         (select count(*) from payments p where p.order_id = o.id)::int as payments,
         (select count(*) from units u where u.order_id = o.id)::int as units,
         (select count(*) from jobs j where j.order_id = o.id)::int as jobs
  from invoices i join "Order" o on o.id = i.order_id
  where i.combined_into_id is not null or exists (select 1 from invoices c where c.combined_into_id = i.id)
) t`;

/** Varian SQL untuk database yang BELUM bermigrasi order_groups (mis. dry-run produksi sebelum deploy): group_id dianggap NULL. */
export const SQL_ANGGOTA_BUNDLE_PRA_MIGRASI = SQL_ANGGOTA_BUNDLE.replace("o.group_id", "null::text as group_id").replace("o.ongkir, o.dp_target, null::text as group_id", "o.ongkir, o.dp_target, null::text as group_id");

/** Kelompokkan baris anggota per bundle (root invoice). */
export function kelompokkanBundle(baris) {
  const peta = new Map();
  for (const b of baris) {
    if (!peta.has(b.root_invoice_id)) peta.set(b.root_invoice_id, []);
    peta.get(b.root_invoice_id).push(b);
  }
  return [...peta.entries()].map(([rootInvoiceId, anggota]) => ({ rootInvoiceId, anggota }));
}

const beda = (nilai) => new Set(nilai).size > 1;

/** Klasifikasi SATU bundle (MURNI). Mengembalikan { klas, alasan: [kode], ringkas } — tanpa data pribadi. */
export function klasifikasiBundle(bundle) {
  const { anggota } = bundle;
  const kode = new Set();

  const akar = anggota.filter((a) => a.is_root);
  const idOrder = anggota.map((a) => a.order_id);
  if (anggota.length < 2) kode.add("ANGGOTA_KURANG");
  if (akar.length === 0) kode.add("ANCHOR_TIDAK_ADA");
  if (akar.length > 1) kode.add("ANCHOR_JAMAK");
  if (new Set(idOrder).size !== idOrder.length) kode.add("ORDER_GANDA");
  if (beda(anggota.map((a) => a.customer_id))) kode.add("CUSTOMER_CAMPUR");
  if (anggota.some((a) => !a.is_root && a.punya_anak)) kode.add("RANTAI_BUNDLE");

  const sudahAda = anggota.some((a) => a.group_id);
  const anchor = akar[0];
  if (anchor && !anchor.alamat_ada) kode.add("ALAMAT_KOSONG_ANCHOR");
  if (anggota.some((a) => a.status === "CANCELLED")) kode.add("ANGGOTA_DIBATALKAN");
  if (beda(anggota.map((a) => (a.alamat_ada ? a.alamat_fp : "")))) kode.add("ALAMAT_BERBEDA");
  if (beda(anggota.map((a) => a.tanggal ?? ""))) kode.add("TANGGAL_BERBEDA");
  if (anggota.filter((a) => Number(a.ongkir) > 0).length > 1) kode.add("ONGKIR_TERSEBAR");
  const adaDp = anggota.filter((a) => a.dp_target !== null && a.dp_target !== undefined);
  if (adaDp.length > 0 && adaDp.length < anggota.length) kode.add("DP_TARGET_PARSIAL");

  const daftar = [...kode];
  let klas = KLAS.BISA;
  if (daftar.some((k) => ALASAN[k].klas === KLAS.TIDAK_BISA)) klas = KLAS.TIDAK_BISA;
  else if (daftar.length > 0) klas = KLAS.PERINGATAN;
  if (sudahAda && klas !== KLAS.TIDAK_BISA) klas = KLAS.SUDAH_ADA;

  return {
    rootInvoiceId: bundle.rootInvoiceId,
    klas,
    alasan: daftar,
    ringkas: {
      anggota: anggota.length,
      subtotal: anggota.reduce((s, a) => s + (Number(a.harga) || 0), 0),
      payments: anggota.reduce((s, a) => s + a.payments, 0),
      units: anggota.reduce((s, a) => s + a.units, 0),
      jobs: anggota.reduce((s, a) => s + a.jobs, 0),
    },
  };
}

/** Agregat tanpa data pribadi: jumlah per klasifikasi dan per kode alasan. Aman untuk Git/laporan. */
export function agregatKlasifikasi(hasil) {
  const perKlas = { BISA: 0, PERINGATAN: 0, TIDAK_BISA: 0, SUDAH_ADA: 0 };
  const perAlasan = {};
  let anggota = 0;
  for (const h of hasil) {
    perKlas[h.klas] += 1;
    anggota += h.ringkas.anggota;
    for (const k of h.alasan) perAlasan[k] = (perAlasan[k] || 0) + 1;
  }
  return { bundle: hasil.length, anggota, perKlas, perAlasan };
}

export function klasifikasiSemua(baris) {
  return kelompokkanBundle(baris).map((b) => ({ ...klasifikasiBundle(b), _anggota: b.anggota }));
}

/**
 * TULIS: buat OrderGroup(BACKFILL_BUNDLE) + isi orders.group_id, METADATA-ONLY & idempoten.
 * Hanya bundle BISA (dan PERINGATAN bila `sertakanPeringatan`). TIDAK_BISA/SUDAH_ADA tidak pernah ditulis.
 * Setiap bundle dalam transaksinya sendiri; order dikunci (FOR UPDATE) dan dicek ulang group_id IS NULL, sehingga run ulang/konkuren aman.
 */
export async function terapkanBackfill(db, hasil, { sertakanPeringatan = false, jalankanId = null } = {}) {
  const layak = hasil.filter((h) => h.klas === KLAS.BISA || (sertakanPeringatan && h.klas === KLAS.PERINGATAN));
  const ringkas = { dibuat: 0, dilewati: 0, orderTersambung: 0 };
  for (const h of layak) {
    const ids = h._anggota.map((a) => a.order_id);
    const anchor = h._anggota.find((a) => a.is_root);
    const ok = await db.$transaction(async (tx) => {
      const terkunci = await tx.$queryRaw`select id, group_id from "Order" where id = any(${ids}::text[]) for update`;
      if (terkunci.length !== ids.length || terkunci.some((r) => r.group_id)) return false;
      const ada = await tx.orderGroup.findUnique({ where: { anchorOrderId: anchor.order_id }, select: { id: true } });
      if (ada) return false;
      const o = await tx.order.findUnique({
        where: { id: anchor.order_id },
        select: { customerId: true, deliveryAddress: true, deliveryCity: true, locationUrl: true, deliveryConfirmedDate: true },
      });
      const dp = h._anggota.filter((a) => a.dp_target !== null && a.dp_target !== undefined);
      const grup = await tx.orderGroup.create({
        data: {
          customerId: o.customerId, source: "BACKFILL_BUNDLE", anchorOrderId: anchor.order_id,
          alamatKirim: o.deliveryAddress ?? null, kotaKirim: o.deliveryCity ?? null, tautanLokasi: o.locationUrl ?? null,
          tanggalKirim: o.deliveryConfirmedDate ?? null,
          // Kesepakatan resi (ongkir tambahan / DP%) TIDAK ada pada bundle lama → NULL, bukan ditebak. dpTarget = jumlah yang memang tercatat.
          ongkirTambahan: null, dpPersen: null, dpTarget: dp.length ? dp.reduce((s, a) => s + Number(a.dp_target), 0) : null,
          metadata: { backfill: { skrip: "resiBackfillBundle", versi: 1, klasifikasi: h.klas, peringatan: h.alasan, anggota: ids.length, jalankanId } },
          createdById: null,
        },
        select: { id: true },
      });
      // UPDATE mentah agar Order.updatedAt TIDAK ikut bergeser (Prisma @updatedAt akan mengubahnya).
      const n = await tx.$executeRaw`update "Order" set group_id = ${grup.id} where id = any(${ids}::text[]) and group_id is null`;
      if (n !== ids.length) throw new Error("Jumlah order yang tersambung tidak sesuai; transaksi dibatalkan");
      ringkas.orderTersambung += n;
      return true;
    }, { timeout: 30_000 });
    if (ok) ringkas.dibuat += 1; else ringkas.dilewati += 1;
  }
  return ringkas;
}
