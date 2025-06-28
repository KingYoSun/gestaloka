import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { CompletedLogRead } from '@/api/logs'
import { dispatchApi, DispatchObjectiveType } from '@/api/dispatch'
import { useCharacterStore } from '@/stores/characterStore'
import { Coins, MapPin, Calendar, Target } from 'lucide-react'

const dispatchFormSchema = z.object({
  objective_type: z.enum(['EXPLORE', 'INTERACT', 'COLLECT', 'GUARD', 'FREE'] as const, {
    required_error: '派遣目的を選択してください',
  }),
  objective_detail: z
    .string()
    .min(10, '目的の詳細は10文字以上で入力してください')
    .max(500, '目的の詳細は500文字以内で入力してください'),
  initial_location: z
    .string()
    .min(1, '初期地点を入力してください')
    .max(100, '初期地点は100文字以内で入力してください'),
  dispatch_duration_days: z.number().min(1).max(30),
})

type DispatchFormValues = z.infer<typeof dispatchFormSchema>

interface DispatchFormProps {
  completedLog: CompletedLogRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

const objectiveTypeOptions = [
  {
    value: 'EXPLORE',
    label: '探索型',
    description: '新しい場所や情報を発見する',
  },
  {
    value: 'INTERACT',
    label: '交流型',
    description: '他のキャラクターとの出会いを求める',
  },
  {
    value: 'COLLECT',
    label: '収集型',
    description: '特定のアイテムや情報を収集する',
  },
  {
    value: 'GUARD',
    label: '護衛型',
    description: '特定の場所や人物を守る',
  },
  {
    value: 'FREE',
    label: '自由型',
    description: 'ログの性格に任せて行動する',
  },
] as const

export function DispatchForm({
  completedLog,
  open,
  onOpenChange,
}: DispatchFormProps) {
  const activeCharacter = useCharacterStore(state => state.getActiveCharacter())
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [spCost, setSpCost] = useState(15)

  const form = useForm<DispatchFormValues>({
    resolver: zodResolver(dispatchFormSchema),
    defaultValues: {
      objective_type: 'EXPLORE' as const,
      objective_detail: '',
      initial_location: activeCharacter?.location || 'Starting Village',
      dispatch_duration_days: 1,
    },
  })

  const createDispatchMutation = useMutation({
    mutationFn: (data: DispatchFormValues) =>
      dispatchApi.createDispatch({
        ...data,
        objective_type: data.objective_type as keyof DispatchObjectiveType,
        completed_log_id: completedLog.id,
        dispatcher_id: activeCharacter!.id,
      }),
    onSuccess: () => {
      toast({
        title: '派遣開始',
        description: `${completedLog.name}を派遣しました`,
      })
      queryClient.invalidateQueries({ queryKey: ['dispatches'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      onOpenChange(false)
      form.reset()
    },
    onError: (error: any) => {
      toast({
        title: '派遣失敗',
        description: error.response?.data?.detail || 'エラーが発生しました',
        variant: 'destructive',
      })
    },
  })

  const watchDuration = form.watch('dispatch_duration_days')

  // SP消費量の計算
  const calculateSpCost = (days: number) => {
    const cost = 10 + days * 5
    return Math.min(cost, 300)
  }

  // 期間が変更されたらSP消費量を更新
  form.register('dispatch_duration_days', {
    onChange: (e) => {
      setSpCost(calculateSpCost(e.target.value))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>ログを派遣する</DialogTitle>
          <DialogDescription>
            {completedLog.name}を他のプレイヤーの世界に派遣します
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              createDispatchMutation.mutate(data)
            )}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="objective_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>派遣目的</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="派遣目的を選択" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {objectiveTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div>
                            <div className="font-medium">{option.label}</div>
                            <div className="text-sm text-muted-foreground">
                              {option.description}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="objective_detail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>目的の詳細</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="具体的にどのような活動をさせたいか記述してください"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    NPCとしての行動指針になります（10-500文字）
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="initial_location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>初期地点</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="派遣先の地点"
                        className="pl-10"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dispatch_duration_days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>派遣期間</FormLabel>
                  <FormControl>
                    <div className="space-y-3">
                      <Slider
                        min={1}
                        max={30}
                        step={1}
                        value={[field.value]}
                        onValueChange={(value: number[]) => field.onChange(value[0])}
                      />
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>{watchDuration}日間</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Coins className="h-4 w-4" />
                          <span className="font-medium">{spCost} SP</span>
                        </div>
                      </div>
                    </div>
                  </FormControl>
                  <FormDescription>
                    長期派遣ほど多くの成果が期待できます
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                <span className="font-medium">派遣概要</span>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>ログ名: {completedLog.name}</p>
                <p>称号: {completedLog.title || 'なし'}</p>
                <p>汚染度: {(completedLog.contaminationLevel * 100).toFixed(0)}%</p>
                <p>消費SP: {spCost}</p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                キャンセル
              </Button>
              <Button
                type="submit"
                disabled={createDispatchMutation.isPending}
              >
                {createDispatchMutation.isPending
                  ? '派遣中...'
                  : `派遣する (${spCost} SP)`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}