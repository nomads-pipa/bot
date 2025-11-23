import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateDrivers() {
  console.log('🚀 Starting driver migration from .env to database...\n');

  // Get contacts from .env
  const mototaxiContacts = process.env.MOTOTAXI_CONTACTS || '';
  const taxiContacts = process.env.TAXI_CONTACTS || '';

  // Parse mototaxi contacts
  const mototaxiNumbers = mototaxiContacts
    .split(',')
    .map(num => num.trim())
    .filter(num => num !== '');

  // Parse taxi contacts
  const taxiNumbers = taxiContacts
    .split(',')
    .map(num => num.trim())
    .filter(num => num !== '');

  console.log(`📋 Found in .env:`);
  console.log(`   - Mototaxi drivers: ${mototaxiNumbers.length}`);
  console.log(`   - Taxi drivers: ${taxiNumbers.length}\n`);

  if (mototaxiNumbers.length === 0 && taxiNumbers.length === 0) {
    console.log('⚠️  No driver contacts found in .env file');
    return;
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  // Process each mototaxi driver
  for (const phoneNumber of mototaxiNumbers) {
    try {
      // Clean phone number and create JID
      const cleanedPhone = phoneNumber.replace(/^\+/, '');
      const jid = `${cleanedPhone}@s.whatsapp.net`;

      // Check if this driver also exists in taxi list
      const isAlsoTaxi = taxiNumbers.includes(phoneNumber);

      // Upsert driver
      const driver = await prisma.driver.upsert({
        where: { jid },
        update: {
          phone: phoneNumber,
          isMotoTaxiDriver: true,
          isTaxiDriver: isAlsoTaxi,
          isActive: true
        },
        create: {
          jid,
          phone: phoneNumber,
          isMotoTaxiDriver: true,
          isTaxiDriver: isAlsoTaxi,
          isActive: true
        }
      });

      if (driver.createdAt.getTime() === driver.updatedAt.getTime()) {
        created++;
        console.log(`✅ Created driver: ${phoneNumber} (Mototaxi${isAlsoTaxi ? ' + Taxi' : ''})`);
      } else {
        updated++;
        console.log(`🔄 Updated driver: ${phoneNumber} (Mototaxi${isAlsoTaxi ? ' + Taxi' : ''})`);
      }
    } catch (error) {
      errors++;
      console.error(`❌ Error processing mototaxi driver ${phoneNumber}:`, error.message);
    }
  }

  // Process taxi-only drivers (those not already processed as mototaxi)
  for (const phoneNumber of taxiNumbers) {
    if (mototaxiNumbers.includes(phoneNumber)) {
      // Already processed above
      continue;
    }

    try {
      // Clean phone number and create JID
      const cleanedPhone = phoneNumber.replace(/^\+/, '');
      const jid = `${cleanedPhone}@s.whatsapp.net`;

      // Upsert driver
      const driver = await prisma.driver.upsert({
        where: { jid },
        update: {
          phone: phoneNumber,
          isTaxiDriver: true,
          isMotoTaxiDriver: false,
          isActive: true
        },
        create: {
          jid,
          phone: phoneNumber,
          isTaxiDriver: true,
          isMotoTaxiDriver: false,
          isActive: true
        }
      });

      if (driver.createdAt.getTime() === driver.updatedAt.getTime()) {
        created++;
        console.log(`✅ Created driver: ${phoneNumber} (Taxi only)`);
      } else {
        updated++;
        console.log(`🔄 Updated driver: ${phoneNumber} (Taxi only)`);
      }
    } catch (error) {
      errors++;
      console.error(`❌ Error processing taxi driver ${phoneNumber}:`, error.message);
    }
  }

  console.log('\n📊 Migration Summary:');
  console.log(`   - Created: ${created}`);
  console.log(`   - Updated: ${updated}`);
  console.log(`   - Errors: ${errors}`);
  console.log('\n✨ Migration completed!\n');

  // Show all drivers in database
  const allDrivers = await prisma.driver.findMany({
    orderBy: { createdAt: 'desc' }
  });

  console.log('📋 Current drivers in database:');
  for (const driver of allDrivers) {
    const types = [];
    if (driver.isMotoTaxiDriver) types.push('Mototaxi');
    if (driver.isTaxiDriver) types.push('Taxi');
    console.log(`   - ${driver.phone || driver.jid}: ${types.join(' + ')} (${driver.isActive ? 'Active' : 'Inactive'})`);
  }
}

migrateDrivers()
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
