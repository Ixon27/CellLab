import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import './reference-material.css';
import { initTheme } from './state/theme';

// `darwin` / `win32`: the macOS window has no title bar, so the app header takes its place (styles.css).
if (window.cellLabDesktop) document.documentElement.dataset.desktop = window.cellLabDesktop.platform;
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
