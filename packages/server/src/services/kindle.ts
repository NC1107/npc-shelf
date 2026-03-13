import nodemailer from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50MB
const SUPPORTED_KINDLE_FORMATS = ['epub', 'pdf', 'mobi'];

/**
 * Send a book file to a Kindle device via SMTP email.
 */
export async function sendToKindle(
  filePath: string,
  kindleEmail: string,
  smtpConfig: SmtpConfig,
): Promise<{ messageId: string }> {
  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error('Book file not found on disk');
  }

  // Validate format
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (!SUPPORTED_KINDLE_FORMATS.includes(ext)) {
    throw new Error(`Unsupported format for Kindle: ${ext}. Supported: ${SUPPORTED_KINDLE_FORMATS.join(', ')}`);
  }

  // Validate size
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max: 50MB`);
  }

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
  });

  const filename = path.basename(filePath);

  const info = await transporter.sendMail({
    from: smtpConfig.from,
    to: kindleEmail,
    subject: 'NPC-Shelf: Book Delivery',
    text: `Attached: ${filename}`,
    attachments: [
      {
        filename,
        path: filePath,
      },
    ],
  });

  return { messageId: info.messageId };
}
