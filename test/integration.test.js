process.env.ROUND_MS = '1500'; process.env.GAP_MS = '100'; process.env.LETTER_MS = '5000'; process.env.ROUNDS = '2';
const t = require('node:test'), assert = require('node:assert'), { io } = require('socket.io-client');
const { start } = require('../server');
const ask = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = (s, pred, ms = 3000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('timeout')), ms); let last;
  const h = st => { last = st; if (pred(st)) { clearTimeout(to); s.off('state', h); res(st); } };
  s.on('state', h); if (s.last && pred(s.last)) h(s.last);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ctx; const mk = () => { const s = io('http://localhost:' + ctx.port, { forceNew: true }); s.on('state', st => (s.last = st)); return s; };

t('multiplayer flows', async () => {
  ctx = await start(0);
  const a = mk(), b = mk(), c = mk();
  const ra = await ask(a, 'room:create', { name: 'Ann' }); assert.ok(ra.ok && /^WORD-/.test(ra.code));
  const rb = await ask(b, 'room:join', { code: ra.code.toLowerCase(), name: 'Bo' }); assert.ok(rb.ok);
  const rc = await ask(c, 'room:join', { code: ra.code, name: 'Cy' }); assert.ok(!rc.ok, 'third player rejected');
  await wait(a, s => s.phase === 'lobby');

  // cannot start before both ready
  a.emit('propose', { game: 'grid' }); await sleep(100);
  b.emit('accept'); await sleep(100); assert.strictEqual(b.last.phase, 'lobby');
  a.emit('ready'); b.emit('ready'); await sleep(100);
  b.emit('accept'); await wait(a, s => s.phase === 'playing' && s.game.type === 'grid');

  // out-of-turn + task validation. solver = slot 1 (Bo), giver = slot 0 (Ann)
  b.emit('grid:task', { id: 'h5' }); await sleep(100); assert.strictEqual(a.last.game.phase, 'setTask');
  a.emit('grid:task', { id: 'h5' }); await wait(b, s => s.game.phase === 'solve');
  a.emit('grid:submit', { cells: [0, 1, 2, 3, 4] }); await sleep(100); assert.strictEqual(a.last.game.owner[0], null, 'giver cannot solve');
  b.emit('grid:submit', { cells: [0, 1, 2, 3, 9] }); await sleep(100); assert.strictEqual(b.last.game.owner[0], null, 'invalid pattern rejected');
  b.emit('grid:submit', { cells: [8, 9, 10, 11, 12] });
  await wait(a, s => s.game.owner[8] === 1 && s.game.solver === 0);
  // custom task: solver cannot self-approve, giver rejects then approves
  a.emit('grid:task', { text: 'Pick 2 cells' }); // a is solver now, b is giver
  await sleep(100); assert.strictEqual(a.last.game.phase, 'setTask', 'only giver sets task');
  b.emit('grid:task', { text: 'Pick 2 cells' }); await wait(a, s => s.game.phase === 'solve');
  a.emit('grid:submit', { cells: [8, 20] }); await sleep(100); assert.strictEqual(a.last.game.owner[20], null, 'claimed cell rejected');
  a.emit('grid:submit', { cells: [20, 21] }); await wait(b, s => s.game.phase === 'approve');
  a.emit('grid:review', { approve: true }); await sleep(100); assert.strictEqual(a.last.game.phase, 'approve', 'no self-approve');
  b.emit('grid:review', { approve: false }); await wait(a, s => s.game.phase === 'solve' && s.game.owner[20] === null);
  a.emit('grid:submit', { cells: [20, 21] }); await wait(b, s => s.game.phase === 'approve');
  b.emit('grid:review', { approve: true }); await wait(a, s => s.game.owner[20] === 0);

  // reconnect with token restores state
  const before = a.last; a.disconnect();
  await wait(b, s => !s.players[0].connected);
  const a2 = mk(); const rj = await ask(a2, 'room:rejoin', { code: ra.code, token: ra.token });
  assert.ok(rj.ok); await wait(a2, s => s.game && s.game.owner[20] === 0);

  // fill the board via server-internal state to test winner on final cell
  const room = ctx.rooms.get(ra.code); room.game.owner.fill(0, 0, 63); room.game.owner[63] = null; room.game.phase = 'solve';
  room.game.task = { id: 'any1', text: 'x' }; room.game.solver = 1; room.game.giver = 0;
  b.emit('grid:submit', { cells: [63] });
  const fin = await wait(b, s => s.phase === 'results'); assert.strictEqual(fin.game.winner, 1);

  // rematch resets; then Word game
  b.emit('lobby'); await wait(b, s => s.phase === 'lobby');
  a2.emit('propose', { game: 'word' }); a2.emit('ready'); b.emit('ready'); await sleep(100); b.emit('accept');
  const st = await wait(b, s => s.game && s.game.type === 'word');
  const chooser = x => x.last.game.mySubmitted === false;
  a2.emit('word:letter', { letter: 'c' }); b.emit('word:letter', { letter: 't' });
  const pa = await wait(a2, s => s.game.phase === 'play'); const L = pa.game.letters;
  assert.strictEqual(L.first.length, 1);
  b.emit('word:answer', { word: 'xyz' }); // invalid: no points
  const gotFirst = L.first, gotLast = L.last;
  const word = require('an-array-of-english-words').find(w => w.length > 3 && w[0] === gotFirst && w.at(-1) === gotLast);
  a2.emit('word:answer', { word }); b.emit('word:answer', { word });  // duplicate: only one point
  await wait(a2, s => s.game.phase === 'between');
  assert.strictEqual(a2.last.game.scores[0] + a2.last.game.scores[1], 1);
  const done = await wait(a2, s => s.phase === 'results', 8000);  // round 2 times out -> draw
  assert.strictEqual(done.game.results.length, 2);
  [a2, b, c].forEach(s => s.close()); await ctx.io.close();
});
