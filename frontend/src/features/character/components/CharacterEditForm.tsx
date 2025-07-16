import { zodResolver } from '@hookform/resolvers/zod'
import { type FC } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { Character } from '@/api/generated'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const characterEditSchema = z.object({
  name: z
    .string()
    .min(1, '名前は必須です')
    .max(50, '名前は50文字以内で入力してください'),
  description: z
    .string()
    .min(1, '説明は必須です')
    .max(1000, '説明は1000文字以内で入力してください'),
  appearance: z
    .string()
    .min(1, '外見は必須です')
    .max(1000, '外見は1000文字以内で入力してください'),
  personality: z
    .string()
    .min(1, '性格は必須です')
    .max(1000, '性格は1000文字以内で入力してください'),
})

type CharacterEditFormData = z.infer<typeof characterEditSchema>

interface CharacterEditFormProps {
  character: Character
  onSubmit: (data: CharacterEditFormData) => void
  onCancel: () => void
  isLoading?: boolean
}

export const CharacterEditForm: FC<CharacterEditFormProps> = ({
  character,
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const form = useForm<CharacterEditFormData>({
    resolver: zodResolver(characterEditSchema),
    defaultValues: {
      name: character.name,
      description: character.description,
      appearance: character.appearance,
      personality: character.personality,
    },
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>名前</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>説明</FormLabel>
              <FormControl>
                <Textarea {...field} rows={4} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="appearance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>外見</FormLabel>
              <FormControl>
                <Textarea {...field} rows={4} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="personality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>性格</FormLabel>
              <FormControl>
                <Textarea {...field} rows={4} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            キャンセル
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? '更新中...' : '更新'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
