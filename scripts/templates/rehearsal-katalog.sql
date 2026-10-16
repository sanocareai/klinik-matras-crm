-- Sidik jari KATALOG database (baca-saja): objek penting + kepemilikan + izin. Dijalankan di produksi (sesi baca-saja) dan di hasil restore; keduanya HARUS identik.
-- Satu baris per objek: jenis|kunci|nilai. Nilai memuat definisi/hash definisi, pemilik, dan ACL.
select 'db', current_database(), pg_encoding_to_char(d.encoding)||':'||d.datcollate||':'||d.datctype from pg_database d where d.datname = current_database()
union all
select 'skema', n.nspname, pg_get_userbyid(n.nspowner)||':'||coalesce(n.nspacl::text, '') from pg_namespace n where n.nspname = 'public'
union all
select 'ekstensi', e.extname, e.extversion from pg_extension e
union all
select 'role', r.rolname, '' from pg_roles r where r.rolname !~ '^pg_'
union all
select 'relasi', c.relname, c.relkind::text||':'||pg_get_userbyid(c.relowner)||':'||coalesce(c.relacl::text, '')||':'||c.relrowsecurity::text||':'||c.relpersistence::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
union all
select 'kolom', c.relname||'.'||a.attname,
       format_type(a.atttypid, a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin, d.adrelid), '')||':'||a.attidentity::text||':'||a.attgenerated::text||':'||coalesce(a.attacl::text, '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
union all
select 'tampilan', c.relname, md5(pg_get_viewdef(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v', 'm')
union all
select 'indeks', i.tablename||'.'||i.indexname, md5(i.indexdef) from pg_indexes i where i.schemaname = 'public'
union all
select 'constraint', c.conrelid::regclass::text||'.'||c.conname, c.contype::text||':'||c.convalidated::text||':'||pg_get_constraintdef(c.oid) from pg_constraint c where c.connamespace = 'public'::regnamespace
union all
select 'trigger', t.tgrelid::regclass::text||'.'||t.tgname, t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)) from pg_trigger t where not t.tgisinternal
union all
select 'fungsi', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid))||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text, '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
union all
select 'enum', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' group by t.typname
union all
select 'default-acl', coalesce(a.defaclrole::regrole::text, '')||':'||a.defaclobjtype::text, coalesce(a.defaclacl::text, '') from pg_default_acl a
union all
-- izin efektif per role x tabel (SELECT/INSERT/UPDATE/DELETE) — "izin yang dibutuhkan aplikasi" (role aplikasi dan role baca-saja) pulih sesuai sumber
select 'izin-tabel', r.rolname,
       md5(string_agg(c.relname||':'||has_table_privilege(r.oid, c.oid, 'SELECT')::text||has_table_privilege(r.oid, c.oid, 'INSERT')::text||has_table_privilege(r.oid, c.oid, 'UPDATE')::text||has_table_privilege(r.oid, c.oid, 'DELETE')::text, ',' order by c.relname))||':'||count(*)::text
  from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
 where r.rolname !~ '^pg_' and n.nspname = 'public' and c.relkind in ('r', 'p') group by r.rolname
union all
select 'izin-fungsi', r.rolname,
       md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||has_function_privilege(r.oid, p.oid, 'EXECUTE')::text, ',' order by p.proname, p.oid::text))||':'||count(*)::text
  from pg_roles r cross join pg_proc p
 where r.rolname !~ '^pg_' and p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') group by r.rolname
union all
select 'izin-skema', r.rolname, has_schema_privilege(r.oid, 'public', 'USAGE')::text||has_schema_privilege(r.oid, 'public', 'CREATE')::text from pg_roles r where r.rolname !~ '^pg_';
