import { createLazyFileRoute } from '@tanstack/react-router'
import { SPPurchaseCancel } from './cancel'

export const Route = createLazyFileRoute('/sp/cancel')({
  component: SPPurchaseCancel,
})