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
- **Natal/Pipa Ride Share**: Scans for Natal/Pipa transfer options by the members and organize it in a local agenda
- **Throttling**: It throtlles messages in a timespam to prevent spammimg
- **Automatic Reconnection**: If the bot disconnects, it attempts to reconnect automatically.

## Screenshots
<img width="510" alt="2025-04-15 13_32_55-WhatsApp" src="https://github.com/user-attachments/assets/384da3c1-9770-4209-a9f0-82994892369c" />
<img width="495" alt="image" src="https://github.com/user-attachments/assets/ec771624-e533-4276-81bb-2c11a86b90dd" />

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

3. Create a .env file in the project root directory (check .env.example)

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

