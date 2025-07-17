import { authHandlers } from './auth'
import { charactersHandlers } from './characters'
import { gameHandlers } from './game'
import { configHandlers } from './config'

export const handlers = [
  ...authHandlers,
  ...charactersHandlers,
  ...gameHandlers,
  ...configHandlers,
]