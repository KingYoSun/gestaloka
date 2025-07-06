/**
 * Component to display the currently equipped title
 */
import { Badge } from '@/components/ui/badge'
import { Crown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getEquippedTitle } from '@/api/titles'
import { Link } from '@tanstack/react-router'

export const EquippedTitleBadge = () => {
  const { data: equippedTitle } = useQuery({
    queryKey: ['titles', 'equipped'],
    queryFn: getEquippedTitle,
  })

  if (!equippedTitle) {
    return null
  }

  return (
    <Link to="/titles">
      <Badge
        variant="secondary"
        className="flex items-center gap-1.5 cursor-pointer hover:bg-secondary/80 transition-colors"
      >
        <Crown className="h-3 w-3" />
        <span className="font-medium">{equippedTitle.title}</span>
      </Badge>
    </Link>
  )
}
