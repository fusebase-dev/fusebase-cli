import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ ok: true }))

// Add routes:
// import { itemsRoutes } from './routes/items'
// app.route('/items', itemsRoutes)

const port = Number(process.env.BACKEND_PORT) || 3001

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`)
})

export default app
