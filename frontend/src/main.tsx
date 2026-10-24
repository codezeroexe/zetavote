import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/public-sans'
import './theme.css'
import './index.css'
import './App.css'
import './styles/account.css'
import './styles/voter.css'
import './styles/verify.css'
import './styles/admin.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
