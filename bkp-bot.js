const fs = require('fs');
const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const moment = require('moment-timezone');
const axios = require('axios');

const keywordFilePath = path.join(__dirname, 'keywords.json');

function loadKeywordResponses() {
    try {
        const data = fs.readFileSync(keywordFilePath, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error loading keywords file:", err);
        return [];
    }
}

let keywordResponseMap = loadKeywordResponses();

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
                message += "*Recommendations:*\n";
                message += "• Wear sunscreen (min. SPF 30)\n";
                message += "• Seek shade during midday hours\n";
                message += "• Wear protective clothing, hat, and sunglasses\n";
            } else if (currentUVI > 0) {
                message += "*Recommendations:*\n";
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

async function sendTideDataOnce(sock, targetGroupId) {
    const now = moment().add(1, 'days');
    const startDate = now.clone().startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');
    const endDate = now.clone().add(1, 'days').startOf('day').utc().format('YYYY-MM-DDTHH:mm:ssZ');

    const lat = -6.228056;
    const lng = -35.045833;

    const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${lat}&lng=${lng}&start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': '46d9689e-effc-11ef-8c11-0242ac130003-46d96920-effc-11ef-8c11-0242ac130003', // Replace with your API key
            },
        });

        const tideData = response.data.data;
        const dateFormatted = now.tz('America/Sao_Paulo').format('DD/MM/YYYY');

        let message = `*🌊🏄‍♂️🏖️🐬 Tide Extremes for Praia de Pipa - ${dateFormatted} ☀️*\n\n`;
        message += `_This is approximate data, gathered using StormGlass API._\n\n`;

        tideData.forEach((tide) => {
            const timeUTC = moment.utc(tide.time);
            const timeSaoPaulo = timeUTC.tz('America/Sao_Paulo').format('HH:mm');
            message += `\n${tide.type}: ${timeSaoPaulo}, Height: ${tide.height.toFixed(2)}m`;
        });

        await sock.sendMessage(targetGroupId, { text: message });
        console.log('✅ Tide data sent to group "Pipa Digital Nomads"');
    } catch (error) {
        console.error('❌ Error fetching tide data:', error);
        if (error.response) {
            console.log(error.response.data);
        }
    }
}

// Schedule tide data message daily at 19:30 São Paulo time
function scheduleTideData(sock, targetGroupId) {
    let lastSentDate = null;

    setInterval(async () => {
        const now = moment().tz('America/Sao_Paulo');
        const currentTime = now.format('HH:mm');
        const currentDate = now.format('YYYY-MM-DD');

        if (currentTime === '19:30' && lastSentDate !== currentDate) {
            console.log("📅 Sending scheduled tide data...");
            await sendTideDataOnce(sock, targetGroupId);
            lastSentDate = currentDate; // Prevent duplicate sends
        }
    }, 60 * 1000); // Check every minute
}

async function getAstronomyData() {
    const now = moment().add(1, 'days');
    const date = now.clone().format('YYYY-MM-DD');
    
    const lat = -6.228056;
    const lng = -35.045833;

    const url = `https://api.stormglass.io/v2/astronomy/point?lat=${lat}&lng=${lng}&date=${date}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': '46d9689e-effc-11ef-8c11-0242ac130003-46d96920-effc-11ef-8c11-0242ac130003', // Replace with your API key
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

async function sendAstronomyDataOnce(sock, targetGroupId) {
    try {
        const astronomyMessage = await getAstronomyData();
        await sock.sendMessage(targetGroupId, { text: astronomyMessage });
        console.log('✅ Astronomy data sent to group "Pipa Digital Nomads"');
    } catch (error) {
        console.error('❌ Error sending astronomy data:', error);
    }
}

// Schedule astronomy data message daily at 19:30 São Paulo time
function scheduleAstronomyData(sock, targetGroupId) {
    let lastSentDate = null;

    setInterval(async () => {
        const now = moment().tz('America/Sao_Paulo');
        const currentTime = now.format('HH:mm');
        const currentDate = now.format('YYYY-MM-DD');

        if (currentTime === '19:30' && lastSentDate !== currentDate) {
            console.log("📅 Sending scheduled astronomy data...");
            await sendAstronomyDataOnce(sock, targetGroupId);
            lastSentDate = currentDate; // Prevent duplicate sends
        }
    }, 60 * 1000); // Check every minute
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const logger = pino({ level: 'info' });

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WhatsApp Web version v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        auth: state,
        logger,
        version,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed due to', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected successfully');

            // Fetch group ID for "Pipa Digital Nomads"
            let pipaDigitalNomadsGroupId = await getGroupId("Pipa Digital Nomads");
            console.log(`Group ID for "Pipa Digital Nomads": ${pipaDigitalNomadsGroupId}`);

            // Schedule daily tide data and astronomy data messages
            if (pipaDigitalNomadsGroupId) {
                scheduleTideData(sock, pipaDigitalNomadsGroupId);
                scheduleAstronomyData(sock, pipaDigitalNomadsGroupId); // Added astronomy data scheduling
            }

            sock.ev.on('messages.upsert', async (msg) => {
                if (msg.type === 'notify') {
                    for (const message of msg.messages) {
                        if (pipaDigitalNomadsGroupId && message.key.remoteJid === pipaDigitalNomadsGroupId && !message.key.fromMe && message.message) {
                            const messageContent = message.message.conversation || message.message.extendedTextMessage?.text;

                            if (messageContent) {
                                console.log(`📩 Received message in group "${pipaDigitalNomadsGroupId}": ${messageContent}`);

                                // Check for UV command
                                if (messageContent.trim().toLowerCase() === '!uv' || messageContent.trim().toUpperCase() === '!UV') {
                                    console.log('🔍 UV command detected! Fetching UV index...');
                                    const uvMessage = await getUVIndex();
                                    await sock.sendMessage(pipaDigitalNomadsGroupId, { text: uvMessage });
                                    continue; // Skip keyword check for this message
                                }
                                
                                // Check for astronomy command
                                if (messageContent.trim().toLowerCase() === '!astro' || messageContent.trim().toUpperCase() === '!ASTRO') {
                                    console.log('🔍 Astronomy command detected! Fetching astronomy data...');
                                    const astronomyMessage = await getAstronomyData();
                                    await sock.sendMessage(pipaDigitalNomadsGroupId, { text: astronomyMessage });
                                    continue; // Skip keyword check for this message
                                }

                                // Check for keyword groups and send the appropriate response (using regex)
                                for (const { keywords, response } of keywordResponseMap) {
                                    let matchFound = false;

                                    for (const keyword of keywords) {
                                        const regex = new RegExp(`\\b${keyword}\\b`, 'i'); // Word boundary regex, case-insensitive
                                        if (regex.test(messageContent)) {
                                            console.log(`🔍 Keyword detected! Responding with: ${response}`);
                                            await sock.sendMessage(pipaDigitalNomadsGroupId, { text: response });
                                            matchFound = true;
                                            break;
                                        }
                                    }
                                    if (matchFound) break;
                                }
                            }
                        }
                    }
                }
            });
        }
    });

    async function getGroupId(groupName) {
        try {
            const groupList = await sock.groupFetchAllParticipating();
            for (const groupId in groupList) {
                if (groupList[groupId].subject === groupName) {
                    return groupId;
                }
            }
            console.log(`🚫 Group "${groupName}" not found.`);
            return null;
        } catch (err) {
            console.error('❌ Error fetching group ID:', err);
            return null;
        }
    }
}

startBot();
