import { prisma } from '../db';

// Get all users (admin) — excludes other admins
export const getAllUsers = async (search?: string, status?: string) => {
  return await prisma.user.findMany({
    where: {
      role: 'USER', // ← never show admin accounts in the users list
      ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
      ...(status ? { subscriptionStatus: status as any } : {}),
    },
    include: { charity: true, _count: { select: { scores: true, winners: true } } },
    orderBy: { createdAt: 'desc' }
  });
};

export const updateUserStatus = async (userId: string, status: string) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { subscriptionStatus: status as any }
  });
};

export const approveKyc = async (userId: string) => {
  // Update user KYC status
  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: 'VERIFIED' }
  });

  // Move any KYC_REQUIRED winners to PENDING so they can be paid
  await prisma.winner.updateMany({
    where: { userId, status: 'KYC_REQUIRED' },
    data: { status: 'KYC_VERIFIED' }
  });

  // Notify user
  await prisma.notification.create({
    data: {
      userId,
      type: 'IN_APP',
      subject: '✅ KYC Verified',
      message: 'Your identity has been verified. Your prize payout will be processed shortly.'
    }
  });
};

// Admin financial report
export const getFinancialReport = async () => {
  const activeUsers = await prisma.user.count({ where: { subscriptionStatus: 'ACTIVE' } });
  const totalRevenue = activeUsers * 10;

  const totalPaid = await prisma.winner.aggregate({
    where: { status: 'PAID' },
    _sum: { prizeAmount: true }
  });

  const totalCharityContributed = await prisma.user.aggregate({
    _sum: { totalContributed: true }
  });

  const recentDraws = await prisma.draw.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { drawDate: 'desc' },
    take: 6,
    select: { drawDate: true, prizePool: true, totalRevenue: true }
  });

  return {
    activeUsers,
    monthlyRevenue: totalRevenue,
    prizePool: totalRevenue * 0.5,
    charityFund: totalRevenue * 0.1,
    operationalFund: totalRevenue * 0.4,
    totalPrizePaid: totalPaid._sum.prizeAmount || 0,
    totalCharityContributed: totalCharityContributed._sum.totalContributed || 0,
    recentDraws
  };
};

export const getPendingWinners = async () => {
  return await prisma.winner.findMany({
    where: { status: { in: ['KYC_VERIFIED', 'PENDING'] } },
    include: { user: { select: { name: true, email: true, kycStatus: true } }, draw: true },
    orderBy: { createdAt: 'desc' }
  });
};

export const markWinnerPaid = async (winnerId: string, proofUrl?: string) => {
  return await prisma.winner.update({
    where: { id: winnerId },
    data: { status: 'PAID', paidAt: new Date(), proofUrl }
  });
};
