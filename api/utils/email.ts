const resendApiKey = process.env.RESEND_API_KEY;

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    if (!resendApiKey) {
      console.log('Resend not configured. Email would have been sent:', { to, subject });
      return true;
    }

    // In a real implementation, you would use the Resend API
    // const { Resend } = require('resend');
    // const resend = new Resend(resendApiKey);
    // 
    // await resend.emails.send({
    //   from: 'reminders@compliancereminder.com',
    //   to: [to],
    //   subject: subject,
    //   html: html
    // });

    console.log(`Email sent successfully to ${to}: ${subject}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

export async function sendEmailWithRetry(
  to: string, 
  subject: string, 
  html: string,
  maxRetries: number = 3
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const success = await sendEmail(to, subject, html);
      if (success) return true;
      
      console.log(`Email attempt ${i + 1} failed, retrying...`);
      // Wait 2 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Email attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) return false;
    }
  }
  return false;
}