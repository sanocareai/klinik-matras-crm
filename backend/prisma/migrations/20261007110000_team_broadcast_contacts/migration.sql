-- Broadcast Team (1 Okt 2026): kontak tim (orang & grup WA) per divisi + penerima non-sales di StaffBroadcast.
-- Murni aditif. Daftar awal dari Owner: divisi Delivery + grup SANO SALES. Nomor dipakai apa adanya dari Owner.
ALTER TABLE "staff_broadcasts" ADD COLUMN "contact_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "team_contacts" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "division" TEXT NOT NULL,
  "role_label" TEXT,
  "kind" TEXT NOT NULL,
  "phone" TEXT,
  "group_name" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_contacts_division_name_key" ON "team_contacts"("division", "name");
CREATE INDEX "team_contacts_active_division_idx" ON "team_contacts"("active", "division");

INSERT INTO "team_contacts" ("id", "name", "division", "role_label", "kind", "phone", "group_name", "sort_order") VALUES
  ('tc_delivery_grup',    'SANO DRIVETHRU', 'DELIVERY', 'Grup',   'GROUP',  NULL,             'SANO DRIVETHRU', 0),
  ('tc_delivery_agung',   'Agung',          'DELIVERY', 'Driver', 'PERSON', '62895637244738', NULL,             1),
  ('tc_delivery_apri',    'Apriansyah',     'DELIVERY', 'Driver', 'PERSON', '6285773235294',  NULL,             2),
  ('tc_delivery_difa',    'Difa',           'DELIVERY', 'Driver', 'PERSON', '6287759327793',  NULL,             3),
  ('tc_delivery_alwan',   'Alwan',          'DELIVERY', 'Driver', 'PERSON', '6285724731955',  NULL,             4),
  ('tc_delivery_natasha', 'Natasha',        'DELIVERY', 'Admin',  'PERSON', '6287888747922',  NULL,             5),
  ('tc_delivery_kemal',   'Kemal',          'DELIVERY', 'Leader', 'PERSON', '6287759378375',  NULL,             6),
  ('tc_sales_grup',       'SANO SALES',     'SALES',    'Grup',   'GROUP',  NULL,             'SANO SALES',     0)
ON CONFLICT ("division", "name") DO NOTHING;
