import React from 'react'
import { PinFloatingView } from './components/PinFloatingView'
import { PinWorkbenchView } from './components/PinWorkbenchView'

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search)
  const mode = urlParams.get('mode')
  const pinId = urlParams.get('pinId')

  if (mode === 'pin' && pinId) {
    return <PinFloatingView pinId={pinId} />
  }

  return <PinWorkbenchView />
}

export default App
