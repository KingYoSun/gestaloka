import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // toLocaleStringを使用して時刻も含めて表示
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo'
  })
}

export function formatRelativeTime(date: string | Date): string {
  let d: Date
  
  if (typeof date === 'string') {
    // サーバーがUTC時刻を返すが、'Z'がついていない場合の対処
    // '2025-07-06T15:00:00' のような形式の場合、UTCとして扱う
    // タイムゾーン指定（+09:00など）がない場合のみ、Zを追加
    const hasTimezone = date.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(date)
    if (!hasTimezone) {
      d = new Date(date + 'Z')
    } else {
      d = new Date(date)
    }
  } else {
    d = date
  }
  
  return formatDistanceToNow(d, { addSuffix: true, locale: ja })
}

export function formatNumber(num: number): string {
  return num.toLocaleString('ja-JP')
}
