# Pipa DN Bot 🤖💬⚡
# 🌊🏡🚗🚨🚕🚌💻📶🛂💪🏖️😋📜📂👋

Pipa DN Bot (`pipa-dn-bot.js`) is a WhatsApp bot built using the Baileys library. It provides automatic responses to keyword-based messages and sends daily updates with relevant information for the environment of Praia de Pipa to a designated WhatsApp group.

## WhatsApp Account Requirement

The bot requires a dedicated WhatsApp account to operate, as it emulates WhatsApp Web in the background. For our setup, we used a **Vivo Pre-Paid SIM card** with the local **DDD for Rio Grande do Norte (84)** to ensure a local Brazilian number. The account must remain active and connected for the bot to function properly.

## Features

- **Automatic Keyword Responses**: The bot monitors messages in a specified group and responds based on predefined keywords.
- **Daily Tide Data Updates**: Fetches and sends tide extremes data for Praia de Pipa at a scheduled time every day.
- **Daily Astronomical Data Updates**: Fetches and sends sun/moon rising and seting times
- **Daily Surfing Conditions**: Fetches and sends surfing conditions for Praia do Madeiro
- **Daily Rain Forecast**: Fetches and sends alert for the day in case of rain forecast
- **UV Index**: Fetches on !uv command the current UV index for the hour 
- **Automatic Reconnection**: If the bot disconnects, it attempts to reconnect automatically.

## Infrastructure Environment

The bot is running on a Google Cloud VM with the following specifications:

- **Instance Type**: e2-micro (2 vCPUs, 1 GB Memory)
- **Operating System**: Ubuntu Server 24.04  
- *Running environment:*
- **Node.js Version**: v18.19.1
- **Process Manager**: PM2 v5.4.3
- **Project Directory**: `/home/joao_mezari/dn-pipa-whatsapp-bot`
- **Dependencies**:
  - `@whiskeysockets/baileys@6.7.13`
  - `moment-timezone@0.5.47`
  - `qrcode-terminal@0.12.0`
  - `whatsapp-web.js@1.26.0`

## Installation

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) 
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [pm2] (https://pm2.keymetrics.io/) 

### Setup

1. Clone the repository:
   ```sh
   git clone https://github.com/nomads-pipa/bot.git
   cd bot
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Create a .env file in the project root directory. Add your API key for the StormGlass API. It should look like:
``` # StormGlass API credentials
STORMGLASS_API_KEY=your_api_key_here
```

4. Start the bot:
   ```sh
   node pipa-dn-bot.js
   ```

## Configuration

### Keywords

The bot responds to predefined keywords stored in `keywords.json`. Ensure this file is in the same directory as `pipa-dn-bot.js` and formatted as follows:

```json
[
    {
        "keywords": ["surf", "onda"],
        "response": "🏄‍♂️ As ondas estão ótimas para surfar hoje!"
    },
    {
        "keywords": ["praia", "sol"],
        "response": "☀️ Aproveite o sol na Praia de Pipa!"
    }
]
```

## How It Works

1. The bot authenticates using multi-file authentication.
2. It connects to WhatsApp via Baileys.
3. It retrieves the group ID for `Pipa Digital Nomads`.
4. It listens for new messages in the group and checks for keyword matches.
5. If a keyword is detected, it sends the corresponding response.
6. It schedules and alerts (check features)..
7. If disconnected, it attempts to reconnect automatically.

## Logging & Debugging

- The bot logs events and errors in the console.
- If the bot does not reconnect, restart it manually.

## Contributing

Pull requests are welcome! Feel free to submit improvements or bug fixes.

## License

This project is licensed under the MIT License.

---

### Contact
For inquiries, reach out to the maintainers at [Pipa Digital Nomads](https://github.com/nomads-pipa).

