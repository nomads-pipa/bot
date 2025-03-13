const axios = require('axios');
const moment = require('moment-timezone');

/**
 * Fetch wave data for Praia do Madeiro (Pipa)
 * @returns {Promise<string>} Formatted wave data message
 */
async function getWaveData() {
    // Starting with tomorrow (similar to tide.js)
    const now = moment().add(1, 'days');
    const startDate = now.clone().startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
    const endDate = now.clone().endOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
    
    // Updated coordinates for Praia do Madeiro
    const lat = -6.238333;
    const lng = -35.044444;
    
    // StormGlass API endpoint for wave data
    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lng}&params=waveHeight,wavePeriod,waveDirection,windSpeed,windDirection&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': '46d9689e-effc-11ef-8c11-0242ac130003-46d96920-effc-11ef-8c11-0242ac130003',
            },
        });
        
        const waveData = response.data.hours;
        const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');
        
        let message = `*🏄‍♂️🌊 Surf Conditions for Praia do Madeiro - ${dateFormatted} 🏄‍♀️*\n\n`;
        message += `_This is approximate data, gathered using StormGlass API._\n\n`;
        
        // Filter for key times of the day (morning, noon, afternoon, evening)
        const keyHours = [9, 12, 15, 18];
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
        console.error('❌ Error fetching wave data:', error);
        if (error.response) {
            console.log(error.response.data);
        }
        return "Could not retrieve surf data. Please try again later.";
    }
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
 * Send wave data to a specific chat
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 */
async function sendWaveDataOnce(sock, chatId) {
    try {
        const waveMessage = await getWaveData();
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
