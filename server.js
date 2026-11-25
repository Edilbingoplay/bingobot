const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const wallets = new Map();
const games = new Map();

function getWallet(id) {
  const k = String(id);
  if (!wallets.has(k)) wallets.set(k, { userId: k, balance: 100 });
  return wallets.get(k);
}

function makeCard() {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  const card = ranges.map(([min, max]) => {
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    pool.sort(() => Math.random() - 0.5);
    return pool.slice(0, 5);
  });
  card[2][2] = 'FREE';
  return card;
}

function hasWin(card, called) {
  const ok = (r, c) => card[c][r] === 'FREE' || called.has(card[c][r]);
  for (let i = 0; i < 5; i++) {
    if ([0,1,2,3,4].every(c => ok(i, c))) return true;
    if ([0,1,2,3,4].every(r => ok(r, i))) return true;
  }
  return [0,1,2,3,4].every(i => ok(i, i)) || [0,1,2,3,4].every(i => ok(i, 4 - i));
}


app.get('/api/wallet/:userId', (req, res) => res.json(getWallet(req.params.userId)));

app.post('/api/wallet/deposit', (req, res) => {
  const amt = Number(req.body.amount);
  if (!req.body.userId || !Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid input' });
  const w = getWallet(req.body.userId);
  w.balance += amt;
  res.json(w);
});

app.post('/api/game/create', (req, res) => {
  const stake = Number(req.body.stake || 10);
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Invalid stake' });
  const g = { gameId: String(req.body.gameId || 'default'), stake, pot: 0, status: 'open', calledNumbers: [], players: {}, winner: null };
  games.set(g.gameId, g);
  res.json(g);
});

app.post('/api/game/join', (req, res) => {
  const g = games.get(String(req.body.gameId || 'default'));
  if (!g || g.status !== 'open') return res.status(400).json({ error: 'Game closed' });
  const w = getWallet(req.body.userId);
  if (w.balance < g.stake) return res.status(400).json({ error: 'Low balance' });
  w.balance -= g.stake;
  g.pot += g.stake;
  const card = makeCard();
  g.players[String(req.body.userId)] = { userId: String(req.body.userId), card };
  res.json({ balance: w.balance, pot: g.pot, card });
});

app.post('/api/game/call', (req, res) => {
  const g = games.get(String(req.body.gameId || 'default'));
  if (!g) return res.status(404).json({ error: 'Not found' });
  const used = new Set(g.calledNumbers);
  const left = [];
  for (let n = 1; n <= 75; n++) if (!used.has(n)) left.push(n);
  if (!left.length) return res.json({ message: 'Done', calledNumbers: g.calledNumbers });
  const nextNumber = left[Math.floor(Math.random() * left.length)];
  g.calledNumbers.push(nextNumber);
  res.json({ nextNumber, calledNumbers: g.calledNumbers });
});

app.post('/api/game/claim-bingo', (req, res) => {
  const g = games.get(String(req.body.gameId || 'default'));
  if (!g) return res.status(404).json({ error: 'Not found' });
  const p = g.players[String(req.body.userId)];
  if (!p) return res.status(400).json({ error: 'Not in game' });
  if (!hasWin(p.card, new Set(g.calledNumbers))) return res.status(400).json({ error: 'Invalid win' });
  if (!g.winner && g.pot > 0) {
    const w = getWallet(req.body.userId);
    w.balance += g.pot;
    g.winner = { userId: String(req.body.userId), prize: g.pot };
    g.pot = 0;
    g.status = 'finished';
  }
  res.json({ won: true, winner: g.winner });
});
app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (msg && msg.text === '/start') {
    const tgUrl = 'https://' + 'api.telegram.org/bot' + process.env.BOT_TOKEN + '/sendMessage';
    const appUrl = 'https://' + 'bingobot-0vk4' + '.onrender.com';

    await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: '🎲 እንኳን ወደ Edil Bingos በደህና መጡ!\n\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይንኩ፦',
        reply_markup: {
          inline_keyboard: [[{ text: '🎮 ቢንጎ ይጫወቱ (Play Bingo)', web_app: { url: appUrl } }]]
        }
      })
    });
  }
  res.sendStatus(200);
});

app.listen(PORT, () => console.log('Running'));
