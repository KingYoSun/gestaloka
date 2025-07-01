import { createLazyFileRoute } from '@tanstack/react-router'
import { SPPurchaseSuccess } from './success'

export const Route = createLazyFileRoute('/sp/success')({
  component: SPPurchaseSuccess,
})
