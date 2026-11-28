const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ADMIN_ID = 8334791462;
const TELEBIRR_NUMBER = '0984960995';
const APP_URL = 'https://' + 'bingobot-0vk4' + '.onrender.com';
const BOT_USERNAME = 'Edilbingosplaybot';

const REFERRAL_BONUS = 10;
const MIN_DEPOSIT_FOR_BONUS = 50;
const REQUIRED_CHANNEL = '@EdilBingosOfficial';




mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

const walletSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  balance: { type: Number, default: 30 },
  referredBy: { type: String, default: '' },
  referralRewarded: { type: Boolean, default: false }
});
const Wallet = mongoose.model('Wallet', walletSchema);

const userStates = new Map();
const pendingDeposits = new Set();
const pendingWithdrawAmount = new Map();

async function getWallet(id) {
  const k = String(id);
  return await Wallet.findOneAndUpdate(
    { userId: k },
    { $setOnInsert: { userId: k, balance: 30 } },
    { new: true, upsert: true }
  );
}


async function sendTgMessage(chatId, text, replyMarkup = undefined) {
    const tgUrl = 'https://' + 'api.telegram.org' + '/bot' + process.env.BOT_TOKEN + '/sendMessage';

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
  timer: 50,
  stake: 10,
  pot: 0,
  calledNumbers: [],
  pool: [],
  lockedCartelas: new Map(),
  winner: null,
  winners: [],
};

function resetRoomToLobby() {
  room.phase = 'LOBBY';
  room.timer = 60;
  room.pot = 0;
  room.calledNumbers = [];
  room.pool = [];
  room.lockedCartelas.clear();
  room.winner = null;
  room.winners = [];
}

const BOT_NAMES = [
  '@Dawit_B', '@Selam_K', '@Bereket99', '@Tigist_M', '@Yonas_A',
  '@Meron_G', '@Henok_T', '@Bethlehem_S', '@Natnael_D', '@Hanna_W',
  '@Abel_F', '@Rahel_Z', '@Robel_H', '@Mahlet_N', '@Eyob_L',
  '@Kidist_R', '@Biniam_Y', '@Tsion_E', '@Samuel_P', '@Frehiwot_C',
  '@Miki_V', '@Sosina_J', '@Nahom_Q', '@Eden_U', '@Kaleb_X'
];

function getBotCartelaGrid(cartelaId) {
  let seed = cartelaId * 9973;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const cols = Array.of(Array.of(1, 15), Array.of(16, 30), Array.of(31, 45), Array.of(46, 60), Array.of(61, 75));
  const grid = Array(25).fill(0);
  for (let c = 0; c < 5; c++) {
    const nums = [];
    for (let n = cols.at(c).at(0); n <= cols.at(c).at(1); n++) nums.push(n);
    nums.sort(() => rnd() - 0.5);
    for (let r = 0; r < 5; r++) grid[r * 5 + c] = nums.at(r);
  }
  grid[12] = 0;
  return grid;
}

function checkBotWin(grid, calledSet) {
  const lines = Array.of(
    Array.of(0, 1, 2, 3, 4), Array.of(5, 6, 7, 8, 9), Array.of(10, 11, 12, 13, 14), Array.of(15, 16, 17, 18, 19), Array.of(20, 21, 22, 23, 24),
    Array.of(0, 5, 10, 15, 20), Array.of(1, 6, 11, 16, 21), Array.of(2, 7, 12, 17, 22), Array.of(3, 8, 13, 18, 23), Array.of(4, 9, 14, 19, 24),
    Array.of(0, 6, 12, 18, 24), Array.of(4, 8, 12, 16, 20)
  );
  for (const line of lines) {
    if (line.every(idx => idx === 12 || calledSet.has(grid.at(idx)))) return line;
  }
  return null;
}

async function startCentralGame() {
  if (room.lockedCartelas.size === 0) {
    room.timer = 25;
    return;
  }

  let validPot = 0;
  const userCounts = new Map();
  for (const [cid, info] of room.lockedCartelas.entries()) {
    if (String(info.userId).startsWith('bot_')) continue;
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

  const realCount = Array.from(room.lockedCartelas.values()).filter(v => !String(v.userId).startsWith('bot_')).length;
  if (realCount === 0) {
    resetRoomToLobby();
    return;
  }

  const shuffledNames = [...BOT_NAMES].sort(() => Math.random() - 0.5);
        let nameIdx = 0;
        let botsAdded = 0;
        while (botsAdded < 20 && room.lockedCartelas.size < 500) {
          const randomCid = Math.floor(Math.random() * 500) + 1;
          if (!room.lockedCartelas.has(randomCid)) {
            const botName = shuffledNames.at(nameIdx % shuffledNames.length);
            room.lockedCartelas.set(randomCid, {
              userId: 'bot_' + randomCid,
              userName: botName,
              isBot: true
            });
            nameIdx++;
            botsAdded++;
          }
        }

  

  const botCount = Array.from(room.lockedCartelas.values()).filter(v => String(v.userId).startsWith('bot_')).length;
  validPot += botCount * room.stake;

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
    const realPlayers = Array.from(room.lockedCartelas.values()).filter(v => !String(v.userId).startsWith('bot_')).length;
    if (realPlayers > 0) {
      room.timer--;
      if (room.lockedCartelas.size < 25 && Math.random() < 0.75) {
        const cid = Math.floor(Math.random() * 100) + 1;
        if (!room.lockedCartelas.has(cid)) {
          const bName = BOT_NAMES.at(Math.floor(Math.random() * BOT_NAMES.length));
          room.lockedCartelas.set(cid, { userId: 'bot_' + cid, userName: bName, isBot: true });
        }
      }
      if (room.timer <= 0) await startCentralGame();
    } else {
      if (room.lockedCartelas.size > 0) room.lockedCartelas.clear();
      room.timer = 25;
    }
  } else if (room.phase === 'PLAYING') {
    if (tickCount % 3 === 0) {
      if (room.pool.length > 0 && !room.winner) {
        room.calledNumbers.push(room.pool.pop());
        const calledSet = new Set(room.calledNumbers);
        for (const [cid, info] of room.lockedCartelas.entries()) {
            if (String(info.userId).startsWith('bot_') && room.calledNumbers.length >= 42 && Math.random() < 0.08) {
 
            const grid = getBotCartelaGrid(cid);
            const winIndices = checkBotWin(grid, calledSet);
            if (winIndices) {
              room.winner = {
                userId: info.userId,
                userName: info.userName,
                cartelaId: cid,
                prize: room.pot,
                grid,
                winIndices
              };
              room.winners.push(room.winner);
              room.phase = 'FINISHED';
              room.timer = 7;
              break;
            }
          }
        }
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
  if (s === 10 || s === 10) room.stake = s;
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
    const calledSet = new Set(room.calledNumbers);


  const validWin = Array.isArray(winIndices) && winIndices.length >= 4 && winIndices.every(idx => {
const num = Array.isArray(cardCols) ? cardCols.at(idx % 5)?.at(Math.floor(idx / 5)) : null;
    if (idx === 12) return true;
    return typeof num === 'number' && calledSet.has(num);

  });
  if (!validWin) {
    return res.json({ accepted: false, error: 'ያልተጠሩ ቁጥሮችን ነክተዋል! ገና አልዘጉም።' });
  }


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
      room.winner = room.winners.at(0);
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
        [{ text: '💸 ገንዘብ አውጣ' }, { text: '🤝 ሰው ጋብዝ (Invite)' }]

  ],
  resize_keyboard: true
};

const cancelKeyboard = {
  keyboard: [[{ text: '❌ ሰርዝ (Cancel)' }]],
  resize_keyboard: true
};

app.post('/webhook', async (req, res) => {
  if (req.body.callback_query) {
    const cb = req.body.callback_query;
    const cbChatId = cb.message?.chat?.id;
    const cbMsgId = cb.message?.message_id;
    const data = cb.data || '';
        const tgApi = 'https://' + 'api.telegram.org/bot' + process.env.BOT_TOKEN;


    if (cbChatId === ADMIN_ID) {
      const parts = data.split('_');
      const action = parts.at(0);
      const type = parts.at(1);
      const targetId = parts.at(2);
      const amt = Number(parts.at(3) || 0);

      if (action === 'app' && type === 'dep' && targetId && amt > 0) {
        const targetWallet = await getWallet(targetId);
        targetWallet.balance += amt;
        let bonusNote = '';
        if (amt >= MIN_DEPOSIT_FOR_BONUS && targetWallet.referredBy && !targetWallet.referralRewarded) {
          targetWallet.referralRewarded = true;
          const inviterWallet = await Wallet.findOneAndUpdate(
            { userId: targetWallet.referredBy },
            { $inc: { balance: REFERRAL_BONUS } },
            { new: true }
          );
          if (inviterWallet) {
            bonusNote = `\n🎁 ለጋባዡ (${targetWallet.referredBy}) የ *${REFERRAL_BONUS} ብር* ቦነስ ተሰጥቷል።`;
            await sendTgMessage(targetWallet.referredBy, `🎉 የጋበዙት ተጫዋች ${amt} ብር ስላስገባ የ *${REFERRAL_BONUS} ብር* ሪፈራል ቦነስ አግኝተዋል!\n💰 አዲስ ሒሳብ: *${inviterWallet.balance} ብር*`);
          }
        }
        await targetWallet.save();
        pendingDeposits.delete(targetId);
        await sendTgMessage(targetId, `🎉 *${amt} ብር* ወደ ዋሌትዎ ገብቷል!\n💰 አሁን ያለዎት ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
        await fetch(`${tgApi}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, text: `✅ ጸድቋል! ለተጫዋች ${targetId} ${amt} ብር ተጨምሯል።${bonusNote}` })
        });
      } else if (action === 'rej' && type === 'dep' && targetId) {
        pendingDeposits.delete(targetId);
        await sendTgMessage(targetId, `❌ የላኩት የገንዘብ ማስገቢያ ጥያቄ ውድቅ ተደርጓል። እባክዎ ትክክለኛውን የክፍያ መልዕክት ይላኩ።`, mainKeyboard);
        await fetch(`${tgApi}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, text: `❌ የ ${targetId} የገንዘብ ማስገቢያ ጥያቄ ውድቅ ተደርጓል።` })
        });
      } else if (action === 'app' && type === 'wd' && targetId && amt > 0) {
        await sendTgMessage(targetId, `✅ የ *${amt} ብር* የገንዘብ ማውጫ ጥያቄዎ ተቀባይነት አግኝቶ በቴሌብር ተልኮልዎታል!`, mainKeyboard);
        await fetch(`${tgApi}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, text: `✅ ተከፍሏል! ለተጫዋች ${targetId} ${amt} ብር ተልኳል።` })
        });
      } else if (action === 'rej' && type === 'wd' && targetId && amt > 0) {
        const targetWallet = await getWallet(targetId);
        targetWallet.balance += amt;
        await targetWallet.save();
        await sendTgMessage(targetId, `❌ የ *${amt} ብር* የገንዘብ ማውጫ ጥያቄዎ ስላልጸደቀ ብሩ ወደ ዋሌትዎ ተመልሷል።\n💰 አዲስ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
        await fetch(`${tgApi}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, text: `❌ ተሰርዟል! ለተጫዋች ${targetId} ${amt} ብር ወደ ዋሌቱ ተመልሷል።` })
        });
      }
    }
    await fetch(`${tgApi}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cb.id })
    });
    return res.sendStatus(200);
  }

  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);


  const chatId = msg.chat.id;
  const uidStr = String(chatId);
  const userName = msg.from?.first_name || 'ተጫዋች';
  const text = (msg.text || '').trim();
  const w = await getWallet(chatId);
  const state = userStates.get(uidStr);
  if (REQUIRED_CHANNEL && chatId !== ADMIN_ID) {
    try {
      const tgApi = 'https://' + 'api.telegram.org/bot' + process.env.BOT_TOKEN;
      const memberRes = await fetch(`${tgApi}/getChatMember?chat_id=${encodeURIComponent(REQUIRED_CHANNEL)}&user_id=${chatId}`);
      const memberData = await memberRes.json();
      const status = memberData?.result?.status;
      if (!memberData.ok || !['member', 'administrator', 'creator'].includes(status)) {
        if (text.startsWith('/start ')) {
          const refId = text.split(' ').at(1)?.trim() || '';
          if (refId && refId !== uidStr && !w.referredBy && !w.referralRewarded) {
            w.referredBy = refId;
            await w.save();
          }
        }
        const chClean = REQUIRED_CHANNEL.replace('@', '');
        await fetch(`${tgApi}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `⚠️ *ቦቱን ለመጠቀም መጀመሪያ ቻናላችንን ይቀላቀሉ!*\n\nከታች ያለውን አዝራር ተጭነው ቻናሉን **Join** ካደረጉ በኋላ **/start** የሚለውን ይጫኑ።`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '📢 ቻናሉን ተቀላቀል (Join Channel)', url: 'https://' + 't.me/' + chClean }]]
            }
          })
        });
        return res.sendStatus(200);
      }
    } catch (e) {}
  }

  if (text === '❌ ሰርዝ (Cancel)') {
    userStates.delete(uidStr);
    pendingWithdrawAmount.delete(uidStr);
    await sendTgMessage(chatId, '✅ ሂደቱ ተሰርዟል። ወደ ዋናው ሜኑ ተመልሰዋል።', mainKeyboard);
    return res.sendStatus(200);
  }
  if (text === '/stats' && chatId === ADMIN_ID) {
    const allWallets = await Wallet.find({});
    const totalUsers = allWallets.length;
    const totalBalance = allWallets.reduce((sum, u) => sum + (u.balance || 0), 0);
    const activePlayers = Array.from(room.lockedCartelas.values()).filter(v => !String(v.userId).startsWith('bot_')).length;
    await sendTgMessage(
      chatId,
      `📊 *የቦቱ አጠቃላይ መረጃ (Stats)*\n\n` +
      `👥 ጠቅላላ ተጫዋቾች: *${totalUsers}*\n` +
      `💰 በዋሌት ያለ ጠቅላላ ብር: *${totalBalance} ብር*\n` +
      `🎮 አሁን በጨዋታ ላይ ያሉ: *${activePlayers} ተጫዋቾች*\n` +
      `🏆 የአሁኑ ዙር ደራሽ: *${room.pot} ብር*`
    );
    return res.sendStatus(200);
  }
    if (text === '/refstats' && chatId === ADMIN_ID) {
      const totalInvitedUsers = await Wallet.countDocuments({ referredBy: { $ne: '' } });
      const rewardedUsers = await Wallet.countDocuments({ referralRewarded: true });
      const totalBonusPaid = rewardedUsers * REFERRAL_BONUS;
      await sendTgMessage(
        chatId,
        `📊 *የሪፈራል አጠቃላይ ሪፖርት (Referral Stats)*\n\n` +
        `👥 በሪፈራል የገቡ ጠቅላላ ተጫዋቾች: *${totalInvitedUsers}*\n` +
        `✅ ቦነስ የተከፈለባቸው (50+ ብር ያስገቡ): *${rewardedUsers}*\n` +
        `💰 ጠቅላላ የተከፈለ የሪፈራል ቦነስ: *${totalBonusPaid} ብር*`
      );
      return res.sendStatus(200);
    }

  if (text === '/users' && chatId === ADMIN_ID) {
    const topUsers = await Wallet.find({}).sort({ balance: -1 }).limit(15);
    let listMsg = `📋 *ከፍተኛ ሂሳብ ያላቸው 15 ተጫዋቾች:*\n\n`;
    topUsers.forEach((u, i) => {
      listMsg += `${i + 1}. \`${u.userId}\` — *${u.balance} ብር*\n`;
    });
    await sendTgMessage(chatId, listMsg);
    return res.sendStatus(200);
  }

  if (text.startsWith('/broadcast ') && chatId === ADMIN_ID) {
    const broadcastMsg = text.slice(11).trim();
    if (!broadcastMsg) return res.sendStatus(200);
    const allWallets = await Wallet.find({});
    await sendTgMessage(chatId, `⏳ መልዕክቱ ለ *${allWallets.length}* ተጫዋቾች እየተላከ ነው...`);
    let sentCount = 0;
    for (const u of allWallets) {
      if (u.userId && !String(u.userId).startsWith('bot_')) {
        try {
          await sendTgMessage(u.userId, `📢 *ማስታወቂያ ከEdil Bingos:*\n\n${broadcastMsg}`);
          sentCount++;
        } catch (e) {}
      }
    }
    await sendTgMessage(chatId, `✅ ማስታወቂያው ለ *${sentCount}* ተጫዋቾች በተሳካ ሁኔታ ተልኳል!`);
    return res.sendStatus(200);
  }

  if (text.startsWith('/add ') && chatId === ADMIN_ID) {
    const parts = text.split(' ');
    const targetId = String(parts.at(1) || '');
    const amt = Number(parts.at(2));

    if (targetId && Number.isFinite(amt) && amt >= 50 && amt <= 500) {
          const targetWallet = await getWallet(targetId);
      targetWallet.balance += amt;

      let bonusNote = '';
      if (amt >= MIN_DEPOSIT_FOR_BONUS && targetWallet.referredBy && !targetWallet.referralRewarded) {
        targetWallet.referralRewarded = true;
        const inviterWallet = await Wallet.findOneAndUpdate(
          { userId: targetWallet.referredBy },
          { $inc: { balance: REFERRAL_BONUS } },
          { new: true }
        );
        if (inviterWallet) {
          bonusNote = `\n🎁 ለጋባዡ (${targetWallet.referredBy}) የ *${REFERRAL_BONUS} ብር* ቦነስ ተሰጥቷል።`;
          await sendTgMessage(
            targetWallet.referredBy,
            `🎉 የጋበዙት ተጫዋች ${amt} ብር ስላስገባ የ *${REFERRAL_BONUS} ብር* ሪፈራል ቦነስ አግኝተዋል!\n💰 አዲስ ሒሳብ: *${inviterWallet.balance} ብር*`
          );
        }
      }

      await targetWallet.save();
      pendingDeposits.delete(targetId);
      await sendTgMessage(ADMIN_ID, `✅ ለተጫዋች \`${targetId}\` *${amt} ብር* ተጨምሯል።\nአዲስ ሒሳብ: *${targetWallet.balance} ብር*${bonusNote}`);
      await sendTgMessage(targetId, `🎉 *${amt} ብር* ወደ ዋሌትዎ ገብቷል!\n💰 አሁን ያለዎት ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);

    } else {
      await sendTgMessage(ADMIN_ID, '⚠️ አጠቃቀም: `/add USER_ID 100` (መጠኑ ከ50 እስከ 500 ብር መሆን አለበት)');
    }
    return res.sendStatus(200);
  }
    if (text.startsWith('/deduct ') && chatId === ADMIN_ID) {
      const parts = text.split(' ').filter(Boolean);
      const targetId = parts.at(1);
      const amt = Number(parts.at(2));
      if (!targetId || isNaN(amt) || amt <= 0) {
        await sendTgMessage(chatId, '⚠️ ትክክለኛ አጻጻፍ፦ `/deduct [UserID] [Amount]`\nምሳሌ፦ `/deduct 8334791462 50`');
        return res.sendStatus(200);
      }
      const targetWallet = await getWallet(targetId);
      if (targetWallet.balance < amt) {
        await sendTgMessage(chatId, `⚠️ ተጫዋቹ በቂ ሒሳብ የለውም። አሁን ያለው ሒሳብ: *${targetWallet.balance} ብር*`);
        return res.sendStatus(200);
      }
      targetWallet.balance -= amt;
      await targetWallet.save();
      await sendTgMessage(chatId, `✅ ከተጫዋች \`${targetId}\` ላይ *${amt} ብር* ተቀንሷል።\n💰 አዲስ ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`);
      await sendTgMessage(targetId, `ℹ️ ከዋሌትዎ ላይ *${amt} ብር* ተቀንሷል።\n💰 አዲስ ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
      return res.sendStatus(200);
    }

      if (text.startsWith('/start') || text === '/play' || text === '🎮 ጨዋታ ጀምር (Play Bingo)') {

    userStates.delete(uidStr);
    pendingWithdrawAmount.delete(uidStr);
              if (text.startsWith('/start ')) {
        const refId = text.split(' ').at(1)?.trim() || '';
        if (refId && refId !== uidStr && !w.referredBy && !w.referralRewarded) {
          w.referredBy = refId;
          await w.save();
        }
      }

    const playMarkup = {
      inline_keyboard: [
        [{ text: '🎮 ቢንጎ ይጫወቱ (Play Bingo)', web_app: { url: APP_URL + '?uid=' + chatId } }]
      ]
    };
    await sendTgMessage(
      chatId,
      `🎲 እንኳን ወደ *Edil Bingos* በደህና መጡ፣ ${userName}!\n\n💰 ቀሪ ሒሳብዎ: *${w.balance} ብር*\n🎯 መደብ: *10 ብር*\n\nጨዋታውን ለመጀመር ከታች ያለውን ቁልፍ ይንኩ፦`,
      playMarkup);
            if (text.startsWith('/start')) {

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
      `ገንዘቡን ካስገቡ በኋላ *የላኩትን የብር መጠን (ከ50-500 ብር) እና Transaction ID* እዚህ ይላኩ፦`+
              `\n\n⚠️ የሚያጋጥምዎት የክፍያ ችግር ካለ በዚህ @EdilBingosSupport የእርዳታ አገልግሎት አካውንት በኩል ማውራት ይችላሉ!`,

      depositMarkup
    );
        } else if (text.includes('ሰው ጋብዝ') || text === '/invite') {
      userStates.delete(uidStr);
      const totalInvited = await Wallet.countDocuments({ referredBy: uidStr });
      const rewardedInvited = await Wallet.countDocuments({ referredBy: uidStr, referralRewarded: true });
      const totalEarned = rewardedInvited * REFERRAL_BONUS;
      const safeBotUser = 
             const inviteLink = `https://t.me{BOT_USERNAME}?start=/${uidStr}`;
        const shareText = encodeURIComponent('ኑ አብረን Edil Bingo እንጫወትና ቦነስ እናግኝ!');
        const shareUrl = `https://t.me{encodeURIComponent(inviteLink)}&text=${shareText}`;

        await sendTgMessage(
          chatId,
          `🤝 *ጓደኞችዎን ይጋብዙና ቦነስ ያግኙ!*\n\n` +
          `የጋበዙት ሰው ተመዝግቦ ቢያንስ *${MIN_DEPOSIT_FOR_BONUS} ብር* ሲያስገባ የ *${REFERRAL_BONUS} ብር* ቦነስ ወዲያውኑ ወደ ሒሳብዎ ይገባል!\n\n` +
          `📊 *የእርስዎ የሪፈራል ሪፖርት:-*\n` +
          `👥 የተጋበዙ ሰዎች: *${totalInvited}*\n` +
          `✅ ቦነስ ያስገኙ: *${rewardedInvited}*\n` +
          `💰 ጠቅላላ ያገኙት ቦነስ: *${totalEarned} ብር*\n\n` +
          `🔗 የእርስዎ መጋበዣ ሊንክ:\n\`${inviteLink}\``,
          {
            inline_keyboard: [
              [{ text: '📤 ለጓደኞች ላክ (Share)', url: shareUrl }]
            ]
          }
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
            const numMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ብር|ETB|Birr)/i) || text.match(/\b\d+\.\d{2}\b/) || text.match(/\b\d{2,3}\b/);
        const amt = numMatch ? Math.floor(Number(numMatch[1] || numMatch[0])) : 0;

    if (amt > 0 && (amt < 50 || amt > 500)) {
      await sendTgMessage(chatId, '⚠️ በአንድ ጊዜ ማስገባት የሚቻለው *ዝቅተኛ 50 ብር* እና *ከፍተኛ 500 ብር* ብቻ ነው! እባክዎ ትክክለኛ መጠን ይላኩ።');
      return res.sendStatus(200);
    }

          pendingDeposits.add(uidStr);
      const info = text || 'የደረሰኝ ፎቶ ተልኳል';
      const validAmt = (amt >= 50 && amt <= 500) ? amt : 50;
      const depButtons = {
        inline_keyboard: [[
          { text: `✅ አጽድቅ (${validAmt} ብር)`, callback_data: `app_dep_${chatId}_${validAmt}` },
          { text: '❌ ሰርዝ (Reject)', callback_data: `rej_dep_${chatId}_0` }
        ]]
      };
        if (msg.photo) {
          const fileId = msg.photo.at(-1).file_id;
await fetch('https:api//telegram.org' + BOT_TOKEN + '/sendPhoto', {

            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_ID, photo: fileId, caption: '🧾 ደረሰኝ ከ ' + userName + ' (ID: ' + chatId + ')' })
          }).catch(() => {});
        }
await sendTgMessage(
        ADMIN_ID,
        `🔔 *አዲስ የገንዘብ ማስገባት ጥያቄ (50-500 ብር)!*\n👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n📝 መልእክት: ${info}\n\nበአንድ ንኪኪ ለማጽደቅ ከታች ያለውን ይጫኑ (ወይም \`/add ${chatId} ${validAmt}\`)፦`,
        depButtons
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

          const wdButtons = {
        inline_keyboard: [[
          { text: `✅ ተከፍሏል (${amt} ብር)`, callback_data: `app_wd_${chatId}_${amt}` },
          { text: '❌ ሰርዝ (ብሩን መልስ)', callback_data: `rej_wd_${chatId}_${amt}` }
        ]]
      };
      await sendTgMessage(
        ADMIN_ID,
        `💸 *የገንዘብ ማውጣት ጥያቄ (Withdrawal)!*\n` +
        `👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n` +
        `💵 የሚላክ መጠን: *${amt} ብር*\n` +
        `📱 የቴሌብር ስልክ: \`${phone}\`\n` +
        `💰 የቀረው ዋሌት ሒሳብ: *${w.balance} ብር*`,
        wdButtons
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

