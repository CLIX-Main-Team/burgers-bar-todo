-- knowledge_docs.category: the admin Knowledge tab's shelf (ADR-0024). Nullable on purpose —
-- NULL is "not yet categorized", the state every existing production row lands in, and the LLM
-- categorizer sweeps NULL rows after each sync, so this needs no backfill and no cursor reset.
ALTER TABLE "knowledge_docs" ADD COLUMN "category" text;