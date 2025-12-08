const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { TRANSLATIONS } = require('./constants');
const { calculateAndUpdateUserReputation, calculateAndUpdateDriverReputation } = require('./reputation');

const logger = createFileLogger();

async function processRatingResponse(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  // Check if message is a rating command: "avaliar X" or "rate X" where X is 1-5
  const trimmedMessage = messageContent.trim().toLowerCase();
  const ratingMatch = trimmedMessage.match(/^(avaliar|rate)\s+([1-5])$/);

  if (!ratingMatch) {
    return false; // Not a rating command
  }

  const rating = parseInt(ratingMatch[2], 10);

  // Find if this user has any pending ratings (rides where rating request was sent but no rating given yet)
  // Check if sender is a passenger
  const userRides = await prisma.taxiRide.findMany({
    where: {
      user: { jid: sender },
      status: 'completed',
      ratingRequestSentAt: { not: null },
      ratingDeadlineAt: { gte: new Date() }
    },
    include: {
      assignment: {
        include: { driver: true }
      },
      user: true,
      ratings: true
    },
    orderBy: { ratingRequestSentAt: 'desc' }
  });

  // Check if passenger already rated this ride
  const pendingUserRide = userRides.find(ride =>
    !ride.ratings.some(r => r.raterType === 'passenger' && r.rateeType === 'driver')
  );

  // Check if sender is a driver
  const driverRides = await prisma.taxiRide.findMany({
    where: {
      assignment: {
        driver: { jid: sender }
      },
      status: 'completed',
      ratingRequestSentAt: { not: null },
      ratingDeadlineAt: { gte: new Date() }
    },
    include: {
      assignment: {
        include: { driver: true }
      },
      user: true,
      ratings: true
    },
    orderBy: { ratingRequestSentAt: 'desc' }
  });

  // Check if driver already rated this ride
  const pendingDriverRide = driverRides.find(ride =>
    !ride.ratings.some(r => r.raterType === 'driver' && r.rateeType === 'passenger')
  );

  if (!pendingUserRide && !pendingDriverRide) {
    return false; // No pending ratings for this user
  }

  const ride = pendingUserRide || pendingDriverRide;
  const isPassenger = !!pendingUserRide;
  const language = ride.language || 'en';
  const t = TRANSLATIONS[language];

  try {
    if (isPassenger) {
      // Passenger rating the driver
      await prisma.rating.create({
        data: {
          rideId: ride.id,
          raterType: 'passenger',
          raterUserId: ride.user.id,
          rateeType: 'driver',
          rateeDriverId: ride.assignment.driver.id,
          score: rating
        }
      });

      // Update driver reputation
      await calculateAndUpdateDriverReputation(ride.assignment.driver.id);

      logger.info(`⭐ Passenger rated driver ${rating} stars for ride ${ride.id}`);
    } else {
      // Driver rating the passenger
      await prisma.rating.create({
        data: {
          rideId: ride.id,
          raterType: 'driver',
          raterDriverId: ride.assignment.driver.id,
          rateeType: 'passenger',
          rateeUserId: ride.user.id,
          score: rating
        }
      });

      // Update passenger reputation
      await calculateAndUpdateUserReputation(ride.user.id);

      logger.info(`⭐ Driver rated passenger ${rating} stars for ride ${ride.id}`);
    }

    await sock.sendMessage(sender, {
      text: t.ratingReceived(rating)
    });

    return true;
  } catch (error) {
    logger.error(`❌ Failed to process rating for ride ${ride.id}:`, error);
    return false;
  }
}

async function checkInvalidRatingAttempt(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  const trimmedMessage = messageContent.trim().toLowerCase();

  // Check if they're trying to use rating keywords but with wrong format
  // Match "avaliar" or "rate" followed by something that's not exactly the right format
  if (trimmedMessage.startsWith('avaliar') || trimmedMessage.startsWith('rate')) {
    // Check if they have pending ratings
    const userRides = await prisma.taxiRide.findMany({
      where: {
        user: { jid: sender },
        status: 'completed',
        ratingRequestSentAt: { not: null },
        ratingDeadlineAt: { gte: new Date() }
      },
      include: {
        ratings: true
      }
    });

    const driverRides = await prisma.taxiRide.findMany({
      where: {
        assignment: {
          driver: { jid: sender }
        },
        status: 'completed',
        ratingRequestSentAt: { not: null },
        ratingDeadlineAt: { gte: new Date() }
      },
      include: {
        ratings: true
      }
    });

    const pendingUserRide = userRides.find(ride =>
      !ride.ratings.some(r => r.raterType === 'passenger' && r.rateeType === 'driver')
    );

    const pendingDriverRide = driverRides.find(ride =>
      !ride.ratings.some(r => r.raterType === 'driver' && r.rateeType === 'passenger')
    );

    if (pendingUserRide || pendingDriverRide) {
      const ride = pendingUserRide || pendingDriverRide;
      const language = ride.language || 'en';
      const t = TRANSLATIONS[language];

      await sock.sendMessage(sender, {
        text: t.ratingInvalid
      });
      return true;
    }
  }

  return false;
}

module.exports = {
  processRatingResponse,
  checkInvalidRatingAttempt
};
