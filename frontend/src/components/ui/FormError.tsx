import { Alert, AlertDescription } from '@/components/ui/alert'

interface FormErrorProps {
  error?: string | null
  className?: string
}

export const FormError = ({ error, className = '' }: FormErrorProps) => {
  if (!error) return null

  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}
