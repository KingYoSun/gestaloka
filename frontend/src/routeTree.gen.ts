/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

import { Route as rootRouteImport } from './routes/__root'
import { Route as RegisterRouteImport } from './routes/register'
import { Route as LoginRouteImport } from './routes/login'
import { Route as AuthenticatedRouteImport } from './routes/_authenticated'
import { Route as AdminRouteImport } from './routes/_admin'
import { Route as IndexRouteImport } from './routes/index'
import { Route as AuthenticatedTitlesRouteImport } from './routes/_authenticated/titles'
import { Route as AuthenticatedSettingsRouteImport } from './routes/_authenticated/settings'
import { Route as AuthenticatedQuestsRouteImport } from './routes/_authenticated/quests'
import { Route as AuthenticatedLogsRouteImport } from './routes/_authenticated/logs'
import { Route as AuthenticatedDashboardRouteImport } from './routes/_authenticated/dashboard'
import { Route as AuthenticatedCharactersRouteImport } from './routes/_authenticated/characters'
import { Route as AdminAdminRouteImport } from './routes/_admin/admin'
import { Route as AuthenticatedSpIndexRouteImport } from './routes/_authenticated/sp/index'
import { Route as AuthenticatedSpSuccessRouteImport } from './routes/_authenticated/sp/success'
import { Route as AuthenticatedSpCancelRouteImport } from './routes/_authenticated/sp/cancel'
import { Route as AuthenticatedCharacterCreateRouteImport } from './routes/_authenticated/character.create'
import { Route as AuthenticatedCharacterIdRouteImport } from './routes/_authenticated/character/$id'
import { Route as AdminAdminSpRouteImport } from './routes/_admin/admin.sp'
import { Route as AdminAdminPerformanceRouteImport } from './routes/_admin/admin.performance'
import { Route as AuthenticatedCharacterIdIndexRouteImport } from './routes/_authenticated/character/$id/index'
import { Route as AuthenticatedCharacterIdEditRouteImport } from './routes/_authenticated/character/$id/edit'

const RegisterRoute = RegisterRouteImport.update({
  id: '/register',
  path: '/register',
  getParentRoute: () => rootRouteImport,
} as any)
const LoginRoute = LoginRouteImport.update({
  id: '/login',
  path: '/login',
  getParentRoute: () => rootRouteImport,
} as any)
const AuthenticatedRoute = AuthenticatedRouteImport.update({
  id: '/_authenticated',
  getParentRoute: () => rootRouteImport,
} as any)
const AdminRoute = AdminRouteImport.update({
  id: '/_admin',
  getParentRoute: () => rootRouteImport,
} as any)
const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const AuthenticatedTitlesRoute = AuthenticatedTitlesRouteImport.update({
  id: '/titles',
  path: '/titles',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedSettingsRoute = AuthenticatedSettingsRouteImport.update({
  id: '/settings',
  path: '/settings',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedQuestsRoute = AuthenticatedQuestsRouteImport.update({
  id: '/quests',
  path: '/quests',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedLogsRoute = AuthenticatedLogsRouteImport.update({
  id: '/logs',
  path: '/logs',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedDashboardRoute = AuthenticatedDashboardRouteImport.update({
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedCharactersRoute = AuthenticatedCharactersRouteImport.update({
  id: '/characters',
  path: '/characters',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AdminAdminRoute = AdminAdminRouteImport.update({
  id: '/admin',
  path: '/admin',
  getParentRoute: () => AdminRoute,
} as any)
const AuthenticatedSpIndexRoute = AuthenticatedSpIndexRouteImport.update({
  id: '/sp/',
  path: '/sp/',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedSpSuccessRoute = AuthenticatedSpSuccessRouteImport.update({
  id: '/sp/success',
  path: '/sp/success',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedSpCancelRoute = AuthenticatedSpCancelRouteImport.update({
  id: '/sp/cancel',
  path: '/sp/cancel',
  getParentRoute: () => AuthenticatedRoute,
} as any)
const AuthenticatedCharacterCreateRoute =
  AuthenticatedCharacterCreateRouteImport.update({
    id: '/character/create',
    path: '/character/create',
    getParentRoute: () => AuthenticatedRoute,
  } as any)
const AuthenticatedCharacterIdRoute =
  AuthenticatedCharacterIdRouteImport.update({
    id: '/character/$id',
    path: '/character/$id',
    getParentRoute: () => AuthenticatedRoute,
  } as any)
const AdminAdminSpRoute = AdminAdminSpRouteImport.update({
  id: '/sp',
  path: '/sp',
  getParentRoute: () => AdminAdminRoute,
} as any)
const AdminAdminPerformanceRoute = AdminAdminPerformanceRouteImport.update({
  id: '/performance',
  path: '/performance',
  getParentRoute: () => AdminAdminRoute,
} as any)
const AuthenticatedCharacterIdIndexRoute =
  AuthenticatedCharacterIdIndexRouteImport.update({
    id: '/',
    path: '/',
    getParentRoute: () => AuthenticatedCharacterIdRoute,
  } as any)
const AuthenticatedCharacterIdEditRoute =
  AuthenticatedCharacterIdEditRouteImport.update({
    id: '/edit',
    path: '/edit',
    getParentRoute: () => AuthenticatedCharacterIdRoute,
  } as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/register': typeof RegisterRoute
  '/admin': typeof AdminAdminRouteWithChildren
  '/characters': typeof AuthenticatedCharactersRoute
  '/dashboard': typeof AuthenticatedDashboardRoute
  '/logs': typeof AuthenticatedLogsRoute
  '/quests': typeof AuthenticatedQuestsRoute
  '/settings': typeof AuthenticatedSettingsRoute
  '/titles': typeof AuthenticatedTitlesRoute
  '/admin/performance': typeof AdminAdminPerformanceRoute
  '/admin/sp': typeof AdminAdminSpRoute
  '/character/$id': typeof AuthenticatedCharacterIdRouteWithChildren
  '/character/create': typeof AuthenticatedCharacterCreateRoute
  '/sp/cancel': typeof AuthenticatedSpCancelRoute
  '/sp/success': typeof AuthenticatedSpSuccessRoute
  '/sp': typeof AuthenticatedSpIndexRoute
  '/character/$id/edit': typeof AuthenticatedCharacterIdEditRoute
  '/character/$id/': typeof AuthenticatedCharacterIdIndexRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/register': typeof RegisterRoute
  '/admin': typeof AdminAdminRouteWithChildren
  '/characters': typeof AuthenticatedCharactersRoute
  '/dashboard': typeof AuthenticatedDashboardRoute
  '/logs': typeof AuthenticatedLogsRoute
  '/quests': typeof AuthenticatedQuestsRoute
  '/settings': typeof AuthenticatedSettingsRoute
  '/titles': typeof AuthenticatedTitlesRoute
  '/admin/performance': typeof AdminAdminPerformanceRoute
  '/admin/sp': typeof AdminAdminSpRoute
  '/character/create': typeof AuthenticatedCharacterCreateRoute
  '/sp/cancel': typeof AuthenticatedSpCancelRoute
  '/sp/success': typeof AuthenticatedSpSuccessRoute
  '/sp': typeof AuthenticatedSpIndexRoute
  '/character/$id/edit': typeof AuthenticatedCharacterIdEditRoute
  '/character/$id': typeof AuthenticatedCharacterIdIndexRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/_admin': typeof AdminRouteWithChildren
  '/_authenticated': typeof AuthenticatedRouteWithChildren
  '/login': typeof LoginRoute
  '/register': typeof RegisterRoute
  '/_admin/admin': typeof AdminAdminRouteWithChildren
  '/_authenticated/characters': typeof AuthenticatedCharactersRoute
  '/_authenticated/dashboard': typeof AuthenticatedDashboardRoute
  '/_authenticated/logs': typeof AuthenticatedLogsRoute
  '/_authenticated/quests': typeof AuthenticatedQuestsRoute
  '/_authenticated/settings': typeof AuthenticatedSettingsRoute
  '/_authenticated/titles': typeof AuthenticatedTitlesRoute
  '/_admin/admin/performance': typeof AdminAdminPerformanceRoute
  '/_admin/admin/sp': typeof AdminAdminSpRoute
  '/_authenticated/character/$id': typeof AuthenticatedCharacterIdRouteWithChildren
  '/_authenticated/character/create': typeof AuthenticatedCharacterCreateRoute
  '/_authenticated/sp/cancel': typeof AuthenticatedSpCancelRoute
  '/_authenticated/sp/success': typeof AuthenticatedSpSuccessRoute
  '/_authenticated/sp/': typeof AuthenticatedSpIndexRoute
  '/_authenticated/character/$id/edit': typeof AuthenticatedCharacterIdEditRoute
  '/_authenticated/character/$id/': typeof AuthenticatedCharacterIdIndexRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths:
    | '/'
    | '/login'
    | '/register'
    | '/admin'
    | '/characters'
    | '/dashboard'
    | '/logs'
    | '/quests'
    | '/settings'
    | '/titles'
    | '/admin/performance'
    | '/admin/sp'
    | '/character/$id'
    | '/character/create'
    | '/sp/cancel'
    | '/sp/success'
    | '/sp'
    | '/character/$id/edit'
    | '/character/$id/'
  fileRoutesByTo: FileRoutesByTo
  to:
    | '/'
    | '/login'
    | '/register'
    | '/admin'
    | '/characters'
    | '/dashboard'
    | '/logs'
    | '/quests'
    | '/settings'
    | '/titles'
    | '/admin/performance'
    | '/admin/sp'
    | '/character/create'
    | '/sp/cancel'
    | '/sp/success'
    | '/sp'
    | '/character/$id/edit'
    | '/character/$id'
  id:
    | '__root__'
    | '/'
    | '/_admin'
    | '/_authenticated'
    | '/login'
    | '/register'
    | '/_admin/admin'
    | '/_authenticated/characters'
    | '/_authenticated/dashboard'
    | '/_authenticated/logs'
    | '/_authenticated/quests'
    | '/_authenticated/settings'
    | '/_authenticated/titles'
    | '/_admin/admin/performance'
    | '/_admin/admin/sp'
    | '/_authenticated/character/$id'
    | '/_authenticated/character/create'
    | '/_authenticated/sp/cancel'
    | '/_authenticated/sp/success'
    | '/_authenticated/sp/'
    | '/_authenticated/character/$id/edit'
    | '/_authenticated/character/$id/'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  AdminRoute: typeof AdminRouteWithChildren
  AuthenticatedRoute: typeof AuthenticatedRouteWithChildren
  LoginRoute: typeof LoginRoute
  RegisterRoute: typeof RegisterRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/register': {
      id: '/register'
      path: '/register'
      fullPath: '/register'
      preLoaderRoute: typeof RegisterRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/login': {
      id: '/login'
      path: '/login'
      fullPath: '/login'
      preLoaderRoute: typeof LoginRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/_authenticated': {
      id: '/_authenticated'
      path: ''
      fullPath: ''
      preLoaderRoute: typeof AuthenticatedRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/_admin': {
      id: '/_admin'
      path: ''
      fullPath: ''
      preLoaderRoute: typeof AdminRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/_authenticated/titles': {
      id: '/_authenticated/titles'
      path: '/titles'
      fullPath: '/titles'
      preLoaderRoute: typeof AuthenticatedTitlesRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/settings': {
      id: '/_authenticated/settings'
      path: '/settings'
      fullPath: '/settings'
      preLoaderRoute: typeof AuthenticatedSettingsRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/quests': {
      id: '/_authenticated/quests'
      path: '/quests'
      fullPath: '/quests'
      preLoaderRoute: typeof AuthenticatedQuestsRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/logs': {
      id: '/_authenticated/logs'
      path: '/logs'
      fullPath: '/logs'
      preLoaderRoute: typeof AuthenticatedLogsRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/dashboard': {
      id: '/_authenticated/dashboard'
      path: '/dashboard'
      fullPath: '/dashboard'
      preLoaderRoute: typeof AuthenticatedDashboardRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/characters': {
      id: '/_authenticated/characters'
      path: '/characters'
      fullPath: '/characters'
      preLoaderRoute: typeof AuthenticatedCharactersRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_admin/admin': {
      id: '/_admin/admin'
      path: '/admin'
      fullPath: '/admin'
      preLoaderRoute: typeof AdminAdminRouteImport
      parentRoute: typeof AdminRoute
    }
    '/_authenticated/sp/': {
      id: '/_authenticated/sp/'
      path: '/sp'
      fullPath: '/sp'
      preLoaderRoute: typeof AuthenticatedSpIndexRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/sp/success': {
      id: '/_authenticated/sp/success'
      path: '/sp/success'
      fullPath: '/sp/success'
      preLoaderRoute: typeof AuthenticatedSpSuccessRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/sp/cancel': {
      id: '/_authenticated/sp/cancel'
      path: '/sp/cancel'
      fullPath: '/sp/cancel'
      preLoaderRoute: typeof AuthenticatedSpCancelRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/character/create': {
      id: '/_authenticated/character/create'
      path: '/character/create'
      fullPath: '/character/create'
      preLoaderRoute: typeof AuthenticatedCharacterCreateRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_authenticated/character/$id': {
      id: '/_authenticated/character/$id'
      path: '/character/$id'
      fullPath: '/character/$id'
      preLoaderRoute: typeof AuthenticatedCharacterIdRouteImport
      parentRoute: typeof AuthenticatedRoute
    }
    '/_admin/admin/sp': {
      id: '/_admin/admin/sp'
      path: '/sp'
      fullPath: '/admin/sp'
      preLoaderRoute: typeof AdminAdminSpRouteImport
      parentRoute: typeof AdminAdminRoute
    }
    '/_admin/admin/performance': {
      id: '/_admin/admin/performance'
      path: '/performance'
      fullPath: '/admin/performance'
      preLoaderRoute: typeof AdminAdminPerformanceRouteImport
      parentRoute: typeof AdminAdminRoute
    }
    '/_authenticated/character/$id/': {
      id: '/_authenticated/character/$id/'
      path: '/'
      fullPath: '/character/$id/'
      preLoaderRoute: typeof AuthenticatedCharacterIdIndexRouteImport
      parentRoute: typeof AuthenticatedCharacterIdRoute
    }
    '/_authenticated/character/$id/edit': {
      id: '/_authenticated/character/$id/edit'
      path: '/edit'
      fullPath: '/character/$id/edit'
      preLoaderRoute: typeof AuthenticatedCharacterIdEditRouteImport
      parentRoute: typeof AuthenticatedCharacterIdRoute
    }
  }
}

interface AdminAdminRouteChildren {
  AdminAdminPerformanceRoute: typeof AdminAdminPerformanceRoute
  AdminAdminSpRoute: typeof AdminAdminSpRoute
}

const AdminAdminRouteChildren: AdminAdminRouteChildren = {
  AdminAdminPerformanceRoute: AdminAdminPerformanceRoute,
  AdminAdminSpRoute: AdminAdminSpRoute,
}

const AdminAdminRouteWithChildren = AdminAdminRoute._addFileChildren(
  AdminAdminRouteChildren,
)

interface AdminRouteChildren {
  AdminAdminRoute: typeof AdminAdminRouteWithChildren
}

const AdminRouteChildren: AdminRouteChildren = {
  AdminAdminRoute: AdminAdminRouteWithChildren,
}

const AdminRouteWithChildren = AdminRoute._addFileChildren(AdminRouteChildren)

interface AuthenticatedCharacterIdRouteChildren {
  AuthenticatedCharacterIdEditRoute: typeof AuthenticatedCharacterIdEditRoute
  AuthenticatedCharacterIdIndexRoute: typeof AuthenticatedCharacterIdIndexRoute
}

const AuthenticatedCharacterIdRouteChildren: AuthenticatedCharacterIdRouteChildren =
  {
    AuthenticatedCharacterIdEditRoute: AuthenticatedCharacterIdEditRoute,
    AuthenticatedCharacterIdIndexRoute: AuthenticatedCharacterIdIndexRoute,
  }

const AuthenticatedCharacterIdRouteWithChildren =
  AuthenticatedCharacterIdRoute._addFileChildren(
    AuthenticatedCharacterIdRouteChildren,
  )

interface AuthenticatedRouteChildren {
  AuthenticatedCharactersRoute: typeof AuthenticatedCharactersRoute
  AuthenticatedDashboardRoute: typeof AuthenticatedDashboardRoute
  AuthenticatedLogsRoute: typeof AuthenticatedLogsRoute
  AuthenticatedQuestsRoute: typeof AuthenticatedQuestsRoute
  AuthenticatedSettingsRoute: typeof AuthenticatedSettingsRoute
  AuthenticatedTitlesRoute: typeof AuthenticatedTitlesRoute
  AuthenticatedCharacterIdRoute: typeof AuthenticatedCharacterIdRouteWithChildren
  AuthenticatedCharacterCreateRoute: typeof AuthenticatedCharacterCreateRoute
  AuthenticatedSpCancelRoute: typeof AuthenticatedSpCancelRoute
  AuthenticatedSpSuccessRoute: typeof AuthenticatedSpSuccessRoute
  AuthenticatedSpIndexRoute: typeof AuthenticatedSpIndexRoute
}

const AuthenticatedRouteChildren: AuthenticatedRouteChildren = {
  AuthenticatedCharactersRoute: AuthenticatedCharactersRoute,
  AuthenticatedDashboardRoute: AuthenticatedDashboardRoute,
  AuthenticatedLogsRoute: AuthenticatedLogsRoute,
  AuthenticatedQuestsRoute: AuthenticatedQuestsRoute,
  AuthenticatedSettingsRoute: AuthenticatedSettingsRoute,
  AuthenticatedTitlesRoute: AuthenticatedTitlesRoute,
  AuthenticatedCharacterIdRoute: AuthenticatedCharacterIdRouteWithChildren,
  AuthenticatedCharacterCreateRoute: AuthenticatedCharacterCreateRoute,
  AuthenticatedSpCancelRoute: AuthenticatedSpCancelRoute,
  AuthenticatedSpSuccessRoute: AuthenticatedSpSuccessRoute,
  AuthenticatedSpIndexRoute: AuthenticatedSpIndexRoute,
}

const AuthenticatedRouteWithChildren = AuthenticatedRoute._addFileChildren(
  AuthenticatedRouteChildren,
)

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  AdminRoute: AdminRouteWithChildren,
  AuthenticatedRoute: AuthenticatedRouteWithChildren,
  LoginRoute: LoginRoute,
  RegisterRoute: RegisterRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
