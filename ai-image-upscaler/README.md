# AI Image Upscaler 2x / 4x — Real-ESRGAN on CPU, no GPU, pay per image

**Run it on Apify Store:** https://apify.com/fontom.ai.plus/ai-image-upscaler

Make small, blurry or compressed images bigger and cleaner. Give a list of image URLs, get back **2x or 4x upscaled files** (PNG, JPG or WebP) as links. Runs the open-source **Real-ESRGAN (general x4v3)** model on CPU inside the Actor: **no GPU, no subscription, no API key, no third-party service.**

## Good for
* Product and marketplace photos that are too small for a store's size requirement
* Old photos, scans, screenshots, memes, social-media images that were compressed
* Illustrations, anime/manga art, game assets, logos with soft edges
* Batches: hundreds of images in one run from a list of URLs

## How it works
The image is cut into overlapping tiles, each tile is enlarged 4x by the neural network, and the tiles are stitched back together without visible seams. For **2x**, the 4x result is reduced with a high-quality filter, which usually looks crisper than a plain 2x enlargement. **Transparency (alpha) is kept.** EXIF rotation is respected.

## Input
| Field | Meaning |
|---|---|
| `urls` | Public image URLs (up to 500 per run). |
| `images` | Optional inline files: `[{"name": "a.jpg", "base64": "..."}]`. |
| `scale` | `2` or `4` (default 4). |
| `outputFormat` | `png` (default), `jpg`, `webp`; `quality` for JPG/WebP. |
| `maxInputMegapixels` | Larger inputs are reduced to this size first (default 4 MP ≈ 2000×2000, maximum 8 MP). |

## Output (one row per image)
```json
{ "ok": true, "source": "https://example.com/small.jpg", "outputUrl": "https://api.apify.com/v2/key-value-stores/…/records/upscaled-0001.png",
  "inputWidth": 640, "inputHeight": 480, "outputWidth": 2560, "outputHeight": 1920, "format": "png", "seconds": 9.4, "warnings": [] }
```

## Pricing
Pay per event: one `result` event per **successfully upscaled image**. Unreachable URLs, unreadable files and blocked addresses return an `ok: false` row and are free.

## What it does and does not do (read before you buy)
* It is a **fast, general-purpose upscaler** (a 1.2-million-parameter network). It sharpens edges, removes compression blocking and mild noise, and adds plausible fine detail. It does **not** invent faces or text that are not in the picture, and it will not rescue a 30×30-pixel thumbnail.
* The result is visibly sharper than a plain bicubic/Lanczos enlargement, but it is a perceptual model: pixel-accuracy scores (PSNR) are about the same as or slightly below a plain enlargement, and fine textures such as foliage can look slightly painted. Judge by eye on your own images.
* **Heavily damaged photos** (severe blur, very strong noise) improve less than with large diffusion-based upscalers that need a GPU.
* No face-specific restoration, no colourisation, no object removal.
* Run time grows with input size: about 5–10 seconds per input megapixel on the default 4 GB Actor (a 160×120 or 640×480 image takes well under a few seconds).
* Only images you have the right to process: you are responsible for the files you submit.

## Credits and licence
Model: Real-ESRGAN `realesr-general-x4v3` by Xintao Wang et al., BSD-3-Clause (https://github.com/xinntao/Real-ESRGAN), distributed through Qualcomm AI Hub Models as an ONNX export (BSD-3-Clause). The Actor code is MIT.
