import sendEmail from '../email/send-email.js'
import {
  eventApprovedTemplate,
  eventRejectedTemplate,
  guestTicketAccessTemplate,
  organizerApprovedTemplate,
  organizerRejectedTemplate,
  refundProcessedTemplate,
  resetPasswordTemplate,
  ticketConfirmationTemplate,
  verifyAccountTemplate,
} from '../lib/emailTemplates.js'
import { generateQrCodeBuffer } from '../lib/qrcode.js'
import EmailQueue from '../models/emailQueue.js'
// import { IUser } from '../models/user.js'

export class EmailService {
  static async sendVerifyAccountEmail({
    user,
    otp,
    link,
  }: {
    user: any
    otp: string
    link: string
  }): Promise<{ success: boolean; queued: boolean }> {
    const htmlBody = verifyAccountTemplate(user.fullname, otp, link)
    const result = await sendEmail({
      email: user.email,
      subject: 'Verify your account - Eventra',
      message: htmlBody,
    })
    if (result.success) {
      return { success: true, queued: false }
    }

    // Queue for retry via cron job
    await EmailQueue.create({
      to: user.email,
      subject: 'Verify your account - Eventra',
      html: htmlBody,
      priority: 'high',
      status: 'queued',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // First retry in 5 minutes
    })
    return { success: false, queued: true }
  }

  static async sendPasswordResetEmail({
    user,
    otp,
  }: {
    user: any
    otp: string
  }): Promise<{ success: boolean; queued: boolean }> {
    const htmlBody = resetPasswordTemplate(user.fullname, otp)
    const result = await sendEmail({
      email: user.email,
      subject: 'Reset your password - Eventra',
      message: htmlBody,
    })
    if (result.success) {
      return { success: true, queued: false }
    }

    await EmailQueue.create({
      to: user.email,
      subject: 'Reset your password - Eventra',
      html: htmlBody,
      priority: 'high',
      status: 'queued',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    return { success: false, queued: true }
  }

  /**
   * Sends the OTP for the "track my ticket by email" flow — same shape as
   * sendPasswordResetEmail, but for someone who never had an account to
   * reset a password on in the first place.
   */
  static async sendGuestTicketAccessEmail({ email, otp }: { email: string; otp: string }): Promise<{ success: boolean; queued: boolean }> {
    const htmlBody = guestTicketAccessTemplate(otp)
    const subject = 'Access your Eventra tickets'
    const result = await sendEmail({
      email,
      subject,
      message: htmlBody,
    })
    if (result.success) {
      return { success: true, queued: false }
    }

    await EmailQueue.create({
      to: email,
      subject,
      html: htmlBody,
      priority: 'high',
      status: 'queued',
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    return { success: false, queued: true }
  }

  /**
   * Sends a ticket/RSVP confirmation with each ticket's QR code attached as a PNG.
   * Best-effort: a failure here never blocks ticket issuance — the attendee can
   * always find their ticket under My Tickets even if this email doesn't land.
   */
  static async sendTicketConfirmationEmail({
    user,
    eventTitle,
    eventDateLabel,
    venueLabel,
    ticketCodes,
  }: {
    user: any
    eventTitle: string
    eventDateLabel: string
    venueLabel: string
    ticketCodes: string[]
  }): Promise<{ success: boolean }> {
    const htmlBody = ticketConfirmationTemplate(user.fullname, eventTitle, eventDateLabel, venueLabel, ticketCodes.length, ticketCodes)

    const attachments = await Promise.all(
      ticketCodes.map(async (code, index) => ({
        filename: `ticket-${index + 1}.png`,
        content: await generateQrCodeBuffer(code),
      }))
    )

    const result = await sendEmail({
      email: user.email,
      subject: `Your ticket${ticketCodes.length > 1 ? 's' : ''} for ${eventTitle}`,
      message: htmlBody,
      attachments,
    })

    return { success: result.success }
  }

  static async sendOrganizerApprovedEmail(user: any): Promise<{ success: boolean }> {
    const result = await sendEmail({
      email: user.email,
      subject: "You're approved to organize on Eventra",
      message: organizerApprovedTemplate(user.fullname),
    })
    return { success: result.success }
  }

  static async sendOrganizerRejectedEmail(user: any): Promise<{ success: boolean }> {
    const result = await sendEmail({
      email: user.email,
      subject: 'Update on your organizer application',
      message: organizerRejectedTemplate(user.fullname),
    })
    return { success: result.success }
  }

  static async sendEventApprovedEmail(user: any, eventTitle: string): Promise<{ success: boolean }> {
    const result = await sendEmail({
      email: user.email,
      subject: `${eventTitle} is live!`,
      message: eventApprovedTemplate(user.fullname, eventTitle),
    })
    return { success: result.success }
  }

  static async sendEventRejectedEmail(user: any, eventTitle: string, reason: string): Promise<{ success: boolean }> {
    const result = await sendEmail({
      email: user.email,
      subject: `${eventTitle} needs a change before it can go live`,
      message: eventRejectedTemplate(user.fullname, eventTitle, reason),
    })
    return { success: result.success }
  }

  static async sendRefundProcessedEmail(user: any, eventTitle: string, amountLabel: string): Promise<{ success: boolean }> {
    const result = await sendEmail({
      email: user.email,
      subject: 'Your refund has been processed',
      message: refundProcessedTemplate(user.fullname, eventTitle, amountLabel),
    })
    return { success: result.success }
  }
}

export const emailService = new EmailService()