const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const moment = require('moment-timezone');

const { getUVIndex } = require('./commands/uv');
const { getAstronomyData } = require('./commands/astro');
const { loadKeywordResponses } = require('./utils/keyword-manager');
const { setupSchedulers } = require('./schedulers');

// Load keyword responses from the JSON file
let keywordResponseMap = loadKeywordResponses();

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
            let pipaDigitalNomadsGroupId = await getGroupId(sock, "Pipa Digital Nomads");
            console.log(`Group ID for "Pipa Digital Nomads": ${pipaDigitalNomadsGroupId}`);

            // Setup all scheduled tasks
            if (pipaDigitalNomadsGroupId) {
                setupSchedulers(sock, pipaDigitalNomadsGroupId);
            }

            // Set up message handler
            setupMessageHandler(sock, pipaDigitalNomadsGroupId);
        }
    });

    return sock; // Return the socket instance
}

async function getGroupId(sock, groupName) {
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

function setupMessageHandler(sock, pipaDigitalNomadsGroupId) {
    sock.ev.on('messages.upsert', async (msg) => {
        if (msg.type === 'notify') {
            for (const message of msg.messages) {
                if (pipaDigitalNomadsGroupId && 
                    message.key.remoteJid === pipaDigitalNomadsGroupId && 
                    !message.key.fromMe && 
                    message.message) {
                    
                    const messageContent = message.message.conversation || 
                                         message.message.extendedTextMessage?.text;

                    if (messageContent) {
                        console.log(`📩 Received message in group: ${messageContent}`);

                        // Check for UV command
                        if (messageContent.trim().toLowerCase() === '!uv' || 
                            messageContent.trim().toUpperCase() === '!UV') {
                            console.log('🔍 UV command detected! Fetching UV index...');
                            const uvMessage = await getUVIndex();
                            await sock.sendMessage(pipaDigitalNomadsGroupId, { text: uvMessage });
                            continue; // Skip keyword check for this message
                        }

                        // Check for astronomy command
                        if (messageContent.trim().toLowerCase() === '!astro' || 
                            messageContent.trim().toUpperCase() === '!ASTRO') {
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

module.exports = { startBot };
