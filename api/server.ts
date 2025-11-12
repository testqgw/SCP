// Railway deployment trigger
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import businesses from './routes/businesses';
import licenses from './routes/licenses';
import billing from './routes/billing';
import documents from './routes/documents';
import { ReminderJob } from './jobs/reminderJob';
import { verifyAuth } from './middleware/auth';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/businesses', businesses);
app.use('/api/licenses', licenses);
app.use('/api/billing', billing);
app.use('/api/documents', documents);

// Protected test route for reminders (staging only)
app.post('/api/jobs/reminders/run', verifyAuth, async (req, res) => {
  console.log('Manual reminder job trigger requested');
  await ReminderJob.triggerManually();
  res.json({ message: 'Reminder job executed' });
});

// Start reminder job
ReminderJob.start();

// Start server
app.listen(PORT, () => {
  console.log(`✅ API server running on port ${PORT}`);
  console.log(`🚀 Test it: http://localhost:${PORT}/health`);
});