import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-2xl p-12">
      <h1 className="text-3xl font-semibold">AERQYN</h1>
      <p className="mt-4">
        Repository foundation. Application features will follow in later
        milestones.
      </p>
    </main>
  </StrictMode>,
);
