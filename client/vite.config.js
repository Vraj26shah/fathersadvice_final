import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main:             'index.html',
        login:            'login.html',
        signup:           'signup.html',
        'signup-mentor':  'signup-mentor.html',
        'signup-mentee':  'signup-mentee.html',
        'dashboard-mentor': 'dashboard-mentor.html',
        'dashboard-mentee': 'dashboard-mentee.html',
        'find-mentor':      'find-mentor.html',
        'session':          'session.html',
        'calendar':         'calendar.html',
        'chat':             'chat.html',
      }
    }
  }
})
