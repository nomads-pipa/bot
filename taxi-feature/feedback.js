const { prisma, getPrimaryIdentifier } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { feedbackTimeouts, FEEDBACK_DELAY, RATING_DEADLINE, TRANSLATIONS } = require('./constants');

const logger = createFileLogger();

async function scheduleFeedbackMessages(sock, rideId, passengerJid, driverJid, language) {
  logger.info(`⏰ Scheduling rating requests for ride ${rideId} in 2 hours`);

  const tPassenger = TRANSLATIONS[language] || TRANSLATIONS['en']; // Passenger's chosen language
  const tDriver = TRANSLATIONS['pt']; // Drivers always receive Portuguese

  // Schedule rating request for passenger
  const passengerTimeoutId = setTimeout(async () => {
    try {
      // Get ride details with driver info
      const ride = await prisma.taxiRide.findUnique({
        where: { id: rideId },
        include: {
          assignment: {
            include: { driver: true }
          }
        }
      });

      if (!ride || !ride.assignment) {
        logger.error(`❌ Cannot send rating request - ride ${rideId} or assignment not found`);
        return;
      }

      const driverName = ride.assignment.driver.name;

      await sock.sendMessage(passengerJid, {
        text: tPassenger.ratingRequestPassenger(rideId, driverName)
      });
      logger.info(`✅ Sent rating request to passenger for ride ${rideId}`);

      // Send old feedback form as well (keep existing functionality)
      await sock.sendMessage(passengerJid, {
        text: tPassenger.feedbackPassenger(rideId)
      });

      // Mark passenger rating request as sent
      const now = new Date();
      await prisma.taxiRide.update({
        where: { id: rideId },
        data: {
          passengerRatingRequestSent: true,
          feedbackSent: true, // Keep for backwards compatibility
          ratingRequestSentAt: now,
          ratingDeadlineAt: new Date(now.getTime() + RATING_DEADLINE)
        }
      });
    } catch (error) {
      logger.error(`❌ Failed to send rating request to passenger for ride ${rideId}:`, error);
    }
  }, FEEDBACK_DELAY);

  // Schedule rating request for driver
  const driverTimeoutId = setTimeout(async () => {
    try {
      // Get ride details with passenger info
      const ride = await prisma.taxiRide.findUnique({
        where: { id: rideId },
        include: { user: true }
      });

      if (!ride) {
        logger.error(`❌ Cannot send rating request - ride ${rideId} not found`);
        return;
      }

      const passengerName = ride.user.name;

      await sock.sendMessage(driverJid, {
        text: tDriver.ratingRequestDriver(rideId, passengerName)
      });
      logger.info(`✅ Sent rating request to driver for ride ${rideId}`);

      // Send old feedback form as well (keep existing functionality)
      await sock.sendMessage(driverJid, {
        text: tDriver.feedbackDriver(rideId)
      });

      // Mark driver rating request as sent
      await prisma.taxiRide.update({
        where: { id: rideId },
        data: {
          driverRatingRequestSent: true
        }
      });
    } catch (error) {
      logger.error(`❌ Failed to send rating request to driver for ride ${rideId}:`, error);
    }
  }, FEEDBACK_DELAY);

  feedbackTimeouts.set(rideId, {
    passengerTimeoutId,
    driverTimeoutId
  });

  logger.info(`⏰ Rating requests scheduled for ride ${rideId}`);
}

function clearFeedbackTimeouts(rideId) {
  const timeouts = feedbackTimeouts.get(rideId);
  if (timeouts) {
    if (timeouts.passengerTimeoutId) {
      clearTimeout(timeouts.passengerTimeoutId);
    }
    if (timeouts.driverTimeoutId) {
      clearTimeout(timeouts.driverTimeoutId);
    }
    feedbackTimeouts.delete(rideId);
    logger.info(`⏰ Cleared feedback timeouts for ride ${rideId}`);
  }
}

async function restoreFeedbackTimeouts(sock) {
  const now = new Date();
  let restoredCount = 0;
  let sentCount = 0;
  let skippedCount = 0;

  const completedRides = await prisma.taxiRide.findMany({
    where: {
      status: 'completed',
      completedAt: { not: null },
      OR: [
        { passengerRatingRequestSent: false },
        { driverRatingRequestSent: false }
      ]
    },
    include: {
      user: true,
      assignment: {
        include: {
          driver: true
        }
      }
    }
  });

  for (const ride of completedRides) {
    if (!ride.assignment) continue;

    const feedbackTime = new Date(ride.completedAt.getTime() + FEEDBACK_DELAY);
    const timeRemaining = feedbackTime - now;

    if (timeRemaining <= 0) {
      // Send immediately with rating requests
      const tPassenger = TRANSLATIONS[ride.language]; // Passenger's chosen language
      const tDriver = TRANSLATIONS['pt']; // Drivers always receive Portuguese
      const driverName = ride.assignment.driver.name;
      const passengerName = ride.user.name;

      // Send to passenger if not already sent
      if (!ride.passengerRatingRequestSent) {
        logger.info(`📧 Sending overdue rating request to passenger for ride ${ride.id}`);
        try {
          await sock.sendMessage(getPrimaryIdentifier(ride.user), {
            text: tPassenger.ratingRequestPassenger(ride.id, driverName)
          });
          await sock.sendMessage(getPrimaryIdentifier(ride.user), {
            text: tPassenger.feedbackPassenger(ride.id)
          });
          logger.info(`✅ Sent rating request to passenger for ride ${ride.id}`);

          await prisma.taxiRide.update({
            where: { id: ride.id },
            data: {
              passengerRatingRequestSent: true,
              feedbackSent: true,
              ratingRequestSentAt: now,
              ratingDeadlineAt: new Date(now.getTime() + RATING_DEADLINE)
            }
          });
        } catch (error) {
          logger.error(`❌ Failed to send rating request to passenger for ride ${ride.id}:`, error);
        }
      }

      // Send to driver if not already sent
      if (!ride.driverRatingRequestSent) {
        logger.info(`📧 Sending overdue rating request to driver for ride ${ride.id}`);
        try {
          await sock.sendMessage(getPrimaryIdentifier(ride.assignment.driver), {
            text: tDriver.ratingRequestDriver(ride.id, passengerName)
          });
          await sock.sendMessage(getPrimaryIdentifier(ride.assignment.driver), {
            text: tDriver.feedbackDriver(ride.id)
          });
          logger.info(`✅ Sent rating request to driver for ride ${ride.id}`);

          await prisma.taxiRide.update({
            where: { id: ride.id },
            data: {
              driverRatingRequestSent: true
            }
          });
        } catch (error) {
          logger.error(`❌ Failed to send rating request to driver for ride ${ride.id}:`, error);
        }
      }

      sentCount++;
    } else {
      // Reschedule
      await scheduleFeedbackMessages(sock, ride.id, getPrimaryIdentifier(ride.user), getPrimaryIdentifier(ride.assignment.driver), ride.language);
      logger.info(`⏰ Restored rating timeout for ride ${ride.id} - will send in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  logger.info(`🔄 Rating timeout restoration complete: ${restoredCount} restored, ${sentCount} sent immediately, ${skippedCount} already sent`);
}

module.exports = {
  scheduleFeedbackMessages,
  clearFeedbackTimeouts,
  restoreFeedbackTimeouts
};
