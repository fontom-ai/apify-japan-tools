import test from 'node:test';
import assert from 'node:assert/strict';
import { convertBytes, detectType } from '../src/convert.js';
import { chunkBlocks, detectScript, fixCjkVariants } from '../src/text.js';
import { isPrivateIp, assertPublicUrl } from '../src/fetchdoc.js';
import { englishPdf, twoColumnPdf, japanesePdf, JA_FONT, makeDocx, makeXlsx, makePptx } from './fixtures.js';

test('type detection', async () => {
  assert.equal(detectType(await englishPdf()), 'pdf');
  assert.equal(detectType(makeDocx([{ text: 'x' }])), 'docx');
  assert.equal(detectType(await makeXlsx()), 'xlsx');
  assert.equal(detectType(makePptx()), 'pptx');
  assert.equal(detectType(Buffer.from('<!doctype html><p>x'), {}), 'html');
  assert.equal(detectType(Buffer.from('a,b\n1,2'), { name: 'x.csv' }), 'csv');
  assert.equal(detectType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), 'legacy-office');
  assert.equal(detectType(Buffer.from([1, 2, 3, 4])), 'unknown');
});

test('pdf: headings, paragraph re-joining, bullets, pages, metadata', async () => {
  const r = await convertBytes(await englishPdf());
  assert.equal(r.type, 'pdf'); assert.equal(r.pages, 2); assert.equal(r.title, 'Test Doc'); assert.equal(r.author, 'Tester');
  assert.match(r.markdown, /^# Annual Report/m);
  assert.match(r.markdown, /^## Results/m);
  assert.match(r.markdown, /first paragraph of the report\. It is long enough to wrap onto a second line/);   // wrapped lines re-joined
  assert.match(r.markdown, /^- first point/m);
  assert.equal(r.pageTexts.length, 2);
  assert.match(r.pageTexts[1], /Page two body text/);
  assert.equal(r.script, 'latin');
});

test('pdf: Japanese text and script detection', { skip: !JA_FONT }, async () => {
  const r = await convertBytes(await japanesePdf());
  assert.match(r.text, /営業報告書/);
  assert.match(r.text, /令和８年度の営業活動について報告する/);      // no spaces inserted inside Japanese
  assert.equal(r.script, 'ja');
  assert.match((await convertBytes(await japanesePdf(), { normalize: true })).text, /令和8年度/);   // NFKC turns full-width digits into ASCII
});

test('docx, xlsx, pptx, html, csv, txt', async () => {
  const d = await convertBytes(makeDocx([{ text: 'Title here', style: 'Heading1' }, { text: 'Body text.' }]));
  assert.equal(d.type, 'docx'); assert.match(d.markdown, /Title here/); assert.match(d.text, /Body text\./);
  const x = await convertBytes(await makeXlsx());
  assert.equal(x.type, 'xlsx'); assert.match(x.markdown, /## 売上/); assert.match(x.markdown, /\| 1月 \| 1200 \| a\\\|b \|/);
  assert.deepEqual(x.sheets.map((s) => s.name), ['売上']);                 // empty sheet skipped
  const p = await convertBytes(makePptx());
  assert.equal(p.pages, 2); assert.match(p.markdown, /# Roadmap/); assert.match(p.markdown, /- Q2 scale & grow/); assert.match(p.markdown, /<!-- slide 2 -->/);
  const h = await convertBytes(Buffer.from('<html><head><title>T</title></head><body><nav>menu</nav><main><h1>Head</h1><p>Para <a href="http://x.example">link</a></p><script>bad()</script></main></body></html>'), { name: 'a.html' });
  assert.equal(h.title, 'T'); assert.match(h.markdown, /# Head/); assert.match(h.markdown, /\[link\]\(http:\/\/x\.example\)/); assert.doesNotMatch(h.markdown, /bad\(\)|menu/);
  const c = await convertBytes(Buffer.from('a,b\n"x,y",2\n'), { name: 'a.csv' });
  assert.match(c.markdown, /\| x,y \| 2 \|/);
  assert.equal((await convertBytes(Buffer.from('plain text'), { name: 'a.txt' })).markdown, 'plain text');
});

test('errors are readable', async () => {
  await assert.rejects(() => convertBytes(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /Legacy/);
  await assert.rejects(() => convertBytes(Buffer.from([1, 2, 3, 4])), /Unsupported/);
});

test('empty/scanned pdf gets a warning, not an error', async () => {
  const { makePdf } = await import('./fixtures.js');
  const r = await convertBytes(await makePdf((d) => { d.rect(10, 10, 100, 100).fill('red'); }));
  assert.match(r.warnings.join(' '), /scanned|No text layer/);
});

test('chunking keeps pages and respects size', () => {
  const blocks = [{ text: 'A'.repeat(900), page: 1 }, { text: 'B'.repeat(900), page: 2 }, { text: '短い文。'.repeat(300), page: 3 }];
  const ch = chunkBlocks(blocks, 1000, 100);
  assert.ok(ch.length >= 3);
  assert.ok(ch.every((c) => c.chars <= 1100));
  assert.deepEqual(ch[0].pages, [1, 1]);
  assert.ok(ch.at(-1).pages[1] === 3);
  assert.deepEqual(chunkBlocks(blocks, 0), []);
});

test('script detection', () => {
  assert.equal(detectScript('これは日本語の文章です。'), 'ja');
  assert.equal(detectScript('这是中文文章内容测试'), 'zh');
  assert.equal(detectScript('한국어 문장입니다 테스트'), 'ko');
  assert.equal(detectScript('Plain English sentence.'), 'latin');
  assert.equal(detectScript('12'), 'unknown');
});

test('SSRF guard', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  for (const u of ['file:///etc/passwd', 'ftp://x.example/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'http://169.254.169.254/latest', 'http://user:pw@8.8.8.8/', 'notaurl']) await assert.rejects(() => assertPublicUrl(u), undefined, u);
});

test('pdf: two columns are read left then right, full-width title first', async () => {
  const md = (await convertBytes(await twoColumnPdf())).markdown;
  const iL = md.indexOf('Left column sentence number 14 is here.');
  const iR = md.indexOf('Right column sentence number 1 is here.');
  assert.ok(iL > 0 && iR > 0 && iL < iR, 'left column must finish before the right column starts');
  assert.ok(md.indexOf('Two Column Paper') < md.indexOf('Left column sentence number 1 is here.'));
});

test('html: navigation, forms and images are dropped', async () => {
  const h = await convertBytes(Buffer.from('<body><header>SITE</header><nav>menu</nav><div><h1>Doc</h1><img src="a.png"><p>Real text.</p></div><footer>foot</footer></body>'), { name: 'a.html' });
  assert.match(h.markdown, /Real text/); assert.doesNotMatch(h.markdown, /SITE|menu|foot|a\.png/);
});

test('Kangxi radicals / compatibility forms are folded to normal ideographs', () => {
  assert.equal(fixCjkVariants('国⺠の祝⽇ ⽂⼦'), '国民の祝日 文子');
  assert.equal(fixCjkVariants('ＡＢＣ１２３'), 'ＡＢＣ１２３');   // only the broken forms, not full-width letters (that is `normalize`)
});

test('pdf: aligned text becomes a Markdown table (right-aligned numbers, header row, surrounding text kept)', async () => {
  const { tablePdf } = await import('./fixtures.js');
  const r = await convertBytes(await tablePdf());
  assert.match(r.markdown, /\| Region \| Q1 \| Q2 \| Growth \|\n\| --- \| --- \| --- \| --- \|\n\| North \| 1,200 \| 1,350 \| 12\.5% \|/);
  assert.match(r.markdown, /\| West \| 710 \| 905 \| 27\.5% \|/);
  assert.match(r.markdown, /^# Quarterly Sales/m);
  assert.match(r.markdown, /^The table below lists revenue by region\./m);
  assert.match(r.markdown, /^Revenue grew in every region/m);
  assert.equal(r.tables, 1);
  assert.match(r.text, /North\t1,200\t1,350\t12\.5%/);
});

test('pdf: Japanese table keeps cells separate and does not add spaces inside Japanese words', { skip: !JA_FONT }, async () => {
  const { japaneseTablePdf } = await import('./fixtures.js');
  const r = await convertBytes(await japaneseTablePdf());
  assert.match(r.markdown, /\| 支店 \| 売上（百万円） \| 前年比 \|/);
  assert.match(r.markdown, /\| 名古屋 \| 540 \| -1\.5% \|/);
  assert.match(r.markdown, /^以上のとおり、東京と福岡が好調でした。/m);
  assert.equal(r.tables, 1);
});

test('pdf: wrapped cell text joins the row above instead of breaking the table', async () => {
  const { wrappedCellTablePdf } = await import('./fixtures.js');
  const r = await convertBytes(await wrappedCellTablePdf());
  assert.match(r.markdown, /\| Beta \| A longer description that wraps that wraps onto a second line \| 25 \|/.source ? /\| Beta \| A longer description that wraps that wraps onto a second line \| 25 \|/ : /x/);
  assert.equal(r.tables, 1);
});

test('pdf: ordinary paragraphs, bullets and two-column text are not mistaken for tables', async () => {
  for (const make of [englishPdf, twoColumnPdf]) {
    const r = await convertBytes(await make());
    assert.equal(r.tables, 0);
    assert.doesNotMatch(r.markdown, /\| --- \|/);
  }
});

test('Shift_JIS and EUC-JP files are decoded (Japanese CSV/HTML are often not UTF-8)', async () => {
  const sjisCsv = Buffer.from([0x93, 0xFA, 0x96, 0x7B, 0x8C, 0xEA, 0x2C, 0x89, 0x63, 0x8B, 0xC6, 0x0A, 0x31, 0x2C, 0x32, 0x0A]);   // 日本語,営業 / 1,2
  const c = await convertBytes(sjisCsv, { name: 'x.csv' });
  assert.match(c.markdown, /\| 日本語 \| 営業 \|/); assert.equal(c.encoding, 'shift_jis');
  const eucTxt = Buffer.from([0xC6, 0xFC, 0xCB, 0xDC, 0xB8, 0xEC, 0x0A]);                      // 日本語
  const t = await convertBytes(eucTxt, { name: 'x.txt', contentType: 'text/plain; charset=EUC-JP' });
  assert.equal(t.markdown, '日本語'); assert.equal(t.encoding, 'euc-jp');
  const head = Buffer.from('<html><head><meta charset="Shift_JIS"><title>');
  const html = Buffer.concat([head, Buffer.from([0x93, 0xFA, 0x96, 0x7B]), Buffer.from('</title></head><body><main><p>'), Buffer.from([0x8C, 0xEA]), Buffer.from('</p></main></body></html>')]);
  const h = await convertBytes(html, { name: 'a.html' });
  assert.equal(h.title, '日本'); assert.match(h.markdown, /語/); assert.equal(h.encoding, 'shift_jis');
  const utf8 = await convertBytes(Buffer.from('日本語,営業\n1,2\n'), { name: 'u.csv' });
  assert.match(utf8.markdown, /日本語/); assert.equal(utf8.encoding, undefined);
});

test('detectTables:false keeps table rows as plain text', async () => {
  const { tablePdf } = await import('./fixtures.js');
  const r = await convertBytes(await tablePdf(), { detectTables: false });
  assert.equal(r.tables, 0); assert.doesNotMatch(r.markdown, /\| --- \|/); assert.match(r.markdown, /North 1,200 1,350 12\.5%/);
});

test('scanned PDF is flagged with the empty page numbers', async () => {
  const { makePdf } = await import('./fixtures.js');
  const r = await convertBytes(await makePdf((d) => { d.rect(50, 50, 100, 100).fill('#000'); d.addPage(); d.rect(60, 60, 20, 20).fill('#000'); }));
  assert.equal(r.scanned, true); assert.deepEqual(r.emptyPages, [1, 2]); assert.match(r.warnings[0], /scanned|image-only/);
});
