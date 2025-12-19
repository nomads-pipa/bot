const { prisma, findUserByIdentifier, getPrimaryIdentifier } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');

const logger = createFileLogger();

function isRideHistoryRequest(messageContent) {
  if (!messageContent) return false;
  const normalizedContent = messageContent.toLowerCase().trim();
  return normalizedContent === 'my rides' ||
         normalizedContent === 'minhas corridas';
}

async function sendRideHistory(sock, sender) {
  logger.info(`📋 Ride history requested by sender: ${sender}`);

  // Find the user in the database
  const user = await findUserByIdentifier(sender);

  // Load rides if user found
  let userWithRides = null;
  if (user) {
    userWithRides = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        taxiRides: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            assignment: {
              include: {
                driver: true
              }
            }
          }
        }
      }
    });
  }

  if (!userWithRides) {
    logger.warn(`📋 User not found in database for identifier: ${sender}`);

    // Debug: Check if there are any users in the database
    const allUsers = await prisma.user.findMany({
      select: { jid: true, lid: true, phone: true }
    });
    logger.info(`📋 Total users in database: ${allUsers.length}`);
    if (allUsers.length > 0) {
      logger.info(`📋 Sample identifiers: ${allUsers.slice(0, 3).map(u => getPrimaryIdentifier(u)).join(', ')}`);
    }
  }

  if (!userWithRides || userWithRides.taxiRides.length === 0) {
    // Send message in both languages since we don't know user's preference
    await sock.sendMessage(sender, {
      text: `📋 *Ride History / Histórico de Corridas*

You don't have any ride history yet.
Você ainda não tem histórico de corridas.

To request a ride, send "taxi" or "mototaxi".
Para solicitar uma corrida, envie "taxi" ou "mototaxi".`
    });
    logger.info(`📋 No ride history found for ${sender}`);
    return true;
  }

  // Build the report
  const maxRides = Math.min(userWithRides.taxiRides.length, 5);
  let report = `📋 *Your Last ${maxRides} Ride(s) / Suas Últimas ${maxRides} Corrida(s)*\n\n`;

  if (userWithRides.taxiRides.length > 5) {
    report += `_Showing the 5 most recent rides / Mostrando as 5 corridas mais recentes_\n\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const mentions = [];

  for (let i = 0; i < maxRides; i++) {
    const ride = userWithRides.taxiRides[i];
    const rideNumber = i + 1;

    // Format date and time
    const date = new Date(ride.createdAt);
    const formattedDate = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Status icon
    let statusIcon = '';
    let statusText = '';
    if (ride.status === 'completed') {
      statusIcon = '✅';
      statusText = ride.language === 'pt' ? 'Concluída' : 'Completed';
    } else if (ride.status === 'expired') {
      statusIcon = '⏰';
      statusText = ride.language === 'pt' ? 'Expirada' : 'Expired';
    } else if (ride.status === 'cancelled') {
      statusIcon = '❌';
      statusText = ride.language === 'pt' ? 'Cancelada' : 'Cancelled';
    } else if (ride.status === 'pending') {
      statusIcon = '⏳';
      statusText = ride.language === 'pt' ? 'Pendente' : 'Pending';
    }

    // Vehicle type
    const vehicleIcon = ride.vehicleType === 'mototaxi' ? '🏍️' : '🚗';
    const vehicleText = ride.vehicleType === 'mototaxi' ? 'Mototaxi' : 'Táxi';

    report += `*${rideNumber}. Ride #${ride.id}* ${statusIcon} ${statusText}\n`;
    report += `${vehicleIcon} ${vehicleText}\n`;
    report += `📅 ${formattedDate} às ${formattedTime}\n`;
    report += `📍 *From / De:* ${ride.locationText || 'N/A'}\n`;
    report += `🎯 *To / Para:* ${ride.destination || 'N/A'}\n`;

    // Driver info if ride was accepted
    if (ride.assignment && ride.assignment.driver) {
      const driverIdentifier = getPrimaryIdentifier(ride.assignment.driver);
      const driverPhone = driverIdentifier ? driverIdentifier.split('@')[0] : 'Unknown';
      report += `👤 *Driver / Motorista:* @${driverPhone}\n`;
      // Collect driver identifier for mentions
      if (driverIdentifier) {
        mentions.push(driverIdentifier);
      }
    } else {
      report += `👤 *Driver / Motorista:* ${ride.language === 'pt' ? 'Nenhum motorista aceitou' : 'No driver accepted'}\n`;
    }

    // Retry attempts if any
    if (ride.retryAttempts > 0) {
      report += `🔄 *Retry attempts / Tentativas:* ${ride.retryAttempts}\n`;
    }

    report += `\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `To request a new ride, send "taxi" or "mototaxi".\n`;
  report += `Para solicitar uma nova corrida, envie "taxi" ou "mototaxi".`;

  // Send message with mentions array if there are any mentions
  const messageOptions = { text: report };
  if (mentions.length > 0) {
    messageOptions.mentions = mentions;
  }

  await sock.sendMessage(sender, messageOptions);
  logger.info(`📋 Sent ride history to ${sender} (${maxRides} rides)`);
  return true;
}

module.exports = {
  isRideHistoryRequest,
  sendRideHistory
};
