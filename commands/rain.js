const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Check if rain is forecasted for today in Pipa starting from 6AM
 * @returns {Promise<{willRain: boolean, message: string}>} Rain forecast information
 */
async function checkRainForecast() {
    const now = moment().tz('America/Sao_Paulo');
    
    // Start from 6AM today (or current time if it's already past 6AM)
    const startTime = now.clone().hour() < 6 ? 
        now.clone().startOf('day').hour(6) : 
        now.clone();
    
    // End at midnight today
    const endTime = now.clone().endOf('day');
    
    // StormGlass API requires UTC timestamps
    const startDate = startTime.clone().utc().format('YYYY-MM-DDTHH:mm:ssZ');
    const endDate = endTime.clone().utc().format('YYYY-MM-DDTHH:mm:ssZ');
    
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
        const dateFormatted = now.format('DD/MM/YYYY');

        if (willRain) {
            // Extract times and sort them
            const rainTimes = rainHours.map(hour => {
                const timeUTC = moment.utc(hour.time);
                return {
                    momentObj: timeUTC.tz('America/Sao_Paulo'),
                    formatted: timeUTC.tz('America/Sao_Paulo').format('HH:mm'),
                    hour: timeUTC.tz('America/Sao_Paulo').hour()
                };
            }).sort((a, b) => a.hour - b.hour);

            // Group into consecutive periods
            const rainPeriods = [];
            let currentPeriod = { start: rainTimes[0], hours: [rainTimes[0]] };

            for (let i = 1; i < rainTimes.length; i++) {
                const prevHour = rainTimes[i-1].hour;
                const currentHour = rainTimes[i].hour;
                
                // If hours are consecutive
                if (currentHour === prevHour + 1) {
                    currentPeriod.hours.push(rainTimes[i]);
                } else {
                    // End the current period and start a new one
                    currentPeriod.end = rainTimes[i-1];
                    rainPeriods.push(currentPeriod);
                    currentPeriod = { start: rainTimes[i], hours: [rainTimes[i]] };
                }
            }
            
            // Add the last period
            currentPeriod.end = rainTimes[rainTimes.length - 1];
            rainPeriods.push(currentPeriod);

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

            // Calculate how many remaining hours in the day have rain
            const remainingHours = endTime.diff(startTime, 'hours');
            const rainPercentage = (rainHours.length / remainingHours) * 100;

            if (rainPercentage > 75) {
                message += `throughout most of the day.\n\n`;
            } else if (rainPercentage > 25) {
                message += `for several hours during the day.\n\n`;
            } else {
                message += `during the day.\n\n`;
            }
            
            // Format rain periods
            message += `Rain expected during these periods:\n`;
            rainPeriods.forEach((period, i) => {
                // For single hour periods
                if (period.hours.length === 1) {
                    message += `• ${period.start.formatted}`;
                } 
                // For multi-hour periods
                else {
                    message += `• ${period.start.formatted} to ${period.end.formatted}`;
                }
                
                if (i < rainPeriods.length - 1) message += "\n";
            });

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
