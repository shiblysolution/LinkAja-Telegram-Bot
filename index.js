'use strict';

require('dotenv').config();
const axios = require('axios');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const winston = require('winston');

process.env.TZ = 'Asia/Jakarta';
process.env.NTBA_FIX_350 = true;

const logDir = path.join(__dirname, 'log');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
        new winston.transports.File({ filename: path.join(logDir, 'errors.log'), level: 'error' })
    ],
});

logger.exceptions.handle(
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
);

process.on('unhandledRejection', (ex) => {
    throw ex;
});

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const chatId = process.env.CHAT_ID; 

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

const apiUrlTableSla = {
    KipOutSla: 'https://crm.linkaja.id/svc/report/ticket-monitor/table/ticket-open-out-sla',
    KipInSla: 'https://crm.linkaja.id/svc/report/ticket-monitor/table/ticket-open-in-sla',
}

const apiUrlCheckSummary = {
    checkSummary: 'https://crm.linkaja.id/svc/report/ticket-monitor/telegram/check-summary',
    insertSummary: 'https://crm.linkaja.id/svc/report/ticket-monitor/telegram/insert-summary',
}

const originalFilePath = path.join(__dirname, 'sample.csv');

const currentYear = new Date().getFullYear();
const previousYear = currentYear - 1;


// function getPreviousDaysDates() {
//     const endDate = moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm'); 
//     const startDate = moment('2024-01-01 00:00').format('YYYY-MM-DD HH:mm'); 
//     return { startDate, endDate };
// }

async function sendCombinedReport(chatId, startDate, endDate) {
    try {
        const reportDateRange = `${startDate} - ${endDate}`;
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        logger.info(`[${timestamp}] Sending API request to Unclosed with parameters: start_date=${startDate}, end_date=${endDate}`);

        const unclosedResponse = await axios.post(apiUrlsOpeninSLA.Unclosed, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to OpenInSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const openInSLAResponse = await axios.post(apiUrlsOpeninSLA.OpenInSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to OpenOutSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const openOutSLAResponse = await axios.post(apiUrlsOpeninSLA.OpenOutSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for Unclosed: ${JSON.stringify(unclosedResponse.data)}`);
        logger.info(`[${timestamp}] Received response for OpenInSLA: ${JSON.stringify(openInSLAResponse.data)}`);
        logger.info(`[${timestamp}] Received response for OpenOutSLA: ${JSON.stringify(openOutSLAResponse.data)}`);

        const unclosedCount = unclosedResponse.data.data[0].count_id;
        const openInSLACount = openInSLAResponse.data.data[0].count_id;
        const openOutSLACount = openOutSLAResponse.data.data[0].count_id;

        const ticketData = `• <b>Ticket - Unclosed : </b>${unclosedCount}\n• <b>Ticket - Open In SLA : </b>${openInSLACount}\n• <b>Ticket - Open Out SLA : </b>${openOutSLACount}\n`;

        let kipData = '';

        logger.info(`[${timestamp}] Sending API request to KIP with parameters: channel=ALL, start_date=${startDate}, end_date=${endDate}`);
        const kipResponse = await axios.post(apiUrlsKIP.KIPOutSLA, {
            channel: "ALL",
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for KIP: ${JSON.stringify(kipResponse.data)}`);

        const delayedData = kipResponse.data.data.delayed;

        const slaMapping = {
            sla_1: '1HK',
            sla_2: '2HK',
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

        const sortedSLAKeys = Object.keys(delayedData)
            .filter(sla => sla !== 'sla_7')
            .sort(customSort);

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

        logger.info(`[${timestamp}] Sending API request to Closed with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedResponse = await axios.post(apiUrlsOutinSLA.Closed, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to ClosedInSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedInSLAResponse = await axios.post(apiUrlsOutinSLA.ClosedInSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to ClosedOutSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedOutSLAResponse = await axios.post(apiUrlsOutinSLA.ClosedOutSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for Closed: ${JSON.stringify(closedResponse.data)}`);
        logger.info(`[${timestamp}] Received response for ClosedInSLA: ${JSON.stringify(closedInSLAResponse.data)}`);
        logger.info(`[${timestamp}] Received response for ClosedOutSLA: ${JSON.stringify(closedOutSLAResponse.data)}`);

        const closedCount = closedResponse.data.data[0].count_id;
        const closedInSLACount = closedInSLAResponse.data.data[0].count_id;
        const closedOutSLACount = closedOutSLAResponse.data.data[0].count_id;

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

        const response = await axios.post('https://crm.linkaja.id/svc/report/ticket-monitor/ticket-open-out-sla', {
            type: 'telegram',
            start_date: startDate,
            end_date: endDate,
            chat_id: chatId
        });

        if (response.data.success) {
            const fileLink = `Report ${currentYear} is being generated on the background and will send after complete`;

            reportString += `-------------------------------\n`;
            reportString += `${fileLink}\n`;
            reportString += `-------------------------------\n`;
        } else {
            reportString += 'Failed to fetch the detailed report data.\n';
        }
        
        bot.sendMessage(chatId, reportString, { parse_mode: 'HTML' });
    } catch (error) {
        logger.error(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Error generating report: ${error.message}`);
        bot.sendMessage(chatId, `Error generating report: ${error.message}`);
    }
}

async function top3DetailsReport(chatId, startDate, endDate) {
    try {
        const reportDateRange = `${startDate} - ${endDate}`;

        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        logger.info(`[${timestamp}] Sending API request to KIPAging with parameters: start_date=${startDate}, end_date=${endDate}, channel=ALL`);
        
        const response = await axios.post(apiAgingKIP.KIPAging, {
            start_date: startDate,
            end_date: endDate,
            channel: 'ALL'
        });
        
        const data = response.data.data;

        // sort data
        data.sort((a, b) => b.total_ticket - a.total_ticket);

        let top3Report = '';
        top3Report += `-------------------------------\n`
        top3Report += `<b>Aging cluster for ticket open out of SLA </b>\n`;
        top3Report += `<b>${reportDateRange}</b>\n`;
        top3Report += `-------------------------------\n\n`

        // Display the top 3 entries
        for (let i = 0; i < Math.min(data.length, 3); i++) {
            const entry = data[i];
            top3Report += `<b> • ${entry.kip_2}</b>\n`;
            top3Report += `Total Tickets: ${entry.total_ticket}\n`;

            let aging_3_7 = 0;
            let aging_8_14 = 0;
            let aging_15_20 = 0;
            let aging_21_30 = 0;
            let aging_greater_30 = 0;

            // TOP 1  KIP
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
        logger.error(`[${timestamp}] Error fetching top 3 details report: ${error.message}`);
        console.error('Error fetching top 3 details report:', error.message);
    }
}

async function sendReportSummary(chatId, startDate, endDate, type="chat") {
    try {
        const reportDateRange = `${startDate} - ${endDate}`;
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        logger.info(`[${timestamp}] Sending API request for ${previousYear} Data`);

        const unclosedResponse = await axios.post(apiUrlsOpeninSLA.Unclosed, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to OpenInSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const openInSLAResponse = await axios.post(apiUrlsOpeninSLA.OpenInSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to OpenOutSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const openOutSLAResponse = await axios.post(apiUrlsOpeninSLA.OpenOutSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for Unclosed: ${JSON.stringify(unclosedResponse.data)}`);
        logger.info(`[${timestamp}] Received response for OpenInSLA: ${JSON.stringify(openInSLAResponse.data)}`);
        logger.info(`[${timestamp}] Received response for OpenOutSLA: ${JSON.stringify(openOutSLAResponse.data)}`);

        const unclosedCount = unclosedResponse.data.data[0].count_id;
        const openInSLACount = openInSLAResponse.data.data[0].count_id;
        const openOutSLACount = openOutSLAResponse.data.data[0].count_id;

        const ticketData = `• <b>Ticket - Unclosed : </b>${unclosedCount}\n• <b>Ticket - Open In SLA : </b>${openInSLACount}\n• <b>Ticket - Open Out SLA : </b>${openOutSLACount}\n`;

        let kipData = '';

        logger.info(`[${timestamp}] Sending API request to KIP with parameters: channel=ALL, start_date=${startDate}, end_date=${endDate}, and url=${apiUrlTableSla.KipOutSla}`);
        const kipResponse = await axios.post(apiUrlTableSla.KipOutSla, {
            channel: "ALL",
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for KIP: ${JSON.stringify(kipResponse.data)}`);

        const delayedData = kipResponse.data.data;
        if (delayedData.length > 0) {
            kipData += `<b>KIP Out of SLA:\n</b>`;
            delayedData.map((sla) => {
                kipData += `• ${sla.judul}: ${sla.count_data}\n`;        
                kipData += '\n';
            })
        }

        logger.info(`[${timestamp}] Sending API request to KIP with parameters: channel=ALL, start_date=${startDate}, end_date=${endDate}, and url=${apiUrlTableSla.KipInSla}`);
        const kipResponseInSLA = await axios.post(apiUrlTableSla.KipInSla, {
            channel: "ALL",
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for KIP: ${JSON.stringify(kipResponseInSLA.data)}`);

        const delayedDataInSLA = kipResponseInSLA.data.data;

        if (delayedDataInSLA.length > 0) {
            kipData += `<b>KIP In SLA:\n</b>`;
            delayedDataInSLA.map((sla) => {
                kipData += `• ${sla.judul}: ${sla.count_data}\n`;        
                kipData += '\n';
            })
        }

        // for (const sla of sortedSLAKeys) {
        //     const slaKey = slaMapping[sla] || sla;
        //     kipData += `<b>TOP 5 KIP In SLA ${slaKey}:\n</b>`;

        //     const sortedData = Object.entries(delayedData[sla].data).sort((a, b) => b[1] - a[1]);
        //     const top3Items = sortedData.slice(0, 3);

        //     top3Items.forEach(item => {
        //         kipData += `• ${item[0]}: ${item[1]}\n`;
        //     });
        //     kipData += '\n';
        // }

        logger.info(`[${timestamp}] Sending API request to Closed with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedResponse = await axios.post(apiUrlsOutinSLA.Closed, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to ClosedInSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedInSLAResponse = await axios.post(apiUrlsOutinSLA.ClosedInSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Sending API request to ClosedOutSLA with parameters: start_date=${startDate}, end_date=${endDate}`);
        const closedOutSLAResponse = await axios.post(apiUrlsOutinSLA.ClosedOutSLA, {
            start_date: startDate,
            end_date: endDate
        });

        logger.info(`[${timestamp}] Received response for Closed: ${JSON.stringify(closedResponse.data)}`);
        logger.info(`[${timestamp}] Received response for ClosedInSLA: ${JSON.stringify(closedInSLAResponse.data)}`);
        logger.info(`[${timestamp}] Received response for ClosedOutSLA: ${JSON.stringify(closedOutSLAResponse.data)}`);

        const closedCount = closedResponse.data.data[0].count_id;
        const closedInSLACount = closedInSLAResponse.data.data[0].count_id;
        const closedOutSLACount = closedOutSLAResponse.data.data[0].count_id;

        const closingTicketData = `<b>• Ticket - Closed : </b>${closedCount}\n<b>• Ticket - Closed In SLA : </b>${closedInSLACount}\n<b>• Ticket - Closed Out SLA : </b>${closedOutSLACount}\n`;

        if (Number(unclosedCount) <= 0) {
            // update 27 feb 2025 => check and insert summary
            if (type == "cron") {
                logger.info(`[${timestamp}] Sending API request to Check Summary with parameters: year=${previousYear}`);
                const checkSummary = await axios.post(apiUrlCheckSummary.checkSummary, {
                    year: previousYear
                });
                logger.info(`[${timestamp}] Received response for Check Summary: ${JSON.stringify(checkSummary.data)}`);

                // dont send message if already send
                if (!checkSummary.data.success) {
                    // insert summary
                    logger.info(`[${timestamp}] Sending API request to Insert Summary with parameters: year=${previousYear}, ticket_closed=${closedCount}, ticket_closed_in_sla=${closedInSLACount}, ticket_closed_out_sla=${closedOutSLACount}`);
                    const insertedData = await axios.post(apiUrlCheckSummary.insertSummary, {
                        year: previousYear,
                        ticket_closed: Number(closedCount),
                        ticket_closed_in_sla: Number(closedInSLACount),
                        ticket_closed_out_sla: Number(closedOutSLACount)
                    });
                    logger.info(`[${timestamp}] Received response for Insert Summary: ${JSON.stringify(insertedData.data)}`);
                } else {
                    return
                }
            } else {
                return
            }
        }

        let reportString = `Data will only count for ticket created in ${previousYear}\n`;
        reportString += `------------------------------------------------------------------\n`
        reportString += `<b>Summary ticket report ${previousYear}\n${previousYear}-01-01 00:00 - ${previousYear}-12-31 23:59</b>\n`
        reportString += `------------------------------------------------------------------\n`;

        reportString += '\n';
        reportString += ticketData;
        reportString += '\n';
        reportString += '-------------------------------\n';
        reportString += '\n';
        reportString += kipData;
        reportString += '-------------------------------\n';
        reportString += '\n';
        reportString += closingTicketData;

        const response = await axios.post('https://crm.linkaja.id/svc/report/ticket-monitor/ticket-open-out-sla', {
            type: 'telegram',
            start_date: startDate,
            end_date: endDate,
            chat_id: chatId
        });

        if (response.data.success) {
            const fileUrl = response.data.fileurl; 
            const fileLink = `Report ${previousYear} is being generated on the background and will send after complete`;

            reportString += `-------------------------------\n`;
            reportString += `${fileLink}\n`;
            reportString += `-------------------------------\n`;
        } else {
            reportString += 'Failed to fetch the detailed report data.\n';
        }

        bot.sendMessage(chatId, reportString, { parse_mode: 'HTML' });
    } catch (error) {
        logger.error(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Error generating report: ${error.message}`);
        bot.sendMessage(chatId, `Error generating report: ${error.message}`);
    }
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Bot is running and will send the combined report.');
    try {
        if (`${currentYear}-01-01` === moment().format('YYYY-MM-DD')) {
            // send data yearly Summary Report
            await sendReportSummary(chatId, `${previousYear}-01-01 00:00`, `${previousYear}-12-31 23:59`)
            // send current report
            await sendCombinedReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().format('YYYY-MM-DD HH:mm'));
            await top3DetailsReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().format('YYYY-MM-DD HH:mm'));
        } else {
            // send data yearly Summary Report
            await sendReportSummary(chatId, `${previousYear}-01-01 00:00`, `${previousYear}-12-31 23:59`)
            // send current report
            await sendCombinedReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm'));
            await top3DetailsReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm'));
        }
    } catch (error) {
        console.error('Error in sending combined report:', error.message);
    }
});

// Cron at 9 AM
cron.schedule('0 9 * * *', async () => {
    bot.sendMessage(chatId, 'Scheduled report is being sent now.');
    try {
        if (`${currentYear}-01-01` === moment().format('YYYY-MM-DD')) {
            // send data yearly Summary Report
            await sendReportSummary(chatId, `${previousYear}-01-01 00:00`, `${previousYear}-12-31 23:59`, "cron")
            // send current report
            await sendCombinedReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().format('YYYY-MM-DD HH:mm'));
            await top3DetailsReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().format('YYYY-MM-DD HH:mm'));
        } else {
            // send data yearly Summary Report
            await sendReportSummary(chatId, `${previousYear}-01-01 00:00`, `${previousYear}-12-31 23:59`, "cron")
            // send current report
            await sendCombinedReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm'));
            await top3DetailsReport(chatId, moment(`${currentYear}-01-01 00:00`).format('YYYY-MM-DD HH:mm'), moment().subtract(1, 'days').endOf('day').format('YYYY-MM-DD HH:mm'));
        }
    } catch (error) {
        console.error('Error in sending scheduled report:', error.message);
    }
});
