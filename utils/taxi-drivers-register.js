const { PrismaClient } = require('@prisma/client');
const { findDriverByIdentifier, prepareIdentifierFields } = require('../taxi-feature/utils');
const { createFileLogger } = require('./file-logger');
const logger = createFileLogger();

const prisma = new PrismaClient();

// Registration states
const STATES = {
  IDLE: 'idle',
  AWAITING_CPF_LOOKUP: 'awaiting_cpf_lookup', // Ask for CPF when JID/LID not found
  AWAITING_NAME: 'awaiting_name',
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_CPF: 'awaiting_cpf',
  AWAITING_EMAIL: 'awaiting_email',
  AWAITING_VEHICLE_TYPE: 'awaiting_vehicle_type',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  // Update flow states
  UPDATE_MENU: 'update_menu',
  UPDATE_NAME: 'update_name',
  UPDATE_PHONE: 'update_phone',
  UPDATE_EMAIL: 'update_email',
  UPDATE_VEHICLE_TYPE: 'update_vehicle_type',
  UPDATE_CONFIRMATION: 'update_confirmation',
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
  cpfLookup: '🆔 Para continuar, por favor informe seu CPF:\n\n_Formato: 123.456.789-10 ou 12345678910_',
  cpfInvalid: '❌ CPF inválido. Por favor insira um CPF válido no formato 123.456.789-10 ou apenas os 11 números.',
  email: '📧 Qual é o seu e-mail?\n\n_Exemplo: motorista@email.com_',
  emailInvalid: '❌ E-mail inválido. Por favor insira um endereço de e-mail válido (ex: motorista@email.com)',
  vehicleType: '🚗 Qual tipo de motorista você é?\n\n1️⃣ - Mototaxi 🏍️\n2️⃣ - Táxi 🚗\n3️⃣ - Transfer Natal/Pipa 🚕',
  vehicleTypeInvalid: '❌ Por favor selecione 1 para Mototaxi, 2 para Táxi, ou 3 para Transfer Natal/Pipa',
  confirmation: (driverInfo) => `📋 *Confirme suas informações:*

*Nome:* ${driverInfo.name}
*Telefone:* ${driverInfo.phone}
*CPF:* ${driverInfo.cpf}
*E-mail:* ${driverInfo.email}
*Tipo:* ${driverInfo.isMotoTaxiDriver ? 'Mototaxi 🏍️' : driverInfo.isNatalTransferDriver ? 'Transfer Natal/Pipa 🚕' : 'Táxi 🚗'}

As informações estão corretas?

Responda:
*CONFIRMAR* - para completar o cadastro
*CANCELAR* - para cancelar`,
  confirmationInvalid: '❌ Por favor responda com *CONFIRMAR* para completar ou *CANCELAR* para cancelar.',
  cancelled: '❌ Cadastro cancelado. Envie "cadastrar motorista" novamente para começar um novo cadastro.',
  success: '✅ *Cadastro completado com sucesso!*\n\nVocê agora está registrado na nossa plataforma e começará a receber solicitações de corrida.\n\nBoa sorte! 🚖',
  alreadyRegistered: (driverInfo) => `✅ *Você já está cadastrado como motorista!*

*Nome:* ${driverInfo.name}
*Telefone:* ${driverInfo.phone}
*E-mail:* ${driverInfo.email || 'Não informado'}
*Tipo:* ${driverInfo.isMotoTaxiDriver ? 'Mototaxi 🏍️' : driverInfo.isNatalTransferDriver ? 'Transfer Natal/Pipa 🚕' : 'Táxi 🚗'}

O que você gostaria de fazer?

1️⃣ - Atualizar Nome
2️⃣ - Atualizar Telefone
3️⃣ - Atualizar E-mail
4️⃣ - Atualizar Tipo de Veículo
5️⃣ - Nada, está tudo certo`,
  welcomeBack: (driverInfo) => `👋 *Bem-vindo de volta, ${driverInfo.name}!*

Encontramos seu cadastro:

*Telefone:* ${driverInfo.phone}
*E-mail:* ${driverInfo.email || 'Não informado'}
*Tipo:* ${driverInfo.isMotoTaxiDriver ? 'Mototaxi 🏍️' : driverInfo.isNatalTransferDriver ? 'Transfer Natal/Pipa 🚕' : 'Táxi 🚗'}

O que você gostaria de fazer?

1️⃣ - Atualizar Nome
2️⃣ - Atualizar Telefone
3️⃣ - Atualizar E-mail
4️⃣ - Atualizar Tipo de Veículo
5️⃣ - Nada, está tudo certo`,
  identifierUpdated: '✅ Atualizamos as informações da sua conta do WhatsApp.',
  updateMenuInvalid: '❌ Por favor selecione uma opção válida (1, 2, 3, 4 ou 5).',
  updateComplete: '✅ *Informações atualizadas com sucesso!*\n\nSuas informações foram atualizadas na plataforma.',
  updateCancelled: '✅ Tudo certo! Suas informações permanecem como estão.',
  updateConfirmation: (field, oldValue, newValue) => `📋 *Confirme a atualização:*

*${field}*
Valor atual: ${oldValue}
Novo valor: ${newValue}

Deseja confirmar esta atualização?

Responda:
*CONFIRMAR* - para atualizar
*CANCELAR* - para manter o valor atual`,
  timeoutWarning: '⚠️ Aviso: Você tem 2 minutos e 30 segundos restantes para responder, ou sua sessão expirará.',
  timeoutExpired: '⏰ Sua sessão expirou por inatividade. Por favor envie "sou motorista" novamente para começar.',
  error: '❌ Ocorreu um erro. Por favor tente novamente mais tarde ou entre em contato com o suporte.'
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
 * Validate email format
 */
function validateEmail(email) {
  // Basic email regex that checks for: local@domain.tld
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
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
 * Start driver registration or update flow
 */
async function startDriverRegistration(sock, driverJid) {
  try {
    // Step 1: Check if driver is already registered by LID/JID
    const existingDriver = await findDriverByIdentifier(driverJid);

    if (existingDriver) {
      // Driver found by LID/JID - show update menu immediately
      await sock.sendMessage(driverJid, { text: MESSAGES.alreadyRegistered(existingDriver) });

      // Initialize update state
      activeRegistrations.set(driverJid, {
        state: STATES.UPDATE_MENU,
        driverId: existingDriver.id,
        existingDriver: existingDriver,
        name: null,
        phone: null,
        cpf: null,
        email: null,
        isTaxiDriver: false,
        isMotoTaxiDriver: false,
        updateField: null,
        oldValue: null,
        newValue: null
      });

      // Start timeout timer
      startRegistrationTimeout(sock, driverJid);

      logger.info(`Driver ${driverJid} already exists - showing update menu`);
      return;
    }

    // Step 2: Driver not found by LID/JID - ask for CPF
    activeRegistrations.set(driverJid, {
      state: STATES.AWAITING_CPF_LOOKUP,
      name: null,
      phone: null,
      cpf: null,
      email: null,
      isTaxiDriver: false,
      isMotoTaxiDriver: false,
      isNatalTransferDriver: false
    });

    // Start timeout timer
    startRegistrationTimeout(sock, driverJid);

    // Ask for CPF
    await sock.sendMessage(driverJid, { text: MESSAGES.cpfLookup });

    logger.info(`Started driver registration/lookup for ${driverJid} - awaiting CPF`);
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
      case STATES.AWAITING_CPF_LOOKUP:
        // Validate CPF format
        if (!validateCPF(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.cpfInvalid });
          return true;
        }

        const cleanCPF = formatCPF(trimmedMessage);

        // Look up driver by CPF
        const driverByCPF = await prisma.driver.findUnique({
          where: { cpf: cleanCPF }
        });

        if (driverByCPF) {
          // CPF found - driver exists but with different LID/JID
          // Check if we need to update the identifier
          const identifierFields = prepareIdentifierFields(driverJid);
          let needsIdentifierUpdate = false;

          if (identifierFields.jid && driverByCPF.jid !== identifierFields.jid) {
            needsIdentifierUpdate = true;
          } else if (identifierFields.lid && driverByCPF.lid !== identifierFields.lid) {
            needsIdentifierUpdate = true;
          }

          // Update LID/JID if needed
          if (needsIdentifierUpdate) {
            await prisma.driver.update({
              where: { id: driverByCPF.id },
              data: identifierFields
            });

            logger.info(`Updated identifier for driver ${driverByCPF.id} from ${driverByCPF.jid || driverByCPF.lid} to ${driverJid}`);

            // Notify user about identifier update
            await sock.sendMessage(driverJid, { text: MESSAGES.identifierUpdated });
          }

          // Show welcome back message with update menu
          await sock.sendMessage(driverJid, { text: MESSAGES.welcomeBack(driverByCPF) });

          // Set state to update menu
          regState.state = STATES.UPDATE_MENU;
          regState.driverId = driverByCPF.id;
          regState.existingDriver = driverByCPF;

          logger.info(`Driver found by CPF - ${driverByCPF.name} (${driverJid})`);
        } else {
          // CPF not found - start full registration flow
          regState.cpf = cleanCPF;
          regState.state = STATES.AWAITING_NAME;

          await sock.sendMessage(driverJid, { text: MESSAGES.greeting });
          await sock.sendMessage(driverJid, { text: MESSAGES.name });

          logger.info(`CPF not found - starting new registration for ${driverJid}`);
        }
        break;

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

        // If we already have CPF (from lookup), skip to email
        if (regState.cpf) {
          regState.state = STATES.AWAITING_EMAIL;
          await sock.sendMessage(driverJid, { text: MESSAGES.email });
        } else {
          regState.state = STATES.AWAITING_CPF;
          await sock.sendMessage(driverJid, { text: MESSAGES.cpf });
        }
        break;

      case STATES.AWAITING_CPF:
        if (!validateCPF(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.cpfInvalid });
          return true;
        }

        regState.cpf = formatCPF(trimmedMessage);
        regState.state = STATES.AWAITING_EMAIL;
        await sock.sendMessage(driverJid, { text: MESSAGES.email });
        break;

      case STATES.AWAITING_EMAIL:
        if (!validateEmail(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.emailInvalid });
          return true;
        }

        regState.email = trimmedMessage.trim();
        regState.state = STATES.AWAITING_VEHICLE_TYPE;
        await sock.sendMessage(driverJid, { text: MESSAGES.vehicleType });
        break;

      case STATES.AWAITING_VEHICLE_TYPE:
        const choice = trimmedMessage;

        if (choice !== '1' && choice !== '2' && choice !== '3') {
          await sock.sendMessage(driverJid, { text: MESSAGES.vehicleTypeInvalid });
          return true;
        }

        if (choice === '1') {
          regState.isMotoTaxiDriver = true;
          regState.isTaxiDriver = false;
          regState.isNatalTransferDriver = false;
        } else if (choice === '2') {
          regState.isMotoTaxiDriver = false;
          regState.isTaxiDriver = true;
          regState.isNatalTransferDriver = false;
        } else {
          regState.isMotoTaxiDriver = false;
          regState.isTaxiDriver = false;
          regState.isNatalTransferDriver = true;
        }

        // Show confirmation
        await sock.sendMessage(driverJid, { text: MESSAGES.confirmation(regState) });
        regState.state = STATES.AWAITING_CONFIRMATION;
        break;

      case STATES.AWAITING_CONFIRMATION:
        // Check for confirmation
        const upperMessage = trimmedMessage.toUpperCase();

        if (upperMessage === 'CONFIRMAR' || upperMessage === 'CONFIRM') {
          // Prepare identifier fields (jid or lid)
          const identifierFields = prepareIdentifierFields(driverJid);

          // Save to database
          await prisma.driver.create({
            data: {
              ...identifierFields,
              name: regState.name,
              phone: regState.phone,
              cpf: regState.cpf,
              email: regState.email,
              isTaxiDriver: regState.isTaxiDriver,
              isMotoTaxiDriver: regState.isMotoTaxiDriver,
              isNatalTransferDriver: regState.isNatalTransferDriver,
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

      case STATES.UPDATE_MENU:
        // Handle update menu selection
        const menuChoice = trimmedMessage;

        if (menuChoice === '1') {
          // Update name
          regState.state = STATES.UPDATE_NAME;
          regState.updateField = 'Nome';
          regState.oldValue = regState.existingDriver.name;
          await sock.sendMessage(driverJid, { text: MESSAGES.name });
        } else if (menuChoice === '2') {
          // Update phone
          regState.state = STATES.UPDATE_PHONE;
          regState.updateField = 'Telefone';
          regState.oldValue = regState.existingDriver.phone;
          await sock.sendMessage(driverJid, { text: MESSAGES.phone });
        } else if (menuChoice === '3') {
          // Update email
          regState.state = STATES.UPDATE_EMAIL;
          regState.updateField = 'E-mail';
          regState.oldValue = regState.existingDriver.email;
          await sock.sendMessage(driverJid, { text: MESSAGES.email });
        } else if (menuChoice === '4') {
          // Update vehicle type
          regState.state = STATES.UPDATE_VEHICLE_TYPE;
          regState.updateField = 'Tipo de Veículo';
          regState.oldValue = regState.existingDriver.isMotoTaxiDriver ? 'Mototaxi 🏍️' : regState.existingDriver.isNatalTransferDriver ? 'Transfer Natal/Pipa 🚕' : 'Táxi 🚗';
          await sock.sendMessage(driverJid, { text: MESSAGES.vehicleType });
        } else if (menuChoice === '5') {
          // Nothing to update
          await sock.sendMessage(driverJid, { text: MESSAGES.updateCancelled });

          // Clean up
          activeRegistrations.delete(driverJid);
          clearRegistrationTimeout(driverJid);

          logger.info(`Driver ${driverJid} chose not to update info`);
        } else {
          await sock.sendMessage(driverJid, { text: MESSAGES.updateMenuInvalid });
        }
        break;

      case STATES.UPDATE_NAME:
        if (trimmedMessage.length < 3) {
          await sock.sendMessage(driverJid, { text: '❌ Por favor insira um nome válido.' });
          return true;
        }

        regState.newValue = trimmedMessage;
        regState.state = STATES.UPDATE_CONFIRMATION;
        await sock.sendMessage(driverJid, {
          text: MESSAGES.updateConfirmation(regState.updateField, regState.oldValue, regState.newValue)
        });
        break;

      case STATES.UPDATE_PHONE:
        if (!validatePhone(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.phoneInvalid });
          return true;
        }

        regState.newValue = trimmedMessage;
        regState.state = STATES.UPDATE_CONFIRMATION;
        await sock.sendMessage(driverJid, {
          text: MESSAGES.updateConfirmation(regState.updateField, regState.oldValue, regState.newValue)
        });
        break;

      case STATES.UPDATE_EMAIL:
        if (!validateEmail(trimmedMessage)) {
          await sock.sendMessage(driverJid, { text: MESSAGES.emailInvalid });
          return true;
        }

        regState.newValue = trimmedMessage.trim();
        regState.state = STATES.UPDATE_CONFIRMATION;
        await sock.sendMessage(driverJid, {
          text: MESSAGES.updateConfirmation(regState.updateField, regState.oldValue, regState.newValue)
        });
        break;

      case STATES.UPDATE_VEHICLE_TYPE:
        const vehicleChoice = trimmedMessage;

        if (vehicleChoice !== '1' && vehicleChoice !== '2' && vehicleChoice !== '3') {
          await sock.sendMessage(driverJid, { text: MESSAGES.vehicleTypeInvalid });
          return true;
        }

        const newVehicleType = vehicleChoice === '1' ? 'Mototaxi 🏍️' : vehicleChoice === '2' ? 'Táxi 🚗' : 'Transfer Natal/Pipa 🚕';
        regState.newValue = vehicleChoice;
        regState.state = STATES.UPDATE_CONFIRMATION;
        await sock.sendMessage(driverJid, {
          text: MESSAGES.updateConfirmation(regState.updateField, regState.oldValue, newVehicleType)
        });
        break;

      case STATES.UPDATE_CONFIRMATION:
        const confirmMessage = trimmedMessage.toUpperCase();

        if (confirmMessage === 'CONFIRMAR' || confirmMessage === 'CONFIRM') {
          // Determine which field to update
          const updateData = {};

          if (regState.updateField === 'Nome') {
            updateData.name = regState.newValue;
          } else if (regState.updateField === 'Telefone') {
            updateData.phone = regState.newValue;
          } else if (regState.updateField === 'E-mail') {
            updateData.email = regState.newValue;
          } else if (regState.updateField === 'Tipo de Veículo') {
            if (regState.newValue === '1') {
              updateData.isMotoTaxiDriver = true;
              updateData.isTaxiDriver = false;
              updateData.isNatalTransferDriver = false;
            } else if (regState.newValue === '2') {
              updateData.isMotoTaxiDriver = false;
              updateData.isTaxiDriver = true;
              updateData.isNatalTransferDriver = false;
            } else {
              updateData.isMotoTaxiDriver = false;
              updateData.isTaxiDriver = false;
              updateData.isNatalTransferDriver = true;
            }
          }

          // Update in database
          await prisma.driver.update({
            where: { id: regState.driverId },
            data: updateData
          });

          await sock.sendMessage(driverJid, { text: MESSAGES.updateComplete });

          // Clean up
          activeRegistrations.delete(driverJid);
          clearRegistrationTimeout(driverJid);

          logger.info(`✅ Successfully updated ${regState.updateField} for driver ${driverJid}`);
        } else if (confirmMessage === 'CANCELAR' || confirmMessage === 'CANCEL') {
          await sock.sendMessage(driverJid, { text: MESSAGES.updateCancelled });

          // Clean up
          activeRegistrations.delete(driverJid);
          clearRegistrationTimeout(driverJid);

          logger.info(`Driver ${driverJid} cancelled update`);
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
