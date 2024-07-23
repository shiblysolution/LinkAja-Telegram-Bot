'use strict';

require('dotenv').config();

const axios = require('axios');
const moment = require('moment');
process.env.TZ = 'Asia/Jakarta';

const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Replace 'YOUR_BOT_TOKEN' with your actual bot token
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const chatId = process.env.CHAT_ID; // Replace with the actual chat ID

// Manually specified API URLs
const apiUrlsOpeninSLA = {
    Unclosed: process.env.API_Unclosed,
    OpenInSLA: process.env.API_OpenInSLA,
    OpenOutSLA: process.env.API_OpenOutSLA,
};

const apiUrlsOutinSLA = {
    Closed: process.env.API_Closed,
    ClosedInSLA: process.env.API_ClosedInSLA,
    ClosedOutSLA: process.env.API_ClosedOutSLA
}

const apiUrlsKIP = {
    KIPOutSLA: process.env.API_KIPOutSLA
}

const apiAgingKIP = {
    KIPAging: process.env.API_AgingOpenOut
}

function getPreviousDaysDates(days) {
    const endDate = moment().subtract(1, 'days').endOf('day');
    const startDate = moment('2024-04-01');
    return { startDate, endDate };
}

async function fetchWithRetry(url, data, retries = 3, delay = 1000, timeout = 120000) {
    console.time(`fetchWithRetry ${url}`);
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.post(url, data, { timeout });
            console.timeEnd(`fetchWithRetry ${url}`);
            return response;
        } catch (error) {
            if (i === retries - 1 || !error.response || error.response.status !== 504) {
                console.timeEnd(`fetchWithRetry ${url}`);
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
    }
}


async function sendCombinedReport() {
    console.time('sendCombinedReport');
    try {
        const { startDate, endDate } = getPreviousDaysDates(30);
        const startDateFormat = startDate.format('D MMM YYYY');
        const endDateFormat = endDate.format('D MMM YYYY');
        const reportDateRange = `${startDateFormat} - ${endDateFormat}`;

        const formattedStartDate = startDate.format('YYYY-MM-DD');
        const formattedEndDate = endDate.format('YYYY-MM-DD');

        console.time('fetch ticket data');
        const ticketDataPromises = [
            fetchWithRetry(apiUrlsOpeninSLA.Unclosed, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOpeninSLA.OpenInSLA, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOpeninSLA.OpenOutSLA, { start_date: formattedStartDate, end_date: formattedEndDate })
        ];

        const [unclosedResponse, openInSLAResponse, openOutSLAResponse] = await Promise.all(ticketDataPromises);
        console.timeEnd('fetch ticket data');

        const ticketData = `
            • Ticket - Unclosed: ${unclosedResponse.data.data[0].count_id}
            • Ticket - Open In SLA: ${openInSLAResponse.data.data[0].count_id}
            • Ticket - Open Out SLA: ${openOutSLAResponse.data.data[0].count_id}
        `;

        console.time('fetch KIP data');
        const kipResponse = await fetchWithRetry(apiUrlsKIP.KIPOutSLA, {
            channel: "ALL",
            start_date: formattedStartDate,
            end_date: formattedEndDate
        });
        console.timeEnd('fetch KIP data');

        const delayedData = kipResponse.data.data.delayed;
        const slaMapping = { sla_1: '1HK', sla_3: '3HK', sla_7: '7HK', sla_14: '14HK' };
        const sortedSLAKeys = Object.keys(delayedData)
            .filter(sla => sla !== 'sla_7')
            .sort((a, b) => parseInt(slaMapping[b].match(/\d+/)[0]) - parseInt(slaMapping[a].match(/\d+/)[0]));

        let kipData = '';
        for (const sla of sortedSLAKeys) {
            const slaKey = slaMapping[sla] || sla;
            kipData += `TOP 3 KIP out of SLA ${slaKey}:\n`;

            const sortedData = Object.entries(delayedData[sla].data).sort((a, b) => b[1] - a[1]);
            sortedData.slice(0, 3).forEach(item => {
                kipData += `• ${item[0]}: ${item[1]}\n`;
            });
            kipData += '\n';
        }

        console.time('fetch closing ticket data');
        const closedDataPromises = [
            fetchWithRetry(apiUrlsOutinSLA.Closed, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOutinSLA.ClosedInSLA, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOutinSLA.ClosedOutSLA, { start_date: formattedStartDate, end_date: formattedEndDate })
        ];

        const [closedResponse, closedInSLAResponse, closedOutSLAResponse] = await Promise.all(closedDataPromises);
        console.timeEnd('fetch closing ticket data');

        const closingTicketData = `
            • Ticket - Closed: ${closedResponse.data.data[0].count_id}
            • Ticket - Closed In SLA: ${closedInSLAResponse.data.data[0].count_id}
            • Ticket - Closed Out SLA: ${closedOutSLAResponse.data.data[0].count_id}
        `;

        const reportString = `
            -------------------------------
            Report ${reportDateRange}
            -------------------------------
            ${ticketData}
            -------------------------------
            ${kipData}
            -------------------------------
            ${closingTicketData}
        `;

        bot.sendMessage(chatId, reportString, { parse_mode: 'HTML' });
    } catch (error) {
        bot.sendMessage(chatId, `Error fetching data: ${error.message}`);
    }
    console.timeEnd('sendCombinedReport');
}

async function top3DetailsReport() {
    console.time('top3DetailsReport');
    try {
        const { startDate, endDate } = getPreviousDaysDates(30);
        const startDateFormat = startDate.format('D MMM YYYY');
        const endDateFormat = endDate.format('D MMM YYYY');
        const reportDateRange = `${startDateFormat} - ${endDateFormat}`;

        const formattedStartDate = startDate.format('YYYY-MM-DD');
        const formattedEndDate = endDate.format('YYYY-MM-DD');

        console.time('fetch top 3 details');
        const response = await fetchWithRetry(apiAgingKIP.KIPAging, {
            start_date: formattedStartDate,
            end_date: formattedEndDate,
            channel: 'ALL'
        });
        console.timeEnd('fetch top 3 details');

        const data = response.data.data.sort((a, b) => b.total_ticket - a.total_ticket);
        let top3Report = `
            -------------------------------
            Aging cluster for ticket open out of SLA
            ${reportDateRange}
            -------------------------------
        `;

        for (let i = 0; i < Math.min(data.length, 3); i++) {
            const entry = data[i];
            const agingRanges = {
                'Aging 3-7': 0,
                'Aging 8-14': 0,
                'Aging 15-20': 0,
                'Aging 21-30': 0,
                'Aging >30': 0
            };

            Object.keys(agingRanges).forEach(range => {
                const [start, end] = range.match(/\d+/g) || [];
                for (let j = +start || 0; j <= (+end || 100); j++) {
                    agingRanges[range] += entry[`aging_${j}`] || 0;
                }
            });

            top3Report += `
                • ${entry.kip_2}
                Total Tickets: ${entry.total_ticket}
                ${Object.entries(agingRanges).map(([range, count]) => `${range}: ${count}`).join('\n')}
            `;
        }

        bot.sendMessage(chatId, top3Report, { parse_mode: 'HTML' });
    } catch (error) {
        bot.sendMessage(chatId, `Error fetching data: ${error.message}`);
    }
    console.timeEnd('top3DetailsReport');
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Bot is running and will send the combined report.');
    try {
        await sendCombinedReport(chatId);
        await top3DetailsReport(chatId);
    } catch (error) {
        console.error('Error in sending combined report:', error.message);
    }
});

cron.schedule('0 8 * * *', async () => {
    try {
        await sendCombinedReport();
        await top3DetailsReport();
    } catch (error) {
        console.error('Error in sending combined report:', error.message);
    }
});
