const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

/**
 * Fetch astronomy data for Pipa with retry functionality
 * @param {Number} maxRetries - Maximum number of retry attempts
 * @param {Number} delayMs - Delay between retries in milliseconds
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds
 * @returns {Promise<string>} Formatted astronomy data message
 */
async function getAstronomyData(maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    let retryCount = 0;
    let lastError = null;
    
    // Retry logic
    while (retryCount <= maxRetries) {
        try {
            const now = moment().add(1, 'days');
            const date = now.clone().format('YYYY-MM-DD');

            const lat = -6.228056;
            const lng = -35.045833;

            const url = `https://api.stormglass.io/v2/astronomy/point?lat=${lat}&lng=${lng}&date=${date}`;

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

            // Variables to track special full moon message conditions
            let isFullMoon = false;
            let moonriseInSpecialTimeRange = false;
            let moonriseTime = '';

            // Moonrise, moonset, and moon phase
            if (astronomyData[0].moonrise && astronomyData[0].moonPhase) {
                moonriseTime = moment.utc(astronomyData[0].moonrise).tz('America/Sao_Paulo').format('HH:mm');
                const moonriseHour = parseInt(moonriseTime.split(':')[0]);

                // Add moonset if available
                let moonsetInfo = "";
                if (astronomyData[0].moonset) {
                    const moonsetTime = moment.utc(astronomyData[0].moonset).tz('America/Sao_Paulo').format('HH:mm');
                    moonsetInfo = `🌃 Moonset: ${moonsetTime}\n`;
                }

                // Get moon phase using the value instead of text
                const moonPhaseValue = astronomyData[0].moonPhase.current.value;
                const moonPhaseInfo = getMoonPhaseFromValue(moonPhaseValue);
                
                // Check if it's a full moon
                isFullMoon = moonPhaseInfo.name === 'Full Moon';
                // Check if moonrise is between 17:00-18:00
                moonriseInSpecialTimeRange = (moonriseHour >= 17 && moonriseHour < 19);

                message += `*Moon:*\n`;
                message += `🌜 Moonrise: ${moonriseTime}\n`;
                message += moonsetInfo;
                message += `🌙 Moon Phase: ${moonPhaseInfo.name} ${moonPhaseInfo.emoji}\n`;

                // Add illumination if available
                if (astronomyData[0].moonPhase.current.illumination) {
                    const illumination = (astronomyData[0].moonPhase.current.illumination * 100).toFixed(0);
                    message += `✨ Illumination: ${illumination}%\n`;
                }
            }

            // Check if we should add a special message for full moon at Chapadão
            if (isFullMoon && moonriseInSpecialTimeRange) {
                message += `\n\n*🌕 Special Event: Full Moon Rising! 🌕*\n`;
                message += `Good conditions for a nice Moonrise at Chapadão! Moon will be rising ${moonriseTime}. Grab a nice drink and a joint and head there!\n`;
            }

            return {
                message,
                isSpecialFullMoon: isFullMoon && moonriseInSpecialTimeRange
            };
        } catch (error) {
            lastError = error;
            retryCount++;
            
            console.error(`❌ Error fetching astronomy data (Attempt ${retryCount}/${maxRetries}):`, error.message);
            
            if (error.response) {
                console.log('Response error data:', error.response.data);
            }
            
            // If we've reached max retries, try one more time with a longer delay
            if (retryCount > maxRetries) {
                console.log(`All regular retries failed. Attempting one final retry in 30 minutes...`);
                await new Promise(resolve => setTimeout(resolve, longRetryDelayMs));
                try {
                    // One last attempt after long delay
                    const result = await getAstronomyData(0, 0); // No retries on this final attempt
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
    console.error('❌ All retry attempts failed for astronomy data');
    return {
        message: "Could not retrieve astronomy data. Please try again later.",
        isSpecialFullMoon: false
    };
}

/**
 * Determine moon phase based on numerical value with simplified names
 * @param {Number} value - Moon phase value between 0.0 and 1.0
 * @returns {Object} Moon phase information with name and emoji
 */
function getMoonPhaseFromValue(value) {
    // Normalize the value to be between 0 and 1
    const normalizedValue = ((value % 1) + 1) % 1;
    
    // Define phase ranges and corresponding information with simpler names
    if (normalizedValue >= 0.97 || normalizedValue < 0.03) {
        return { name: 'New Moon', emoji: '🌑' };
    } else if (normalizedValue >= 0.03 && normalizedValue < 0.22) {
        return { name: 'Crescent Moon', emoji: '🌒' };
    } else if (normalizedValue >= 0.22 && normalizedValue < 0.28) {
        return { name: 'First Quarter', emoji: '🌓' };
    } else if (normalizedValue >= 0.28 && normalizedValue < 0.47) {
        return { name: 'Growing Moon', emoji: '🌔' };
    } else if (normalizedValue >= 0.47 && normalizedValue < 0.53) {
        return { name: 'Full Moon', emoji: '🌕' };
    } else if (normalizedValue >= 0.53 && normalizedValue < 0.72) {
        return { name: 'Shrinking Moon', emoji: '🌖' };
    } else if (normalizedValue >= 0.72 && normalizedValue < 0.78) {
        return { name: 'Last Quarter', emoji: '🌗' };
    } else if (normalizedValue >= 0.78 && normalizedValue < 0.97) {
        return { name: 'Crescent Moon', emoji: '🌘' };
    } else {
        // Fallback in case of unexpected values
        return { name: `Moon Phase (${normalizedValue.toFixed(2)})`, emoji: '🌙' };
    }
}

/**
 * Send astronomy data to a specific chat with retry logic
 * @param {Object} sock - WhatsApp socket connection
 * @param {String} chatId - Chat ID to send the message to
 * @param {Number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {Number} delayMs - Delay between retries in milliseconds (default: 20 seconds)
 * @param {Number} longRetryDelayMs - Longer delay for special retry case in milliseconds (default: 30 minutes)
 */
async function sendAstronomyDataOnce(sock, chatId, maxRetries = 3, delayMs = 20000, longRetryDelayMs = 1800000) {
    try {
        const result = await getAstronomyData(maxRetries, delayMs, longRetryDelayMs);
        await sock.sendMessage(chatId, { text: result.message });
        console.log('✅ Astronomy data sent successfully');
        
        // Log if it's a special full moon event
        if (result.isSpecialFullMoon) {
            console.log('✨ Special full moon event detected!');
        }
    } catch (error) {
        console.error('❌ Error sending astronomy data:', error);
    }
}

module.exports = {
    getAstronomyData,
    sendAstronomyDataOnce
};
