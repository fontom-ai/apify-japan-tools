# Document to Markdown & RAG Chunks — PDF, Word, Excel, PowerPoint, HTML (CJK-ready)

**Run it on Apify Store:** https://apify.com/fontom.ai.plus/document-to-markdown

Turn documents into **clean Markdown, plain text and RAG-ready chunks** for LLM agents, search indexes and data pipelines. Pure code running inside the Actor: **no OCR service, no AI guessing, no third-party API, no API keys.**

## What makes the output good

* **Two-column PDFs are read in the right order** (left column, then right; full-width titles first). Most simple extractors interleave the columns line by line.
* **PDF tables come out as real Markdown tables** (header row, right-aligned numbers, wrapped cell text, Japanese tables), found from the alignment of the text itself. Turn it off with `detectTables: false`.
* **Headings, bullet lists and wrapped paragraphs** in PDFs are rebuilt from font sizes and positions; page-by-page text is included.
* **Japanese / Chinese / Korean text works**: no stray spaces inside words, and PDFs that encode characters as Kangxi radicals (⽇ ⺠ ⽂ instead of 日 民 文, common in Wikipedia and government PDFs) are folded back to normal ideographs so search and embeddings match. Optional NFKC normalisation for full-width letters and digits.
* **Word** (headings, lists, tables), **Excel** (every sheet as a Markdown table), **PowerPoint** (slide by slide, titles, bullets, speaker notes), **HTML** (main content only: navigation, headers, footers, forms, scripts and images dropped), **CSV / TXT / MD**.
* **Shift_JIS, EUC-JP and UTF-16 files are decoded correctly** (Japanese government CSVs and older sites are often not UTF-8). The detected encoding is reported when it is not UTF-8.
* **Scanned PDFs are flagged clearly**: `scanned: true`, the page numbers without a text layer, and a warning, so a pipeline can route them to OCR.
* **RAG chunks** (optional): paragraph- and sentence-aware, with overlap and the page range of every chunk.
* **Safe by design**: only public http(s) URLs (private, local and cloud-metadata addresses are blocked, also after redirects), file size and page limits.

## Input

| Field | Meaning |
|---|---|
| `urls` | Public document URLs (up to 5,000 per run). |
| `documents` | Optional inline files: `[{"name": "a.pdf", "base64": "..."}]`. |
| `chunkSize` | Characters per chunk (0 = off; 1000–2000 typical). `chunkOverlap` (default 150). |
| `maxPages`, `maxFileMb`, `maxChars` | Limits (defaults 500 pages, 50 MB, 2,000,000 characters). |
| `includePageTexts` | Page-by-page text for PDFs (default on). |
| `detectTables` | Turn aligned PDF text into Markdown tables (default on). Switch off to get plain lines. |
| `fixCjkVariants` | Fold Kangxi-radical/compatibility glyphs (default on). `normalize` = NFKC (default off). |

## Output (one row per document)

```json
{ "ok": true, "source": "https://example.com/report.pdf", "type": "pdf", "title": "…", "pages": 12, "script": "ja",
  "chars": 18234, "markdown": "# …", "text": "…", "pageTexts": ["…"], "chunks": [{ "index": 0, "text": "…", "chars": 1432, "pages": [1, 2] }],
  "warnings": [] }
```

`script` is `ja`, `zh`, `ko`, `latin`, `other` or `unknown`, detected from the characters present. `tables` counts the Markdown tables found in a PDF. `scanned` / `emptyPages` appear for PDFs without a text layer, `encoding` for files that were not UTF-8. `warnings` tells you when something was skipped.

## Pricing

Pay per event, as shown on the Actor page: a tiny **start fee per run** ($0.00005) plus **one charge per result row** ($0.01) (Apify's dataset-item event). **Every row is charged, including rows for documents that failed to convert** (404, blocked address, unsupported type, too large), so check URLs before big batches. One run can hold up to 5,000 documents.

## Limits, stated plainly

* **No OCR.** Scanned or image-only PDFs return a warning ("no text layer"), not text.
* **Vertical (tategaki) Japanese** reading order is not reconstructed (a warning is raised when it is detected).
* **PDF tables are inferred from text alignment**, so they are only as good as the layout: borderless tables, merged header cells and tables that continue across pages can be split or mis-aligned, and infographics or figure labels are occasionally turned into a small table. Tables that sit beside body text in a two-column page are read as text. Use `detectTables: false` if you prefer plain lines.
* Legacy `.doc`, `.xls`, `.ppt` are not supported (save as `.docx`, `.xlsx`, `.pptx`). Password-protected files fail with an error row.
* Layout-heavy PDFs (magazines, posters, forms) can come out in an imperfect reading order. Multi-column detection handles the common two-column paper/report layout only.
* Only documents you are allowed to process: you are responsible for the rights to the files you convert.

Tested on real, public documents (conversion time on a laptop, tables found in the PDF): *Attention Is All You Need* (15 pages), *BERT* (16), *LLaMA* (27), *GPT-3* (75, 244k characters), the Japanese National Tax Agency invoice-system leaflets (27 and 4 pages), the Ministry of Internal Affairs and Communications white-paper index tables (8 pages, long Japanese tables spanning pages), a Wikipedia Japanese PDF, the e-Gov law Word files and a Japanese HTML page, plus unit tests for every file type and for tables, text columns, wrapped cells, Japanese tables, Shift_JIS/EUC-JP files and scanned pages. The check script is `scripts/benchmark.mjs`.
