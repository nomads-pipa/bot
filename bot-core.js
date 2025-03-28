const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const moment = require('moment-timezone');

const { 
    loadKeywordResponses, 
    generateWelcomeMessage 
} = require('./utils/keyword-manager');
const { setupSchedulers } = require('./schedulers');

// Load keyword responses from the JSON file
let keywordResponseMap = loadKeywordResponses();

// Store recent responses to prevent spam
const recentResponses = new Map();

function isResponseThrottled(keyword, response) {
    const now = Date.now();
    const key = `${keyword}-${response}`;
    
    // Check if the response exists and is within 4 hours
    if (recentResponses.has(key)) {
        const lastResponseTime = recentResponses.get(key);
        if (now - lastResponseTime < 4 * 60 * 60 * 1000) {
            return true; // Throttled
        }
    }
    
    // Update or add the response time
    recentResponses.set(key, now);
    return false;
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
            let pipaDigitalNomadsGroupId = await getGroupId(sock, "Pipa Digital Nomads");
            console.log(`Group ID for "Pipa Digital Nomads": ${pipaDigitalNomadsGroupId}`);

            // Setup all scheduled tasks
            if (pipaDigitalNomadsGroupId) {
                setupSchedulers(sock, pipaDigitalNomadsGroupId);
                
                // Set up group participant handler
                setupGroupParticipantHandler(sock, pipaDigitalNomadsGroupId);
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

function setupGroupParticipantHandler(sock, pipaDigitalNomadsGroupId) {
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;

        // Check if the event is for the Pipa Digital Nomads group
        if (id === pipaDigitalNomadsGroupId && (action === 'add')) {
            for (const participant of participants) {
                try {
                    // Generate welcome message
                    const welcomeMessage = generateWelcomeMessage(participant.split('@')[0]);

                    // Send welcome message mentioning the new participant
                    await sock.sendMessage(pipaDigitalNomadsGroupId, { 
                        text: welcomeMessage,
                        mentions: [participant]
                    });

                    console.log(`✅ Sent welcome message to new participant: ${participant}`);
                } catch (err) {
                    console.error(`❌ Error sending welcome message to ${participant}:`, err);
                }
            }
        }
    });
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

                        // Check for keyword groups and send the appropriate response (using regex)
                        for (const { keywords, response } of keywordResponseMap) {
                            let matchFound = false;

                            for (const keyword of keywords) {
                                const regex = new RegExp(`\\b${keyword}\\b`, 'i'); // Word boundary regex, case-insensitive
                                if (regex.test(messageContent)) {
                                    // Check if this response has been sent recently
                                    if (!isResponseThrottled(keyword, response)) {
                                        console.log(`🔍 Keyword detected! Responding with: ${response}`);
                                        await sock.sendMessage(pipaDigitalNomadsGroupId, { text: response });
                                        matchFound = true;
                                        break;
                                    } else {
                                        console.log(`🚫 Throttled response for keyword: ${keyword}`);
                                    }
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
