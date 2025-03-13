const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Fetch tide data for Pipa
 * @returns {Promise<string>} Formatted tide data message
 */
async function getTideData() {
    const now = moment().add(1, 'days');
    const startDate = now.clone().startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
    const endDate = now.clone().add(1, 'days').startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');

    const lat = -6.228056;
    const lng = -35.045833;

    const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': '46d9689e-effc-11ef-8c11-0242ac130003-46d96920-effc-11ef-8c11-0242ac130003',
            },
        });

        const tideData = response.data.data;
        const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');

        let message = `*🌊🏄‍♂️🏖️🐬 Tide Extremes for Praia de Pipa - ${dateFormatted} ☀️*\n\n`;
        message += `_This is approximate data, gathered using a free API._\n\n`;

        tideData.forEach((tide) => {
            const timeUTC = moment.utc(tide.time);
            const timeSaoPaulo = timeUTC.tz('America/Sao_Paulo').format('HH:mm');
            message += `\n${tide.type}: ${timeSaoPaulo}, Height: ${tide.height.toFixed(2)}m`;
        });

        return message;
    } catch (error) {
        console.error('❌ Error fetching tide data:', error);
        if (error.response) {
            console.log(error.response.data);
        }
        return "Could not retrieve tide data. Please try again later.";
    }
}

/**
 * Send tide data to a specific chat
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 */
async function sendTideDataOnce(sock, chatId) {
    try {
        const tideMessage = await getTideData();
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
