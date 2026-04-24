import { prisma } from '../db';

/**
 * Execute a monthly draw.
 *
 * Prize Pool = 50% of total subscription revenue that month.
 * Tier split per PRD Section 07:
 *   5-match (Jackpot): 40% of pool
 *   4-match: 35% of pool
 *   3-match: 25% of pool
 *
 * KYC: Winners upload score screenshots for admin review (not a £500 threshold).
 */
export const executeDraw = async (type: 'RANDOM' | 'ALGORITHMIC', simulate = false) => {
  // Calculate prize pool from ACTIVE subscribers
  const activeCount = await prisma.user.count({ where: { subscriptionStatus: 'ACTIVE' } });
  const totalRevenue = activeCount * 10; // £10/user/month
  const prizePool = totalRevenue * 0.5;   // 50% goes to prize pool

  // PRD Section 07: 40 / 35 / 25
  const firstPrize  = prizePool * 0.40;
  const secondPrize = prizePool * 0.35;
  const thirdPrize  = prizePool * 0.25;

  let winningNumbers: number[] = [];

  if (type === 'RANDOM') {
    const nums = new Set<number>();
    while (nums.size < 5) nums.add(Math.floor(Math.random() * 45) + 1);
    winningNumbers = [...nums];
  } else {
    // Algorithmic: weighted by community Stableford score frequency
    const allScores = await prisma.score.findMany({ select: { value: true } });
    const counts: Record<number, number> = {};
    allScores.forEach(s => { counts[s.value] = (counts[s.value] || 0) + 1; });

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(e => parseInt(e[0]));

    const nums = new Set<number>();
    for (const n of sorted) { if (nums.size < 5) nums.add(n); }
    while (nums.size < 5) nums.add(Math.floor(Math.random() * 45) + 1);
    winningNumbers = [...nums];
  }

  winningNumbers.sort((a, b) => a - b);

  // Simulation mode: return numbers without saving to DB
  if (simulate) {
    return {
      simulated: true,
      type,
      numbers: winningNumbers.join(','),
      prizePool,
      firstPrize,
      secondPrize,
      thirdPrize,
      activeSubscribers: activeCount,
      totalRevenue,
    };
  }

  const draw = await prisma.draw.create({
    data: {
      type,
      numbers: winningNumbers.join(','),
      status: 'PUBLISHED',
      totalRevenue,
      prizePool,
      firstPrize,
      secondPrize,
      thirdPrize,
    }
  });

  await calculateWinners(draw.id, winningNumbers, firstPrize, secondPrize, thirdPrize);

  return draw;
};

const calculateWinners = async (
  drawId: string,
  winningNumbers: number[],
  firstPrize: number,
  secondPrize: number,
  thirdPrize: number
) => {
  const users = await prisma.user.findMany({
    where: { subscriptionStatus: { in: ['ACTIVE', 'OVERDUE'] } },
    include: { scores: { orderBy: { date: 'desc' }, take: 5 } }
  });

  // Group winners by tier to split prize equally
  const tier1: any[] = [];
  const tier2: any[] = [];
  const tier3: any[] = [];

  for (const user of users) {
    const userNumbers = user.scores.map(s => s.value);
    const matchCount = userNumbers.filter(n => winningNumbers.includes(n)).length;

    if (matchCount >= 5)     tier1.push({ user, matchCount: 5 });
    else if (matchCount === 4) tier2.push({ user, matchCount: 4 });
    else if (matchCount === 3) tier3.push({ user, matchCount: 3 });
  }

  // Create winners with prize split equally within tier
  const createWinners = async (tier: any[], tierNum: number, totalPrize: number) => {
    if (tier.length === 0) return;
    const perPersonPrize = totalPrize / tier.length;

    for (const { user, matchCount } of tier) {
      await prisma.winner.create({
        data: {
          userId: user.id,
          drawId,
          matchCount,
          tier: tierNum,
          prizeAmount: perPersonPrize,
          kycRequired: false, // PRD: winners upload screenshots, no £ threshold
          status: 'PENDING',
        }
      });

      // In-app notification
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'IN_APP',
          subject: '🏆 You\'ve won!',
          message: `Congratulations! You matched ${matchCount} numbers in this month's draw and won £${perPersonPrize.toFixed(2)}! Please upload your score screenshots to claim your prize.`,
        }
      });
    }
  };

  await createWinners(tier1, 1, firstPrize);
  await createWinners(tier2, 2, secondPrize);
  await createWinners(tier3, 3, thirdPrize);
};

export const getDrawHistory = async () => {
  return await prisma.draw.findMany({
    where: { status: 'PUBLISHED' },
    include: {
      winners: {
        include: { user: { select: { name: true, email: true } } }
      }
    },
    orderBy: { drawDate: 'desc' }
  });
};
