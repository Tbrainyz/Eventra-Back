# Designer Meeting Prep — Gaps & Missing Pages

Everything here is something I actually ran into while building, not a
guess — each one either slowed us down, forced me to make an unconfirmed
assumption, or is currently blocking backend work from having anything real
to connect to.

---

## Part 1 — Design inconsistencies worth raising

### 1. No exact colors, ever — I've been guessing from screenshots
I initially built the brand color as purple, based on a low-resolution
full-page screenshot. It was wrong — the real color is green, and I only
caught it when you sent closer crops of the navbar/footer. Same thing
happened with the footer background (I invented an entire dark-green
section that doesn't exist in the actual design). **Ask for:** exact hex
codes for the core palette (primary green, the mint/light background, the
dark footer green, the amber/gold accent), not just visual screenshots.
This should be a five-minute export from Figma, and it would have saved
real back-and-forth.

### 2. The register page fields don't match across three different sources
There's a real, unresolved conflict between three things:
- The Figma register screen: Full Name, Email, Password, Confirm Password — no company name, no role picker.
- A separate "Auth Controller" doc from the instructor: wants `companyName` and forces every account to be an organizer — no attendee path at all.
- The actual multi-role PRD: attendees and organizers are explicitly separate roles with separate capabilities.

This has been sitting unresolved. **Ask:** which one is actually correct? The
Figma design (matching the PRD) is what the backend was built against, but
this needs to be said out loud and confirmed, not just assumed.

### 3. Organizer "followers" — is this a real feature, or decoration?
The Event Details page's Organizer card shows a follower count and a
verified checkmark. There is currently **zero concept of "following" an
organizer anywhere in the backend** — no data model, no follow/unfollow
endpoint. It wasn't in the original PRD either. Before any backend work
gets spent on this: is this meant to be real, or should that card just show
"verified organizer" without a fake follower number?

### 4. The Checkout page implies you can pick a payment method before paying
The design shows Card / Bank Transfer / USSD / Bank / QR Card as separate
selectable options on the Checkout page itself. In practice, the actual
payment provider (Paystack) works by redirecting to *its own* hosted page,
where the method gets chosen — the app itself doesn't control that
selection. Worth clarifying whether those five options are meant to be
functional (which may not even be possible with a redirect-based
integration) or just informational/decorative.

### 5. Logged-in state is inconsistent across screens that should be the same session
Some screens (Ticket Confirmation) show a logged-out navbar ("Log in" / "Get
started"), while others in the same flow (Checkout, About, Contact) show a
logged-in one ("Ada Okafor ▾"). If these are meant to represent one
continuous user session, they should agree.

---

## Part 2 — Pages that don't exist yet, and why each one matters for backend

These are ranked by how much they're actually blocking, not just by "nice
to have."

### 🔴 Critical — blocks everything else from ever showing real data

**Organizer Dashboard** (create event, manage ticket types, view sales, check-in scanner)
Right now there's a marketing page for organizers and a small dashboard
*preview mockup* used as decoration on Home/About — but no actual usable
dashboard has been designed. This is the single biggest blocker: without a
real "create event" flow, **no organizer can ever get a real event into the
system**, which means Home and Explore are permanently stuck showing
placeholder data no matter how good the backend is. This should be the
designer's next priority, full stop.

**Admin Dashboard** (approve organizers, approve events, handle refunds)
Doesn't exist at all — not even a marketing mockup. Without this, even if
an organizer creates a real event, **it can never be approved**, so it
still never reaches the public site. This and the Organizer Dashboard are
the two pages standing between "the backend works" and "the app has any
real content in it."

### 🟡 Blocking a complete user journey, but not the whole app

**Login page** — only Register has ever been designed. There's no
corresponding Login screen.

**Email/OTP verification screen** — the backend requires a 6-digit code
after registration before an account is usable. There is currently no
screen for entering that code anywhere in the designs.

**Forgot password / reset password screens** — the backend supports this
flow fully; no UI exists for it.

Put together: as designed today, **a new user cannot actually complete
signing up and logging in** through any screen that exists — not because
the backend is missing anything, but because the frontend has nowhere to
send them for OTP entry or login.

### 🟢 Lower priority, but worth naming so nothing's forgotten

- Check-in/QR scanner screen (for organizers at the door — currently only described narratively in the "How it works" section, no actual screen)
- User profile/settings page (separate from viewing a ticket)
- "Promote my event" flow for organizers
- A refund-request confirmation state (what does it look like right after tapping "Request refund"?)

---

## How I'd frame this in the meeting, if it helps

The honest framing isn't "the designs are bad" — the pages that exist are
detailed and mostly buildable as-is. It's specifically: **the highest-value
next work isn't another polish pass on Home or Explore — it's the two
screens (Organizer Dashboard, Admin Dashboard) that let real data exist in
the first place.** Every hour spent refining an already-designed page right
now is an hour not spent unblocking the whole rest of the product.

