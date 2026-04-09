// Conversation states for each user
const STATES = {
  IDLE: 'idle',
  AWAITING_LANGUAGE: 'awaiting_language',
  AWAITING_VEHICLE_TYPE: 'awaiting_vehicle_type',
  AWAITING_NAME: 'awaiting_name',
  AWAITING_PHONE: 'awaiting_phone',
  AWAITING_TRANSFER_DIRECTION: 'awaiting_transfer_direction',
  AWAITING_PICKUP_DATETIME: 'awaiting_pickup_datetime',
  AWAITING_LOCATION_TEXT: 'awaiting_location_text',
  AWAITING_LOCATION_PIN: 'awaiting_location_pin',
  AWAITING_DESTINATION: 'awaiting_destination',
  AWAITING_IDENTIFIER: 'awaiting_identifier',
  AWAITING_WAIT_TIME: 'awaiting_wait_time',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  AWAITING_DRIVER_ACCEPTANCE: 'awaiting_driver_acceptance',
  AWAITING_RETRY_DECISION: 'awaiting_retry_decision',
  AWAITING_RETRY_WAIT_TIME: 'awaiting_retry_wait_time',
  AWAITING_DRIVER_CANCEL_DECISION: 'awaiting_driver_cancel_decision',
  AWAITING_DRIVER_CPF_CONFIRMATION: 'awaiting_driver_cpf_confirmation'
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

// Store active keepalive intervals: Map<rideId, intervalId>
const keepaliveIntervals = new Map();

// Timeout constants (in milliseconds)
const CONVERSATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const WARNING_TIME = 2.5 * 60 * 1000; // 2.5 minutes
const FEEDBACK_DELAY = 2 * 60 * 60 * 1000; // 2 hours
const RATING_DEADLINE = 24 * 60 * 60 * 1000; // 24 hours
const KEEPALIVE_INTERVAL = 6 * 60 * 1000; // 6 minutes

// Translations for different languages
const TRANSLATIONS = {
  en: {
    timeoutWarning: '⚠️ Warning: You have 2 minutes and 30 seconds left to answer, or your session will timeout and you\'ll need to start over.',
    timeoutExpired: '⏰ Your session has timed out due to inactivity. Please send "taxi" or "mototaxi" again to start a new ride request.',
    vehicleType: '🚖 What type of ride do you need?\n\n1️⃣ - Mototaxi 🏍️\n2️⃣ - Natal/Pipa Transfer 🚗',
    vehicleTypeInvalid: '❌ Please select 1 for Mototaxi or 2 for Natal/Pipa Transfer',
    transferDirection: '🗺️ Is this transfer from Natal to Pipa or from Pipa to Natal?\n\n1️⃣ - Natal → Pipa\n2️⃣ - Pipa → Natal',
    transferDirectionInvalid: '❌ Please select 1 for Natal → Pipa or 2 for Pipa → Natal',
    pickupDatetime: '📅 What date and time do you need to be picked up?\n\n_Example: 27/03 at 14h or 27/03/2026 14:00_',
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
    confirmation: (userInfo, vehicleType) => vehicleType === 'natal_transfer'
      ? `📋 *Please review your transfer information:*

*Type:* Natal/Pipa Transfer 🚗
*Name:* ${userInfo.name}
*Phone:* ${userInfo.phone}
*Direction:* ${userInfo.transferDirection === 'natal_to_pipa' ? 'Natal → Pipa' : 'Pipa → Natal'}
*Pickup Date/Time:* ${userInfo.pickupDatetime}
*Pickup Location:* ${userInfo.locationText}
*Destination:* ${userInfo.destination}

Is this information correct?

Reply:
*CONFIRM* - to send your transfer request
*CANCEL* - to cancel and start over`
      : `📋 *Please review your ride information:*

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
    rideAccepted: (rideId, driverJid, driverName, driverPhone, driverRep) => {
      const phoneNumber = driverPhone || driverJid.split('@')[0];
      const driverInfo = driverName ? `${driverName} (@${phoneNumber})` : `@${phoneNumber}`;

      // Format phone number with DDI: +55 84 92150464
      // Remove existing + if present, then add it back with formatting
      const cleanNumber = phoneNumber.replace(/^\+/, '');
      const formattedPhone = cleanNumber.startsWith('55')
        ? `+${cleanNumber.slice(0, 2)} ${cleanNumber.slice(2, 4)} ${cleanNumber.slice(4)}`
        : `+${cleanNumber}`;

      return `✅ Great news! A driver has accepted your ride request.

*Ride #${rideId}*
*Driver:* ${driverInfo}
*Phone:* ${formattedPhone}
*Reputation:* ${driverRep}

💰 *Please agree on the price with the driver.*

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

Thank you for being part of our driver community! 🚖`,
    ratingRequestPassenger: (rideId, driverName) => `⭐ *Rate Your Driver*

How would you rate ${driverName || 'your driver'} for ride #${rideId}?

To rate, type "rate" followed by a number from 1 to 5:
⭐ rate 1 - Very poor
⭐⭐ rate 2 - Poor
⭐⭐⭐ rate 3 - Average
⭐⭐⭐⭐ rate 4 - Good
⭐⭐⭐⭐⭐ rate 5 - Excellent

Example: rate 5

Your rating helps build trust in our community! You have 24 hours to rate.`,
    ratingRequestDriver: (rideId, passengerName) => `⭐ *Rate Your Passenger*

How would you rate ${passengerName || 'your passenger'} for ride #${rideId}?

To rate, type "rate" followed by a number from 1 to 5:
⭐ rate 1 - Very poor
⭐⭐ rate 2 - Poor
⭐⭐⭐ rate 3 - Average
⭐⭐⭐⭐ rate 4 - Good
⭐⭐⭐⭐⭐ rate 5 - Excellent

Example: rate 5

Your rating helps build trust in our community! You have 24 hours to rate.`,
    ratingReceived: (score) => `✅ Thank you! Your rating of ${score} ⭐ has been recorded.`,
    ratingInvalid: '❌ Please type "rate" followed by a number from 1 to 5 (example: rate 4).',
    ratingExpired: (rideId) => `⏰ The rating period for ride #${rideId} has expired.`,
    keepalive: '⏳ We are still looking for a driver for your ride. Please wait...',
    natalTransferExpired: '⏰ Your Natal/Pipa transfer request has expired — the pickup time has passed with no driver accepting. Send "transfer natal" to create a new request.'
  },
  pt: {
    timeoutWarning: '⚠️ Aviso: Você tem 2 minutos e 30 segundos restantes para responder, ou sua sessão expirará e você precisará começar de novo.',
    timeoutExpired: '⏰ Sua sessão expirou por inatividade. Por favor envie "taxi" ou "mototaxi" novamente para iniciar uma nova solicitação de corrida.',
    vehicleType: '🚖 Que tipo de corrida você precisa?\n\n1️⃣ - Mototaxi 🏍️\n2️⃣ - Transfer Natal/Pipa 🚗',
    vehicleTypeInvalid: '❌ Por favor selecione 1 para Mototaxi ou 2 para Transfer Natal/Pipa',
    transferDirection: '🗺️ O transfer é de Natal para Pipa ou de Pipa para Natal?\n\n1️⃣ - Natal → Pipa\n2️⃣ - Pipa → Natal',
    transferDirectionInvalid: '❌ Por favor selecione 1 para Natal → Pipa ou 2 para Pipa → Natal',
    pickupDatetime: '📅 Em que data e horário você precisa ser buscado?\n\n_Exemplo: 27/03 às 14h ou 27/03/2026 14:00_',
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
    confirmation: (userInfo, vehicleType) => vehicleType === 'natal_transfer'
      ? `📋 *Por favor revise suas informações de transfer:*

*Tipo:* Transfer Natal/Pipa 🚗
*Nome:* ${userInfo.name}
*Telefone:* ${userInfo.phone}
*Direção:* ${userInfo.transferDirection === 'natal_to_pipa' ? 'Natal → Pipa' : 'Pipa → Natal'}
*Data/Hora Pickup:* ${userInfo.pickupDatetime}
*Local de Pickup:* ${userInfo.locationText}
*Destino:* ${userInfo.destination}

As informações estão corretas?

Responda:
*CONFIRMAR* - para enviar sua solicitação de transfer
*CANCELAR* - para cancelar e começar de novo`
      : `📋 *Por favor revise suas informações:*

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
    rideAccepted: (rideId, driverJid, driverName, driverPhone, driverRep) => {
      const phoneNumber = driverPhone || driverJid.split('@')[0];
      const driverInfo = driverName ? `${driverName} (@${phoneNumber})` : `@${phoneNumber}`;

      // Format phone number with DDI: +55 84 92150464
      // Remove existing + if present, then add it back with formatting
      const cleanNumber = phoneNumber.replace(/^\+/, '');
      const formattedPhone = cleanNumber.startsWith('55')
        ? `+${cleanNumber.slice(0, 2)} ${cleanNumber.slice(2, 4)} ${cleanNumber.slice(4)}`
        : `+${cleanNumber}`;

      return `✅ Ótimas notícias! Um motorista aceitou sua solicitação de corrida.

*Corrida #${rideId}*
*Motorista:* ${driverInfo}
*Telefone:* ${formattedPhone}
*Reputação:* ${driverRep}

💰 *Por favor, acerte o valor com o motorista.*

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

Obrigado por fazer parte da nossa comunidade de motoristas! 🚖`,
    ratingRequestPassenger: (rideId, driverName) => `⭐ *Avalie Seu Motorista*

Como você avaliaria ${driverName || 'seu motorista'} na corrida #${rideId}?

Para avaliar, digite "avaliar" seguido de um número de 1 a 5:
⭐ avaliar 1 - Muito ruim
⭐⭐ avaliar 2 - Ruim
⭐⭐⭐ avaliar 3 - Regular
⭐⭐⭐⭐ avaliar 4 - Bom
⭐⭐⭐⭐⭐ avaliar 5 - Excelente

Exemplo: avaliar 5

Sua avaliação ajuda a construir confiança na nossa comunidade! Você tem 24 horas para avaliar.`,
    ratingRequestDriver: (rideId, passengerName) => `⭐ *Avalie Seu Passageiro*

Como você avaliaria ${passengerName || 'seu passageiro'} na corrida #${rideId}?

Para avaliar, digite "avaliar" seguido de um número de 1 a 5:
⭐ avaliar 1 - Muito ruim
⭐⭐ avaliar 2 - Ruim
⭐⭐⭐ avaliar 3 - Regular
⭐⭐⭐⭐ avaliar 4 - Bom
⭐⭐⭐⭐⭐ avaliar 5 - Excelente

Exemplo: avaliar 5

Sua avaliação ajuda a construir confiança na nossa comunidade! Você tem 24 horas para avaliar.`,
    ratingReceived: (score) => `✅ Obrigado! Sua avaliação de ${score} ⭐ foi registrada.`,
    ratingInvalid: '❌ Por favor digite "avaliar" seguido de um número de 1 a 5 (exemplo: avaliar 4).',
    ratingExpired: (rideId) => `⏰ O período de avaliação para a corrida #${rideId} expirou.`,
    keepalive: '⏳ Ainda estamos procurando um motorista para sua corrida. Por favor, aguarde...',
    natalTransferExpired: '⏰ Sua solicitação de transfer Natal/Pipa expirou — o horário de pickup passou sem que nenhum motorista aceitasse. Envie "transfer natal" para fazer uma nova solicitação.',
    driverCpfRequest: (rideId) => `🔐 *Confirmação de Identidade*

Para aceitar a corrida #${rideId}, por favor, confirme informando seu CPF de cadastro do motorista.

Digite seu CPF (com ou sem formatação):
Exemplo: 123.456.789-00 ou 12345678900`,
    driverCpfInvalid: (attemptsLeft) => `❌ CPF não encontrado ou não corresponde a um motorista cadastrado.

${attemptsLeft > 0 ? `Você tem ${attemptsLeft} tentativa(s) restante(s). Por favor, tente novamente.` : 'Número máximo de tentativas excedido.\n\nVocê pode se registrar como motorista respondendo "sou motorista" aqui.'}`,
    driverCpfMaxAttempts: '❌ Número máximo de tentativas de CPF excedido. Por favor, tente aceitar a corrida novamente.\n\nVocê pode se registrar como motorista respondendo "sou motorista" aqui.'
  }
};

module.exports = {
  STATES,
  activeConversations,
  activeRideTimeouts,
  conversationTimeouts,
  userRideMap,
  feedbackTimeouts,
  keepaliveIntervals,
  CONVERSATION_TIMEOUT,
  WARNING_TIME,
  FEEDBACK_DELAY,
  RATING_DEADLINE,
  KEEPALIVE_INTERVAL,
  TRANSLATIONS
};
