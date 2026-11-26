const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ADMIN_ID = 8334791462; // የእርስዎን ትክክለኛ Telegram ID እዚህ ያስገቡ
const TELEBIRR_NUMBER = '0984960995';
const APP_URL = 'https://የእርስዎ-ሊንክ.onrender.com'; // የ Render ሊንክዎን እዚህ ያስገቡ

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const walletSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 }
});
const Wallet = mongoose.model('Wallet', walletSchema);

const userStates = new Map();
const pendingDeposits = new Set();
const pendingWithdrawAmount = new Map();

async function getWallet(id) {
  const k = String(id);
  let w = await Wallet.findOne({ userId: k });
  if (!w) {
    w = await Wallet.create({ userId: k, balance: 0 });
  }
  return w;
}

async function sendTgMessage(chatId, text, replyMarkup = undefined) {
  const tgUrl = `https://telegram.org{process.env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(err => console.error('TG Error:', err));
}

const room = {
  phase: 'LOBBY',
  timer: 25,
  stake: 5,
  pot: 0,
  calledNumbers: [],
  pool: [],
  lockedCartelas: new Map(),
  winner: null,
  winners: [],
};

function resetRoomToLobby() {
  room.phase = 'LOBBY';
  room.timer = 25;
  room.pot = 0;
  room.calledNumbers = [];
  room.pool = [];
  room.lockedCartelas.clear();
  room.winner = null;
  room.winners = [];
}

async function startCentralGame() {
  if (room.lockedCartelas.size === 0) {
    room.timer = 25;
    return;
  }

  let validPot = 0;
  const userCounts = new Map();
  for (const [cid, info] of room.lockedCartelas.entries()) {
    userCounts.set(info.userId, (userCounts.get(info.userId) || 0) + 1);
  }

  for (const [uid, count] of userCounts.entries()) {
    const cost = count * room.stake;
    const w = await getWallet(uid);
    if (w.balance >= cost) {
      w.balance -= cost;
      await w.save();
      validPot += cost;
    } else {
      for (const [cid, info] of room.lockedCartelas.entries()) {
        if (info.userId === uid) room.lockedCartelas.delete(cid);
      }
    }
  }

  if (room.lockedCartelas.size === 0) {
    resetRoomToLobby();
    return;
  }

  room.phase = 'PLAYING';
  room.pot = Math.floor(validPot * 0.8);
  room.calledNumbers = [];
  room.winner = null;
  room.winners = [];
  room.pool = Array.from({ length: 75 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
}

let tickCount = 0;
setInterval(async () => {
  tickCount++;
  if (room.phase === 'LOBBY') {
    if (room.lockedCartelas.size > 0) {
      room.timer--;
      if (room.timer <= 0) await startCentralGame();
    } else {
      room.timer = 25;
    }
  } else if (room.phase === 'PLAYING') {
    if (tickCount % 3 === 0) {
      if (room.pool.length > 0 && !room.winner) {
        room.calledNumbers.push(room.pool.pop());
      } else if (room.pool.length === 0 && !room.winner) {
        room.phase = 'FINISHED';
        room.timer = 6;
      }
    }
  } else if (room.phase === 'FINISHED') {
    room.timer--;
    if (room.timer <= 0) resetRoomToLobby();
  }
}, 1000);

app.get('/api/game/state/:userId', async (req, res) => {
  const uid = String(req.params.userId || '');
  const w = await getWallet(uid);
  const taken = Array.from(room.lockedCartelas.keys());
  const myCartelas = [];
  for (const [cid, info] of room.lockedCartelas.entries()) {
    if (info.userId === uid) myCartelas.push(cid);
  }
  const playersCount = new Set(Array.from(room.lockedCartelas.values()).map(v => v.userId)).size;

  res.json({
    phase: room.phase,
    timer: room.timer,
    stake: room.stake,
    pot: room.pot,
    calledNumbers: room.calledNumbers,
    taken: taken,
    myCartelas: myCartelas,
    playersCount: playersCount,
    winner: room.winner,
    winners: room.winners,
    balance: w.balance
  });
});

app.post('/api/game/stake', (req, res) => {
  if (room.phase !== 'LOBBY') return res.status(400).json({ error: 'Game started' });
  const s = Number(req.body.stake);
  if (s === 5 || s === 10) room.stake = s;
  res.json({ stake: room.stake });
});

app.post('/api/cartelas/lock', async (req, res) => {
  if (room.phase !== 'LOBBY') return res.status(400).json({ error: 'ጨዋታው ተጀምሯል! ቀጣዩን ዙር ይጠብቁ።' });
  const cid = Number(req.body.cartelaId);
  const uid = String(req.body.userId || '');
  const userName = String(req.body.userName || 'ተጫዋች');
  if (!cid || !uid) return res.status(400).json({ error: 'Invalid' });

  if (room.lockedCartelas.has(cid) && room.lockedCartelas.get(cid).userId !== uid) {
    return res.status(409).json({ error: 'ይህ ካርቴላ በሌላ ተጫዋች ተይዟል!' });
  }

  let myCount = 0;
  for (const info of room.lockedCartelas.values()) {
    if (info.userId === uid) myCount++;
  }
  if (myCount >= 3) return res.status(400).json({ error: 'እስከ 3 ካርቴላ ብቻ ነው የሚፈቀደው!' });

  const w = await getWallet(uid);
  if (w.balance < (myCount + 1) * room.stake) {
    return res.status(400).json({ error: 'በቂ ቀሪ ሒሳብ የለዎትም!' });
  }

  room.lockedCartelas.set(cid, { userId: uid, userName: userName });
  res.json({ locked: true });
});

app.post('/api/cartelas/release', (req, res) => {
  if (room.phase !== 'LOBBY') return res.status(400).json({ error: 'Locked' });
  const cid = Number(req.body.cartelaId);
  const uid = String(req.body.userId || '');
  if (room.lockedCartelas.get(cid)?.userId === uid) {
    room.lockedCartelas.delete(cid);
  }
  res.json({ released: true });
});

app.post('/api/game/win', async (req, res) => {
  if (room.phase !== 'PLAYING') return res.json({ accepted: false });

  const uid = String(req.body.userId || '');
  const cartelaId = Number(req.body.cartelaId || 0);
  const cartelaInfo = room.lockedCartelas.get(cartelaId);
  const realName = (cartelaInfo && cartelaInfo.userName && cartelaInfo.userName !== 'ተጫዋች')
    ? cartelaInfo.userName
    : (req.body.userName && req.body.userName !== 'ተጫዋች' ? req.body.userName : 'ተጫዋች');
  const cardCols = req.body.cardCols;
  const winIndices = req.body.winIndices;

  if (!room.winners) room.winners = [];
  if (room.winners.some(w => w.userId === uid && w.cartelaId === cartelaId)) return res.json({ accepted: true });

  if (room.winners.length === 0) {
    room.winners.push({ userId: uid, userName: realName, cartelaId: cartelaId, cardCols: cardCols, winIndices: winIndices });

    setTimeout(async () => {
      const count = room.winners.length;
      const share = Math.floor(room.pot / count);
      for (const w of room.winners) {
        w.prize = share;
        const wallet = await getWallet(w.userId);
        wallet.balance += share;
        await wallet.save();

        if (w.userId && w.userId !== 'guest') {
          await sendTgMessage(
            w.userId,
            `🎉🏆 *እንኳን ደስ አለዎት ${w.userName}!*\n\n` +
            (count > 1 ? `ከ ${count} አሸናፊዎች ጋር ደራሹን ተካፍለው ` : `በካርቴላ *#${w.cartelaId}* አሸንፈው `) +
            `*${share} ብር* ወደ ዋሌትዎ ገብቷል!\n💰 አዲስ ቀሪ ሒሳብዎ: *${wallet.balance} ብር*`
          );
        }
      }
      room.winner = room.winners[0];
      room.phase = 'FINISHED';
      room.timer = 7;
    }, 1500);

    return res.json({ accepted: true });
  }

  room.winners.push({ userId: uid, userName: realName, cartelaId: cartelaId, cardCols: cardCols, winIndices: winIndices });
  res.json({ accepted: true });
});

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

// Telegram Webhook Endpoint
app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const uidStr = String(chatId);
  const userName = msg.from?.first_name || 'ተጫዋች';
  const text = (msg.text || '').trim();
  const w = await getWallet(chatId);
  const state = userStates.get(uidStr);

  if (text === '❌ ሰርዝ (Cancel)') {
    userStates.delete(uidStr);
    pendingWithdrawAmount.delete(uidStr);
    await sendTgMessage(chatId, '✅ ሂደቱ ተሰርዟል። ወደ ዋናው ሜኑ ተመልሰዋል።', mainKeyboard);
    return res.sendStatus(200);
  }

  if (text.startsWith('/add ') && chatId === ADMIN_ID) {
    const parts = text.split(' ');
    const targetId = String(parts[1] || '');
    const amt = Number(parts[2]);

    if (targetId && Number.isFinite(amt) && amt >= 50 && amt <= 500) {
      const targetWallet = await getWallet(targetId);
      targetWallet.balance += amt;
      await targetWallet.save();
      pendingDeposits.delete(targetId);
      await sendTgMessage(ADMIN_ID, `✅ ለተጫዋች \`${targetId}\` *${amt} ብር* ተጨምሯል። አዲስ ሒሳብ: *${targetWallet.balance} ብር*`);
      await sendTgMessage(targetId, `🎉 *${amt} ብር* ወደ ዋሌትዎ ገብቷል!\n💰 አሁን ያለዎት ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
    } else {
      await sendTgMessage(ADMIN_ID, '⚠️ አጠቃቀም: `/add USER_ID 100` (መጠኑ ከ50 እስከ 500 ብር መሆን አለበት)');
    }
    return res.sendStatus(200);
  }

  if (text === '/start' || text === '/play' || text === '🎮 ጨዋታ ጀምር (Play Bingo)') {
    userStates.delete(uidStr);
    pendingWithdrawAmount.delete(uidStr);
    const playMarkup = {
      inline_keyboard: [
        [{ text: '🎮 ቢንጎ ይጫወቱ (Play Bingo)', web_app: { url: APP_URL + '?uid=' + chatId } }]
      ]
    };
    await sendTgMessage(
      chatId,
    await sendTgMessage(
      chatId,
      `🎲 እንኳን ወደ *Edil Bingos* በደህና መጡ፣ ${userName}!\n\n💰 ቀሪ ሒሳብዎ: *${w.balance} ብር*\n🎯 መደብ: *5 ብር - 10 ብር*\n\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይንኩ፦`,
      playMarkup
    );
    if (text === '/start') {
      await sendTgMessage(chatId, 'ከታች ያሉትን አማራጮች መጠቀም ይችላሉ 👇', mainKeyboard);
    }
  } else if (text === '/balance' || text === '💰 ቀሪ ሒሳብ') {
    userStates.delete(uidStr);
    await sendTgMessage(chatId, `💰 የእርስዎ ቀሪ ሒሳብ (Balance): *${w.balance} ብር* ነው።`, mainKeyboard);
  } else if (text === '/deposit' || text === '💳 ገንዘብ አስገባ') {
    if (pendingDeposits.has(uidStr)) {
      await sendTgMessage(
        chatId,
        '⏳ *ያስገቡት የገንዘብ ጥያቄ ገና በመረጋገጥ ላይ ነው!*\n\nየላኩት ገንዘብ ወደ ዋሌትዎ ሳይገባ ድጋሚ ገቢ ማድረግ አይችሉም። እባክዎ ትንሽ ይጠብቁ።',
        mainKeyboard
      );
      return res.sendStatus(200);
    }

    userStates.set(uidStr, 'WAITING_DEPOSIT');
    const depositMarkup = {
      keyboard: [
        [{ text: '50 ብር' }, { text: '100 ብር' }],
        [{ text: '200 ብር' }, { text: '500 ብር' }],
        [{ text: '❌ ሰርዝ (Cancel)' }]
      ],
      resize_keyboard: true
    };
    await sendTgMessage(
      chatId,
      `💳 *ገንዘብ ለማስገባት (Deposit)*\n` +
      `📌 ዝቅተኛ: *50 ብር* | ከፍተኛ: *500 ብር*\n\n` +
      `📱 *በቴሌብር (Telebirr):* \`${TELEBIRR_NUMBER}\`\n` +
      `*(ቁጥሩን ሲነኩት በቀጥታ Copy ይሆናል)*\n\n` +
      `ገንዘቡን ካስገቡ በኋላ *የላኩትን የብር መጠን (ከ50-500 ብር) እና Transaction ID* እዚህ ይላኩ፦`,
      depositMarkup
    );
  } else if (text === '/withdrawal' || text === '💸 ገንዘብ አውጣ') {
    if (w.balance < 50) {
      await sendTgMessage(chatId, `⚠️ ገንዘብ ለማውጣት ዋሌትዎ ላይ ቢያንስ *50 ብር* ሊኖርዎት ይገባል።\n💰 የአሁን ቀሪ ሒሳብዎ: *${w.balance} ብር*`, mainKeyboard);
    } else {
      userStates.set(uidStr, 'WAITING_WITHDRAW');
      const withdrawMarkup = {
        keyboard: [
          [{ text: '50 ብር' }, { text: `ሙሉውን (${w.balance} ብር)` }],
          [{ text: '❌ ሰርዝ (Cancel)' }]
        ],
        resize_keyboard: true
      };
      await sendTgMessage(
        chatId,
        `💸 *ገንዘብ ወጪ ማድረጊያ (Withdrawal)*\n\n` +
        `💰 ዋሌትዎ ላይ ያለ ቀሪ ሒሳብ: *${w.balance} ብር*\n` +
        `📌 ማውጣት የሚችሉት: *ከ50 ብር እስከ ${w.balance} ብር* ብቻ ነው።\n\n` +
        `የሚያወጡትን የብር መጠን በቁጥር ይጻፉ ወይም ከታች ይምረጡ፦`,
        withdrawMarkup
      );
    }
  } else if (state === 'WAITING_DEPOSIT') {
    const numMatch = text.match(/\d+/);
    const amt = numMatch ? Number(numMatch.at(0)) : 0;
    if (amt > 0 && (amt < 50 || amt > 500)) {
      await sendTgMessage(chatId, '⚠️ በአንድ ጊዜ ማስገባት የሚቻለው *ዝቅተኛ 50 ብር* እና *ከፍተኛ 500 ብር* ብቻ ነው! እባክዎ ትክክለኛ መጠን ይላኩ።');
      return res.sendStatus(200);
    }

    pendingDeposits.add(uidStr);
    const info = text || 'የደረሰኝ ፎቶ ተልኳል';
    await sendTgMessage(
      ADMIN_ID,
      `🔔 *አዲስ የገንዘብ ማስገባት ጥያቄ (50-500 ብር)!*\n👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n📝 መልእክት: ${info}\n\nሒሳቡን ለመሙላት ይህን ይላኩ፡\n\`/add ${chatId} ${amt >= 50 && amt <= 500 ? amt : 50}\``
    );
    userStates.delete(uidStr);
    await sendTgMessage(
      chatId,
      '✅ መረጃዎ ለአድሚን ተልኳል። ገንዘቡ ወደ ዋሌትዎ እስኪገባ ድረስ ትንሽ ይጠብቁ!',
      mainKeyboard
    );
  } else if (state === 'WAITING_WITHDRAW') {
    let amt = 0;
    if (text.startsWith('ሙሉውን')) {
      amt = w.balance;
    } else {
      const cleaned = text.replace(/ብር/g, '').trim();
      if (!/^\d+$/.test(cleaned)) {
        await sendTgMessage(chatId, `⚠️ እባክዎ የሚያወጡትን የብር መጠን በቁጥር ብቻ ይጻፉ (ከ *50* እስከ *${w.balance}* ብር)።`);
        return res.sendStatus(200);
      }
      amt = Number(cleaned);
    }

    if (!Number.isFinite(amt) || amt < 50) {
      await sendTgMessage(chatId, '⚠️ ዝቅተኛው ማውጣት የሚቻለው መጠን *50 ብር* ነው! እባክዎ ከ50 ብር ጀምሮ ያስገቡ።');
      return res.sendStatus(200);
    }
    if (amt > w.balance) {
      await sendTgMessage(
        chatId,
        `🚫 *አይፈቀድም!* ዋሌትዎ ላይ ካለው ገንዘብ በላይ ማውጣት አይችሉም።\n💰 ዋሌትዎ ላይ ያለው ቀሪ ሒሳብ: *${w.balance} ብር* ብቻ ነው።`
      );
      return res.sendStatus(200);
    }

    pendingWithdrawAmount.set(uidStr, amt);
    userStates.set(uidStr, 'WAITING_WITHDRAW_PHONE');
    await sendTgMessage(
      chatId,
      `📱 *${amt} ብር* የሚላክበትን **የቴሌብር ስልክ ቁጥርዎን** ይጻፉ (ለምሳሌ፦ \`0911223344\`)፦`,
      cancelKeyboard
    );
  } else if (state === 'WAITING_WITHDRAW_PHONE') {
    const phone = text.replace(/\s+/g, '');
    if (!/^(09|07)\d{8}$/.test(phone)) {
      await sendTgMessage(chatId, '⚠️ እባክዎ ትክክለኛ ባለ 10 አሃዝ የኢትዮጵያ ስልክ ቁጥር ይጻፉ (በ `09` ወይም `07` የሚጀምር)።');
      return res.sendStatus(200);
    }

    const amt = Number(pendingWithdrawAmount.get(uidStr) || 0);
    if (amt < 50 || amt > w.balance) {
      userStates.delete(uidStr);
      pendingWithdrawAmount.delete(uidStr);
      await sendTgMessage(chatId, '⚠️ የዋሌት ሒሳብዎ ስለተቀየረ እባክዎ እንደገና ይሞክሩ።', mainKeyboard);
      return res.sendStatus(200);
    }

    w.balance -= amt;
    await w.save();
    pendingWithdrawAmount.delete(uidStr);
    userStates.delete(uidStr);

    await sendTgMessage(
      ADMIN_ID,
      `💸 *የገንዘብ ማውጣት ጥያቄ (Withdrawal)!*\n` +
      `👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n` +
      `💵 የሚላክ መጠን: *${amt} ብር*\n` +
      `📱 የቴሌብር ስልክ: \`${phone}\`\n` +
      `💰 የቀረው ዋሌት ሒሳብ: *${w.balance} ብር*`
    );
    await sendTgMessage(
      chatId,
      `✅ *${amt} ብር* ወደ ቴሌብር ቁጥር \`${phone}\` እንዲላክ ጥያቄዎ ተልኳል።\n💰 አዲስ የዋሌት ቀሪ ሒሳብዎ: *${w.balance} ብር*`,
      mainKeyboard
    );
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
