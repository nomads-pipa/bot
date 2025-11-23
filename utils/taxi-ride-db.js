const { PrismaClient } = require('@prisma/client');
const { createFileLogger } = require('./file-logger');
const logger = createFileLogger();

const prisma = new PrismaClient();

// Conversation states for each user
const STATES = {
  IDLE: 'idle',
  AWAITING_LANGUAGE: 'awaiting_language',
  AWAITING_VEHICLE_TYPE: 'awaiting_vehicle_type',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_LOCATION_TEXT: 'awaiting_location_text',
  AWAITING_LOCATION_PIN: 'awaiting_location_pin',
  AWAITING_DESTINATION: 'awaiting_destination',
  AWAITING_IDENTIFIER: 'awaiting_identifier',
  AWAITING_WAIT_TIME: 'awaiting_wait_time',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  AWAITING_DRIVER_ACCEPTANCE: 'awaiting_driver_acceptance',
  AWAITING_RETRY_DECISION: 'awaiting_retry_decision',
  AWAITING_RETRY_WAIT_TIME: 'awaiting_retry_wait_time',
  AWAITING_DRIVER_CANCEL_DECISION: 'awaiting_driver_cancel_decision'
};

// Store active conversations: Map<sender_jid, conversationState>
const activeConversations = new Map();

// Store active ride timeouts: Map<rideId, timeoutId>
const activeRideTimeouts = new Map();

// Store conversation timeouts: Map<sender_jid, {timeoutId, warningId}>
const conversationTimeouts = new Map();

// Store user to ride mapping for cancellations: Map<userJid, rideId>
const userRideMap = new Map();

// Store active feedback timeouts: Map<rideId, {passengerTimeoutId, driverTimeoutId}>
const feedbackTimeouts = new Map();

// Timeout constants (in milliseconds)
const CONVERSATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const WARNING_TIME = 2.5 * 60 * 1000; // 2.5 minutes
const FEEDBACK_DELAY = 60 * 60 * 1000; // 1 hour

// Translations for different languages
const TRANSLATIONS = {
  en: {
    timeoutWarning: '⚠️ Warning: You have 2 minutes and 30 seconds left to answer, or your session will timeout and you\'ll need to start over.',
    timeoutExpired: '⏰ Your session has timed out due to inactivity. Please send "taxi" or "mototaxi" again to start a new ride request.',
    vehicleType: '🚖 What type of ride do you need?\n\n1️⃣ - Mototaxi 🏍️',
    vehicleTypeInvalid: '❌ Please select 1 for Mototaxi',
    greeting: '🚖 I\'ll help you find a ride - please answer some questions.',
    name: 'What is your name?',
    phone: '📱 What is your phone number? (include country code, e.g., +55 84 9 1234-5678)',
    phoneInvalid: '❌ Invalid phone format. Please include the country code starting with + (e.g., +55 84 9 1234-5678)',
    locationText: '📍 Where are you located? (describe your location in text)',
    locationPin: '📍 Please send your location using WhatsApp\'s location sharing feature',
    locationPinError: '❌ Please share your location using WhatsApp\'s location feature (attach icon 📎 Location)',
    destination: '🎯 Where do you want to go? (describe your destination)',
    identifier: '👕 What are you wearing or how can the driver identify you? (e.g., blue t-shirt, red cap)',
    waitTime: '⏰ How many minutes are you willing to wait for your ride? (Minimum: 5 minutes)',
    waitTimeInvalid: '❌ Please enter a valid number of at least 5 minutes.',
    confirmation: (userInfo, vehicleType) => `📋 *Please review your ride information:*

*Vehicle Type:* ${vehicleType === 'mototaxi' ? 'Mototaxi 🏍️' : 'Taxi 🚗'}
*Name:* ${userInfo.name}
*Phone:* ${userInfo.phone}
*Location:* ${userInfo.locationText}
*Destination:* ${userInfo.destination}
*Identifier:* ${userInfo.identifier}
*Wait Time:* ${userInfo.waitTime} minutes

Is this information correct?

Reply:
*CONFIRM* - to send your ride request
*CANCEL* - to cancel and start over`,
    confirmationInvalid: '❌ Please reply with *CONFIRM* to proceed or *CANCEL* to cancel.',
    cancelled: '❌ Ride request cancelled. Send "taxi" or "mototaxi" to start a new request.',
    requestSent: (rideId) => `✅ Your ride request has been sent to all available drivers. Please wait for a driver to accept...

*Ride #${rideId}*

To cancel this ride, reply with: *cancelar ${rideId}*`,
    noDrivers: '❌ Sorry, no drivers are registered in the system. Please contact support.',
    rideAccepted: (rideId, driverJid, driverName) => {
      const phoneNumber = driverJid.split('@')[0];
      const driverInfo = driverName ? `${driverName} (@${phoneNumber})` : `@${phoneNumber}`;

      // Format phone number with DDI: +55 84 92150464
      const formattedPhone = phoneNumber.startsWith('55')
        ? `+${phoneNumber.slice(0, 2)} ${phoneNumber.slice(2, 4)} ${phoneNumber.slice(4)}`
        : `+${phoneNumber}`;

      return `✅ Great news! A driver has accepted your ride request.

*Ride #${rideId}*
*Driver:* ${driverInfo}
*Phone:* ${formattedPhone}

The driver will contact you shortly. Have a safe trip! 🚖

To cancel this ride, reply with: *cancelar ${rideId}*`;
    },
    rideExpired: (waitTime) => `⏰ Sorry, no driver accepted your ride request within ${waitTime} minutes.

Would you like to try again using the same information?

1️⃣ - Yes, try again
2️⃣ - No, cancel request`,
    rideExpiredRetry: (waitTime) => `⏰ Still no driver available after ${waitTime} minutes.

Would you like to keep trying?

1️⃣ - Yes, try again
2️⃣ - No, cancel request`,
    retryWaitTime: 'How many minutes are you willing to wait this time? (Minimum: 5 minutes)',
    retryConfirmed: (waitTime) => `✅ Trying again! Your ride request has been sent to all available drivers. Waiting ${waitTime} minutes...`,
    retryCancelled: '❌ Ride request cancelled. Send "taxi" or "mototaxi" to start a new request.',
    retryInvalid: '❌ Please reply with 1 to try again or 2 to cancel.',
    userCancelled: (rideId) => `✅ Ride #${rideId} has been cancelled successfully.`,
    driverNotifiedCancel: (driverPhone) => `The driver has been notified of the cancellation.`,
    driverCancelled: (rideId) => `⚠️ The driver cancelled ride #${rideId}.

Would you like to try again with another driver?

1️⃣ - Yes, try again
2️⃣ - No, cancel request`,
    rideRebroadcast: (rideId) => `✅ Your ride request has been sent to all available drivers again. Please wait...

*Ride #${rideId}*

To cancel this ride, reply with: *cancelar ${rideId}*`,
    feedbackPassenger: (rideId) => `🌟 *How was your ride experience?*

We hope you had a great trip! We'd love to hear about your experience with ride #${rideId}.

Your feedback helps us improve our service for everyone in Pipa.

📝 Please share your feedback here:
https://forms.gle/vJLiACiQr3sq4aPFA

Thank you for using our taxi service! 🚖`,
    feedbackDriver: (rideId) => `🌟 *How was your ride experience?*

Thank you for completing ride #${rideId}! We'd love to hear about your experience.

Your feedback helps us improve our service for everyone in Pipa.

📝 Please share your feedback here:
https://forms.gle/vJLiACiQr3sq4aPFA

Thank you for being part of our driver community! 🚖`
  },
  pt: {
    timeoutWarning: '⚠️ Aviso: Você tem 2 minutos e 30 segundos restantes para responder, ou sua sessão expirará e você precisará começar de novo.',
    timeoutExpired: '⏰ Sua sessão expirou por inatividade. Por favor envie "taxi" ou "mototaxi" novamente para iniciar uma nova solicitação de corrida.',
    vehicleType: '🚖 Que tipo de corrida você precisa?\n\n1️⃣ - Mototaxi 🏍️',
    vehicleTypeInvalid: '❌ Por favor selecione 1 para Mototaxi',
    greeting: '🚖 Vou te ajudar a encontrar uma corrida - por favor responda algumas perguntas.',
    name: 'Qual é o seu nome?',
    phone: '📱 Qual é o seu número de telefone? (inclua código do país, ex: +55 84 9 1234-5678)',
    phoneInvalid: '❌ Formato de telefone inválido. Por favor inclua o código do país começando com + (ex: +55 84 9 1234-5678)',
    locationText: '📍 Onde você está? (descreva sua localização em texto)',
    locationPin: '📍 Por favor envie sua localização usando o recurso de compartilhamento de localização do WhatsApp',
    locationPinError: '❌ Por favor compartilhe sua localização usando o recurso de localização do WhatsApp (ícone anexo 📎 Localização)',
    destination: '🎯 Para onde você quer ir? (descreva seu destino)',
    identifier: '👕 O que você está vestindo ou como o motorista pode te identificar? (ex: camiseta azul, boné vermelho)',
    waitTime: '⏰ Quantos minutos você está disposto a esperar pela sua corrida? (Mínimo: 5 minutos)',
    waitTimeInvalid: '❌ Por favor insira um número válido de pelo menos 5 minutos.',
    confirmation: (userInfo, vehicleType) => `📋 *Por favor revise suas informações:*

*Tipo de Veículo:* ${vehicleType === 'mototaxi' ? 'Mototaxi 🏍️' : 'Táxi 🚗'}
*Nome:* ${userInfo.name}
*Telefone:* ${userInfo.phone}
*Localização:* ${userInfo.locationText}
*Destino:* ${userInfo.destination}
*Identificação:* ${userInfo.identifier}
*Tempo de Espera:* ${userInfo.waitTime} minutos

As informações estão corretas?

Responda:
*CONFIRMAR* - para enviar sua solicitação
*CANCELAR* - para cancelar e começar de novo`,
    confirmationInvalid: '❌ Por favor responda com *CONFIRMAR* para prosseguir ou *CANCELAR* para cancelar.',
    cancelled: '❌ Solicitação de corrida cancelada. Envie "taxi" ou "mototaxi" para iniciar uma nova solicitação.',
    requestSent: (rideId) => `✅ Sua solicitação de corrida foi enviada para todos os motoristas disponíveis. Por favor aguarde um motorista aceitar...

*Corrida #${rideId}*

Para cancelar esta corrida, responda com: *cancelar ${rideId}*`,
    noDrivers: '❌ Desculpe, nenhum motorista está registrado no sistema. Por favor contate o suporte.',
    rideAccepted: (rideId, driverJid, driverName) => {
      const phoneNumber = driverJid.split('@')[0];
      const driverInfo = driverName ? `${driverName} (@${phoneNumber})` : `@${phoneNumber}`;

      // Format phone number with DDI: +55 84 92150464
      const formattedPhone = phoneNumber.startsWith('55')
        ? `+${phoneNumber.slice(0, 2)} ${phoneNumber.slice(2, 4)} ${phoneNumber.slice(4)}`
        : `+${phoneNumber}`;

      return `✅ Ótimas notícias! Um motorista aceitou sua solicitação de corrida.

*Corrida #${rideId}*
*Motorista:* ${driverInfo}
*Telefone:* ${formattedPhone}

O motorista entrará em contato em breve. Tenha uma viagem segura! 🚖

Para cancelar esta corrida, responda com: *cancelar ${rideId}*`;
    },
    rideExpired: (waitTime) => `⏰ Desculpe, nenhum motorista aceitou sua solicitação de corrida dentro de ${waitTime} minutos.

Gostaria de insistir na corrida usando as mesmas informações?

1️⃣ - Sim, tentar novamente
2️⃣ - Não, cancelar solicitação`,
    rideExpiredRetry: (waitTime) => `⏰ Ainda nenhum motorista disponível após ${waitTime} minutos.

Gostaria de continuar tentando?

1️⃣ - Sim, tentar novamente
2️⃣ - Não, cancelar solicitação`,
    retryWaitTime: 'Quantos minutos você está disposto a esperar desta vez? (Mínimo: 5 minutos)',
    retryConfirmed: (waitTime) => `✅ Tentando novamente! Sua solicitação de corrida foi enviada para todos os motoristas disponíveis. Aguardando ${waitTime} minutos...`,
    retryCancelled: '❌ Solicitação de corrida cancelada. Envie "taxi" ou "mototaxi" para iniciar uma nova solicitação.',
    retryInvalid: '❌ Por favor responda com 1 para tentar novamente ou 2 para cancelar.',
    userCancelled: (rideId) => `✅ Corrida #${rideId} foi cancelada com sucesso.`,
    driverNotifiedCancel: (driverPhone) => `O motorista foi notificado do cancelamento.`,
    driverCancelled: (rideId) => `⚠️ O motorista cancelou a corrida #${rideId}.

Gostaria de tentar novamente com outro motorista?

1️⃣ - Sim, tentar novamente
2️⃣ - Não, cancelar solicitação`,
    rideRebroadcast: (rideId) => `✅ Sua solicitação de corrida foi enviada para todos os motoristas disponíveis novamente. Por favor aguarde...

*Corrida #${rideId}*

Para cancelar esta corrida, responda com: *cancelar ${rideId}*`,
    feedbackPassenger: (rideId) => `🌟 *Como foi sua experiência na corrida?*

Esperamos que você tenha tido uma ótima viagem! Gostaríamos de saber sobre sua experiência na corrida #${rideId}.

Seu feedback nos ajuda a melhorar nosso serviço para todos em Pipa.

📝 Por favor, compartilhe seu feedback aqui:
https://forms.gle/vJLiACiQr3sq4aPFA

Obrigado por usar nosso serviço de táxi! 🚖`,
    feedbackDriver: (rideId) => `🌟 *Como foi sua experiência na corrida?*

Obrigado por completar a corrida #${rideId}! Gostaríamos de saber sobre sua experiência.

Seu feedback nos ajuda a melhorar nosso serviço para todos em Pipa.

📝 Por favor, compartilhe seu feedback aqui:
https://forms.gle/vJLiACiQr3sq4aPFA

Obrigado por fazer parte da nossa comunidade de motoristas! 🚖`
  }
};

function isTaxiRequest(message) {
  const lowerMsg = message.toLowerCase();
  return lowerMsg.includes('mototaxi') || lowerMsg.includes('taxi');
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  const phoneRegex = /^\+[1-9]\d{8,14}$/;
  return phoneRegex.test(cleaned);
}

async function scheduleFeedbackMessages(sock, rideId, passengerJid, driverJid, language) {
  logger.info(`⏰ Scheduling feedback messages for ride ${rideId} in 1 hour`);

  const t = TRANSLATIONS[language] || TRANSLATIONS['en'];

  // Schedule feedback message for passenger
  const passengerTimeoutId = setTimeout(async () => {
    try {
      await sock.sendMessage(passengerJid, {
        text: t.feedbackPassenger(rideId)
      });
      logger.info(`✅ Sent feedback request to passenger for ride ${rideId}`);

      // Mark feedback as sent in the database
      await prisma.taxiRide.update({
        where: { id: rideId },
        data: { feedbackSent: true }
      });
    } catch (error) {
      logger.error(`❌ Failed to send feedback to passenger for ride ${rideId}:`, error);
    }
  }, FEEDBACK_DELAY);

  // Schedule feedback message for driver
  const driverTimeoutId = setTimeout(async () => {
    try {
      await sock.sendMessage(driverJid, {
        text: t.feedbackDriver(rideId)
      });
      logger.info(`✅ Sent feedback request to driver for ride ${rideId}`);
    } catch (error) {
      logger.error(`❌ Failed to send feedback to driver for ride ${rideId}:`, error);
    }
  }, FEEDBACK_DELAY);

  feedbackTimeouts.set(rideId, {
    passengerTimeoutId,
    driverTimeoutId
  });

  logger.info(`⏰ Feedback messages scheduled for ride ${rideId}`);
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
      feedbackSent: false
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
      // Send immediately
      logger.info(`📧 Sending overdue feedback requests for ride ${ride.id}`);

      const t = TRANSLATIONS[ride.language];
      try {
        await sock.sendMessage(ride.user.jid, {
          text: t.feedbackPassenger(ride.id)
        });
        logger.info(`✅ Sent feedback request to passenger for ride ${ride.id}`);
      } catch (error) {
        logger.error(`❌ Failed to send feedback to passenger for ride ${ride.id}:`, error);
      }

      try {
        await sock.sendMessage(ride.assignment.driver.jid, {
          text: t.feedbackDriver(ride.id)
        });
        logger.info(`✅ Sent feedback request to driver for ride ${ride.id}`);
      } catch (error) {
        logger.error(`❌ Failed to send feedback to driver for ride ${ride.id}:`, error);
      }

      await prisma.taxiRide.update({
        where: { id: ride.id },
        data: { feedbackSent: true }
      });

      sentCount++;
    } else {
      // Reschedule
      await scheduleFeedbackMessages(sock, ride.id, ride.user.jid, ride.assignment.driver.jid, ride.language);
      logger.info(`⏰ Restored feedback timeout for ride ${ride.id} - will send in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  logger.info(`🔄 Feedback timeout restoration complete: ${restoredCount} restored, ${sentCount} sent immediately, ${skippedCount} already sent`);
}

async function restoreRideTimeouts(sock) {
  const now = new Date();
  let restoredCount = 0;
  let expiredCount = 0;

  const pendingRides = await prisma.taxiRide.findMany({
    where: { status: 'pending' },
    include: { user: true }
  });

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
        await sock.sendMessage(ride.user.jid, {
          text: t.rideExpired(waitTimeMinutes)
        });
      } catch (error) {
        logger.error(`Failed to send expiration message:`, error);
      }

      activeConversations.delete(ride.user.jid);
      clearConversationTimeouts(ride.user.jid);

      expiredCount++;
    } else {
      // Reschedule
      const timeoutId = setTimeout(() => {
        handleRideTimeout(sock, ride.id, ride.user.jid, waitTimeMinutes, ride.language);
      }, timeRemaining);

      activeRideTimeouts.set(ride.id, timeoutId);
      logger.info(`⏰ Restored timeout for ride ${ride.id} - will expire in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  logger.info(`🔄 Ride timeout restoration complete: ${restoredCount} restored, ${expiredCount} expired`);
}

async function saveConversationState(sender, conversation) {
  try {
    const now = new Date();

    await prisma.conversationState.upsert({
      where: { userJid: sender },
      update: {
        state: conversation.state,
        language: conversation.language,
        vehicleType: conversation.vehicleType,
        skipUserInfo: conversation.skipUserInfo || false,
        name: conversation.userInfo?.name,
        phone: conversation.userInfo?.phone,
        locationText: conversation.userInfo?.locationText,
        locationLat: conversation.userInfo?.locationPin?.latitude,
        locationLng: conversation.userInfo?.locationPin?.longitude,
        destination: conversation.userInfo?.destination,
        identifier: conversation.userInfo?.identifier,
        waitTime: conversation.userInfo?.waitTime,
        rideId: conversation.rideId,
        lastActivityAt: now
      },
      create: {
        userJid: sender,
        state: conversation.state,
        language: conversation.language,
        vehicleType: conversation.vehicleType,
        skipUserInfo: conversation.skipUserInfo || false,
        name: conversation.userInfo?.name,
        phone: conversation.userInfo?.phone,
        locationText: conversation.userInfo?.locationText,
        locationLat: conversation.userInfo?.locationPin?.latitude,
        locationLng: conversation.userInfo?.locationPin?.longitude,
        destination: conversation.userInfo?.destination,
        identifier: conversation.userInfo?.identifier,
        waitTime: conversation.userInfo?.waitTime,
        rideId: conversation.rideId,
        conversationStartedAt: now,
        lastActivityAt: now
      }
    });

    logger.info(`💾 Saved conversation state for ${sender} (${conversation.state})`);
  } catch (error) {
    logger.error(`❌ Failed to save conversation state for ${sender}:`, error);
  }
}

async function deleteConversationState(sender, reason = 'completed') {
  try {
    await prisma.conversationState.update({
      where: { userJid: sender },
      data: {
        isActive: false,
        completionReason: reason,
        completedAt: new Date()
      }
    });
    logger.info(`✅ Marked conversation state as inactive for ${sender} (${reason})`);
  } catch (error) {
    // It's okay if the conversation doesn't exist
    if (error.code !== 'P2025') {
      logger.error(`❌ Failed to update conversation state for ${sender}:`, error);
    }
  }
}

async function restoreConversationStates(sock) {
  const now = new Date();
  const CONVERSATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  const WARNING_TIME_MS = 2.5 * 60 * 1000; // 2.5 minutes

  let restoredCount = 0;
  let expiredCount = 0;

  const activeStates = await prisma.conversationState.findMany({
    where: { isActive: true }
  });

  for (const state of activeStates) {
    const timeSinceLastActivity = now - state.lastActivityAt;

    if (timeSinceLastActivity >= CONVERSATION_TIMEOUT_MS) {
      // Conversation has already timed out - expire it
      logger.info(`⏰ Expiring conversation for ${state.userJid} (inactive for ${Math.round(timeSinceLastActivity / 60000)} minutes)`);

      const t = TRANSLATIONS[state.language || 'en'];
      try {
        await sock.sendMessage(state.userJid, {
          text: t.timeoutExpired
        });
      } catch (error) {
        logger.error(`Failed to send timeout message to ${state.userJid}:`, error);
      }

      // Mark the conversation state as expired
      await deleteConversationState(state.userJid, 'timeout');
      expiredCount++;
      continue;
    }

    // Restore the conversation to memory
    const conversation = {
      state: state.state,
      language: state.language,
      vehicleType: state.vehicleType,
      skipUserInfo: state.skipUserInfo,
      userInfo: {
        name: state.name,
        phone: state.phone,
        locationText: state.locationText,
        locationPin: state.locationLat && state.locationLng ? {
          latitude: state.locationLat,
          longitude: state.locationLng
        } : undefined,
        destination: state.destination,
        identifier: state.identifier,
        waitTime: state.waitTime
      },
      rideId: state.rideId
    };

    activeConversations.set(state.userJid, conversation);

    // Calculate remaining time for timeouts
    const timeUntilWarning = WARNING_TIME_MS - timeSinceLastActivity;
    const timeUntilTimeout = CONVERSATION_TIMEOUT_MS - timeSinceLastActivity;

    if (timeUntilWarning > 0) {
      // Schedule warning
      const warningId = setTimeout(() => {
        handleConversationWarning(sock, state.userJid, state.language || 'en');
      }, timeUntilWarning);

      // Schedule timeout
      const timeoutId = setTimeout(() => {
        handleConversationTimeout(sock, state.userJid, state.language || 'en');
      }, timeUntilTimeout);

      conversationTimeouts.set(state.userJid, { warningId, timeoutId });

      logger.info(`⏰ Restored conversation for ${state.userJid} (${state.state}) - warning in ${Math.round(timeUntilWarning / 60000)}m, timeout in ${Math.round(timeUntilTimeout / 60000)}m`);
    } else {
      // Only timeout remaining (warning already passed)
      const timeoutId = setTimeout(() => {
        handleConversationTimeout(sock, state.userJid, state.language || 'en');
      }, timeUntilTimeout);

      conversationTimeouts.set(state.userJid, { warningId: null, timeoutId });

      logger.info(`⏰ Restored conversation for ${state.userJid} (${state.state}) - timeout in ${Math.round(timeUntilTimeout / 60000)}m (warning already passed)`);
    }

    restoredCount++;
  }

  logger.info(`🔄 Conversation state restoration complete: ${restoredCount} restored, ${expiredCount} expired`);
}

async function initTaxiRide(sock) {
  if (sock) {
    await restoreRideTimeouts(sock);
    await restoreFeedbackTimeouts(sock);
    await restoreConversationStates(sock);
  }

  logger.info('Taxi ride module initialized with database');
}

async function getDriverNumbers(vehicleType) {
  try {
    const whereClause = vehicleType === 'mototaxi'
      ? { isMotoTaxiDriver: true, isActive: true }
      : { isTaxiDriver: true, isActive: true };

    const drivers = await prisma.driver.findMany({
      where: whereClause,
      select: { jid: true }
    });

    if (drivers.length === 0) {
      logger.warn(`No active ${vehicleType} drivers found in database`);
      return [];
    }

    logger.info(`Found ${drivers.length} active ${vehicleType} drivers in database`);
    return drivers.map(driver => driver.jid);
  } catch (error) {
    logger.error(`Error fetching ${vehicleType} drivers from database:`, error);
    return [];
  }
}

async function isRegisteredDriver(sender) {
  try {
    const driver = await prisma.driver.findUnique({
      where: { jid: sender },
      select: {
        isActive: true,
        isTaxiDriver: true,
        isMotoTaxiDriver: true
      }
    });

    return driver && driver.isActive && (driver.isTaxiDriver || driver.isMotoTaxiDriver);
  } catch (error) {
    logger.error('Error checking if sender is registered driver:', error);
    return false;
  }
}

async function createInitialRide(sender, vehicleType, language, userInfo = {}) {
  // Get or create user
  const user = await prisma.user.upsert({
    where: { jid: sender },
    update: {
      name: userInfo.name || null,
      phone: userInfo.phone || null
    },
    create: {
      jid: sender,
      name: userInfo.name || null,
      phone: userInfo.phone || null
    }
  });

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
  // Get or create user
  const user = await prisma.user.upsert({
    where: { jid: sender },
    update: {
      name: userInfo.name,
      phone: userInfo.phone
    },
    create: {
      jid: sender,
      name: userInfo.name,
      phone: userInfo.phone
    }
  });

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

function clearConversationTimeouts(sender) {
  const timeouts = conversationTimeouts.get(sender);
  if (timeouts) {
    if (timeouts.warningId) {
      clearTimeout(timeouts.warningId);
    }
    if (timeouts.timeoutId) {
      clearTimeout(timeouts.timeoutId);
    }
    conversationTimeouts.delete(sender);
    logger.info(`⏰ Cleared timeouts for ${sender}`);
  }
}

async function handleConversationTimeout(sock, sender, language) {
  const t = TRANSLATIONS[language] || TRANSLATIONS['en'];
  const conversation = activeConversations.get(sender);

  // If a ride was created, mark it as expired
  if (conversation && conversation.rideId) {
    await prisma.taxiRide.update({
      where: { id: conversation.rideId },
      data: {
        status: 'expired',
        expiredAt: new Date()
      }
    });
    logger.info(`⏰ Marked ride ${conversation.rideId} as expired due to conversation timeout`);
  }

  await sock.sendMessage(sender, {
    text: t.timeoutExpired
  });

  activeConversations.delete(sender);
  clearConversationTimeouts(sender);
  await deleteConversationState(sender, 'timeout');

  logger.info(`⏰ Conversation timed out for ${sender}`);
}

async function handleConversationWarning(sock, sender, language) {
  const t = TRANSLATIONS[language] || TRANSLATIONS['en'];

  await sock.sendMessage(sender, {
    text: t.timeoutWarning
  });

  logger.info(`⚠️ Sent timeout warning to ${sender}`);
}

function resetConversationTimeout(sock, sender, language) {
  clearConversationTimeouts(sender);

  const warningId = setTimeout(() => {
    handleConversationWarning(sock, sender, language);
  }, WARNING_TIME);

  const timeoutId = setTimeout(() => {
    handleConversationTimeout(sock, sender, language);
  }, CONVERSATION_TIMEOUT);

  conversationTimeouts.set(sender, { warningId, timeoutId });
  logger.info(`⏰ Set conversation timeout for ${sender}`);
}

async function startRideRequest(sock, sender) {
  // Check if user already exists in the database
  const existingUser = await prisma.user.findUnique({
    where: { jid: sender }
  });

  // Check if we have complete user info (name and phone)
  const hasCompleteInfo = existingUser && existingUser.name && existingUser.phone;

  if (hasCompleteInfo) {
    // Returning user with complete info - skip to language selection with personalized greeting
    const conversation = {
      state: STATES.AWAITING_LANGUAGE,
      userInfo: {
        name: existingUser.name,
        phone: existingUser.phone
      },
      language: null,
      vehicleType: null,
      rideId: null,
      skipUserInfo: true // Flag to skip name/phone questions
    };

    activeConversations.set(sender, conversation);
    await saveConversationState(sender, conversation);

    await sock.sendMessage(sender, {
      text: `🚖 Welcome back, ${existingUser.name}! / Bem-vindo de volta, ${existingUser.name}!

Please select your language / Por favor selecione seu idioma:

1️⃣ - English
2️⃣ - Português`
    });

    logger.info(`🚖 Started taxi ride request for returning user ${sender} (${existingUser.name})`);
  } else {
    // New user or incomplete info - standard flow
    const conversation = {
      state: STATES.AWAITING_LANGUAGE,
      userInfo: {},
      language: null,
      vehicleType: null,
      rideId: null,
      skipUserInfo: false
    };

    activeConversations.set(sender, conversation);
    await saveConversationState(sender, conversation);

    await sock.sendMessage(sender, {
      text: `🚖 Welcome! Please select your language / Bem-vindo! Por favor selecione seu idioma:

1️⃣ - English
2️⃣ - Português`
    });

    logger.info(`🚖 Started taxi ride request for new user ${sender}`);
  }

  resetConversationTimeout(sock, sender, 'en');
}

async function processTaxiConversation(sock, message, sender) {
  const conversation = activeConversations.get(sender);

  if (!conversation) {
    return false;
  }

  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;
  const locationMessage = message.message.locationMessage;
  const t = TRANSLATIONS[conversation.language];

  if (conversation.state !== STATES.AWAITING_DRIVER_ACCEPTANCE) {
    const currentLanguage = conversation.language || 'en';
    resetConversationTimeout(sock, sender, currentLanguage);
  }

  switch (conversation.state) {
    case STATES.AWAITING_LANGUAGE:
      const choice = messageContent?.trim();
      if (choice === '1') {
        conversation.language = 'en';
      } else if (choice === '2') {
        conversation.language = 'pt';
      } else {
        await sock.sendMessage(sender, {
          text: 'Please select 1 for English or 2 for Português / Por favor selecione 1 para English ou 2 para Português'
        });
        return true;
      }

      conversation.state = STATES.AWAITING_VEHICLE_TYPE;
      await saveConversationState(sender, conversation);

      await sock.sendMessage(sender, {
        text: TRANSLATIONS[conversation.language].vehicleType
      });
      break;

    case STATES.AWAITING_VEHICLE_TYPE:
      const vehicleChoice = messageContent?.trim();
      if (vehicleChoice === '1') {
        conversation.vehicleType = 'mototaxi';
      } else {
        await sock.sendMessage(sender, {
          text: t.vehicleTypeInvalid
        });
        return true;
      }

      // Create the ride record now that we have language and vehicle type
      const initialRide = await createInitialRide(sender, conversation.vehicleType, conversation.language, conversation.userInfo);
      conversation.rideId = initialRide.id;

      // Check if we should skip user info questions
      if (conversation.skipUserInfo) {
        // Skip directly to location questions
        conversation.state = STATES.AWAITING_LOCATION_TEXT;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: t.greeting
        });
        await sock.sendMessage(sender, {
          text: t.locationText
        });
      } else {
        // Ask for name as usual
        conversation.state = STATES.AWAITING_NAME;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: t.greeting
        });
        await sock.sendMessage(sender, {
          text: t.name
        });
      }
      break;

    case STATES.AWAITING_NAME:
      conversation.userInfo.name = messageContent;

      // Update user and ride in database
      if (conversation.rideId) {
        await prisma.user.update({
          where: { jid: sender },
          data: { name: messageContent }
        });
      }

      conversation.state = STATES.AWAITING_PHONE;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, {
        text: t.phone
      });
      break;

    case STATES.AWAITING_PHONE:
      if (validatePhoneNumber(messageContent)) {
        conversation.userInfo.phone = messageContent;

        // Update user in database
        if (conversation.rideId) {
          await prisma.user.update({
            where: { jid: sender },
            data: { phone: messageContent }
          });
        }

        conversation.state = STATES.AWAITING_LOCATION_TEXT;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: t.locationText
        });
      } else {
        await sock.sendMessage(sender, {
          text: t.phoneInvalid
        });
      }
      break;

    case STATES.AWAITING_LOCATION_TEXT:
      conversation.userInfo.locationText = messageContent;

      // Update ride in database
      if (conversation.rideId) {
        await updateRide(conversation.rideId, { locationText: messageContent });
      }

      conversation.state = STATES.AWAITING_LOCATION_PIN;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, {
        text: TRANSLATIONS[conversation.language].locationPin
      });
      break;

    case STATES.AWAITING_LOCATION_PIN:
      if (locationMessage) {
        conversation.userInfo.locationPin = {
          latitude: locationMessage.degreesLatitude,
          longitude: locationMessage.degreesLongitude
        };

        // Update ride in database
        if (conversation.rideId) {
          await updateRide(conversation.rideId, {
            locationLat: locationMessage.degreesLatitude,
            locationLng: locationMessage.degreesLongitude
          });
        }

        conversation.state = STATES.AWAITING_DESTINATION;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: TRANSLATIONS[conversation.language].destination
        });
      } else {
        await sock.sendMessage(sender, {
          text: TRANSLATIONS[conversation.language].locationPinError
        });
      }
      break;

    case STATES.AWAITING_DESTINATION:
      conversation.userInfo.destination = messageContent;

      // Update ride in database
      if (conversation.rideId) {
        await updateRide(conversation.rideId, { destination: messageContent });
      }

      conversation.state = STATES.AWAITING_IDENTIFIER;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, {
        text: TRANSLATIONS[conversation.language].identifier
      });
      break;

    case STATES.AWAITING_IDENTIFIER:
      conversation.userInfo.identifier = messageContent;

      // Update ride in database
      if (conversation.rideId) {
        await updateRide(conversation.rideId, { identifier: messageContent });
      }

      conversation.state = STATES.AWAITING_WAIT_TIME;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, {
        text: TRANSLATIONS[conversation.language].waitTime
      });
      break;

    case STATES.AWAITING_WAIT_TIME:
      const waitTimeMinutes = parseInt(messageContent, 10);
      if (isNaN(waitTimeMinutes) || waitTimeMinutes < 5) {
        await sock.sendMessage(sender, {
          text: t.waitTimeInvalid
        });
        return true;
      }
      conversation.userInfo.waitTime = messageContent;

      // Update ride in database
      if (conversation.rideId) {
        await updateRide(conversation.rideId, { waitTime: messageContent });
      }

      conversation.state = STATES.AWAITING_CONFIRMATION;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, {
        text: t.confirmation(conversation.userInfo, conversation.vehicleType)
      });
      break;

    case STATES.AWAITING_CONFIRMATION:
      const confirmationChoice = messageContent?.trim().toUpperCase();

      if (confirmationChoice === 'CONFIRM' || confirmationChoice === 'CONFIRMAR') {
        conversation.state = STATES.AWAITING_DRIVER_ACCEPTANCE;
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'ride_requested');
        await broadcastRideToDrivers(sock, sender, conversation);
      } else if (confirmationChoice === 'CANCEL' || confirmationChoice === 'CANCELAR') {
        // Mark the ride as cancelled/expired if it was created
        if (conversation.rideId) {
          await prisma.taxiRide.update({
            where: { id: conversation.rideId },
            data: {
              status: 'cancelled',
              cancelledBy: 'user',
              cancelledAt: new Date()
            }
          });
          logger.info(`❌ Ride ${conversation.rideId} cancelled by user during confirmation`);
        }

        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'user_cancelled');
        await sock.sendMessage(sender, {
          text: t.cancelled
        });
      } else {
        await sock.sendMessage(sender, {
          text: t.confirmationInvalid
        });
      }
      break;

    case STATES.AWAITING_RETRY_DECISION:
      const retryChoice = messageContent?.trim();

      if (retryChoice === '1') {
        // User wants to retry - ask for new wait time
        conversation.state = STATES.AWAITING_RETRY_WAIT_TIME;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: t.retryWaitTime
        });
      } else if (retryChoice === '2') {
        // User wants to cancel - mark ride as cancelled
        if (conversation.rideId) {
          await prisma.taxiRide.update({
            where: { id: conversation.rideId },
            data: {
              status: 'cancelled',
              cancelledBy: 'user',
              cancelledAt: new Date()
            }
          });
          logger.info(`❌ Ride ${conversation.rideId} cancelled by user after expiration`);
        }

        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'user_cancelled_after_retry');
        await sock.sendMessage(sender, {
          text: t.retryCancelled
        });
      } else {
        await sock.sendMessage(sender, {
          text: t.retryInvalid
        });
      }
      break;

    case STATES.AWAITING_RETRY_WAIT_TIME:
      const newWaitTimeMinutes = parseInt(messageContent, 10);
      if (isNaN(newWaitTimeMinutes) || newWaitTimeMinutes < 5) {
        await sock.sendMessage(sender, {
          text: t.waitTimeInvalid
        });
        return true;
      }

      // Update wait time
      conversation.userInfo.waitTime = messageContent;

      // Get the expired ride
      const expiredRide = await prisma.taxiRide.findUnique({
        where: { id: conversation.rideId }
      });

      if (!expiredRide) {
        logger.error(`❌ Could not find expired ride ${conversation.rideId} for retry`);
        await sock.sendMessage(sender, {
          text: t.retryCancelled
        });
        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'ride_not_found');
        return true;
      }

      // Reuse the same ride - update it to pending status, increment retry count, and update wait time
      await prisma.taxiRide.update({
        where: { id: conversation.rideId },
        data: {
          status: 'pending',
          waitTime: messageContent,
          retryAttempts: (expiredRide.retryAttempts || 0) + 1,
          expiredAt: null // Clear the expired timestamp
        }
      });

      conversation.state = STATES.AWAITING_DRIVER_ACCEPTANCE;
      await saveConversationState(sender, conversation);

      logger.info(`🔄 Retry attempt ${(expiredRide.retryAttempts || 0) + 1} for ride ${conversation.rideId} - keeping same ride ID`);

      // Send confirmation message
      await sock.sendMessage(sender, {
        text: t.retryConfirmed(newWaitTimeMinutes)
      });

      // Broadcast to drivers
      clearConversationTimeouts(sender);
      await broadcastRideToDrivers(sock, sender, conversation);
      break;

    case STATES.AWAITING_DRIVER_CANCEL_DECISION:
      const driverCancelChoice = messageContent?.trim();

      if (driverCancelChoice === '1') {
        // User wants to try again - rebroadcast with same wait time
        const cancelledRide = await prisma.taxiRide.findUnique({
          where: { id: conversation.rideId }
        });

        if (!cancelledRide) {
          logger.error(`❌ Could not find cancelled ride ${conversation.rideId} for rebroadcast`);
          await sock.sendMessage(sender, {
            text: t.retryCancelled
          });
          activeConversations.delete(sender);
          clearConversationTimeouts(sender);
          await deleteConversationState(sender, 'ride_not_found');
          return true;
        }

        // Update ride back to pending
        await prisma.taxiRide.update({
          where: { id: conversation.rideId },
          data: {
            status: 'pending',
            cancelledBy: null,
            cancelledAt: null
          }
        });

        conversation.state = STATES.AWAITING_DRIVER_ACCEPTANCE;
        await saveConversationState(sender, conversation);

        logger.info(`🔄 Rebroadcasting ride ${conversation.rideId} after driver cancellation`);

        // Send confirmation and rebroadcast
        await sock.sendMessage(sender, {
          text: t.rideRebroadcast(conversation.rideId)
        });

        // Broadcast to drivers
        clearConversationTimeouts(sender);
        await rebroadcastRideAfterDriverCancel(sock, cancelledRide, conversation);
      } else if (driverCancelChoice === '2') {
        // User wants to cancel
        if (conversation.rideId) {
          await prisma.taxiRide.update({
            where: { id: conversation.rideId },
            data: {
              status: 'cancelled',
              cancelledBy: 'user',
              cancelledAt: new Date()
            }
          });
          logger.info(`❌ Ride ${conversation.rideId} cancelled by user after driver cancellation`);
        }

        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'user_cancelled_after_driver_cancel');
        await sock.sendMessage(sender, {
          text: t.retryCancelled
        });
      } else {
        await sock.sendMessage(sender, {
          text: t.retryInvalid
        });
      }
      break;
  }

  return true;
}

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

  // Clear the timeout
  activeRideTimeouts.delete(rideId);

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

async function rebroadcastRideAfterDriverCancel(sock, ride, conversation) {
  const driverNumbers = await getDriverNumbers(ride.vehicleType);

  if (driverNumbers.length === 0) {
    const t = TRANSLATIONS[ride.language];
    await sock.sendMessage(ride.user.jid, {
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

  const driverMessage = `${vehicleIcon} *NOVA CORRIDA AUTOMÁTICA - ${vehicleLabel}*
*[RE-ENVIADA - Motorista anterior cancelou]*

*Passageiro:* ${conversation.userInfo.name}
*Telefone:* ${conversation.userInfo.phone}
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
    const timeoutId = setTimeout(() => {
      handleRideTimeout(sock, ride.id, ride.user.jid, waitTimeMinutes, ride.language);
    }, timeoutMs);

    activeRideTimeouts.set(ride.id, timeoutId);
    logger.info(`⏰ Set new timeout for re-broadcasted ride ${ride.id}`);
  }
}

async function broadcastRideToDrivers(sock, sender, conversation) {
  const { userInfo, language, vehicleType, rideId } = conversation;
  const t = TRANSLATIONS[language];

  // Use existing ride if we have one, otherwise create new one (for backward compatibility)
  let ride;
  if (rideId) {
    ride = await prisma.taxiRide.findUnique({ where: { id: rideId } });
  } else {
    ride = await createRide(sender, userInfo, vehicleType, language);
  }

  await sock.sendMessage(sender, {
    text: t.requestSent(ride.id)
  });

  const driverNumbers = await getDriverNumbers(vehicleType);

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

  const driverMessage = `${vehicleIcon} *NOVA CORRIDA AUTOMÁTICA - ${vehicleLabel}*

*Passageiro:* ${userInfo.name}
*Telefone:* ${userInfo.phone}
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

  logger.info(`🚖 Broadcasted ${vehicleType} ride ${ride.id} to ${driverNumbers.length} drivers`);

  const waitTimeMinutes = parseInt(userInfo.waitTime, 10);
  if (!isNaN(waitTimeMinutes) && waitTimeMinutes > 0) {
    const timeoutMs = waitTimeMinutes * 60 * 1000;
    const timeoutId = setTimeout(() => {
      handleRideTimeout(sock, ride.id, sender, waitTimeMinutes, language);
    }, timeoutMs);

    activeRideTimeouts.set(ride.id, timeoutId);
    logger.info(`⏰ Set timeout for ride ${ride.id} - will expire in ${waitTimeMinutes} minutes`);
  }
}

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

  const acceptanceRegex = /^(?:aceitar\s+(?:corrida\s+)?)?(\d+)$/i;
  const match = messageContent.trim().match(acceptanceRegex);

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

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
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida já foi aceita por outro motorista.'
    });
    return true;
  }

  if (ride.status !== 'pending') {
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida não está mais disponível.'
    });
    return true;
  }

  // Get or create driver
  const driver = await prisma.driver.upsert({
    where: { jid: sender },
    update: {},
    create: { jid: sender }
  });

  // Update ride and create assignment
  await prisma.taxiRide.update({
    where: { id: rideId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      assignment: {
        create: {
          driverId: driver.id
        }
      }
    }
  });

  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
    logger.info(`⏰ Cleared timeout for ride ${rideId}`);
  }

  const driverJid = sender;
  const passengerJid = ride.user.jid;

  await scheduleFeedbackMessages(sock, ride.id, passengerJid, driverJid, ride.language);

  await sock.sendMessage(driverJid, {
    text: `✅ Corrida #${ride.id} aceita com sucesso! O passageiro será notificado.

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Local: ${ride.locationText}
Destino: ${ride.destination}
Identificação: ${ride.identifier}
Tempo de espera: ${ride.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.*

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
  });

  const t = TRANSLATIONS[ride.language];

  logger.info(`✉️ Sending ride acceptance to passenger:
    - Ride ID: ${ride.id}
    - Driver JID: ${driverJid}
    - Driver Name: ${driver.name || 'Not set'}`);

  await sock.sendMessage(passengerJid, {
    text: t.rideAccepted(ride.id, driverJid, driver.name),
    mentions: [driverJid]
  });

  activeConversations.delete(ride.user.jid);
  clearConversationTimeouts(ride.user.jid);
  await deleteConversationState(ride.user.jid, 'driver_accepted');

  userRideMap.set(ride.user.jid, rideId);

  logger.info(`✅ Ride ${rideId} accepted by driver ${sender}`);

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

  if (ride.user.jid !== sender) {
    await sock.sendMessage(sender, {
      text: '❌ You cannot cancel this ride / Você não pode cancelar esta corrida.'
    });
    return true;
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
  userRideMap.delete(sender);

  const t = TRANSLATIONS[ride.language];

  await sock.sendMessage(sender, {
    text: t.userCancelled(rideId)
  });

  if (ride.assignment && ride.assignment.driver) {
    await sock.sendMessage(ride.assignment.driver.jid, {
      text: `❌ *CORRIDA CANCELADA PELO PASSAGEIRO*

*Corrida #${rideId}*
O passageiro ${ride.user.name} cancelou a corrida.

🤖 Esta é uma mensagem automática do sistema.`
    });

    await sock.sendMessage(sender, {
      text: t.driverNotifiedCancel(ride.assignment.driver.jid.replace('@s.whatsapp.net', ''))
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

  if (!ride.assignment || ride.assignment.driver.jid !== sender) {
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
  userRideMap.delete(ride.user.jid);

  await sock.sendMessage(sender, {
    text: `✅ Corrida #${rideId} foi cancelada. O passageiro será consultado se deseja reenviar.`
  });

  const t = TRANSLATIONS[ride.language];

  // Ask passenger if they want to rebroadcast
  await sock.sendMessage(ride.user.jid, {
    text: t.driverCancelled(rideId)
  });

  logger.info(`❌ Ride ${rideId} cancelled by driver ${sender}, asking passenger about rebroadcast...`);

  // Set conversation timeout for decision
  resetConversationTimeout(sock, ride.user.jid, ride.language);

  // Set up conversation state for driver cancel retry flow
  const conversationState = await prisma.conversationState.upsert({
    where: { userJid: ride.user.jid },
    update: {
      state: 'awaiting_driver_cancel_decision',
      rideId: rideId,
      lastActivityAt: new Date(),
      isActive: true
    },
    create: {
      userJid: ride.user.jid,
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
  activeConversations.set(ride.user.jid, {
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

const CHATGPT_WHATSAPP = '18002428478@s.whatsapp.net';

function isRideHistoryRequest(messageContent) {
  if (!messageContent) return false;
  const normalizedContent = messageContent.toLowerCase().trim();
  return normalizedContent === 'my rides' ||
         normalizedContent === 'minhas corridas';
}

async function sendRideHistory(sock, sender) {
  logger.info(`📋 Ride history requested by sender: ${sender}`);

  // Find the user in the database
  const user = await prisma.user.findUnique({
    where: { jid: sender },
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

  if (!user) {
    logger.warn(`📋 User not found in database for JID: ${sender}`);

    // Debug: Check if there are any users in the database
    const allUsers = await prisma.user.findMany({
      select: { jid: true, phone: true }
    });
    logger.info(`📋 Total users in database: ${allUsers.length}`);
    if (allUsers.length > 0) {
      logger.info(`📋 Sample JIDs: ${allUsers.slice(0, 3).map(u => u.jid).join(', ')}`);
    }
  }

  if (!user || user.taxiRides.length === 0) {
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
  const maxRides = Math.min(user.taxiRides.length, 5);
  let report = `📋 *Your Last ${maxRides} Ride(s) / Suas Últimas ${maxRides} Corrida(s)*\n\n`;

  if (user.taxiRides.length > 5) {
    report += `_Showing the 5 most recent rides / Mostrando as 5 corridas mais recentes_\n\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const mentions = [];

  for (let i = 0; i < maxRides; i++) {
    const ride = user.taxiRides[i];
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
      const driverPhone = ride.assignment.driver.jid.split('@')[0];
      report += `👤 *Driver / Motorista:* @${driverPhone}\n`;
      // Collect driver JID for mentions
      mentions.push(ride.assignment.driver.jid);
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

async function processTaxiMessage(sock, message, sender) {
  if (sender === CHATGPT_WHATSAPP) {
    return false;
  }

  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (activeConversations.has(sender)) {
    return await processTaxiConversation(sock, message, sender);
  }

  const isUserCancellation = await handleUserCancellation(sock, message, sender);
  if (isUserCancellation) return true;

  const isDriverCancellation = await handleDriverCancellation(sock, message, sender);
  if (isDriverCancellation) return true;

  const isDriverResponse = await processDriverResponse(sock, message, sender);
  if (isDriverResponse) return true;

  // Check for ride history request
  if (messageContent && isRideHistoryRequest(messageContent)) {
    return await sendRideHistory(sock, sender);
  }

  if (messageContent && isTaxiRequest(messageContent)) {
    if (await isRegisteredDriver(sender)) {
      logger.info(`⏭️ Ignoring taxi/mototaxi keyword from registered driver ${sender}`);
      return false;
    }

    await startRideRequest(sock, sender);
    return true;
  }

  return false;
}

async function cleanupOldRides() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - TWO_HOURS);
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR);

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
  initTaxiRide,
  processTaxiMessage,
  isTaxiRequest,
  cleanupOldRides
};
