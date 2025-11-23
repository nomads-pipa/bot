const { PrismaClient } = require('@prisma/client');
const { createFileLogger } = require('./file-logger');
const logger = createFileLogger();

const prisma = new PrismaClient();

const CHATGPT_WHATSAPP = '18002428478@s.whatsapp.net';

const NATAL_KEYWORDS = ['Natal'];

function isNatalTransferMessage(message) {
  const lowerMsg = message.toLowerCase();
  return NATAL_KEYWORDS.some(keyword => lowerMsg.includes(keyword.toLowerCase()));
}

async function processNatalTransferMessage(sock, message, sender, groupId, incomingPushName) {
  try {
    // Handle the !natal command directly
    if (message.toLowerCase().trim() === '!natal') {
      await handleNatalCommand(sock, groupId);
      return true;
    }

    if (!isNatalTransferMessage(message)) {
      return false;
    }

    logger.info(`Detected potential Natal transfer message from ${sender}: ${message}`);

    const parsedRide = await askChatGPT(sock, `Parse this message and organize. check the intention.\n\nIf it's affirmative (someone offering a ride, saying that they are arriving in Natal or Pipa), organize the date in a structured format like this example:\n{ "user": "User Name", "direction": "To Airport or From Airport", "datetime": "YYYY-MM-DDTHH:MM:SS", "original_msg": "original message" }\n\nIf it's a question (someone asking for a ride), respond with "question intention".\n\nMessage: "${message}"`);

    logger.info(`ChatGPT parsed response: ${parsedRide}`);

    if (parsedRide.includes('question intention')) {
      logger.info(`Detected question intention from ${sender}, not showing board`);
      return false;
    } else {
      try {
        const jsonMatch = parsedRide.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const rideInfo = JSON.parse(jsonMatch[0]);

          // Normalize direction
          if (rideInfo.direction.toLowerCase().includes('to airport') || rideInfo.direction.toLowerCase().includes('to natal')) {
              rideInfo.direction = 'toAirport';
          } else if (rideInfo.direction.toLowerCase().includes('from airport') || rideInfo.direction.toLowerCase().includes('from natal')) {
              rideInfo.direction = 'fromAirport';
          }

          let actualUserName = incomingPushName && incomingPushName.length > 0
            ? incomingPushName
            : 'Unknown User';

          if (!rideInfo.user || rideInfo.user === "User Name") {
            rideInfo.user = actualUserName;
          }

          delete rideInfo.phoneNumber;

          if (rideInfo.direction === 'toAirport' || rideInfo.direction === 'fromAirport') {
            // Get or create user
            const user = await prisma.user.upsert({
              where: { jid: sender },
              update: { name: rideInfo.user },
              create: {
                jid: sender,
                name: rideInfo.user
              }
            });

            // Create natal ride
            await prisma.natalRide.create({
              data: {
                direction: rideInfo.direction,
                datetime: new Date(rideInfo.datetime),
                originalMsg: rideInfo.original_msg || message,
                userId: user.id
              }
            });

            // Format direction for display
            const displayDirection = rideInfo.direction === 'toAirport' ? 'To Natal' : 'From Natal';

            // Confirm ride registration
            await sock.sendMessage(groupId, {
              text: `✅ @${sender.split('@')[0]}'s ride has been registered!\n\n*Direction:* ${displayDirection}\n*Date/Time:* ${formatDateTime(rideInfo.datetime)}\n\nPeople looking for similar rides will be able to find you. Type !natal to check all rides`,
              mentions: [sender]
            });

            logger.info(`Registered new ride from ${rideInfo.user}: ${displayDirection} on ${rideInfo.datetime}`);
            return true;
          } else {
              logger.warn(`Unknown ride direction parsed: ${rideInfo.direction}. Not saving ride.`);
              return false;
          }
        } else {
          logger.warn(`Failed to parse JSON from ChatGPT response: ${parsedRide}`);
          return false;
        }
      } catch (parseError) {
        logger.error(`Error parsing ride info from ChatGPT response: ${parseError}`);
        return false;
      }
    }
  } catch (error) {
    logger.error(`Error processing Natal transfer message: ${error}`);
    return false;
  }
}

async function askChatGPT(sock, message) {
  return new Promise((resolve, reject) => {
    let responseTimeout;

    function responseHandler(msg) {
      if (msg.type === 'notify') {
        for (const message of msg.messages) {
          if (message.key.remoteJid === CHATGPT_WHATSAPP && !message.key.fromMe) {
            const responseText = message.message.conversation ||
                                 message.message.extendedTextMessage?.text || '';

            if (responseText) {
              clearTimeout(responseTimeout);
              sock.ev.off('messages.upsert', responseHandler);
              resolve(responseText);
              return;
            }
          }
        }
      }
    }

    sock.ev.on('messages.upsert', responseHandler);

    sock.sendMessage(CHATGPT_WHATSAPP, { text: message })
      .catch(err => {
        sock.ev.off('messages.upsert', responseHandler);
        reject(err);
      });

    responseTimeout = setTimeout(() => {
      sock.ev.off('messages.upsert', responseHandler);
      reject(new Error('Timeout waiting for ChatGPT response'));
    }, 30000);
  });
}

function formatDateTime(dateStr) {
  try {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[date.getDay()];

    return `${dayName}, ${date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })}`;
  } catch (error) {
    logger.error(`Error formatting date ${dateStr}: ${error}`);
    return dateStr;
  }
}

function displayUserName(ride) {
  if (ride.user && ride.user.name && ride.user.name !== "User Name" && ride.user.name.length > 0) {
    return ride.user.name;
  }
  return "Unknown User";
}

async function handleNatalCommand(sock, groupId) {
  try {
    // Cleanup is now handled by database queries (no old records returned)
    const now = new Date();

    // Get all future natal rides with user info
    const natalRides = await prisma.natalRide.findMany({
      where: {
        datetime: {
          gt: now
        }
      },
      include: {
        user: true
      },
      orderBy: {
        datetime: 'asc'
      }
    });

    // Separate by direction
    const toNatalRides = natalRides.filter(ride => ride.direction === 'toAirport');
    const fromNatalRides = natalRides.filter(ride => ride.direction === 'fromAirport');

    // Collect all user JIDs for mentions
    const mentions = [];

    // Construct the message
    let message = "*🚕 Upcoming Natal Rides*\n\n";

    // Add "From Pipa to Natal" rides
    if (toNatalRides.length > 0) {
      message += "*🏝 From Pipa to Natal:*\n";
      toNatalRides.forEach(ride => {
        if (ride.user && ride.user.jid) {
          message += `• ${formatDateTime(ride.datetime)} - @${ride.user.jid.split('@')[0]}\n`;
          mentions.push(ride.user.jid);
        } else {
          message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)}\n`;
        }
      });
      message += "\n";
    } else {
      message += "*🏝 From Pipa to Natal:* No upcoming rides\n\n";
    }

    // Add "From Natal to Pipa" rides
    if (fromNatalRides.length > 0) {
      message += "*🌆 From Natal to Pipa:*\n";
      fromNatalRides.forEach(ride => {
        if (ride.user && ride.user.jid) {
          message += `• ${formatDateTime(ride.datetime)} - @${ride.user.jid.split('@')[0]}\n`;
          mentions.push(ride.user.jid);
        } else {
          message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)}\n`;
        }
      });
    } else {
      message += "*🌆 From Natal to Pipa:* No upcoming rides";
    }

    message += "\n\nTo offer a ride, simply share your travel plans in the group.";
    message += "\nTo search for rides, just ask something like 'Anyone going to Natal tomorrow?'";

    // Send the compiled message
    await sock.sendMessage(groupId, {
      text: message,
      mentions: mentions
    });
    logger.info(`Sent all upcoming rides to group: ${groupId}`);

    return true;
  } catch (error) {
    logger.error(`Error handling !natal command: ${error}`);
    return false;
  }
}

async function cleanupOldRides() {
  const oneDayAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));

  const deleted = await prisma.natalRide.deleteMany({
    where: {
      datetime: {
        lt: oneDayAgo
      }
    }
  });

  if (deleted.count > 0) {
    logger.info(`🧹 Cleaned up ${deleted.count} old natal rides`);
  }
}

async function initNatalTransfer() {
  logger.info('Natal transfer module initialized with database');
}

module.exports = {
  initNatalTransfer,
  processNatalTransferMessage,
  isNatalTransferMessage,
  handleNatalCommand,
  cleanupOldRides
};
