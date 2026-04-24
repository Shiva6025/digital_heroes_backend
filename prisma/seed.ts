import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();


async function main() {
  console.log('🌱 Seeding Digital Heroes database...');

  // 1. Create Admin User
  const adminEmail = 'admin@digitalheroes.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: 'Super Admin',
        role: 'ADMIN',
        subscriptionStatus: 'ACTIVE',
      },
    });
    console.log('✅ Admin user created: admin@digitalheroes.com / admin123');
  }

  // 2. Create Charities
  const charities = [
    {
      name: 'Cancer Research UK',
      description: 'Pioneering research to bring forward the day when all cancers are cured.',
      image: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?auto=format&fit=crop&q=80&w=800',
      website: 'https://www.cancerresearchuk.org',
      category: 'Health',
      totalReceived: 12500.50
    },
    {
      name: 'UNICEF',
      description: 'Working in over 190 countries and territories to save children’s lives and defend their rights.',
      image: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&q=80&w=800',
      website: 'https://www.unicef.org',
      category: 'Children',
      totalReceived: 8400.00
    },
    {
      name: 'WWF',
      description: 'Protecting the natural world for people and wildlife, focusing on conservation and sustainability.',
      image: 'https://images.unsplash.com/photo-1564349683136-77e08bef1ef1?auto=format&fit=crop&q=80&w=800',
      website: 'https://www.worldwildlife.org',
      category: 'Environment',
      totalReceived: 5600.75
    },
    {
      name: 'Red Cross',
      description: 'Helping people in crisis, whoever and wherever they are, through humanitarian aid and support.',
      image: 'https://images.unsplash.com/photo-1584432810601-6c7f27d2362b?auto=format&fit=crop&q=80&w=800',
      website: 'https://www.redcross.org.uk',
      category: 'Crisis',
      totalReceived: 3200.00
    }
  ];

  for (const charity of charities) {
    const exists = await prisma.charity.findFirst({ where: { name: charity.name } });
    if (!exists) {
      await prisma.charity.create({ data: charity });
      console.log(`✅ Charity created: ${charity.name}`);
    }
  }

  console.log('🚀 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // await prisma.$disconnect();
  });
