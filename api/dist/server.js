"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const businesses_1 = __importDefault(require("./routes/businesses"));
const licenses_1 = __importDefault(require("./routes/licenses"));
const billing_1 = __importDefault(require("./routes/billing"));
const documents_1 = __importDefault(require("./routes/documents"));
const reminderJob_1 = require("./jobs/reminderJob");
const auth_1 = require("./middleware/auth");
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});
// API routes
app.use('/api/businesses', businesses_1.default);
app.use('/api/licenses', licenses_1.default);
app.use('/api/billing', billing_1.default);
app.use('/api/documents', documents_1.default);
// Protected test route for reminders (staging only)
app.post('/api/jobs/reminders/run', auth_1.verifyAuth, async (req, res) => {
    console.log('Manual reminder job trigger requested');
    await reminderJob_1.ReminderJob.triggerManually();
    res.json({ message: 'Reminder job executed' });
});
// Start reminder job
reminderJob_1.ReminderJob.start();
// Start server
app.listen(PORT, () => {
    console.log(`✅ API server running on port ${PORT}`);
    console.log(`🚀 Test it: http://localhost:${PORT}/health`);
});
//# sourceMappingURL=server.js.map