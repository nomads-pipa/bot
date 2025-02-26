# Pipa DN Bot

Pipa DN Bot (`pipa-dn-bot.js`) is a WhatsApp bot built using the Baileys library. It provides automatic responses to keyword-based messages and sends daily tide data updates for Praia de Pipa to a designated WhatsApp group.

## Features

- **Automatic Keyword Responses**: The bot monitors messages in a specified group and responds based on predefined keywords.
- **Daily Tide Data Updates**: Fetches and sends tide extremes data for Praia de Pipa at a scheduled time every day.
- **Group ID Auto-Detection**: Dynamically fetches the group ID based on the group name (`Pipa Digital Nomads`).
- **Automatic Reconnection**: If the bot disconnects, it attempts to reconnect automatically.
- **Multi-Device Authentication**: Uses Baileys' multi-file authentication for seamless login management.

## Installation

### Prerequisites

Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (LTS version recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

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

3. Add your API key for tide data in `pipa-dn-bot.js` (replace the placeholder in the `Authorization` header).

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

### Tide Data Scheduling

- The bot fetches and sends tide data daily at **19:30 São Paulo time**.
- The tide data API is sourced from [Storm Glass](https://stormglass.io/).

## How It Works

1. The bot authenticates using multi-file authentication.
2. It connects to WhatsApp via Baileys.
3. It retrieves the group ID for `Pipa Digital Nomads`.
4. It listens for new messages in the group and checks for keyword matches.
5. If a keyword is detected, it sends the corresponding response.
6. It schedules and sends tide data daily at 19:30 São Paulo time.
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

