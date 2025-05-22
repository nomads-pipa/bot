const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const moment = require('moment-timezone');
require('dotenv').config();

const { 
    loadKeywordResponses, 
    generateWelcomeMessage 
} = require('./utils/keyword-manager');
const { setupSchedulers } = require('./schedulers');
const { createFileLogger } = require('./utils/file-logger');
const { initNatalTransfer, processNatalTransferMessage, isNatalTransferMessage } = require('./utils/natal-transfer');

// Initialize our custom logger (will use LOG_DIRECTORY from .env if available)
const logger = createFileLogger();
logger.info(`Logger initialized. Writing logs to: ${logger.getLogDirectory()}`);

// Load keyword responses from the JSON file
let keywordResponseMap = loadKeywordResponses();

// Store recent responses with timestamps
const recentResponses = new Map();

// Throttle period in milliseconds (6 hours)
const THROTTLE_PERIOD = 6 * 60 * 60 * 1000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const pinoLogger = pino({ level: 'info' });

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using WhatsApp Web version v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        auth: state,
        logger: pinoLogger,
        version,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            logger.error('Connection closed due to', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            logger.info('✅ Connected successfully');

            // Initialize the Natal transfer module
            await initNatalTransfer();
            logger.info('✅ Natal transfer module initialized');

            // Get group names from environment variable
            const groupNames = getGroupNamesFromEnv();
            
            if (groupNames.length === 0) {
                logger.warn('⚠️ No group names found in GROUP_NAMES environment variable');
                return;
            }
            
            logger.info(`📋 Target groups: ${groupNames.join(', ')}`);
            
            // Map of group names to their IDs
            const groupMap = await getGroupIds(sock, groupNames);
            
            // Setup all scheduled tasks for each group
            for (const [groupName, groupId] of Object.entries(groupMap)) {
                if (groupId) {
                    logger.info(`✅ Group "${groupName}" found with ID: ${groupId}`);
                    
                    // For backward compatibility, check if this is the Pipa Digital Nomads group
                    if (groupName === "Pipa Digital Nomads") {
                        setupSchedulers(sock, groupId);
                    }
                    
                    // Set up group participant handler for all groups
                    setupGroupParticipantHandler(sock, groupId);
                } else {
                    logger.warn(`🚫 Group "${groupName}" not found`);
                }
            }

            // Set up message handler for all groups
            setupMessageHandler(sock, groupMap);
        }
    });

    return sock; // Return the socket instance
}

function getGroupNamesFromEnv() {
    // Get group names from environment variable and trim whitespace
    const groupNamesStr = process.env.GROUP_NAMES || '';
    
    if (!groupNamesStr) {
        return [];
    }
    
    return groupNamesStr.split(',').map(name => name.trim()).filter(name => name !== '');
}

async function getGroupIds(sock, groupNames) {
    const groupMap = {};
    
    try {
        const groupList = await sock.groupFetchAllParticipating();
        
        for (const groupName of groupNames) {
            let found = false;
            
            for (const groupId in groupList) {
                if (groupList[groupId].subject === groupName) {
                    groupMap[groupName] = groupId;
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                groupMap[groupName] = null;
            }
        }
        
        return groupMap;
    } catch (err) {
        logger.error('❌ Error fetching group IDs:', err);
        return groupNames.reduce((acc, name) => {
            acc[name] = null;
            return acc;
        }, {});
    }
}

function setupGroupParticipantHandler(sock, groupId) {
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;

        // Check if the event is for one of our monitored groups
        if (id === groupId && (action === 'add')) {
            for (const participant of participants) {
                try {
                    // Generate welcome message
                    const welcomeMessage = generateWelcomeMessage(participant.split('@')[0]);

                    // Send welcome message mentioning the new participant
                    await sock.sendMessage(groupId, { 
                        text: welcomeMessage,
                        mentions: [participant]
                    });

                    logger.info(`✅ Sent welcome message to new participant: ${participant} in group: ${id}`);
                } catch (err) {
                    logger.error(`❌ Error sending welcome message to ${participant} in group ${id}:`, err);
                }
            }
        }
    });
}

function setupMessageHandler(sock, groupMap) {
    // Create a Set of group IDs for faster lookups
    const groupIds = new Set(Object.values(groupMap).filter(id => id !== null));
    
    sock.ev.on('messages.upsert', async (msg) => {
        if (msg.type === 'notify') {
            for (const message of msg.messages) {
                const remoteJid = message.key.remoteJid;
                
                // Check if this is a message from one of our monitored groups
                if (groupIds.has(remoteJid) && !message.key.fromMe && message.message) {
                    const messageContent = message.message.conversation || 
                                         message.message.extendedTextMessage?.text;
                    const sender = message.key.participant || message.key.remoteJid;

                    if (messageContent) {
                        // Find which group this is
                        const groupName = Object.keys(groupMap).find(name => groupMap[name] === remoteJid);
                        logger.info(`📩 Received message in group "${groupName}": ${messageContent}`);

                        // First check if this is a Natal transfer message
                        const isNatalTransfer = await processNatalTransferMessage(sock, messageContent, sender, remoteJid);
                        
                        // If not a Natal transfer message, check for other keyword matches
                        if (!isNatalTransfer) {
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
                                    // Create a unique key for the response in this specific group
                                    const responseKey = `${remoteJid}:${response}`;
                                    
                                    // Check if this response was sent in the last 6 hours in this group
                                    if (recentResponses.has(responseKey)) {
                                        const lastSent = recentResponses.get(responseKey);
                                        const timeSince = now - lastSent;
                                        
                                        if (timeSince < THROTTLE_PERIOD) {
                                            // Skip if sent within the throttle period
                                            logger.info(`Not sending "${response}" to group "${groupName}" - last sent ${Math.round(timeSince / (60 * 1000))} minutes ago`);
                                            break;
                                        }
                                    }
                                    
                                    // Send response and record the current time
                                    await sock.sendMessage(remoteJid, { text: response });
                                    recentResponses.set(responseKey, now);
                                    logger.info(`🔍 Keyword matched in group "${groupName}"! Sent response: ${response}`);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}

module.exports = { startBot };
