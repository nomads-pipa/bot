const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, conversationTimeouts, CONVERSATION_TIMEOUT, WARNING_TIME, TRANSLATIONS } = require('./constants');
const { deleteConversationState } = require('./conversation-state');

const logger = createFileLogger();

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

module.exports = {
  clearConversationTimeouts,
  handleConversationTimeout,
  handleConversationWarning,
  resetConversationTimeout
};
