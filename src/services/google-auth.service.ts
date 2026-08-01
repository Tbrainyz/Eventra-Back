import axios from 'axios'
import { env } from '../config/keys.js'
import logger from '../config/logger.js'

interface GoogleProfile {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture?: string
}

export class GoogleAuthService {
  /**
   * Verifies a Google OAuth access token (from the client's implicit-flow
   * login, see useGoogleLogin on the frontend) and returns the associated
   * profile. Two calls, not one, and both matter:
   *
   * 1. tokeninfo — confirms this access token was actually issued to *our*
   *    app (checks `aud`/`azp` against GOOGLE_CLIENT_ID). Skipping this
   *    step would mean any valid Google access token from ANY app could be
   *    replayed against our backend to authenticate as its owner — the
   *    token being real and valid isn't the same as it being ours.
   * 2. userinfo — the actual profile data, fetched only once step 1 passes.
   */
  static async verifyAccessToken(accessToken: string): Promise<GoogleProfile> {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new Error('Google sign-in is not configured on this server')
    }

    const { data: tokenInfo } = await axios
      .get('https://oauth2.googleapis.com/tokeninfo', { params: { access_token: accessToken } })
      .catch(() => {
        throw new Error('Invalid or expired Google token')
      })

    const issuedForUs = tokenInfo.aud === env.GOOGLE_CLIENT_ID || tokenInfo.azp === env.GOOGLE_CLIENT_ID
    if (!issuedForUs) {
      logger.warn({ aud: tokenInfo.aud, azp: tokenInfo.azp }, 'Google token audience mismatch — possible token replay')
      throw new Error('Invalid Google token')
    }

    const { data: profile } = await axios
      .get('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
      .catch(() => {
        throw new Error('Could not fetch Google profile')
      })

    if (!profile.email) {
      throw new Error('Google account has no email on file')
    }

    return {
      sub: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === true || profile.email_verified === 'true',
      name: profile.name || profile.email.split('@')[0],
      picture: profile.picture,
    }
  }
}
