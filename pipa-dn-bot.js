const { startBot } = require('./bot-core');

console.log('🤖 Starting Pipa Digital Nomads WhatsApp Bot...');
startBot().catch(err => {
    console.error('❌ Fatal error starting bot:', err);
    process.exit(1);
});
