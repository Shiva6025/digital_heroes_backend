import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { signup, login, adminLogin, checkAndUpdateSubscriptionStatus } from './services/auth.service';
import { addScore, getScores, getScoreTrend, updateScore, deleteScore } from './services/score.service';
import { executeDraw, getDrawHistory } from './services/draw.service';
import { getCharities, getCharityById, getImpactStats } from './services/charity.service';
import { getAllUsers, updateUserStatus, approveKyc, getFinancialReport, getPendingWinners, markWinnerPaid } from './services/admin.service';
import { prisma } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────
const auth = (req: any, res: any, next: any) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const adminOnly = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ─────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const user = await signup(req.body);
    res.status(201).json({ success: true, message: 'Account created successfully', user });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await login(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

// Separate Admin Login Endpoint
app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const result = await adminLogin(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth, async (req: any, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      await checkAndUpdateSubscriptionStatus(req.user.id);
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { charity: true }
    });
    res.json(user);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SCORE ROUTES
// ─────────────────────────────────────────
app.post('/api/scores', auth, async (req: any, res) => {
  try {
    const { value, date, grossScore, course } = req.body;
    const scores = await addScore(req.user.id, value, new Date(date), grossScore, course);
    res.json(scores);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/scores', auth, async (req: any, res) => {
  try {
    const scores = await getScores(req.user.id);
    res.json(scores);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/scores/:id', auth, async (req: any, res) => {
  try {
    const score = await updateScore(req.user.id, req.params.id, req.body);
    res.json(score);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/scores/:id', auth, async (req: any, res) => {
  try {
    await deleteScore(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/scores/trend', auth, async (req: any, res) => {
  try {
    const trend = await getScoreTrend(req.user.id);
    res.json(trend);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// CHARITY ROUTES
// ─────────────────────────────────────────
app.get('/api/charities', async (_req, res) => {
  try {
    const charities = await getCharities();
    res.json(charities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/charities/impact', async (_req, res) => {
  try {
    const stats = await getImpactStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/charities/:id', async (req, res) => {
  try {
    const charity = await getCharityById(req.params.id);
    res.json(charity);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// DRAW ROUTES
// ─────────────────────────────────────────
app.get('/api/draws', async (_req, res) => {
  try {
    const draws = await getDrawHistory();
    res.json(draws);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Draw Entry ───
// Returns the user's current draw numbers (last 5 scores) and eligibility
app.get('/api/my/draw-entry', auth, async (req: any, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { subscriptionStatus: true, name: true }
    });

    if (user?.subscriptionStatus !== 'ACTIVE') {
      return res.json({ eligible: false, reason: 'Active subscription required to enter the draw.' });
    }

    const scores = await prisma.score.findMany({
      where: { userId: req.user.id },
      orderBy: { date: 'desc' },
      take: 5
    });

    if (scores.length === 0) {
      return res.json({ eligible: false, reason: 'Log at least one Stableford score to enter the monthly draw.' });
    }

    // Draw numbers = Stableford values from last 5 scores
    const drawNumbers = scores.map(s => s.value);

    // Next draw is first day of next month
    const now = new Date();
    const nextDraw = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const lastDraw = await prisma.draw.findFirst({ orderBy: { drawDate: 'desc' } });

    res.json({
      eligible: true,
      drawNumbers,
      scoresUsed: scores.length,
      nextDrawDate: nextDraw.toISOString(),
      lastDraw: lastDraw ? {
        date: lastDraw.drawDate,
        numbers: lastDraw.numbers,
        prizePool: lastDraw.prizePool
      } : null
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/my/wins', auth, async (req: any, res) => {
  try {
    const wins = await prisma.winner.findMany({
      where: { userId: req.user.id },
      include: { draw: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(wins);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Upload winner screenshot proof
app.patch('/api/my/wins/:id/proof', auth, async (req: any, res) => {
  try {
    const { proofUrl } = req.body;
    const win = await prisma.winner.findUnique({ where: { id: req.params.id } });
    if (!win || win.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.winner.update({
      where: { id: req.params.id },
      data: { proofUrl, status: 'KYC_REQUIRED' } // re-using KYC_REQUIRED as "Under Review"
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Notifications
app.get('/api/notifications', auth, async (req: any, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { sentAt: 'desc' },
      take: 20
    });
    res.json(notifications);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/notifications/:id/read', auth, async (req: any, res) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────

// Draw: Execute
app.post('/api/admin/draw', auth, adminOnly, async (req: any, res) => {
  try {
    const draw = await executeDraw(req.body.type || 'RANDOM', false);
    res.json(draw);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Draw: Simulate (no DB changes)
app.post('/api/admin/draw/simulate', auth, adminOnly, async (req: any, res) => {
  try {
    const result = await executeDraw(req.body.type || 'RANDOM', true);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/users', auth, adminOnly, async (req: any, res) => {
  try {
    const { search, status } = req.query;
    const users = await getAllUsers(search as string, status as string);
    res.json(users);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id/status', auth, adminOnly, async (req: any, res) => {
  try {
    const user = await updateUserStatus(req.params.id, req.body.status);
    res.json(user);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Edit user scores
app.patch('/api/admin/users/:userId/scores/:scoreId', auth, adminOnly, async (req: any, res) => {
  try {
    const score = await updateScore(req.params.userId, req.params.scoreId, req.body);
    res.json(score);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Approve winner's screenshot (verify)
app.post('/api/admin/winners/:id/verify', auth, adminOnly, async (req: any, res) => {
  try {
    const winner = await prisma.winner.update({
      where: { id: req.params.id },
      data: { status: 'KYC_VERIFIED' }
    });

    await prisma.notification.create({
      data: {
        userId: winner.userId,
        type: 'IN_APP',
        subject: '✅ Proof Accepted',
        message: 'Your score screenshots have been verified. Your prize will be processed shortly.'
      }
    });

    res.json(winner);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/kyc/:userId/approve', auth, adminOnly, async (req: any, res) => {
  try {
    await approveKyc(req.params.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/reports/financial', auth, adminOnly, async (_req, res) => {
  try {
    const report = await getFinancialReport();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/winners/pending', auth, adminOnly, async (_req, res) => {
  try {
    const winners = await getPendingWinners();
    res.json(winners);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/winners/:id/pay', auth, adminOnly, async (req: any, res) => {
  try {
    const winner = await markWinnerPaid(req.params.id, req.body.proofUrl);
    res.json(winner);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: CRUD Charities
app.post('/api/admin/charities', auth, adminOnly, async (req: any, res) => {
  try {
    const charity = await prisma.charity.create({ data: req.body });
    res.status(201).json(charity);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/charities/:id', auth, adminOnly, async (req: any, res) => {
  try {
    const charity = await prisma.charity.update({ where: { id: req.params.id }, data: req.body });
    res.json(charity);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/charities/:id', auth, adminOnly, async (req: any, res) => {
  try {
    await prisma.charity.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// ROOT & HEALTH CHECK
// ─────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Digital Heroes API',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth/signup | /api/auth/login | /api/auth/admin-login',
      charities: '/api/charities',
      scores: '/api/scores',
      draw: '/api/draw',
      admin: '/api/admin',
      health: '/health',
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Vercel serverless deployment
export default app;

// Only start the HTTP server in non-serverless environments (local dev)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`✅ Digital Heroes API running on http://localhost:${PORT}`);
  });
}
