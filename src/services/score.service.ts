import { prisma } from '../db';

export const addScore = async (userId: string, value: number, date: Date, grossScore?: number, course?: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.subscriptionStatus === 'CANCELLED') {
    throw new Error('An active subscription is required to log scores');
  }
  if (value < 1 || value > 45) throw new Error('Stableford score must be between 1 and 45');

  const existing = await prisma.score.findUnique({ where: { userId_date: { userId, date } } });
  if (existing) throw new Error('A score for this date already exists');

  await prisma.score.create({ data: { userId, value, date, grossScore, course } });

  // Enforce rolling 5-score limit
  const scores = await prisma.score.findMany({ where: { userId }, orderBy: { date: 'desc' } });
  if (scores.length > 5) {
    const toDelete = scores.slice(5).map(s => s.id);
    await prisma.score.deleteMany({ where: { id: { in: toDelete } } });
  }

  return await getScores(userId);
};

export const getScores = async (userId: string) => {
  return await prisma.score.findMany({ where: { userId }, orderBy: { date: 'desc' } });
};

export const updateScore = async (userId: string, scoreId: string, data: any) => {
  const score = await prisma.score.findUnique({ where: { id: scoreId } });
  if (!score || score.userId !== userId) throw new Error('Score not found');

  const { value, grossScore, course } = data;
  if (value !== undefined && (value < 1 || value > 45)) throw new Error('Score must be between 1 and 45');

  return await prisma.score.update({
    where: { id: scoreId },
    data: {
      ...(value !== undefined && { value }),
      ...(grossScore !== undefined && { grossScore }),
      ...(course !== undefined && { course }),
    }
  });
};

export const deleteScore = async (userId: string, scoreId: string) => {
  const score = await prisma.score.findUnique({ where: { id: scoreId } });
  if (!score || score.userId !== userId) throw new Error('Score not found');
  await prisma.score.delete({ where: { id: scoreId } });
};

export const getScoreTrend = async (userId: string) => {
  const scores = await prisma.score.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 5
  });

  if (scores.length < 2) return { trend: 'insufficient', scores };

  const avg = scores.reduce((sum, s) => sum + s.value, 0) / scores.length;
  const latest = scores[0].value;
  const oldest = scores[scores.length - 1].value;

  return {
    trend: latest > oldest ? 'improving' : latest < oldest ? 'declining' : 'flat',
    average: Math.round(avg * 10) / 10,
    scores
  };
};
