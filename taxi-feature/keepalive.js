const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { keepaliveIntervals, KEEPALIVE_INTERVAL, TRANSLATIONS } = require('./constants');

const logger = createFileLogger();

function scheduleKeepaliveMessages(sock, rideId, passengerJid, language) {
  logger.info(`⏰ Scheduling keepalive messages for ride ${rideId} every 6 minutes`);

  const t = TRANSLATIONS[language] || TRANSLATIONS['en'];

  // Send keepalive message every 6 minutes
  const intervalId = setInterval(async () => {
    try {
      // Check if ride is still pending before sending
      const ride = await prisma.taxiRide.findUnique({
        where: { id: rideId },
        select: { status: true }
      });

      if (!ride || ride.status !== 'pending') {
        logger.info(`⏰ Ride ${rideId} is no longer pending, stopping keepalive messages`);
        clearKeepaliveInterval(rideId);
        return;
      }

      await sock.sendMessage(passengerJid, {
        text: t.keepalive
      });
      logger.info(`✅ Sent keepalive message to passenger for ride ${rideId}`);
    } catch (error) {
      logger.error(`❌ Failed to send keepalive message for ride ${rideId}:`, error);
    }
  }, KEEPALIVE_INTERVAL);

  keepaliveIntervals.set(rideId, intervalId);
  logger.info(`⏰ Keepalive messages scheduled for ride ${rideId}`);
}

function clearKeepaliveInterval(rideId) {
  const intervalId = keepaliveIntervals.get(rideId);
  if (intervalId) {
    clearInterval(intervalId);
    keepaliveIntervals.delete(rideId);
    logger.info(`⏰ Cleared keepalive interval for ride ${rideId}`);
  }
}

module.exports = {
  scheduleKeepaliveMessages,
  clearKeepaliveInterval
};
