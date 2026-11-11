/**
 * Where the native app loads the processing engine from: the `/engine/` page
 * of your Netlify deployment. Set EXPO_PUBLIC_ENGINE_URL in `.env`.
 */
export const ENGINE_URL = process.env.EXPO_PUBLIC_ENGINE_URL || 'https://cutiq.netlify.app/engine/index.html';
