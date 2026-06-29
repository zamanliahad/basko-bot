require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ── Config ────────────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID; // optional security

if (!TELEGRAM_TOKEN || !GEMINI_API_KEY) {
  console.error("ERROR: TELEGRAM_TOKEN və GEMINI_API_KEY environment variable-ları lazımdır.");
  process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the optimal posting time recommendation based on current day.
 */
function getPostingTime() {
  const day = new Date().toLocaleDateString("az-AZ", {
    weekday: "long",
    timeZone: "Asia/Baku",
  });

  const times = {
    "bazar ertəsi": "18:00 – 20:00",
    "çərşənbə axşamı": "18:00 – 21:00",
    "çərşənbə": "17:00 – 20:00",
    "cümə axşamı": "18:00 – 21:00",
    "cümə": "17:00 – 22:00",
    "şənbə": "10:00 – 12:00 və ya 19:00 – 21:00",
    "bazar": "11:00 – 13:00",
  };

  const lowerDay = day.toLowerCase();
  const time = times[lowerDay] ?? "18:00 – 21:00";
  return { day, time };
}

/**
 * Builds the Gemini prompt for BASKO content ideas.
 */
function buildPrompt() {
  const { day, time } = getPostingTime();
  return `
Sən BASKO (@basko_az) brendinin sosial media kontent mütəxəssisisisin.
BASKO — Azərbaycanda 16-30 yaş arası gənclərə yönəlmiş streetwear və anime/pop-culture çap tişört brendidir.

Bu gün: ${day}
Optimal paylaşma vaxtı (Bakı vaxtı): ${time}

Aşağıdakı 3 kontent ideyasını Azərbaycan dilində yaz. Hər biri üçün:
- 📌 Kontent tipi
- 💡 İdeya (qısa, aydın)
- 🎬 Video/Şəkil konsepti (vizual necə görünəcək)
- ✍️ Caption (cəlbedici, gənclərə uyğun, Azərbaycan dilində)
- #️⃣ Hashtaglar (10-15 ədəd, Azərbaycan + ingilis qarışıq)
- ⏰ Bu gün üçün ən yaxşı paylaşma vaxtı: ${time}

---

1️⃣ HOOK VİDEO (İlk 3 saniyədə izləyicini saxlayan video)
Hook video Reels/TikTok formatında olmalıdır. Güclü açılış cümləsi, sürpriz element və ya maraqlı sual olmalıdır.

2️⃣ SÜRÜŞDÜRMƏLİ ŞƏKİLLƏR (Carousel post — minimum 5 slayd)
Hər slaydda nə olacağını ayrı-ayrı izah et.

3️⃣ PROSES GEDİŞATI VİDEOSU (Behind the scenes / tişört çap prosesi)
Studiyadan, çapdan, dizayndan — real, autentik kontent.

---

Format qaydaları:
- Emoji istifadə et
- Gənc, enerjili, streetwear tone-of-voice
- Hər kontent tam hazır olsun — kopyala-yapışdır formatında
- Caption maksimum 150 söz olsun
`.trim();
}

// ── Bot Handlers ──────────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name ?? "Ahad";
  bot.sendMessage(
    msg.chat.id,
    `Salam ${name}! 👋\n\nMən BASKO Content Bot-am.\n\n/generate — Bu günün 3 kontent ideyasını al\n/help — Kömək`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📋 *Komandalar:*\n\n/generate — Bu günün 3 kontent ideyasını al\n/start — Botu yenidən başlat`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/generate/, async (msg) => {
  const chatId = msg.chat.id;

  // Optional: restrict to owner only
  if (ALLOWED_CHAT_ID && String(chatId) !== String(ALLOWED_CHAT_ID)) {
    return bot.sendMessage(chatId, "Bu bot şəxsi istifadə üçündür.");
  }

  const loadingMsg = await bot.sendMessage(chatId, "⏳ Kontent ideyaları hazırlanır...");

  try {
    const prompt = buildPrompt();
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Delete loading message
    await bot.deleteMessage(chatId, loadingMsg.message_id);

    // Telegram max message length is 4096 chars — split if needed
    if (text.length <= 4096) {
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } else {
      const chunks = text.match(/[\s\S]{1,4000}/g) ?? [];
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
      }
    }
  } catch (err) {
    console.error("Gemini error:", err);
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    await bot.sendMessage(
      chatId,
      "❌ Xəta baş verdi. Bir az sonra yenidən /generate yaz."
    );
  }
});

// ── Unknown commands ──────────────────────────────────────────────────────────
bot.on("message", (msg) => {
  if (msg.text && !msg.text.startsWith("/")) {
    bot.sendMessage(msg.chat.id, "/generate yazaraq kontent ideyası al.");
  }
});

// ── Error handling ────────────────────────────────────────────────────────────
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

console.log("BASKO Content Bot işə düşdü...");
