import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailNotSent, sesEmailSender } from './email.js'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = send
  },
  SendEmailCommand: class {
    constructor(input: unknown) {
      Object.assign(this as object, input)
    }
  },
}))

describe('sesEmailSender', () => {
  beforeEach(() => {
    send.mockReset()
  })

  it('sends from noreply@<mail domain>, in UTF-8, with replies', async () => {
    const sendEmail = sesEmailSender('us-east-1', 'parking.radio')
    await sendEmail({
      to: ['equipe@example.com'],
      replyTo: ['artiste@example.com'],
      subject: 'Nouvelle candidature : Éloïse',
      text: 'Ça va ?',
    })
    expect(send).toHaveBeenCalledWith(
      {
        FromEmailAddress: 'noreply@parking.radio',
        Destination: { ToAddresses: ['equipe@example.com'] },
        ReplyToAddresses: ['artiste@example.com'],
        Content: {
          Simple: {
            Subject: { Data: 'Nouvelle candidature : Éloïse', Charset: 'UTF-8' },
            Body: { Text: { Data: 'Ça va ?', Charset: 'UTF-8' } },
          },
        },
      },
      // So that SES can't keep the request hanging.
      { abortSignal: expect.any(AbortSignal) },
    )
  })

  it("fails when SES does, with SES's error, without any address, however it's written", async () => {
    const message = 'The following identities failed the check: ARTISTE@example.com, <equipe@example.com>, "x"<other@example.com>'
    send.mockRejectedValueOnce(Object.assign(new Error(message), { name: 'MessageRejected' }))
    const sendEmail = sesEmailSender('us-east-1', 'parking.radio')
    const sent = sendEmail({ to: ['artiste@example.com'], replyTo: ['equipe@example.com'], subject: 'Sujet', text: 'Texte' })
    await expect(sent).rejects.toThrow(
      new EmailNotSent('MessageRejected: The following identities failed the check: <address>, <<address>>, "x"<<address>>'),
    )
    await expect(sent).rejects.toBeInstanceOf(EmailNotSent)
    await expect(sent).rejects.not.toHaveProperty('cause')
  })

  it('gives up after 10 seconds, retries included, failing like for any other error', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    send.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    const sendEmail = sesEmailSender('us-east-1', 'parking.radio')
    const sent = sendEmail({ to: ['equipe@example.com'], subject: 'Sujet', text: 'Texte' })
    await expect(sent).rejects.toThrow(new EmailNotSent('TimeoutError: The operation was aborted due to timeout'))
    expect(timeout).toHaveBeenCalledWith(10_000)
    expect(send.mock.calls[0][1].abortSignal).toBe(timeout.mock.results[0].value)
    timeout.mockRestore()
  })
})
