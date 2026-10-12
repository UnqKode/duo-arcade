# Duo Arcade
Two-player real-time room with two games: **Word Challenge** and **Task Grid**.
Node + Express + Socket.IO (WebSockets). Server-authoritative; vanilla-JS client in `public/`.

## Run
    npm install && npm start      # http://localhost:3000
    npm test                      # unit + 2-client integration tests

Open the site in two browsers (or one + incognito): create a room in one, join with the code or invite link in the other, both press Ready, one picks a game, the other accepts.

## Layout
- `game.js` pure rules (word validation, task library, cell validation)
- `server.js` rooms, lifecycle, Socket.IO events, rate limiting, reconnect (token in localStorage)
- `public/index.html` client; `test/` tests

## Deploy (needs a persistent Node process, not serverless)
Render / Railway / Fly.io: build `npm install`, start `npm start`, health check `/healthz`, set `PORT` if required. Run a single instance (room state is in memory).

## Known limitations
- Room state is in memory: a server restart ends active rooms. No PostgreSQL / match history yet.
- Plain JavaScript, not TypeScript/Next.js/Tailwind. No sound.
- Custom Task Grid tasks are approved by the task giver (max 16 cells per custom task).
