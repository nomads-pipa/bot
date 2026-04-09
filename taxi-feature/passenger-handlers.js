const { prisma, validatePhoneNumber, findUserByIdentifier } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, STATES, TRANSLATIONS } = require('./constants');
const { saveConversationState, deleteConversationState } = require('./conversation-state');
const { resetConversationTimeout, clearConversationTimeouts, clearAllUserTimeouts } = require('./conversation-timeout');
const { createInitialRide, updateRide, broadcastRideToDrivers, rebroadcastRideAfterDriverCancel } = require('./ride-management');
const moment = require('moment-timezone');

/**
 * Try to parse a free-text pickup datetime into a Date object.
 * Handles common Brazilian formats like "27/03 às 14h", "27/03/2026 14:00", "27/03 14:30".
 * Returns null if parsing fails.
 */
function tryParsePickupDate(text) {
  if (!text) return null;
  const tz = 'America/Sao_Paulo';
  const cleaned = text.trim();
  const match = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\s*(?:às?|as)?\s*(\d{1,2})(?:[h:]\s*(\d{2})?)?/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
    const hour = parseInt(match[4], 10);
    const minute = match[5] ? parseInt(match[5], 10) : 0;
    const m = moment.tz({ year, month, date: day, hour, minute }, tz);
    if (m.isValid()) return m.toDate();
  }
  return null;
}

const logger = createFileLogger();

async function startRideRequest(sock, sender, testMode = false) {
  // Clear any lingering timeouts for all identifiers (JID and LID) associated with this user
  await clearAllUserTimeouts(sender);

  // Check if user already exists in the database
  const existingUser = await findUserByIdentifier(sender);

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
      skipUserInfo: true, // Flag to skip name/phone questions
      testMode: testMode
    };

    activeConversations.set(sender, conversation);
    await saveConversationState(sender, conversation);

    const testModeIndicator = testMode ? ' 🧪 [TEST MODE]' : '';
    await sock.sendMessage(sender, {
      text: `🚖 Welcome back, ${existingUser.name}!${testModeIndicator} / Bem-vindo de volta, ${existingUser.name}!${testModeIndicator}

Please select your language / Por favor selecione seu idioma:

1️⃣ - English
2️⃣ - Português`
    });

    logger.info(`🚖 Started taxi ride request for returning user ${sender} (${existingUser.name})${testMode ? ' [TEST MODE]' : ''}`);
  } else {
    // New user or incomplete info - standard flow
    const conversation = {
      state: STATES.AWAITING_LANGUAGE,
      userInfo: {},
      language: null,
      vehicleType: null,
      rideId: null,
      skipUserInfo: false,
      testMode: testMode
    };

    activeConversations.set(sender, conversation);
    await saveConversationState(sender, conversation);

    const testModeIndicator = testMode ? ' 🧪 [TEST MODE]' : '';
    await sock.sendMessage(sender, {
      text: `🚖 Welcome!${testModeIndicator} Please select your language / Bem-vindo!${testModeIndicator} Por favor selecione seu idioma:

1️⃣ - English
2️⃣ - Português`
    });

    logger.info(`🚖 Started taxi ride request for new user ${sender}${testMode ? ' [TEST MODE]' : ''}`);
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
      } else if (vehicleChoice === '2') {
        conversation.vehicleType = 'natal_transfer';
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
        // Skip directly to first relevant question
        const nextState = conversation.vehicleType === 'natal_transfer'
          ? STATES.AWAITING_TRANSFER_DIRECTION
          : STATES.AWAITING_LOCATION_TEXT;
        conversation.state = nextState;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, { text: t.greeting });
        await sock.sendMessage(sender, {
          text: nextState === STATES.AWAITING_TRANSFER_DIRECTION ? t.transferDirection : t.locationText
        });
      } else {
        // Ask for name as usual
        conversation.state = STATES.AWAITING_NAME;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, { text: t.greeting });
        await sock.sendMessage(sender, { text: t.name });
      }
      break;

    case STATES.AWAITING_NAME:
      conversation.userInfo.name = messageContent;

      // Update user in database
      if (conversation.rideId) {
        const user = await findUserByIdentifier(sender);
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { name: messageContent }
          });
        }
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
          const user = await findUserByIdentifier(sender);
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { phone: messageContent }
            });
          }
        }

        if (conversation.vehicleType === 'natal_transfer') {
          conversation.state = STATES.AWAITING_TRANSFER_DIRECTION;
          await saveConversationState(sender, conversation);
          await sock.sendMessage(sender, { text: t.transferDirection });
        } else {
          conversation.state = STATES.AWAITING_LOCATION_TEXT;
          await saveConversationState(sender, conversation);
          await sock.sendMessage(sender, { text: t.locationText });
        }
      } else {
        await sock.sendMessage(sender, {
          text: t.phoneInvalid
        });
      }
      break;

    case STATES.AWAITING_TRANSFER_DIRECTION:
      const dirChoice = messageContent?.trim();
      if (dirChoice === '1') {
        conversation.userInfo.transferDirection = 'natal_to_pipa';
      } else if (dirChoice === '2') {
        conversation.userInfo.transferDirection = 'pipa_to_natal';
      } else {
        await sock.sendMessage(sender, { text: t.transferDirectionInvalid });
        return true;
      }

      if (conversation.rideId) {
        await updateRide(conversation.rideId, { transferDirection: conversation.userInfo.transferDirection });
      }

      conversation.state = STATES.AWAITING_PICKUP_DATETIME;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, { text: t.pickupDatetime });
      break;

    case STATES.AWAITING_PICKUP_DATETIME:
      conversation.userInfo.pickupDatetime = messageContent;

      if (conversation.rideId) {
        const pickupAt = tryParsePickupDate(messageContent);
        await updateRide(conversation.rideId, {
          pickupDatetime: messageContent,
          ...(pickupAt ? { pickupAt } : {})
        });
      }

      conversation.state = STATES.AWAITING_LOCATION_TEXT;
      await saveConversationState(sender, conversation);
      await sock.sendMessage(sender, { text: t.locationText });
      break;

    case STATES.AWAITING_LOCATION_TEXT:
      conversation.userInfo.locationText = messageContent;

      // Update ride in database
      if (conversation.rideId) {
        await updateRide(conversation.rideId, { locationText: messageContent });
      }

      // Natal→Pipa: skip GPS pin (user is in Natal, no GPS needed)
      if (conversation.vehicleType === 'natal_transfer' && conversation.userInfo.transferDirection === 'natal_to_pipa') {
        conversation.state = STATES.AWAITING_DESTINATION;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, { text: TRANSLATIONS[conversation.language].destination });
      } else {
        conversation.state = STATES.AWAITING_LOCATION_PIN;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, { text: TRANSLATIONS[conversation.language].locationPin });
      }
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

      // Natal transfer skips identifier and wait time
      if (conversation.vehicleType === 'natal_transfer') {
        conversation.state = STATES.AWAITING_CONFIRMATION;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, {
          text: TRANSLATIONS[conversation.language].confirmation(conversation.userInfo, conversation.vehicleType)
        });
      } else {
        conversation.state = STATES.AWAITING_IDENTIFIER;
        await saveConversationState(sender, conversation);
        await sock.sendMessage(sender, { text: TRANSLATIONS[conversation.language].identifier });
      }
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

        logger.info(`🔄 Rebroadcasting ride ${conversation.rideId} after driver cancellation`);

        // Send confirmation and rebroadcast
        await sock.sendMessage(sender, {
          text: t.rideRebroadcast(conversation.rideId)
        });

        // Broadcast to drivers and clean up conversation
        activeConversations.delete(sender);
        clearConversationTimeouts(sender);
        await deleteConversationState(sender, 'ride_rebroadcast');
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

module.exports = {
  startRideRequest,
  processTaxiConversation
};
