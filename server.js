const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ADMIN_ID = 8334791462;
const TELEBIRR_NUMBER = '0984960995';
const APP_URL = 'https://' + 'bingobot-0vk4' + '.onrender.com';

const wallets = new Map();
const userStates = new Map();
const lockedCartelas = new Map();
const pendingDeposits = new Set();

function getWallet(id) {
  const k = String(id);
  if (!wallets.has(k)) wallets.set(k, { userId: k, balance: 0 });
  return wallets.get(k);
}

async function sendTgMessage(chatId, text, replyMarkup = undefined) {
  const tgUrl = 'https://' + 'api.telegram.org' + '/bot' + process.env.BOT_TOKEN + '/sendMessage';
  await fetch(tgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    })
  }).catch(err => console.error('TG Error:', err));
}

const mainKeyboard = {
  keyboard: Array.of(
    Array.of({ text: '🎮 ጨዋታ ጀምር (Play Bingo)' }),
    Array.of({ text: '💰 ቀሪ ሒሳብ' }, { text: '💳 ገንዘብ አስገባ' }),
    Array.of({ text: '💸 ገንዘብ አውጣ' })
  ),
  resize_keyboard: true
};

const cancelKeyboard = {
  keyboard: Array.of(Array.of({ text: '❌ ሰርዝ (Cancel)' })),
  resize_keyboard: true
};

// --- የካርቴላ መቆለፊያ API ---
app.get('/api/cartelas/taken', (req, res) => {
  const taken = Array.from(lockedCartelas.keys());
  const uniquePlayers = new Set(lockedCartelas.values()).size;
  res.json({ taken: taken, playersCount: uniquePlayers });
});

app.post('/api/cartelas/lock', (req, res) => {
  const cid = Number(req.body.cartelaId);
  const uid = String(req.body.userId || '');
  if (!cid || !uid) return res.status(400).json({ error: 'Invalid' });
  if (lockedCartelas.has(cid) && lockedCartelas.get(cid) !== uid) {
    return res.status(409).json({ error: 'Already taken' });
  }
  lockedCartelas.set(cid, uid);
  res.json({ locked: true });
});

app.post('/api/cartelas/release', (req, res) => {
  const cid = Number(req.body.cartelaId);
  const uid = String(req.body.userId || '');
  if (lockedCartelas.get(cid) === uid) {
    lockedCartelas.delete(cid);
  }
  res.json({ released: true });
});

app.post('/api/cartelas/reset', (req, res) => {
  lockedCartelas.clear();
  res.json({ reset: true });
});

// --- የዋሌት API ---
app.get('/api/wallet/:userId', (req, res) => res.json(getWallet(req.params.userId)));

app.post('/api/wallet/deposit', (req, res) => {
  const amt = Number(req.body.amount);
  if (!req.body.userId || !Number.isFinite(amt)) return res.status(400).json({ error: 'Invalid input' });
  const w = getWallet(req.body.userId);
  w.balance = Math.max(0, w.balance + amt);
  res.json(w);
});

// --- የቴሌግራም ቦት Webhook ---
app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const uidStr = String(chatId);
  const userName = msg.from?.first_name || 'ተጫዋች';
  const text = (msg.text || '').trim();
  const w = getWallet(chatId);
  const state = userStates.get(uidStr);

  // 1. ሂደት መሰረዣ
  if (text === '❌ ሰርዝ (Cancel)') {
    userStates.delete(uidStr);
    await sendTgMessage(chatId, '✅ ሂደቱ ተሰርዟል። ወደ ዋናው ሜኑ ተመልሰዋል።', mainKeyboard);
    return res.sendStatus(200);
  }

  // 2. አድሚን ሒሳብ ሲሞላ (/add USER_ID AMOUNT)
  if (text.startsWith('/add ') && chatId === ADMIN_ID) {
    const parts = text.split(' ');
    const targetId = String(parts.at(1) || '');
    const amt = Number(parts.at(2));
    if (targetId && Number.isFinite(amt) && amt >= 50 && amt <= 500) {
      const targetWallet = getWallet(targetId);
      targetWallet.balance += amt;
      pendingDeposits.delete(targetId);
      await sendTgMessage(ADMIN_ID, `✅ ለተጫዋች \`${targetId}\` *${amt} ብር* ተጨምሯል። አዲስ ሒሳብ: *${targetWallet.balance} ብር*`);
      await sendTgMessage(targetId, `🎉 *${amt} ብር* ወደ ዋሌትዎ ገብቷል!\n💰 አሁን ያለዎት ቀሪ ሒሳብ: *${targetWallet.balance} ብር*`, mainKeyboard);
    } else {
      await sendTgMessage(ADMIN_ID, '⚠️ አጠቃቀም: `/add USER_ID 100` (መጠኑ ከ50 እስከ 500 ብር መሆን አለበት)');
    }
    return res.sendStatus(200);
  }

  // 3. ጨዋታ መጀመሪያ
  if (text === '/start' || text === '/play' || text === '🎮 ጨዋታ ጀምር (Play Bingo)') {
    userStates.delete(uidStr);
    const playMarkup = {
      inline_keyboard: Array.of(
        Array.of({ text: '🎮 ቢንጎ ይጫወቱ (Play Bingo)', web_app: { url: APP_URL + '?uid=' + chatId } })
      )
    };
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

  // 4. ገንዘብ ማስገቢያ (ወደ ዋሌት ሳይገባ ድጋሚ እንዳያስገቡ ይከለክላል)
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
      keyboard: Array.of(
        Array.of({ text: '50 ብር' }, { text: '100 ብር' }),
        Array.of({ text: '200 ብር' }, { text: '500 ብር' }),
        Array.of({ text: '❌ ሰርዝ (Cancel)' })
      ),
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

  // 5. ገንዘብ ማውጫ (ከ50 ብር ጀምሮ እስከ ዋሌቱ ሙሉ ገንዘብ ድረስ ብቻ)
  } else if (text === '/withdrawal' || text === '💸 ገንዘብ አውጣ') {
    if (w.balance < 50) {
      await sendTgMessage(chatId, `⚠️ ገንዘብ ለማውጣት ዋሌትዎ ላይ ቢያንስ *50 ብር* ሊኖርዎት ይገባል።\n💰 የአሁን ቀሪ ሒሳብዎ: *${w.balance} ብር*`, mainKeyboard);
    } else {
      userStates.set(uidStr, 'WAITING_WITHDRAW');
      const withdrawMarkup = {
        keyboard: Array.of(
          Array.of({ text: '50 ብር' }, { text: `ሙሉውን (${w.balance} ብር)` }),
          Array.of({ text: '❌ ሰርዝ (Cancel)' })
        ),
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

  // 6. የገቢ መረጃ መቀበያ
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

  // 7. ገንዘብ ማውጣት ማረጋገጫ
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

    w.balance -= amt;

    await sendTgMessage(
      ADMIN_ID,
      `💸 *የገንዘብ ማውጣት ጥያቄ (Withdrawal)!*\n👤 ተጫዋች: ${userName} (ID: \`${chatId}\`)\n💵 የሚላክ መጠን: *${amt} ብር*\n💰 የቀረው ዋሌት ሒሳብ: *${w.balance} ብር*`
    );
    userStates.delete(uidStr);
    await sendTgMessage(
      chatId,
      `✅ *${amt} ብር* ወጪ እንዲደረግ ጥያቄዎ ተልኳል።\n💰 አዲስ የዋሌት ቀሪ ሒሳብዎ: *${w.balance} ብር*`,
      mainKeyboard
    );
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log('Running'));


  


     
       
    

      

  
  





