import nodemailer, { Transporter } from 'nodemailer';
import { EmailSender, EmailMessage } from '../ports';

export interface SmtpConfig {
  host: string;
  port: number;
  /** Optional SMTP auth. Mailpit (and most dev relays) need neither. */
  user?: string;
  pass?: string;
  /** Implicit TLS (port 465). Leave false for Mailpit / STARTTLS relays. */
  secure?: boolean;
  /** From address, e.g. "Klipo <login@klipo.to>". */
  from: string;
}

/**
 * Wraps any nodemailer Transporter as an EmailSender. Split out from the SMTP
 * factory so the field mapping (from/to/subject/html/text) is unit-testable with
 * a fake transport — no socket required.
 */
export function emailSenderFromTransport(transport: Transporter, from: string): EmailSender {
  return {
    async send(msg: EmailMessage): Promise<void> {
      await transport.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      });
    },
  };
}

/**
 * SMTP email adapter (nodemailer). Works against Mailpit in dev (host=mailpit,
 * port=1025, no auth/TLS) and any SMTP relay/provider in production.
 */
export function createSmtpEmailSender(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? false,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  return emailSenderFromTransport(transport, config.from);
}
