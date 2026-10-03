import React from 'react';
import ReactDOM from 'react-dom/client';

import { OnlineRoot } from './features/online/OnlineRoot';
import { MapCatalogProvider } from './features/maps/MapCatalog';
import { App } from './app/App';

import './styles/app.css';
import './styles/viewer.css';
import './styles/panels.css';
import './styles/userWorkspace.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Root element #root не найден.');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <OnlineRoot><MapCatalogProvider><App /></MapCatalogProvider></OnlineRoot>
  </React.StrictMode>,
);