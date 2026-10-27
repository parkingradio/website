import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

// Emails the server sends, e.g. about the applications artists send. Routes get a `SendEmail` passed in, so that their
// tests don't send any.

export type Email = {
  to: string[]
  // Where replies go. Emails are sent from a noreply address, so without this, replies go nowhere.
  replyTo?: string[]
  subject: string
  text: string
}

// Fails with an EmailNotSent.
export type SendEmail = (email: Email) => Promise<void>

// Thrown when an email couldn't be sent. SES's errors can name the addresses it couldn't send to, which are personal
// data, so the message is SES's without any addresses, and SES's error isn't kept. That way, it can be logged.
export class EmailNotSent extends Error {}

// Anything in `text` that looks like an email address, left out. Not only the email's addresses, since SES can write
// them differently, e.g. without the name in "Name <address>".
function withoutAddresses(text: string): string {
  return text.replace(/[^\s@<>,;:"]+@[^\s@<>,;:"]+/g, '<address>')
}

// For each email, retries included. Requests wait for their emails, so SES being slow mustn't keep them hanging.
const TIMEOUT_MS = 10_000

// Sends emails through SES, from noreply@<mailDomain>.
export function sesEmailSender(region: string | undefined, mailDomain: string): SendEmail {
  const ses = new SESv2Client({ region })
  return async ({ to, replyTo, subject, text }) => {
    const command = new SendEmailCommand({
      FromEmailAddress: `noreply@${mailDomain}`,
      Destination: { ToAddresses: to },
      ReplyToAddresses: replyTo,
      Content: {
        Simple: {
          // SES assumes ASCII unless told otherwise, and emails are in French.
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' } },
        },
      },
    })
    try {
      await ses.send(command, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new EmailNotSent(withoutAddresses(error instanceof Error ? `${error.name}: ${error.message}` : String(error)))
    }
  }
}
