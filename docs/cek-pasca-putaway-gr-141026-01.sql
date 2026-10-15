-- CEK PASCA-PUTAWAY GR-141026-01 — BACA-SAJA (transaksi READ ONLY). Jalankan SESUDAH Gudang menekan "Simpan ke Stok":
--   docker compose exec -T postgres psql -U klinik -d klinik_matras -f - < docs/cek-pasca-putaway-gr-141026-01.sql
-- Lulus bila: (1) status COMPLETED; (2) tiap baris diterima-baik punya TEPAT 1 movement RECEIPT dengan qty = jumlah baik; (3) TEPAT 1 jurnal POSTED, debit Persediaan = sum(baik x harga PO);
-- (4) tidak ada movement/jurnal ganda; (5) tidak ada ADJUSTMENT terkait GR ini. Kolom "OK" harus semuanya 't'.
BEGIN READ ONLY;
\set gr '\'GR-141026-01\''

\echo '== 1. Status dokumen'
SELECT g.receipt_number, g.status::text AS status, g.received_date, (g.status::text = 'COMPLETED') AS ok
FROM goods_receipts g WHERE g.receipt_number = :gr;

\echo '== 2. Per baris: jumlah baik vs movement (harus tepat 1 per baris diterima)'
SELECT m.code, m.unit, l.accepted_qty AS baik, l.rejected_qty AS ditolak,
       count(s.id) AS n_movement, coalesce(sum(s.qty), 0) AS qty_movement,
       (CASE WHEN l.accepted_qty > 0 THEN count(s.id) = 1 AND coalesce(sum(s.qty), 0) = l.accepted_qty ELSE count(s.id) = 0 END) AS ok
FROM goods_receipt_lines l
JOIN goods_receipts g ON g.id = l.goods_receipt_id
JOIN materials m ON m.id = l.material_id
LEFT JOIN stock_movements s ON s.goods_receipt_id = g.id AND s.material_id = l.material_id AND s.type::text = 'RECEIPT'
WHERE g.receipt_number = :gr GROUP BY m.code, m.unit, l.id, l.accepted_qty, l.rejected_qty ORDER BY m.code;

\echo '== 3. Jurnal: tepat satu POSTED; debit = sum(baik x harga PO)'
WITH nilai AS (
  SELECT coalesce(sum(l.accepted_qty * pl.unit_price), 0) AS harapan
  FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l.goods_receipt_id JOIN fin_purchase_order_lines pl ON pl.id = l.purchase_order_line_id
  WHERE g.receipt_number = :gr
), j AS (
  SELECT e.id, e.status::text AS st, e.entry_number, coalesce(sum(jl.debit), 0) AS debit, coalesce(sum(jl.credit), 0) AS kredit
  FROM fin_journal_entries e LEFT JOIN fin_journal_lines jl ON jl.entry_id = e.id
  WHERE e.source_id = (SELECT id::text FROM goods_receipts WHERE receipt_number = :gr) GROUP BY e.id, e.status, e.entry_number
)
SELECT (SELECT harapan FROM nilai) AS nilai_harapan,
       (SELECT count(*) FROM j) AS n_jurnal, (SELECT count(*) FROM j WHERE st = 'POSTED') AS n_posted,
       (SELECT coalesce(sum(debit), 0) FROM j WHERE st = 'POSTED') AS debit_posted, (SELECT coalesce(sum(kredit), 0) FROM j WHERE st = 'POSTED') AS kredit_posted,
       ((SELECT count(*) FROM j) = 1 AND (SELECT count(*) FROM j WHERE st = 'POSTED') = 1
        AND (SELECT coalesce(sum(debit), 0) FROM j WHERE st = 'POSTED') = (SELECT harapan FROM nilai)
        AND (SELECT coalesce(sum(kredit), 0) FROM j WHERE st = 'POSTED') = (SELECT harapan FROM nilai)) AS ok;

\echo '== 4. Duplikasi/penyesuaian terkait GR ini (semua harus 0)'
SELECT (SELECT count(*) FROM stock_movements WHERE goods_receipt_id = (SELECT id FROM goods_receipts WHERE receipt_number = :gr) AND type::text <> 'RECEIPT') AS movement_non_receipt,
       (SELECT count(*) FROM (SELECT material_id FROM stock_movements WHERE goods_receipt_id = (SELECT id FROM goods_receipts WHERE receipt_number = :gr) GROUP BY material_id HAVING count(*) > 1) d) AS material_ganda,
       (SELECT count(*) FROM stock_movements WHERE type::text = 'ADJUSTMENT' AND created_at >= (SELECT updated_at FROM goods_receipts WHERE receipt_number = :gr)) AS adjustment_sesudah_putaway;

\echo '== 5. Saldo ledger material GR (setelah) dan progres baris PO'
SELECT m.code, m.unit, (SELECT coalesce(sum(qty), 0) FROM stock_movements s WHERE s.material_id = m.id) AS saldo_sekarang,
       pl.qty AS po_qty, (SELECT coalesce(sum(l2.accepted_qty), 0) FROM goods_receipt_lines l2 JOIN goods_receipts g2 ON g2.id = l2.goods_receipt_id WHERE l2.purchase_order_line_id = pl.id AND g2.status::text = 'COMPLETED') AS baik_masuk_stok
FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l.goods_receipt_id JOIN materials m ON m.id = l.material_id LEFT JOIN fin_purchase_order_lines pl ON pl.id = l.purchase_order_line_id
WHERE g.receipt_number = :gr ORDER BY m.code;
ROLLBACK;
