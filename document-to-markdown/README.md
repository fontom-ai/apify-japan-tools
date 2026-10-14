# Document to Markdown & RAG Chunks — PDF, Word, Excel, PowerPoint, HTML (CJK-ready)

Turn documents into **clean Markdown, plain text and RAG-ready chunks** for LLM agents, search indexes and data pipelines. Pure code running inside the Actor: **no OCR service, no AI guessing, no third-party API, no API keys.**

## What makes the output good

* **Two-column PDFs are read in the right order** (left column, then right; full-width titles first). Most simple extractors interleave the columns line by line.
* **Headings, bullet lists and wrapped paragraphs** in PDFs are rebuilt from font sizes and positions; page-by-page text is included.
* **Japanese / Chinese / Korean text works**: no stray spaces inside words, and PDFs that encode characters as Kangxi radicals (⽇ ⺠ ⽂ instead of 日 民 文, common in Wikipedia and government PDFs) are folded back to normal ideographs so search and embeddings match. Optional NFKC normalisation for full-width letters and digits.
* **Word** (headings, lists, tables), **Excel** (every sheet as a Markdown table), **PowerPoint** (slide by slide, titles, bullets, speaker notes), **HTML** (main content only: navigation, headers, footers, forms, scripts and images dropped), **CSV / TXT / MD**.
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
| `fixCjkVariants` | Fold Kangxi-radical/compatibility glyphs (default on). `normalize` = NFKC (default off). |

## Output (one row per document)

```json
{ "ok": true, "source": "https://example.com/report.pdf", "type": "pdf", "title": "…", "pages": 12, "script": "ja",
  "chars": 18234, "markdown": "# …", "text": "…", "pageTexts": ["…"], "chunks": [{ "index": 0, "text": "…", "chars": 1432, "pages": [1, 2] }],
  "warnings": [] }
```

`script` is `ja`, `zh`, `ko`, `latin`, `other` or `unknown`, detected from the characters present. `warnings` tells you when something was skipped.

## Pricing

Pay per event: one `result` event per **successfully converted document**. Failed documents (404, blocked address, unsupported type, too large) return an `ok: false` row and are free.

## Limits, stated plainly

* **No OCR.** Scanned or image-only PDFs return a warning ("no text layer"), not text.
* **Vertical (tategaki) Japanese** reading order is not reconstructed (a warning is raised when it is detected).
* **PDF tables** are returned as text lines, not as Markdown tables (Excel and Word tables are real tables).
* Legacy `.doc`, `.xls`, `.ppt` are not supported (save as `.docx`, `.xlsx`, `.pptx`). Password-protected files fail with an error row.
* Layout-heavy PDFs (magazines, posters, forms) can come out in an imperfect reading order. Multi-column detection handles the common two-column paper/report layout only.
* Only documents you are allowed to process: you are responsible for the rights to the files you convert.

Tested on real documents: the *Attention Is All You Need* and *BERT* papers (single and two-column PDFs), a Wikipedia Japanese PDF (10 pages), the Japanese e-Gov law Word files with tables, and a Japanese HTML page; plus unit tests for every file type.
