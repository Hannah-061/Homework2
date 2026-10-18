import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/global.css';
import { App } from './App';
import { ChatProvider } from './state/ChatContext';
import { I18nProvider } from './i18n';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <ChatProvider>
      <App />
    </ChatProvider>
  </I18nProvider>,
);
