import { authHandlers } from './auth'
import { charactersHandlers } from './characters'
import { gameHandlers } from './game'

export const handlers = [
  ...authHandlers,
  ...charactersHandlers,
  ...gameHandlers,
]