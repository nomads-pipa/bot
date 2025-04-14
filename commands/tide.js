const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

/**
 * Fetch tide data for Pipa with retry functionality
 * @param {Number} maxRetries - Maximum number of retry attempts
 * @param {Number} delayMs - Delay between retries in milliseconds
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds
 * @returns {Promise<string>} Formatted tide data message
 */
async function getTideData(maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    let retryCount = 0;
    let lastError = null;
    // Retry logic
    while (retryCount <= maxRetries) {
        try {
            const now = moment().add(1, 'days');
            const startDate = now.clone().startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
            const endDate = now.clone().add(1, 'days').startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
            
            const lat = -6.228056;
            const lng = -35.045833;
            
            const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
            
            const response = await axios.get(url, {
                headers: {
                    'Authorization': process.env.STORMGLASS_API_KEY,
                },
            });
            const tideData = response.data.data;
            const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');
            let message = `*🌊🏄‍♂️🏖️🐬 Tide Extremes for Praia de Pipa - ${dateFormatted} ☀️*\n\n`;
            message += `_This is approximate data, gathered using StormGlass API._\n\n`;
            tideData.forEach((tide) => {
                const timeUTC = moment.utc(tide.time);
                const timeSaoPaulo = timeUTC.tz('America/Sao_Paulo').format('HH:mm');
                message += `\n${tide.type}: ${timeSaoPaulo}, Height: ${tide.height.toFixed(2)}m`;
            });
            return message;
        } catch (error) {
            lastError = error;
            retryCount++;
            
            console.error(`❌ Error fetching tide data (Attempt ${retryCount}/${maxRetries}):`, error.message);
            
            if (error.response) {
                console.log('Response error data:', error.response.data);
            }
            
            // If we've reached max retries, try one more time with a longer delay
            if (retryCount > maxRetries) {
                console.log(`All regular retries failed. Attempting one final retry in 30 minutes...`);
                await new Promise(resolve => setTimeout(resolve, longRetryDelayMs));
                try {
                    // One last attempt after long delay
                    const result = await getTideData(0, 0); // No retries on this final attempt
                    return result;
                } catch (finalError) {
                    console.error('❌ Final retry attempt failed:', finalError.message);
                    break;
                }
            }
            
            // Wait before trying again
            console.log(`Waiting ${delayMs/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    
    // If we got here, all retries failed
    console.error('❌ All retry attempts failed for tide data');
    return "Could not retrieve tide data. Please try again later.";
}

/**
 * Send tide data to a specific chat with retry logic
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds (default: 30 minutes)
 */
async function sendTideDataOnce(sock, chatId, maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    try {
        const tideMessage = await getTideData(maxRetries, delayMs, longRetryDelayMs);
        await sock.sendMessage(chatId, { text: tideMessage });
        console.log('✅ Tide data sent successfully');
    } catch (error) {
        console.error('❌ Error sending tide data:', error);
    }
}

module.exports = {
    getTideData,
    sendTideDataOnce
};
