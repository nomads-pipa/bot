const axios = require('axios');
const moment = require('moment-timezone');

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
                'Authorization': '04f5362a-eff6-11ef-85cb-0242ac130003-04f53684-eff6-11ef-85cb-0242ac130003',
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

            // Get moon phase directly from the API
            const moonPhaseText = astronomyData[0].moonPhase.current.text;

            message += `*Moon:*\n`;
            message += `🌜 Moonrise: ${moonriseTime}\n`;
            message += moonsetInfo;
            message += `🌙 Moon Phase: ${moonPhaseText}\n`;

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
