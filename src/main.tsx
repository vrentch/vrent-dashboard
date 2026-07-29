import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Embed mode (?embed=1) hides the standalone page chrome so the app can be
// dropped into the Shopify theme via an <iframe> and blend in.
const params = new URLSearchParams(window.location.search)
if (params.get('embed') === '1') {
  document.body.dataset.embed = '1'

  // Report our content height to the host page so the Shopify section can
  // auto-resize its iframe (see shopify/sections/vr-news.liquid).
  const postHeight = () => {
    const height = document.documentElement.scrollHeight
    window.parent?.postMessage({ type: 'vr-news-height', height }, '*')
  }
  window.addEventListener('load', postHeight)
  const ro = new ResizeObserver(postHeight)
  ro.observe(document.documentElement)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
