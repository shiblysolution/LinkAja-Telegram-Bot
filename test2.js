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

function getPreviousDaysDates(months) {
    const endDate = moment().subtract(1, 'days').endOf('day');
    const startDate = moment().subtract(months, 'months').startOf('month');
    return { startDate, endDate };
}

async function fetchWithRetry(url, data, retries = 3, delay = 1000) {
    let success = false;
    let response;
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Attempt ${i + 1} to fetch data from ${url}`);
            response = await axios.post(url, data);
            success = true;
            break;
        } catch (error) {
            if (i === retries - 1 || !error.response || error.response.status !== 504) {
                throw error;
            }
            console.error(`Error fetching data (attempt ${i + 1}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
    }
    return { success, response };
}

async function sendCombinedReport() {
    try {
        const { startDate, endDate } = getPreviousDaysDates(3);

        const startDateFormat = startDate.format('D MMM YYYY');
        const endDateFormat = endDate.format('D MMM YYYY');
        const reportDateRange = `${startDateFormat} - ${endDateFormat}`;

        const formattedStartDate = startDate.format('YYYY-MM-DD');
        const formattedEndDate = endDate.format('YYYY-MM-DD');

        // Fetch ticket data
        const ticketDataPromises = [
            fetchWithRetry(apiUrlsOpeninSLA.Unclosed, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOpeninSLA.OpenInSLA, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOpeninSLA.OpenOutSLA, { start_date: formattedStartDate, end_date: formattedEndDate })
        ];

        const ticketResponses = await Promise.all(ticketDataPromises);

        const unclosedResponse = ticketResponses[0];
        const openInSLAResponse = ticketResponses[1];
        const openOutSLAResponse = ticketResponses[2];

        const unclosedCount = unclosedResponse.success ? unclosedResponse.response.data.data[0].count_id : 'Fetch failed';
        const openInSLACount = openInSLAResponse.success ? openInSLAResponse.response.data.data[0].count_id : 'Fetch failed';
        const openOutSLACount = openOutSLAResponse.success ? openOutSLAResponse.response.data.data[0].count_id : 'Fetch failed';

        const ticketData = `• <b>Ticket - Unclosed : </b>${unclosedCount}\n• <b>Ticket - Open In SLA : </b>${openInSLACount}\n• <b>Ticket - Open Out SLA : </b>${openOutSLACount}\n`;

        let kipData = '';

        const kipResponse = await fetchWithRetry(apiUrlsKIP.KIPOutSLA, {
            channel: "ALL",
            start_date: formattedStartDate,
            end_date: formattedEndDate
        });

        const delayedData = kipResponse.success ? kipResponse.response.data.data.delayed : 'Fetch failed';

        const slaMapping = {
            sla_1: '1HK',
            sla_3: '3HK',
            sla_7: '7HK',
            sla_14: '14HK'
        };

        const customSort = (a, b) => {
            const keyA = slaMapping[a] || a;
            const keyB = slaMapping[b] || b;
            const numA = parseInt(keyA.match(/\d+/)[0]);
            const numB = parseInt(keyB.match(/\d+/)[0]);

            if (numA < numB) return 1; 
            if (numA > numB) return -1;
            return 0;
        };

        const sortedSLAKeys = delayedData !== 'Fetch failed' ? Object.keys(delayedData)
            .filter(sla => sla !== 'sla_7') 
            .sort(customSort) : [];

        for (const sla of sortedSLAKeys) {
            const slaKey = slaMapping[sla] || sla;
            kipData += `<b>TOP 3 KIP out of SLA ${slaKey}:\n</b>`;

            const sortedData = Object.entries(delayedData[sla].data).sort((a, b) => b[1] - a[1]);
            const top3Items = sortedData.slice(0, 3);

            top3Items.forEach(item => {
                kipData += `• ${item[0]}: ${item[1]}\n`;
            });
            kipData += '\n';
        }

        const closedDataPromises = [
            fetchWithRetry(apiUrlsOutinSLA.Closed, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOutinSLA.ClosedInSLA, { start_date: formattedStartDate, end_date: formattedEndDate }),
            fetchWithRetry(apiUrlsOutinSLA.ClosedOutSLA, { start_date: formattedStartDate, end_date: formattedEndDate })
        ];

        const closedResponses = await Promise.all(closedDataPromises);

        const closedResponse = closedResponses[0];
        const closedInSLAResponse = closedResponses[1];
        const closedOutSLAResponse = closedResponses[2];

        const closedCount = closedResponse.success ? closedResponse.response.data.data[0].count_id : 'Fetch failed';
        const closedInSLACount = closedInSLAResponse.success ? closedInSLAResponse.response.data.data[0].count_id : 'Fetch failed';
        const closedOutSLACount = closedOutSLAResponse.success ? closedOutSLAResponse.response.data.data[0].count_id : 'Fetch failed';

        const closingTicketData = `<b>• Ticket - Closed : </b>${closedCount}\n<b>• Ticket - Closed In SLA : </b>${closedInSLACount}\n<b>• Ticket - Closed Out SLA : </b>${closedOutSLACount}\n`;

        let reportString = `-------------------------------\n<b>Report ${reportDateRange}</b>\n-------------------------------\n`;

        reportString += '\n';
        reportString += ticketData;
        reportString += '\n';
        reportString += '-------------------------------\n';

        reportString += '\n';
        reportString += kipData;

        reportString += '-------------------------------\n';
        reportString += '\n';
        reportString += closingTicketData;

        bot.sendMessage(chatId, reportString, { parse_mode: 'HTML' });
    } catch (error) {
        bot.sendMessage(chatId, `Error fetching data: ${error.message}`);
    }
}

async function top3DetailsReport() {
    try {
        const { startDate, endDate } = getPreviousDaysDates(3);

        const startDateFormat = startDate.format('D MMM YYYY');
        const endDateFormat = endDate.format('D MMM YYYY');
        const reportDateRange = `${startDateFormat} - ${endDateFormat}`;

        const formattedStartDate = startDate.format('YYYY-MM-DD');
        const formattedEndDate = endDate.format('YYYY-MM-DD');

        const response = await fetchWithRetry(apiAgingKIP.KIPAging, {
            start_date: formattedStartDate,
            end_date: formattedEndDate,
            channel: 'ALL'
        });

        const data = response.success ? response.response.data.data : [];

        data.sort((a, b) => b.total_ticket - a.total_ticket);

        let top3Report = '';
        top3Report += `-------------------------------\n`
        top3Report += `<b>Aging cluster for ticket open out of SLA </b>\n`;
        top3Report += `<b>${reportDateRange}</b>\n`;
        top3Report += `-------------------------------\n\n`

        for (let i = 0; i < Math.min(data.length, 3); i++) {
            const entry = data[i];
            top3Report += `<b> • ${entry.kip_2}</b>\n`;
            top3Report += `Total Tickets: ${entry.total_ticket}\n`;

            let aging_3_7 = 0;
            let aging_8_14 = 0;
            let aging_15_20 = 0;
            let aging_21_30 = 0;
            let aging_greater_30 = 0;

            for (let j = 3; j <= 7; j++) {
                aging_3_7 += entry[`aging_${j}`] || 0;
            }
            for (let j = 8; j <= 14; j++) {
                aging_8_14 += entry[`aging_${j}`] || 0;
            }
            for (let j = 15; j <= 20; j++) {
                aging_15_20 += entry[`aging_${j}`] || 0;
            }
            for (let j = 21; j <= 30; j++) {
                aging_21_30 += entry[`aging_${j}`] || 0;
            }
            for (let j = 31; j <= 100; j++) {
                aging_greater_30 += entry[`aging_${j}`] || 0;
            }

            top3Report += `<b>Details :</b>\n`;
            top3Report += `Aging 3-7 : ${aging_3_7}\n`;
            top3Report += `Aging 8-14 : ${aging_8_14}\n`;
            top3Report += `Aging 15-20 : ${aging_15_20}\n`;
            top3Report += `Aging 21-30 : ${aging_21_30}\n`;
            top3Report += `Aging >30 : ${aging_greater_30}\n\n`;
        }

        bot.sendMessage(chatId, top3Report, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error fetching top 3 details report:', error.message);
    }
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
