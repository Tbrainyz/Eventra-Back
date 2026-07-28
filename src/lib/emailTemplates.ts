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
        <title>${title} - EventPulse</title>
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

          /* Decorative top banner */
          .top-banner {
            height: 8px;
            background: linear-gradient(90deg, #7C3AED 0%, #C084FC 50%, #F59E0B 100%);
          }

          /* Confetti decoration */
          .confetti-dots {
            display: flex;
            gap: 6px;
            margin-top: 8px;
          }

          .confetti-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
          }

          .confetti-dot.purple { background-color: #7C3AED; }
          .confetti-dot.amber { background-color: #F59E0B; }
          .confetti-dot.pink { background-color: #EC4899; }
          .confetti-dot.teal { background-color: #14B8A6; }

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
            color: #1C1917;
            letter-spacing: -0.02em;
            display: flex;
            align-items: center;
          }

          .event-badge {
            font-size: 11px;
            font-weight: 600;
            color: #7C3AED;
            background-color: #F5F3FF;
            padding: 4px 10px;
            border-radius: 20px;
            letter-spacing: 0.03em;
            text-transform: uppercase;
          }

          .content {
            padding: 32px 40px;
            color: #44403C;
          }

          .title {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 20px;
            color: #1C1917;
            letter-spacing: -0.02em;
            line-height: 1.2;
          }

          .greeting {
            font-size: 15px;
            font-weight: 600;
            color: #7C3AED;
            margin-bottom: 12px;
          }

          .text {
            font-size: 15px;
            line-height: 1.7;
            margin-bottom: 28px;
            color: #57534E;
          }

          .ticket-line {
            border-left: 3px solid #7C3AED;
            padding-left: 16px;
            margin: 24px 0;
            background-color: #FAF5FF;
            padding: 16px 20px;
            border-radius: 12px;
            border-left: 4px solid #7C3AED;
          }

          .ticket-line p {
            margin: 0;
            font-size: 14px;
            color: #57534E;
            line-height: 1.6;
          }

          .button-container {
            margin: 32px 0;
            text-align: center;
          }

          .button {
            background: linear-gradient(135deg, #7C3AED 0%, #C084FC 100%);
            color: #FFFFFF !important;
            padding: 14px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            font-size: 15px;
            display: inline-block;
            box-shadow: 0 4px 14px rgba(124, 58, 237, 0.25);
            transition: all 0.2s;
          }

          .code-display {
            margin: 28px 0;
            text-align: center;
          }

          .code-digits {
            display: inline-flex;
            gap: 10px;
            background-color: #FAF5FF;
            padding: 16px 24px;
            border-radius: 16px;
            border: 2px dashed #C084FC;
          }

          .code-digit {
            width: 48px;
            height: 56px;
            background-color: #FFFFFF;
            border-radius: 12px;
            border: 2px solid #E9D5FF;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 800;
            color: #7C3AED;
            letter-spacing: 2px;
          }

          .expiry-text {
            font-size: 13px;
            color: #A8A29E;
            margin-top: 16px;
            font-style: italic;
            text-align: center;
          }

          .divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, #E7E5E4, transparent);
            margin: 32px 0;
          }

          .footer {
            padding: 0 40px 40px;
            text-align: left;
            color: #A8A29E;
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
            color: #7C3AED;
          }

          .social-row {
            margin: 20px 0 16px;
          }

          .social-icon {
            display: inline-block;
            margin-right: 12px;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background-color: #F5F0EB;
            text-align: center;
            line-height: 32px;
            color: #78716C;
            text-decoration: none;
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
            <!-- Gradient top banner -->
            <div class="top-banner"></div>

            <div class="header">
              <div class="logo-row">
                <div class="logo-text">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 10px;">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                    <circle cx="12" cy="15" r="1"></circle>
                    <circle cx="16" cy="15" r="1"></circle>
                    <circle cx="8" cy="15" r="1"></circle>
                  </svg>
                  EventPulse
                </div>
                <span class="event-badge">:sparkles: Live</span>
              </div>
              <div class="confetti-dots">
                <span class="confetti-dot purple"></span>
                <span class="confetti-dot amber"></span>
                <span class="confetti-dot pink"></span>
                <span class="confetti-dot teal"></span>
              </div>
            </div>

            <div class="content">
              <h1 class="title">${title}</h1>
              <p class="greeting">Hey ${name} :wave:,</p>
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

              ${expiryText ? `<p class="expiry-text">:stopwatch: ${expiryText}</p>` : ''}

              <div class="divider"></div>

              <p style="font-size: 13px; color: #A8A29E; line-height: 1.5; margin: 0;">
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
                © ${new Date().getFullYear()} EventPulse. All rights reserved.
              </p>
              <p style="color: #A8A29E; font-size: 12px;">
                Making every event unforgettable. :circus_tent:
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `

export const resetPasswordTemplate = (name: string, code: string) =>
  baseLayout(
    'Reset your EventPulse password :key:',
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

export const ticketConfirmationTemplate = (
  name: string,
  eventTitle: string,
  eventDateLabel: string,
  venueLabel: string,
  ticketCount: number
) =>
  baseLayout(
    `You're going to ${eventTitle}! :tada:`,
    name,
    `
      Your ${ticketCount > 1 ? `${ticketCount} tickets are` : 'ticket is'} confirmed.

      <div class="ticket-line">
        <p><strong style="color: #1C1917;">${eventTitle}</strong></p>
        <p>${eventDateLabel}</p>
        <p>${venueLabel}</p>
      </div>

      ${ticketCount > 1 ? 'Your QR codes are attached to this email' : 'Your QR code is attached to this email'} —
      show it at the door for entry. You can also find it anytime under My Tickets.
    `
  )

export const organizerApprovedTemplate = (name: string) =>
  baseLayout(
    "You're approved to organize on EventPulse! :white_check_mark:",
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
    `${eventTitle} is live! :tada:`,
    name,
    `
      Your event <strong style="color: #1C1917;">${eventTitle}</strong> has been reviewed and approved.
      It's now visible to attendees and ready to sell tickets or take reservations.
    `
  )

export const eventRejectedTemplate = (name: string, eventTitle: string, reason: string) =>
  baseLayout(
    `${eventTitle} needs a change before it can go live`,
    name,
    `
      Your event <strong style="color: #1C1917;">${eventTitle}</strong> wasn't approved this time.

      <div class="ticket-line">
        <strong style="color: #1C1917;">Reason:</strong> ${reason}
      </div>

      You can edit the event and resubmit it for review once it's addressed.
    `
  )

export const refundProcessedTemplate = (name: string, eventTitle: string, amountLabel: string) =>
  baseLayout(
    'Your refund has been processed',
    name,
    `
      Your refund for <strong style="color: #1C1917;">${eventTitle}</strong> has been processed.

      <div class="ticket-line">
        <strong style="color: #1C1917;">Amount refunded:</strong> ${amountLabel}
      </div>

      It should reflect on your original payment method within a few business days, depending on your bank.
    `
  )

export const verifyAccountTemplate = (name: string, code: string, actionLink?: string) =>
  baseLayout(
    'Your Access to EventPulse :admission_tickets:',
    name,
    `
      Welcome to <strong>EventPulse</strong> — your backstage pass to managing incredible events.
      You're one step away from going live.

      <div class="ticket-line">
        <strong style="color: #1C1917;">Enter this code to verify your email</strong>
      </div>
    `,
    actionLink,
    'Verify & Join',
    "This code expires in 15 minutes — don't miss the show.",
    code
  )