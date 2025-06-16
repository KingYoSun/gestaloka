/**
 * キャラクター関連のZodスキーマ
 */
import { z } from 'zod'

export const characterCreationSchema = z.object({
  name: z
    .string()
    .min(1, 'キャラクター名は必須です')
    .max(50, 'キャラクター名は50文字以内で入力してください'),
  description: z
    .string()
    .max(1000, '説明は1000文字以内で入力してください')
    .optional(),
  appearance: z
    .string()
    .max(1000, '外見は1000文字以内で入力してください')
    .optional(),
  personality: z
    .string()
    .max(1000, '性格は1000文字以内で入力してください')
    .optional(),
})

export type CharacterCreationFormData = z.infer<typeof characterCreationSchema>