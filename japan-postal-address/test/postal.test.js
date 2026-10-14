import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { PostalIndex, parseKenAll, normalizeText, normalizeZip, parseAnnotation } from '../src/postal.js';

const zip = unzipSync(new Uint8Array(readFileSync(new URL('../data/utf_ken_all.zip', import.meta.url))));
const idx = new PostalIndex(parseKenAll(strFromU8(Object.values(zip)[0])));

test('data loads', () => { assert.ok(idx.rows.length > 120000); });

test('normalize', () => {
  assert.equal(normalizeText('東京都　千代田区　飯田橋１−２−３'), '東京都千代田区飯田橋1-2-3');
  assert.equal(normalizeText('飯田橋1ー2ー3'), '飯田橋1-2-3');
  assert.equal(normalizeText('北一条西二十三丁目'), '北1条西23丁目');
  assert.equal(normalizeZip('〒１００−０００１'), '1000001');
  assert.equal(normalizeZip('100 0001'), '1000001');
  assert.equal(normalizeZip('12345'), null);
});

test('annotation', () => {
  assert.deepEqual(parseAnnotation('１〜１９丁目'), { kind: 'range', unit: '丁目', ranges: [[1, 19]] });
  assert.equal(parseAnnotation('次のビルを除く').kind, 'general');
  assert.equal(parseAnnotation('１階').kind, 'building');
});

test('zip -> address', () => {
  const r = idx.lookupZip('1000005');
  assert.ok(r.length >= 1);
  assert.equal(r[0].prefecture, '東京都'); assert.equal(r[0].city, '千代田区'); assert.equal(r[0].town, '丸の内');
  assert.equal(r[0].zip, '100-0005');
  assert.deepEqual(idx.lookupZip('0000000'), []);
});

test('address -> zip', () => {
  const t = (a) => idx.addressToZip(a);
  assert.equal(t('東京都千代田区飯田橋1-2-3').zip, '1020072');
  assert.equal(t('東京都 千代田区 飯田橋１丁目２番３号').zip, '1020072');
  assert.equal(t('千代田区飯田橋1-2-3').zip, '1020072');                   // prefecture omitted, city unique
  assert.equal(t('北海道札幌市中央区大通西5丁目').zip, '0600042');
  assert.equal(t('北海道札幌市中央区大通西二十丁目').zip, '0640820');       // chome range decides
  assert.equal(t('北海道札幌市中央区大通西5丁目').town, '大通西');
  assert.equal(t('東京都新宿区西新宿2-8-1').prefecture, '東京都');
  assert.equal(t('三重県津市').prefecture, '三重県');                       // 三 is a kanji numeral: must not be rewritten in names
  assert.equal(t('東京都千代田区').confidence, 'city');
  assert.equal(t('東京都千代田区').zip, '1000000');
  assert.equal(t('どこか遠く').confidence, 'none');
  assert.equal(t('東京都千代田区大字飯田橋1').town, '飯田橋');               // 大字 prefix is not in the data
});

test('ambiguous when a town has several codes and no block number', () => {
  const r = idx.addressToZip('北海道札幌市中央区大通西');
  assert.equal(r.confidence, 'ambiguous'); assert.equal(r.zip, null); assert.ok(r.candidates.length >= 2);
});
