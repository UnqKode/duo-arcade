const express = require('express'), http = require('http'), crypto = require('crypto');
const { Server } = require('socket.io');
const G = require('./game');

const cfg = () => ({
  ROUNDS: +process.env.ROUNDS || 5, ROUND_MS: +process.env.ROUND_MS || 30000,
  LETTER_MS: +process.env.LETTER_MS || 20000, GAP_MS: +process.env.GAP_MS || 3500,
});
const rooms = new Map();
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => { let c; do c = 'WORD-' + Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); while (rooms.has(c)); return c; };
const cleanName = n => String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player';
const pick = s => s[crypto.randomInt(s.length)];

// ---------- views (what each player is allowed to see) ----------
function view(r, slot) {
  const C = cfg(), g = r.game, now = Date.now();
  let gv = null;
  if (g && g.type === 'word') {
    const role = slot === g.roles.first ? 'first' : 'last', revealed = g.phase !== 'letters';
    gv = { type: 'word', round: g.round, rounds: C.ROUNDS, scores: g.scores, phase: g.phase, role,
      mySubmitted: !!g.letters[role], letters: revealed ? g.letters : null,
      msLeft: g.endsAt ? Math.max(0, g.endsAt - now) : 0, elapsed: g.startedAt ? now - g.startedAt : 0,
      results: g.results, note: g.note };
  } else if (g && g.type === 'grid') {
    gv = { type: 'grid', owner: g.owner, solver: g.solver, giver: g.giver, phase: g.phase, task: g.task,
      pending: g.pending, winner: g.winner, lastMove: g.lastMove, tasks: Object.fromEntries(Object.entries(G.TASKS).map(([k, v]) => [k, v.text])) };
  }
  return { code: r.code, you: slot, phase: r.phase, proposal: r.proposal, game: gv, rematch: [...r.rematch],
    players: r.players.map(p => p && { name: p.name, ready: p.ready, connected: p.connected }) };
}

module.exports.start = function start(port = process.env.PORT || 3000) {
  const app = express(), server = http.createServer(app), io = new Server(server);
  app.use(express.static(__dirname + '/public'));
  app.get('/healthz', (_, res) => res.send('ok'));

  const push = r => r.players.forEach((p, i) => p && p.sid && io.to(p.sid).emit('state', view(r, i)));
  const clear = r => { clearTimeout(r.timer); r.timer = null; };
  const later = (r, ms, fn) => { clear(r); r.timer = setTimeout(() => { fn(); push(r); }, ms); r.timer.unref(); };
  const full = r => r.players.every(Boolean);
  const reset = r => { clear(r); r.game = null; r.proposal = null; r.rematch = new Set(); r.players.forEach(p => p && (p.ready = false)); r.phase = full(r) ? 'lobby' : 'waiting'; };

  // ---------- Word Challenge ----------
  function wordStart(r) {
    r.game = { type: 'word', round: 0, scores: [0, 0], results: [], flip: crypto.randomInt(2), phase: 'letters', letters: {}, roles: {} };
    wordNext(r);
  }
  function wordNext(r) {
    const g = r.game, C = cfg();
    g.round++; g.letters = { first: null, last: null }; g.note = null; g.startedAt = null;
    g.roles = (g.round + g.flip) % 2 ? { first: 0, last: 1 } : { first: 1, last: 0 };
    g.phase = 'letters'; g.endsAt = Date.now() + C.LETTER_MS;
    later(r, C.LETTER_MS, () => { g.letters.first = g.letters.first || pick('cstpbmdrfhl'); g.letters.last = g.letters.last || pick('eatrsdnly'); wordReveal(r); });
  }
  function wordReveal(r) {
    const g = r.game, C = cfg();
    g.phase = 'play'; g.startedAt = Date.now(); g.endsAt = g.startedAt + C.ROUND_MS;
    later(r, C.ROUND_MS, () => wordEnd(r, null, null, null));
  }
  function wordEnd(r, winner, ms, word) {
    const g = r.game, C = cfg();
    if (g.phase !== 'play') return;
    clear(r);
    if (winner !== null) g.scores[winner]++;
    g.results.push({ round: g.round, first: g.letters.first, last: g.letters.last, winner, ms, word });
    g.endsAt = null;
    if (g.round >= C.ROUNDS) { g.phase = 'done'; r.phase = 'results'; r.rematch = new Set(); }
    else { g.phase = 'between'; later(r, C.GAP_MS, () => wordNext(r)); }
  }

  // ---------- Task Grid ----------
  function gridStart(r) {
    r.game = { type: 'grid', owner: Array(64).fill(null), solver: 1, giver: 0, phase: 'setTask', task: null, pending: null, winner: null, lastMove: null };
  }
  function gridCommit(r, cells) {
    const g = r.game;
    cells.forEach(i => { g.owner[i] = g.solver; });
    g.lastMove = { by: g.solver, cells }; g.pending = null; g.task = null;
    if (g.owner.every(o => o !== null)) { g.phase = 'done'; g.winner = g.solver; r.phase = 'results'; r.rematch = new Set(); return; }
    [g.solver, g.giver] = [g.giver, g.solver]; g.phase = 'setTask';
  }

  // ---------- sockets ----------
  io.on('connection', socket => {
    let n = 0; const iv = setInterval(() => (n = 0), 5000);
    socket.use((_, next) => (++n > 25 ? next(new Error('rate limited')) : next()));
    socket.on('error', () => {}); socket.on('disconnect', () => {
      clearInterval(iv);
      const r = rooms.get(socket.data.code); if (!r) return;
      const p = r.players[socket.data.slot];
      if (p && p.sid === socket.id) { p.sid = null; p.connected = false; push(r); }
      if (r.players.every(x => !x || !x.connected)) { clearTimeout(r.gc); r.gc = setTimeout(() => { clear(r); rooms.delete(r.code); }, 30 * 60 * 1000); r.gc.unref(); }
    });
    const attach = (r, slot, cb) => {
      const p = r.players[slot]; p.sid = socket.id; p.connected = true;
      socket.data = { code: r.code, slot }; socket.join(r.code); clearTimeout(r.gc);
      cb && cb({ ok: true, code: r.code, token: p.token, slot }); push(r);
    };
    const on = (ev, fn) => socket.on(ev, (d = {}, cb) => {
      try {
        const r = rooms.get(socket.data.code), slot = socket.data.slot;
        const out = fn(r, slot, d && typeof d === 'object' ? d : {}, cb);
        if (out && out.error) socket.emit('toast', out.error); else if (r) push(r);
      } catch (e) { socket.emit('toast', 'Something went wrong.'); }
    });

    socket.on('room:create', (d = {}, cb) => {
      if (typeof cb !== 'function') return;
      const r = { code: code(), players: [null, null], phase: 'waiting', game: null, proposal: null, rematch: new Set(), timer: null };
      r.players[0] = { name: cleanName(d.name), token: crypto.randomUUID(), ready: false, connected: false, sid: null };
      rooms.set(r.code, r); attach(r, 0, cb);
    });
    socket.on('room:join', (d = {}, cb) => {
      if (typeof cb !== 'function') return;
      const r = rooms.get(String(d.code || '').trim().toUpperCase());
      if (!r) return cb({ ok: false, error: 'Room not found. Check the code.' });
      const slot = r.players.findIndex(p => !p);
      if (slot < 0) return cb({ ok: false, error: 'This room already has two players.' });
      r.players[slot] = { name: cleanName(d.name), token: crypto.randomUUID(), ready: false, connected: false, sid: null };
      if (full(r) && r.phase === 'waiting') r.phase = 'lobby';
      attach(r, slot, cb);
    });
    socket.on('room:rejoin', (d = {}, cb) => {
      if (typeof cb !== 'function') return;
      const r = rooms.get(String(d.code || '').toUpperCase());
      const slot = r ? r.players.findIndex(p => p && p.token === d.token) : -1;
      if (slot < 0) return cb({ ok: false, error: 'Session expired.' });
      const old = r.players[slot].sid; if (old && old !== socket.id) io.sockets.sockets.get(old)?.disconnect(true);
      attach(r, slot, cb);
    });

    on('leave', (r, slot) => {
      if (!r) return;
      r.players[slot] = null; socket.leave(r.code); socket.data = {};
      if (r.players.every(p => !p)) { clear(r); rooms.delete(r.code); return; }
      reset(r); r.phase = 'waiting'; push(r); socket.emit('left');
    });
    on('ready', (r, slot) => { if (r.phase !== 'lobby') return { error: 'Waiting for a second player.' }; r.players[slot].ready = !r.players[slot].ready; });
    on('propose', (r, slot, d) => {
      if (r.phase !== 'lobby') return { error: 'Not in the lobby.' };
      if (!['word', 'grid'].includes(d.game)) return { error: 'Unknown game.' };
      r.proposal = { game: d.game, by: slot };
    });
    on('accept', (r, slot) => {
      if (r.phase !== 'lobby' || !r.proposal) return { error: 'Nothing to accept.' };
      if (r.proposal.by === slot) return { error: 'Your friend needs to accept your pick.' };
      if (!r.players.every(p => p && p.ready)) return { error: 'Both players must be ready first.' };
      (r.proposal.game === 'word' ? wordStart : gridStart)(r); r.phase = 'playing'; r.players.forEach(p => (p.ready = false));
    });
    on('rematch', (r, slot) => {
      if (r.phase !== 'results') return;
      r.rematch.add(slot);
      if (r.rematch.size === 2) { const t = r.game.type; r.rematch = new Set(); (t === 'word' ? wordStart : gridStart)(r); r.phase = 'playing'; }
    });
    on('lobby', (r) => { if (r.phase === 'results') reset(r); });

    on('word:letter', (r, slot, d) => {
      const g = r.game; if (!g || g.type !== 'word' || g.phase !== 'letters') return;
      const role = slot === g.roles.first ? 'first' : 'last', l = String(d.letter || '').toLowerCase();
      if (!/^[a-z]$/.test(l)) return { error: 'Choose one letter, A–Z.' };
      if (g.letters[role]) return { error: 'Letter already locked in.' };
      g.letters[role] = l;
      if (g.letters.first && g.letters.last) wordReveal(r);
    });
    on('word:answer', (r, slot, d) => {
      const g = r.game; if (!g || g.type !== 'word' || g.phase !== 'play') return;
      const v = G.validateWord(d.word, g.letters.first, g.letters.last);
      if (!v.ok) return socket.emit('feedback', { ok: false, text: v.reason });
      wordEnd(r, slot, Date.now() - g.startedAt, v.word);
    });

    on('grid:task', (r, slot, d) => {
      const g = r.game; if (!g || g.type !== 'grid' || g.phase !== 'setTask') return;
      if (slot !== g.giver) return { error: "It's not your turn to give a task." };
      if (G.TASKS[d.id]) g.task = { id: d.id, text: G.TASKS[d.id].text };
      else { const t = String(d.text || '').replace(/[<>]/g, '').trim().slice(0, 120); if (!t) return { error: 'Write a task first.' }; g.task = { id: null, text: t }; }
      g.phase = 'solve';
    });
    on('grid:submit', (r, slot, d) => {
      const g = r.game; if (!g || g.type !== 'grid' || g.phase !== 'solve') return;
      if (slot !== g.solver) return { error: "It's not your turn." };
      const err = G.validateCells(d.cells, g.owner); if (err) return { error: err };
      if (g.task.id) { if (!G.checkTask(g.task.id, d.cells)) return { error: 'That selection doesn\'t match the task.' }; gridCommit(r, d.cells); }
      else {
        if (d.cells.length > G.MAX_CUSTOM_CELLS) return { error: `Custom tasks claim at most ${G.MAX_CUSTOM_CELLS} cells.` };
        g.pending = d.cells; g.phase = 'approve';
      }
    });
    on('grid:review', (r, slot, d) => {
      const g = r.game; if (!g || g.type !== 'grid' || g.phase !== 'approve') return;
      if (slot !== g.giver) return { error: 'Only the task giver can review.' };
      if (d.approve === true) gridCommit(r, g.pending); else { g.pending = null; g.phase = 'solve'; }
    });
  });
  return new Promise(res => server.listen(port, () => res({ server, io, port: server.address().port, rooms })));
};
if (require.main === module) module.exports.start().then(s => console.log('Listening on :' + s.port));
