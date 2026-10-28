export const DAY = 864e5;
export const GAME_DAILY_CAP = 60;

export const WELCOME = 20;
export const REF_BONUS = 30;   // promo code දාපු අලුත් user ට
export const REF_REWARD = 60;  // promo code owner ට

export const CATALOG = [
  { id: "cartoon", name: "Sinhala Cartoon", price: 200, desc: "Search any cartoon, pick episode & quality, file sent to WhatsApp.", cmd: ".cartoon <name>", ver: "1.0" },
  { id: "song", name: "Song Downloader", price: 100, desc: "Download any song as audio.", cmd: ".song <name>", ver: "1.2" },
  { id: "ai", name: "AI Chat", price: 150, desc: "ChatGPT-like assistant inside WhatsApp.", cmd: ".ai <question>", ver: "2.0" },
  { id: "tiktok", name: "TikTok Downloader", price: 80, desc: "No-watermark TikTok videos.", cmd: ".tiktok <url>", ver: "1.1" },
  { id: "antilink", name: "Anti-Link", price: 60, desc: "Auto remove links in groups.", cmd: ".antilink on/off", ver: "1.0" },
  { id: "sticker", name: "Sticker Maker", price: 50, desc: "Image/video to sticker.", cmd: ".sticker", ver: "1.0" },
  { id: "boost", name: "⚡ Daily Booster", price: 150, desc: "2× daily reward for 7 days.", cmd: "Auto-applied", ver: "perk" },
  { id: "vip", name: "⭐ VIP Badge", price: 300, desc: "VIP badge on your profile + priority support.", cmd: "Profile badge", ver: "perk" },
  { id: "wimg", name: "🖼 Custom Welcome Image", price: 100, desc: "Use your own image in the bot connect message.", cmd: "Bot Settings", ver: "perk" }
];

export const TASKS = [
  { id: "tg", name: "Join Telegram Channel", reward: 20, type: "once", link: process.env.TELEGRAM_URL || "https://t.me/HIRUSHAN_5" },
  { id: "wa", name: "Join WhatsApp Channel", reward: 20, type: "once", link: process.env.WA_CHANNEL_URL || "https://whatsapp.com/channel/0029Va..." },
  { id: "cmd", name: "Start your bot today", reward: 5, type: "daily" }
];

export const DEFAULT_SETTINGS = { prefix: ".", mode: "public", name: "SHAN MINI BOT", seen: false, typing: false, img: "" };
