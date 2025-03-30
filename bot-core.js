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

// Store recent responses with timestamps
const recentResponses = new Map();

// Throttle period in milliseconds (6 hours)
const THROTTLE_PERIOD = 6 * 60 * 60 * 1000;

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

                        // Check for keyword matches
                        for (const { keywords, response } of keywordResponseMap) {
                            let matched = false;
                            
                            // Check if any keyword matches
                            for (const keyword of keywords) {
                                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                                if (regex.test(messageContent)) {
                                    matched = true;
                                    break;
                                }
                            }
                            
                            if (matched) {
                                const now = Date.now();
                                
                                // Check if this response was sent in the last 6 hours
                                if (recentResponses.has(response)) {
                                    const lastSent = recentResponses.get(response);
                                    const timeSince = now - lastSent;
                                    
                                    if (timeSince < THROTTLE_PERIOD) {
                                        // Skip if sent within the throttle period
                                        console.log(`Not sending "${response}" - last sent ${Math.round(timeSince / (60 * 1000))} minutes ago`);
                                        break;
                                    }
                                }
                                
                                // Send response and record the current time
                                await sock.sendMessage(pipaDigitalNomadsGroupId, { text: response });
                                recentResponses.set(response, now);
                                console.log(`🔍 Keyword matched! Sent response: ${response}`);
                                break;
                            }
                        }
                    }
                }
            }
        }
    });
}

module.exports = { startBot };
