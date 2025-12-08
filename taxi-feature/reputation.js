const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');

const logger = createFileLogger();

async function calculateAndUpdateUserReputation(userId) {
  const ratings = await prisma.rating.findMany({
    where: {
      rateeUserId: userId,
      rateeType: 'passenger'
    },
    select: { score: true }
  });

  if (ratings.length === 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { reputation: null }
    });
    return null;
  }

  const totalScore = ratings.reduce((sum, rating) => sum + rating.score, 0);
  const avgReputation = totalScore / ratings.length;
  const roundedReputation = Math.round(avgReputation * 10) / 10; // Round to 1 decimal

  await prisma.user.update({
    where: { id: userId },
    data: { reputation: roundedReputation }
  });

  logger.info(`📊 Updated user ${userId} reputation to ${roundedReputation} (${ratings.length} ratings)`);
  return roundedReputation;
}

async function calculateAndUpdateDriverReputation(driverId) {
  const ratings = await prisma.rating.findMany({
    where: {
      rateeDriverId: driverId,
      rateeType: 'driver'
    },
    select: { score: true }
  });

  if (ratings.length === 0) {
    await prisma.driver.update({
      where: { id: driverId },
      data: { reputation: null }
    });
    return null;
  }

  const totalScore = ratings.reduce((sum, rating) => sum + rating.score, 0);
  const avgReputation = totalScore / ratings.length;
  const roundedReputation = Math.round(avgReputation * 10) / 10; // Round to 1 decimal

  await prisma.driver.update({
    where: { id: driverId },
    data: { reputation: roundedReputation }
  });

  logger.info(`📊 Updated driver ${driverId} reputation to ${roundedReputation} (${ratings.length} ratings)`);
  return roundedReputation;
}

function formatReputation(reputation, language) {
  if (reputation === null || reputation === undefined) {
    return language === 'pt' ? 'ainda sem reputação' : 'no reputation yet';
  }
  const stars = '⭐'.repeat(Math.round(reputation));
  return `${reputation.toFixed(1)} ${stars}`;
}

module.exports = {
  calculateAndUpdateUserReputation,
  calculateAndUpdateDriverReputation,
  formatReputation
};
