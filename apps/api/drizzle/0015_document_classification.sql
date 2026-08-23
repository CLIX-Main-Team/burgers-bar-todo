ALTER TABLE "knowledge_docs" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "doc_type" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "sensitivity" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
-- Backfill the restricted documents in the same transaction that adds the column, so no window
-- exists where a lease or a payroll sheet carries the permissive default. The app reclassifies
-- every row on its next sync through classifyDocument; these patterns are that function's own
-- sensitivity keywords, restated in SQL because a migration cannot call it.
UPDATE "knowledge_docs" SET "sensitivity" = 'internal' WHERE
  "title" LIKE '%משכורת%' OR "title" LIKE '%משכורות%' OR "title" LIKE '%שכר%'
  OR "title" LIKE '%תלוש%' OR "title" LIKE '%כספים%'
  OR ("title" LIKE '%שעות%' AND "title" LIKE '%עובדים%')
  OR "title" ILIKE '%payroll%' OR "title" ILIKE '%salary%' OR "title" ILIKE '%salaries%'
  OR "title" ILIKE '%wages%';--> statement-breakpoint
UPDATE "knowledge_docs" SET "sensitivity" = 'confidential' WHERE
  "title" LIKE '%שכירות%' OR "title" LIKE '%שכירויות%'
  OR "title" LIKE '%זיכיון%' OR "title" LIKE '%זיכיונות%'
  OR "title" LIKE '%הסכם%' OR "title" LIKE '%הסכמי%' OR "title" LIKE '%נכסים%'
  OR "title" ILIKE '%lease%' OR "title" ILIKE '%tenancy%' OR "title" ILIKE '%franchise%'
  OR "title" ILIKE '%agreements%';
