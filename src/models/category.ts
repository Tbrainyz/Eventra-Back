import mongoose, { Document, Schema } from 'mongoose'

export interface ICategory extends Document {
  _id: mongoose.Types.ObjectId
  name: string
  slug: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const CategorySchema = new Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Categories are deactivated rather than deleted, so existing events
    // that reference a retired category don't break.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)



CategorySchema.index({ isActive: 1 })

const Category = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema, 'categories')

export default Category
