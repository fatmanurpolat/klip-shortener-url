// Port: transactional email delivery.
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSender {
  /** Deliver one email. Throws on a provider/transport failure. */
  send(message: EmailMessage): Promise<void>;
}
