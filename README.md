# Japan data tools for Apify (and AI agents)

Small, deterministic tools for Apify (three on official Japanese public data, one general document converter). No scraping, no AI guessing.

| Actor | What it does |
|---|---|
| [japan-business-calendar](japan-business-calendar) ([Apify](https://apify.com/fontom.ai.plus/japan-business-calendar)) | Business days, national holidays (Cabinet Office), 和暦 ⇄ 西暦, fiscal year |
| [japan-postal-address](japan-postal-address) ([Apify](https://apify.com/fontom.ai.plus/japan-postal-address)) | Postal code ⇄ address, address normalisation (Japan Post KEN_ALL, refreshed every run) |
| [egov-law-text](egov-law-text) ([Apify](https://apify.com/fontom.ai.plus/egov-law-text)) | Exact statute article text by name (e-Gov Law API), with point-in-time versions |
| [ai-image-upscaler](ai-image-upscaler) ([Apify](https://apify.com/fontom.ai.plus/ai-image-upscaler)) | 2x/4x image upscaling with Real-ESRGAN on CPU (no GPU), transparency kept |
| [document-to-markdown](document-to-markdown) ([Apify](https://apify.com/fontom.ai.plus/document-to-markdown)) | PDF / Word / Excel / PowerPoint / HTML to Markdown and RAG chunks; two-column PDFs and CJK text handled |

Each folder is a self-contained Apify Actor (`.actor/`, `Dockerfile`, tests: `npm test`). MIT licensed.
