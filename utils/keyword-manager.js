const fs = require('fs');
const path = require('path');
const keywordFilePath = path.join(__dirname, '..', 'keywords.json');

/**
 * Load keyword responses from JSON file
 * @returns {Array} Array of keyword-response pairs
 */
function loadKeywordResponses() {
    try {
        const data = fs.readFileSync(keywordFilePath, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error loading keywords file:", err);
        return [];
    }
}

/**
 * Save keyword responses to JSON file
 * @param {Array} keywords - Array of keyword-response pairs
 * @returns {Boolean} Success status
 */
function saveKeywordResponses(keywords) {
    try {
        fs.writeFileSync(keywordFilePath, JSON.stringify(keywords, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("Error saving keywords file:", err);
        return false;
    }
}

/**
 * Add a new keyword-response pair
 * @param {Array} keywords - Array of keywords to trigger the response
 * @param {String} response - Response to send when a keyword is matched
 * @returns {Boolean} Success status
 */
function addKeywordResponse(keywords, response) {
    try {
        const currentResponses = loadKeywordResponses();
        currentResponses.push({ keywords, response });
        return saveKeywordResponses(currentResponses);
    } catch (err) {
        console.error("Error adding keyword response:", err);
        return false;
    }
}

/**
 * Get welcome message configuration
 * @returns {Object} Welcome message configuration
 */
function getWelcomeMessageConfig() {
    return {
        message: `@{username} 👋 Welcome to Pipa Digital Nomads! 
Please introduce yourself as soon as possible and check out our shared resources:
📁 Google Drive: https://tinyurl.com/PipaDNDrive - Info on taxi, places to work, visa, restaurants and more!
To give you some general ideas, tell us:
• Your name and where you are from
• Your profession/skills
• How long you'll be in Pipa
• Your interests
Looking forward to getting to know you! 🌴🏄‍♀️`
    };
}

/**
 * Generate welcome message for a new participant
 * @param {string} username - Username of the new participant
 * @returns {string} Formatted welcome message
 */
function generateWelcomeMessage(username) {
    const config = getWelcomeMessageConfig();
    return config.message.replace('@{username}', `@${username}`);
}

module.exports = {
    loadKeywordResponses,
    saveKeywordResponses,
    addKeywordResponse,
    getWelcomeMessageConfig,
    generateWelcomeMessage
};
