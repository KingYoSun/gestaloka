import { Badge } from '@/components/ui/badge'
import { Award } from 'lucide-react'

interface EquippedTitleBadgeProps {
  title?: string
  className?: string
}

export function EquippedTitleBadge({ title, className }: EquippedTitleBadgeProps) {
  if (!title) {
    return null
  }

  return (
    <Badge variant="secondary" className={className}>
      <Award className="h-3 w-3 mr-1" />
      {title}
    </Badge>
  )
}