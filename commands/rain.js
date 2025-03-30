const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Check if rain is forecasted for today in Pipa starting from 6AM
 * @param {Number} maxRetries - Maximum number of retry attempts
 * @param {Number} delayMs - Delay between retries in milliseconds
 * @returns {Promise<{willRain: boolean, heavyRain: boolean, message: string}>} Rain forecast information
 */
async function checkRainForecast(maxRetries = 3, delayMs = 20000) {
    let retryCount = 0;
    let lastError = null;
    
    // Retry logic
    while (retryCount <= maxRetries) {
        try {
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
            
            const response = await axios.get(url, {
                headers: {
                    'Authorization': '04f5362a-eff6-11ef-85cb-0242ac130003-04f53684-eff6-11ef-85cb-0242ac130003',
                },
            });

            const hourlyData = response.data.hours;

            // Calculate total precipitation sum for the day
            let totalPrecipitation = 0;
            const rainHours = hourlyData.filter(hour => {
                // Average the precipitation sources or use the most reliable one
                const precipValues = Object.values(hour.precipitation);
                const avgPrecip = precipValues.reduce((sum, val) => sum + val, 0) / precipValues.length;
                totalPrecipitation += avgPrecip;
                return avgPrecip > 0.2; // 0.2mm is a common threshold for measurable rain
            });

            const willRain = rainHours.length > 0;
            // Check if it's heavy rain (more than 20mm total for the day)
            const heavyRain = totalPrecipitation > 20;
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
                message += `Total precipitation: ${totalPrecipitation.toFixed(1)}mm\n`;
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
                    heavyRain,
                    message
                };
            } else {
                return {
                    willRain: false,
                    heavyRain: false,
                    message: `No rain is forecasted for Pipa today (${dateFormatted}). Enjoy your day! ☀️`
                };
            }
        } catch (error) {
            lastError = error;
            retryCount++;
            
            console.error(`❌ Error checking rain forecast (Attempt ${retryCount}/${maxRetries}):`, error.message);
            
            if (error.response) {
                console.log('Response error data:', error.response.data);
            }
            
            // If we've reached max retries, break out of the loop
            if (retryCount > maxRetries) {
                break;
            }
            
            // Wait before trying again
            console.log(`Waiting ${delayMs/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    
    // If we got here, all retries failed
    console.error('❌ All retry attempts failed for rain forecast');
    return {
        willRain: false,
        heavyRain: false,
        message: "Could not retrieve rain forecast. Please try again later."
    };
}

/**
 * Check and send rain forecast if it will rain heavily today (>20mm)
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Boolean} forceSend - Send message regardless of rain forecast (for testing)
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 * @returns {Promise<Boolean>} Whether a message was sent
 */
async function checkAndSendRainAlert(sock, chatId, forceSend = false, maxRetries = 3, delayMs = 20000) {
    try {
        const forecast = await checkRainForecast(maxRetries, delayMs);

        // Only send if heavy rain (>20mm) is predicted or if forceSend is true
        if ((forecast.willRain && forecast.heavyRain) || forceSend) {
            await sock.sendMessage(chatId, { text: forecast.message });
            console.log('✅ Rain alert sent successfully');
            return true;
        } else if (forecast.willRain) {
            console.log('🌦️ Rain forecasted but below 20mm threshold, no alert sent');
            return false;
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
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 * @returns {Promise<string>} Formatted rain forecast message
 */
async function getRainForecast(maxRetries = 3, delayMs = 20000) {
    try {
        const forecast = await checkRainForecast(maxRetries, delayMs);
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
