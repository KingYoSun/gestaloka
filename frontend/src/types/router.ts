import { AuthContextType } from '@/features/auth/authContext'

export interface RouterContext {
  auth: AuthContextType
}

declare module '@tanstack/react-router' {
  interface RouterContext {
    auth: AuthContextType
  }
}
