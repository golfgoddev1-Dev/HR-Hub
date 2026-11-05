// The one way out of the app. The server request has already settled by the
// time this runs, so it drops every browser-side copy of the account and
// replaces the protected page in history instead of adding to it.
import { clearAll } from './data-cache.js'
import { clearClientStorage } from './logout-storage.js'

export async function completeLogout() {
  // 1. the in-memory API cache, 2. web storage and Cache Storage, 3. navigate.
  clearAll()
  await clearClientStorage()
  // replace(), not assign(): Back must not return to the protected page.
  window.location.replace('/login')
}
