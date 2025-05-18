const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

/**
 * Fetch wave data for Praia do Madeiro (Pipa) with retry functionality
 * @param {Number} maxRetries - Maximum number of retry attempts
 * @param {Number} delayMs - Delay between retries in milliseconds
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds
 * @returns {Promise<string>} Formatted wave data message
 */
async function getWaveData(maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    let retryCount = 0;
    let lastError = null;

    // Retry logic
    while (retryCount <= maxRetries) {
        try {
            // Starting with tomorrow (similar to tide.js)
            const now = moment().add(1, 'days');
            const startDate = now.clone().startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
            const endDate = now.clone().endOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
            
            // Updated coordinates for Praia do Madeiro
            const lat = -6.238333;
            const lng = -35.044444;
            
            // StormGlass API endpoint for wave data
            const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=waveHeight,wavePeriod,waveDirection,windSpeed,windDirection&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
            
            const response = await axios.get(url, {
                headers: {
                    'Authorization': process.env.STORMGLASS_API_KEY,
                },
            });

            const waveData = response.data.hours;
            const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');

            let message = `*🏄‍♂️🌊 Surf Conditions for Praia do Madeiro - ${dateFormatted} 🏄‍♀️*\n\n`;
            message += `_This is approximate data, gathered using StormGlass API._\n\n`;

            // Include 5 AM with other key times of the day
            const keyHours = [5, 9, 12, 15, 18];
            const filteredData = waveData.filter(data => {
                const hour = moment.utc(data.time).tz('America/Sao_Paulo').hour();
                return keyHours.includes(hour);
            });

            filteredData.forEach(data => {
                const time = moment.utc(data.time).tz('America/Sao_Paulo').format('HH:mm');
                const waveHeight = data.waveHeight?.noaa || data.waveHeight?.sg || 'N/A';
                const wavePeriod = data.wavePeriod?.noaa || data.wavePeriod?.sg || 'N/A';
                const waveDirection = data.waveDirection?.noaa || data.waveDirection?.sg || 'N/A';
                const windSpeed = data.windSpeed?.noaa || data.windSpeed?.sg || 'N/A';
                const windDirection = data.windDirection?.noaa || data.windDirection?.sg || 'N/A';

                // Convert wave direction to cardinal direction
                const waveCardinal = getCardinalDirection(waveDirection);
                const windCardinal = getCardinalDirection(windDirection);

                // Add wave quality rating based on conditions using improved algorithm
                const surfQuality = getSurfQualityRating(waveHeight, wavePeriod, windSpeed, windDirection, waveDirection);

                message += `\n*${time}*\n`;
                message += `Wave Height: ${waveHeight.toFixed(1)}m\n`;
                message += `Wave Period: ${wavePeriod.toFixed(1)}s\n`;
                message += `Wave Direction: ${waveCardinal} (${waveDirection.toFixed(0)}°)\n`;
                message += `Wind: ${windSpeed.toFixed(1)} m/s from ${windCardinal} (${windDirection.toFixed(0)}°)\n`;
                message += `Surf Quality: ${surfQuality}\n`;
            });

            return message;
        } catch (error) {
            lastError = error;
            retryCount++;
            
            console.error(`❌ Error fetching wave data (Attempt ${retryCount}/${maxRetries}):`, error.message);
            
            if (error.response) {
                console.log('Response error data:', error.response.data);
            }
            
            // If we've reached max retries, try one more time with a longer delay
            if (retryCount > maxRetries) {
                console.log(`All regular retries failed. Attempting one final retry in 30 minutes...`);
                await new Promise(resolve => setTimeout(resolve, longRetryDelayMs));
                try {
                    // One last attempt after long delay
                    const result = await getWaveData(0, 0); // No retries on this final attempt
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
    console.error('❌ All retry attempts failed for wave data');
    return "Could not retrieve surf data. Please try again later.";
}

/**
 * Convert degrees to cardinal direction
 * @param {Number} degrees - Direction in degrees
 * @returns {String} Cardinal direction
 */
function getCardinalDirection(degrees) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N'];
    const index = Math.round(degrees / 22.5);
    return directions[index];
}

/**
 * Calculate surf quality rating based on conditions with stricter criteria
 * @param {Number} waveHeight - Wave height in meters
 * @param {Number} wavePeriod - Wave period in seconds
 * @param {Number} windSpeed - Wind speed in m/s
 * @param {Number} windDirection - Wind direction in degrees
 * @param {Number} waveDirection - Wave direction in degrees 
 * @returns {String} Surf quality rating with emoji
 */
function getSurfQualityRating(waveHeight, wavePeriod, windSpeed, windDirection, waveDirection) {
    // More sophisticated algorithm with stricter criteria
    let score = 0;
    
    // Wave height score (0.7m to 2.0m is ideal for this beach)
    if (waveHeight >= 0.7 && waveHeight <= 2.0) {
        score += 3;
    } else if ((waveHeight > 2.0 && waveHeight <= 2.5) || (waveHeight >= 0.5 && waveHeight < 0.7)) {
        score += 2; // Still decent but not ideal
    } else if ((waveHeight > 2.5 && waveHeight <= 3.5) || (waveHeight >= 0.3 && waveHeight < 0.5)) {
        score += 1; // Borderline conditions
    } else {
        score += 0; // Either too big (>3.5m) or too small (<0.3m)
    }
    
    // Wave period score (longer period is better, but with higher minimum thresholds)
    if (wavePeriod >= 12) {
        score += 5; // Excellent period
    } else if (wavePeriod >= 9) {
        score += 3; // Good period
    } else if (wavePeriod >= 6) {
        score += 1; // Acceptable period
    } else {
        score += 0; // Poor period, too choppy
    }
    
    // Wind speed score (much stricter thresholds)
    if (windSpeed < 2) {
        score += 3; // Very light wind - great conditions
    } else if (windSpeed < 4) {
        score += 2; // Light wind - good conditions
    } else if (windSpeed < 7) {
        score += 1; // Moderate wind - affecting quality
    } else {
        score += 0; // Strong wind - poor conditions
    }
    
    // Wind direction relative to wave direction (new factor)
    // Calculate if the wind is offshore, cross-shore, or onshore
    const angleDiff = calculateAngleDifference(windDirection, waveDirection);
    
    if (angleDiff >= 135 && angleDiff <= 225) {
        score += 3; // Offshore wind (ideal)
    } else if ((angleDiff >= 90 && angleDiff < 135) || (angleDiff > 225 && angleDiff <= 270)) {
        score += 2; // Cross-offshore wind (good)
    } else if ((angleDiff >= 45 && angleDiff < 90) || (angleDiff > 270 && angleDiff <= 315)) {
        score += 1; // Cross-shore wind (acceptable)
    } else {
        score += 0; // Onshore wind (poor)
    }
    
    // Convert score to rating with higher thresholds
    if (score >= 10) return "🟢 Excellent";
    if (score >= 8) return "🟡 Good";
    if (score >= 6) return "🟠 Fair";
    return "🔴 Poor";
}

/**
 * Calculate the angle difference between wind and wave directions
 * @param {Number} windDirection - Wind direction in degrees
 * @param {Number} waveDirection - Wave direction in degrees
 * @returns {Number} Angle difference in degrees (0-360)
 */
function calculateAngleDifference(windDirection, waveDirection) {
    // Calculate the absolute difference between wind and wave directions
    let angleDiff = Math.abs(windDirection - waveDirection);
    
    // Ensure the angle is the smallest one (never more than 180 degrees)
    if (angleDiff > 180) {
        angleDiff = 360 - angleDiff;
    }
    
    // For surf conditions, we want to know if wind is offshore (180° difference from wave direction)
    // Return the wind direction relative to wave direction
    return (windDirection + 180) % 360;
}

/**
 * Send wave data to a specific chat with retry logic
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds (default: 30 minutes)
 */
async function sendWaveDataOnce(sock, chatId, maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    try {
        const waveMessage = await getWaveData(maxRetries, delayMs, longRetryDelayMs);
        await sock.sendMessage(chatId, { text: waveMessage });
        console.log('✅ Wave data sent successfully');
    } catch (error) {
        console.error('❌ Error sending wave data:', error);
    }
}

module.exports = {
    getWaveData,
    sendWaveDataOnce
};
