const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUsers() {
  try {
    console.log('Checking users in database...\n');

    const users = await prisma.user.findMany({
      include: {
        taxiRides: true
      }
    });

    console.log(`Total users: ${users.length}\n`);

    if (users.length > 0) {
      console.log('Users found:');
      console.log('============\n');

      users.forEach((user, index) => {
        console.log(`${index + 1}. JID: ${user.jid}`);
        console.log(`   Name: ${user.name || 'N/A'}`);
        console.log(`   Phone: ${user.phone || 'N/A'}`);
        console.log(`   Rides: ${user.taxiRides.length}`);
        console.log('');
      });
    } else {
      console.log('No users found in database.');
      console.log('This is expected if you just reset the database.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
