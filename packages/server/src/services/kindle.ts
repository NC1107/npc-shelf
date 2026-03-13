/**
 * Send-to-Kindle via SMTP.
 * Full implementation in Phase 7.
 */
export async function sendToKindle(
  filePath: string,
  kindleEmail: string,
  smtpConfig: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  },
): Promise<{ messageId: string }> {
  // TODO: Implement with nodemailer
  throw new Error('Kindle delivery not yet implemented');
}
