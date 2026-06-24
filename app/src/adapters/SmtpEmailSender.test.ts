import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Transporter } from 'nodemailer';
import { emailSenderFromTransport, createSmtpEmailSender } from './SmtpEmailSender';

// A fake Transporter that just records the last sendMail options.
function fakeTransport(): { transport: Transporter; last: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const transport = {
    async sendMail(opts: Record<string, unknown>) {
      captured = opts;
      return { messageId: 'fake' };
    },
  } as unknown as Transporter;
  return { transport, last: () => captured };
}

test('emailSenderFromTransport maps message fields + From onto sendMail', async () => {
  const { transport, last } = fakeTransport();
  const sender = emailSenderFromTransport(transport, 'Klipo <login@klipo.to>');
  await sender.send({ to: 'user@example.com', subject: 'Hi', html: '<b>hi</b>', text: 'hi' });

  const opts = last();
  assert.equal(opts.from, 'Klipo <login@klipo.to>');
  assert.equal(opts.to, 'user@example.com');
  assert.equal(opts.subject, 'Hi');
  assert.equal(opts.html, '<b>hi</b>');
  assert.equal(opts.text, 'hi');
});

test('emailSenderFromTransport omits text when not provided', async () => {
  const { transport, last } = fakeTransport();
  const sender = emailSenderFromTransport(transport, 'from@x.to');
  await sender.send({ to: 'a@b.to', subject: 's', html: '<p>p</p>' });

  assert.ok(!('text' in last()), 'text key omitted when absent');
});

test('emailSenderFromTransport propagates transport failures', async () => {
  const transport = {
    async sendMail() {
      throw new Error('connection refused');
    },
  } as unknown as Transporter;
  const sender = emailSenderFromTransport(transport, 'from@x.to');
  await assert.rejects(() => sender.send({ to: 'a@b.to', subject: 's', html: 'h' }), /connection refused/);
});

test('createSmtpEmailSender builds a sender without auth (Mailpit-style)', () => {
  const sender = createSmtpEmailSender({ host: 'mailpit', port: 1025, from: 'Klipo <login@klipo.to>' });
  assert.equal(typeof sender.send, 'function');
});
