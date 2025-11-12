"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = sendSMS;
exports.sendSMSWithRetry = sendSMSWithRetry;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
// Initialize Twilio client only if credentials are valid
let client = null;
if (accountSid && authToken && accountSid.startsWith('AC')) {
    const twilio = require('twilio');
    client = twilio(accountSid, authToken);
}
async function sendSMS(to, message) {
    try {
        if (!client || !twilioPhoneNumber) {
            console.log('Twilio not configured. SMS would have been sent:', { to, message });
            return true;
        }
        await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
            to: to
        });
        console.log(`SMS sent successfully to ${to}: ${message}`);
        return true;
    }
    catch (error) {
        console.error('Error sending SMS:', error);
        return false;
    }
}
async function sendSMSWithRetry(to, message, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const success = await sendSMS(to, message);
            if (success)
                return true;
            console.log(`SMS attempt ${i + 1} failed, retrying...`);
            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        catch (error) {
            console.error(`SMS attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1)
                return false;
        }
    }
    return false;
}
//# sourceMappingURL=twilio.js.map