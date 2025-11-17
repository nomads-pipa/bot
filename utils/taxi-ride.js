const fs = require('fs').promises;
const path = require('path');
const { createFileLogger } = require('./file-logger');
const logger = createFileLogger();

// Storage file for taxi rides data
const RIDES_FILE = path.join(process.cwd(), 'data', 'taxi-rides.json');

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
  AWAITING_DRIVER_ACCEPTANCE: 'awaiting_driver_acceptance'
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
    rideAccepted: (rideId, driverName, driverPhone) => `✅ Great news! A driver has accepted your ride request.

*Ride #${rideId}*
${driverName ? `*Driver:* ${driverName}` : '*Driver:*'} @${driverPhone}

The driver will contact you shortly. Have a safe trip! 🚖

To cancel this ride, reply with: *cancelar ${rideId}*`,
    rideExpired: (waitTime) => `⏰ Sorry, no driver accepted your ride request within ${waitTime} minutes.

Please request another ride if you still need one. Just send "taxi" or "mototaxi" again to start a new request.`,
    userCancelled: (rideId) => `✅ Ride #${rideId} has been cancelled successfully.`,
    driverNotifiedCancel: (driverPhone) => `The driver has been notified of the cancellation.`,
    driverCancelled: (rideId) => `⚠️ The driver cancelled ride #${rideId}. We're finding you another driver...`,
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
    rideAccepted: (rideId, driverName, driverPhone) => `✅ Ótimas notícias! Um motorista aceitou sua solicitação de corrida.

*Corrida #${rideId}*
${driverName ? `*Motorista:* ${driverName}` : '*Motorista:*'} @${driverPhone}

O motorista entrará em contato em breve. Tenha uma viagem segura! 🚖

Para cancelar esta corrida, responda com: *cancelar ${rideId}*`,
    rideExpired: (waitTime) => `⏰ Desculpe, nenhum motorista aceitou sua solicitação de corrida dentro de ${waitTime} minutos.

Por favor solicite outra corrida se ainda precisar. Basta enviar "taxi" ou "mototaxi" novamente para iniciar uma nova solicitação.`,
    userCancelled: (rideId) => `✅ Corrida #${rideId} foi cancelada com sucesso.`,
    driverNotifiedCancel: (driverPhone) => `O motorista foi notificado do cancelamento.`,
    driverCancelled: (rideId) => `⚠️ O motorista cancelou a corrida #${rideId}. Estamos procurando outro motorista para você...`,
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

// Store rides data
let ridesData = {
  rides: [],
  lastCleanup: null,
  nextRideNumber: 1
};

async function loadRidesData() {
  try {
    await fs.mkdir(path.dirname(RIDES_FILE), { recursive: true });

    try {
      const data = await fs.readFile(RIDES_FILE, 'utf8');
      ridesData = JSON.parse(data);

      // Initialize nextRideNumber if not present
      if (!ridesData.nextRideNumber) {
        ridesData.nextRideNumber = 1;
      }

      logger.info('Loaded taxi rides data from file');
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        await saveRidesData();
        logger.info('Created new taxi rides data file');
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error loading taxi rides data:', error);
  }
}

async function saveRidesData() {
  try {
    await fs.writeFile(RIDES_FILE, JSON.stringify(ridesData, null, 2), 'utf8');
    logger.info('Saved taxi rides data to file');
  } catch (error) {
    logger.error('Error saving taxi rides data:', error);
  }
}

function isTaxiRequest(message) {
  const lowerMsg = message.toLowerCase();
  return lowerMsg.includes('mototaxi') || lowerMsg.includes('taxi');
}

function validatePhoneNumber(phone) {
  // Remove all whitespace, dashes, parentheses for validation
  const cleaned = phone.replace(/[\s\-()]/g, '');

  // Check if it starts with + and has at least country code + 8 digits
  // International format: +[country code 1-3 digits][number 8-12 digits]
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

      // Mark feedback as sent in the ride data
      const ride = ridesData.rides.find(r => r.id === rideId);
      if (ride) {
        ride.feedbackSent = true;
        await saveRidesData();
      }
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

  // Store the timeout IDs
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
  const now = Date.now();
  let restoredCount = 0;
  let sentCount = 0;
  let skippedCount = 0;

  for (const ride of ridesData.rides) {
    // Only process completed rides that have both a driver and passenger
    if (ride.status !== 'completed' || !ride.driver || !ride.completedAt) continue;

    // Skip rides that already had feedback sent
    if (ride.feedbackSent === true) {
      skippedCount++;
      continue;
    }

    const language = ride.language || 'en';

    // Calculate when feedback should be sent
    const feedbackTime = ride.completedAt + FEEDBACK_DELAY;
    const timeRemaining = feedbackTime - now;

    if (timeRemaining <= 0) {
      // Feedback time has passed - send immediately
      logger.info(`📧 Sending overdue feedback requests for ride ${ride.id} (completed ${Math.round((now - ride.completedAt) / 60000)} minutes ago)`);

      const t = TRANSLATIONS[language];
      try {
        await sock.sendMessage(ride.user.jid, {
          text: t.feedbackPassenger(ride.id)
        });
        logger.info(`✅ Sent feedback request to passenger for ride ${ride.id}`);
      } catch (error) {
        logger.error(`❌ Failed to send feedback to passenger for ride ${ride.id}:`, error);
      }

      try {
        await sock.sendMessage(ride.driver.jid, {
          text: t.feedbackDriver(ride.id)
        });
        logger.info(`✅ Sent feedback request to driver for ride ${ride.id}`);
      } catch (error) {
        logger.error(`❌ Failed to send feedback to driver for ride ${ride.id}:`, error);
      }

      // Mark feedback as sent
      ride.feedbackSent = true;
      await saveRidesData();

      sentCount++;
    } else {
      // Feedback still pending - reschedule
      await scheduleFeedbackMessages(sock, ride.id, ride.user.jid, ride.driver.jid, language);
      logger.info(`⏰ Restored feedback timeout for ride ${ride.id} - will send in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  logger.info(`🔄 Feedback timeout restoration complete: ${restoredCount} restored, ${sentCount} sent immediately, ${skippedCount} already sent`);
}

async function restoreRideTimeouts(sock) {
  const now = Date.now();
  let restoredCount = 0;
  let expiredCount = 0;

  for (const ride of ridesData.rides) {
    // Only process pending rides
    if (ride.status !== 'pending') continue;

    const waitTimeMinutes = parseInt(ride.user.waitTime, 10);
    if (isNaN(waitTimeMinutes) || waitTimeMinutes <= 0) continue;

    // Calculate when the ride should expire
    const expirationTime = ride.createdAt + (waitTimeMinutes * 60 * 1000);
    const timeRemaining = expirationTime - now;

    if (timeRemaining <= 0) {
      // Ride is already past its expiration time - expire immediately
      logger.info(`⏰ Expiring ride ${ride.id} immediately (was created ${Math.round((now - ride.createdAt) / 60000)} minutes ago)`);

      ride.status = 'expired';
      ride.updatedAt = now;
      ride.expiredAt = now;

      // Notify the user
      const t = TRANSLATIONS[ride.language || 'en'];
      try {
        await sock.sendMessage(ride.user.jid, {
          text: t.rideExpired(waitTimeMinutes)
        });
      } catch (error) {
        logger.error(`Failed to send expiration message to ${ride.user.jid}:`, error);
      }

      // Clean up
      activeConversations.delete(ride.user.jid);
      clearConversationTimeouts(ride.user.jid);

      expiredCount++;
    } else {
      // Ride still has time remaining - reschedule timeout
      const timeoutId = setTimeout(() => {
        handleRideTimeout(sock, ride.id, ride.user.jid, waitTimeMinutes, ride.language || 'en');
      }, timeRemaining);

      activeRideTimeouts.set(ride.id, timeoutId);
      logger.info(`⏰ Restored timeout for ride ${ride.id} - will expire in ${Math.round(timeRemaining / 60000)} minutes`);
      restoredCount++;
    }
  }

  // Save any expired rides
  if (expiredCount > 0) {
    await saveRidesData();
  }

  logger.info(`🔄 Ride timeout restoration complete: ${restoredCount} restored, ${expiredCount} expired`);
}

async function initTaxiRide(sock) {
  await loadRidesData();

  // Restore timeouts for pending rides after a restart
  if (sock) {
    await restoreRideTimeouts(sock);
    await restoreFeedbackTimeouts(sock);
  }

  logger.info('Taxi ride module initialized');
}

function getDriverNumbers(vehicleType) {
  const envKey = vehicleType === 'mototaxi' ? 'MOTOTAXI_CONTACTS' : 'TAXI_CONTACTS';
  const contacts = process.env[envKey] || '';

  if (!contacts) {
    logger.warn(`No ${envKey} found in .env`);
    return [];
  }

  return contacts.split(',')
    .map(num => num.trim())
    .filter(num => num !== '')
    .map(num => {
      const cleaned = num.replace(/^\+/, '');
      return `${cleaned}@s.whatsapp.net`;
    });
}

function isRegisteredDriver(sender) {
  // Get all registered driver numbers from both mototaxi and taxi contacts
  const mototaxiDrivers = getDriverNumbers('mototaxi');
  const taxiDrivers = getDriverNumbers('taxi');
  const allDrivers = [...mototaxiDrivers, ...taxiDrivers];

  // Check if the sender is in the list of registered drivers
  return allDrivers.includes(sender);
}

function createRide(sender, userInfo, vehicleType, language) {
  const rideId = ridesData.nextRideNumber++;
  return {
    id: rideId,
    status: 'pending',
    vehicleType: vehicleType,
    language: language,
    user: {
      jid: sender,
      name: userInfo.name,
      phone: userInfo.phone,
      locationText: userInfo.locationText,
      locationPin: userInfo.locationPin,
      destination: userInfo.destination,
      identifier: userInfo.identifier,
      waitTime: userInfo.waitTime
    },
    driver: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
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

  await sock.sendMessage(sender, {
    text: t.timeoutExpired
  });

  // Clean up conversation
  activeConversations.delete(sender);
  clearConversationTimeouts(sender);

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
  // Clear existing timeouts
  clearConversationTimeouts(sender);

  // Set warning timeout (2.5 minutes)
  const warningId = setTimeout(() => {
    handleConversationWarning(sock, sender, language);
  }, WARNING_TIME);

  // Set final timeout (5 minutes)
  const timeoutId = setTimeout(() => {
    handleConversationTimeout(sock, sender, language);
  }, CONVERSATION_TIMEOUT);

  conversationTimeouts.set(sender, { warningId, timeoutId });
  logger.info(`⏰ Set conversation timeout for ${sender}`);
}

async function startRideRequest(sock, sender) {
  activeConversations.set(sender, {
    state: STATES.AWAITING_LANGUAGE,
    userInfo: {},
    language: null,
    vehicleType: null
  });

  await sock.sendMessage(sender, {
    text: `🚖 Welcome! Please select your language / Bem-vindo! Por favor selecione seu idioma:

1️⃣ - English
2️⃣ - Português`
  });

  // Start timeout for language selection (no language yet, so no t available)
  resetConversationTimeout(sock, sender, 'en');

  logger.info(`🚖 Started taxi ride request for ${sender}`);
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

  // Reset timeout on every message, but NOT if waiting for driver acceptance
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

      conversation.state = STATES.AWAITING_NAME;

      await sock.sendMessage(sender, {
        text: t.greeting
      });

      await sock.sendMessage(sender, {
        text: t.name
      });
      break;

    case STATES.AWAITING_NAME:
      conversation.userInfo.name = messageContent;
      conversation.state = STATES.AWAITING_PHONE;
      await sock.sendMessage(sender, {
        text: t.phone
      });
      break;

    case STATES.AWAITING_PHONE:
      if (validatePhoneNumber(messageContent)) {
        conversation.userInfo.phone = messageContent;
        conversation.state = STATES.AWAITING_LOCATION_TEXT;
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
      conversation.state = STATES.AWAITING_LOCATION_PIN;
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
        conversation.state = STATES.AWAITING_DESTINATION;
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
      conversation.state = STATES.AWAITING_IDENTIFIER;
      await sock.sendMessage(sender, {
        text: TRANSLATIONS[conversation.language].identifier
      });
      break;

    case STATES.AWAITING_IDENTIFIER:
      conversation.userInfo.identifier = messageContent;
      conversation.state = STATES.AWAITING_WAIT_TIME;
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
      conversation.state = STATES.AWAITING_CONFIRMATION;
      // Show confirmation message
      await sock.sendMessage(sender, {
        text: t.confirmation(conversation.userInfo, conversation.vehicleType)
      });
      break;

    case STATES.AWAITING_CONFIRMATION:
      const confirmationChoice = messageContent?.trim().toUpperCase();

      if (confirmationChoice === 'CONFIRM' || confirmationChoice === 'CONFIRMAR') {
        conversation.state = STATES.AWAITING_DRIVER_ACCEPTANCE;
        // Clear conversation timeout since we're broadcasting to drivers now
        clearConversationTimeouts(sender);
        await broadcastRideToDrivers(sock, sender, conversation);
      } else if (confirmationChoice === 'CANCEL' || confirmationChoice === 'CANCELAR') {
        // Cancel the ride request and clean up
        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await sock.sendMessage(sender, {
          text: t.cancelled
        });
      } else {
        // Invalid input
        await sock.sendMessage(sender, {
          text: t.confirmationInvalid
        });
      }
      break;
  }

  return true;
}

async function handleRideTimeout(sock, rideId, userJid, waitTime, language) {
  // Find the ride
  const ride = ridesData.rides.find(r => r.id === rideId);

  if (!ride) {
    logger.warn(`⏰ Timeout triggered for ride ${rideId} but ride not found`);
    return;
  }

  // Check if ride is still pending
  if (ride.status !== 'pending') {
    logger.info(`⏰ Timeout triggered for ride ${rideId} but ride is already ${ride.status}`);
    return;
  }

  // Mark ride as expired
  ride.status = 'expired';
  ride.updatedAt = Date.now();
  ride.expiredAt = Date.now();
  await saveRidesData();

  // Notify the user
  const t = TRANSLATIONS[language];
  await sock.sendMessage(userJid, {
    text: t.rideExpired(waitTime)
  });

  // Remove the active conversation so user needs to start fresh
  activeConversations.delete(userJid);

  // Clear any conversation timeouts
  clearConversationTimeouts(userJid);

  // Remove the timeout from tracking
  activeRideTimeouts.delete(rideId);

  logger.info(`⏰ Ride ${rideId} expired after ${waitTime} minutes - no driver accepted`);
}

async function broadcastRideToDrivers(sock, sender, conversation) {
  const { userInfo, language, vehicleType } = conversation;
  const t = TRANSLATIONS[language];

  const ride = createRide(sender, userInfo, vehicleType, language);
  ridesData.rides.push(ride);
  await saveRidesData();

  await sock.sendMessage(sender, {
    text: t.requestSent(ride.id)
  });

  const driverNumbers = getDriverNumbers(vehicleType);

  if (driverNumbers.length === 0) {
    await sock.sendMessage(sender, {
      text: t.noDrivers
    });
    activeConversations.delete(sender);
    clearConversationTimeouts(sender);
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

  // Remove user from active conversations since they're done answering questions
  activeConversations.delete(sender);

  logger.info(`🚖 Broadcasted ${vehicleType} ride ${ride.id} to ${driverNumbers.length} drivers`);

  // Set up timeout based on user's wait time
  const waitTimeMinutes = parseInt(userInfo.waitTime, 10);
  if (!isNaN(waitTimeMinutes) && waitTimeMinutes > 0) {
    const timeoutMs = waitTimeMinutes * 60 * 1000; // Convert minutes to milliseconds
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

  // Check if driver sent only "aceitar" without a ride number
  if (messageContent.trim().toLowerCase() === 'aceitar') {
    await sock.sendMessage(sender, {
      text: '⚠️ Por favor, inclua o número da corrida que deseja aceitar.\n\nExemplo: *aceitar 27*'
    });
    return true;
  }

  // Match patterns like "aceitar corrida 1", "aceitar 1", or just "1"
  const acceptanceRegex = /^(?:aceitar\s+(?:corrida\s+)?)?(\d+)$/i;
  const match = messageContent.trim().match(acceptanceRegex);

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  // Find the ride by ID (regardless of status first)
  const ride = ridesData.rides.find(r => r.id === rideId);

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

  ride.status = 'completed';
  ride.driver = {
    jid: sender,
    acceptedAt: Date.now()
  };
  ride.updatedAt = Date.now();
  ride.completedAt = Date.now();

  // Clear the timeout since the ride was accepted
  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
    logger.info(`⏰ Cleared timeout for ride ${rideId} - accepted by driver`);
  }

  await saveRidesData();

  // Store the driver JID before any other operations
  const driverJid = sender;
  const passengerJid = ride.user.jid;

  // Schedule feedback messages for 1 hour after ride completion
  const rideLanguage = ride.language || 'en';
  await scheduleFeedbackMessages(sock, ride.id, passengerJid, driverJid, rideLanguage);

  // Send confirmation to driver
  await sock.sendMessage(driverJid, {
    text: `✅ Corrida #${ride.id} aceita com sucesso! O passageiro será notificado.

*Detalhes do Passageiro:*
Nome: ${ride.user.name}
Telefone: ${ride.user.phone}
Local: ${ride.user.locationText}
Destino: ${ride.user.destination}
Identificação: ${ride.user.identifier}
Tempo de espera: ${ride.user.waitTime} minutos

📞 *Entre em contato com o passageiro para mais detalhes.* Você pode clicar no número de telefone acima para iniciar a ligação.

Para cancelar esta corrida, responda: *cancelar ${ride.id}*`
  });

  // Get driver's contact info
  const driverPhone = driverJid.replace('@s.whatsapp.net', '');

  // Try to get driver's display name
  let driverName = null;
  try {
    const [driverInfo] = await sock.onWhatsApp(driverJid);
    if (driverInfo?.notify) {
      driverName = driverInfo.notify;
    }
  } catch (error) {
    logger.error('Could not fetch driver name:', error);
  }

  // Get passenger's language from ride data (not from activeConversations which was already cleared)
  const passengerLanguage = ride.language || 'en';
  const t = TRANSLATIONS[passengerLanguage];

  logger.info(`🚖 Sending ride acceptance to passenger ${passengerJid}, mentioning driver ${driverJid}`);

  // Send acceptance confirmation to passenger with driver mention
  await sock.sendMessage(passengerJid, {
    text: t.rideAccepted(ride.id, driverName, driverPhone),
    mentions: [driverJid]
  });

  activeConversations.delete(ride.user.jid);
  clearConversationTimeouts(ride.user.jid);

  // Map user to ride for cancellation tracking
  userRideMap.set(ride.user.jid, rideId);

  logger.info(`✅ Ride ${rideId} accepted by driver ${sender}`);

  return true;
}

async function handleUserCancellation(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  // Match patterns like "cancel 1", "cancelar 1", "cancel ride 1", "cancelar corrida 1"
  const cancelRegex = /^(?:cancel|cancelar)(?:\s+(?:ride|corrida))?\s+(\d+)$/i;
  const match = messageContent.trim().match(cancelRegex);

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  // Find the ride
  const ride = ridesData.rides.find(r => r.id === rideId);

  if (!ride) {
    await sock.sendMessage(sender, {
      text: '❌ Ride not found / Corrida não encontrada.'
    });
    return true;
  }

  // Check if this user is the passenger
  if (ride.user.jid !== sender) {
    await sock.sendMessage(sender, {
      text: '❌ You cannot cancel this ride / Você não pode cancelar esta corrida.'
    });
    return true;
  }

  // Check if ride is already cancelled or expired
  if (ride.status === 'cancelled' || ride.status === 'expired') {
    await sock.sendMessage(sender, {
      text: '❌ This ride is already cancelled / Esta corrida já foi cancelada.'
    });
    return true;
  }

  // User can cancel at any point (pending or completed status)

  // Mark ride as cancelled
  ride.status = 'cancelled';
  ride.cancelledBy = 'user';
  ride.cancelledAt = Date.now();
  ride.updatedAt = Date.now();
  await saveRidesData();

  // Clear timeout if exists
  if (activeRideTimeouts.has(rideId)) {
    clearTimeout(activeRideTimeouts.get(rideId));
    activeRideTimeouts.delete(rideId);
  }

  // Clear feedback timeouts if exists (in case ride was already accepted)
  clearFeedbackTimeouts(rideId);

  // Remove user mapping
  userRideMap.delete(sender);

  // Get user's language from ride data
  const userLanguage = ride.language || 'en';
  const t = TRANSLATIONS[userLanguage];

  // Notify user
  await sock.sendMessage(sender, {
    text: t.userCancelled(rideId)
  });

  // Notify driver if ride was accepted
  if (ride.driver && ride.driver.jid) {
    await sock.sendMessage(ride.driver.jid, {
      text: `❌ *CORRIDA CANCELADA PELO PASSAGEIRO*

*Corrida #${rideId}*
O passageiro ${ride.user.name} cancelou a corrida.

🤖 Esta é uma mensagem automática do sistema.`
    });

    await sock.sendMessage(sender, {
      text: t.driverNotifiedCancel(ride.driver.jid.replace('@s.whatsapp.net', ''))
    });
  }

  logger.info(`❌ Ride ${rideId} cancelled by user ${sender}`);

  return true;
}

async function handleDriverCancellation(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  if (!messageContent) return false;

  // Match patterns like "cancel 1", "cancelar 1", "cancel ride 1", "cancelar corrida 1"
  const cancelRegex = /^(?:cancel|cancelar)(?:\s+(?:ride|corrida))?\s+(\d+)$/i;
  const match = messageContent.trim().match(cancelRegex);

  if (!match) return false;

  const rideId = parseInt(match[1], 10);

  // Find the ride
  const ride = ridesData.rides.find(r => r.id === rideId);

  if (!ride) {
    await sock.sendMessage(sender, {
      text: '❌ Corrida não encontrada.'
    });
    return true;
  }

  // Check if this driver is assigned to this ride
  if (!ride.driver || ride.driver.jid !== sender) {
    await sock.sendMessage(sender, {
      text: '❌ Você não está atribuído a esta corrida.'
    });
    return true;
  }

  // Check if ride is already cancelled or expired
  if (ride.status === 'cancelled' || ride.status === 'expired') {
    await sock.sendMessage(sender, {
      text: '❌ Esta corrida já foi cancelada.'
    });
    return true;
  }

  // Mark ride as pending again (for re-broadcast)
  ride.status = 'pending';
  ride.driver = null;
  ride.cancelledBy = 'driver';
  ride.cancelledAt = Date.now();
  ride.updatedAt = Date.now();

  // Clear feedback timeouts if exists (since ride was accepted but driver is cancelling)
  clearFeedbackTimeouts(rideId);

  // Remove user mapping
  userRideMap.delete(ride.user.jid);

  await saveRidesData();

  // Notify driver
  await sock.sendMessage(sender, {
    text: `✅ Corrida #${rideId} foi cancelada. O passageiro será notificado e a corrida será reenviada para outros motoristas.`
  });

  // Get user's language from ride data
  const userLanguage = ride.language || 'en';
  const t = TRANSLATIONS[userLanguage];

  // Notify user about driver cancellation
  await sock.sendMessage(ride.user.jid, {
    text: t.driverCancelled(rideId)
  });

  logger.info(`❌ Ride ${rideId} cancelled by driver ${sender}, re-broadcasting...`);

  // Re-broadcast to all drivers
  const vehicleType = ride.vehicleType;
  const driverNumbers = getDriverNumbers(vehicleType);

  if (driverNumbers.length === 0) {
    await sock.sendMessage(ride.user.jid, {
      text: t.noDrivers
    });
    ride.status = 'expired';
    await saveRidesData();
    return true;
  }

  await sock.sendMessage(ride.user.jid, {
    text: t.rideRebroadcast(ride.id)
  });

  const vehicleIcon = vehicleType === 'mototaxi' ? '🏍️' : '🚗';
  const vehicleLabel = vehicleType === 'mototaxi' ? 'MOTOTAXI' : 'TÁXI';

  const driverMessage = `${vehicleIcon} *NOVA CORRIDA AUTOMÁTICA - ${vehicleLabel}*
*[RE-ENVIADA - Motorista anterior cancelou]*

*Passageiro:* ${ride.user.name}
*Telefone:* ${ride.user.phone}
*Local (texto):* ${ride.user.locationText}
*Destino:* ${ride.user.destination}
*Identificação:* ${ride.user.identifier}
*Tempo de espera:* ${ride.user.waitTime} minutos

*Corrida #${ride.id}*

*Para aceitar, escreva: aceitar ${ride.id}*

🤖 Esta é uma mensagem automática do sistema.`;

  for (const driverJid of driverNumbers) {
    try {
      await sock.sendMessage(driverJid, { text: driverMessage });

      if (ride.user.locationPin) {
        await sock.sendMessage(driverJid, {
          location: {
            degreesLatitude: ride.user.locationPin.latitude,
            degreesLongitude: ride.user.locationPin.longitude
          }
        });
      }

      logger.info(`🚖 Re-sent ride request ${ride.id} to driver ${driverJid}`);
    } catch (error) {
      logger.error(`❌ Failed to send ride request to driver ${driverJid}:`, error);
    }
  }

  logger.info(`🚖 Re-broadcasted ${vehicleType} ride ${ride.id} to ${driverNumbers.length} drivers`);

  // Set up new timeout based on user's wait time
  const waitTimeMinutes = parseInt(ride.user.waitTime, 10);
  if (!isNaN(waitTimeMinutes) && waitTimeMinutes > 0) {
    const timeoutMs = waitTimeMinutes * 60 * 1000;
    const timeoutId = setTimeout(() => {
      handleRideTimeout(sock, ride.id, ride.user.jid, waitTimeMinutes, userLanguage);
    }, timeoutMs);

    activeRideTimeouts.set(ride.id, timeoutId);
    logger.info(`⏰ Set new timeout for re-broadcasted ride ${ride.id} - will expire in ${waitTimeMinutes} minutes`);
  }

  return true;
}

// WhatsApp ChatGPT contact - should be excluded from taxi ride processing
const CHATGPT_WHATSAPP = '18002428478@s.whatsapp.net';

async function processTaxiMessage(sock, message, sender) {
  // Ignore messages from ChatGPT contact to prevent false triggers
  // when ChatGPT responds with JSON containing taxi-related keywords
  if (sender === CHATGPT_WHATSAPP) {
    return false;
  }

  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  // Check if sender is in an active conversation first (they're a passenger)
  if (activeConversations.has(sender)) {
    return await processTaxiConversation(sock, message, sender);
  }

  // Check if this is a user cancellation
  const isUserCancellation = await handleUserCancellation(sock, message, sender);
  if (isUserCancellation) return true;

  // Check if this is a driver cancellation
  const isDriverCancellation = await handleDriverCancellation(sock, message, sender);
  if (isDriverCancellation) return true;

  // Then check if this is a driver accepting a ride
  const isDriverResponse = await processDriverResponse(sock, message, sender);
  if (isDriverResponse) return true;

  // Finally check if this is a new taxi/mototaxi request
  // But ONLY if the sender is NOT a registered driver (to prevent driver auto-replies from triggering passenger flow)
  if (messageContent && isTaxiRequest(messageContent)) {
    // Skip if this is a message from a registered driver
    if (isRegisteredDriver(sender)) {
      logger.info(`⏭️ Ignoring taxi/mototaxi keyword from registered driver ${sender} (likely auto-reply)`);
      return false;
    }

    await startRideRequest(sock, sender);
    return true;
  }

  return false;
}

async function cleanupOldRides() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TWO_HOURS = 2 * 60 * 60 * 1000; // Keep completed rides for 2 hours to allow feedback to be sent
  const now = Date.now();

  const originalCount = ridesData.rides.length;
  const removedRideIds = [];

  ridesData.rides = ridesData.rides.filter(ride => {
    // Keep completed rides for 2 hours (to allow 1 hour for feedback + buffer)
    if (ride.status === 'completed' && ride.completedAt) {
      const shouldKeep = (now - ride.completedAt) < TWO_HOURS;
      if (!shouldKeep) {
        removedRideIds.push(ride.id);
        // Clear any pending feedback timeouts for this ride
        clearFeedbackTimeouts(ride.id);
      }
      return shouldKeep;
    }

    // Keep pending rides that are less than 1 hour old
    if (ride.status === 'pending') {
      const shouldKeep = (now - ride.createdAt) < ONE_HOUR;
      if (!shouldKeep) {
        removedRideIds.push(ride.id);
      }
      return shouldKeep;
    }

    // Remove expired and cancelled rides older than 1 hour
    const ageBasedOnStatus = ride.expiredAt || ride.cancelledAt || ride.createdAt;
    const shouldKeep = (now - ageBasedOnStatus) < ONE_HOUR;
    if (!shouldKeep) {
      removedRideIds.push(ride.id);
    }
    return shouldKeep;
  });

  if (ridesData.rides.length !== originalCount) {
    await saveRidesData();
    logger.info(`🧹 Cleaned up ${originalCount - ridesData.rides.length} old taxi rides (IDs: ${removedRideIds.join(', ')})`);
  }

  ridesData.lastCleanup = now;
}

module.exports = {
  initTaxiRide,
  processTaxiMessage,
  isTaxiRequest,
  cleanupOldRides
};
