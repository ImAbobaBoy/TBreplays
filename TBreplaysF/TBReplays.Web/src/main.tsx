import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app/App';

import './styles/app.css';
import './styles/viewer.css';
import './styles/panels.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Root element #root не найден.');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);