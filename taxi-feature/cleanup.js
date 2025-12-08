const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');

const logger = createFileLogger();

async function cleanupOldRides() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - TWO_HOURS);
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR);

  // Find rides where rating deadline has passed and clear the deadline
  const expiredRatings = await prisma.taxiRide.updateMany({
    where: {
      ratingDeadlineAt: {
        lt: now,
        not: null
      }
    },
    data: {
      ratingDeadlineAt: null
    }
  });

  if (expiredRatings.count > 0) {
    logger.info(`⏰ Expired ${expiredRatings.count} rating deadlines`);
  }

  // Delete completed rides older than 2 hours
  const deletedCompleted = await prisma.taxiRide.deleteMany({
    where: {
      status: 'completed',
      completedAt: {
        lt: twoHoursAgo
      }
    }
  });

  // Delete pending rides older than 1 hour
  const deletedPending = await prisma.taxiRide.deleteMany({
    where: {
      status: 'pending',
      createdAt: {
        lt: oneHourAgo
      }
    }
  });

  // Delete expired/cancelled rides older than 1 hour
  const deletedOthers = await prisma.taxiRide.deleteMany({
    where: {
      OR: [
        {
          status: 'expired',
          expiredAt: {
            lt: oneHourAgo
          }
        },
        {
          status: 'cancelled',
          cancelledAt: {
            lt: oneHourAgo
          }
        }
      ]
    }
  });

  const totalDeleted = deletedCompleted.count + deletedPending.count + deletedOthers.count;

  if (totalDeleted > 0) {
    logger.info(`🧹 Cleaned up ${totalDeleted} old taxi rides`);
  }

  // Note: We keep all conversation states for analytics/debugging purposes
  // They are marked as inactive (isActive=false) when completed/expired
}

module.exports = {
  cleanupOldRides
};
