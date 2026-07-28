import { Router } from 'express'
import { createTicketType, listTicketTypesForOrganizer, updateTicketType } from '../controllers/ticketType.controller.js'
import { verifySession, requireRole } from '../middlewares/auth.middleware.js'
import { validateFormData } from '../middlewares/schema.middleware.js'
import { createTicketTypeSchema, updateTicketTypeSchema } from '../lib/schemaValidation.js'

// mergeParams so :eventId from the parent /events/:eventId mount is available here
const router = Router({ mergeParams: true })

router.use(verifySession, requireRole('organizer'))

router.post('/', validateFormData(createTicketTypeSchema), createTicketType)
router.get('/', listTicketTypesForOrganizer)
router.patch('/:ticketTypeId', validateFormData(updateTicketTypeSchema), updateTicketType)

export default router
