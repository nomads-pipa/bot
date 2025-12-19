const { prisma, findUserByIdentifier, prepareIdentifierFields, getPrimaryIdentifier } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, activeRideTimeouts, userRideMap, TRANSLATIONS } = require('./constants');
const { clearConversationTimeouts, resetConversationTimeout } = require('./conversation-timeout');
const { deleteConversationState } = require('./conversation-state');
const { scheduleKeepaliveMessages, clearKeepaliveInterval } = require('./keepalive');
const { formatReputation } = require('./reputation');

const logger = createFileLogger();

async function getDriverNumbers(vehicleType, testMode = false) {
  try {
    // If in test mode, return only the test driver
    if (testMode) {
      const TEST_DRIVER_JID = '558481276550@s.whatsapp.net';
      logger.info(`🧪 TEST MODE: Returning only test driver ${TEST_DRIVER_JID}`);
      return [TEST_DRIVER_JID];
    }

    const whereClause = vehicleType === 'mototaxi'
      ? { isMotoTaxiDriver: true, isActive: true }
      : { isTaxiDriver: true, isActive: true };

    const drivers = await prisma.driver.findMany({
      where: whereClause,
      select: { jid: true, lid: true }
    });

    if (drivers.length === 0) {
      logger.warn(`No active ${vehicleType} drivers found in database`);
      return [];
    }

    logger.info(`Found ${drivers.length} active ${vehicleType} drivers in database`);
    // Return primary identifier (LID if available, otherwise JID)
    return drivers.map(driver => getPrimaryIdentifier(driver)).filter(id => id !== null);
  } catch (error) {
    logger.error(`Error fetching ${vehicleType} drivers from database:`, error);
    return [];
  }
}

async function createInitialRide(sender, vehicleType, language, userInfo = {}) {
  // Check if user exists
  let user = await findUserByIdentifier(sender);

  const identifierFields = prepareIdentifierFields(sender);

  if (user) {
    // Update existing user
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...identifierFields,
        name: userInfo.name || user.name,
        phone: userInfo.phone || user.phone
      }
    });
  } else {
    // Create new user
    user = await prisma.user.create({
      data: {
        ...identifierFields,
        name: userInfo.name || null,
        phone: userInfo.phone || null
      }
    });
  }

  // Create ride with initial data (most fields will be null)
  const ride = await prisma.taxiRide.create({
    data: {
      status: 'pending',
      vehicleType: vehicleType,
      language: language,
      userId: user.id,
      locationText: userInfo.locationText || null,
      locationLat: userInfo.locationPin?.latitude || null,
      locationLng: userInfo.locationPin?.longitude || null,
      destination: userInfo.destination || null,
      identifier: userInfo.identifier || null,
      waitTime: userInfo.waitTime || null
    }
  });

  logger.info(`📝 Created initial ride record ${ride.id} for ${sender}`);
  return ride;
}

async function updateRide(rideId, updates) {
  const ride = await prisma.taxiRide.update({
    where: { id: rideId },
    data: updates
  });

  logger.info(`📝 Updated ride ${rideId} with new data`);
  return ride;
}

async function createRide(sender, userInfo, vehicleType, language) {
  // Check if user exists
  let user = await findUserByIdentifier(sender);

  const identifierFields = prepareIdentifierFields(sender);

  if (user) {
    // Update existing user
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...identifierFields,
        name: userInfo.name,
        phone: userInfo.phone
      }
    });
  } else {
    // Create new user
    user = await prisma.user.create({
      data: {
        ...identifierFields,
        name: userInfo.name,
        phone: userInfo.phone
      }
    });
  }

  // Create ride
  const ride = await prisma.taxiRide.create({
    data: {
      status: 'pending',
      vehicleType: vehicleType,
      language: language,
      userId: user.id,
      locationText: userInfo.locationText,
      locationLat: userInfo.locationPin?.latitude || null,
      locationLng: userInfo.locationPin?.longitude || null,
      destination: userInfo.destination,
      identifier: userInfo.identifier,
      waitTime: userInfo.waitTime
    }
  });

  return ride;
}

async function rebroadcastRideAfterDriverCancel(sock, ride, conversation) {
  const testMode = conversation.testMode || false;
  const driverNumbers = await getDriverNumbers(ride.vehicleType, testMode);

  if (driverNumbers.length === 0) {
    const t = TRANSLATIONS[ride.language];
    await sock.sendMessage(getPrimaryIdentifier(ride.user), {
      text: t.noDrivers
    });
    await prisma.taxiRide.update({
      where: { id: ride.id },
      data: { status: 'expired' }
    });
    return;
  }

  const vehicleIcon = ride.vehicleType === 'mototaxi' ? '🏍️' : '🚗';
  const vehicleLabel = ride.vehicleType === 'mototaxi' ? 'MOTOTAXI' : 'TÁXI';
  const testModeTag = testMode ? ' 🧪 [TESTE]' : '';

  // Format passenger reputation
  const passengerRep = formatReputation(ride.user.reputation, 'pt');

  const driverMessage = `${vehicleIcon} *NOVA CORRIDA AUTOMÁTICA - ${vehicleLabel}${testModeTag}*
*[RE-ENVIADA - Motorista anterior cancelou]*

*Passageiro:* ${conversation.name || ride.user.name}
*Telefone:* ${conversation.phone || ride.user.phone}
*Reputação:* ${passengerRep}
*Local (texto):* ${ride.locationText}
*Destino:* ${ride.destination}
*Identificação:* ${ride.identifier}
*Tempo de espera:* ${ride.waitTime} minutos

*Corrida #${ride.id}*

*Para aceitar, escreva: aceitar ${ride.id}*

🤖 Esta é uma mensagem automática do sistema.`;

  for (const driverJid of driverNumbers) {
    try {
      await sock.sendMessage(driverJid, { text: driverMessage });

      if (ride.locationLat && ride.locationLng) {
        await sock.sendMessage(driverJid, {
          location: {
            degreesLatitude: ride.locationLat,
            degreesLongitude: ride.locationLng
          }
        });
      }

      logger.info(`🚖 Re-sent ride request ${ride.id} to driver ${driverJid}`);
    } catch (error) {
      logger.error(`❌ Failed to send ride request to driver ${driverJid}:`, error);
    }
  }

  logger.info(`🚖 Re-broadcasted ${ride.vehicleType} ride ${ride.id} to ${driverNumbers.length} drivers`);

  const waitTimeMinutes = parseInt(ride.waitTime, 10);
  if (!isNaN(waitTimeMinutes) && waitTimeMinutes > 0) {
    const timeoutMs = waitTimeMinutes * 60 * 1000;
    const { handleRideTimeout } = require('./ride-timeout');
    const timeoutId = setTimeout(() => {
      handleRideTimeout(sock, ride.id, getPrimaryIdentifier(ride.user), waitTimeMinutes, ride.language);
    }, timeoutMs);

    activeRideTimeouts.set(ride.id, timeoutId);
    logger.info(`⏰ Set new timeout for re-broadcasted ride ${ride.id}`);
  }

  // Schedule keepalive messages
  scheduleKeepaliveMessages(sock, ride.id, getPrimaryIdentifier(ride.user), ride.language);
}

async function broadcastRideToDrivers(sock, sender, conversation) {
  const { userInfo, language, vehicleType, rideId, testMode } = conversation;
  const t = TRANSLATIONS[language];

  // Use existing ride if we have one, otherwise create new one (for backward compatibility)
  let ride;
  if (rideId) {
    ride = await prisma.taxiRide.findUnique({
      where: { id: rideId },
      include: { user: true }
    });
  } else {
    ride = await createRide(sender, userInfo, vehicleType, language);
    ride = await prisma.taxiRide.findUnique({
      where: { id: ride.id },
      include: { user: true }
    });
  }

  const testModeIndicator = testMode ? ' 🧪 [TEST MODE]' : '';
  await sock.sendMessage(sender, {
    text: t.requestSent(ride.id) + testModeIndicator
  });

  const driverNumbers = await getDriverNumbers(vehicleType, testMode);

  if (driverNumbers.length === 0) {
    await sock.sendMessage(sender, {
      text: t.noDrivers
    });
    activeConversations.delete(sender);
    clearConversationTimeouts(sender);
    await deleteConversationState(sender, 'no_drivers');
    return;
  }

  const vehicleIcon = vehicleType === 'mototaxi' ? '🏍️' : '🚗';
  const vehicleLabel = vehicleType === 'mototaxi' ? 'MOTOTAXI' : 'TÁXI';
  const testModeTag = testMode ? ' 🧪 [TESTE]' : '';

  // Format passenger reputation
  const passengerRep = formatReputation(ride.user.reputation, 'pt');

  const driverMessage = `${vehicleIcon} *NOVA CORRIDA AUTOMÁTICA - ${vehicleLabel}${testModeTag}*

*Passageiro:* ${userInfo.name}
*Telefone:* ${userInfo.phone}
*Reputação:* ${passengerRep}
*Local (texto):* ${userInfo.locationText}
*Destino:* ${userInfo.destination}
*Identificação:* ${userInfo.identifier}
*Tempo de espera:* ${userInfo.waitTime} minutos

*Corrida #${ride.id}*

*Para aceitar, escreva: aceitar ${ride.id}*

🤖 Esta é uma mensagem automática do sistema.`;

  for (const driverJid of driverNumbers) {
    try {
      await sock.sendMessage(driverJid, { text: driverMessage });

      if (userInfo.locationPin) {
        await sock.sendMessage(driverJid, {
          location: {
            degreesLatitude: userInfo.locationPin.latitude,
            degreesLongitude: userInfo.locationPin.longitude
          }
        });
      }

      logger.info(`🚖 Sent ride request ${ride.id} to driver ${driverJid}`);
    } catch (error) {
      logger.error(`❌ Failed to send ride request to driver ${driverJid}:`, error);
    }
  }

  activeConversations.delete(sender);
  clearConversationTimeouts(sender);
  await deleteConversationState(sender, 'ride_broadcast');

  // Store ride mapping for cancellations
  userRideMap.set(sender, ride.id);

  logger.info(`🚖 Broadcasted ${vehicleType} ride ${ride.id} to ${driverNumbers.length} drivers`);

  const waitTimeMinutes = parseInt(userInfo.waitTime, 10);
  if (!isNaN(waitTimeMinutes) && waitTimeMinutes > 0) {
    const timeoutMs = waitTimeMinutes * 60 * 1000;
    const { handleRideTimeout } = require('./ride-timeout');
    const timeoutId = setTimeout(() => {
      handleRideTimeout(sock, ride.id, sender, waitTimeMinutes, language);
    }, timeoutMs);

    activeRideTimeouts.set(ride.id, timeoutId);
    logger.info(`⏰ Set ${waitTimeMinutes} minute timeout for ride ${ride.id}`);
  }

  // Schedule keepalive messages
  scheduleKeepaliveMessages(sock, ride.id, sender, language);
}

module.exports = {
  getDriverNumbers,
  createInitialRide,
  updateRide,
  createRide,
  rebroadcastRideAfterDriverCancel,
  broadcastRideToDrivers
};
