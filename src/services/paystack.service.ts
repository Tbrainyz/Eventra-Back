import axios, { AxiosInstance } from 'axios'
import { env } from '../config/keys.js'
import logger from '../config/logger.js'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

export interface InitializeTransactionParams {
  email: string
  amountKobo: number
  reference: string
  callbackUrl?: string
  metadata?: Record<string, unknown>
}

export interface InitializeTransactionResult {
  authorizationUrl: string
  accessCode: string
  reference: string
}

export interface VerifyTransactionResult {
  status: 'success' | 'failed' | 'abandoned' | string
  reference: string
  amountKobo: number
  currency: string
  paidAt: string | null
  metadata: Record<string, unknown> | null
}

export interface CreateTransferRecipientParams {
  name: string
  accountNumber: string
  bankCode: string
}

export interface InitiateTransferParams {
  amountKobo: number
  recipientCode: string
  reason?: string
  reference?: string
}

/**
 * Thin wrapper around the Paystack API. Amounts in/out of this service are
 * always in kobo — convert Naira → kobo (x100) at the call site.
 */
export class PaystackService {
  private static client: AxiosInstance

  private static getClient(): AxiosInstance {
    if (!this.client) {
      this.client = axios.create({
        baseURL: PAYSTACK_BASE_URL,
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      })
    }
    return this.client
  }

  static async initializeTransaction(params: InitializeTransactionParams): Promise<InitializeTransactionResult> {
    try {
      const { data } = await this.getClient().post('/transaction/initialize', {
        email: params.email,
        amount: params.amountKobo,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      })

      return {
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
      }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to initialize transaction'
      logger.error({ err: error.response?.data }, `Paystack initialize failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * Verify a transaction with Paystack directly (source of truth) — never trust
   * the client's redirect params or a webhook payload alone for whether payment succeeded.
   */
  static async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    try {
      const { data } = await this.getClient().get(`/transaction/verify/${encodeURIComponent(reference)}`)

      return {
        status: data.data.status,
        reference: data.data.reference,
        amountKobo: data.data.amount,
        currency: data.data.currency,
        paidAt: data.data.paid_at ?? null,
        metadata: data.data.metadata ?? null,
      }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to verify transaction'
      logger.error({ err: error.response?.data }, `Paystack verify failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * Register an organizer's bank account as a Paystack transfer recipient.
   * The recipient code returned here should be stored on organizerProfile.
   */
  static async createTransferRecipient(params: CreateTransferRecipientParams): Promise<{ recipientCode: string }> {
    try {
      const { data } = await this.getClient().post('/transferrecipient', {
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'NGN',
      })

      return { recipientCode: data.data.recipient_code }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to create transfer recipient'
      logger.error({ err: error.response?.data }, `Paystack recipient creation failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * Initiate an organizer payout. Used a few days after the event, per the PRD.
   */
  static async initiateTransfer(
    params: InitiateTransferParams
  ): Promise<{ transferCode: string; status: string; reference: string }> {
    try {
      const { data } = await this.getClient().post('/transfer', {
        source: 'balance',
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reason: params.reason,
        reference: params.reference,
      })

      return {
        transferCode: data.data.transfer_code,
        status: data.data.status,
        reference: data.data.reference,
      }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to initiate transfer'
      logger.error({ err: error.response?.data }, `Paystack transfer failed: ${message}`)
      throw new Error(message)
    }
  }
  /**
   * Refund a transaction, fully or partially. Used for individual ticket
   * refund requests and for auto-refunding all tickets on event cancellation.
   */
  static async refundTransaction(params: {
    transactionReference: string
    amountKobo?: number
    reason?: string
  }): Promise<{ status: string; reference: string }> {
    try {
      const { data } = await this.getClient().post('/refund', {
        transaction: params.transactionReference,
        amount: params.amountKobo,
        customer_note: params.reason,
      })

      return { status: data.data.status ?? 'pending', reference: data.data.transaction_reference ?? params.transactionReference }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to process refund'
      logger.error({ err: error.response?.data }, `Paystack refund failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * Confirms who actually owns a bank account before we save it — this is
   * the "we use Paystack to confirm your account name" step in the bank
   * onboarding screen. Never trust a client-typed account name.
   */
  static async resolveAccount(params: { accountNumber: string; bankCode: string }): Promise<{ accountName: string }> {
    try {
      const { data } = await this.getClient().get('/bank/resolve', {
        params: { account_number: params.accountNumber, bank_code: params.bankCode },
      })

      return { accountName: data.data.account_name }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Could not verify this account number'
      logger.error({ err: error.response?.data }, `Paystack account resolve failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * Nigerian banks for the onboarding "Select bank" dropdown, each with the
   * bank_code resolveAccount/createTransferRecipient need. Paystack's own
   * list barely changes, so callers should cache this (see
   * organizer.controller.ts) rather than hitting Paystack on every page load.
   */
  static async listBanks(): Promise<{ name: string; code: string }[]> {
    try {
      const { data } = await this.getClient().get('/bank', { params: { country: 'nigeria', currency: 'NGN' } })

      return data.data.map((bank: { name: string; code: string }) => ({ name: bank.name, code: bank.code }))
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to load bank list'
      logger.error({ err: error.response?.data }, `Paystack bank list failed: ${message}`)
      throw new Error(message)
    }
  }
  /**
   * "Challenge" a dispute — submit evidence that the customer got what
   * they paid for, then mark the dispute declined so it goes to Paystack's
   * review process instead of an automatic refund. Two Paystack calls
   * under the hood (Add Evidence, then Resolve with resolution:
   * 'declined') since Paystack requires evidence to exist before you can
   * decline. No receipt upload here — `serviceDetails` is a text
   * description of what was delivered (the event took place, ticket was
   * issued, etc.), which is enough for Paystack's Add Evidence endpoint;
   * a receipt/attachment upload is a separate, optional step Paystack's
   * flow supports but doesn't require.
   */
  static async challengeDispute(
    disputeId: string,
    evidence: { customerEmail: string; customerName: string; serviceDetails: string }
  ): Promise<{ status: string }> {
    try {
      await this.getClient().post(`/dispute/${disputeId}/evidence`, {
        customer_email: evidence.customerEmail,
        customer_name: evidence.customerName,
        customer_phone: '',
        service_details: evidence.serviceDetails,
      })

      const { data } = await this.getClient().put(`/dispute/${disputeId}/resolve`, {
        resolution: 'declined',
        message: evidence.serviceDetails,
        uploaded_filename: '',
      })

      return { status: data.data.status }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to challenge dispute'
      logger.error({ err: error.response?.data }, `Paystack dispute challenge failed: ${message}`)
      throw new Error(message)
    }
  }

  /**
   * "Accept loss" — concede the dispute. Paystack refunds the customer
   * from the merchant balance once this resolves; `refund_amount` omitted
   * means a full refund of the disputed amount.
   */
  static async acceptDisputeLoss(disputeId: string): Promise<{ status: string }> {
    try {
      const { data } = await this.getClient().put(`/dispute/${disputeId}/resolve`, {
        resolution: 'merchant-accepted',
        message: 'Accepted by Eventra admin',
        uploaded_filename: '',
      })

      return { status: data.data.status }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to resolve dispute'
      logger.error({ err: error.response?.data }, `Paystack dispute accept-loss failed: ${message}`)
      throw new Error(message)
    }
  }
}

export const paystackService = new PaystackService()
