import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/tokens.css';
import { router } from '@/routes/router';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexAuthProvider>
  </StrictMode>,
);
