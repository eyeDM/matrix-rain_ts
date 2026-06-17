import { defineConfig } from 'vite';

export default defineConfig({
    base: process.env.VITE_BASE_URL || '/',
    root: 'src/app',
    publicDir: '../../public',
    build: {
        outDir: '../../dist',
        emptyOutDir: true
    },
    server: {
        port: 5173
    },
    resolve: {
        tsconfigPaths: true 
    }
});
