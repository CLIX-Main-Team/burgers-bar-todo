import nodemailer, { type Transporter } from 'nodemailer'
import type { MailMessage, Mailer } from './mailer.js'

// The one env-driven nodemailer SMTP implementation of the mailer port (ADR-0008): the
// same code path for mailpit locally (SMTP on 1025, no auth) and Gmail in prod, differing
// only in the injected settings. The transport-agnostic Mailer interface hides all of
// this from callers; only the composition root (auth/wire.ts) constructs it.
export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  // Optional so an unauthenticated relay (mailpit) needs no credentials; when a user is
  // set the password rides with it (Gmail).
  user?: string
  password?: string
  // The From header every message carries, e.g. `Burgers Bar <no-reply@burgers.local>`.
  from: string
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Only present auth when a user is configured; mailpit accepts mail without it.
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  })

  return {
    send: async (message: MailMessage) => {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
    },
  }
}
