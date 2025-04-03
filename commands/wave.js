const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

/**
 * Fetch wave data for Praia do Madeiro (Pipa) with retry functionality
 * @param {Number} maxRetries - Maximum number of retry attempts
 * @param {Number} delayMs - Delay between retries in milliseconds
 * @returns {Promise<string>} Formatted wave data message
 */
async function getWaveData(maxRetries = 3, delayMs = 20000) {
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

                // Add wave quality rating based on conditions
                const surfQuality = getSurfQualityRating(waveHeight, wavePeriod, windSpeed);

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
    console.error('❌ All retry attempts failed');
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
 * Calculate surf quality rating based on conditions
 * @param {Number} waveHeight - Wave height in meters
 * @param {Number} wavePeriod - Wave period in seconds
 * @param {Number} windSpeed - Wind speed in m/s
 * @returns {String} Surf quality rating with emoji
 */
function getSurfQualityRating(waveHeight, wavePeriod, windSpeed) {
    // Simple algorithm to rate surf conditions
    let score = 0;
    
    // Wave height score (0.5m to 2.5m is ideal)
    if (waveHeight >= 0.5 && waveHeight <= 2.5) {
        score += 3;
    } else if (waveHeight > 2.5 && waveHeight <= 4) {
        score += 2; // Bigger waves, good for experienced surfers
    } else if (waveHeight > 0 && waveHeight < 0.5) {
        score += 1; // Too small
    } else {
        score += 0; // Too big or no data
    }
    
    // Wave period score (longer period is better)
    if (wavePeriod >= 10) {
        score += 3;
    } else if (wavePeriod >= 7) {
        score += 2;
    } else if (wavePeriod > 0) {
        score += 1;
    }
    
    // Wind speed score (less wind is better for clean waves)
    if (windSpeed < 3) {
        score += 3; // Light wind
    } else if (windSpeed < 6) {
        score += 2; // Moderate wind
    } else if (windSpeed < 10) {
        score += 1; // Strong wind
    }
    
    // Convert score to rating
    if (score >= 8) return "🟢 Excellent";
    if (score >= 6) return "🟡 Good";
    if (score >= 4) return "🟠 Fair";
    return "🔴 Poor";
}

/**
 * Send wave data to a specific chat with retry logic
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 */
async function sendWaveDataOnce(sock, chatId, maxRetries = 3, delayMs = 20000) {
    try {
        const waveMessage = await getWaveData(maxRetries, delayMs);
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
