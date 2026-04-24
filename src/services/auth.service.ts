import { prisma } from '../db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const signup = async (data: any) => {
  const { email, password, name, phone, charityId } = data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Email already registered');

  const hashedPassword = await bcrypt.hash(password, 10);
  const now = new Date();
  const renewalDate = new Date(now);
  renewalDate.setMonth(renewalDate.getMonth() + 1);
  const gracePeriodEnd = new Date(renewalDate.getTime() + 3 * 24 * 60 * 60 * 1000); // +3 days grace

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      phone,
      charityId: charityId || null,
      subscriptionStatus: 'ACTIVE',
      renewalDate,
      gracePeriodEnd,
    },
  });

  // Create initial subscription record
  await prisma.subscription.create({
    data: {
      userId: user.id,
      plan: 'MONTHLY',
      amount: 10.00,
      currency: 'GBP',
      startDate: new Date(),
      endDate: renewalDate,
      status: 'ACTIVE',
    }
  });

  return user;
};

export const login = async (data: any) => {
  const { email, password } = data;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { charity: true }
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new Error('Invalid email or password');
  }

  // Gate: only regular users on this endpoint
  if (user.role === 'ADMIN') {
    throw new Error('Please use the admin login portal');
  }

  await checkAndUpdateSubscriptionStatus(user.id);

  const freshUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { charity: true }
  });

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return { user: freshUser, token };
};

export const adminLogin = async (data: any) => {
  const { email, password } = data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new Error('Invalid admin credentials');
  }

  if (user.role !== 'ADMIN') {
    throw new Error('Access denied — not an admin account');
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  return { user, token };
};

export const checkAndUpdateSubscriptionStatus = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const now = new Date();

  if (user.subscriptionStatus === 'ACTIVE' && user.renewalDate && user.renewalDate < now) {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: 'OVERDUE' }
    });
  }

  if (user.subscriptionStatus === 'OVERDUE' && user.gracePeriodEnd && user.gracePeriodEnd < now) {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: 'CANCELLED' }
    });
  }
};
