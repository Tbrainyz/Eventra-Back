// Brand palette pulled from the actual app (index.css / ticket-card.tsx),
// not invented for email — #0C5C48 is the same gradient start used on the
// in-app ticket stub, so a ticket looks like the same "brand" wherever
// it's seen. Email clients can't read CSS custom properties, so these are
// hardcoded hex, kept in one place for this file to stay consistent.
const BRAND_GREEN = '#0C5C48'
const BRAND_GREEN_DARK = '#021713'
const BRAND_MINT = '#E9F5F0'
const BRAND_AMBER = '#F59E0B'
const INK = '#1C1917'
const SUBTLE = '#57534E'
const MUTED = '#A8A29E'

const baseLayout = (
  title: string,
  name: string,
  content: string,
  actionLink?: string,
  actionText?: string,
  expiryText?: string,
  code?: string
) => `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <title>${title} - Eventra</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

          body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #F5F0EB;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
          }

          .wrapper {
            width: 100%;
            table-layout: fixed;
            background-color: #F5F0EB;
            padding: 48px 0;
          }

          .container {
            width: 100%;
            max-width: 600px;
            background-color: #FFFFFF;
            margin: 0 auto;
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
            border: 1px solid #EAE2D7;
          }

          /* Solid brand banner instead of a decorative gradient — reads as
             "Eventra green" at a glance rather than generic rainbow trim */
          .top-banner {
            height: 6px;
            background-color: ${BRAND_GREEN};
          }

          .header {
            background-color: #FFFFFF;
            padding: 32px 40px 20px;
            text-align: left;
          }

          .logo-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .logo-text {
            font-size: 22px;
            font-weight: 800;
            color: ${INK};
            letter-spacing: -0.02em;
            display: flex;
            align-items: center;
          }

          .event-badge {
            font-size: 11px;
            font-weight: 700;
            color: ${BRAND_GREEN};
            background-color: ${BRAND_MINT};
            padding: 4px 10px;
            border-radius: 20px;
            letter-spacing: 0.03em;
            text-transform: uppercase;
          }

          .content {
            padding: 32px 40px;
            color: ${SUBTLE};
          }

          .title {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 20px;
            color: ${INK};
            letter-spacing: -0.02em;
            line-height: 1.2;
          }

          .greeting {
            font-size: 15px;
            font-weight: 600;
            color: ${BRAND_GREEN};
            margin-bottom: 12px;
          }

          .text {
            font-size: 15px;
            line-height: 1.7;
            margin-bottom: 28px;
            color: ${SUBTLE};
          }

          .ticket-line {
            margin: 24px 0;
            background-color: ${BRAND_MINT};
            padding: 16px 20px;
            border-radius: 12px;
            border-left: 4px solid ${BRAND_GREEN};
          }

          .ticket-line p {
            margin: 0;
            font-size: 14px;
            color: ${SUBTLE};
            line-height: 1.6;
          }

          .button-container {
            margin: 32px 0;
            text-align: center;
          }

          .button {
            background-color: ${BRAND_GREEN};
            color: #FFFFFF !important;
            padding: 14px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            font-size: 15px;
            display: inline-block;
            box-shadow: 0 4px 14px rgba(12, 92, 72, 0.25);
          }

          .code-display {
            margin: 28px 0;
            text-align: center;
          }

          .code-digits {
            display: inline-flex;
            gap: 10px;
            background-color: ${BRAND_MINT};
            padding: 16px 24px;
            border-radius: 16px;
            border: 2px dashed ${BRAND_GREEN};
          }

          .code-digit {
            width: 48px;
            height: 56px;
            background-color: #FFFFFF;
            border-radius: 12px;
            border: 2px solid #CFE8DF;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 800;
            color: ${BRAND_GREEN};
            letter-spacing: 2px;
          }

          .expiry-text {
            font-size: 13px;
            color: ${MUTED};
            margin-top: 16px;
            font-style: italic;
            text-align: center;
          }

          /* Ticket stub — mirrors the in-app ticket card: dark green
             "boarding pass" header, perforated tear line, light counterfoil
             below listing each code. Only used by ticketConfirmationTemplate. */
          .stub {
            margin: 24px 0;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid #DCEEE7;
          }

          .stub-head {
            background: linear-gradient(135deg, ${BRAND_GREEN} 0%, ${BRAND_GREEN_DARK} 100%);
            color: #FFFFFF;
            padding: 20px 24px;
          }

          .stub-eyebrow {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #BFE3D6;
            margin: 0 0 6px;
          }

          .stub-title {
            font-size: 19px;
            font-weight: 700;
            margin: 0 0 10px;
            line-height: 1.3;
          }

          .stub-meta {
            font-size: 13px;
            color: #E4F3EE;
            margin: 2px 0;
          }

          .stub-tear {
            height: 0;
            border-top: 2px dashed #CFE8DF;
            position: relative;
          }

          .stub-body {
            background-color: ${BRAND_MINT};
            padding: 18px 24px;
          }

          .stub-body-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: ${BRAND_GREEN};
            margin: 0 0 10px;
          }

          .stub-code-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #FFFFFF;
            border: 1px solid #CFE8DF;
            border-radius: 10px;
            padding: 10px 14px;
            margin-bottom: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            color: ${INK};
            font-weight: 700;
            letter-spacing: 0.02em;
          }

          .stub-code-row span.label {
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-weight: 500;
            color: ${SUBTLE};
            letter-spacing: normal;
          }

          .divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #E7E5E4, transparent);
            margin: 32px 0;
          }

          .footer {
            padding: 0 40px 40px;
            text-align: left;
            color: ${MUTED};
            font-size: 12px;
          }

          .footer-links {
            margin-bottom: 16px;
          }

          .footer-link {
            color: #78716C;
            text-decoration: none;
            margin-right: 16px;
            font-weight: 500;
            font-size: 13px;
          }

          .footer-link:hover {
            color: ${BRAND_GREEN};
          }

          @media only screen and (max-width: 640px) {
            .wrapper {
              padding: 20px 0;
            }
            .container {
              border-radius: 16px;
              border-left: none;
              border-right: none;
            }
            .content, .header, .footer {
              padding-left: 24px;
              padding-right: 24px;
            }
            .title {
              font-size: 22px;
            }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="top-banner"></div>

            <div class="header">
              <div class="logo-row">
                <div class="logo-text">
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${BRAND_GREEN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 10px;">
                    <path d="M4 19 L9 4 L13 19 L17 6 L20 19" />
                  </svg>
                  Eventra
                </div>
                <span class="event-badge">✨ Live</span>
              </div>
            </div>

            <div class="content">
              <h1 class="title">${title}</h1>
              <p class="greeting">Hey ${name} 👋,</p>
              <div class="text">${content}</div>

              ${
                actionLink
                  ? `
                <div class="button-container">
                  <a href="${actionLink}" class="button">${actionText || "Let's Go"}</a>
                </div>
              `
                  : ''
              }

              ${
                code
                  ? `
                <div class="code-display">
                  <div class="code-digits">
                    ${code
                      .split('')
                      .map(d => `<div class="code-digit">${d}</div>`)
                      .join('')}
                  </div>
                </div>
              `
                  : ''
              }

              ${expiryText ? `<p class="expiry-text">⏱️ ${expiryText}</p>` : ''}

              <div class="divider"></div>

              <p style="font-size: 13px; color: ${MUTED}; line-height: 1.5; margin: 0;">
                Didn't expect this email? No worries — just ignore it and we'll leave you.
              </p>
            </div>

            <div class="footer">
              <div class="footer-links">
                <a href="#" class="footer-link">Help Center</a>
                <a href="#" class="footer-link">Privacy</a>
                <a href="#" class="footer-link">Terms</a>
                <a href="#" class="footer-link">Unsubscribe</a>
              </div>
              <p style="margin-bottom: 8px;">
                © ${new Date().getFullYear()} Eventra. All rights reserved.
              </p>
              <p style="color: ${MUTED}; font-size: 12px;">
                Making every event unforgettable. 🎪
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `

export const resetPasswordTemplate = (name: string, code: string) =>
  baseLayout(
    'Reset your Eventra password 🔑',
    name,
    `
      We got a request to reset the password on your account.
      Enter this code to choose a new one — if you didn't ask for this, you can safely ignore this email.
    `,
    undefined,
    undefined,
    "This code expires in 15 minutes — request a new one if it lapses.",
    code
  )

/**
 * For someone who checked out or RSVP'd as a guest (no account) and wants
 * to view/manage their ticket later. No name to greet them by here — a
 * guest's name lives on the ticket, not anywhere this template has access
 * to before the code is even verified — so this keeps the greeting generic.
 */
export const guestTicketAccessTemplate = (code: string) =>
  baseLayout(
    'Access your tickets 🎟️',
    'there',
    `
      Someone requested access to the Eventra ticket(s) linked to this email address.
      Enter this code to view and manage them — if this wasn't you, you can safely ignore this email.
    `,
    undefined,
    undefined,
    'This code expires in 15 minutes.',
    code
  )

/**
 * Redesigned as an actual ticket stub (dark green "boarding pass" header +
 * perforated tear + light counterfoil listing each code) rather than plain
 * text lines — matches the in-app ticket-card.tsx look. QR codes still
 * arrive as PNG attachments (one per ticket, see EmailService), not inlined
 * here — Brevo's transactional API doesn't give a verified way to embed
 * them as inline cid: images, so a wrongly-guessed approach risked
 * breaking the email silently. Each code is shown as text on the stub so
 * the attachment isn't the only way to identify a ticket.
 */
export const ticketConfirmationTemplate = (
  name: string,
  eventTitle: string,
  eventDateLabel: string,
  venueLabel: string,
  ticketCount: number,
  ticketCodes: string[] = []
) =>
  baseLayout(
    `You're going to ${eventTitle}! 🎉`,
    name,
    `
      Your ${ticketCount > 1 ? `${ticketCount} tickets are` : 'ticket is'} confirmed. Here's your ${ticketCount > 1 ? 'stub' : 'stub'} for the door:

      <div class="stub">
        <div class="stub-head">
          <p class="stub-eyebrow">${ticketCount > 1 ? `${ticketCount} Admissions` : 'General Admission'}</p>
          <p class="stub-title">${eventTitle}</p>
          <p class="stub-meta">${eventDateLabel}</p>
          <p class="stub-meta">${venueLabel}</p>
        </div>
        <div class="stub-tear"></div>
        <div class="stub-body">
          <p class="stub-body-label">${ticketCount > 1 ? 'Ticket codes' : 'Ticket code'}</p>
          ${ticketCodes
            .map(
              (code, i) =>
                `<div class="stub-code-row"><span class="label">${ticketCodes.length > 1 ? `Guest ${i + 1}` : 'Code'}</span>${code}</div>`
            )
            .join('')}
        </div>
      </div>

      Your QR ${ticketCount > 1 ? 'codes are' : 'code is'} attached to this email as ${ticketCount > 1 ? 'separate images' : 'an image'} —
      show ${ticketCount > 1 ? 'them' : 'it'} at the door for entry. You can also find ${ticketCount > 1 ? 'them' : 'it'} anytime under My Tickets.
    `
  )

export const organizerApprovedTemplate = (name: string) =>
  baseLayout(
    "You're approved to organize on Eventra! ✅",
    name,
    `
      Good news — your organizer account has been approved.
      You can now submit paid events for review and receive payouts once they sell tickets.
    `
  )

export const organizerRejectedTemplate = (name: string) =>
  baseLayout(
    'Update on your organizer application',
    name,
    `
      Your organizer account wasn't approved this time — this is usually due to
      incomplete or unverifiable bank details. Please double check your bank details
      in your organizer profile and reach out to support if you have questions.
    `
  )

export const eventApprovedTemplate = (name: string, eventTitle: string) =>
  baseLayout(
    `${eventTitle} is live! 🎉`,
    name,
    `
      Your event <strong style="color: ${INK};">${eventTitle}</strong> has been reviewed and approved.
      It's now visible to attendees and ready to sell tickets or take reservations.
    `
  )

export const eventRejectedTemplate = (name: string, eventTitle: string, reason: string) =>
  baseLayout(
    `${eventTitle} needs a change before it can go live`,
    name,
    `
      Your event <strong style="color: ${INK};">${eventTitle}</strong> wasn't approved this time.

      <div class="ticket-line">
        <strong style="color: ${INK};">Reason:</strong> ${reason}
      </div>

      You can edit the event and resubmit it for review once it's addressed.
    `
  )

export const refundProcessedTemplate = (name: string, eventTitle: string, amountLabel: string) =>
  baseLayout(
    'Your refund has been processed',
    name,
    `
      Your refund for <strong style="color: ${INK};">${eventTitle}</strong> has been processed.

      <div class="ticket-line">
        <strong style="color: ${INK};">Amount refunded:</strong> ${amountLabel}
      </div>

      It should reflect on your original payment method within a few business days, depending on your bank.
    `
  )

export const verifyAccountTemplate = (name: string, code: string, actionLink?: string) =>
  baseLayout(
    'Your Access to Eventra 🎟️',
    name,
    `
      Welcome to <strong>Eventra</strong> — your backstage pass to managing incredible events.
      You're one step away from going live.

      <div class="ticket-line">
        <strong style="color: ${INK};">Enter this code to verify your email</strong>
      </div>
    `,
    actionLink,
    'Verify & Join',
    "This code expires in 15 minutes — don't miss the show.",
    code
  )
