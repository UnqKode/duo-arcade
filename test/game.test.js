const t = require('node:test'), assert = require('node:assert'), G = require('../game');
const D = new Set(['cat', 'coat', 'court']);
t('word validation', () => {
  assert.ok(G.validateWord('Coat', 'c', 't', D).ok);
  assert.ok(!G.validateWord('', 'c', 't', D).ok);
  assert.ok(!G.validateWord('co at', 'c', 't', D).ok);
  assert.ok(!G.validateWord('cot', 'c', 't', D).ok);      // not in dictionary
  assert.ok(!G.validateWord('dog', 'c', 't', D).ok);
  assert.ok(G.validateWord('court', 'c', 't').ok);         // real dictionary
  assert.ok(!G.validateWord('cxxt', 'c', 't').ok);
});
t('task library', () => {
  assert.ok(G.checkTask('h5', [8, 9, 10, 11, 12]));
  assert.ok(!G.checkTask('h5', [6, 7, 8, 9, 10]));        // wraps rows
  assert.ok(G.checkTask('v4', [3, 11, 19, 27]));
  assert.ok(G.checkTask('d3', [0, 9, 18]) && G.checkTask('d3', [7, 14, 21]));
  assert.ok(!G.checkTask('d3', [0, 9, 19]));
  assert.ok(!G.checkTask('nc6', [0, 1, 2, 3, 4, 5]) && G.checkTask('nc6', [1, 2, 3, 4, 5, 6]));
  assert.ok(G.checkTask('conn7', [0, 1, 2, 10, 18, 19, 20]) && !G.checkTask('conn7', [0, 1, 2, 3, 4, 5, 63]));
});
t('cell validation blocks claimed/duplicate/invalid', () => {
  const o = Array(64).fill(null); o[5] = 0;
  assert.ok(G.validateCells([5], o)); assert.ok(G.validateCells([1, 1], o));
  assert.ok(G.validateCells([64], o)); assert.ok(G.validateCells([], o));
  assert.strictEqual(G.validateCells([1, 2], o), null);
});
