import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

/**
 * Send SMS notification to a phone number
 * @param to - Phone number to send to (e.g., "+1234567890")
 * @param message - Message body
 */
export async function sendSMS(to: string, message: string) {
    if (!accountSid || !authToken || !twilioPhoneNumber) {
        console.warn('⚠️  Twilio credentials not configured. SMS not sent.');
        return { success: false, error: 'Twilio not configured' };
    }

    try {
        const result = await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
            to: to,
        });

        console.log(`✅ SMS sent to ${to}: ${result.sid}`);
        return { success: true, sid: result.sid };
    } catch (error: any) {
        console.error(`❌ Failed to send SMS to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send email notification (placeholder - integrate with your email service)
 * @param to - Email address
 * @param subject - Email subject
 * @param body - Email body
 */
export async function sendEmail(to: string, subject: string, body: string) {
    // TODO: Integrate with SendGrid, Resend, or another email service
    console.log(`📧 Email would be sent to: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);

    return { success: true, message: 'Email service not yet configured' };
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
