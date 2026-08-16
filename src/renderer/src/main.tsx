import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './i18n'
import './styles.css'

const windowRole = new URLSearchParams(window.location.search).get('role') === 'display' ? 'display' : 'editor'
document.documentElement.dataset.role = windowRole

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
