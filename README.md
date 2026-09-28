# Doodle Duel

Pictionary-style multiplayer drawing game. Node.js + Express + Socket.io on the backend, one HTML5 canvas page on the front end.

## How it plays

- One player creates a room and gets a 4-letter code; others join with it.
- Each round everyone takes a turn drawing while the rest guess in chat.
- The drawer picks from 3 words, hint letters reveal over time, and faster correct guesses score more.
- 3 rounds, then a final leaderboard.

## Run it

```bash
npm install
npm start
```

Open `http://localhost:3000`. Test solo by opening two browser tabs — create a room in one, join with the code in the other.

## Play with friends

- **Same Wi-Fi:** others open `http://YOUR-COMPUTER-IP:3000` (find your IP in your network settings).
- **Anywhere:** run `npx cloudflared tunnel --url http://localhost:3000` for a public link, or deploy to a host like Render or Railway for a permanent one.
