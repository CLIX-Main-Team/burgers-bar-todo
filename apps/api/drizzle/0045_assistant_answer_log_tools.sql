-- The tools an answer ran (#381): one {tool, status} per call, in call order. Names and statuses
-- only — never the arguments, which are model-written text about the question (ADR-0011). Additive
-- with a default, so every row before the tool loop simply ran none.
ALTER TABLE "assistant_answer_log" ADD COLUMN "tools" jsonb DEFAULT '[]'::jsonb NOT NULL;
