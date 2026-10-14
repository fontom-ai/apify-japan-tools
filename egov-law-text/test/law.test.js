import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kanjiToInt, parseQuery, pickLaw, articleResult, listArticles } from '../src/law.js';

const minpo = JSON.parse(readFileSync(new URL('./fixture-minpo.json', import.meta.url), 'utf8'));

test('kanji numbers', () => {
  for (const [s, n] of [['七百九', 709], ['千二百', 1200], ['十', 10], ['二十三', 23], ['四百十五', 415], ['709', 709], ['７０９', 709], ['百', 100]]) assert.equal(kanjiToInt(s), n, s);
  assert.ok(Number.isNaN(kanjiToInt('あ')));
});

test('query parsing', () => {
  assert.deepEqual(parseQuery('民法第709条'), { lawName: '民法', article: '709', paragraph: null });
  assert.deepEqual(parseQuery('民法 第七百九条'), { lawName: '民法', article: '709', paragraph: null });
  assert.deepEqual(parseQuery('民法第90条の2'), { lawName: '民法', article: '90_2', paragraph: null });
  assert.deepEqual(parseQuery('民法第九十条の二第一項'), { lawName: '民法', article: '90_2', paragraph: 1 });
  assert.deepEqual(parseQuery('個人情報保護法27条2項'), { lawName: '個人情報保護法', article: '27', paragraph: 2 });
  assert.deepEqual(parseQuery('民法第四百六十六条の五'), { lawName: '民法', article: '466_5', paragraph: null });
  assert.deepEqual(parseQuery('会社法'), { lawName: '会社法', article: null, paragraph: null });
});

test('law choice', () => {
  const L = (id, title, status, type = 'Act', abbrev = '') => ({ law_info: { law_id: id, law_type: type }, revision_info: { law_title: title, repeal_status: status, abbrev } });
  const laws = [L('a', '民法', 'None'), L('b', '民法施行法', 'None'), L('c', '旧民法', 'Repeal')];
  assert.equal(pickLaw(laws, '民法').law.law_info.law_id, 'a');
  assert.equal(pickLaw([L('x', '個人情報の保護に関する法律', 'None', 'Act', '個人情報保護法'), L('y', '個人情報の保護に関する法律施行令', 'None', 'CabinetOrder', '個人情報保護法施行令')], '個人情報保護法').law.law_info.law_id, 'x');
  const amb = pickLaw([L('p', '建築基準法', 'None'), L('q', '建築基準法', 'None')], '建築基準法');
  assert.equal(amb.law, null); assert.equal(amb.ambiguous.length, 2);
  assert.equal(pickLaw([L('z', 'だれか', 'None')], '民法').law.law_info.law_id, 'z');   // single live candidate
});

test('article 709', () => {
  const r = articleResult(minpo, '709');
  assert.equal(r.articleTitle, '第七百九条');
  assert.equal(r.caption, '（不法行為による損害賠償）');
  assert.match(r.text, /故意又は過失によって他人の権利又は法律上保護される利益を侵害した者は、これによって生じた損害を賠償する責任を負う。$/);
  assert.equal(r.paragraphCount, 1);
});

test('article 415 has two paragraphs and a proviso', () => {
  const r = articleResult(minpo, '415');
  assert.equal(r.paragraphCount, 2);
  assert.match(r.text, /ただし、その債務の不履行が/);
  assert.match(r.text, /\n2　/);
  const p2 = articleResult(minpo, '415', 2);
  assert.equal(p2.paragraphs.length, 1);
  assert.ok(articleResult(minpo, '415', 9).error);
  assert.equal(articleResult(minpo, '99999'), null);
});

test('branch article and listing', () => {
  assert.ok(articleResult(minpo, '466_5'));
  assert.deepEqual(listArticles(minpo.law_full_text).map((a) => a.num).sort(), ['1', '415', '466_5', '709']);
});
