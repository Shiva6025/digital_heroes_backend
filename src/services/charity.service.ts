import { prisma } from '../db';

// Seed or update a charity
export const createCharity = async (data: any) => {
  return await prisma.charity.create({ data });
};

export const getCharities = async () => {
  return await prisma.charity.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { totalReceived: 'desc' }
  });
};

export const getCharityById = async (id: string) => {
  return await prisma.charity.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, totalContributed: true } },
      _count: { select: { users: true } }
    }
  });
};

// Calculate collective impact
export const getImpactStats = async () => {
  const charities = await prisma.charity.findMany({
    select: { id: true, name: true, totalReceived: true, category: true, _count: { select: { users: true } } }
  });

  const totalContributed = await prisma.user.aggregate({
    _sum: { totalContributed: true }
  });

  const activeUsers = await prisma.user.count({ where: { subscriptionStatus: 'ACTIVE' } });

  return {
    totalContributed: totalContributed._sum.totalContributed || 0,
    activeUsers,
    charities
  };
};
