const moment = require('moment-timezone');
const { sendTideDataOnce } = require('../commands/tide');
const { sendAstronomyDataOnce } = require('../commands/astro');

/**
 * Schedule tide data message daily at specified time
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {String} time - Time to send the message (HH:MM format)
 */
function scheduleTideData(sock, chatId, time = '19:30') {
    let lastSentDate = null;

    setInterval(async () => {
        const now = moment().tz('America/Sao_Paulo');
        const currentTime = now.format('HH:mm');
        const currentDate = now.format('YYYY-MM-DD');

        if (currentTime === time && lastSentDate !== currentDate) {
            console.log("📅 Sending scheduled tide data...");
            await sendTideDataOnce(sock, chatId);
            lastSentDate = currentDate; // Prevent duplicate sends
        }
    }, 60 * 1000); // Check every minute

    console.log(`🕒 Tide data scheduler set for ${time} daily`);
}

/**
 * Schedule astronomy data message daily at specified time
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {String} time - Time to send the message (HH:MM format)
 */
function scheduleAstronomyData(sock, chatId, time = '19:30') {
    let lastSentDate = null;

    setInterval(async () => {
        const now = moment().tz('America/Sao_Paulo');
        const currentTime = now.format('HH:mm');
        const currentDate = now.format('YYYY-MM-DD');

        if (currentTime === time && lastSentDate !== currentDate) {
            console.log("📅 Sending scheduled astronomy data...");
            await sendAstronomyDataOnce(sock, chatId);
            lastSentDate = currentDate; // Prevent duplicate sends
        }
    }, 60 * 1000); // Check every minute
    
    console.log(`🕒 Astronomy data scheduler set for ${time} daily`);
}

/**
 * Set up all scheduled tasks
 * @param {Object} sock - WhatsApp socket connection 
 * @param {String} chatId - Chat ID to send messages to
 */
function setupSchedulers(sock, chatId) {
    // You can set different times for each scheduler if needed
    scheduleTideData(sock, chatId);
    scheduleAstronomyData(sock, chatId);
    
    console.log('📆 All schedulers initialized successfully');
}

module.exports = {
    scheduleTideData,
    scheduleAstronomyData,
    setupSchedulers
};
