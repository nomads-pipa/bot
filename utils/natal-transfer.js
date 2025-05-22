const fs = require('fs').promises;
const path = require('path');
const { createFileLogger } = require('./file-logger'); // Assuming this path is correct for your setup
const logger = createFileLogger('natal-transfer');

// WhatsApp ChatGPT contact - This should be the actual JID of your ChatGPT contact
const CHATGPT_WHATSAPP = '18002428478@s.whatsapp.net'; // Example: +1 (800) 242-8478

// Storage file for rides data
const RIDES_FILE = path.join(process.cwd(), 'data', 'natal-rides.json');

// Keywords to detect Natal transfer messages
const NATAL_KEYWORDS = [
  'going to natal',
  'going to the airport',
  'leaving to natal',
  'to natal airport',
  'going to pipa from natal',
  'coming from natal',
  'coming to pipa from natal',
  'share a cab to natal',
  'share a taxi to natal',
  'share ride to natal',
  'airport transfer',
  'natal tomorrow',
  'natal today',
  'leaving natal',
  'arriving in natal',
  'natal airport'
];

// Initialize rides data structure
let ridesData = {
  toAirport: [],   // Rides from Pipa to Natal/Airport
  fromAirport: [], // Rides from Natal/Airport to Pipa
  lastCleanup: Date.now() // Timestamp of the last cleanup operation
};

/**
 * Loads existing rides data from the JSON file.
 * If the file doesn't exist or is invalid, it creates a new empty file.
 */
async function loadRidesData() {
  try {
    // Ensure the directory for the rides file exists
    await fs.mkdir(path.dirname(RIDES_FILE), { recursive: true });
    
    try {
      // Attempt to read and parse the rides data file
      const data = await fs.readFile(RIDES_FILE, 'utf8');
      ridesData = JSON.parse(data);
      logger.info('Loaded rides data from file');
    } catch (error) {
      // If file not found (ENOENT) or parsing error (SyntaxError), create a new empty file
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        await saveRidesData(); // Save initial empty data
        logger.info('Created new rides data file');
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error loading rides data:', error);
  }
}

/**
 * Saves the current rides data to the JSON file.
 */
async function saveRidesData() {
  try {
    await fs.writeFile(RIDES_FILE, JSON.stringify(ridesData, null, 2), 'utf8');
    logger.info('Saved rides data to file');
  } catch (error) {
    logger.error('Error saving rides data:', error);
  }
}

/**
 * Checks if a given message contains keywords related to Natal transfers.
 * @param {string} message - The message text to check.
 * @returns {boolean} - True if the message is a Natal transfer message, false otherwise.
 */
function isNatalTransferMessage(message) {
  const lowerMsg = message.toLowerCase();
  return NATAL_KEYWORDS.some(keyword => lowerMsg.includes(keyword.toLowerCase()));
}

/**
 * Processes an incoming message to determine if it's a Natal transfer request or offer.
 * It uses a ChatGPT integration to parse the message's intent and details.
 * @param {object} sock - The Baileys socket object for sending messages.
 * @param {string} message - The text content of the message.
 * @param {string} sender - The JID (Jabber ID) of the message sender.
 * @param {string} groupId - The JID of the group where the message originated.
 * @param {string} [incomingPushName] - The pushName of the sender, if available in the original message.
 * @returns {Promise<boolean>} - True if the message was processed as a Natal transfer, false otherwise.
 */
async function processNatalTransferMessage(sock, message, sender, groupId, incomingPushName) {
  try {
    // Handle the !natal command directly
    if (message.toLowerCase().trim() === '!natal') {
      await handleNatalCommand(sock, groupId);
      return true;
    }
    
    // If not a !natal command, check if it's a general Natal transfer message
    if (!isNatalTransferMessage(message)) {
      return false;
    }

    // Extract the numeric part of the sender's JID for display/fallback
    const senderPhoneNumber = sender.split('@')[0]; 
    
    logger.info(`Detected potential Natal transfer message from ${senderPhoneNumber}: ${message}`);

    // Forward the message to ChatGPT for parsing and intent detection
    const parsedRide = await askChatGPT(sock, `Parse this message and organize. check the intention.\n\nIf it's affirmative (someone offering a ride), organize the date in a structured format like this example:\n{ "user": "User Name", "direction": "To Airport or From Airport", "datetime": "YYYY-MM-DDTHH:MM:SS", "phoneNumber": "sender's number", "original_msg": "original message" }\n\nIf it's a question (someone asking for a ride), respond with "question intention".\n\nMessage: "${message}"`);
    
    logger.info(`ChatGPT parsed response: ${parsedRide}`);

    // Process the response from ChatGPT
    if (parsedRide.includes('question intention')) {
      // If ChatGPT indicates a question, find and respond with available rides
      const availableRides = findMatchingRides(message);
      if (availableRides.length > 0) {
        const responseMsg = formatAvailableRides(availableRides);
        await sock.sendMessage(groupId, { text: responseMsg });
        logger.info(`Sent available rides to group: ${groupId}`);
      } else {
        // If no matching rides, prompt the user to post their request
        await sock.sendMessage(groupId, { 
          text: `No matching rides found for your query.` 
        });
        logger.info(`No matching rides found for query from ${senderPhoneNumber}`);
      }
      return true;
    } else {
      // If ChatGPT indicates an affirmation (someone offering a ride)
      try {
        // Attempt to extract JSON ride information from ChatGPT's response
        const jsonMatch = parsedRide.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const rideInfo = JSON.parse(jsonMatch[0]);
          
          // Ensure phoneNumber is the full sender JID for consistent storage
          if (!rideInfo.phoneNumber || rideInfo.phoneNumber === "sender's number") {
            rideInfo.phoneNumber = sender; 
          }
          
          // Normalize the direction to "To Natal" or "From Natal"
          if (rideInfo.direction.toLowerCase().includes('to airport') || rideInfo.direction.toLowerCase().includes('to natal')) {
              rideInfo.direction = 'To Natal';
          } else if (rideInfo.direction.toLowerCase().includes('from airport') || rideInfo.direction.toLowerCase().includes('from natal')) {
              rideInfo.direction = 'From Natal';
          }
          
          let actualUserName = senderPhoneNumber; // Default to the numeric JID part

          // Prioritize the pushName from the incoming message, if available
          if (incomingPushName && incomingPushName.length > 0) {
              actualUserName = incomingPushName;
          } else {
              // Attempt to get the display name using sock.getName(sender) as a fallback
              // This is generally more reliable for getting the display name (push name, verified name, or contact name)
              try {
                const nameFromBaileys = await sock.getName(sender); 
                if (nameFromBaileys) {
                    actualUserName = nameFromBaileys;
                }
              } catch (nameError) {
                  logger.warn(`Could not retrieve contact name for ${sender} using sock.getName: ${nameError.message}`);
                  // Fallback to senderPhoneNumber if name retrieval fails
              }
          }
          
          // Ensure user is populated, preferring the actual contact name over generic "User Name"
          if (!rideInfo.user || rideInfo.user === "User Name") {
            rideInfo.user = actualUserName; 
          }
          
          // Add the ride to the appropriate direction list
          // Use the normalized direction for storage logic
          if (rideInfo.direction === 'To Natal') {
            ridesData.toAirport.push({
              ...rideInfo,
              timestamp: Date.now() // Add timestamp for cleanup
            });
          } else if (rideInfo.direction === 'From Natal') {
            ridesData.fromAirport.push({
              ...rideInfo,
              timestamp: Date.now() // Add timestamp for cleanup
            });
          } else {
              logger.warn(`Unknown ride direction parsed: ${rideInfo.direction}. Not saving ride.`);
              return false; // Do not save if direction is not recognized after normalization
          }
          
          // Save the updated rides data
          await saveRidesData();
          
          // Confirm ride registration to the user
          await sock.sendMessage(groupId, { 
            text: `✅ Your ride has been registered!\n\n*Direction:* ${rideInfo.direction}\n*Date/Time:* ${formatDateTime(rideInfo.datetime)}\n\nPeople looking for similar rides will be able to find you. Type !natal to check all rides`,
            mentions: [sender] // Mention the sender
          });
          
          logger.info(`Registered new ride from ${rideInfo.user}: ${rideInfo.direction} on ${rideInfo.datetime}`);
          return true;
        } else {
          logger.warn(`Failed to parse JSON from ChatGPT response: ${parsedRide}`);
          return false;
        }
      } catch (parseError) {
        logger.error(`Error parsing ride info from ChatGPT response: ${parseError}`);
        return false;
      }
    }
  } catch (error) {
    logger.error(`Error processing Natal transfer message: ${error}`);
    return false;
  }
}

/**
 * Sends a message to the designated ChatGPT WhatsApp contact and waits for a response.
 * @param {object} sock - The Baileys socket object.
 * @param {string} message - The message to send to ChatGPT.
 * @returns {Promise<string>} - The response text from ChatGPT.
 */
async function askChatGPT(sock, message) {
  return new Promise((resolve, reject) => {
    let responseTimeout;
    
    // Define the message handler for incoming messages
    function responseHandler(msg) {
      if (msg.type === 'notify') {
        for (const message of msg.messages) {
          // Check if the incoming message is from ChatGPT and not sent by us
          if (message.key.remoteJid === CHATGPT_WHATSAPP && !message.key.fromMe) {
            // Extract the text content from the message
            const responseText = message.message.conversation || 
                                 message.message.extendedTextMessage?.text || '';
            
            if (responseText) {
              // Clear the timeout and remove the event listener once a response is received
              clearTimeout(responseTimeout);
              sock.ev.off('messages.upsert', responseHandler);
              
              // Resolve the promise with the response text
              resolve(responseText);
              return;
            }
          }
        }
      }
    }
    
    // Add the event listener to capture messages
    sock.ev.on('messages.upsert', responseHandler);

    // Send the message to ChatGPT
    sock.sendMessage(CHATGPT_WHATSAPP, { text: message })
      .catch(err => {
        // If sending fails, remove the listener and reject the promise
        sock.ev.off('messages.upsert', responseHandler);
        reject(err);
      });
    
    // Set a timeout for the response (30 seconds)
    responseTimeout = setTimeout(() => {
      sock.ev.off('messages.upsert', responseHandler);
      reject(new Error('Timeout waiting for ChatGPT response'));
    }, 30000);
  });
}

/**
 * Finds upcoming rides that match a given query.
 * It filters by direction and date (if specified in the query).
 * @param {string} query - The search query from the user.
 * @returns {Array<object>} - An array of matching ride objects.
 */
function findMatchingRides(query) {
  // Always clean up old rides before searching
  cleanupOldRides();
  
  const lowerQuery = query.toLowerCase();
  // Determine the search direction based on keywords in the query
  const isSearchingToAirport = lowerQuery.includes('to natal') || 
                               lowerQuery.includes('to airport') || 
                               lowerQuery.includes('leaving pipa');
  
  const isSearchingFromAirport = lowerQuery.includes('from natal') || 
                                 lowerQuery.includes('from airport') || 
                                 lowerQuery.includes('coming to pipa');
  
  const now = new Date();
  
  // Extract a date from the query (simplified, relies on ChatGPT for complex parsing)
  let searchDate = extractDateFromQuery(query);
  
  let matches = [];
  
  // Filter rides based on determined direction and date
  // Note: The `ride.direction` stored will now be 'To Natal' or 'From Natal'
  if (isSearchingToAirport) {
    matches = ridesData.toAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      // Match rides on the same day if a search date is provided, and ensure they are in the future
      if (searchDate) {
        return isSameDay(rideDate, searchDate) && rideDate > now;
      }
      // Otherwise, return all future rides in this direction
      return rideDate > now;
    });
  } else if (isSearchingFromAirport) {
    matches = ridesData.fromAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      if (searchDate) {
        return isSameDay(rideDate, searchDate) && rideDate > now;
      }
      return rideDate > now;
    });
  } else {
    // If direction is unclear, search in both directions
    const toMatches = ridesData.toAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      return searchDate ? isSameDay(rideDate, searchDate) && rideDate > now : rideDate > now;
    });
    
    const fromMatches = ridesData.fromAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      return searchDate ? isSameDay(rideDate, searchDate) && rideDate > now : rideDate > now;
    });
    
    matches = [...toMatches, ...fromMatches];
  }
  
  return matches;
}

/**
 * Formats a list of available rides into a human-readable message string.
 * @param {Array<object>} rides - An array of ride objects to format.
 * @returns {string} - The formatted message.
 */
function formatAvailableRides(rides) {
  if (rides.length === 0) {
    return "No matching rides found.";
  }
  
  // Group rides by direction (now 'To Natal' or 'From Natal')
  const toNatal = rides.filter(r => r.direction === 'To Natal');
  const fromNatal = rides.filter(r => r.direction === 'From Natal');
  
  let message = `*Found ${rides.length} matching ride${rides.length > 1 ? 's' : ''}:*\n\n`;
  
  if (toNatal.length > 0) {
    message += "*🏝 From Pipa to Natal:*\n";
    toNatal.forEach(ride => {
      // Use displayUserName and formatPhoneNumber for proper display
      message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)} (${formatPhoneNumber(ride.phoneNumber)})\n`;
    });
    message += '\n';
  }
  
  if (fromNatal.length > 0) {
    message += "*🌆 From Natal to Pipa:*\n";
    fromNatal.forEach(ride => {
      // Use displayUserName and formatPhoneNumber for proper display
      message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)} (${formatPhoneNumber(ride.phoneNumber)})\n`;
    });
  }
  
  message += `\nTo offer a ride, simply share your travel plans in the group.`;
  
  return message;
}

/**
 * Formats a date string into a readable format (e.g., "Monday, May 20 at 15:00").
 * @param {string} dateStr - The date string to format (e.g., "YYYY-MM-DDTHH:MM:SS").
 * @returns {string} - The formatted date and time.
 */
function formatDateTime(dateStr) {
  try {
    const date = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[date.getDay()];
    
    // Use toLocaleString for flexible date/time formatting
    return `${dayName}, ${date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false // Force 24-hour format
    })}`;
  } catch (error) {
    logger.error(`Error formatting date ${dateStr}: ${error}`);
    return dateStr; // Return original string if parsing fails
  }
}

/**
 * Formats a phone number for display, hiding part of it for privacy.
 * Handles both plain numbers and WhatsApp JIDs.
 * @param {string} phoneNumber - The phone number or JID to format.
 * @returns {string} - The formatted phone number.
 */
function formatPhoneNumber(phoneNumber) {
  // Extract only the numeric part if it's a JID (e.g., '1234567890@s.whatsapp.net' -> '1234567890')
  const numberOnly = phoneNumber.includes('@') ? phoneNumber.split('@')[0] : phoneNumber;

  // If the extracted part consists only of digits, format it
  if (/^\d+$/.test(numberOnly)) {
    // Show first 4 digits, then '****', then last 2 digits
    if (numberOnly.length >= 6) { // Ensure there are enough digits for this format
      return numberOnly.substring(0, 4) + '****' + numberOnly.substring(numberOnly.length - 2);
    }
    return numberOnly; // If too short, return the number as is
  }
  return phoneNumber; // If not a simple digit string, return original (e.g., if it's already masked)
}

/**
 * Determines the best user name to display for a ride.
 * Prioritizes the 'user' field if available and not generic, otherwise uses the phone number.
 * @param {object} ride - The ride object.
 * @returns {string} - The user name to display.
 */
function displayUserName(ride) {
  // Prefer the 'user' field if it's a specific name and not the generic "User Name"
  if (ride.user && ride.user !== "User Name" && ride.user.length > 0) {
    return ride.user;
  }
  // Fallback to the numeric part of the phone number (JID)
  // Add "User " as a prefix for clarity if only the number is available
  if (ride.phoneNumber) {
    return `User ${ride.phoneNumber.split('@')[0]}`;
  }
  return "Unknown User"; // Last resort if no user or phone number info
}

/**
 * Extracts a date from a query string.
 * This is a simplified function and would ideally use a more robust date parsing library
 * or rely heavily on ChatGPT's parsing capabilities.
 * @param {string} query - The query string to extract a date from.
 * @returns {Date|null} - A Date object if a date pattern is found, otherwise null.
 */
function extractDateFromQuery(query) {
  // This is a very simplified date extraction.
  // In a production environment, consider using a library like 'chrono-node'
  // or relying on ChatGPT to return a precise date in its JSON output.
  
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})/, // MM/DD pattern
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})/i, // Month name patterns
    /\b(?:today|tomorrow|tonight)\b/i // Keywords for relative dates
  ];
  
  for (const pattern of datePatterns) {
    if (pattern.test(query)) {
      // For this demo, we're not actually parsing the date into a specific future date
      // based on the query. We're just returning the current date as a placeholder
      // to indicate that a date was "found". ChatGPT is expected to provide the actual datetime.
      return new Date();
    }
  }
  
  return null;
}

/**
 * Checks if two Date objects fall on the same calendar day.
 * @param {Date} date1 - The first Date object.
 * @param {Date} date2 - The second Date object.
 * @returns {boolean} - True if they are on the same day, false otherwise.
 */
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

/**
 * Cleans up old rides from the data. Rides older than 24 hours past their scheduled time are removed.
 * This function runs at most once per hour to avoid excessive file operations.
 */
function cleanupOldRides() {
  const now = Date.now();
  
  // Only run cleanup if at least an hour has passed since the last cleanup
  if (now - ridesData.lastCleanup < 60 * 60 * 1000) { // 60 minutes * 60 seconds * 1000 milliseconds
    return;
  }
  
  logger.info('Running cleanup of old rides');
  
  let removedCount = 0;
  
  // Filter out rides that are more than 24 hours past their scheduled datetime
  ridesData.toAirport = ridesData.toAirport.filter(ride => {
    const rideTime = new Date(ride.datetime).getTime();
    const keepRide = now < rideTime + (24 * 60 * 60 * 1000); // Keep if current time is before ride time + 24 hours
    if (!keepRide) removedCount++;
    return keepRide;
  });
  
  ridesData.fromAirport = ridesData.fromAirport.filter(ride => {
    const rideTime = new Date(ride.datetime).getTime();
    const keepRide = now < rideTime + (24 * 60 * 60 * 1000); 
    if (!keepRide) removedCount++;
    return keepRide;
  });
  
  // Update the timestamp of the last cleanup
  ridesData.lastCleanup = now;
  
  // If any rides were removed, save the updated data to file
  if (removedCount > 0) {
    logger.info(`Removed ${removedCount} expired rides`);
    saveRidesData();
  }
}

/**
 * Handles the `!natal` command, displaying all upcoming rides in both directions.
 * @param {object} sock - The Baileys socket object for sending messages.
 * @param {string} groupId - The JID of the group to send the message to.
 * @returns {Promise<boolean>} - True if the message was sent successfully, false otherwise.
 */
async function handleNatalCommand(sock, groupId) {
  try {
    // Ensure old rides are cleaned up before displaying
    cleanupOldRides();
    
    const now = new Date();
    
    // Filter for rides that are still in the future
    const toNatalRides = ridesData.toAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      return rideDate > now;
    });
    
    const fromNatalRides = ridesData.fromAirport.filter(ride => {
      const rideDate = new Date(ride.datetime);
      return rideDate > now;
    });
    
    // Sort rides by date and time in ascending order
    const sortByDateTime = (a, b) => {
      return new Date(a.datetime) - new Date(b.datetime);
    };
    
    toNatalRides.sort(sortByDateTime);
    fromNatalRides.sort(sortByDateTime);
    
    // Construct the message to display
    let message = "*🚕 Upcoming Natal Rides*\n\n";
    
    // Add "From Pipa to Natal" rides
    if (toNatalRides.length > 0) {
      message += "*🏝 From Pipa to Natal:*\n";
      toNatalRides.forEach(ride => {
        // Use displayUserName and formatPhoneNumber for proper display
        message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)} (${formatPhoneNumber(ride.phoneNumber)})\n`;
      });
      message += "\n";
    } else {
      message += "*🏝 From Pipa to Natal:* No upcoming rides\n\n";
    }
    
    // Add "From Natal to Pipa" rides
    if (fromNatalRides.length > 0) {
      message += "*🌆 From Natal to Pipa:*\n";
      fromNatalRides.forEach(ride => {
        // Use displayUserName and formatPhoneNumber for proper display
        message += `• ${formatDateTime(ride.datetime)} - ${displayUserName(ride)} (${formatPhoneNumber(ride.phoneNumber)})\n`;
      });
    } else {
      message += "*🌆 From Natal to Pipa:* No upcoming rides";
    }
    
    message += "\n\nTo offer a ride, simply share your travel plans in the group.";
    message += "\nTo search for rides, just ask something like 'Anyone going to Natal tomorrow?'";
    
    // Send the compiled message to the group
    await sock.sendMessage(groupId, { text: message });
    logger.info(`Sent all upcoming rides to group: ${groupId}`);
    
    return true;
  } catch (error) {
    logger.error(`Error handling !natal command: ${error}`);
    return false;
  }
}

/**
 * Initializes the Natal transfer module by loading existing rides data.
 */
async function initNatalTransfer() {
  await loadRidesData();
  logger.info('Natal transfer module initialized');
}

// Export functions for use in other modules
module.exports = {
  initNatalTransfer,
  processNatalTransferMessage,
  isNatalTransferMessage,
  handleNatalCommand // Export handleNatalCommand as well if it's called externally
};

