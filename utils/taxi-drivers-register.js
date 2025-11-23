const { PrismaClient } = require('@prisma/client');
const { createFileLogger } = require('./file-logger');
const logger = createFileLogger();

const prisma = new PrismaClient();

// Registration states
const STATES = {
  IDLE: 'idle',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_CPF: 'awaiting_cpf',
  AWAITING_VEHICLE_TYPE: 'awaiting_vehicle_type',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  COMPLETED: 'completed'
};

// Store active registration conversations: Map<driver_jid, registrationState>
const activeRegistrations = new Map();

// Timeout constants (in milliseconds)
const REGISTRATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const WARNING_TIME = 7.5 * 60 * 1000; // 7.5 minutes

// Store registration timeouts: Map<driver_jid, {timeoutId, warningId}>
const registrationTimeouts = new Map();

// Messages
const MESSAGES = {
  greeting: '🚖 *Cadastro de Motorista*\n\nOlá! Vou te ajudar a se cadastrar como motorista na nossa plataforma.\n\nPor favor, responda algumas perguntas para completar seu cadastro.',
  name: '👤 Qual é o seu nome completo?',
  phone: '📱 Qual é o seu número de telefone com DDI?\n\n_Exemplo: +55 84 9 1234-5678_',
  phoneInvalid: '❌ Formato de telefone inválido. Por favor inclua o código do país começando com + (ex: +55 84 9 1234-5678)',
  cpf: '🆔 Qual é o seu CPF?\n\n_Formato: 123.456.789-10 ou 12345678910_',
  cpfInvalid: '❌ CPF inválido. Por favor insira um CPF válido no formato 123.456.789-10 ou apenas os 11 números.',
  vehicleType: '🚗 Qual tipo de motorista você é?\n\n1️⃣ - Mototaxi 🏍️\n2️⃣ - Táxi 🚗',
  vehicleTypeInvalid: '❌ Por favor selecione 1 para Mototaxi ou 2 para Táxi',
  confirmation: (driverInfo) => `📋 *Confirme suas informações:*

*Nome:* ${driverInfo.name}
*Telefone:* ${driverInfo.phone}
*CPF:* ${driverInfo.cpf}
*Tipo:* ${driverInfo.isMotoTaxiDriver ? 'Mototaxi 🏍️' : 'Táxi 🚗'}

As informações estão corretas?

Responda:
*CONFIRMAR* - para completar o cadastro
*CANCELAR* - para cancelar`,
  confirmationInvalid: '❌ Por favor responda com *CONFIRMAR* para completar ou *CANCELAR* para cancelar.',
  cancelled: '❌ Cadastro cancelado. Envie "cadastrar motorista" para começar novamente.',
  success: '✅ *Cadastro completado com sucesso!*\n\nVocê agora está registrado na nossa plataforma e começará a receber solicitações de corrida.\n\nBoa sorte! 🚖',
  alreadyRegistered: '✅ Você já está cadastrado como motorista!\n\nSe precisar atualizar suas informações, entre em contato com o suporte.',
  timeoutWarning: '⚠️ Aviso: Você tem 2 minutos e 30 segundos restantes para responder, ou sua sessão de cadastro expirará.',
  timeoutExpired: '⏰ Sua sessão de cadastro expirou por inatividade. Por favor envie "cadastrar motorista" novamente para começar um novo cadastro.',
  error: '❌ Ocorreu um erro durante o cadastro. Por favor tente novamente mais tarde ou entre em contato com o suporte.'
};

/**
 * Initialize the driver registration module
 */
async function initDriverRegistration() {
  try {
    logger.info('Initializing driver registration module...');

    // Test database connection
    await prisma.$connect();
    logger.info('✅ Driver registration module initialized');

    return true;
  } catch (error) {
    logger.error('❌ Error initializing driver registration module:', error);
    return false;
  }
}

/**
 * Check if a user is initiating driver registration
 */
function isDriverRegistrationMessage(messageContent) {
  if (!messageContent) return false;

  const text = messageContent.toLowerCase().trim();
  const triggers = [
    'cadastrar motorista',
    'cadastro motorista',
    'registrar motorista',
    'registro motorista',
    'quero ser motorista',
    'virar motorista',
    'sou motorista'
  ];

  return triggers.some(trigger => text.includes(trigger));
}

/**
 * Start driver registration timeout timer
 */
function startRegistrationTimeout(sock, driverJid) {
  // Clear existing timeout if any
  clearRegistrationTimeout(driverJid);

  // Set warning timer
  const warningId = setTimeout(async () => {
    try {
      await sock.sendMessage(driverJid, { text: MESSAGES.timeoutWarning });
      logger.info(`⚠️ Sent registration timeout warning to ${driverJid}`);
    } catch (error) {
      logger.error(`Error sending registration timeout warning to ${driverJid}:`, error);
    }
  }, WARNING_TIME);

  // Set timeout timer
  const timeoutId = setTimeout(async () => {
    try {
      const regState = activeRegistrations.get(driverJid);
      if (regState && regState.state !== STATES.COMPLETED) {
        await sock.sendMessage(driverJid, { text: MESSAGES.timeoutExpired });
        activeRegistrations.delete(driverJid);
        clearRegistrationTimeout(driverJid);
        logger.info(`⏰ Registration timed out for ${driverJid}`);
      }
    } catch (error) {
      logger.error(`Error handling registration timeout for ${driverJid}:`, error);
    }
  }, REGISTRATION_TIMEOUT);

  registrationTimeouts.set(driverJid, { warningId, timeoutId });
}

/**
 * Clear registration timeout timer
 */
function clearRegistrationTimeout(driverJid) {
  const timeouts = registrationTimeouts.get(driverJid);
  if (timeouts) {
    clearTimeout(timeouts.warningId);
    clearTimeout(timeouts.timeoutId);
    registrationTimeouts.delete(driverJid);
  }
}

/**
 * Reset registration timeout (on activity)
 */
function resetRegistrationTimeout(sock, driverJid) {
  startRegistrationTimeout(sock, driverJid);
}

/**
 * Validate phone number format
 */
function validatePhone(phone) {
  // Must start with + and contain only numbers, spaces, and hyphens
  const phoneRegex = /^\+[\d\s\-]+$/;
  if (!phoneRegex.test(phone)) return false;

  // Extract only digits after the +
  const digits = phone.substring(1).replace(/[\s\-]/g, '');

  // Must have at least 10 digits (country code + number)
  return digits.length >= 10;
}

/**
 * Validate CPF format and checksum
 */
function validateCPF(cpf) {
  // Remove formatting
  const cleanCPF = cpf.replace(/[^\d]/g, '');

  // Must have exactly 11 digits
  if (cleanCPF.length !== 11) return false;

  // Check if all digits are the same (invalid)
  if (/^(\d)\1{10}$/.test(cleanCPF)) return false;

  // Validate checksum
  let sum = 0;
  let remainder;

  // First digit verification
  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cleanCPF.substring(i - 1, i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCPF.substring(9, 10))) return false;

  // Second digit verification
  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cleanCPF.substring(i - 1, i)) * (12 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleanCPF.substring(10, 11))) return false;

  return true;
}

/**
 * Format CPF for storage (keep only digits)
 */
function formatCPF(cpf) {
  return cpf.replace(/[^\d]/g, '');
}

/**
 * Start driver registration
 */
async function startDriverRegistration(sock, driverJid) {
  try {
    // Check if driver is already registered
    const existingDriver = await prisma.driver.findUnique({
      where: { jid: driverJid }
    });

    if (existingDriver) {
      await sock.sendMessage(driverJid, { text: MESSAGES.alreadyRegistered });
      logger.info(`Driver ${driverJid} attempted to register but already exists`);
      return;
    }

    // Initialize registration state
    activeRegistrations.set(driverJid, {
      state: STATES.AWAITING_NAME,
      name: null,
      phone: null,
      cpf: null,
      isTaxiDriver: false,
      isMotoTaxiDriver: false
    });

    // Start timeout timer
    startRegistrationTimeout(sock, driverJid);

    // Send greeting and first question
    await sock.sendMessage(driverJid, { text: MESSAGES.greeting });
    await sock.sendMessage(driverJid, { text: MESSAGES.name });

    logger.info(`Started driver registration for ${driverJid}`);
  } catch (error) {
    logger.error(`Error starting driver registration for ${driverJid}:`, error);
    await sock.sendMessage(driverJid, { text: MESSAGES.error });
  }
}

/**
 * Process driver registration message
 */
async function processDriverRegistrationMessage(sock, message, driverJid) {
  try {
    // Check if this is a new registration request
    if (isDriverRegistrationMessage(message.message?.conversation || message.message?.extendedTextMessage?.text)) {
      await startDriverRegistration(sock, driverJid);
      return true;
    }

    // Check if there's an active registration
    const regState = activeRegistrations.get(driverJid);
    if (!regState || regState.state === STATES.IDLE || regState.state === STATES.COMPLETED) {
      return false; // Not in registration flow
    }

    // Reset timeout on activity
    resetRegistrationTimeout(sock, driverJid);

    // Get message content
    const messageContent = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text || '';

    const trimmedMessage = messageContent.trim();

    // Process based on current state
    switch (regState.state) {
      case STATES.AWAITING_NAME:
        if (trimmedMessage.length < 3) {
          await sock.sendMessage(driverJid, { text: '❌ Por favor insira um nome válido.' });
          return true;
        }

        regState.name = trimmedMessage;
        regState.state = STATES.AWAITING_PHONE;
        await sock.sendMessage(driverJid, { text: MESSAGES.phone });
        break;

      case STATES.AWAITING_PHONE:
        if (!validatePhone(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.phoneInvalid });
          return true;
        }

        regState.phone = trimmedMessage;
        regState.state = STATES.AWAITING_CPF;
        await sock.sendMessage(driverJid, { text: MESSAGES.cpf });
        break;

      case STATES.AWAITING_CPF:
        if (!validateCPF(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.cpfInvalid });
          return true;
        }

        regState.cpf = formatCPF(trimmedMessage);
        regState.state = STATES.AWAITING_VEHICLE_TYPE;
        await sock.sendMessage(driverJid, { text: MESSAGES.vehicleType });
        break;

      case STATES.AWAITING_VEHICLE_TYPE:
        const choice = trimmedMessage;

        if (choice !== '1' && choice !== '2') {
          await sock.sendMessage(driverJid, { text: MESSAGES.vehicleTypeInvalid });
          return true;
        }

        if (choice === '1') {
          regState.isMotoTaxiDriver = true;
          regState.isTaxiDriver = false;
        } else {
          regState.isMotoTaxiDriver = false;
          regState.isTaxiDriver = true;
        }

        // Show confirmation
        await sock.sendMessage(driverJid, { text: MESSAGES.confirmation(regState) });
        regState.state = STATES.AWAITING_CONFIRMATION;
        break;

      case STATES.AWAITING_CONFIRMATION:
        // Check for confirmation
        const upperMessage = trimmedMessage.toUpperCase();

        if (upperMessage === 'CONFIRMAR' || upperMessage === 'CONFIRM') {
          // Save to database
          await prisma.driver.create({
            data: {
              jid: driverJid,
              name: regState.name,
              phone: regState.phone,
              cpf: regState.cpf,
              isTaxiDriver: regState.isTaxiDriver,
              isMotoTaxiDriver: regState.isMotoTaxiDriver,
              isActive: true
            }
          });

          await sock.sendMessage(driverJid, { text: MESSAGES.success });

          // Clean up
          activeRegistrations.delete(driverJid);
          clearRegistrationTimeout(driverJid);

          logger.info(`✅ Successfully registered driver ${driverJid} - ${regState.name}`);
        } else if (upperMessage === 'CANCELAR' || upperMessage === 'CANCEL') {
          await sock.sendMessage(driverJid, { text: MESSAGES.cancelled });

          // Clean up
          activeRegistrations.delete(driverJid);
          clearRegistrationTimeout(driverJid);

          logger.info(`Driver registration cancelled by ${driverJid}`);
        } else {
          await sock.sendMessage(driverJid, { text: MESSAGES.confirmationInvalid });
        }
        break;
    }

    return true; // Message was handled by registration flow
  } catch (error) {
    logger.error(`Error processing driver registration message for ${driverJid}:`, error);
    await sock.sendMessage(driverJid, { text: MESSAGES.error });

    // Clean up on error
    activeRegistrations.delete(driverJid);
    clearRegistrationTimeout(driverJid);

    return true;
  }
}

/**
 * Check if user is in active registration
 */
function isInRegistration(driverJid) {
  return activeRegistrations.has(driverJid);
}

module.exports = {
  initDriverRegistration,
  processDriverRegistrationMessage,
  isDriverRegistrationMessage,
  isInRegistration
};
