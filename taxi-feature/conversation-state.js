const { prisma } = require('./utils');
const { createFileLogger } = require('../utils/file-logger');
const { activeConversations, conversationTimeouts, CONVERSATION_TIMEOUT, WARNING_TIME, TRANSLATIONS } = require('./constants');

const logger = createFileLogger();

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
  const CONVERSATION_TIMEOUT_MS = CONVERSATION_TIMEOUT;
  const WARNING_TIME_MS = WARNING_TIME;

  let restoredCount = 0;
  let expiredCount = 0;

  const activeStates = await prisma.conversationState.findMany({
    where: { isActive: true }
  });

  // Import needed functions from conversation-timeout
  const { handleConversationTimeout, handleConversationWarning } = require('./conversation-timeout');

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

module.exports = {
  saveConversationState,
  deleteConversationState,
  restoreConversationStates
};
