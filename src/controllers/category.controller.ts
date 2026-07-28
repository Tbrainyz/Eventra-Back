import { Request, Response } from 'express'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { slugify } from '../lib/utils.js'
import Category from '../models/category.js'

export const listPublicCategories = tryCatchWrapper(async (req: Request, res: Response) => {
  const categories = await Category.find({ isActive: true }).sort({ name: 1 }).lean()
  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Categories fetched',
    body: categories,
  })
})

export const listAllCategories = tryCatchWrapper(async (req: Request, res: Response) => {
  const categories = await Category.find().sort({ name: 1 }).lean()
  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Categories fetched',
    body: categories,
  })
})

export const createCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { name } = req.body

  const slug = slugify(name)
  const existing = await Category.findOne({ $or: [{ name }, { slug }] }).lean()
  if (existing) {
    return sendTsRestError(res, 409, 'A category with this name already exists')
  }

  const category = await Category.create({ name, slug })

  return sendTsRestSuccess(res, 201, {
    success: true,
    message: 'Category created',
    body: category.toObject(),
  })
})

export const updateCategory = tryCatchWrapper(async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, isActive } = req.body

  const category = await Category.findById(id)
  if (!category) {
    return sendTsRestError(res, 404, 'Category not found')
  }

  if (name) {
    category.name = name
    category.slug = slugify(name)
  }
  if (typeof isActive === 'boolean') {
    category.isActive = isActive
  }

  await category.save()

  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Category updated',
    body: category.toObject(),
  })
})
