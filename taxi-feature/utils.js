const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Normalize WhatsApp JID to standard format
 * Converts @lid (group participant ID) to @s.whatsapp.net format
 */
function normalizeJid(jid) {
  if (!jid) return jid;

  // If JID ends with @lid, convert to @s.whatsapp.net
  if (jid.endsWith('@lid')) {
    const phoneNumber = jid.split('@')[0];
    return `${phoneNumber}@s.whatsapp.net`;
  }

  // Return as-is if already in correct format
  return jid;
}

function isTaxiRequest(message) {
  const lowerMsg = message.toLowerCase();
  const isRequest = lowerMsg.includes('mototaxi') || lowerMsg.includes('taxi');
  const isTestMode = lowerMsg.includes('testing');

  return {
    isRequest,
    isTestMode
  };
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  const phoneRegex = /^\+[1-9]\d{8,14}$/;
  return phoneRegex.test(cleaned);
}

async function isRegisteredDriver(sender) {
  const normalizedSender = normalizeJid(sender);

  const driver = await prisma.driver.findUnique({
    where: {
      jid: normalizedSender
    }
  });

  return !!driver;
}

module.exports = {
  prisma,
  normalizeJid,
  isTaxiRequest,
  validatePhoneNumber,
  isRegisteredDriver
};
