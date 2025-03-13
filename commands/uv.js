const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Fetch and format the current UV index
 * @returns {Promise<string>} Formatted UV index message
 */
async function getUVIndex() {
    try {
        const response = await axios.get('https://currentuvindex.com/api/v1/uvi', {
            params: {
                latitude: -6.233,
                longitude: -35.050
            }
        });

        if (response.data && response.data.ok) {
            const currentUVI = response.data.now.uvi;
            const location = `Pipa (${response.data.latitude}, ${response.data.longitude})`;
            const time = moment(response.data.now.time).tz('America/Sao_Paulo').format('HH:mm');

            let uvCategory, emoji;

            if (currentUVI === 0) {
                uvCategory = "No risk";
                emoji = "✅";
            } else if (currentUVI <= 2) {
                uvCategory = "Low risk";
                emoji = "✅";
            } else if (currentUVI <= 5) {
                uvCategory = "Moderate risk";
                emoji = "⚠️";
            } else if (currentUVI <= 7) {
                uvCategory = "High risk";
                emoji = "🔴";
            } else if (currentUVI <= 10) {
                uvCategory = "Very high risk";
                emoji = "⛔";
            } else {
                uvCategory = "Extreme risk";
                emoji = "☣️";
            }

            let message = `*UV Index for ${location} at ${time}*\n\n`;
            message += `Current UV Index: *${currentUVI}* ${emoji}\n`;
            message += `Risk Level: *${uvCategory}*\n\n`;

            // Add recommendation based on UV level
            if (currentUVI > 3) {
                message += "Recommendations:\n";
                message += "• Wear sunscreen (min. SPF 30)\n";
                message += "• Seek shade during midday hours\n";
                message += "• Wear protective clothing, hat, and sunglasses\n";
            } else if (currentUVI > 0) {
                message += "Recommendations:\n";
                message += "• Wear sunscreen if spending extended time outdoors\n";
            } else {
                message += "No sun protection required at this time.";
            }

            return message;
        } else {
            return "Could not retrieve UV index data. Please try again later.";
        }
    } catch (error) {
        console.error('Error fetching UV index:', error);
        return "Error fetching UV index data. Please try again later.";
    }
}

module.exports = { getUVIndex };
