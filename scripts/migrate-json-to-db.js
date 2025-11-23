const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

async function migrateData() {
  console.log('🚀 Starting data migration from JSON to PostgreSQL...\n');

  try {
    // Read JSON files
    const taxiRidesPath = path.join(__dirname, '../data/taxi-rides.json');
    const natalRidesPath = path.join(__dirname, '../data/natal-rides.json');

    const taxiRidesData = JSON.parse(await fs.readFile(taxiRidesPath, 'utf8'));
    const natalRidesData = JSON.parse(await fs.readFile(natalRidesPath, 'utf8'));

    console.log(`📊 Found ${taxiRidesData.rides.length} taxi rides`);
    console.log(`📊 Found ${natalRidesData.toAirport.length + natalRidesData.fromAirport.length} natal rides\n`);

    // Migrate taxi rides
    console.log('🚕 Migrating taxi rides...');
    for (const ride of taxiRidesData.rides) {
      // Create or find user
      const user = await prisma.user.upsert({
        where: { jid: ride.user.jid },
        update: {
          name: ride.user.name || null,
          phone: ride.user.phone || null,
        },
        create: {
          jid: ride.user.jid,
          name: ride.user.name || null,
          phone: ride.user.phone || null,
        },
      });

      // Create taxi ride
      const taxiRide = await prisma.taxiRide.create({
        data: {
          status: ride.status,
          vehicleType: ride.vehicleType || 'taxi',
          language: ride.language || 'en',
          userId: user.id,
          locationText: ride.user.locationText || null,
          locationLat: ride.user.locationPin?.latitude || null,
          locationLng: ride.user.locationPin?.longitude || null,
          destination: ride.user.destination || null,
          identifier: ride.user.identifier || null,
          waitTime: ride.user.waitTime || null,
          createdAt: new Date(ride.createdAt),
          updatedAt: new Date(ride.updatedAt),
          completedAt: ride.completedAt ? new Date(ride.completedAt) : null,
          expiredAt: ride.expiredAt ? new Date(ride.expiredAt) : null,
          cancelledAt: ride.cancelledAt ? new Date(ride.cancelledAt) : null,
          cancelledBy: ride.cancelledBy || null,
          feedbackSent: ride.feedbackSent || false,
        },
      });

      // If there's a driver assignment, create driver and assignment
      if (ride.driver && ride.driver.jid) {
        const driver = await prisma.driver.upsert({
          where: { jid: ride.driver.jid },
          update: {},
          create: {
            jid: ride.driver.jid,
          },
        });

        await prisma.rideAssignment.create({
          data: {
            rideId: taxiRide.id,
            driverId: driver.id,
            acceptedAt: new Date(ride.driver.acceptedAt),
          },
        });
      }

      console.log(`  ✅ Migrated taxi ride #${ride.id}`);
    }

    // Migrate natal rides
    console.log('\n✈️  Migrating natal rides...');
    const allNatalRides = [
      ...natalRidesData.toAirport.map(r => ({ ...r, direction: 'toAirport' })),
      ...natalRidesData.fromAirport.map(r => ({ ...r, direction: 'fromAirport' })),
    ];

    for (const ride of allNatalRides) {
      // Create or find user
      const user = await prisma.user.upsert({
        where: { jid: ride.sender },
        update: {
          name: ride.user || null,
        },
        create: {
          jid: ride.sender,
          name: ride.user || null,
        },
      });

      // Create natal ride
      await prisma.natalRide.create({
        data: {
          direction: ride.direction,
          datetime: new Date(ride.datetime),
          originalMsg: ride.original_msg,
          userId: user.id,
          createdAt: new Date(ride.timestamp),
        },
      });

      console.log(`  ✅ Migrated natal ride for ${ride.user}`);
    }

    console.log('\n✨ Migration completed successfully!');
    console.log('\n📈 Summary:');
    console.log(`  - Users: ${await prisma.user.count()}`);
    console.log(`  - Drivers: ${await prisma.driver.count()}`);
    console.log(`  - Taxi Rides: ${await prisma.taxiRide.count()}`);
    console.log(`  - Ride Assignments: ${await prisma.rideAssignment.count()}`);
    console.log(`  - Natal Rides: ${await prisma.natalRide.count()}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
migrateData()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
