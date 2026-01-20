const { prisma, normalizeJid, isRegisteredDriver, findDriverByIdentifier, prepareIdentifierFields, getPrimaryIdentifier, getMessagingIdentifier, isSameUser } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, activeRideTimeouts, userRideMap, STATES, TRANSLATIONS } = require('./constants');
const { clearConversationTimeouts, resetConversationTimeout } = require('./conversation-timeout');
const { deleteConversationState } = require('./conversation-state');
const { scheduleFeedbackMessages, clearFeedbackTimeouts } = require('./feedback');
const { clearKeepaliveInterval } = require('./keepalive');
const { formatReputation } = require('./reputation');
const { rebroadcastRideAfterDriverCancel } = require('./ride-management');

const logger = createFileLogger();

async function processDriverResponse(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  if (messageContent.trim().toLowerCase() === 'aceitar') {
    await sock.sendMessage(sender, {
      text: '⚠️ Por favor, inclua o número da corrida que deseja aceitar.\n\nExemplo: *aceitar 27*'
    });
    return true;
  }

  // Check if sender is a registered driver first
  const normalizedJid = normalizeJid(sender);
  const isDriver = await isRegisteredDriver(normalizedJid);

  // Try matching "aceitar [number]" format (preferred/explicit format)
  const acceptanceWithKeywordRegex = /^aceitar\s+(?:corrida\s+)?(\d+)$/i;
  let match = messageContent.trim().match(acceptanceWithKeywordRegex);

  // If no match and sender is a registered driver, also accept bare numbers
  // This is safe because:
  // 1. Active passenger conversations are handled before this function is called
  // 2. Ratings require "avaliar" or "rate" keywords (checked before this function)
  // 3. Only registered drivers can use this shortcut
  if (!match && isDriver) {
    const bareNumberRegex = /^(\d+)$/;
    match = messageContent.trim().match(bareNumberRegex);
  }

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  if (!isDriver) {
    // LID doesn't match - ask for CPF confirmation
    logger.info(`⚠️ Driver LID not found for ${sender}, requesting CPF confirmation for ride ${rideId}`);

    await sock.sendMessage(sender, {
      text: TRANSLATIONS.pt.driverCpfRequest(rideId)
    });

    // Store conversation state to track CPF validation
    await prisma.conversationState.upsert({
      where: { userJid: sender },
      update: {
        state: 'awaiting_driver_cpf_confirmation',
        rideId: rideId,
        lastActivityAt: new Date(),
        isActive: true,
        cpfAttempts: 0
      },
      create: {
        userJid: sender,
        state: 'awaiting_driver_cpf_confirmation',
        language: 'pt',
        rideId: rideId,
        conversationStartedAt: new Date(),
        lastActivityAt: new Date(),
        isActive: true,
        cpfAttempts: 0
      }
    });

    activeConversations.set(sender, {
      state: STATES.AWAITING_DRIVER_CPF_CONFIRMATION,
      rideId: rideId,
      cpfAttempts: 0
    });

    return true;
  }

  // Get registered driver first (we already verified they exist and are registered)
  const driver = await findDriverByIdentifier(normalizedJid);

  // Use the driver's reliable messaging identifier (prefers JID over LID)
  const driverMessagingId = getMessagingIdentifier(driver);
  logger.info(`🔍 Driver ${normalizedJid} messaging via ${driverMessagingId}`);

  // Update driver record with current identifier (JID or LID) if not already present
  const identifierFields = prepareIdentifierFields(normalizedJid);
  if (Object.keys(identifierFields).length > 0) {
    await prisma.driver.update({
      where: { id: driver.id },
      data: identifierFields
    });
  }

  const ride = await prisma.taxiRide.findUnique({
    where: { id: rideId },
    include: { user: true }
  });

  if (!ride) {
    logger.info(`📤 Ride ${rideId} not found, sending message to ${driverMessagingId}`);
    await sock.sendMessage(driverMessagingId, {
      text: '❌ Nenhuma corrida encontrada com este número.'
    });
    logger.info(`✅ Sent "ride not found" message to ${driverMessagingId}`);
    return true;
  }

  if (ride.status === 'expired') {
    logger.info(`📤 Ride ${rideId} expired, sending message to ${driverMessagingId}`);
    await sock.sendMessage(driverMessagingId, {
      text: '❌ Esta corrida expirou porque nenhum motorista aceitou dentro do tempo de espera.'
    });
    logger.info(`✅ Sent "ride expired" message to ${driverMessagingId}`);
    return true;
  }

  logger.info(`🔍 processDriverResponse - Ride ${rideId} status check: ${ride.status}`);

  if (ride.status === 'completed') {
    // Check if this driver is the one who accepted
    const existingAssignment = await prisma.rideAssignment.findUnique({
      where: { rideId: rideId },
      include: { driver: true }
    });

    if (existingAssignment && existingAssignment.driverId === driver.id) {
      // This driver already accepted - remind them with passenger details
      logger.info(`ℹ️ Driver ${normalizedJid} tried to re-accept their own ride ${rideId}`);

      // Format passenger reputation
      const passengerRep = formatReputation(ride.user.reputation, 'pt');

      logger.info(`📤 Sending "already accepted" reminder to ${driverMessagingId} for ride ${rideId}`);
      await sock.sendMessage(driverMessagingId, {
        text: `✅ Você já aceitou esta corrida!

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Reputação: ${passengerRep}
Local: ${ride.locationText}
Destino: ${ride.destination}
Identificação: ${ride.identifier}
Tempo de espera: ${ride.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.*
💰 *Por favor, acerte o valor com o passageiro.*

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
      });
      logger.info(`✅ Sent "already accepted" reminder to ${driverMessagingId}`);
      return true;
    }

    // Another driver accepted
    logger.info(`📤 Ride ${rideId} accepted by another driver, sending message to ${driverMessagingId}`);
    await sock.sendMessage(driverMessagingId, {
      text: '❌ Esta corrida já foi aceita por outro motorista.'
    });
    logger.info(`✅ Sent "accepted by another driver" message to ${driverMessagingId}`);
    return true;
  }

  if (ride.status !== 'pending') {
    logger.info(`📤 Ride ${rideId} not available (status: ${ride.status}), sending message to ${driverMessagingId}`);
    await sock.sendMessage(driverMessagingId, {
      text: '❌ Esta corrida não está mais disponível.'
    });
    logger.info(`✅ Sent "not available" message to ${driverMessagingId}`);
    return true;
  }

  // Check if there's already an assignment for this ride (shouldn't happen, but handle it)
  const existingAssignment = await prisma.rideAssignment.findUnique({
    where: { rideId: rideId }
  });

  if (existingAssignment) {
    // Assignment already exists - this ride was already accepted
    logger.warn(`⚠️ Ride ${rideId} already has an assignment to driver ${existingAssignment.driverId}`);
    logger.info(`📤 Sending "already accepted" message to ${driverMessagingId}`);
    await sock.sendMessage(driverMessagingId, {
      text: '❌ Esta corrida já foi aceita por outro motorista.'
    });
    logger.info(`✅ Sent "already accepted by other driver" message to ${driverMessagingId}`);
    return true;
  }

  // Update ride status and create assignment
  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'completed',
      completedAt: new Date()
    }
  });

  // Create the assignment separately to avoid constraint issues
  await prisma.rideAssignment.create({
    data: {
      rideId: rideId,
      driverId: driver.id
    }
  });

  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
    logger.info(`⏰ Cleared timeout for ride ${rideId}`);
  }

  // Clear keepalive interval
  clearKeepaliveInterval(rideId);

  const passengerJid = getPrimaryIdentifier(ride.user);

  await scheduleFeedbackMessages(sock, ride.id, passengerJid, driverMessagingId, ride.language);

  // Format passenger reputation for driver message
  const passengerRep = formatReputation(ride.user.reputation, 'pt');

  await sock.sendMessage(driverMessagingId, {
    text: `✅ Corrida #${ride.id} aceita com sucesso! O passageiro será notificado.

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Reputação: ${passengerRep}
Local: ${ride.locationText}
Destino: ${ride.destination}
Identificação: ${ride.identifier}
Tempo de espera: ${ride.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.*
💰 *Por favor, acerte o valor com o passageiro.*

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
  });

  const t = TRANSLATIONS[ride.language];

  logger.info(`✉️ Sending ride acceptance to passenger:
    - Ride ID: ${ride.id}
    - Driver messaging ID: ${driverMessagingId}
    - Driver Name: ${driver.name || 'Not set'}
    - Driver Phone: ${driver.phone || 'Not set'}`);

  // Format driver reputation for passenger message
  const driverRep = formatReputation(driver.reputation, ride.language);

  await sock.sendMessage(passengerJid, {
    text: t.rideAccepted(ride.id, driverMessagingId, driver.name, driver.phone, driverRep),
    mentions: [driverMessagingId]
  });

  activeConversations.delete(getPrimaryIdentifier(ride.user));
  clearConversationTimeouts(getPrimaryIdentifier(ride.user));
  await deleteConversationState(getPrimaryIdentifier(ride.user), 'driver_accepted');

  userRideMap.set(getPrimaryIdentifier(ride.user), rideId);

  logger.info(`✅ Ride ${rideId} accepted by driver ${sender} via messaging ID ${driverMessagingId}`);

  return true;
}

async function handleUserCancellation(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  const cancelRegex = /^(?:cancel|cancelar)(?:\s+(?:ride|corrida))?\s+(\d+)$/i;
  const match = messageContent.trim().match(cancelRegex);

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  const ride = await prisma.taxiRide.findUnique({
    where: { id: rideId },
    include: {
      user: true,
      assignment: {
        include: { driver: true }
      }
    }
  });

  if (!ride) {
    await sock.sendMessage(sender, {
      text: '❌ Ride not found / Corrida não encontrada.'
    });
    return true;
  }

  if (!isSameUser(sender, ride.user)) {
    // Not the passenger - let driver cancellation handler try
    return false;
  }

  if (ride.status === 'cancelled' || ride.status === 'expired') {
    await sock.sendMessage(sender, {
      text: '❌ This ride is already cancelled / Esta corrida já foi cancelada.'
    });
    return true;
  }

  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'cancelled',
      cancelledBy: 'user',
      cancelledAt: new Date()
    }
  });

  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
  }

  clearFeedbackTimeouts(rideId);
  clearKeepaliveInterval(rideId);
  userRideMap.delete(sender);

  const t = TRANSLATIONS[ride.language];

  await sock.sendMessage(sender, {
    text: t.userCancelled(rideId)
  });

  if (ride.assignment && ride.assignment.driver) {
    const driverIdentifier = getPrimaryIdentifier(ride.assignment.driver);
    await sock.sendMessage(driverIdentifier, {
      text: `❌ *CORRIDA CANCELADA PELO PASSAGEIRO*

*Corrida #${rideId}*
O passageiro ${ride.user.name} cancelou a corrida.

🤖 Esta é uma mensagem automática do sistema.`
    });

    await sock.sendMessage(sender, {
      text: t.driverNotifiedCancel(ride.assignment.driver.phone || driverIdentifier)
    });
  }

  logger.info(`❌ Ride ${rideId} cancelled by user ${sender}`);

  return true;
}

async function handleDriverCancellation(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  const cancelRegex = /^(?:cancel|cancelar)(?:\s+(?:ride|corrida))?\s+(\d+)$/i;
  const match = messageContent.trim().match(cancelRegex);

  // Debug logging
  if (messageContent.toLowerCase().includes('cancel') || messageContent.toLowerCase().includes('cancelar')) {
    logger.info(`🔍 Driver cancellation attempt - Message: "${messageContent}", Match: ${!!match}, Sender: ${sender}`);
  }

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  const ride = await prisma.taxiRide.findUnique({
    where: { id: rideId },
    include: {
      user: true,
      assignment: {
        include: { driver: true }
      }
    }
  });

  if (!ride) {
    await sock.sendMessage(sender, {
      text: '❌ Corrida não encontrada.'
    });
    return true;
  }

  if (!ride.assignment || !isSameUser(sender, ride.assignment.driver)) {
    await sock.sendMessage(sender, {
      text: '❌ Você não está atribuído a esta corrida.'
    });
    return true;
  }

  if (ride.status === 'cancelled' || ride.status === 'expired') {
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida já foi cancelada.'
    });
    return true;
  }

  // Delete assignment and mark with driver cancellation
  await prisma.rideAssignment.delete({
    where: { id: ride.assignment.id }
  });

  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'pending',
      cancelledBy: 'driver',
      cancelledAt: new Date()
    }
  });

  clearFeedbackTimeouts(rideId);
  clearKeepaliveInterval(rideId);
  userRideMap.delete(getPrimaryIdentifier(ride.user));

  // Send confirmation to driver using messaging identifier (JID preferred for reliability)
  const driverMessagingId = getMessagingIdentifier(ride.assignment.driver);
  logger.info(`✉️ Sending cancellation confirmation to driver ${driverMessagingId} (sender was: ${sender})`);
  await sock.sendMessage(driverMessagingId, {
    text: `✅ Corrida #${rideId} foi cancelada. O passageiro será consultado se deseja reenviar.`
  });
  logger.info(`✅ Sent cancellation confirmation to driver ${driverMessagingId}`);

  const t = TRANSLATIONS[ride.language];

  // Ask passenger if they want to rebroadcast
  await sock.sendMessage(getPrimaryIdentifier(ride.user), {
    text: t.driverCancelled(rideId)
  });

  logger.info(`❌ Ride ${rideId} cancelled by driver ${sender}, asking passenger about rebroadcast...`);

  // Set conversation timeout for decision
  resetConversationTimeout(sock, getPrimaryIdentifier(ride.user), ride.language);

  // Set up conversation state for driver cancel retry flow
  const conversationState = await prisma.conversationState.upsert({
    where: { userJid: getPrimaryIdentifier(ride.user) },
    update: {
      state: 'awaiting_driver_cancel_decision',
      rideId: rideId,
      lastActivityAt: new Date(),
      isActive: true
    },
    create: {
      userJid: getPrimaryIdentifier(ride.user),
      state: 'awaiting_driver_cancel_decision',
      language: ride.language,
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
  activeConversations.set(getPrimaryIdentifier(ride.user), {
    state: STATES.AWAITING_DRIVER_CANCEL_DECISION,
    language: ride.language,
    vehicleType: ride.vehicleType,
    userInfo: {
      name: ride.user.name,
      phone: ride.user.phone,
      locationText: ride.locationText,
      locationPin: ride.locationLat && ride.locationLng ? {
        latitude: ride.locationLat,
        longitude: ride.locationLng
      } : undefined,
      destination: ride.destination,
      identifier: ride.identifier,
      waitTime: ride.waitTime
    },
    rideId: rideId
  });

  return true;
}

async function processCpfValidation(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  // Check if this user is in CPF validation state
  const conversationState = await prisma.conversationState.findUnique({
    where: { userJid: sender }
  });

  if (!conversationState || conversationState.state !== 'awaiting_driver_cpf_confirmation' || !conversationState.isActive) {
    return false;
  }

  const MAX_CPF_ATTEMPTS = 3;
  const rideId = conversationState.rideId;

  // Normalize CPF - remove dots, dashes, and spaces
  const normalizedCpf = messageContent.trim().replace(/[\.\-\s]/g, '');

  // Validate CPF format (11 digits)
  if (!/^\d{11}$/.test(normalizedCpf)) {
    await sock.sendMessage(sender, {
      text: '❌ Formato de CPF inválido. Por favor, digite um CPF válido com 11 dígitos.\n\nExemplo: 123.456.789-00 ou 12345678900'
    });
    return true;
  }

  // Find driver by CPF
  const driver = await prisma.driver.findFirst({
    where: { cpf: normalizedCpf }
  });

  const currentAttempts = conversationState.cpfAttempts || 0;

  if (!driver) {
    const newAttempts = currentAttempts + 1;
    const attemptsLeft = MAX_CPF_ATTEMPTS - newAttempts;

    if (newAttempts >= MAX_CPF_ATTEMPTS) {
      // Max attempts reached
      await sock.sendMessage(sender, {
        text: TRANSLATIONS.pt.driverCpfMaxAttempts
      });

      // Clean up conversation state
      await prisma.conversationState.update({
        where: { userJid: sender },
        data: {
          isActive: false,
          completionReason: 'cpf_validation_failed'
        }
      });

      activeConversations.delete(sender);
      logger.info(`❌ CPF validation failed for ${sender} after ${newAttempts} attempts`);
      return true;
    }

    // Update attempts and ask again
    await prisma.conversationState.update({
      where: { userJid: sender },
      data: {
        cpfAttempts: newAttempts,
        lastActivityAt: new Date()
      }
    });

    await sock.sendMessage(sender, {
      text: TRANSLATIONS.pt.driverCpfInvalid(attemptsLeft)
    });

    logger.info(`⚠️ Invalid CPF attempt ${newAttempts}/${MAX_CPF_ATTEMPTS} for ${sender}`);
    return true;
  }

  // CPF found! Update driver's identifier (JID or LID) in database
  const normalizedSender = normalizeJid(sender);
  const identifierFields = prepareIdentifierFields(normalizedSender);
  const oldIdentifier = getPrimaryIdentifier(driver);

  logger.info(`✅ CPF validated for driver ${driver.id}, updating identifier from ${oldIdentifier} to ${normalizedSender} (original: ${sender})`);

  await prisma.driver.update({
    where: { id: driver.id },
    data: identifierFields
  });

  // Clean up conversation state
  await deleteConversationState(sender, 'cpf_validated');
  activeConversations.delete(sender);

  // Now process the ride acceptance with the validated driver
  const ride = await prisma.taxiRide.findUnique({
    where: { id: rideId },
    include: { user: true }
  });

  if (!ride) {
    await sock.sendMessage(sender, {
      text: '❌ Nenhuma corrida encontrada com este número.'
    });
    return true;
  }

  if (ride.status === 'expired') {
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida expirou porque nenhum motorista aceitou dentro do tempo de espera.'
    });
    return true;
  }

  if (ride.status === 'completed') {
    // Check if this driver is the one who accepted
    const existingAssignment = await prisma.rideAssignment.findUnique({
      where: { rideId: rideId },
      include: { driver: true }
    });

    if (existingAssignment && existingAssignment.driverId === driver.id) {
      // This driver already accepted - remind them with passenger details
      logger.info(`ℹ️ Driver ${sender} tried to re-accept their own ride ${rideId} during CPF validation`);

      // Format passenger reputation
      const passengerRep = formatReputation(ride.user.reputation, 'pt');

      await sock.sendMessage(sender, {
        text: `✅ Você já aceitou esta corrida!

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Reputação: ${passengerRep}
Local: ${ride.locationText}
Destino: ${ride.destination}
Identificação: ${ride.identifier}
Tempo de espera: ${ride.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.*
💰 *Por favor, acerte o valor com o passageiro.*

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
      });
      return true;
    }

    // Another driver accepted
    logger.info(`📤 Ride ${rideId} accepted by another driver, sending message to ${sender}`);
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida já foi aceita por outro motorista.'
    });
    logger.info(`✅ Sent "accepted by another driver" message to ${sender}`);
    return true;
  }

  if (ride.status !== 'pending') {
    logger.info(`📤 Ride ${rideId} not available (status: ${ride.status}), sending message to ${sender}`);
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida não está mais disponível.'
    });
    logger.info(`✅ Sent "not available" message to ${sender}`);
    return true;
  }

  // Check if there's already an assignment for this ride
  const existingAssignment = await prisma.rideAssignment.findUnique({
    where: { rideId: rideId }
  });

  if (existingAssignment) {
    // Assignment already exists - this ride was already accepted
    logger.warn(`⚠️ Ride ${rideId} already has an assignment to driver ${existingAssignment.driverId}`);
    logger.info(`📤 Sending "already accepted" message to ${sender}`);
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida já foi aceita por outro motorista.'
    });
    logger.info(`✅ Sent "already accepted by other driver" message to ${sender}`);
    return true;
  }

  // Update ride status and create assignment
  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'completed',
      completedAt: new Date()
    }
  });

  // Create the assignment separately to avoid constraint issues
  await prisma.rideAssignment.create({
    data: {
      rideId: rideId,
      driverId: driver.id
    }
  });

  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
    logger.info(`⏰ Cleared timeout for ride ${rideId}`);
  }

  // Clear keepalive interval
  clearKeepaliveInterval(rideId);

  const driverJid = sender;
  const passengerJid = getPrimaryIdentifier(ride.user);

  await scheduleFeedbackMessages(sock, ride.id, passengerJid, driverJid, ride.language);

  // Format passenger reputation for driver message
  const passengerRep = formatReputation(ride.user.reputation, 'pt');

  await sock.sendMessage(driverJid, {
    text: `✅ CPF validado! Corrida #${ride.id} aceita com sucesso! O passageiro será notificado.

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Reputação: ${passengerRep}
Local: ${ride.locationText}
Destino: ${ride.destination}
Identificação: ${ride.identifier}
Tempo de espera: ${ride.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.*
💰 *Por favor, acerte o valor com o passageiro.*

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
  });

  const t = TRANSLATIONS[ride.language];

  logger.info(`✉️ Sending ride acceptance to passenger:
    - Ride ID: ${ride.id}
    - Driver JID: ${driverJid}
    - Driver Name: ${driver.name || 'Not set'}
    - Driver Phone: ${driver.phone || 'Not set'}`);

  // Format driver reputation for passenger message
  const driverRep = formatReputation(driver.reputation, ride.language);

  await sock.sendMessage(passengerJid, {
    text: t.rideAccepted(ride.id, driverJid, driver.name, driver.phone, driverRep),
    mentions: [driverJid]
  });

  activeConversations.delete(getPrimaryIdentifier(ride.user));
  clearConversationTimeouts(getPrimaryIdentifier(ride.user));
  await deleteConversationState(getPrimaryIdentifier(ride.user), 'driver_accepted');

  userRideMap.set(getPrimaryIdentifier(ride.user), rideId);

  logger.info(`✅ Ride ${rideId} accepted by driver ${sender} after CPF validation`);

  return true;
}

module.exports = {
  processDriverResponse,
  handleUserCancellation,
  handleDriverCancellation,
  processCpfValidation
};
