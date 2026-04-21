import { authHandlers } from './auth'
import { charactersHandlers } from './characters'
import { gameHandlers } from './game'
import { configHandlers } from './config'
import { adminHandlers } from './admin'
import { titlesHandlers } from './titles'
import { spHandlers } from './sp'

export const handlers = [
  ...authHandlers,
  ...charactersHandlers,
  ...gameHandlers,
  ...configHandlers,
  ...adminHandlers,
  ...titlesHandlers,
  ...spHandlers,
]