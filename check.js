/**
 * KSRTC seat checker. Runs on GitHub Actions (free, in the cloud).
 * Config is set via GitHub repo settings — no code editing needed.
 */
const puppeteer = require('puppeteer');

const KSRTC_URL = process.env.KSRTC_URL;
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const FROM_TIME = process.env.TIME_FROM || '';
const TO_TIME = process.env.TIME_TO || '';

if (!KSRTC_URL || !KSRTC_URL.startsWith('http')) {
    console.error('ERROR: KSRTC_URL is not set or invalid.');
    console.error('Got:', KSRTC_URL || '(empty)');
    console.error('Set it as a GitHub Actions variable in repo Settings > Secrets and variables > Actions > Variables tab');
    process.exit(1);
}
console.log('URL:', KSRTC_URL);

(async () => {
    // 1. Open page
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.goto(KSRTC_URL, { waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise(r => setTimeout(r, 5000));

    // 2. Grab all "X Seats Left" from the page
    const text = await page.evaluate(() => document.body.innerText);
    await browser.close();

    console.log('Page text (first 2000 chars):', text.substring(0, 2000));

    // 3. Find buses with seats
    const matches = [...text.matchAll(/(\d{1,2}:\d{2}),.*?(\d+)\s*Seats?\s*Left/gs)];
    let available = matches.map(m => ({ time: m[1], seats: parseInt(m[2]) })).filter(b => b.seats > 0);

    // 4. Filter by time window
    if (FROM_TIME && TO_TIME) {
        const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        available = available.filter(b => toMin(b.time) >= toMin(FROM_TIME) && toMin(b.time) <= toMin(TO_TIME));
    }

    if (available.length === 0) { console.log('No seats available.'); return; }

    // 5. Alert via Telegram
    const parsed = new globalThis.URL(KSRTC_URL);
    const from = decodeURIComponent(parsed.searchParams.get('fromCity') || '').split('|')[1] || '?';
    const to = decodeURIComponent(parsed.searchParams.get('toCity') || '').split('|')[1] || '?';
    const date = parsed.searchParams.get('departDate') || '?';

    let msg = `🚌 <b>KSRTC Seats Available!</b>\n📍 ${from} → ${to}\n📅 ${date}\n\n`;
    available.forEach(b => { msg += `🕐 ${b.time} — <b>${b.seats} seats</b>\n`; });
    msg += `\n🔗 <a href="${KSRTC_URL}">Book Now!</a>`;

    console.log(msg.replace(/<[^>]+>/g, ''));

    if (BOT && CHAT) {
        const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML' }),
        });
        console.log((await r.json()).ok ? 'Telegram sent!' : 'Telegram failed');
    }
})();
