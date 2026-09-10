import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { RootLayout } from './App'
import { LoginScreen } from './routes/LoginScreen'
import { Dashboard } from './routes/Dashboard'
import { Companies } from './routes/Companies'
import { CompanyDetail } from './routes/CompanyDetail'
import { Contacts } from './routes/Contacts'
import { ContactDetail } from './routes/ContactDetail'
import { Applications } from './routes/Applications'
import { ApplicationDetail } from './routes/ApplicationDetail'
import { Review } from './routes/Review'
import { ReviewDetail } from './routes/ReviewDetail'
import { Settings } from './routes/Settings'
import './index.css'

const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'companies', element: <Companies /> },
      { path: 'companies/:id', element: <CompanyDetail /> },
      { path: 'contacts', element: <Contacts /> },
      { path: 'contacts/:id', element: <ContactDetail /> },
      { path: 'applications', element: <Applications /> },
      { path: 'applications/:id', element: <ApplicationDetail /> },
      { path: 'review', element: <Review /> },
      { path: 'review/:id', element: <ReviewDetail /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
