// Build small test documents in memory (nothing binary is committed).
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { existsSync } from 'node:fs';

export function makePdf(draw) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: 'Test Doc', Author: 'Tester' } });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    draw(doc);
    doc.end();
  });
}

export const englishPdf = () => makePdf((d) => {
  d.fontSize(24).text('Annual Report', { paragraphGap: 10 });
  d.fontSize(11).text('This is the first paragraph of the report. It is long enough to wrap onto a second line when rendered in a narrow column of text on the page.', { width: 300, paragraphGap: 12 });
  d.text('Second paragraph starts here and ends here.', { paragraphGap: 12 });
  d.fontSize(16).text('Results', { paragraphGap: 8 });
  d.fontSize(11).text('• first point\n• second point');
  d.addPage();
  d.fontSize(11).text('Page two body text.');
});

export const JA_FONT = ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf'].find(existsSync);   // test is skipped where no CJK font exists

export const japanesePdf = () => makePdf((d) => {
  d.font(JA_FONT);
  d.fontSize(22).text('営業報告書', { paragraphGap: 10 });
  d.fontSize(11).text('本書は令和８年度の営業活動について報告するものです。売上は前年比で増加しました。', { width: 400, paragraphGap: 10 });
  d.text('次の施策を実施します。');
});

const ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
export function makeDocx(paragraphs) {
  const body = paragraphs.map(({ text, style }) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(`${ct}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/styles.xml': strToU8('<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  }));
}

export async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('売上');
  ws.addRow(['月', '売上', 'メモ']); ws.addRow(['1月', 1200, 'a|b']); ws.addRow(['2月', 1500, '']);
  wb.addWorksheet('Empty');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function makePptx() {
  const slide = (title, bullets) => `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>${bullets.map((b) => `<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(`${ct}</Types>`),
    'ppt/presentation.xml': strToU8('<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
    'ppt/slides/slide1.xml': strToU8(slide('Roadmap', ['Q1 launch', 'Q2 scale &amp; grow'])),
    'ppt/slides/slide2.xml': strToU8(slide('Risks', ['Budget'])),
  }));
}

export const twoColumnPdf = () => makePdf((d) => {
  d.fontSize(20).text('Two Column Paper', { align: 'center', paragraphGap: 12 });
  const left = Array.from({ length: 14 }, (_, i) => `Left column sentence number ${i + 1} is here.`).join(' ');
  const right = Array.from({ length: 14 }, (_, i) => `Right column sentence number ${i + 1} is here.`).join(' ');
  d.fontSize(10);
  const y = d.y;
  d.text(left, 50, y, { width: 230 });
  d.text(right, 320, y, { width: 230 });
});
