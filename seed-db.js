const Database = require('better-sqlite3');
const path = require('path');

// Connect to the database
const dbPath = path.join(__dirname, 'prisma', 'dev.db');
const db = new Database(dbPath);

console.log('🌱 Seeding database with demo data...');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Seed demo user
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, email, name, phone, stripe_customer_id, subscription_tier, subscription_status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`);

const userResult = insertUser.run(
  'demo-user-123',
  'demo@example.com',
  'Demo Admin',
  '+1 (555) 123-4567',
  'cus_demo_123',
  'starter',
  'active'
);

console.log(`✅ Created demo user: demo@example.com (ID: demo-user-123)`);

// Close the database
db.close();

console.log('\n🎉 Database seeding completed successfully!');