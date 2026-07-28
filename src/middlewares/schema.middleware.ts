import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'
import { sendTsRestError } from '../lib/responseHandler.js'

/**
 * Validates req.body against the given Zod schema.
 * On success, req.body is replaced with the parsed (typed + defaulted) value.
 * On failure, responds 400 with `{ success: false, message: 'Validation failed', details: [...] }`.
 */
export const validateFormData = (schema: ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      const details = result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
      sendTsRestError(res, 400, 'Validation failed', details)
      return
    }

    req.body = result.data
    next()
  }
}
