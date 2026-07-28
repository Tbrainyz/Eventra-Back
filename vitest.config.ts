import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30000, // integration tests spin up an in-memory MongoDB replica set
    hookTimeout: 30000,
  },
})
