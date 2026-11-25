import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import './report.css'

// A service worker left over from an earlier build serves old files after a
// reload and shows a blank page. The dev server never needs one.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
}

// A fresh start of the app (new tab, reopened window, installed app launched again) always lands on the
// Calendar page, even if the address still holds the page the person was on last time. A refresh inside the
// same tab keeps the current page, because sessionStorage survives a refresh but not a new start.
try {
  if (!sessionStorage.getItem('helett.started')) {
    sessionStorage.setItem('helett.started', '1')
    if (window.location.hash && window.location.hash !== '#/') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
    }
  }
} catch {
  /* storage blocked: leave the address alone */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
