#!/usr/bin/env node

/**
 * KSRTC Bus Seat Alert
 *
 * Run: node index.js
 * It will ask you for everything interactively.
 */

const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const inquirer = require('inquirer');
require('dotenv').config();

// ─── CONFIG (loaded from .env file) ──────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
// ─────────────────────────────────────────────────────

async function sendTelegram(message, token, chatId) {
    if (!token) return;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
        });
        const data = await res.json();
        if (data.ok) console.log('  \u2705 Telegram alert sent!');
        else console.log(`  \u26A0  Telegram error: ${data.description}`);
    } catch (e) {
        console.log(`  \u26A0  Telegram failed: ${e.message}`);
    }
}

function parseSearchUrl(url) {
    const u = new URL(url);
    const fromCity = decodeURIComponent(u.searchParams.get('fromCity') || '').split('|');
    const toCity = decodeURIComponent(u.searchParams.get('toCity') || '').split('|');
    const date = u.searchParams.get('departDate') || '';
    return {
        fromName: fromCity[1] || fromCity[0],
        toName: toCity[1] || toCity[0],
        date,
    };
}

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

async function checkSeats(searchUrl) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Capture JSON API responses the page makes
        let apiData = [];
        page.on('response', async (response) => {
            try {
                const ct = response.headers()['content-type'] || '';
                if (ct.includes('json') && response.url().includes('api')) {
                    const json = await response.json();
                    apiData.push({ url: response.url(), data: json });
                }
            } catch (_) { }
        });

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 40000 });
        await new Promise(r => setTimeout(r, 5000));

        // Scrape — matching KSRTC Swift's page layout
        const result = await page.evaluate(() => {
            const text = document.body?.innerText || '';

            const noService = /no\s*(?:service|bus|trip|result)/i.test(text) ||
                text.includes('No Services Found');

            const buses = [];
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);

            let currentBus = {};
            for (const line of lines) {
                // Departure: "08:00, 22 Feb, Sultan Bathery (12)"
                const timeMatch = line.match(/^(\d{1,2}:\d{2}),\s*(\d{1,2}\s+\w+),\s*(.+)/);
                if (timeMatch && !currentBus.departure) {
                    currentBus.departure = timeMatch[1];
                    currentBus.depDate = timeMatch[2];
                    continue;
                }
                if (timeMatch && currentBus.departure && !currentBus.arrival) {
                    currentBus.arrival = timeMatch[1];
                    continue;
                }

                // Fare: "₹221"
                const fareMatch = line.match(/[₹]\s*(\d+)/);
                if (fareMatch) {
                    currentBus.fare = '\u20B9' + fareMatch[1];
                }

                // Seats: "37 Seats Left"
                const seatMatch = line.match(/(\d+)\s*Seats?\s*Left/i);
                if (seatMatch) {
                    currentBus.seats = parseInt(seatMatch[1]);
                    buses.push({ ...currentBus });
                    currentBus = {};
                    continue;
                }

                // Sold Out
                if (/Sold\s*Out/i.test(line) && currentBus.departure) {
                    currentBus.seats = 0;
                    buses.push({ ...currentBus });
                    currentBus = {};
                }
            }

            return { buses, noService, totalText: text.substring(0, 2000) };
        });

        return { ...result, apiData };
    } catch (err) {
        return { error: err.message, buses: [], noService: false, apiData: [] };
    } finally {
        if (browser) await browser.close();
    }
}

// ─── MAIN ────────────────────────────────────────────

async function main() {
    console.log('\n  \uD83D\uDE8C KSRTC Bus Seat Alert');
    console.log('  ────────────────────────\n');

    // 1. Get KSRTC search URL
    const { searchUrl } = await inquirer.prompt([{
        type: 'input',
        name: 'searchUrl',
        message: 'Paste KSRTC search URL:',
        validate: v => v.includes('onlineksrtcswift.com') ? true : 'Paste a valid onlineksrtcswift.com URL',
    }]);

    // 2. Time window (optional)
    const { useTimeWindow } = await inquirer.prompt([{
        type: 'confirm',
        name: 'useTimeWindow',
        message: 'Filter by departure time window?',
        default: false,
    }]);

    let timeFrom = null, timeTo = null;
    if (useTimeWindow) {
        const tw = await inquirer.prompt([
            { type: 'input', name: 'from', message: 'From time (HH:MM):', default: '06:00', validate: v => /^\d{1,2}:\d{2}$/.test(v) || 'Use HH:MM' },
            { type: 'input', name: 'to', message: 'To time (HH:MM):', default: '22:00', validate: v => /^\d{1,2}:\d{2}$/.test(v) || 'Use HH:MM' },
        ]);
        timeFrom = tw.from;
        timeTo = tw.to;
    }

    // 3. Check interval
    const { interval } = await inquirer.prompt([{
        type: 'number',
        name: 'interval',
        message: 'Check every (minutes):',
        default: 5,
        validate: v => v >= 1 || 'Min 1 minute',
    }]);

    // 4. Telegram setup
    let botToken = TELEGRAM_BOT_TOKEN;
    let chatId = TELEGRAM_CHAT_ID;

    if (!botToken) {
        const { setupTg } = await inquirer.prompt([{
            type: 'confirm',
            name: 'setupTg',
            message: 'Set up Telegram alerts?',
            default: true,
        }]);

        if (setupTg) {
            console.log('\n  How to set up:');
            console.log('  1. Open Telegram > search @BotFather > send /newbot');
            console.log('  2. Search @userinfobot > get your chat ID\n');

            const tg = await inquirer.prompt([
                { type: 'input', name: 'token', message: 'Bot token:', validate: v => v.includes(':') || 'Format: 123456:ABC-DEF...' },
                { type: 'input', name: 'chatId', message: 'Your chat ID:', validate: v => v.length > 0 || 'Required' },
            ]);
            botToken = tg.token;
            chatId = tg.chatId;

            // Test it
            console.log('');
            await sendTelegram('\u2705 KSRTC alert bot connected! You will get alerts here.', botToken, chatId);
        }
    }

    // Parse route info
    const route = parseSearchUrl(searchUrl);
    const intervalMs = interval * 60 * 1000;

    console.log(`\n  \uD83D\uDCCD ${route.fromName} \u2192 ${route.toName}`);
    console.log(`  \uD83D\uDCC5 ${route.date}`);
    if (timeFrom && timeTo) console.log(`  \uD83D\uDD50 Window: ${timeFrom} \u2013 ${timeTo}`);
    console.log(`  \u23F1  Every ${interval} min`);
    console.log(`  \uD83D\uDD14 Telegram: ${botToken ? 'ON' : 'OFF'}`);
    console.log('  Ctrl+C to stop\n');

    // Send startup confirmation to Telegram
    if (botToken) {
        const startMsg = `\u2705 KSRTC Alert Started!\n\n\uD83D\uDCCD ${route.fromName} \u2192 ${route.toName}\n\uD83D\uDCC5 ${route.date}${timeFrom ? '\n\uD83D\uDD50 ' + timeFrom + ' \u2013 ' + timeTo : ''}\n\u23F1 Every ${interval} min`;
        await sendTelegram(startMsg, botToken, chatId);
    }

    let checkCount = 0;
    let lastSeatCount = 0;

    const doCheck = async () => {
        checkCount++;
        const now = new Date().toLocaleTimeString();
        process.stdout.write(`  [${now}] #${checkCount}...`);

        const result = await checkSeats(searchUrl);

        if (result.error) {
            console.log(` \u274C ${result.error}`);
            return;
        }

        if (result.noService) {
            console.log(' \uD83D\uDEAB No services on this route/date');
            return;
        }

        // Filter buses with available seats
        let available = (result.buses || []).filter(b => b.seats > 0);

        // Apply time window
        if (timeFrom && timeTo && available.length > 0) {
            const fMin = timeToMinutes(timeFrom);
            const tMin = timeToMinutes(timeTo);
            available = available.filter(b => {
                if (!b.departure) return true;
                const d = timeToMinutes(b.departure);
                return d >= fMin && d <= tMin;
            });
        }

        const totalSeats = available.reduce((sum, b) => sum + b.seats, 0);

        if (available.length > 0) {
            console.log(` \uD83C\uDF89 ${totalSeats} seat(s) on ${available.length} bus(es)!`);

            if (totalSeats > lastSeatCount) {
                // Build Telegram message
                let msg = '\uD83D\uDE8C <b>KSRTC Seats Available!</b>\n\n';
                msg += `\uD83D\uDCCD ${route.fromName} \u2192 ${route.toName}\n`;
                msg += `\uD83D\uDCC5 ${route.date}\n\n`;

                available.forEach(b => {
                    msg += `\uD83D\uDD50 <b>${b.departure || '?'}</b>`;
                    if (b.arrival) msg += ` \u2192 ${b.arrival}`;
                    msg += ` \u2014 <b>${b.seats} seats</b>`;
                    if (b.fare) msg += ` (${b.fare})`;
                    msg += '\n';
                });

                msg += `\n\uD83D\uDD17 <a href="${searchUrl}">Book Now!</a>`;

                // Console
                console.log('');
                available.forEach(b => {
                    console.log(`    \uD83D\uDD50 ${b.departure || '?'}${b.arrival ? ' \u2192 ' + b.arrival : ''} | ${b.seats} seats${b.fare ? ' | ' + b.fare : ''}`);
                });
                console.log('');

                await sendTelegram(msg, botToken, chatId);

                // Windows desktop notification + beep
                const { exec } = require('child_process');
                exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('KSRTC seats available on ${route.date}! Book now!', 'KSRTC Alert', 'OK', 'Information')"`);
                // Beep 5 times
                for (let i = 0; i < 5; i++) { process.stdout.write('\x07'); await new Promise(r => setTimeout(r, 500)); }
            }
            lastSeatCount = totalSeats;
        } else {
            const total = result.buses?.length || 0;
            if (checkCount <= 2) {
                console.log(` \u23F3 ${total} bus(es), all sold out`);
                result.buses?.forEach(b => console.log(`      [debug] dep=${b.departure} arr=${b.arrival} seats=${b.seats}`));
            } else {
                console.log(` \u23F3 ${total} bus(es), all sold out`);
            }
            lastSeatCount = 0;
        }
    };

    await doCheck();
    setInterval(doCheck, intervalMs);

    process.on('SIGINT', () => {
        console.log('\n\n  \uD83D\uDC4B Stopped. Happy travels!\n');
        process.exit(0);
    });
}

main().catch(e => { console.error(e); process.exit(1); });
