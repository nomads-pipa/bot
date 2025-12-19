const { createFileLogger } = require('../utils/file-logger');
const { isTaxiRequest, isRegisteredDriver } = require('./utils');
const { activeConversations } = require('./constants');
const { restoreConversationStates } = require('./conversation-state');
const { restoreRideTimeouts } = require('./ride-timeout');
const { restoreFeedbackTimeouts } = require('./feedback');
const { startRideRequest, processTaxiConversation } = require('./passenger-handlers');
const { processDriverResponse, handleUserCancellation, handleDriverCancellation, processCpfValidation } = require('./driver-handlers');
const { processRatingResponse, checkInvalidRatingAttempt } = require('./rating-handlers');
const { isRideHistoryRequest, sendRideHistory } = require('./history-handlers');
const { cleanupOldRides } = require('./cleanup');

const logger = createFileLogger();

async function initTaxiRide(sock) {
  if (sock) {
    await restoreRideTimeouts(sock);
    await restoreFeedbackTimeouts(sock);
    await restoreConversationStates(sock);
  }

  logger.info('Taxi ride module initialized with database');
}

async function processTaxiMessage(sock, message, sender) {
  const messageContent = message.message.conversation ||
                         message.message.extendedTextMessage?.text;

  // Debug logging
  logger.info(`🔍 processTaxiMessage - Sender: ${sender}, Content: "${messageContent}"`);

  if (activeConversations.has(sender)) {
    logger.info(`🔍 Routing to conversation handler`);
    return await processTaxiConversation(sock, message, sender);
  }

  // Check for CPF validation (must come before other driver actions)
  const isCpfValidation = await processCpfValidation(sock, message, sender);
  logger.info(`🔍 isCpfValidation: ${isCpfValidation}`);
  if (isCpfValidation) return true;

  const isUserCancellation = await handleUserCancellation(sock, message, sender);
  logger.info(`🔍 isUserCancellation: ${isUserCancellation}`);
  if (isUserCancellation) return true;

  const isDriverCancellation = await handleDriverCancellation(sock, message, sender);
  logger.info(`🔍 isDriverCancellation: ${isDriverCancellation}`);
  if (isDriverCancellation) return true;

  // Check for rating response BEFORE driver response to avoid conflict with numeric ride IDs
  const isRating = await processRatingResponse(sock, message, sender);
  if (isRating) return true;

  // Check for invalid rating attempts and provide helpful feedback
  const isInvalidRating = await checkInvalidRatingAttempt(sock, message, sender);
  if (isInvalidRating) return true;

  const isDriverResponse = await processDriverResponse(sock, message, sender);
  if (isDriverResponse) return true;

  // Check for ride history request
  if (messageContent && isRideHistoryRequest(messageContent)) {
    return await sendRideHistory(sock, sender);
  }

  if (messageContent) {
    const taxiRequestCheck = isTaxiRequest(messageContent);

    if (taxiRequestCheck.isRequest) {
      if (await isRegisteredDriver(sender)) {
        logger.info(`⏭️ Ignoring taxi/mototaxi keyword from registered driver ${sender}`);
        return false;
      }

      await startRideRequest(sock, sender, taxiRequestCheck.isTestMode);
      return true;
    }
  }

  return false;
}

module.exports = {
  initTaxiRide,
  processTaxiMessage,
  isTaxiRequest,
  cleanupOldRides
};
