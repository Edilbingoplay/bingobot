const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ADMIN_ID = 8334791462;
const APP_URL = 'https://onrender.com';

const wallets = new Map();
const games = new Map();
const userStates = new Map();

function getWallet(id) {
  const k = String(id);
  if (!wallets.has(k)) wallets.set(k, { userId: k, balance: 0 });
  return wallets.get(k);
}

async function sendTgMessage(chatId, text, replyMarkup = undefined) {
  const tgUrl = `https://telegram.org{process.env.BOT_TOKEN}/sendMessage`;
  await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    })
  }).catch(err => console.error('TG Error:', err));
}

const mainKeyboard = {
  keyboard: [
    [{ text: '🎮 ጨዋታ ጀምር (Play Bingo)' }],
    [{ text: '💰 ቀሪ ሒሳብ' }, { text: '💳 ገንዘብ አስገባ' }],
    [{ text: '💸 ገንዘብ አውጣ' }]
  ],
  resize_keyboard: true
};

const cancelKeyboard = {
  keyboard: [[{ text: '❌ ሰርዝ (Cancel)' }]],
  resize_keyboard: true
};

function makeCard() {
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
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
    if ([0, 1, 2, 3, 4].every(c => ok(i, c))) return true;
    if ([0, 1, 2, 3, 4].every(r => ok(r, i))) return true;
  }
  return [0, 1, 2, 3, 4].every(i => ok(i, i)) || [0, 1, 2, 3, 4].every(i => ok(i, 4 - i));
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

app.post('/api/game/claim-bingo', async (req, res) => {
  const g = games.get(String(req.body.gameId || 'default'));
  if (!g) return res.status(404).json({ error: 'Not found' });
  const p = g.players[String(req.body.userId)];
  if (!p) return res.status(400).json({ error: 'Not in game' });
  if (!hasWin(p.card, new Set(g.calledNumbers))) return res.status(400).json({ error: 'Invalid win' });
  if (!g.winner && g.pot > 0) {
    const prize = g.pot;
    const w = getWallet(req.body.userId);
    w.balance += prize;
    g.winner = { userId: String(req.body.userId), prize };
    g.pot = 0;
    g.status = 'finished';

    await sendTgMessage(
      req.body.userId,
      `🎉 *እንኳን ደስ አለዎት! ቢንጎ አሸንፈዋል!*\n\n🏆 ሽልማት: *${prize} ብር*\n💰 አዲስ ቀሪ ሒሳብ: *${w.balance} ብር*`,
      mainKeyboard
    );
  }
  res.json({ won: true, winner: g.winner });
});

app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const userName = msg.from?.first_name || 'ተጫዋች';
  const text = (msg.text || '').trim();
  const w = getWallet(chatId);
  const state = userStates.get(String(chatId));

  if (text === '❌ ሰርዝ (Cancel)') {
    userStates.delete(String(chatId));
    await sendTgMessage(chatId, '✅ ሂደቱ ተሰርዟል። ወደ ዋናው ሜኑ ተመልሰዋል።', mainKeyboard);
    return res.sendStatus(200);
  }

  if (text.startsWith('/add ') && chatId === ADMIN_ID) {
    const parts = text.split(' ');
    const targetId = parts[1];
    const amt = Number(parts[2]);
    if (targetId && Number.isFinite(amt) && amt > 0) {
      const targetWallet = getWallet(targetId);
      targetWallet.balance += amt;
      await sendTgMessage(ADMIN_ID, `✅ ለተጫዋች \`${targetId}\` *${amt} ብር* ተጨምሯል። አዲስ ሒሳብ: *${targetWallet.balance} ብር*`);
      await sendTgMessage(targetId, `🎉 *${amt} ብር* ወደ ሒሳብዎ ገብቷል!\n💰 አሁን ያለዎት ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
    } else {
      await sendTgMessage(ADMIN_ID, '⚠️ አጠቃቀም: `/add USER_ID 100`');
    }
    return res.sendStatus(200);
  }

  if (text === '/start' || text === '/play' || text === '🎮 ጨዋታ ጀምር (Play Bingo)') {
    userStates.delete(String(chatId));
    await sendTgMessage(
      chatId,
      `🎲 እንኳን ወደ *Edil Bingos* በደህና መጡ፣ ${userName}!\n\n💰 ቀሪ ሒሳብዎ: *${w.balance} ብር*\n\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይንኩ፦`,
      { inline_keyboard: [[{ text: '🎮 ቢንጎ ይጫወቱ (Play Bingo)', web_app: { url: `${APP_URL}?uid=${chatId}` } }]] }
    );
    if (text === '/start') {
      await sendTgMessage(chatId, 'ከታች ያሉትን አማራጮች መጠቀም ይችላሉ 👇', mainKeyboard);
    }
  } else if (text === '/balance' || text === '💰 ቀሪ ሒሳብ') {
    userStates.delete(String(chatId));
    await sendTgMessage(chatId, `💰 የእርስዎ ቀሪ ሒሳብ (Balance): *${w.balance} ብር* ነው።`, mainKeyboard);
  } else if (text === '/deposit' || text === '💳 ገንዘብ አስገባ') {
    userStates.set(String(chatId), 'WAITING_DEPOSIT');
    await sendTgMessage(
      chatId,
      `💳 *ገንዘብ ለማስገባት (Deposit)*\n\n` +
      `1️⃣ በቴሌብር (Telebirr): \`0911XXXXXX\`\n` +
      `2️⃣ በCBE: \`1000XXXXXXXXX\`\n\n` +
      `ገንዘቡን ካስገቡ በኋላ *የላኩትን የብር መጠን እና Transaction ID* (ወይም የደረሰኝ ፎቶ) እዚህ ይላኩ፦`,
      cancelKeyboard
    );
  } else if (text === '/withdrawal' || text === '💸 ገንዘብ አውጣ') {
    if (w.balance < 50) {
      await sendTgMessage(chatId, `⚠️ ገንዘብ ለማውጣት ቢያንስ *50 ብር* ሊኖርዎት ይገባል። የአሁን ሒሳብዎ: *${w.balance} ብር*`, mainKeyboard);
    } else {
      userStates.set(String(chatId), 'WAITING_WITHDRAW');
      await sendTgMessage(
        chatId,
        `💸 *ገንዘብ ወጪ ማድረጊያ (Withdrawal)*\nቀሪ ሒሳብዎ: *${w.balance} ብር*\n\nየሚያወጡትን መጠን ይምረጡ ወይም በቁጥር ይጻፉ፦`,
        {
          keyboard: [
            [{ text: '50 ብር' }, { text: '100 ብር' }],
            [{ text: '200 ብር' }, { text: '500 ብር' }],
            [{ text: '❌ ሰርዝ (Cancel)' }]
          ],
          resize_keyboard: true
        }
      );
    }
  } else if (state === 'WAITING_DEPOSIT') {
    const info = text || '[የደረሰኝ ፎቶ ተልኳል]';
    await sendTgMessage(
      ADMIN_ID,
      `🔔 *አዲስ የገንዘብ ማስገባት ጥያቄ!*\n👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n📝 መልእክት: ${info}\n\nሒሳቡን ለመሙላት ይህን ይላኩ፡\n\`/add ${chatId} 100\``
    );
    userStates.delete(String(chatId));
    await sendTgMessage(chatId, '✅ መረጃዎ ለአድሚን ተልኳል። በጥቂት ደቂቃዎች ውስጥ ሒሳብዎ ይሞላል!', mainKeyboard);
  } else if (state === 'WAITING_WITHDRAW') {
    const amt = Number(text.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(amt) || amt < 50) {
      await sendTgMessage(chatId, '⚠️ እባክዎ ትክክለኛ የብር መጠን (ከ50 ብር ጀምሮ) ያስገቡ።');
    } else if (amt > w.balance) {
      await sendTgMessage(chatId, `⚠️ በቂ ቀሪ ሒሳብ የለዎትም። ያለዎት: *${w.balance} ብር*`);
    } else {
      w.balance -= amt;
      await sendTgMessage(
        ADMIN_ID,
        `💸 *የገንዘብ ማውጣት ጥያቄ (Withdrawal)!*\n👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n💵 መጠን: *${amt} ብር*\n💰 ቀሪ ሒሳብ: *${w.balance} ብር*`
      );
      userStates.delete(String(chatId));
      await sendTgMessage(chatId, `✅ *${amt} ብር* ወጪ እንዲደረግ ጥያቄዎ ተልኳል። ቀሪ ሒሳብዎ: *${w.balance} ብር*`, mainKeyboard);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log('Running'));

   
