# Compliance Reminder SaaS - Cron Job Setup

## Overview

The application uses a daily cron job to automatically check for expiring licenses and send notifications to business owners and admins.

## How It Works

1. **Daily Check**: Runs every day at 9:00 AM UTC
2. **Expiration Milestones**: Checks for licenses expiring in exactly 30, 60, and 90 days
3. **Smart Notifications**: Only notifies OWNER and ADMIN roles (not VIEWERs)
4. **Duplicate Prevention**: Tracks sent notifications in `reminder_schedules` table

## Architecture

```
┌─────────────────┐
│  Vercel Cron    │ Triggers daily at 9 AM UTC
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ /api/cron/check-expirations     │
│  - Calls getExpiringLicenses()  │
│  - For each: 30, 60, 90 days    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Notification Service           │
│  - Formats messages             │
│  - Sends SMS (Twilio)           │
│  - Sends Email (TODO)           │
│  - Logs to reminder_schedules   │
└─────────────────────────────────┘
```

## Setup Instructions

### 1. Environment Variables

Add these to your `.env` file and Vercel:

```env
# Twilio (for SMS notifications)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Cron Security (prevent unauthorized cron calls)
CRON_SECRET=your_random_secret_key
```

### 2. Vercel Cron Configuration

The `vercel.json` file is already configured:

```json
{
  "crons": [
    {
      "path": "/api/cron/check-expirations",
      "schedule": "0 9 * * *"
    }
  ]
}
```

**Schedule Format**: Uses standard cron syntax
- `0 9 * * *` = Every day at 9:00 AM UTC
- Adjust as needed (e.g., `0 */6 * * *` for every 6 hours)

### 3. Deploy to Vercel

Vercel Cron only works on **production deployments**. After pushing your code:

1. Deploy to production
2. Verify cron is registered in Vercel Dashboard → Project → Settings → Cron Jobs
3. Test manually by visiting: `https://your-domain.vercel.app/api/cron/check-expirations` (include Authorization header)

### 4. Manual Testing

You can test the cron job locally or in production:

```bash
curl -X GET https://your-domain.com/api/cron/check-expirations \
  -H "Authorization: Bearer your_cron_secret"
```

Expected response:
```json
{
  "success": true,
  "timestamp": "2025-11-21T09:00:00.000Z",
  "notificationsSent": 3,
  "results": [
    {
      "license": "Health Permit",
      "business": "Acme Restaurant",
      "daysUntil Expiration": 30,
      "recipientsNotified": 2
    }
  ]
}
```

## Email Integration (TODO)

Currently, email notifications are placeholders. To enable:

1. Choose an email service (SendGrid, Resend, AWS SES)
2. Install the SDK: `npm install @sendgrid/mail`
3. Update `lib/services/notifications.ts` → `sendEmail()` function
4. Add API key to environment variables

## Monitoring

View cron execution logs in:
- **Vercel Dashboard** → Your Project → Deployments → Functions → `/api/cron/check-expirations`
- Check `reminder_schedules` table for sent notifications

## Troubleshooting

### Cron not running?
- Verify it appears in Vercel → Settings → Cron Jobs
- Check you're looking at **production** (not preview)
- Cron only works on Vercel Pro plan or higher

### Notifications not sending?
- Verify Twilio credentials in Vercel environment variables
- Check function logs for errors
- Test `/api/test-expiration` to verify license data exists

### Duplicate notifications?
- The system prevents duplicates using `reminder_schedules` table
- Unique constraint on `(licenseId, daysBeforeExpiration, reminderType)`

## Cost Considerations

**Twilio SMS**:
- ~$0.0075 per SMS in the US
- For 10 businesses × 3 notifications/year × 2 recipients = 60 SMS = ~$0.45/year per business

**Email** (when implemented):
- SendGrid: 100 emails/day free
- Resend: 3,000 emails/month free
