# Assistant ingestion fixtures

Small, real documents fed through the fake Drive client's `downloadFile` port in the
multi-format ingestion tests (`test/knowledge-sync.test.ts`, #88). They are genuine binaries so
pdf.js and mammoth run for real against them — the tests assert external behaviour (cache state
after a sync), never the extractor in isolation.

| File                     | What it exercises                                                        |
| ------------------------ | ------------------------------------------------------------------------ |
| `text-procedure.pdf`     | A text-layer PDF — pdf.js extracts a real procedure, doc is ingested.    |
| `refund-policy.docx`     | A Word document — mammoth extracts its text, doc is ingested.            |
| `scanned-procedure.pdf`  | An image-only PDF (one embedded raster, no text layer) — extraction is   |
|                          | near-empty, so the doc is skipped-and-flagged and never grounds.         |

## Provenance

These were generated once with a throwaway Node script using `pdf-lib` (PDFs) and `docx`
(the Word file), then committed as binaries. Those libraries are **not** project dependencies —
only `pdfjs-dist` and `mammoth` (the read side) are. To regenerate, re-run an equivalent script:

- `text-procedure.pdf` — a page of `drawText` lines (a grill-closing procedure).
- `refund-policy.docx` — a heading plus two paragraphs.
- `scanned-procedure.pdf` — a page with a single `drawImage` (a 1×1 PNG stretched full-page) and
  no text, modelling a scan with no OCR/text layer.
