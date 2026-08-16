import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DisplayApp } from './components/DisplayApp'
import { EditorApp } from './components/EditorApp'
import { useAppStore } from './store'

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const ready = useAppStore((state) => state.ready)
  const role = useAppStore((state) => state.role)
  const initialize = useAppStore((state) => state.initialize)
  const error = useAppStore((state) => state.error)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (error) {
    return <main className="loading-screen"><span className="loading-mark">!</span><p>{error}</p></main>
  }

  if (!ready) {
    return <main className="loading-screen"><span className="loading-mark">U</span><p>{t('loading')}</p></main>
  }

  return role === 'display' ? <DisplayApp /> : <EditorApp />
}
