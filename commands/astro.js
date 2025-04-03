const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

/**
 * Fetch astronomy data for Pipa
 * @returns {Promise<string>} Formatted astronomy data message
 */
async function getAstronomyData() {
    const now = moment().add(1, 'days');
    const date = now.clone().format('YYYY-MM-DD');

    const lat = -6.228056;
    const lng = -35.045833;

    const url = `https://api.stormglass.io/v2/astronomy/point?lat=${lat}&lng=${lng}&date=${date}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': process.env.STORMGLASS_API_KEY,
            },
        });

        const astronomyData = response.data.data;
        const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');

        let message = `*☀️🌙✨ Astronomy Data for Praia de Pipa - ${dateFormatted} ✨*\n\n`;
        message += `_This is approximate data, gathered using StormGlass API._\n\n`;

        // Sunrise and sunset
        if (astronomyData[0].sunrise && astronomyData[0].sunset) {
            const sunriseTime = moment.utc(astronomyData[0].sunrise).tz('America/Sao_Paulo').format('HH:mm');
            const sunsetTime = moment.utc(astronomyData[0].sunset).tz('America/Sao_Paulo').format('HH:mm');

            message += `*Sun:*\n`;
            message += `🌅 Sunrise: ${sunriseTime}\n`;
            message += `🌇 Sunset: ${sunsetTime}\n\n`;
        }

        // Moonrise, moonset, and moon phase
        if (astronomyData[0].moonrise && astronomyData[0].moonPhase) {
            const moonriseTime = moment.utc(astronomyData[0].moonrise).tz('America/Sao_Paulo').format('HH:mm');

            // Add moonset if available
            let moonsetInfo = "";
            if (astronomyData[0].moonset) {
                const moonsetTime = moment.utc(astronomyData[0].moonset).tz('America/Sao_Paulo').format('HH:mm');
                moonsetInfo = `🌃 Moonset: ${moonsetTime}\n`;
            }

            // Get moon phase from the API and simplify it
            const originalMoonPhase = astronomyData[0].moonPhase.current.text;
            const simplifiedPhase = simplifyMoonPhase(originalMoonPhase);

            message += `*Moon:*\n`;
            message += `🌜 Moonrise: ${moonriseTime}\n`;
            message += moonsetInfo;
            message += `🌙 Moon Phase: ${simplifiedPhase}\n`;

            // Add illumination if available
            if (astronomyData[0].moonPhase.current.illumination) {
                const illumination = (astronomyData[0].moonPhase.current.illumination * 100).toFixed(0);
                message += `✨ Illumination: ${illumination}%\n`;
            }
        }

        return message;
    } catch (error) {
        console.error('❌ Error fetching astronomy data:', error);
        if (error.response) {
            console.log(error.response.data);
        }
        return "Could not retrieve astronomy data. Please try again later.";
    }
}

/**
 * Simplify moon phase names to four basic phases
 * @param {String} detailedPhase - Original moon phase from API
 * @returns {String} Simplified moon phase
 */
function simplifyMoonPhase(detailedPhase) {
    const lowerPhase = detailedPhase.toLowerCase();
    
    // Map detailed phases to simplified phases
    if (lowerPhase.includes('new') || lowerPhase === 'new moon') {
        return 'New Moon';
    } else if (lowerPhase.includes('waxing crescent') || lowerPhase.includes('waxing gibbous')) {
        return 'First Quarter';
    } else if (lowerPhase.includes('full') || lowerPhase === 'full moon') {
        return 'Full Moon';
    } else if (lowerPhase.includes('waning crescent') || lowerPhase.includes('waning gibbous')) {
        return 'Last Quarter';
    } else if (lowerPhase.includes('first quarter')) {
        return 'First Quarter';
    } else if (lowerPhase.includes('last quarter') || lowerPhase.includes('third quarter')) {
        return 'Last Quarter';
    } else {
        // Default case if we can't categorize it
        return 'Moon Phase: ' + detailedPhase;
    }
}

/**
 * Send astronomy data to a specific chat
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 */
async function sendAstronomyDataOnce(sock, chatId) {
    try {
        const astronomyMessage = await getAstronomyData();
        await sock.sendMessage(chatId, { text: astronomyMessage });
        console.log('✅ Astronomy data sent successfully');
    } catch (error) {
        console.error('❌ Error sending astronomy data:', error);
    }
}

module.exports = {
    getAstronomyData,
    sendAstronomyDataOnce
};
