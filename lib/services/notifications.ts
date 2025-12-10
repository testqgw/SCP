import twilio from 'twilio';
import { Resend } from 'resend';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize Resend
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const fromEmail = process.env.RESEND_FROM_EMAIL || 'UltOps <onboarding@resend.dev>';

const client = twilio(accountSid, authToken);

/**
 * Normalize phone number to E.164 format (+1XXXXXXXXXX)
 */
function normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // If 10 digits (US number without country code), add +1
    if (digits.length === 10) {
        return `+1${digits}`;
    }

    // If 11 digits starting with 1, add +
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+${digits}`;
    }

    // If already has + prefix, return as-is
    if (phone.startsWith('+')) {
        return phone;
    }

    // Otherwise, assume it needs +
    return `+${digits}`;
}

/**
 * Send SMS notification to a phone number
 * @param to - Phone number to send to (e.g., "+1234567890" or "1234567890")
 * @param message - Message body
 */
export async function sendSMS(to: string, message: string) {
    if (!accountSid || !authToken || !twilioPhoneNumber) {
        console.warn('⚠️  Twilio credentials not configured. SMS not sent.');
        return { success: false, error: 'Twilio not configured' };
    }

    // Normalize phone number to E.164 format
    const normalizedPhone = normalizePhoneNumber(to);

    try {
        const result = await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
            to: normalizedPhone,
        });

        console.log(`✅ SMS sent to ${normalizedPhone}: ${result.sid}`);
        return { success: true, sid: result.sid };
    } catch (error: any) {
        console.error(`❌ Failed to send SMS to ${normalizedPhone}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send email notification via Resend
 * @param to - Email address
 * @param subject - Email subject
 * @param body - Email body (text)
 * @param html - Optional HTML body
 */
export async function sendEmail(to: string, subject: string, body: string, html?: string) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured. Email not sent.');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const result = await resend.emails.send({
            from: fromEmail,
            to: [to],
            subject: subject,
            text: body,
            html: html || body.replace(/\n/g, '<br>'),
        });

        console.log(`✅ Email sent to ${to}:`, result);
        return { success: true, id: result.data?.id };
    } catch (error: any) {
        console.error(`❌ Failed to send email to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Format license expiration message for notifications
 * @param licenseName - Name/type of the license
 * @param businessName - Name of the business
 * @param daysUntilExpiration - Number of days until expiration
 * @param renewalUrl - Optional renewal URL
 */
export function formatExpirationMessage(
    licenseName: string,
    businessName: string,
    daysUntilExpiration: number,
    renewalUrl?: string
): string {
    const urgency = daysUntilExpiration <= 30 ? '🚨 URGENT' : '⚠️  REMINDER';

    let message = `${urgency}: Your ${licenseName} for ${businessName} expires in ${daysUntilExpiration} days.`;

    if (renewalUrl) {
        message += `\n\nRenew now: ${renewalUrl}`;
    }

    return message;
}

/**
 * Generate HTML email for license expiration
 */
export function generateExpirationEmailHtml(
    licenseName: string,
    businessName: string,
    daysUntilExpiration: number,
    renewalUrl?: string
): string {
    const urgencyColor = daysUntilExpiration <= 7 ? '#dc2626' : daysUntilExpiration <= 30 ? '#f59e0b' : '#3b82f6';
    const urgencyText = daysUntilExpiration <= 7 ? 'URGENT' : daysUntilExpiration <= 30 ? 'ACTION NEEDED' : 'REMINDER';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); padding: 30px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">⚡ UltOps Alert</h1>
            </div>
            
            <!-- Urgency Badge -->
            <div style="background: ${urgencyColor}; padding: 12px; text-align: center;">
                <span style="color: white; font-weight: bold; font-size: 14px; letter-spacing: 1px;">${urgencyText}</span>
            </div>
            
            <!-- Content -->
            <div style="padding: 30px;">
                <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 20px;">
                    Your ${licenseName} expires in <span style="color: ${urgencyColor};">${daysUntilExpiration} days</span>
                </h2>
                
                <p style="color: #64748b; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    This is a reminder that your <strong>${licenseName}</strong> for <strong>${businessName}</strong> is approaching its expiration date.
                </p>
                
                <div style="background: #f8fafc; border-left: 4px solid ${urgencyColor}; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                    <p style="margin: 0; color: #475569; font-size: 14px;">
                        ⏰ Don't wait until the last minute! Renew now to avoid fines and business interruption.
                    </p>
                </div>
                
                ${renewalUrl ? `
                <a href="${renewalUrl}" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; margin-top: 10px;">
                    Renew Now →
                </a>
                ` : ''}
            </div>
            
            <!-- Footer -->
            <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    You're receiving this because you have a license tracked in UltOps.<br>
                    <a href="https://ultops.com" style="color: #3b82f6;">Manage your licenses</a>
                </p>
            </div>
        </div>
    </body>
    </html>
    `;
}

