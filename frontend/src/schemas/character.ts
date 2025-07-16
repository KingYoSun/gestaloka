/**
 * キャラクター関連のZodスキーマ
 */
import { z } from 'zod'

/**
 * キャラクター作成スキーマを作成するファクトリー関数
 */
export function createCharacterCreationSchema(validationRules: {
  character: {
    name: {
      min_length: number
      max_length: number
    }
    description: {
      max_length: number
    }
    appearance: {
      max_length: number
    }
    personality: {
      max_length: number
    }
  }
}) {
  const rules = validationRules.character

  return z.object({
    name: z
      .string()
      .min(
        rules.name.min_length,
        `キャラクター名は${rules.name.min_length}文字以上である必要があります`
      )
      .max(
        rules.name.max_length,
        `キャラクター名は${rules.name.max_length}文字以内で入力してください`
      ),
    description: z
      .string()
      .max(
        rules.description.max_length,
        `説明は${rules.description.max_length}文字以内で入力してください`
      )
      .optional(),
    appearance: z
      .string()
      .max(
        rules.appearance.max_length,
        `外見は${rules.appearance.max_length}文字以内で入力してください`
      )
      .optional(),
    personality: z
      .string()
      .max(
        rules.personality.max_length,
        `性格は${rules.personality.max_length}文字以内で入力してください`
      )
      .optional(),
  })
}

export type CharacterCreationFormData = z.infer<
  ReturnType<typeof createCharacterCreationSchema>
>
