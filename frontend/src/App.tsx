import { createRouter, RouterProvider } from '@tanstack/react-router'
import '@/types/router' // 型定義をインポート

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Create a new router instance
const router = createRouter({ 
  routeTree,
  defaultPendingComponent: () => <div>Loading...</div>,
  context: {
    auth: undefined!,
  },
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App() {
  return <RouterProvider router={router} />
}

export default App
