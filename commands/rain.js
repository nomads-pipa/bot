const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Check if rain is forecasted for today in Pipa
 * @returns {Promise<{willRain: boolean, message: string}>} Rain forecast information
 */
async function checkRainForecast() {
    const now = moment().tz('America/Sao_Paulo');
    const today = now.clone().startOf('day');
    
    // StormGlass API requires UTC timestamps
    const startDate = now.clone().utc().format('YYYY-MM-DDTHH:mm:ssZ');
    const endDate = today.clone().endOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
    
    // Pipa coordinates
    const lat = -6.228056;
    const lng = -35.045833;
    
    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=precipitation&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': '04f5362a-eff6-11ef-85cb-0242ac130003-04f53684-eff6-11ef-85cb-0242ac130003',
            },
        });

        const hourlyData = response.data.hours;

        // Check if any hour has significant precipitation (more than 0.2mm)
        const rainHours = hourlyData.filter(hour => {
            // Average the precipitation sources or use the most reliable one
            const precipValues = Object.values(hour.precipitation);
            const avgPrecip = precipValues.reduce((sum, val) => sum + val, 0) / precipValues.length;
            return avgPrecip > 0.2; // 0.2mm is a common threshold for measurable rain
        });

        const willRain = rainHours.length > 0;
        const dateFormatted = today.format('DD/MM/YYYY');

        if (willRain) {
            // Format rain times
            const rainTimes = rainHours.map(hour => {
                const timeUTC = moment.utc(hour.time);
                return timeUTC.tz('America/Sao_Paulo').format('HH:mm');
            });

            // Group consecutive hours
            const rainPeriods = [];
            let currentPeriod = [];

            rainTimes.forEach((time, index) => {
                if (index === 0 || parseInt(time) !== parseInt(rainTimes[index-1]) + 1) {
                    if (currentPeriod.length > 0) {
                        rainPeriods.push(currentPeriod);
                    }
                    currentPeriod = [time];
                } else {
                    currentPeriod.push(time);
                }
            });

            if (currentPeriod.length > 0) {
                rainPeriods.push(currentPeriod);
            }

            // Calculate precipitation intensity
            const maxPrecip = Math.max(...hourlyData.map(hour => {
                const precipValues = Object.values(hour.precipitation);
                return Math.max(...precipValues);
            }));

            let intensity = "light";
            if (maxPrecip > 4) intensity = "heavy";
            else if (maxPrecip > 1) intensity = "moderate";

            // Create the message
            let message = `⚠️ *RAIN ALERT FOR TODAY* ⚠️\n\n`;
            message += `🌧️ Rain is forecasted for Pipa today (${dateFormatted}).\n\n`;
            message += `Expect ${intensity} rainfall `;

            if (rainHours.length > 18) {
                message += `throughout most of the day.`;
            } else if (rainHours.length > 6) {
                message += `for several hours during the day.`;
            } else {
                message += `during these hours: `;
                rainTimes.forEach((time, i) => {
                    message += time;
                    if (i < rainTimes.length - 1) message += ", ";
                });
            }

            message += `\n\nBring your umbrella! But also do not trust the forecast, cause it's Pipa afterall ☔`;

            return {
                willRain: true,
                message
            };
        } else {
            return {
                willRain: false,
                message: `No rain is forecasted for Pipa today (${dateFormatted}). Enjoy your day! ☀️`
            };
        }
    } catch (error) {
        console.error('❌ Error checking rain forecast:', error);
        if (error.response) {
            console.log(error.response.data);
        }
        return {
            willRain: false,
            message: "Could not retrieve rain forecast. Please try again later."
        };
    }
}

/**
 * Check and send rain forecast if it will rain today
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Boolean} forceSend - Send message regardless of rain forecast (for testing)
 * @returns {Promise<Boolean>} Whether a message was sent
 */
async function checkAndSendRainAlert(sock, chatId, forceSend = false) {
    try {
        const forecast = await checkRainForecast();

        if (forecast.willRain || forceSend) {
            await sock.sendMessage(chatId, { text: forecast.message });
            console.log('✅ Rain alert sent successfully');
            return true;
        } else {
            console.log('☀️ No rain forecasted for today, no alert sent');
            return false;
        }
    } catch (error) {
        console.error('❌ Error sending rain alert:', error);
        return false;
    }
}

/**
 * Command to manually check rain forecast
 * @returns {Promise<string>} Formatted rain forecast message
 */
async function getRainForecast() {
    try {
        const forecast = await checkRainForecast();
        return forecast.message;
    } catch (error) {
        console.error('❌ Error getting rain forecast:', error);
        return "Could not retrieve rain forecast information. Please try again later.";
    }
}

module.exports = {
    checkRainForecast,
    checkAndSendRainAlert,
    getRainForecast
};
