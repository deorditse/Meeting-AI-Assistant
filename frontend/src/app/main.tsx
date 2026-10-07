import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './providers/ErrorBoundary';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('M2A root container was not found.');
}

createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => window.location.reload());
}
