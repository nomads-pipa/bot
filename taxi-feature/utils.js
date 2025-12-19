const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Normalize WhatsApp identifier
 * Now we keep JID and LID separate, so just return the identifier as-is
 */
function normalizeJid(identifier) {
  if (!identifier) return identifier;
  // Keep identifier as-is (either JID or LID)
  return identifier.trim();
}

/**
 * Determine if an identifier is a LID (vs JID)
 */
function isLid(identifier) {
  return identifier && identifier.endsWith('@lid');
}

/**
 * Determine if an identifier is a JID (vs LID)
 */
function isJid(identifier) {
  return identifier && identifier.endsWith('@s.whatsapp.net');
}

function isTaxiRequest(message) {
  const lowerMsg = message.toLowerCase();
  const isRequest = lowerMsg.includes('mototaxi') || lowerMsg.includes('taxi');
  const isTestMode = lowerMsg.includes('test');

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

/**
 * Find a user by identifier with fallback logic: lid → jid
 * @param {string} identifier - WhatsApp identifier (JID or LID)
 * @returns {Promise<User|null>} User object or null if not found
 */
async function findUserByIdentifier(identifier) {
  if (!identifier) return null;

  const normalized = normalizeJid(identifier);

  // Try LID first
  if (isLid(normalized)) {
    const user = await prisma.user.findUnique({
      where: { lid: normalized }
    });
    if (user) return user;
  }

  // Try JID second
  if (isJid(normalized)) {
    const user = await prisma.user.findUnique({
      where: { jid: normalized }
    });
    if (user) return user;
  }

  // Try the opposite field as fallback
  // (in case user switched from LID to JID or vice versa)
  if (isLid(normalized)) {
    const user = await prisma.user.findUnique({
      where: { jid: normalized }
    });
    if (user) return user;
  } else if (isJid(normalized)) {
    const user = await prisma.user.findUnique({
      where: { lid: normalized }
    });
    if (user) return user;
  }

  return null;
}

/**
 * Find a driver by identifier with fallback logic: lid → jid → cpf
 * @param {string} identifier - WhatsApp identifier (JID or LID) or CPF
 * @returns {Promise<Driver|null>} Driver object or null if not found
 */
async function findDriverByIdentifier(identifier) {
  if (!identifier) return null;

  const normalized = normalizeJid(identifier);

  // Try LID first
  if (isLid(normalized)) {
    const driver = await prisma.driver.findUnique({
      where: { lid: normalized }
    });
    if (driver) return driver;
  }

  // Try JID second
  if (isJid(normalized)) {
    const driver = await prisma.driver.findUnique({
      where: { jid: normalized }
    });
    if (driver) return driver;
  }

  // Try the opposite field as fallback
  // (in case driver switched from LID to JID or vice versa)
  if (isLid(normalized)) {
    const driver = await prisma.driver.findUnique({
      where: { jid: normalized }
    });
    if (driver) return driver;
  } else if (isJid(normalized)) {
    const driver = await prisma.driver.findUnique({
      where: { lid: normalized }
    });
    if (driver) return driver;
  }

  // Try CPF as final fallback (for drivers only)
  // Remove formatting from CPF
  const cleanedIdentifier = normalized.replace(/[\.\-\s]/g, '');
  if (/^\d{11}$/.test(cleanedIdentifier)) {
    const driver = await prisma.driver.findUnique({
      where: { cpf: cleanedIdentifier }
    });
    if (driver) return driver;
  }

  return null;
}

/**
 * Check if a sender is a registered driver
 * @param {string} sender - WhatsApp identifier (JID or LID)
 * @returns {Promise<boolean>} True if sender is a registered driver
 */
async function isRegisteredDriver(sender) {
  const driver = await findDriverByIdentifier(sender);
  return !!driver;
}

/**
 * Prepare identifier fields for database operations
 * Returns an object with ONLY the relevant field (jid OR lid), not both
 * This prevents overwriting existing identifier fields when updating users
 * @param {string} identifier - WhatsApp identifier (JID or LID)
 * @returns {Object} Object with either { jid: string } or { lid: string }
 */
function prepareIdentifierFields(identifier) {
  if (!identifier) {
    return {};
  }

  const normalized = normalizeJid(identifier);

  if (isLid(normalized)) {
    return { lid: normalized };
  } else if (isJid(normalized)) {
    return { jid: normalized };
  }

  // Fallback: if we can't determine, assume it's a JID
  return { jid: normalized };
}

/**
 * Get the primary identifier from a user or driver record
 * Returns LID if available, otherwise JID
 * @param {Object} record - User or Driver record with jid and lid fields
 * @returns {string|null} The primary identifier
 */
function getPrimaryIdentifier(record) {
  if (!record) return null;
  return record.lid || record.jid || null;
}

/**
 * Get the messaging identifier from a user or driver record
 * Prefers JID over LID for reliable message delivery
 * @param {Object} record - User or Driver record with jid and lid fields
 * @returns {string|null} The messaging identifier
 */
function getMessagingIdentifier(record) {
  if (!record) return null;
  return record.jid || record.lid || null;
}

/**
 * Check if a sender identifier matches a user/driver record
 * Checks both JID and LID fields
 * @param {string} sender - The sender identifier (JID or LID)
 * @param {Object} record - User or Driver record with jid and lid fields
 * @returns {boolean} True if sender matches either identifier
 */
function isSameUser(sender, record) {
  if (!sender || !record) return false;
  return sender === record.jid || sender === record.lid;
}

module.exports = {
  prisma,
  normalizeJid,
  isLid,
  isJid,
  isTaxiRequest,
  validatePhoneNumber,
  findUserByIdentifier,
  findDriverByIdentifier,
  isRegisteredDriver,
  prepareIdentifierFields,
  getPrimaryIdentifier,
  getMessagingIdentifier,
  isSameUser
};
