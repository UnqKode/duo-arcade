// Pure game logic (no I/O) — unit tested in test/game.test.js
const DICT = new Set(require('an-array-of-english-words'));
const norm = s => String(s == null ? '' : s).trim().toLowerCase();

function validateWord(word, first, last, dict = DICT) {
  const w = norm(word);
  if (!w) return { ok: false, reason: 'Type a word first.' };
  if (!/^[a-z]+$/.test(w)) return { ok: false, reason: 'Letters only, no spaces or symbols.' };
  if (w[0] !== first) return { ok: false, reason: `Must start with ${first.toUpperCase()}.` };
  if (w[w.length - 1] !== last) return { ok: false, reason: `Must end with ${last.toUpperCase()}.` };
  if (w.length < 3) return { ok: false, reason: 'Use at least 3 letters.' };
  if (!dict.has(w)) return { ok: false, reason: `"${w}" is not in the dictionary.` };
  return { ok: true, word: w };
}

const rc = i => [Math.floor(i / 8), i % 8];
const consecutive = a => { const s = [...a].sort((x, y) => x - y); return s.every((v, i) => i === 0 || v === s[i - 1] + 1); };
const same = a => a.every(v => v === a[0]);
function connected(cells) {
  const set = new Set(cells), seen = new Set([cells[0]]), q = [cells[0]];
  while (q.length) {
    const i = q.pop(), [r, c] = rc(i);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc, n = nr * 8 + nc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return seen.size === cells.length;
}
function diagonal(cells) {
  const p = cells.map(rc).sort((a, b) => a[0] - b[0]);
  if (!consecutive(p.map(x => x[0]))) return false;
  const d = p.slice(1).map((x, i) => x[1] - p[i][1]);
  return d.every(v => v === 1) || d.every(v => v === -1);
}
const CORNERS = [0, 7, 56, 63];
const TASKS = {
  any1: { text: 'Select any 1 cell', check: c => c.length === 1 },
  any5: { text: 'Select any 5 cells', check: c => c.length === 5 },
  h5: { text: 'Select 5 cells in a straight horizontal line', check: c => c.length === 5 && same(c.map(i => rc(i)[0])) && consecutive(c.map(i => rc(i)[1])) },
  v4: { text: 'Select 4 cells in the same column, side by side', check: c => c.length === 4 && same(c.map(i => rc(i)[1])) && consecutive(c.map(i => rc(i)[0])) },
  d3: { text: 'Select 3 cells in a diagonal line', check: c => c.length === 3 && diagonal(c) },
  nc6: { text: 'Select 6 cells, none in a corner', check: c => c.length === 6 && !c.some(i => CORNERS.includes(i)) },
  conn7: { text: 'Select 7 connected cells', check: c => c.length === 7 && connected(c) },
};
const MAX_CUSTOM_CELLS = 16;

// Structural check shared by all tasks: unique ints 0..63, all unclaimed.
function validateCells(cells, owner) {
  if (!Array.isArray(cells) || !cells.length || cells.length > 64) return 'Pick at least one cell.';
  if (!cells.every(i => Number.isInteger(i) && i >= 0 && i < 64)) return 'Invalid cell.';
  if (new Set(cells).size !== cells.length) return 'Duplicate cells.';
  if (cells.some(i => owner[i] !== null)) return 'Some cells are already claimed.';
  return null;
}
function checkTask(id, cells) { return !!(TASKS[id] && TASKS[id].check(cells)); }

module.exports = { validateWord, validateCells, checkTask, TASKS, MAX_CUSTOM_CELLS, DICT };
