# SHAN MINI BOT — Vercel site (landing + pair + OTP login dashboard)

## Folder එක
```
public/            index.html, dashboard.html, sender.html + css/ + js/   (static)
api/pair.js        user ගේ bot pair code (කලින් එකම)
api/status.js      pair status poll
api/sender-pair.js OTP යවන bot number එක link කරන්න (admin)
api/[...path].js   login(OTP) + coins + shop + games + admin API
api/_lib/          db, auth, otp, wa-sender, pairing
```

## Deploy (Vercel)
1. මේ folder එක GitHub repo එකකට දාන්න -> vercel.com -> Add New Project -> import (Framework: **Other**).
2. Environment Variables:
   - `MONGODB_URI`  – Panel bot එකේ URI එකම
   - `AUTH_SECRET`  – random දිග string එකක් (32+ chars). Login tokens sign කරන්න
   - `ADMIN_PASSWORD` – admin panel + `/sender` page එකට
   - (optional) `WA_CHANNEL_URL`, `TELEGRAM_URL`
3. Deploy. Settings -> Functions -> **Fluid Compute** ON ද බලන්න (pair.js 300s).
4. MongoDB Atlas -> Network Access -> `0.0.0.0/0`.

## OTP එක යන්නේ කොහොමද (වැදගත්)
Login / plugin buy / coin send වලදී OTP එක **bot number එකකින්** user ගේ WhatsApp එකට යනවා.
ඒ bot number එක **එක පාරක් link කරන්න ඕන**:
1. `https://<your-domain>/sender` open කරන්න
2. Admin password + bot number දීලා **Get pair code**
3. ඒ phone එකේ WhatsApp -> Linked devices -> Link with phone number -> code එක ගහන්න
4. "OTP sender is ready" ආවම හරි. (Dashboard එකේ admin panel එකෙන් status බලන්න පුළුවන්)

⚠️ OTP sender number එක Panel bot එකක් run වෙන number එකක් **නොවිය යුතුයි**. එකම session එක දෙතැනක open වුණාම එකක් disconnect වෙනවා. වෙනම number එකක් (SIM එකක්) පාවිච්චි කරන්න.
⚠️ අලුත් number එකකින් ගොඩක් අයට message යවනවා නම් WhatsApp ban කරන්න පුළුවන්. Number එක මුලින් දවස් කීපයක් සාමාන්‍ය විදිහට පාවිච්චි කරලා warm-up කරන්න.

## Bot Key + OTP login
1. User site එකේ **Link your bot** එකෙන් pair කරනවා.
2. Pair වුණාම bot එකෙන් user ගේ WhatsApp එකට **Bot Key** (SHAN-XXXX-XXXX) යනවා.
3. Dashboard login: number + Bot Key දීලා **Send OTP** -> OTP WhatsApp එකට යනවා -> OTP ගහලා login.
4. Key අමතක නම් login page එකේ "Send me a new key" (පරණ key එක අවලංගු වෙනවා, අලුත් එක WhatsApp එකට යනවා).
Key සහ OTP දෙකම යන්නේ `/sender` එකෙන් link කරපු sender number එකෙන්. ඒ නිසා ඒක මුලින්ම link කරන්න.

## Admin
Dashboard -> **Me** tab -> "Comments" heading එක 5 පාරක් tap කරන්න -> Admin password.
(කලින් HTML එකේ hardcode කරලා තිබුණු `1234` password එක අයින් කළා. දැන් password එක server එකේ `ADMIN_PASSWORD` එකේ විතරයි.)

## Database
Dashboard data `users`, `otps`, `comments`, `coupons`, `meta` collections වල. Bot start/stop, settings, plugins (`mine`) `users` documents වල තියෙනවා – Panel bot එකට ඒවා කියවන්න ඕන නම් `users` collection එකෙන් කියවන්න.

## සීමාවන්
- OTP යවද්දී serverless function එක WhatsApp එකට තප්පර 3-8ක් connect වෙනවා. ඒක සාමාන්‍යයි.
- Vercel Hobby plan එක non-commercial පාවිච්චියට විතරයි.
