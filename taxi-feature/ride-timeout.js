const { prisma, getPrimaryIdentifier } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, activeRideTimeouts, TRANSLATIONS } = require('./constants');
const { resetConversationTimeout } = require('./conversation-timeout');
const { clearKeepaliveInterval } = require('./keepalive');

const logger = createFileLogger();

async function handleRideTimeout(sock, rideId, userJid, waitTime, language) {
  const ride = await prisma.taxiRide.findUnique({
    where: { id: rideId },
    include: { user: true }
  });

  if (!ride) {
    logger.warn(`⏰ Timeout triggered for ride ${rideId} but ride not found`);
    return;
  }

  if (ride.status !== 'pending') {
    logger.info(`⏰ Timeout triggered for ride ${rideId} but ride is already ${ride.status}`);
    return;
  }

  // Mark ride as expired (but don't delete the conversation state yet - we need it for retry)
  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'expired',
      expiredAt: new Date()
    }
  });

  // Clear the timeout and keepalive interval
  activeRideTimeouts.delete(rideId);
  clearKeepaliveInterval(rideId);

  const t = TRANSLATIONS[language];
  const retryAttempts = ride.retryAttempts || 0;

  // Send appropriate expiration message based on retry count
  const expirationMessage = retryAttempts === 0
    ? t.rideExpired(waitTime)
    : t.rideExpiredRetry(waitTime);

  await sock.sendMessage(userJid, {
    text: expirationMessage
  });

  // Set conversation timeout for retry decision
  resetConversationTimeout(sock, userJid, language);

  // Set up conversation state for retry flow
  const conversationState = await prisma.conversationState.upsert({
    where: { userJid: userJid },
    update: {
      state: 'awaiting_retry_decision',
      rideId: rideId,
      lastActivityAt: new Date()
    },
    create: {
      userJid: userJid,
      state: 'awaiting_retry_decision',
      language: language,
      vehicleType: ride.vehicleType,
      name: ride.user.name,
      phone: ride.user.phone,
      locationText: ride.locationText,
      locationLat: ride.locationLat,
      locationLng: ride.locationLng,
      destination: ride.destination,
      identifier: ride.identifier,
      waitTime: ride.waitTime,
      rideId: rideId,
      conversationStartedAt: new Date(),
      lastActivityAt: new Date(),
      isActive: true
    }
  });

  // Update active conversation
  if (!activeConversations.has(userJid)) {
    activeConversations.set(userJid, {
      state: 'awaiting_retry_decision',
      language: language,
      vehicleType: ride.vehicleType,
      userInfo: {
        name: ride.user.name,
        phone: ride.user.phone,
        locationText: ride.locationText,
        locationLat: ride.locationLat,
        locationLng: ride.locationLng,
        destination: ride.destination,
        identifier: ride.identifier,
        waitTime: ride.waitTime
      },
      rideId: rideId
    });
  } else {
    const conversation = activeConversations.get(userJid);
    conversation.state = 'awaiting_retry_decision';
    conversation.rideId = rideId;
  }

  logger.info(`⏰ Ride ${rideId} expired after ${waitTime} minutes. Awaiting retry decision from user.`);
}

async function restoreRideTimeouts(sock) {
  const now = new Date();
  let restoredCount = 0;
  let expiredCount = 0;

  const pendingRides = await prisma.taxiRide.findMany({
    where: { status: 'pending' },
    include: { user: true }
  });

  // Import needed functions
  const { activeConversations, STATES } = require('./constants');
  const { clearConversationTimeouts } = require('./conversation-timeout');

  for (const ride of pendingRides) {
    const waitTimeMinutes = parseInt(ride.waitTime, 10);
    if (isNaN(waitTimeMinutes) || waitTimeMinutes <= 0) continue;

    const expirationTime = new Date(ride.createdAt.getTime() + (waitTimeMinutes * 60 * 1000));
    const timeRemaining = expirationTime - now;

    if (timeRemaining <= 0) {
      // Expire immediately
      logger.info(`⏰ Expiring ride ${ride.id} immediately`);

      await prisma.taxiRide.update({
        where: { id: ride.id },
        data: {
          status: 'expired',
          expiredAt: now
        }
      });

      const t = TRANSLATIONS[ride.language];
      try {
        await sock.sendMessage(getPrimaryIdentifier(ride.user), {
          text: t.rideExpired(waitTimeMinutes)
        });
      } catch (error) {
        logger.error(`Failed to send expiration message:`, error);
      }

      activeConversations.delete(getPrimaryIdentifier(ride.user));
      clearConversationTimeouts(getPrimaryIdentifier(ride.user));

      expiredCount++;
    } else {
      // Reschedule
      const timeoutId = setTimeout(() => {
        handleRideTimeout(sock, ride.id, getPrimaryIdentifier(ride.user), waitTimeMinutes, ride.language);
      }, timeRemaining);

      activeRideTimeouts.set(ride.id, timeoutId);
      logger.info(`⏰ Restored ride timeout for ride ${ride.id} - will expire in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  logger.info(`🔄 Ride timeout restoration complete: ${restoredCount} restored, ${expiredCount} expired`);
}

module.exports = {
  handleRideTimeout,
  restoreRideTimeouts
};
