import React from 'react'
import { ShelfDrawerView } from './components/ShelfDrawerView'
import { ShelfWorkbenchView } from './components/ShelfWorkbenchView'

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search)
  const mode = urlParams.get('mode')

  if (mode === 'drawer') {
    return <ShelfDrawerView />
  }

  return <ShelfWorkbenchView />
}

export default App
